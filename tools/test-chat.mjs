// 对话链路端到端：用 slow 后端跑一轮（60 秒、不花钱），验证
// 「发一句话 → 存用户消息 → 起一轮 run → 把回复写回对话」是通的。
import { readFileSync } from "node:fs";
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

const wf = await get("/api/workflow");
const slow = wf.employees.find((e) => e.backend === "slow");
if (!slow) {
  console.log("没有 slow 员工，先跑 test-parallel 建一个");
  process.exit(1);
}

// 建一个临时项目 + 一个绑 slow 员工的节点
const g = {
  id: "",
  name: "对话测试",
  brief: "这是对话测试项目。",
  nodes: [{ id: "lead", type: "agent", x: 200, y: 120, employee: slow.id, text: "" }],
  edges: [],
};
const saved = await post("/api/workflow/graph", { graph: g });
const gid = saved.body.graph?.id;
check("建测试项目", Boolean(gid), gid);

const sent = await post("/api/workflow/chat", { graphId: gid, nodeId: "lead", text: "你好，收到请回答。" });
check("发送成功", sent.ok, sent.body.error ?? "");

// 轮询看回复有没有写回来
let chats = null;
for (let i = 0; i < 40; i++) {
  await sleep(3000);
  const g2 = await get("/api/workflow/graph?id=" + gid);
  chats = (g2.chats ?? {})["lead"] ?? [];
  if (chats.length >= 2) break;
}
check("对话里有两句（我说的 + 它回的）", (chats?.length ?? 0) >= 2, `${chats?.length ?? 0} 条`);
check("我的那句被存下来", chats?.[0]?.role === "user" && chats[0].text.includes("收到请回答"));
check("它的回复非空", (chats?.[1]?.text ?? "").length > 0, (chats?.[1]?.text ?? "").slice(0, 40).replace(/\n/g, " "));
check("回复带上了 runId", Boolean(chats?.[1]?.runId));

// 清场
await post("/api/workflow/graph", { op: "delete", id: gid });
const wf2 = await get("/api/workflow");
check("清掉测试项目", !wf2.graphs.some((x) => x.id === gid));

console.log(`\n${ok} 通过 · ${bad} 失败`);
process.exit(bad ? 1 : 0);
