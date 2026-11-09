// 一次性脚本：把 chat 那段从 workflow.js 里摘掉，换成对 chat.js 的接驳。
// 用行号切割，不手抄，避免抄错。
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const p = "console/public/workflow.js";
copyFileSync(p, "console/public/workflow.js.bak-chat");

const L = readFileSync(p, "utf8").split(/\r?\n/);
const start = 72; // 0-based：第 73 行「// ---------- 对话 ----------」
const end = 190; // 0-based：第 191 行（空行），保留 192 行的「项目资料」

// 确认切割点是对的
const head = L[start].trim();
const tail = L[end + 1]?.trim() ?? "";
if (!head.startsWith("// ---------- 对话")) throw new Error("起点不对: " + head);
if (!tail.startsWith("// ---------- 项目资料")) throw new Error("终点不对: " + tail);

const adapter = [
  "  // ---------- 对话（实现在 chat.js，状态全封在里面）----------",
  "  const chat = window.WBChat({",
  "    $: (id) => $(id),",
  "    esc: (s) => esc(s),",
  "    api: { get: (u) => api.get(u), post: (u, b) => api.post(u, b) },",
  "    toast: (t, bad) => toast(t, bad),",
  "    byId: (id) => byId(id),",
  "    employees: () => wf?.employees ?? [],",
  "    getGraph: () => graph,",
  "    saveProject: (quiet) => saveProject(quiet),",
  "    refreshFiles: () => refreshFiles(),",
  "    startPolling: () => startPolling(),",
  "  });",
  "  const { openChat, closeChat, sendChat, renderChat, refreshChat } = chat;",
  "",
];

const out = [...L.slice(0, start), ...adapter, ...L.slice(end + 1)];
writeFileSync(p, out.join("\n"), "utf8");
console.log(`workflow.js: ${L.length} 行 → ${out.length} 行（摘掉 ${end - start + 1} 行，加了 ${adapter.length} 行接驳）`);
