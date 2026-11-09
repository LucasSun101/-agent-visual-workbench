// 真模型并行扇出试水：一个输入 → 两个员工并行干不同的活 → 输出节点汇总。
// 任务刻意做小（一句话翻译 + 一个同义词），避免烧钱。
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const WS = process.cwd();
const BASE = `http://127.0.0.1:${process.env.WB_PORT ?? 51425}`;
const cookie = `wb_session=${readFileSync(path.join(WS, "console", ".session"), "utf8").trim()}`;
const H = { cookie, "content-type": "application/json", "x-wb": "1" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (p) => fetch(BASE + p, { headers: { cookie } }).then((r) => r.json());
const post = (p, b) =>
  fetch(BASE + p, { method: "POST", headers: H, body: JSON.stringify(b) }).then(async (r) => ({
    ok: r.ok,
    status: r.status,
    body: await r.json().catch(() => ({})),
  }));

const wf = await get("/api/workflow");
const byName = (n) => wf.employees.find((e) => e.name === n);
const A = byName("小D") ?? wf.employees[0];
const B = byName("小Q") ?? wf.employees[1] ?? wf.employees[0];
if (!A || !B) {
  console.log("没有可用的 ds 员工");
  process.exit(1);
}
console.log("用员工:", A.name, "和", B.name);
if (A.id === B.id) {
  console.log("！两个角色落到同一个员工上了，结果会看不出分工");
}

const graph = {
  version: 1,
  name: "真模型扇出试水",
  nodes: [
    {
      id: "in",
      type: "input",
      x: 40,
      y: 160,
      text: "素材一句话：「注意力是稀缺资源，所以编排比模型更重要。」",
    },
    {
      id: "trans",
      type: "agent",
      x: 300,
      y: 50,
      employee: A.id,
      text: "把素材翻译成地道英文。只输出译文，一行。",
    },
    {
      id: "syn",
      type: "agent",
      x: 300,
      y: 280,
      employee: B.id,
      text: "给素材里的「稀缺资源」找一个中文同义表达，并说明语感差异。两行以内。",
    },
    { id: "out", type: "output", x: 620, y: 160, text: "" },
  ],
  edges: [
    { from: "in", to: "trans" },
    { from: "in", to: "syn" },
    { from: "trans", to: "out" },
    { from: "syn", to: "out" },
  ],
};

const t0 = Date.now();
const started = await post("/api/workflow/run", { graph });
if (!started.ok) {
  console.log("跑不起来:", started.body);
  process.exit(1);
}
const runId = started.body.run.id;
console.log("开跑:", runId, "| 合入规则:", (started.body.rulesAdded ?? []).join("、") || "无");

// 每 5 秒报一次进度，看两路是不是同时在跑
let last = "";
for (let i = 0; i < 60; i++) {
  await sleep(5000);
  const snap = await get("/api/workflow");
  const run = snap.runs.find((r) => r.id === runId);
  const line = (run?.nodes ?? []).map((n) => `${n.id}:${n.state}`).join(" ");
  if (line !== last) {
    console.log(`  ${Math.round((Date.now() - t0) / 1000)}s  ${line}`);
    last = line;
  }
  if (run && run.state !== "running") break;
}

const elapsed = Math.round((Date.now() - t0) / 1000);
const snap = await get("/api/workflow");
const run = snap.runs.find((r) => r.id === runId);

console.log("\n=== 结果 ===");
console.log("总状态:", run.state, "· 总耗时:", elapsed + "s");

const agents = run.nodes.filter((n) => n.type === "agent");
const durs = agents.map((n) => Date.parse(n.finishedAt) - Date.parse(n.startedAt));
const starts = run.spans.map((s) => s.start);
const gap = Math.round(Math.abs(starts[0] - starts[1]) / 1000);
console.log(
  `两路开工相差 ${gap}s · 单路分别 ${durs.map((d) => Math.round(d / 1000) + "s").join(" / ")} · 相加 ${Math.round(durs.reduce((a, b) => a + b, 0) / 1000)}s`,
);
console.log(gap <= 5 ? "→ 确实同时开跑" : "→ 没有同时开跑！");

for (const id of ["trans", "syn", "out"]) {
  const f = path.join(WS, "workbench", "handoff", runId, `${id}.md`);
  console.log(`\n──── ${id}.md ────`);
  console.log(existsSync(f) ? readFileSync(f, "utf8").trim().slice(0, 600) : "(没有文件)");
}

const usage = await get("/api/state");
console.log(`\n今日累计: ${usage.totals?.tokens ?? "?"} Token · ${usage.totals?.runs ?? "?"} 轮`);
console.log("运行目录:", run.dir);
