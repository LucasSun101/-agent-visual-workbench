// 崩溃恢复测试用的慢速假 Agent：跑 25 秒才输出结果，模拟长任务。
// 用来验证：中台/接单程序被强杀后重启，能找回还在跑的 Agent 并完成这一轮。
import { readFileSync } from "node:fs";

const contextFile = process.env.AGENT_AUTOLOOP_CONTEXT;
let context = {};
try {
  context = JSON.parse(readFileSync(contextFile, "utf8"));
} catch {}
const isSlow = (context.events ?? []).some((e) => e.type && e.type.startsWith("slow"));

if (isSlow) {
  // 模拟一个会跑很久的活；中途进程被强杀也不影响它。
  const started = Date.now();
  while (Date.now() - started < 25000) {
    // 忙等 25 秒
  }
  console.log("慢速任务完成");
} else {
  console.log("没事可做：没有要处理的事件");
}
