// 编排后端端到端：建员工 → 存图 → 运行 → 等两个节点跑完 → 核对交接文件与规则合入。
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const WS = process.cwd();
const BASE = `http://127.0.0.1:${process.env.WB_PORT ?? 51425}`;
const cookie = `wb_session=${readFileSync(path.join(WS, "console", ".session"), "utf8").trim()}`;
const H = { cookie, "content-type": "application/json", "x-wb": "1" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const get = (p) => fetch(BASE + p, { headers: { cookie } }).then((r) => r.json());
const post = (p, body) =>
  fetch(BASE + p, { method: "POST", headers: H, body: JSON.stringify(body) }).then(async (r) => ({
    status: r.status,
    body: await r.json().catch(() => ({})),
  }));

let ok = 0;
let bad = 0;
const check = (name, pass, extra = "") => {
  if (pass) ok++;
  else bad++;
  console.log(`${pass ? "✓" : "✗"} ${name}${extra ? " · " + extra : ""}`);
};

// 1. 现状
let wf = await get("/api/workflow");
check("/api/workflow 可用", Array.isArray(wf.employees) && Array.isArray(wf.graphs), `${wf.employees.length} 员工 / ${wf.graphs.length} 图`);
const seedEmployee = wf.employees[0];
console.log("  默认员工:", seedEmployee?.name, "→", seedEmployee?.backend);

// 2. 再招一个
const hired = await post("/api/workflow/employee", {
  name: "小Q",
  backend: "ds",
  persona: "你是质量检查员。只做复核和挑毛病，不写新功能。",
});
check("招员工成功", hired.status === 200 && hired.body.employee?.id, hired.body.employee?.name);

// 3. 存一张图：输入 → 小D → 小Q
const graph = {
  version: 1,
  name: "冒烟：写一句话再复核",
  nodes: [
    { id: "n1", type: "input", x: 60, y: 120, text: "用一句中文话介绍你自己，20 字以内。" },
    { id: "n2", type: "agent", x: 320, y: 120, employee: seedEmployee.id, text: "完成输入里的任务。" },
    { id: "n3", type: "agent", x: 580, y: 120, employee: hired.body.employee.id, text: "复核上一步的产出，指出有没有问题。" },
  ],
  edges: [
    { from: "n1", to: "n2" },
    { from: "n2", to: "n3" },
  ],
};
const saved = await post("/api/workflow/graph", { graph });
check("存图成功", saved.status === 200 && saved.body.graph?.id, saved.body.graph?.id);

// 4. 运行
const started = await post("/api/workflow/run", { graph });
check("启动运行", started.status === 200 && started.body.run?.id, JSON.stringify(started.body.rulesAdded ?? started.body.error));
const runId = started.body.run?.id;
if (!runId) {
  console.log("启动失败，后面没法测");
  process.exit(1);
}

// 5. 等它跑完（两个真实模型节点，给 6 分钟）
let run = null;
for (let i = 0; i < 120; i++) {
  await sleep(3000);
  const snap = await get("/api/workflow");
  run = snap.runs.find((r) => r.id === runId);
  if (run && run.state !== "running") break;
  if (i % 10 === 9) {
    const now = run?.nodes?.map((n) => `${n.id}:${n.state}`).join(" ");
    console.log(`  …${(i + 1) * 3}s  ${run?.state}  ${now}`);
  }
}

check("运行结束", Boolean(run) && run.state !== "running", `state=${run?.state}`);
for (const n of run?.nodes ?? []) {
  check(`节点 ${n.id} 完成`, n.state === "done", `${n.state} ${(n.summary || n.error || "").slice(0, 40)}`);
}

// 6. 交接文件
const dir = run?.dir;
const files = ["n1.md", "n2.md", "n3.md"].map((f) => path.join(dir ?? "", f));
for (const f of files) {
  const has = existsSync(f);
  check(`交接文件 ${path.basename(f)} 存在`, has, has ? readFileSync(f, "utf8").slice(0, 50).replace(/\n/g, " ") : "");
}

// 7. 规则合入 + 备份
const rulesFile = path.join(homedir(), ".agent-autoloop", "rules.json");
const rules = JSON.parse(readFileSync(rulesFile, "utf8"));
const manual = (rules.rules ?? []).filter((r) => r.name.startsWith("手动 · "));
check("rules.json 合入了手动规则", manual.length > 0, manual.map((r) => r.name).join(", "));
const dirHome = path.dirname(rulesFile);
const bak = (await import("node:fs")).readdirSync(dirHome).filter((n) => n.startsWith("rules.json.bak-"));
check("留下了备份", bak.length > 0, `${bak.length} 份`);

console.log(`\n${ok} 通过 · ${bad} 失败`);
console.log("运行目录:", dir);
process.exit(bad ? 1 : 0);
