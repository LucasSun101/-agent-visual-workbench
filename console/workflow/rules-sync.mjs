// 把「手动派活」需要的规则合进 rules.json。
//
// 为什么需要它：内核只认「事件 → 规则 → Agent」，而控制台的即时编排要按需派活。
// 每个**后端 Agent** 一条通用规则，员工的身份（persona）随事件 detail 走，所以招多少人都不加规则。
//
// 安全要求：只增不改别人的规则；写前备份；写后跑 check；check 不过就回滚。
import { closeSync, existsSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";

export const MANUAL_PREFIX = "手动 · ";
export const manualEventType = (backend) => `manual.${backend}`;

export const MANUAL_PROMPT =
  "这一轮是人工在控制台里手动派活。先读资料文件（context.json）里的 detail 字段，" +
  "把它当作本次任务说明去执行。完成后在最后一条消息里写一行结论，不要附 agent-autoloop 回执。";

export const rulesPath = () => path.join(homedir(), ".agent-autoloop", "rules.json");

function readRules(file) {
  const raw = readFileSync(file, "utf8");
  return { raw, rules: JSON.parse(raw) };
}

function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const to = `${file}.bak-${stamp}`;
  writeFileSync(to, readFileSync(file), "utf8");
  // 只留最近 5 份
  const dir = path.dirname(file);
  const base = path.basename(file);
  const olds = readdirSync(dir)
    .filter((n) => n.startsWith(base + ".bak-"))
    .sort()
    .slice(0, -5);
  for (const n of olds) {
    try {
      rmSync(path.join(dir, n));
    } catch {}
  }
  return to;
}

/** 跑一次 agent-autoloop check（输出落文件，避免管道）。 */
function checkRules(repoDir, logFile) {
  const fd = openSync(logFile, "w");
  try {
    const r = spawnSync(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", "--experimental-sqlite", "bin/agent-autoloop.ts", "check"],
      { cwd: repoDir, stdio: ["ignore", fd, fd], timeout: 60_000, windowsHide: true },
    );
    return { ok: r.status === 0, out: readFileSync(logFile, "utf8").trim() };
  } finally {
    closeSync(fd);
  }
}

/**
 * 确保每个用到的后端都有「手动 · <backend>」规则。
 * @returns {{changed:boolean, added:string[], backup?:string, error?:string}}
 */
export function syncManualRules({ backends, workspace, repoDir, log = () => {} }) {
  const file = rulesPath();
  if (!existsSync(file)) return { changed: false, added: [], error: "找不到 rules.json" };

  const { rules } = readRules(file);
  const base = path.basename(file);
  const existing = new Set((rules.rules ?? []).map((r) => r.name));
  const missing = backends.filter((b) => (rules.agents ?? {})[b] && !existing.has(MANUAL_PREFIX + b));
  if (!missing.length) return { changed: false, added: [] };

  for (const backend of missing) {
    rules.rules.push({
      name: MANUAL_PREFIX + backend,
      when: { source: "local", types: [manualEventType(backend)] },
      to: backend,
      cwd: workspace,
      // 同一后端最多 2 轮并行：未来图里扇出时不用改规则
      parallel: 2,
      tell: "needed",
      prompt: MANUAL_PROMPT,
    });
  }

  const saved = backup(file);
  writeFileSync(file, JSON.stringify(rules, null, 2) + "\n", "utf8");

  const logFile = path.join(workspace, "workflow", ".check.log");
  const res = checkRules(repoDir, logFile);
  if (!res.ok) {
    // 回滚
    writeFileSync(file, readFileSync(saved), "utf8");
    const msg = `规则校验失败，已回滚：${res.out.split("\n").slice(-3).join(" ")}`;
    log(msg);
    return { changed: false, added: [], backup: saved, error: msg };
  }

  log(`已合入 ${missing.length} 条手动规则（备份 ${base}.bak-…）`);
  return { changed: true, added: missing.map((b) => MANUAL_PREFIX + b), backup: saved };
}

/**
 * 给某个后端设模型（写进 rules.agents[<后端>].model）。
 *
 * 为什么是"按后端"而不是"按员工"：手动派活是「一个后端一条规则」，
 * 规则只能指向一个 agent 配置，所以模型跟着后端走。员工换后端 = 换模型。
 *
 * 这个字段能到适配器：`query.ts` 组装 job 时是整对象展开，`worker.ts` 再取 `agent.model`
 * 放进 turn（2026-11-08 用诊断日志实测过）。传空字符串表示回到默认。
 */
export function setBackendModel({ backend, model, workspace, repoDir, log = () => {} }) {
  const file = rulesPath();
  if (!existsSync(file)) return { changed: false, error: "找不到 rules.json" };

  const { rules } = readRules(file);
  const agent = rules.agents?.[backend];
  if (!agent) return { changed: false, error: `本机没有 ${backend} 这个 agent` };

  const next = String(model ?? "").trim().slice(0, 80);
  if ((agent.model ?? "") === next) return { changed: false };

  if (next) agent.model = next;
  else delete agent.model;
  // 清掉早期临时方案留下的痕迹（那时候借 command 传模型）
  if (Array.isArray(agent.command) && agent.command.every((c) => String(c).startsWith("model="))) {
    delete agent.command;
  }

  const saved = backup(file);
  writeFileSync(file, JSON.stringify(rules, null, 2) + "\n", "utf8");

  const res = checkRules(repoDir, path.join(workspace, "workflow", ".check.log"));
  if (!res.ok) {
    writeFileSync(file, readFileSync(saved), "utf8");
    const msg = `规则校验失败，已回滚：${res.out.split("\n").slice(-3).join(" ")}`;
    log(msg);
    return { changed: false, error: msg };
  }

  log(`${backend} 的模型 → ${next || "默认"}`);
  return { changed: true, backup: saved };
}
