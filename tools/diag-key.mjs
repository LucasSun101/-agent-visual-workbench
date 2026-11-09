// 诊断：key 文件解析对不对 + 直接带环境变量跑一次 headless，看 key 能不能用。
// 全程不打印 key 内容，只打印长度/前缀。
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const KEY_FILE = path.join(homedir(), ".agent-autoloop", "secrets", "deepseek.key");
const PLACEHOLDER = "PASTE_YOUR_KEY_HERE";
const APP = (process.env.DSH_APP_DIR ?? path.join(process.env.LOCALAPPDATA ?? "", "Programs", "DeepSeek Harness"));
const EXE = path.join(APP, "DeepSeek Harness.exe");
const CLI = path.join(APP, "resources", "app.asar", "dsh", "node_modules", "@deepseek-ai", "dsh-desktop-host", "lib", "cli.js");

console.log("key 文件:", KEY_FILE, "存在:", existsSync(KEY_FILE));
const raw = existsSync(KEY_FILE) ? readFileSync(KEY_FILE, "utf8") : "";
console.log("  首字节 BOM:", raw.charCodeAt(0) === 0xfeff);
const lines = raw.split(/\r?\n/).map((s) => s.trim());
console.log("  行数:", lines.length);
const picked = lines.find((s) => s && !s.startsWith("#"));
console.log("  选中的非注释行长度:", picked?.length ?? 0);
console.log("  是否占位符:", picked?.includes(PLACEHOLDER) ?? null);
const key = picked && !picked.includes(PLACEHOLDER) ? picked : null;
console.log("  解析结果:", key ? `有 key（${key.length} 字符，前缀 ${key.slice(0, 3)}）` : "没有可用 key");

if (!key) {
  console.log("→ 先解决 key 文件，别往下测");
  process.exit(1);
}

// 直接带环境变量跑一次
const out = path.join(process.env.TEMP ?? ".", "dsh-key-diag.log");
const fd = openSync(out, "w");
spawnSync(EXE, ["--expose-internals", CLI, "--profile", "headless", "--json", "只回复两个字：可以"], {
  stdio: ["ignore", fd, fd],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", DEEPSEEK_API_KEY: key },
  timeout: 120_000,
  windowsHide: true,
});
closeSync(fd);

const text = readFileSync(out, "utf8");
let finalText = null;
let errMsg = null;
let model = null;
for (const line of text.split(/\r?\n/)) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  if (e?.type === "final") finalText = e.text;
  if (e?.type === "status" && e.phase === "turn_end" && e.reason?.kind === "error") errMsg = e.reason.error?.message;
  if (e?.type === "status" && e.model) model = e.model;
}
console.log("");
console.log("带 DEEPSEEK_API_KEY 环境变量跑一次：");
console.log("  final :", JSON.stringify(finalText));
console.log("  错误  :", errMsg ?? "(无)");
if (errMsg) console.log("  日志尾部:", text.split(/\r?\n/).slice(-4).join(" | ").slice(0, 300));
