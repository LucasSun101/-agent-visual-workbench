// 端到端验证「实时输出 + 停止」：
// 发一个 slow.start 事件 → 等它被领走 → 两次读输出看行数是否在增长 → 调 /api/stop → 等它变 cancelled。
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const cfg = JSON.parse(readFileSync(path.join(homedir(), ".agent-autoloop", "config.json"), "utf8"));
const HUB = String(cfg.url).replace(/\/+$/, "");
const CONSOLE = `http://127.0.0.1:${process.env.WB_PORT ?? 51425}`;
const cookie = `wb_session=${readFileSync(path.join(process.env.WB_WS ?? ".", "console", ".session"), "utf8").trim()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = (p) => fetch(CONSOLE + p, { headers: { cookie } }).then((r) => r.json());

// 1. 发事件
const id = `slow-${Date.now()}`;
const emit = await fetch(`${HUB}/v1/events`, {
  method: "POST",
  headers: { authorization: `Bearer ${cfg.source.key}`, "content-type": "application/json" },
  body: JSON.stringify({ id, type: "slow.start", subject: "#stop-test", summary: "测停止" }),
});
const routed = await emit.json();
console.log("发事件:", emit.status, JSON.stringify(routed));

// 2. 等它被领走
let run = null;
for (let i = 0; i < 30; i++) {
  await sleep(500);
  const s = await api("/api/state");
  run = (s.runs ?? []).find((r) => r.rule === "慢跑" && (r.state === "claimed" || r.state === "queued"));
  if (run && run.state === "claimed") break;
}
if (!run) {
  console.log("✗ 15 秒内没看到「慢跑」被领走");
  process.exit(1);
}
console.log(`✓ 第 ${run.id} 轮在跑（state=${run.state}）`);

// 3. 输出真的在长吗
const a = await api(`/api/output/${run.id}`);
await sleep(4200);
const b = await api(`/api/output/${run.id}`);
const lines = (o) => (o.stdout?.text ?? "").trim().split("\n").filter(Boolean).length;
console.log(`  输出行数：${lines(a)} → ${lines(b)}${lines(b) > lines(a) ? " ✓ 在增长" : " ✗ 没增长"}`);
if (lines(b) <= lines(a)) process.exit(1);
console.log(`  最后一行：${(b.stdout?.text ?? "").trim().split("\n").at(-1)}`);

// 4. 停
const stop = await fetch(`${CONSOLE}/api/stop`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json", "x-wb": "1" },
  body: JSON.stringify({ runId: run.id }),
});
console.log("停止请求:", stop.status, JSON.stringify(await stop.json().catch(() => ({}))));

// 5. 等它真的停
let final = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const s = await api("/api/state");
  final = (s.runs ?? []).find((r) => r.id === run.id);
  if (final && final.state !== "claimed") break;
}
const out = await api(`/api/output/${run.id}`);
console.log(`\n结果：state=${final?.state} · stopping=${final?.stopping} · exit=${out.exit ?? "无"} · 输出 ${lines(out)} 行`);
if (final?.state === "cancelled") {
  console.log("✓ 这一轮被真的停掉了");
} else {
  console.log("✗ 没停下，state=", final?.state);
  process.exit(1);
}
