// 查两轮对话是不是同一个 session（会话续用成没成）
import { readFileSync } from "node:fs";
import path from "node:path";

const WS = process.cwd();
const BASE = `http://127.0.0.1:${process.env.WB_PORT ?? 51425}`;
const cookie = `wb_session=${readFileSync(path.join(WS, "console", ".session"), "utf8").trim()}`;
const get = (p) => fetch(BASE + p, { headers: { cookie } }).then((r) => r.json());

const why = async (id) => {
  try {
    return await get("/api/why/" + id);
  } catch (e) {
    return { error: e.message };
  }
};

// 从任意嵌套结构里找 session 字段
function findSession(obj, depth = 0) {
  if (!obj || depth > 6) return null;
  if (typeof obj === "string") return null;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const f = findSession(v, depth + 1);
      if (f) return f;
    }
    return null;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (/^(session|resume)$/i.test(k) && typeof v === "string" && v.length > 8) return v;
  }
  for (const v of Object.values(obj)) {
    const f = findSession(v, depth + 1);
    if (f) return f;
  }
  return null;
}

for (const id of [30, 31]) {
  const d = await why(id);
  const sess = findSession(d);
  const rule = findSession({ x: d?.run?.rule }) ?? d?.run?.rule ?? "";
  console.log(`#${id}  rule=${rule || "?"}  session=${sess ?? "(没找到)"}`);
  if (!sess) console.log("   原始键:", Object.keys(d ?? {}).join(", "));
}

const a = findSession(await why(30));
const b = findSession(await why(31));
console.log("");
if (!a || !b) {
  console.log("✗ 至少一轮没拿到 session，无法判断");
  process.exit(2);
}
console.log(a === b ? "✓ 两轮共用同一个 session —— 会话续用生效" : "✗ 两轮 session 不同 —— 续用没生效");
console.log("  #30:", a);
console.log("  #31:", b);
process.exit(a === b ? 0 : 1);
