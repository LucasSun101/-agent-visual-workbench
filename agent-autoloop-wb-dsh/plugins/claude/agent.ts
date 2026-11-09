// Claude Code：用户自己装的、自己登录的那份。这里只运行官方程序。
// Windows 上官方安装器放在 %USERPROFILE%\.local\bin\claude.exe，桌面版装的也能直接用。
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { findProgram, tail, type Adapter } from "../../worker/agents.ts";

const PERMISSIONS = { read: "plan", edit: "acceptEdits", full: "bypassPermissions" };

/** 桌面版 App 带的最新 Claude Code，给没单独装的人用。 */
function inTheApp() {
  const root = path.join(homedir(), ".local", "bin");
  if (existsSync(path.join(root, "claude.exe"))) return [];
  const local = path.join(homedir(), "AppData", "Local");
  const scans = [path.join(local, "AnthropicClaude", "claude.exe"), path.join(local, "claude", "claude.exe")];
  return scans.filter(existsSync);
}

export default {
  command: (turn) => [
    findProgram("claude", inTheApp),
    "-p",
    turn.prompt,
    ...(turn.resume ? ["--resume", turn.resume] : ["--session-id", turn.session]),
    "--output-format",
    "json",
    ...(turn.model ? ["--model", turn.model] : []),
    ...(turn.effort ? ["--effort", turn.effort] : []),
    "--permission-mode",
    PERMISSIONS[turn.access],
    "--add-dir",
    turn.folder,
    "--disallowedTools=EnterWorktree,ExitWorktree",
  ],
  read(stdout, code, stderr) {
    for (const line of stdout.split("\n").reverse()) {
      let result: any;
      try {
        result = JSON.parse(line);
      } catch {
        continue;
      }
      if (result?.type !== "result") continue;
      const usage = result.usage
        ? {
            input: result.usage.input_tokens ?? 0,
            output: result.usage.output_tokens ?? 0,
            cached: (result.usage.cache_read_input_tokens ?? 0) + (result.usage.cache_creation_input_tokens ?? 0),
            cost: result.total_cost_usd ?? 0,
          }
        : undefined;
      const said = String(result.result ?? "");
      if (result.is_error || result.subtype !== "success") {
        const error = said.split("\n")[0] || result.subtype || "没留下结果";
        return { session: result.session_id, usage, finished: true, error };
      }
      return { text: said, session: result.session_id, usage, finished: true };
    }
    return code === null ? {} : { error: tail(stderr || stdout) || "没留下结果" };
  },
  link: (session) => `claude://resume?session=${session}`,
  check() {
    try {
      const program = findProgram("claude", inTheApp);
      const status = JSON.parse(execFileSync(program, ["auth", "status"], { encoding: "utf8", timeout: 20_000 }));
      return status.loggedIn ? null : "Claude Code 没有登录：运行 claude auth login";
    } catch (error) {
      return `Claude Code 用不了：${(error as Error).message.split("\n")[0]}`;
    }
  },
} satisfies Adapter;
