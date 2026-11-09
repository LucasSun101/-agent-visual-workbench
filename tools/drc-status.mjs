// dsh-remote 主机侧体检：只读 ~/.dsh/dsh-remote-control/status.json。
// 用法：node tools/drc-status.mjs
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const file = path.join(homedir(), ".dsh", "dsh-remote-control", "status.json");
let s;
try {
  s = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.log(`读不到 ${file}：${e.code ?? e.message}`);
  console.log("⇒ 插件没挂载。确认 profile 里有 @dsh-remote/plugin，并完全重启 Harness。");
  process.exit(0);
}

const d = s.diagnostics ?? {};
const t = d.transport ?? {};
const h = d.hostToken ?? {};
const pillOk = s.pill?.webServer && s.pill?.routes;

console.log(`中继      ${s.relay ?? "?"}${s.relayProblem ? `  ← ${s.relayProblem}` : ""}`);
console.log(`地址      ${s.serverUrl}  (v${s.version ?? "?"})`);
console.log(`连接      attempts ${t.connectAttempts ?? "?"} · connects ${t.connects ?? "?"} · disconnects ${t.disconnects ?? "?"}`);
console.log(`令牌      ${h.source ?? "?"} · claim ${h.claim ?? "?"} · self-heal ${h.heals ?? 0} 次 · 连续失败 ${h.healFailedInRow ?? 0}${h.healReason ? ` (${h.healReason})` : ""}`);
console.log(`pill      ${pillOk ? "已注册" : "未注册 ← 没有配对入口"}  载体 ${s.carrier ?? "?"}`);
console.log(`已配对    ${s.pairedClients ?? 0} 台 · 悬空配对 ${s.pendingPairs ?? 0}`);
if (s.problems?.length) console.log(`问题      ${JSON.stringify(s.problems)}`);
console.log(`更新于    ${s.updatedAt}`);
