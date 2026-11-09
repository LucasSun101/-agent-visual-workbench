// 一键起「手机上的 DSH」：先建隧道拿到域名，再用这个域名启动 dsh web。
// 顺序不能反：--trusted-host 必须等于隧道域名，否则 /api 会被信任栅栏拒绝（界面能开、数据全空）。
//
// 实现注意：所有子进程都用「重定向到文件」而不是管道抓输出。
// 理由：受限环境里 Node 的 stdio:'pipe' 会因命名管道不可用而 EPERM；文件重定向两边都能跑。
//
// 用法：node tools/dsh-mobile.mjs
import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DSH_MOBILE_PORT ?? 51426);
const DSH_CMD =
  process.env.DSH_CMD ??
  String.raw`${process.env.LOCALAPPDATA}\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`;

const SSH_LOG = path.join(HERE, ".tunnel.log");
const WEB_LOG = path.join(HERE, ".dshweb.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 跑一个命令并把它的 stdout 落文件，避免管道。 */
function runToFile(cmd, args, file) {
  const fd = openSync(file, "w");
  try {
    spawnSync(cmd, args, { stdio: ["ignore", fd, fd], windowsHide: true });
  } finally {
    closeSync(fd);
  }
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function freePort(port) {
  const out = runToFile("netstat", ["-ano", "-p", "TCP"], path.join(HERE, ".netstat.log"));
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/);
    if (m && Number(m[1]) === port) pids.add(m[2]);
  }
  for (const pid of pids) {
    console.log(`端口 ${port} 被 PID ${pid} 占着，先停掉`);
    spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore", windowsHide: true });
  }
}

async function waitFor(file, pattern, label, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await sleep(400);
    if (!existsSync(file)) continue;
    const m = readFileSync(file, "utf8").match(pattern);
    if (m) return m;
  }
  throw new Error(`${timeoutMs / 1000} 秒内没等到${label}`);
}

freePort(PORT);
await sleep(600);

// ---- 隧道 ----
const sshFd = openSync(SSH_LOG, "w");
const ssh = spawn(
  "ssh",
  [
    "-T",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "UserKnownHostsFile=NUL",
    "-o", "ServerAliveInterval=20",
    "-o", "ServerAliveCountMax=3",
    "-o", "ExitOnForwardFailure=yes",
    "-R", `80:127.0.0.1:${PORT}`,
    "nokey@localhost.run",
  ],
  { stdio: ["ignore", sshFd, sshFd], windowsHide: true },
);

const hostMatch = await waitFor(SSH_LOG, /https:\/\/([a-z0-9]+\.lhr\.life)/i, "隧道域名", 40_000);
const host = hostMatch[1];
console.log(`隧道就绪：${host}`);

// ---- dsh web（用这个域名）----
const webFd = openSync(WEB_LOG, "w");
const web = spawn(
  "cmd.exe",
  ["/c", DSH_CMD, "web", "--port", String(PORT), "--no-open", "--trusted-host", host, "--public-url", `https://${host}`],
  { stdio: ["ignore", webFd, webFd], windowsHide: true },
);

const urlMatch = await waitFor(WEB_LOG, /(https:\/\/\S+\?token=[A-Za-z0-9_-]+)/, "dsh web 地址", 60_000);
const url = urlMatch[1];
writeFileSync(path.join(HERE, "mobile-url.txt"), url + "\n", "utf8");

console.log("");
console.log("手机上打开（已写入 tools/mobile-url.txt）：");
console.log("  " + url);
console.log("");
console.log("这个窗口别关：关掉 = 服务停 = 地址作废。");
console.log("免费隧道不保证固定域名，重开一次地址就变。");

const bye = () => {
  try { web.kill(); } catch {}
  try { ssh.kill(); } catch {}
  process.exit(0);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
web.on("exit", () => { try { ssh.kill(); } catch {} });
ssh.on("exit", () => { try { web.kill(); } catch {} });
