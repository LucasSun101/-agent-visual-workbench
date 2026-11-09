// 会打进度行的慢 Agent：用来同时验证「准实时输出」和「停止按钮」。
// 每 2 秒打一行，共 30 秒。被杀时会立刻中断（输出被截断是预期行为）。
import { readFileSync } from "node:fs";

let context = {};
try {
  context = JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT, "utf8"));
} catch {}
const isSlow = (context.events ?? []).some((e) => e.type && (e.type.startsWith("slow") || e.type === "manual.slow"));

if (!isSlow) {
  console.log("没事可做：没有要处理的事件");
  process.exit(0);
}

const total = 30;
for (let i = 1; i <= total; i++) {
  const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  console.log(`[${String(i).padStart(2, "0")}/${total}] 正在干活…… ${stamp}`);
  const until = Date.now() + 2000;
  while (Date.now() < until) {
    /* 忙等，避免依赖定时器语义 */
  }
}
console.log("慢速任务完成");
