// 文件桥写侧端到端：投递合法意图让它真生效，再投 4 种非法意图确认被拒。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const WS = process.cwd();
const INTENTS = path.join(WS, "workbench", "intents");
mkdirSync(INTENTS, { recursive: true });

const cfg = JSON.parse(readFileSync(path.join(homedir(), ".agent-autoloop", "config.json"), "utf8"));
const HUB = String(cfg.url).replace(/\/+$/, "");
const CONSOLE = `http://127.0.0.1:${process.env.WB_PORT ?? 51425}`;
const cookie = `wb_session=${readFileSync(path.join(WS, "console", ".session"), "utf8").trim()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = (p) => fetch(CONSOLE + p, { headers: { cookie } }).then((r) => r.json());
const drop = (name, body) => {
  const file = path.join(INTENTS, name);
  writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body, null, 2), "utf8");
  return file;
};

let ok = 0;
let bad = 0;
const check = (name, pass, extra = "") => {
  if (pass) ok++;
  else bad++;
  console.log(`${pass ? "✓" : "✗"} ${name}${extra ? " · " + extra : ""}`);
};

// 1. 造一张待决卡片
const stamp = Date.now();
const emit = await fetch(`${HUB}/v1/events`, {
  method: "POST",
  headers: { authorization: `Bearer ${cfg.source.key}`, "content-type": "application/json" },
  body: JSON.stringify({ id: `intent-test-${stamp}`, type: "try.start", subject: `#intent-${stamp}` }),
});
console.log("发事件:", emit.status, JSON.stringify(await emit.json()));

let card = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const s = await api("/api/state");
  card = (s.cards ?? []).find((c) => c.title.startsWith("试跑"));
  if (card) break;
}
if (!card) {
  console.log("✗ 20 秒内没等到卡片，后面没法测");
  process.exit(1);
}
console.log(`✓ 卡片 #${card.id} 已生成（${card.options.join(" / ")}）`);

// 2. 投一个合法意图：选第 2 项
const validId = `itest-${stamp}`;
drop(`${validId}.json`, {
  id: validId,
  action: "answer",
  from: "test-agent",
  card: card.id,
  choice: 1,
});
console.log(`投递意图 ${validId}.json → answer card=${card.id} choice=1`);

// 3. 等它生效
let applied = false;
let latestRun = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const s = await api("/api/state");
  const stillOpen = (s.cards ?? []).some((c) => c.id === card.id);
  latestRun = (s.runs ?? [])[0];
  if (!stillOpen && latestRun && /你选了/.test(latestRun.summary ?? "")) {
    applied = true;
    break;
  }
}
check("意图生效：卡片关闭 + 新一轮跑完", applied, latestRun ? `#${latestRun.id} ${latestRun.summary}` : "没有新轮次");

// 4. 归档与回执
const doneFiles = existsSync(path.join(INTENTS, "done")) ? readdirSync(path.join(INTENTS, "done")) : [];
check("文件被移进 done/", doneFiles.some((f) => f.includes(validId)), `${doneFiles.length} 个归档`);

const intents = await api("/api/intents");
const r0 = (intents.receipts ?? [])[0];
check("回执记录了这次生效", r0 && r0.ok === true && r0.id === validId, JSON.stringify(r0 ?? {}));

// 5. 四种非法意图
drop("bad-json-1.json", "{ 这不是 JSON");
drop("id-mismatch-1.json", { id: "somethingelse", action: "answer", from: "x", card: card.id, choice: 0 });
drop("forbidden-1.json", { id: "forbidden-1", action: "answer", from: "x", card: card.id, choice: 0, agent: "evil" });
drop("ghost-card-1.json", { id: "ghost-card-1", action: "answer", from: "x", card: 999999, choice: 0 });

await sleep(9000);
const rejected = existsSync(path.join(INTENTS, "rejected")) ? readdirSync(path.join(INTENTS, "rejected")) : [];
for (const n of ["bad-json-1", "id-mismatch-1", "forbidden-1", "ghost-card-1"]) {
  check(`非法意图被拒：${n}`, rejected.some((f) => f.includes(n)));
}

const after = await api("/api/intents");
check("拒收也留了回执", (after.receipts ?? []).some((r) => r.ok === false));

console.log(`\n${ok} 通过 · ${bad} 失败`);
console.log("回执目录:", path.join(INTENTS, "receipts.ndjson"));
process.exit(bad ? 1 : 0);
