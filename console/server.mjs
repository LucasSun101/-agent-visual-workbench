// 工作台控制台：静态页 + /v1 只读反代 + SSE 中继。
// 设计要点：
//   1. owner key 只在服务端，浏览器只拿一个 HttpOnly cookie；
//   2. 只读：除 /api/state、/api/why、/api/stream 外不暴露任何写接口；
//   3. 不依赖任何 npm 包，node 24 原生跑；
//   4. 顺手把 state.json 投影到 workbench/（给任意 Agent 读的文件桥入口）。
import { createServer } from "node:http";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { homedir, networkInterfaces } from "node:os";
import { ensureIntentDirs, intentDirs, intentStats, startIntentLoop } from "./intents.mjs";
import { renderAgentsDoc } from "./agents-doc.mjs";
import { BACKENDS, ROLES, createStore, backendsInfo } from "./workflow/store.mjs";
import { syncManualRules, setBackendModel } from "./workflow/rules-sync.mjs";
import { startGraphRun, startChatRun } from "./workflow/runner.mjs";
import { handleWorkflowWrite } from "./routes/workflow-write.mjs";
import { parseDirectives } from "./workflow/directives.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PUBLIC = path.join(HERE, "public");
const WORKBENCH = path.join(ROOT, "workbench");
const PORT = Number(process.env.WB_PORT ?? 51425);
// 默认 auto：只听回环，外加（若存在）Tailscale 给的 100.x 地址。
// Tailscale Serve 走本机转发，不需要额外绑定；鸿蒙 NEXT 客户端没有 MagicDNS，
// 只能走 IP，所以必须直接监听那个地址。想在局域网里直连调试时用 WB_BIND=0.0.0.0。
const BIND = process.env.WB_BIND || "auto";
const MAX_STATE_BYTES = 64 * 1024;

const configFile = path.join(homedir(), ".agent-autoloop", "config.json");
if (!existsSync(configFile)) {
  console.error(`找不到 ${configFile}：先跑一次 agent-autoloop init。`);
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(configFile, "utf8"));
const HUB = String(cfg.url).replace(/\/+$/, "");
const HUB_AUTH = { authorization: `Bearer ${cfg.owner}` };

// 令牌持久化：让入口 URL 可书签。本地单用户，令牌落盘在本机工作区，代价可接受。
const sessionFile = path.join(HERE, ".session");
let SESSION = existsSync(sessionFile) ? readFileSync(sessionFile, "utf8").trim() : "";
if (!/^[a-f0-9]{48}$/.test(SESSION)) {
  SESSION = randomBytes(24).toString("hex");
  writeFileSync(sessionFile, SESSION, { mode: 0o600 });
}
const COOKIE = "wb_session";

// 登录口令：挂到公网时唯一的那道门。没有就用本地令牌（?k=）进。
const passFile = path.join(HERE, ".passcode");
let PASSCODE = (process.env.WB_PASSCODE ?? "").trim();
if (!PASSCODE && existsSync(passFile)) PASSCODE = readFileSync(passFile, "utf8").trim();
let passGenerated = false;
if (!PASSCODE) {
  // 去掉容易看错的 0/o/1/l/i，手机上手打不容易错
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const pick = (n) => Array.from(randomBytes(n)).map((b) => abc[b % abc.length]).join("");
  PASSCODE = `${pick(4)}-${pick(4)}-${pick(4)}`;
  writeFileSync(passFile, PASSCODE + "\n", { mode: 0o600 });
  passGenerated = true;
}

const same = (a, b) => {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
};

// 暴力破解闸：同一来源 5 分钟内错 6 次就锁一会。
const LOGIN_WINDOW = 5 * 60_000;
const LOGIN_MAX = 6;
const attempts = new Map();
const locked = (ip) => {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.until) {
    attempts.delete(ip);
    return false;
  }
  return rec.n >= LOGIN_MAX;
};
const noteFail = (ip) => {
  const rec = attempts.get(ip) ?? { n: 0, until: Date.now() + LOGIN_WINDOW };
  rec.n += 1;
  attempts.set(ip, rec);
};
const clientIp = (req) =>
  String(req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "")
    .split(",")[0]
    .trim();

const cookieHeader = (req) => {
  const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  return `${COOKIE}=${SESSION}; HttpOnly; SameSite=Lax; Path=/${proto === "https" ? "; Secure" : ""}`;
};

let lastSeq = 0;

// ---- state.json 投影（派生、只读、原子换）------------------------------------
function project(s) {
  const trimRun = (r) => ({
    id: r.id,
    rule: r.rule,
    agent: r.agent,
    state: r.state,
    attempts: r.attempts,
    createdAt: r.createdAt,
    claimedAt: r.claimedAt,
    finishedAt: r.finishedAt,
    summary: r.summary,
    error: r.error,
    session: r.session,
    usage: r.usage,
    stopping: r.stopping,
    events: (r.events ?? []).slice(0, 5),
  });
  return {
    schema: "workbench.state/0.2",
    rev: lastSeq,
    generatedAt: new Date().toISOString(),
    hub: HUB,
    // 文件桥的写侧状态：Agent 投了意图之后，靠这个字段确认有没有被处理
    bridge: intentStats(WORKBENCH),
    timezone: s.timezone,
    totals: s.totals,
    spending: s.spending,
    cards: s.cards.map((c) => ({
      id: c.id,
      kind: c.kind,
      state: c.state,
      rule: c.rule,
      title: c.title,
      text: c.text,
      options: c.options,
      recommend: c.recommend,
      createdAt: c.createdAt,
    })),
    agents: s.agents.map((a) => ({
      id: a.id,
      name: a.name,
      use: a.use,
      worker: a.worker,
      online: a.online,
      seenAt: a.seenAt,
      totals: a.totals,
    })),
    channels: s.channels.map((c) => ({ id: c.id, name: c.name, online: c.online, seenAt: c.seenAt })),
    sources: s.sources,
    lines: s.lines.map((l) => ({
      id: l.id,
      name: l.name,
      group: l.group,
      agent: l.agent,
      source: l.source,
      types: l.types,
      every: l.every,
      next: l.next,
      totals: l.totals,
    })),
    runs: s.runs.slice(0, 20).map(trimRun),
  };
}

function writeState(s) {
  mkdirSync(WORKBENCH, { recursive: true });
  const body = JSON.stringify(project(s), null, 2) + "\n";
  const tmp = path.join(WORKBENCH, "state.json.tmp");
  const out = path.join(WORKBENCH, "state.json");
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, out);
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > MAX_STATE_BYTES) console.warn(`state.json ${bytes}B 超过 ${MAX_STATE_BYTES}B，Agent 读取成本变高`);

  // 同一次投影里把说明文件也重写：能力+状态永远对齐
  const docTmp = path.join(WORKBENCH, "AGENTS.md.tmp");
  const doc = path.join(WORKBENCH, "AGENTS.md");
  writeFileSync(docTmp, renderAgentsDoc(s, { rev: lastSeq, hub: HUB, workbench: WORKBENCH }), "utf8");
  renameSync(docTmp, doc);

  return bytes;
}

async function hubState() {
  const r = await fetch(`${HUB}/v1/state`, { headers: HUB_AUTH });
  if (!r.ok) throw new Error(`hub ${r.status}`);
  const s = await r.json();
  try {
    writeState(s);
  } catch (e) {
    console.warn("state.json 投影失败：", e.message);
  }
  return s;
}

// 读一段有界事实：给首屏时间线用。硬性超时 + 条数上限，绝不无限读。
async function recentFacts(limit = 40, budgetMs = 800) {
  const after = lastSeq > 5000 ? Math.max(0, lastSeq - 200) : 0;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), budgetMs);
  const out = [];
  try {
    const r = await fetch(`${HUB}/v1/stream?after=${after}`, { headers: HUB_AUTH, signal: ac.signal });
    if (!r.ok) throw new Error(`hub ${r.status}`);
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const m = /data:\s*(\{[\s\S]*\})/.exec(block);
        if (m) {
          try {
            out.push(JSON.parse(m[1]));
          } catch {
            /* 坏帧跳过 */
          }
        }
        if (out.length >= limit) {
          ac.abort();
          return out;
        }
      }
    }
  } catch {
    /* 超时或断开都正常返回已读到的部分 */
  } finally {
    clearTimeout(t);
    ac.abort();
  }
  return out;
}

// ---- 常驻订阅：让 state.json 永远是新的（不依赖有没有人开浏览器）----------
let projectTimer = null;
function scheduleProject() {
  if (projectTimer) return;
  projectTimer = setTimeout(async () => {
    projectTimer = null;
    try {
      await hubState();
    } catch (e) {
      console.warn(`state.json 投影失败：${e.message}`);
    }
  }, 300);
}

async function watch() {
  for (;;) {
    try {
      const r = await fetch(`${HUB}/v1/stream?after=${lastSeq}`, { headers: HUB_AUTH });
      if (!r.ok) throw new Error(`hub ${r.status}`);
      const dec = new TextDecoder();
      let buf = "";
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const m = /^id:\s*(\d+)/m.exec(block);
          if (m) lastSeq = Math.max(lastSeq, Number(m[1]));
          scheduleProject();
        }
      }
    } catch {
      /* 中台没起来或断开：退避后重连 */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// ---- 一轮的原始输出（worker 把 Agent 的 stdout 落盘，这里只读它的尾巴）------
const RUNS_DIR = path.join(homedir(), ".agent-autoloop", "worker", "runs");

function tailOf(file, maxBytes) {
  let st;
  try {
    st = statSync(file);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const size = st.size;
  if (size <= maxBytes) return { text: readFileSync(file, "utf8"), truncated: false, size };
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    readSync(fd, buf, 0, maxBytes, size - maxBytes);
    // 从中间切可能劈开一个多字节字符，丢掉开头的替换符
    return { text: buf.toString("utf8").replace(/^\uFFFD+/, ""), truncated: true, size };
  } finally {
    closeSync(fd);
  }
}

/** runId 只接受数字；目录名由我们拼，绝不接受客户端传路径。 */
function runOutput(runId, maxBytes = 32 * 1024) {
  if (!existsSync(RUNS_DIR)) return { found: false, reason: "还没有任何轮次" };
  const dirs = readdirSync(RUNS_DIR).filter((n) => new RegExp(`^${runId}-\\d+$`).test(n));
  if (!dirs.length) return { found: false, reason: "这一轮没有输出目录" };
  dirs.sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]));
  const dir = path.join(RUNS_DIR, dirs.at(-1));

  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return { found: false, reason: "目录读不到" };
  }
  const outs = names
    .filter((n) => /^stdout-\d+\.log$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (!outs.length) return { found: false, dir: dirs.at(-1), reason: "还没开始写输出" };
  const turn = outs.at(-1).match(/\d+/)[0];
  const out = tailOf(path.join(dir, `stdout-${turn}.log`), maxBytes);
  const err = tailOf(path.join(dir, `stderr-${turn}.log`), 8 * 1024);
  let exit = null;
  try {
    exit = readFileSync(path.join(dir, `exit-${turn}`), "utf8").trim();
  } catch {
    /* 还在跑，没有退出码 */
  }
  return {
    found: true,
    dir: dirs.at(-1),
    turn: Number(turn),
    exit,
    stdout: out,
    stderr: err && err.size > 0 ? err : null,
    at: Date.now(),
  };
}

// ---- 写路径（只有两条：回答卡片、停止一轮）---------------------------------
function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** CSRF：SameSite=Strict 之外再要一个自定义头——跨站表单带不了自定义头。 */
function writeAllowed(req, res) {
  if (req.headers["x-wb"] === "1") return true;
  send(res, 403, { error: "缺少 X-WB 头" });
  return false;
}

async function jsonBody(req, res) {
  try {
    return JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { error: "body 不是 JSON" });
    return null;
  }
}

async function answerCard(req, res) {
  if (!writeAllowed(req, res)) return;
  const input = await jsonBody(req, res);
  if (!input) return;
  const cardId = Number(input?.cardId);
  if (!Number.isInteger(cardId) || cardId <= 0) return send(res, 400, { error: "cardId 不对" });
  const payload = {};
  if (input.choice !== undefined) {
    const choice = Number(input.choice);
    if (!Number.isInteger(choice) || choice < 0) return send(res, 400, { error: "choice 不对" });
    payload.choice = choice;
  } else if (typeof input.text === "string" && input.text.trim()) {
    payload.text = input.text.trim().slice(0, 4000);
  } else {
    return send(res, 400, { error: "要么 choice 要么 text" });
  }
  const r = await fetch(`${HUB}/v1/cards/${cardId}/answer`, {
    method: "POST",
    headers: { ...HUB_AUTH, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await r.json().catch(() => ({ ok: r.ok }));
  console.log(`回答卡片 #${cardId} → ${r.status}`);
  return send(res, r.ok ? 200 : r.status, body);
}

async function stopRun(req, res) {
  if (!writeAllowed(req, res)) return;
  const input = await jsonBody(req, res);
  if (!input) return;
  const runId = Number(input?.runId);
  if (!Number.isInteger(runId) || runId <= 0) return send(res, 400, { error: "runId 不对" });
  const r = await fetch(`${HUB}/v1/runs/${runId}/cancel`, {
    method: "POST",
    headers: { ...HUB_AUTH, "content-type": "application/json" },
    body: "{}",
  });
  const body = await r.json().catch(() => ({ ok: r.ok }));
  console.log(`停止第 ${runId} 轮 → ${r.status}`);
  return send(res, r.ok ? 200 : r.status, body);
}

// ---- 工具 ------------------------------------------------------------------
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
};

function cookies(req) {
  const raw = req.headers.cookie ?? "";
  return new Map(
    raw
      .split(";")
      .map((p) => p.trim().split("="))
      .filter((p) => p.length === 2),
  );
}
const authed = (req) => cookies(req).get(COOKIE) === SESSION;

function send(res, status, body, type = "application/json; charset=utf-8", extra = {}) {
  const buf = Buffer.isBuffer(body)
    ? body
    : typeof body === "string"
      ? Buffer.from(body, "utf8")
      : Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, { "content-type": type, "content-length": buf.length, "cache-control": "no-store", ...extra });
  res.end(buf);
}

function staticFile(res, name) {
  const file = path.join(PUBLIC, name);
  if (!file.startsWith(PUBLIC + path.sep) || !existsSync(file)) return send(res, 404, { error: "没有这个文件" });
  const ext = path.extname(file);
  send(res, 200, readFileSync(file), TYPES[ext] ?? "application/octet-stream");
}

const denied = (res) =>
  send(
    res,
    401,
    `<!doctype html><meta charset="utf-8"><title>需要配对</title>
<body style="font:14px/1.7 system-ui;background:#0b0f14;color:#d7e2ee;padding:40px">
<h1 style="font-size:18px">请在启动控制台的终端里打开那个带 ?k= 的链接</h1>
<p style="color:#7d8ea1">这个页面只对本机、且只在持有启动令牌时开放。令牌每次启动都会换。</p>`,
    "text/html; charset=utf-8",
  );

// ---- 登录页 ----------------------------------------------------------------
const loginPage = (msg) => `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0a0e13">
<title>工作台 · 登录</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0e13;color:#dbe6f2;
       font:15px/1.6 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;padding:24px}
  form{width:min(360px,100%);background:#0f1620;border:1px solid #1d2836;border-radius:12px;padding:22px}
  h1{margin:0 0 4px;font-size:17px}
  p{margin:0 0 16px;color:#7f92a8;font-size:13px}
  input{width:100%;box-sizing:border-box;padding:12px 13px;border-radius:9px;border:1px solid #1d2836;
        background:#0b1219;color:#dbe6f2;font:inherit;letter-spacing:.04em}
  input:focus{outline:none;border-color:#2b4a63}
  button{width:100%;margin-top:12px;padding:12px;border-radius:9px;border:1px solid #2b4a63;
         background:#16232f;color:#dbe6f2;font:inherit;font-weight:600}
  .msg{margin-top:12px;color:#ff9d9d;font-size:13px}
</style>
<form method="post" action="/login">
  <h1>工作台</h1>
  <p>输入口令进去。口令在起控制台的那个窗口里。</p>
  <input name="code" type="password" inputmode="text" autocomplete="current-password"
         autofocus autocapitalize="off" spellcheck="false" placeholder="口令">
  <button type="submit">进去</button>
  ${msg ? `<div class="msg">${msg}</div>` : ""}
</form>`;

async function handleLogin(req, res) {
  const ip = clientIp(req);
  if (locked(ip)) return send(res, 429, loginPage("试太多次了，等 5 分钟再试。"), "text/html; charset=utf-8");
  let code = "";
  try {
    const raw = await readBody(req, 2048);
    if (raw.trim().startsWith("{")) code = String(JSON.parse(raw).code ?? "");
    else code = new URLSearchParams(raw).get("code") ?? "";
  } catch {
    /* 空 body 当口令错处理 */
  }
  code = code.trim();
  if (!code || !same(code, PASSCODE)) {
    noteFail(ip);
    console.log(`登录失败：${ip}`);
    return send(res, 401, loginPage("口令不对。"), "text/html; charset=utf-8");
  }
  attempts.delete(ip);
  console.log(`登录成功：${ip}`);
  res.writeHead(303, { location: "/", "set-cookie": cookieHeader(req), "cache-control": "no-store" });
  res.end();
}

// ---- 编排：员工、图、运行 ---------------------------------------------------
const store = createStore(ROOT);
const REPO_DIR = path.join(ROOT, "agent-autoloop-wb-dsh");
const SOURCE_KEY = cfg.source?.key ?? "";

async function workflowSnapshot() {
  const runs = store.listRuns(8);
  return {
    backends: backendsInfo(),
    roles: ROLES,
    employees: store.employees(),
    graphs: store.listGraphs().map((g) => ({
      id: g.id,
      name: g.name,
      briefLength: (g.brief ?? "").length,
      updatedAt: g.updatedAt,
      nodes: (g.nodes ?? []).length,
      edges: (g.edges ?? []).length,
    })),
    runs,
    active: runs.find((r) => r.state === "running" || r.state === "failed") ?? runs[0] ?? null,
  };
}

async function workflowWrite(p, req, res) {
  return handleWorkflowWrite(
    { store, send, jsonBody, ensureRulesFor, handleDirectives, startGraphRun, startChatRun, ROOT, HUB, HUB_AUTH, SOURCE_KEY },
    p,
    req,
    res,
  );
}

/** 确保用到的后端都有「手动 · X」规则（没有就补，失败抛错） */
function ensureRulesFor(backends) {
  const used = [...new Set(backends.filter(Boolean))];
  if (!used.length) return { added: [] };
  const r = syncManualRules({ backends: used, workspace: ROOT, repoDir: REPO_DIR, log: (m) => console.log(m) });
  if (r.error) throw new Error(r.error);
  return { added: r.added };
}

/**
 * 负责人说完话之后：它的输出里可能带指令块。
 * 派活和写工作状态直接执行；招人/改人进提案队列，等人批准。
 */
function handleDirectives(graphId, run) {
  const g0 = graphId ? store.getGraph(graphId) : null;
  if (!g0) return;
  const employees = store.employees();
  const g = { ...g0, proposals: [...(g0.proposals ?? [])] };
  let dirty = false;

  for (const rec of run.nodes ?? []) {
    if (rec.type !== "agent" || rec.state !== "done") continue;
    let text = "";
    try {
      text = readFileSync(rec.file, "utf8");
    } catch {
      continue;
    }
    const d = parseDirectives(text);

    if (d.brief.length) {
      g.brief = [g.brief, ...d.brief].filter(Boolean).join("\n\n").slice(0, 4000);
      dirty = true;
      console.log(`负责人往工作状态写了 ${d.brief.length} 段`);
    }

    if (d.hire.length || d.edit.length) {
      const add = [
        ...d.hire.map((h) => ({ kind: "hire", ...h })),
        ...d.edit.map((e) => ({ kind: "edit", ...e })),
      ].map((p) => ({
        id: "p-" + Math.random().toString(36).slice(2, 8),
        ...p,
        from: run.id,
        at: new Date().toISOString(),
      }));
      g.proposals.push(...add);
      dirty = true;
      console.log(`负责人提了 ${add.length} 个招人/改人提案，等批准`);
    }

    // 派活：每个 ASSIGN 起一个独立的小 run（可以并行）
    for (const a of d.assign) {
      const emp = employees.find((e) => e.name === a.to);
      if (!emp) {
        console.warn(`负责人点名了不存在的员工：${a.to}`);
        continue;
      }
      try {
        ensureRulesFor([emp.backend]);
        const mini = {
          id: "",
          name: `↳ ${a.to} 的活`,
          brief: g.brief ?? "",
          nodes: [
            { id: "in", type: "input", x: 0, y: 0, text: a.task },
            { id: "w", type: "agent", x: 0, y: 0, employee: emp.id, text: a.task },
          ],
          edges: [{ from: "in", to: "w" }],
        };
        startGraphRun({
          store,
          workspace: ROOT,
          hub: HUB,
          auth: HUB_AUTH,
          sourceKey: SOURCE_KEY,
          graph: mini,
          employees,
          resources: [],
        });
        console.log(`负责人派活给 ${a.to}`);
      } catch (e) {
        console.warn("派活失败:", e.message);
      }
    }
  }

  if (dirty) {
    g.proposals = g.proposals.slice(-50);
    store.saveGraph(g);
  }
}

// ---- 服务 ------------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  if (p === "/healthz") return send(res, 200, { ok: true, hub: HUB, rev: lastSeq });

  // 配对：带 ?k=<session> 进入，换成 HttpOnly cookie（本机用；公网用 /login）
  if (p === "/" && url.searchParams.get("k") === SESSION) {
    res.writeHead(302, { location: "/", "set-cookie": cookieHeader(req), "cache-control": "no-store" });
    return res.end();
  }

  if (p === "/login") {
    if (req.method === "POST") return handleLogin(req, res);
    return send(res, 200, loginPage(""), "text/html; charset=utf-8");
  }

  if (!authed(req)) {
    if (p === "/" || p === "/index.html") {
      return PASSCODE
        ? send(res, 200, loginPage(""), "text/html; charset=utf-8")
        : denied(res);
    }
    return send(res, 401, { error: "需要登录" });
  }

  try {
    // 写接口白名单：不在这个表里的一律 405（先卡方法，再匹配路径）。
    const WRITE_ROUTES = new Set([
      "/api/answer",
      "/api/stop",
      "/api/workflow/employee",
      "/api/workflow/backend",
      "/api/workflow/graph",
      "/api/workflow/file",
      "/api/workflow/proposal",
      "/api/workflow/chat",
      "/api/workflow/run",
      "/api/workflow/stop",
      "/api/workflow/confirm",
    ]);
    if (p.startsWith("/api/") && req.method !== "GET" && !WRITE_ROUTES.has(p)) {
      return send(res, 405, { error: "这个写接口不存在" });
    }
    if (req.method === "POST" && WRITE_ROUTES.has(p)) {
      if (!writeAllowed(req, res)) return;
      if (p === "/api/answer") return await answerCard(req, res);
      if (p === "/api/stop") return await stopRun(req, res);
      return await workflowWrite(p, req, res);
    }

    if (p === "/api/workflow") return send(res, 200, await workflowSnapshot());

    // 读整张图（列表里只放摘要，避免每 2 秒轮询都把图传一遍）
    if (p === "/api/workflow/graph") {
      const g = store.getGraph(String(url.searchParams.get("id") ?? ""));
      if (!g) return send(res, 404, { error: "没有这个项目" });
      return send(res, 200, { ...g, files: store.listBriefFiles(g.id).map((f) => ({ name: f.name, size: f.size })) });
    }

    // 读某次运行里某个节点的产出（路径只从运行记录里取，不接受客户端拼路径）
    if (p === "/api/workflow/nodefile") {
      const run = store.getRun(String(url.searchParams.get("run") ?? ""));
      if (!run) return send(res, 404, { error: "没有这次运行" });
      const node = (run.nodes ?? []).find((n) => n.id === url.searchParams.get("node"));
      if (!node) return send(res, 404, { error: "没有这个节点" });
      let text = "";
      try {
        text = readFileSync(node.file, "utf8");
      } catch {
        return send(res, 200, { text: "", missing: true });
      }
      return send(res, 200, { text: text.slice(0, 100_000), file: path.basename(node.file) });
    }

    const STATIC = {
      "/": "index.html",
      "/index.html": "index.html",
      "/app.js": "app.js",
      "/workflow.js": "workflow.js",
      "/chat.js": "chat.js",
      "/style.css": "style.css",
      "/manifest.webmanifest": "manifest.webmanifest",
      "/sw.js": "sw.js",
      "/icon-192.png": "icon-192.png",
      "/icon-512.png": "icon-512.png",
    };
    if (STATIC[p]) return staticFile(res, STATIC[p]);

    if (p === "/api/state") {
      const s = await hubState();
      return send(res, 200, s);
    }

    if (p === "/api/recent") {
      const n = Math.min(200, Math.max(1, Number(url.searchParams.get("n") ?? 40) || 40));
      return send(res, 200, await recentFacts(n));
    }

    const out = /^\/api\/output\/(\d+)$/.exec(p);
    if (out) return send(res, 200, runOutput(Number(out[1])));

    // 文件桥的观察窗：待处理条数 + 最近回执（只读，不改任何东西）
    if (p === "/api/intents") {
      const d = intentDirs(WORKBENCH);
      let pending = 0;
      try {
        pending = readdirSync(d.intents).filter((n) => n.endsWith(".json")).length;
      } catch {}
      let receipts = [];
      try {
        receipts = readFileSync(path.join(d.intents, "receipts.ndjson"), "utf8")
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(-20)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return { raw: line.slice(0, 120) };
            }
          })
          .reverse();
      } catch {}
      return send(res, 200, { pending, receipts });
    }

    const why = /^\/api\/why\/(\d+)$/.exec(p);
    if (why) {
      const r = await fetch(`${HUB}/v1/runs/${why[1]}/why`, { headers: HUB_AUTH });
      if (!r.ok) return send(res, r.status, { error: `hub ${r.status}` });
      return send(res, 200, await r.json());
    }

    if (p === "/api/stream") {
      const after = req.headers["last-event-id"] ?? url.searchParams.get("after") ?? String(lastSeq);
      // 先握手、再连上游：上游在没有新事实时不会 flush 响应头，等它就等于让客户端干等。
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
        connection: "keep-alive",
      });
      res.write(`: connected ${lastSeq}\n\n`);
      const hb = setInterval(() => {
        try {
          res.write(": hb\n\n");
        } catch {
          clearInterval(hb);
        }
      }, 20000);
      const ac = new AbortController();
      req.on("close", () => {
        ac.abort();
        clearInterval(hb);
      });
      try {
        const upstream = await fetch(`${HUB}/v1/stream?after=${encodeURIComponent(after)}`, {
          headers: HUB_AUTH,
          signal: ac.signal,
        });
        if (!upstream.ok) {
          res.write(`: error hub ${upstream.status}\n\n`);
          res.end();
          return;
        }
        const dec = new TextDecoder();
        let buf = "";
        for await (const chunk of upstream.body) {
          res.write(chunk);
          buf += dec.decode(chunk, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            const m = /^id:\s*(\d+)/.exec(line);
            if (m) lastSeq = Number(m[1]);
          }
        }
      } catch {
        /* 客户端断开或 hub 关闭 */
      }
      clearInterval(hb);
      res.end();
      return;
    }

    if (req.method !== "GET") return send(res, 405, { error: "阶段 1 只读：没有写接口" });
    return send(res, 404, { error: "没有这个地址" });
  } catch (e) {
    return send(res, 502, { error: `中台连不上：${e.message}` });
  }
}

// Tailscale 在 CGNAT 段 100.64.0.0/10 上给设备分地址。找到它就顺手监听，
// 这样手机上用 http://100.x.x.x:51425 就能进（鸿蒙 NEXT 的客户端不支持 MagicDNS，
// 只能走 IP）。局域网其它地址一概不监听。
function tailnetAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const [x, y] = a.address.split(".").map(Number);
      if (x === 100 && y >= 64 && y <= 127) out.push(a.address);
    }
  }
  return [...new Set(out)];
}

/** 私有网段地址：10/8、172.16/12、192.168/16。只在 WB_BIND=lan 时用。 */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const [x, y] = a.address.split(".").map(Number);
      if (x === 10) out.push(a.address);
      else if (x === 172 && y >= 16 && y <= 31) out.push(a.address);
      else if (x === 192 && y === 168) out.push(a.address);
    }
  }
  return [...new Set(out)];
}

function bindTargets() {
  if (BIND === "0.0.0.0") return ["0.0.0.0"];
  const extra = BIND === "auto" ? tailnetAddresses() : BIND === "lan" ? lanAddresses() : [BIND];
  // 回环永远留着：桌面浏览器一直用它。
  return [...new Set(["127.0.0.1", ...extra])];
}

const targets = bindTargets();
await Promise.all(
  targets.map(
    (host) =>
      new Promise((resolve) => {
        const s = createServer(handle);
        s.once("error", (e) => {
          console.error(`监听 ${host}:${PORT} 失败：${e.code ?? e.message}`);
          resolve();
        });
        s.listen(PORT, host, () => resolve());
      }),
  ),
);

console.log("工作台控制台：");
for (const host of targets) console.log(`  http://${host}:${PORT}/?k=${SESSION}`);
if (targets.length > 1) {
  console.log("  第一行给本机浏览器用；其余地址给手机（同一私有网里才可达）。");
}
console.log(`口令 ${PASSCODE}${passGenerated ? "（新生成，存在 console/.passcode）" : ""}`);
if (BIND === "auto" && targets.length === 1) {
  console.log("  没找到 Tailscale 地址；只监听回环。手机要走隧道或 WB_BIND=lan。");
}
console.log(`中台 ${HUB} · 工作区 ${ROOT}`);
ensureIntentDirs(WORKBENCH);
startIntentLoop({ hub: HUB, auth: HUB_AUTH, workbench: WORKBENCH, log: (m) => console.log(m) });
try {
  const s = await hubState();
  console.log(`已连上中台：${s.runs.length} 轮 / ${s.cards.length} 张待决卡片；state.json 已写到 ${path.join(WORKBENCH, "state.json")}`);
} catch (e) {
  console.warn(`中台暂时连不上（${e.message}）；页面会显示离线，中台起来后自动恢复。`);
}
watch();
