// 演示「任意 Agent 只靠读文件就能接入」：只读 workbench/state.json，不连任何端口。
import { readFileSync } from "node:fs";

const s = JSON.parse(readFileSync("workbench/state.json", "utf8"));
const t = s.totals ?? {};
const mins = (iso) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
const lines = [];

lines.push(`工作台 ${s.schema} · rev ${s.rev} · ${new Date(s.generatedAt).toLocaleString("zh-CN", { hour12: false })}`);
lines.push(`在跑 ${t.running} · 排队 ${t.queued} · 重试 ${t.retrying} · 失联 ${t.unknown} · 等你 ${t.attention}`);

if (s.cards?.length) {
  lines.push("");
  lines.push("待你决定：");
  for (const c of s.cards) {
    const opts = c.options?.length ? `（${c.options.join(" / ")}）` : "";
    lines.push(`  #${c.id} [${c.kind === "ask" ? "提问" : "通知"}] ${c.title} · ${mins(c.createdAt)} 分钟前${opts}`);
  }
} else {
  lines.push("");
  lines.push("没有等你决定的事。");
}

lines.push("");
lines.push("最近几轮：");
for (const r of (s.runs ?? []).slice(0, 5)) {
  const err = r.error ? ` ⚠ ${r.error.slice(0, 40)}` : "";
  lines.push(`  #${r.id} ${r.state.padEnd(8)} ${r.rule} · ${(r.summary || "—").slice(0, 40)}${err}`);
}

console.log(lines.join("\n"));
