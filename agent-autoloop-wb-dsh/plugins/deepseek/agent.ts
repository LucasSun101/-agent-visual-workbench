// DeepSeek Harness（dsh）：DeepSeek 官方的开源编码 Agent。这里用它的 headless 一次性模式：
// `dsh --profile headless "任务"` 跑完打印结果就退出（退出码 0=完成，1=出错）。
// `--json` 输出 NDJSON 事件流，首行 session 事件带 sessionId，最后 final 事件带 text——
// 用它接会话，所以人等拍板时进程退出、回答后接原会话续跑，和其它适配器一样。
// API key 从 dsh 的凭据库 ~/.dsh/.credentials.yaml（UNITTEC_API_KEY）读，装好后不需要人再设环境变量。
// 模型在 profile 里配了 `reasoning: off`，所以它只回正文、不回 reasoning 块（见 README 的 dsh 一节）。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { findProgram, tail, type Adapter } from "../../worker/agents.ts";

// dsh 全局安装有 node_modules 的 node 解释器；没有就直接用本机 node（Windows 上 npm 的 dsh.cmd 不能直接 spawn）。
function nodeForDsh(dsh: string) {
  const local = path.join(path.dirname(dsh), "node.exe");
  return existsSync(local) ? local : process.execPath;
}
const DSH_JS = path.join("node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");

// 本地装好全局 dsh 最省事；没有就退回 npx 现拉 @deepseek-ai/dsh。
function dshCommand() {
  try {
    const dsh = findProgram("dsh");
    // findProgram 可能返回带扩展名的 .cmd（Windows），这时把它当成 node 脚本包路径：同目录的 node_modules 有 bin.js。
    if (/\.(cmd|ps1)$/i.test(dsh)) {
      const js = path.join(path.dirname(dsh), DSH_JS);
      if (existsSync(js)) return { node: nodeForDsh(dsh), script: js };
      const cmd = dsh; // 兜底：保留原始 .cmd，虽然它不能直接 spawn（会报 EINVAL），让 read 给出可读错误。
      return { node: process.execPath, script: cmd };
    }
    return { node: nodeForDsh(dsh), script: dsh };
  } catch {
    return null;
  }
}

/** 把 dsh 要的 API key 找到，放进本进程环境（会传给拉起的 dsh 子进程）。 */
function ensureApiKey() {
  const wanted = ["UNITTEC_API_KEY", "DEEPSEEK_API_KEY"];
  if (wanted.some((name) => process.env[name])) return true;
  // 1) dsh 的凭据库：.credentials.yaml 顶部 refs 段就是 `名字: 值`。
  try {
    const cred = readFileSync(path.join(homedir(), ".dsh", ".credentials.yaml"), "utf8");
    for (const name of wanted) {
      const m = new RegExp(`^\\s*${name}\\s*:\\s*(\\S+)`, "m").exec(cred);
      if (m) {
        process.env[name] = m[1];
        return true;
      }
    }
  } catch {}
  // 2) ~/.dsh/.env（`名字=值`）。
  try {
    const text = readFileSync(path.join(homedir(), ".dsh", ".env"), "utf8");
    for (const name of wanted) {
      const m = new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, "m").exec(text);
      if (m) {
        process.env[name] = m[1].trim();
        return true;
      }
    }
  } catch {}
  return false;
}

export default {
  command: (turn) => {
    ensureApiKey();
    const program = dshCommand();
    // 直接启动 node 脚本，不经过 npm 的 .cmd 包装（Windows 上 .cmd 不能 spawn）。
    const run: string[] = program
      ? [program.node, program.script, "--profile", "headless"]
      : ["npx", "@deepseek-ai/dsh", "--profile", "headless"];
    return [
      ...run,
      "--json",
      ...(turn.resume ? ["--session-id", turn.resume] : []),
      turn.prompt,
    ];
  },
  read(stdout, code, stderr) {
    // --json 下 stdout 是 NDJSON 事件流：session 事件带 sessionId，final 事件带 text。
    let session: string | undefined;
    let text: string | undefined;
    for (const line of stdout.split("\n")) {
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event?.type === "session" && event.sessionId) session = event.sessionId;
      else if (event?.type === "final" && event.text !== undefined) text = String(event.text);
    }
    if (code === null) return {};
    if (code !== 0) return { error: `退出码 ${code}：${tail(stderr || stdout) || "没留下原因"}` };
    if (text === undefined || !text.trim()) return { error: tail(stderr || stdout) || "没留下结果" };
    return { text, session };
  },
  check() {
    if (!dshCommand()) {
      return "没找到 dsh（DeepSeek Harness）。全局安装：npm install -g @deepseek-ai/dsh，装好登录后再跑。";
    }
    if (!ensureApiKey()) {
      return "dsh 装了但没配 API key：在 dsh 的 Web 界面（模型页）或 ~/.dsh/.credentials.yaml 里配上 UNITTEC_API_KEY / DEEPSEEK_API_KEY。";
    }
    try {
      execFileSync("dsh", ["--version"], { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] });
      return null;
    } catch (error) {
      return `dsh 用不了：${(error as Error).message.split("\n")[0]}`;
    }
  },
} satisfies Adapter;
