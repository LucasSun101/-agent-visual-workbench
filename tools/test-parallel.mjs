// 并行扇出验证：一个母节点连两个子节点，子节点应该同时开跑（而不是排队）。
// 用 slow 后端（固定 30 轮 × 2 秒 = 60 秒）来量：并行 ≈ 60s，串行 ≈ 120s，不花钱。
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

let ok = 0;
let bad = 0;
const check = (n, pass, extra = "") => {
  if (pass) ok++;
  else bad++;
  console.log(`${pass ? "✓" : "✗"} ${n}${extra ? " · " + extra : ""}`);
};

// 1. 招两个 slow 员工（不花钱，固定 30 秒）；已存在就复用，别把员工名额堆满
const existing = (await get("/api/workflow")).employees;
const ensure = async (name) => {
  const found = existing.find((e) => e.name === name);
  if (found) return { ok: true, body: { employee: found } };
  return post("/api/workflow/employee", { name, backend: "slow", persona: "跑 30 秒", defaultTask: `做 ${name} 的活` });
};
const a = await ensure("慢A");
const b = await ensure("慢B");
if (!a.ok || !b.ok) {
  console.log("招人失败", a.body, b.body);
  process.exit(1);
}
check("招了两个 slow 员工", true, `${a.body.employee.name} / ${b.body.employee.name}`);

// 2. 图：输入 →(扇出) A、B → 输出（合并）
const graph = {
  version: 1,
  name: "并行扇出测试",
  nodes: [
    { id: "in", type: "input", x: 40, y: 160, text: "同时做两件互不依赖的事" },
    { id: "A", type: "agent", x: 280, y: 60, employee: a.body.employee.id, text: "负责 A" },
    { id: "B", type: "agent", x: 280, y: 260, employee: b.body.employee.id, text: "负责 B" },
    { id: "out", type: "output", x: 560, y: 160, text: "" },
  ],
  edges: [
    { from: "in", to: "A" },
    { from: "in", to: "B" },
    { from: "A", to: "out" },
    { from: "B", to: "out" },
  ],
};

// 3. 运行
const t0 = Date.now();
const started = await post("/api/workflow/run", { graph });
if (!started.ok) {
  console.log("跑不起来:", started.body);
  process.exit(1);
}
const runId = started.body.run.id;
check("启动运行（扇出 2 路）", true, runId);

// 4. 等结束
let run = null;
for (let i = 0; i < 90; i++) {
  await sleep(2000);
  const snap = await get("/api/workflow");
  run = snap.runs.find((r) => r.id === runId);
  if (run && run.state !== "running") break;
}
const elapsed = Math.round((Date.now() - t0) / 1000);
check("运行结束", run && run.state === "done", `state=${run?.state} · ${elapsed}s`);

// 5. 真的并行吗：两路开工时刻相差应远小于 30 秒
const starts = (run.spans ?? []).map((s) => s.start).filter(Boolean);
check("抓到了两个执行区间", starts.length === 2, String(starts.length));
if (starts.length === 2) {
  const gap = Math.round(Math.abs(starts[0] - starts[1]) / 1000);
  check("两路几乎同时开工（不是排队）", gap <= 5, `相差 ${gap}s`);
  // 别假设单个 Agent 多久（这个慢 Agent 实际是 30 轮 × 2 秒 = 60 秒），
  // 直接拿"两路耗时相加"当串行基准比。
  const durs = run.nodes.filter((n) => n.type === "agent").map((n) => Date.parse(n.finishedAt) - Date.parse(n.startedAt));
  const sum = durs.reduce((a, b) => a + b, 0);
  check(
    "总耗时接近单路，而不是两路相加",
    elapsed < (sum / 1000) * 0.75,
    `${elapsed}s vs 串行约 ${Math.round(sum / 1000)}s（单路 ${Math.round(Math.min(...durs) / 1000)}s）`,
  );
}

// 6. 输出节点汇总
for (const n of run?.nodes ?? []) {
  check(`节点 ${n.id} 完成`, n.state === "done", n.state);
}
const outFile = path.join(WS, "workbench", "handoff", runId, "out.md");
check("输出节点生成了汇总文件", existsSync(outFile));
if (existsSync(outFile)) {
  const txt = readFileSync(outFile, "utf8");
  check("汇总里有两个上游", txt.includes("## A") && txt.includes("## B"), `${txt.length} 字节`);
}

console.log(`\n${ok} 通过 · ${bad} 失败`);
console.log("运行目录:", run?.dir);
process.exit(bad ? 1 : 0);
