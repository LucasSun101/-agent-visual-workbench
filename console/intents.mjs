// 文件桥的写侧：消费 workbench/intents/ 里的意图文件。
//
// 设计约束（和 CONTRACT.md 一致）：
//   · 一意图一文件；文件名 = id = 幂等键（重复投递只生效一次）
//   · 只接受低危动作：answer / resolve / stop
//   · 绝不允许改编排（rules / agent / cwd / model / access / to）——那些只能人在界面上点
//   · 每个文件都要留回执：成功进 done/，失败进 rejected/，两边都写 receipts.ndjson
//   · 限速：每分钟最多处理 20 条，防止 Agent 自己打转把中台刷爆
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";

export const INTENT_ACTIONS = ["answer", "resolve", "stop"];
const ACTIONS = new Set(INTENT_ACTIONS);
export const INTENT_FORBIDDEN_FIELDS = ["rules", "agent", "cwd", "model", "access", "to", "access_mode"];
export const INTENT_MAX_BYTES = 8 * 1024;
export const INTENT_MAX_PER_MINUTE = 20;
const MAX_BYTES = INTENT_MAX_BYTES;
const MAX_PER_MINUTE = INTENT_MAX_PER_MINUTE;
const POLL_MS = 2000;

const isPosInt = (v) => Number.isInteger(v) && v > 0;

export function intentDirs(root) {
  const intents = path.join(root, "intents");
  return { intents, done: path.join(intents, "done"), rejected: path.join(intents, "rejected") };
}

export function ensureIntentDirs(root) {
  const d = intentDirs(root);
  for (const p of [d.intents, d.done, d.rejected]) mkdirSync(p, { recursive: true });
  return d;
}

/** 校验一个意图对象。返回错误数组，空数组 = 通过。 */
export function validateIntent(raw, stem) {
  const errs = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ["不是 JSON 对象"];

  if (typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(raw.id)) {
    errs.push("id 必须是 6–64 位的字母、数字、_ 或 -");
  } else if (raw.id !== stem) {
    errs.push(`id 必须等于文件名（文件名是 ${stem}）`);
  }
  if (!ACTIONS.has(raw.action)) errs.push(`action 只能是 ${[...ACTIONS].join(" / ")}`);
  if (typeof raw.from !== "string" || !/^[A-Za-z0-9 ._-]{1,40}$/.test(raw.from)) {
    errs.push("from 必填：写清是谁提的（1–40 字符）");
  }
  for (const k of INTENT_FORBIDDEN_FIELDS) {
    if (k in raw) errs.push(`不允许的字段「${k}」：文件桥不能改编排，那只能人在界面上点`);
  }

  if (raw.action === "answer") {
    if (!isPosInt(raw.card)) errs.push("answer 需要 card（正整数卡片号）");
    const hasChoice = Number.isInteger(raw.choice) && raw.choice >= 0;
    const hasText = typeof raw.text === "string" && raw.text.trim().length > 0;
    if (!hasChoice && !hasText) errs.push("answer 需要 choice（选项序号，从 0 起）或非空 text");
    if (raw.choice !== undefined && !hasChoice) errs.push("choice 必须是非负整数");
    if (typeof raw.text === "string" && raw.text.length > 4000) errs.push("text 超过 4000 字");
  }
  if (raw.action === "resolve") {
    if (!isPosInt(raw.card)) errs.push("resolve 需要 card");
    if (typeof raw.text !== "string" || !raw.text.trim()) errs.push("resolve 需要 text（写清在哪核实了已解决）");
  }
  if (raw.action === "stop") {
    if (!isPosInt(raw.run)) errs.push("stop 需要 run（正整数轮次号）");
  }
  return errs;
}

async function call(hub, auth, p, body) {
  const r = await fetch(`${hub}${p}`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  let payload = null;
  try {
    payload = await r.json();
  } catch {
    /* 有些响应没有 body */
  }
  return { ok: r.ok, status: r.status, payload };
}

async function apply(hub, auth, raw) {
  if (raw.action === "answer") {
    const body = raw.choice !== undefined ? { choice: raw.choice } : { text: String(raw.text).trim() };
    return call(hub, auth, `/v1/cards/${raw.card}/answer`, body);
  }
  if (raw.action === "resolve") {
    return call(hub, auth, `/v1/cards/${raw.card}/resolve`, { reason: String(raw.text).trim().slice(0, 1000) });
  }
  if (raw.action === "stop") {
    return call(hub, auth, `/v1/runs/${raw.run}/cancel`, {});
  }
  return { ok: false, status: 400, payload: { error: "未知动作" } };
}

/** 给 state.json 用的摘要：还有几条没处理、最近一条回执是什么。 */
export function intentStats(root) {
  const d = intentDirs(root);
  let pending = 0;
  try {
    pending = readdirSync(d.intents).filter((n) => n.endsWith(".json")).length;
  } catch {}
  let lastReceipt = null;
  let recentRejected = 0;
  try {
    const lines = readFileSync(path.join(d.intents, "receipts.ndjson"), "utf8").split(/\r?\n/).filter(Boolean);
    const tail = lines
      .slice(-50)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    lastReceipt = tail.at(-1) ?? null;
    recentRejected = tail.filter((r) => !r.ok).length;
  } catch {}
  return { pending, lastReceipt, recentRejected };
}

/**
 * 启动意图消费循环。返回一个停止函数。
 * @param {{hub:string, auth:object, workbench:string, log?:Function}} opts
 */
export function startIntentLoop({ hub, auth, workbench, log = console.log }) {
  const d = ensureIntentDirs(workbench);
  const ledgerFile = path.join(d.intents, "ledger.ndjson");
  const receipts = path.join(d.intents, "receipts.ndjson");

  // 已处理过的 id（重启后仍然生效，防止重复投递再执行一次）
  const seen = new Set();
  if (existsSync(ledgerFile)) {
    for (const line of readFileSync(ledgerFile, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        seen.add(JSON.parse(line).id);
      } catch {
        /* 坏行跳过 */
      }
    }
  }

  const recent = []; // 限速窗口
  let busy = false;

  const receipt = (row) => {
    try {
      appendFileSync(receipts, JSON.stringify(row) + "\n", "utf8");
    } catch (e) {
      log(`回执写不出去：${e.message}`);
    }
  };

  async function tick() {
    let names;
    try {
      names = readdirSync(d.intents, { withFileTypes: true })
        .filter((x) => x.isFile() && x.name.endsWith(".json"))
        .map((x) => x.name);
    } catch {
      return;
    }
    if (!names.length) return;

    for (const name of names.sort()) {
      const src = path.join(d.intents, name);
      const stem = name.replace(/\.json$/, "");
      const move = (bucket, tag) => {
        try {
          renameSync(src, path.join(bucket, `${Date.now()}-${tag}-${name}`));
        } catch (e) {
          log(`移不动 ${name}：${e.message}`);
        }
      };

      // 限速
      const now = Date.now();
      while (recent.length && now - recent[0] > 60_000) recent.shift();
      if (recent.length >= MAX_PER_MINUTE) {
        log(`意图积压超过 ${MAX_PER_MINUTE} 条/分钟，先不处理（防止打转）`);
        return;
      }

      let raw;
      try {
        if (statSync(src).size > MAX_BYTES) throw new Error(`文件超过 ${MAX_BYTES} 字节`);
        raw = JSON.parse(readFileSync(src, "utf8"));
      } catch (e) {
        log(`✗ ${name}：读不懂（${e.message}）`);
        receipt({ at: new Date().toISOString(), file: name, ok: false, error: `读不懂：${e.message}` });
        move(d.rejected, "bad");
        continue;
      }

      const errs = validateIntent(raw, stem);
      if (errs.length) {
        log(`✗ ${name}：${errs.join("；")}`);
        receipt({ at: new Date().toISOString(), file: name, id: raw?.id, ok: false, error: errs.join("；") });
        move(d.rejected, "invalid");
        continue;
      }

      if (seen.has(raw.id)) {
        log(`· ${name}：这条已经处理过（id=${raw.id}），只归档不重放`);
        receipt({ at: new Date().toISOString(), file: name, id: raw.id, ok: true, duplicate: true, action: raw.action });
        move(d.done, "dup");
        continue;
      }

      recent.push(now);
      let result;
      try {
        result = await apply(hub, auth, raw);
      } catch (e) {
        result = { ok: false, status: 0, payload: { error: e.message } };
      }

      const row = {
        at: new Date().toISOString(),
        file: name,
        id: raw.id,
        from: raw.from,
        action: raw.action,
        ok: result.ok,
        status: result.status,
      };
      if (result.ok) {
        seen.add(raw.id);
        try {
          appendFileSync(ledgerFile, JSON.stringify({ id: raw.id, at: row.at, action: raw.action }) + "\n", "utf8");
        } catch {}
        log(`✓ ${name}：${raw.action} 生效（来自 ${raw.from}）`);
        receipt(row);
        move(d.done, "ok");
      } else {
        log(`✗ ${name}：中台拒绝（HTTP ${result.status} ${result.payload?.error ?? ""}）`);
        receipt({ ...row, error: result.payload?.error ?? `HTTP ${result.status}` });
        move(d.rejected, "denied");
      }
    }
  }

  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    tick()
      .catch((e) => log(`意图循环出错：${e.message}`))
      .finally(() => {
        busy = false;
      });
  }, POLL_MS);

  log(`文件桥已开启：${d.intents}（每 2 秒看一次，只接受 answer / resolve / stop）`);
  return () => clearInterval(timer);
}
