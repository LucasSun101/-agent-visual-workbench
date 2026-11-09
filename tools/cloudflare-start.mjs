// 固定地址启动器：cloudflared 隧道 + dsh web（信任栅栏与公开地址自动对齐固定域名）。
// 配置：tools/cloudflare.json  {"token":"eyJ...","hostname":"dsh.example.com","port":51426}
// 用法：node tools/cloudflare-start.mjs
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONF = path.join(HERE, "cloudflare.json");
const CF = path.join(HERE, "bin", "cloudflared.exe");
const DSH_CMD =
  process.env.DSH_CMD ??
  String.raw`${process.env.LOCALAPPDATA}\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(CONF)) {
  console.log("缺少配置文件：tools\\cloudflare.json");
  console.log('内容应当是这样（token 从 Cloudflare 隧道页面复制）：');
  console.log('  {"token":"eyJhIjoi...","hostname":"dsh.example.com","port":51426}');
  process.exit(1);
}
const conf = JSON.parse(readFileSync(CONF, "utf8"));
if (!conf.token || !/^ey[A-Za-z0-9_-]{20,}/.test(conf.token)) {
  console.log("cloudflare.json 里的 token 看着不对（应当以 ey 开头的一长串）");
  process.exit(1);
}
if (!conf.hostname || !conf.hostname.includes(".")) {
  console.log("cloudflare.json 里的 hostname 不对，应当形如 dsh.example.com");
  process.exit(1);
}
if (!existsSync(CF)) {
  console.log("找不到 cloudflared：", CF);
  console.log("先跑：node --use-system-ca tools\\get-cloudflared.mjs");
  process.exit(1);
}

const PORT = Number(conf.port ?? 51426);
const HOST = conf.hostname;

// 清端口（只动自己启动的进程）
function freePort(port) {
  const log = path.join(HERE, ".netstat.log");
  const fd = openSync(log, "w");
  try {
    spawnSync("netstat", ["-ano", "-p", "TCP"], { stdio: ["ignore", fd, fd], windowsHide: true });
  } finally {
    closeSync(fd);
  }
  const out = readFileSync(log, "utf8");
  for (const line of out.split(/\r?\n/)) {
    const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/);
    if (m && Number(m[1]) === port) {
      console.log(`端口 ${port} 被 PID ${m[2]} 占着，先停掉`);
      spawnSync("taskkill", ["/PID", m[2], "/T", "/F"], { stdio: "ignore", windowsHide: true });
    }
  }
}
freePort(PORT);
await sleep(600);

// ---- cloudflared ----
const cfLog = path.join(HERE, ".cloudflared.log");
const cfFd = openSync(cfLog, "w");
const cf = spawn(CF, ["tunnel", "--no-autoupdate", "run", "--token", conf.token], {
  stdio: ["ignore", cfFd, cfFd],
  windowsHide: true,
});
console.log("cloudflared 已启动，等它连上边缘…");

let up = false;
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  const t = existsSync(cfLog) ? readFileSync(cfLog, "utf8") : "";
  if (/Registered tunnel connection|Connection .* registered/i.test(t)) { up = true; break; }
  if (/error|failed|invalid|unauthorized/i.test(t) && i > 6) break;
}
const cfText = existsSync(cfLog) ? readFileSync(cfLog, "utf8") : "";
if (!up) {
  console.log("cloudflared 好像没连上。日志尾部：");
  console.log(cfText.split(/\r?\n/).slice(-12).join("\n"));
  try { cf.kill(); } catch {}
  process.exit(1);
}
console.log("✓ 隧道已注册");

// ---- dsh web ----
const webLog = path.join(HERE, ".dshweb.log");
const webFd = openSync(webLog, "w");
const web = spawn(
  "cmd.exe",
  ["/c", DSH_CMD, "web", "--port", String(PORT), "--no-open", "--trusted-host", HOST, "--public-url", `https://${HOST}`],
  { stdio: ["ignore", webFd, webFd], windowsHide: true },
);

let url = null;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  const t = existsSync(webLog) ? readFileSync(webLog, "utf8") : "";
  const m = t.match(/(https:\/\/\S+\?token=[A-Za-z0-9_-]+)/);
  if (m) { url = m[1]; break; }
}
if (!url) {
  console.log("dsh web 没起来。日志尾部：");
  console.log((existsSync(webLog) ? readFileSync(webLog, "utf8") : "").split(/\r?\n/).slice(-15).join("\n"));
  try { cf.kill(); } catch {}
  process.exit(1);
}

writeFileSync(path.join(HERE, "mobile-url.txt"), url + "\n", "utf8");
console.log("");
console.log("固定地址（第一次带 token，之后靠 cookie）：");
console.log("  " + url);
console.log("");
console.log("以后手机直接开 https://" + HOST + " 就行（cookie 还在的话不用带 token）。");
console.log("这个窗口别关。");

const bye = () => {
  try { web.kill(); } catch {}
  try { cf.kill(); } catch {}
  process.exit(0);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
cf.on("exit", () => { try { web.kill(); } catch {} });
web.on("exit", () => { try { cf.kill(); } catch {} });
