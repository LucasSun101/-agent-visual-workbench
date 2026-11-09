// DeepSeek Harness **桌面版**适配器。
//
// 为什么单独写一份：官方的 `dsh` 在 Windows 上是「Electron 二进制 + app.asar 里的 cli.js」，
// 而自带的 deepseek 插件按「node + node_modules/@deepseek-ai/dsh/lib/bin.js」去找，
// 在桌面安装形态下找不到（那个路径不存在），会退化成 spawn(node, "dsh.cmd") 然后 EINVAL。
//
// API key 不写在规则里、也不进日志：从 ~/.agent-autoloop/secrets/deepseek.key 读，
// 只在拉起子进程时注入环境变量。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { tail, type Adapter } from "../../worker/agents.ts";

const APP = process.env.DSH_APP_ROOT ?? (process.env.DSH_APP_DIR ?? path.join(process.env.LOCALAPPDATA ?? "", "Programs", "DeepSeek Harness"));
const EXE = path.join(APP, "DeepSeek Harness.exe");
// app.asar 是归档，existsSync 看不到里面；Electron 自己能读，所以别去检查它。
const CLI = path.join(
  APP,
  "resources",
  "app.asar",
  "dsh",
  "node_modules",
  "@deepseek-ai",
  "dsh-desktop-host",
  "lib",
  "cli.js",
);

const KEY_FILE = path.join(homedir(), ".agent-autoloop", "secrets", "deepseek.key");
const PLACEHOLDER = "PASTE_YOUR_KEY_HERE";

function readKey(): string | null {
  for (const name of ["DEEPSEEK_API_KEY", "UNITTEC_API_KEY"]) {
    const v = process.env[name];
    if (v && v.trim() && !v.includes(PLACEHOLDER)) return v.trim();
  }
  try {
    const line = readFileSync(KEY_FILE, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith("#"));
    if (line && !line.includes(PLACEHOLDER)) return line;
  } catch {
    /* 没这个文件就走空 */
  }
  return null;
}

/**
 * 给某一轮指定模型：生成一个 patch 文件并返回它的路径。
 *
 * 为什么要这么绕：dsh 的 headless **没有 --model 参数**，模型是 profile 里
 * `agent-default-model` 这一行的 config；而 `--patch` 可以在每次运行时叠加一层覆盖
 * （实测 `--patch x.yml --dump-config` 里 model 确实变成了指定的值）。
 *
 * 注意：patch 里的 `config` 是**整行替换**、不深合并，所以 provider 必须一起写，
 * 否则会丢。provider 默认 deepseek-official，可用 DSH_PROVIDER 覆盖。
 *
 * 只有 turn.model 非空时才调用；不设模型时命令行完全不变。
 */
function modelPatchPath(model: string): string {
  const provider = process.env.DSH_PROVIDER ?? "deepseek-official";
  const dir = path.join(homedir(), ".agent-autoloop", "patches");
  const key = createHash("sha1").update(`${provider}\u0000${model}`).digest("hex").slice(0, 12);
  const file = path.join(dir, `model-${key}.yml`);
  if (!existsSync(file)) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        file,
        [
          "- id: agent-default-model",
          "  name: '@deepseek-ai/dsh-agent-default-model'",
          "  config:",
          `    provider: ${provider}`,
          `    model: ${model}`,
          "",
        ].join("\n"),
        "utf8",
      );
    } catch (e) {
      // 宁可这一轮失败，也不能悄悄用默认模型跑——那等于"设了模型但没生效"
      throw new Error(`写模型补丁失败（${file}）：${e.message}。可以清空模型名，或让 worker 有写 ~/.agent-autoloop 的权限。`);
    }
  }
  return file;
}

/**
 * 从 turn.command 里解析模型名（约定 `model=<名字>`）。
 *
 * 为什么不用 turn.model：中台派活时只把白名单字段带进 job，`model` 到不了适配器
 * （实测过：rules.agents.ds.model 写得好好的，适配器收到的 turn.model 是空的），
 * 而 `command` 能带过来。所以控制台把模型写成 `command: "model=xxx"`。
 */
function modelFromCommand(command: unknown): string {
  const list = Array.isArray(command) ? command : command ? [command] : [];
  for (const item of list) {
    const s = String(item ?? "").trim();
    if (s.startsWith("model=")) return s.slice("model=".length).trim();
  }
  return "";
}

export default {
  command: (turn) => {
    // 排查用：设了 DSH_MODEL_DIAG 才记录（平时不写任何文件）
    if (process.env.DSH_MODEL_DIAG) {
      try {
        appendFileSync(
          path.join(homedir(), ".agent-autoloop", "adapter-diag.log"),
          `${new Date().toISOString()} command=${JSON.stringify(turn.command)} model=${JSON.stringify(turn.model)}\n`,
        );
      } catch {}
    }    const key = readKey();
    if (!key) console.error("[dsh-desktop] 没有可用的 API key");
    // 只在有 key 时注入，避免把占位符当成真 key 发出去
    if (key) process.env.DEEPSEEK_API_KEY = key;
    // 桌面二进制要靠这个环境变量才以 node 身份运行
    process.env.ELECTRON_RUN_AS_NODE = "1";
    return [
      EXE,
      "--expose-internals",
      CLI,
      "--profile",
      "headless",
      // 只有这一轮指定了模型才加 --patch；否则命令行和以前完全一样
      ...(() => {
        const m = modelFromCommand(turn.command) || turn.model || "";
        return m ? ["--patch", modelPatchPath(m)] : [];
      })(),
      "--json",
      ...(turn.resume ? ["--session-id", turn.resume] : []),
      turn.prompt,
    ];
  },

  read(stdout, code, stderr) {
    let session: string | undefined;
    let text: string | undefined;
    let failure: string | undefined;
    // 每个 step_end 都带本次 step 的用量，一轮可能有多步，累加
    let input = 0;
    let output = 0;
    let cached = 0;

    for (const line of stdout.split("\n")) {
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event?.type === "session" && event.sessionId) session = event.sessionId;
      else if (event?.type === "final" && event.text !== undefined) text = String(event.text);
      else if (event?.type === "status" && event.phase === "step_end" && event.usage) {
        input += Number(event.usage.inputTokens ?? 0) || 0;
        output += Number(event.usage.outputTokens ?? 0) || 0;
        cached += Number(event.usage.cacheReadTokens ?? 0) || 0;
      } else if (event?.type === "status" && event.phase === "turn_end" && event.reason?.kind === "error") {
        // 比自带适配器多一步：把中台报的错误原因捞出来，别只显示退出码
        failure = event.reason?.error?.message ?? failure;
      }
    }

    const usage = input || output || cached ? { input, output, cached } : undefined;
    if (code === null) return { started: true };
    if (code !== 0) return { error: failure || `退出码 ${code}：${tail(stderr || stdout) || "没留下原因"}`, usage };
    if (text === undefined || !text.trim()) {
      return { error: failure || tail(stderr || stdout) || "没留下结果", usage };
    }
    return { text, session, usage, started: true };
  },

  check() {
    if (!existsSync(EXE)) {
      return `找不到 ${EXE}。如果 DSH 装在别处，用环境变量 DSH_APP_ROOT 指过去。`;
    }
    if (!readKey()) {
      return `没有 API key：把 key 写进 ${KEY_FILE}（一行，不要引号），或设环境变量 DEEPSEEK_API_KEY。`;
    }
    return null;
  },
} satisfies Adapter;
