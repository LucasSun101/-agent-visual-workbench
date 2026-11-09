// Codex：用户自己装的、自己登录的那份。一轮是后台的 `codex exec`；它的线程留在磁盘上，
// 所以重试或回答都能接在它后面，链接能在 App 里打开它。
// Windows 上官方 CLI 在 %USERPROFILE%\.local\bin\codex.exe 或 %LOCALAPPDATA% 下。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { findProgram, tail, type Adapter } from "../../worker/agents.ts";

const SANDBOX = { read: "read-only", edit: "workspace-write", full: "danger-full-access" };
function inTheApp() {
  const local = path.join(homedir(), "AppData", "Local");
  return [
    path.join(local, "Programs", "Codex", "codex.exe"),
    path.join(local, "codex", "codex.exe"),
    path.join(homedir(), ".local", "bin", "codex.exe"),
  ].filter(existsSync);
}

export default {
  command: (turn) => [
    findProgram("codex", inTheApp),
    "exec",
    ...(turn.resume ? ["resume"] : []),
    "--json",
    "--skip-git-repo-check",
    ...(turn.model ? ["-m", turn.model] : []),
    ...(turn.effort ? ["-c", `model_reasoning_effort="${turn.effort}"`] : []),
    // 写成配置，因为 `codex exec resume` 不吃 -s。
    "-c",
    `sandbox_mode="${SANDBOX[turn.access]}"`,
    "-c",
    'approval_policy="never"',
    ...(turn.resume ? [turn.resume] : []),
    "本轮通过后台 codex exec 运行，不要假定桌面应用的浏览器连接已带到本轮。" +
      "网页操作使用本轮实际可用的浏览器工具，或使用规则或 Skill 中已明确配置的浏览器入口。" +
      "沿用该入口的会话，只交网页步骤，业务处理和中台回执仍由本轮负责；没有可用入口或需要本人恢复连接时，按待你处理的约定交回。\n\n" +
      turn.prompt,
  ],
  read(stdout, code, stderr) {
    const seen: {
      text?: string;
      session?: string;
      usage?: object;
      error?: string;
      finished?: boolean;
      completed?: boolean;
    } = {};
    for (const line of stdout.split("\n")) {
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "thread.started") seen.session = event.thread_id;
      else if (event.type === "item.completed" && event.item?.type === "agent_message") seen.text = event.item.text;
      else if (event.type === "turn.completed") {
        seen.completed = seen.finished = true;
        const { input_tokens = 0, output_tokens = 0, cached_input_tokens = 0 } = event.usage ?? {};
        seen.usage = { input: input_tokens, output: output_tokens, cached: cached_input_tokens };
      } else if (event.type === "turn.failed") {
        seen.finished = true;
        seen.error = event.error?.message || "Codex 没跑完这一轮";
      } else if (event.type === "error") seen.error = event.message;
    }
    const { completed, ...reading } = seen;
    // 只有一轮结束时的最后一条消息才是它的回答；在那之前只是它走到哪了。
    if (!completed) delete reading.text;
    if (code !== null && !completed && !reading.error) reading.error = tail(stderr) || "Codex 没有完成并留下实际结果";
    if (completed && !reading.text?.trim()) reading.error = "Codex 没有完成并留下实际结果";
    return reading;
  },
  link: (session) => `codex://threads/${session}`,
  check() {
    try {
      execFileSync(
        findProgram("codex", inTheApp),
        ["login", "status"],
        { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] },
      );
      return null;
    } catch (error) {
      return `Codex 没有登录或用不了：运行 codex login（${(error as Error).message.split("\n")[0]}）`;
    }
  },
} satisfies Adapter;
