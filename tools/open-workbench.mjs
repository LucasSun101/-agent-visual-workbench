// 双击入口：需要时才启动中台和控制台，然后把浏览器打开到控制台。
//
// 设计取舍：
//   · 不装开机自启 —— 只有你双击时才起
//   · 已经在跑就不重复起（先探端口）
//   · 子进程 detached + unref：这个启动器退出后它们继续活着
//   · 输出写日志文件而不是管道（受限环境下 spawn+pipe 会 EPERM）
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WS = path.resolve(HERE, "..");
const REPO = path.join(WS, "agent-autoloop-wb-dsh");
const NODE = process.execPath;
const HUB_PORT = 3350;
const WB_PORT = 51425;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (...a) => console.log(...a);

async function up(port, probePath = "/healthz") {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${probePath}`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

function spawnDetached(cmd, args, cwd, logFile) {
  const fd = openSync(logFile, "a");
  const child = spawn(cmd, args, {
    cwd,
    stdio: ["ignore", fd, fd],
    detached: true,
    windowsHide: true,
  });
  child.unref();
  closeSync(fd);
  return child;
}

function sessionToken() {
  try {
    return readFileSync(path.join(WS, "console", ".session"), "utf8").trim();
  } catch {
    return "";
  }
}

const hubOk = await up(HUB_PORT);
if (hubOk) {
  log("中台已在跑，跳过启动");
} else {
  log("启动中台…");
  spawnDetached(
    NODE,
    ["--disable-warning=ExperimentalWarning", "--experimental-sqlite", path.join(REPO, "bin", "agent-autoloop.ts"), "up"],
    REPO,
    path.join(HERE, ".hub.log"),
  );
}

const wbOk = await up(WB_PORT);
if (wbOk) {
  log("控制台已在跑，跳过启动");
} else {
  log("启动控制台…");
  spawnDetached(NODE, [path.join(WS, "console", "server.mjs")], WS, path.join(HERE, ".console.log"));
}

// 等两边都响应（最多 30 秒）
let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(500);
  if ((await up(HUB_PORT)) && (await up(WB_PORT))) {
    ready = true;
    break;
  }
}

const token = sessionToken();
const url = `http://127.0.0.1:${WB_PORT}/${token ? `?k=${token}` : ""}`;

if (!ready) {
  log("");
  log("有服务没起来。看一下日志：");
  log(`  中台   ${path.join(HERE, ".hub.log")}`);
  log(`  控制台 ${path.join(HERE, ".console.log")}`);
  log("");
  log(`也可以先手动开这个地址看看：${url}`);
  process.exitCode = 1;
} else {
  log("");
  log(`打开 ${url}`);
}

if (!process.env.WB_NO_OPEN) {
  // cmd /c start 是 Windows 上最可靠的开默认浏览器方式，且不等它退出
  spawnDetached("cmd.exe", ["/c", "start", "", url], WS, path.join(HERE, ".open.log"));
  await sleep(600);
}

if (ready) {
  log("");
  log("可以关掉这个窗口了，服务会在后台继续跑（关掉窗口不影响）。");
}
