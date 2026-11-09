// 一次性脚本：把 workflowWrite 整块从 server.mjs 搬到 routes/workflow-write.mjs。
// 正文一行不改，只换签名 + 顶部把依赖解构出来；server.mjs 里留一个薄壳转发。
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";

const SRC = "console/server.mjs";
const DST = "console/routes/workflow-write.mjs";
const START = 548; // 0-based：第 549 行 async function workflowWrite
const END = 783; // 0-based：第 784 行（函数的收尾 }），含

copyFileSync(SRC, SRC + ".bak-routes");

const L = readFileSync(SRC, "utf8").split(/\r?\n/);
const first = L[START].trim();
const last = L[END].trim();
if (!first.startsWith("async function workflowWrite(")) throw new Error("起点不对: " + first);
if (last !== "}") throw new Error("终点不对: " + last);

// 正文：去掉签名行（第一行），其余原样
const body = L.slice(START + 1, END + 1);

const header = [
  "// 编排层的写接口：图 / 员工 / 资料 / 提案 / 运行 / 对话 / 停止 / 确认 / 节点产物。",
  "//",
  "// 从 server.mjs 整块搬出来（2026-11-08），正文保持原样，只是把外部依赖",
  "// 改成调用时注入——这样 server.mjs 只负责路由分发，不再塞业务。",
  "//",
  "// 依赖清单（少一个就会在运行时报 ReferenceError，加接口时注意）：",
  "//   store · send · jsonBody · ensureRulesFor · handleDirectives",
  "//   startGraphRun · startChatRun · ROOT · HUB · HUB_AUTH · SOURCE_KEY",
  'import { readFileSync } from "node:fs";',
  'import { startGraphRun, startChatRun } from "../workflow/runner.mjs";',
  "",
  "export async function handleWorkflowWrite(deps, p, req, res) {",
  "  const { store, send, jsonBody, ensureRulesFor, handleDirectives, ROOT, HUB, HUB_AUTH, SOURCE_KEY } = deps;",
  "",
];

mkdirSync("console/routes", { recursive: true });
writeFileSync(DST, [...header, ...body].join("\n") + "\n", "utf8");

// server.mjs：整块换成薄壳
const shell = [
  "async function workflowWrite(p, req, res) {",
  "  return handleWorkflowWrite(",
  "    { store, send, jsonBody, ensureRulesFor, handleDirectives, startGraphRun, startChatRun, ROOT, HUB, HUB_AUTH, SOURCE_KEY },",
  "    p,",
  "    req,",
  "    res,",
  "  );",
  "}",
];
const out = [...L.slice(0, START), ...shell, ...L.slice(END + 1)];

// 顶部加 import（放在 runner 的 import 后面）
const runnerImport = out.findIndex((l) => l.includes('from "./workflow/runner.mjs"'));
if (runnerImport < 0) throw new Error("没找到 runner 的 import");
out.splice(runnerImport + 1, 0, 'import { handleWorkflowWrite } from "./routes/workflow-write.mjs";');

writeFileSync(SRC, out.join("\n"), "utf8");
console.log(`server.mjs: ${L.length} 行 → ${out.length} 行（搬走 ${END - START + 1} 行，换成 ${shell.length} 行）`);
console.log(`新文件 ${DST}: ${header.length + body.length} 行`);
