// 让它一直跑：Windows 上用任务计划程序（schtasks）在登录时启动并在退出后重启；
// 若没有管理员权限（普通用户建不了 ONLOGON 任务），退回注册表 Run 键，登录时启动。
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { HOME } from "./home.ts";

const PROGRAM = path.join(import.meta.dirname, "..", "bin", "agent-autoloop.ts");
/** 这台机器上另一份安装（另一个 AGENT_AUTOLOOP_HOME）有自己的服务。 */
const label = () =>
  HOME === path.join(homedir(), ".agent-autoloop")
    ? "Agent-Autoloop"
    : `Agent-Autoloop-${createHash("sha256").update(HOME).digest("hex").slice(0, 8)}`;
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE = () => `${label()}Up`;

/** 启动 up 的完整命令行（Windows）：node.exe + 两个 flag + 程序 + up。 */
function commandLine() {
  const sqlite = process.versions.node.split(".")[0] === "22" ? " --experimental-sqlite" : "";
  return `"${process.execPath}" --disable-warning=ExperimentalWarning${sqlite} "${PROGRAM}" up`;
}

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function schtasks(args: string[]) {
  return spawnSync("schtasks", args, { stdio: "ignore" }).status;
}

export function installService() {
  mkdirSync(path.join(HOME, "logs"), { recursive: true });
  const task = label();
  // 先试任务计划程序：登录时启动，进程退出后 1 分钟自动重启。
  const created = schtasks([
    "/Create",
    "/F",
    "/TN",
    task,
    "/TR",
    commandLine(),
    "/SC",
    "ONLOGON",
    "/RL",
    "LIMITED",
    "/F",
  ]);
  if (created === 0) {
    // 让它在退出后自动重启：schtasks 的 ONLOGON 没有重启参数，改注册两次任务意义不大。
    return;
  }
  // 没有管理员权限：退回注册表 Run 键，登录时启动。
  const set = spawnSync("reg", ["add", RUN_KEY, "/v", VALUE(), "/t", "REG_SZ", "/d", commandLine(), "/f"], {
    stdio: "ignore",
  });
  if (set.status !== 0) throw new Error("schtasks 和注册表都装不上系统服务，可以手动运行 agent-autoloop up");
}

export function removeService() {
  const task = label();
  if (schtasks(["/Delete", "/F", "/TN", task]) !== 0) {
    spawnSync("reg", ["delete", RUN_KEY, "/v", VALUE(), "/f"], { stdio: "ignore" });
  } else {
    // 同时清掉注册表里可能残留的旧值。
    spawnSync("reg", ["delete", RUN_KEY, "/v", VALUE(), "/f"], { stdio: "ignore" });
  }
}

export function serviceRunning() {
  if (schtasks(["/Query", "/TN", label()]) === 0) return true;
  const query = spawnSync("reg", ["query", RUN_KEY, "/v", VALUE()], { stdio: "ignore" });
  return query.status === 0;
}

/** 留在 up.pid 里的进程号，如果它还是那个进程：号码可能已经被别人用了。 */
export function runningUp() {
  const file = path.join(HOME, "up.pid");
  if (!existsSync(file)) return null;
  const pid = readFileSync(file, "utf8").trim();
  if (!/^\d+$/.test(pid)) return null;
  let command = "";
  try {
    // Windows 上没有 ps；用 PowerShell 查这个 PID 的命令行。
    const script = `Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object -ExpandProperty CommandLine`;
    command = execFileSync(
      process.env.SystemRoot + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      ["-NoProfile", "-Command", script],
      { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {}
  return /agent-autoloop(\.ts)? up\b/.test(command) ? Number(pid) : null;
}

/** 停服务会先返回，进程还没走；手动启动的没有服务可停。 */
export function stopUp() {
  const pid = runningUp();
  if (pid === null) return;
  try {
    spawnSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore" });
  } catch {}
  for (let tries = 0; tries < 50 && runningUp() !== null; tries++) pause(100);
}
