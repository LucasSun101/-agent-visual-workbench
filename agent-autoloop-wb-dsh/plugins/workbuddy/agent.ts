// WorkBuddy / CodeBuddy CLI：Windows 用户的官方命令行 Agent。以 print 模式跑一轮，
// 最后一条消息在 stdout；`codebuddy -p` 直接接提示词。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { findProgram, tail, type Adapter } from "../../worker/agents.ts";

function inTheApp() {
  const candidates = [
    path.join(homedir(), ".workbuddy", "bin", "codebuddy.cmd"),
    path.join(homedir(), "AppData", "Local", "Programs", "WorkBuddy", "resources", "bin", "codebuddy.cmd"),
  ];
  return candidates.filter(existsSync);
}

export default {
  command: (turn) => [
    findProgram("codebuddy", inTheApp),
    "-p",
    turn.prompt,
    ...(turn.model ? ["-m", turn.model] : []),
    ...(turn.effort ? ["--effort", turn.effort] : []),
  ],
  read(stdout, code, stderr) {
    if (code === null) return {};
    if (code !== 0) return { error: `退出码 ${code}：${tail(stderr || stdout) || "没留下原因"}` };
    return { text: stdout };
  },
  check() {
    try {
      execFileSync(findProgram("codebuddy", inTheApp), ["--version"], {
        encoding: "utf8",
        timeout: 20_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return null;
    } catch (error) {
      return `WorkBuddy CLI 用不了：${(error as Error).message.split("\n")[0]}`;
    }
  },
} satisfies Adapter;
