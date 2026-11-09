// 发一个事件（不启动任何模型），用于验证状态/说明文件会跟着变。
// 用法: node tools/emit.mjs <type> [subject]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const cfg = JSON.parse(readFileSync(path.join(homedir(), ".agent-autoloop", "config.json"), "utf8"));
const type = process.argv[2] ?? "slow.start";
const subject = process.argv[3] ?? `#emit-${Date.now()}`;

const r = await fetch(`${String(cfg.url).replace(/\/+$/, "")}/v1/events`, {
  method: "POST",
  headers: { authorization: `Bearer ${cfg.source.key}`, "content-type": "application/json" },
  body: JSON.stringify({ id: `emit-${Date.now()}`, type, subject }),
});
console.log("发事件:", r.status, JSON.stringify(await r.json()));
