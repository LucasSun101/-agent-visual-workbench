#!/usr/bin/env node
// 一键配置：让一个陌生人在自己电脑上把工作台跑起来。
//
//   node tools/setup.mjs                 # 交互式，一步步问
//   node tools/setup.mjs --dry-run       # 只检查，不改任何东西
//   node tools/setup.mjs --backend dsh-desktop --model deepseek-chat
//   node tools/setup.mjs --key-file ../my-key.txt
//
// 三条硬规矩：
//   1. 密钥只写本地文件，**绝不回显、绝不进日志、绝不进 rules.json**
//   2. 已经有配置就不推倒重来，只补缺的
//   3. 每步失败都停下来，明确说差什么——不静默继续
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOME_DIR = path.join(homedir(), ".agent-autoloop");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : undefined;
};
const DRY = Boolean(flag("--dry-run"));
const YES = Boolean(flag("--yes"));

const say = (s = "") => console.log(s);
const ok = (s) => console.log(`  ✓ ${s}`);
const bad = (s) => console.log(`  ✗ ${s}`);
const warn = (s) => console.log(`  ! ${s}`);

/** 内核可能就在根目录，也可能在子目录里——自己找，别假设 */
function findKernel() {
  const candidates = [ROOT];
  try {
    for (const d of readdirSync(ROOT, { withFileTypes: true })) {
      if (d.isDirectory()) candidates.push(path.join(ROOT, d.name));
    }
  } catch {}
  return candidates.find((c) => existsSync(path.join(c, "bin", "agent-autoloop.ts"))) ?? null;
}

// ---------- 能跑起来的后端（插件目录里有 agent.ts 的）----------
const BACKEND_HINT = {
  "dsh-desktop": "DeepSeek Harness 桌面版（需要本机装了它 + 一个 API Key）",
  deepseek: "官方的 dsh CLI（需要 node 版 dsh 已安装）",
  claude: "Claude Code CLI（需要 claude 已登录）",
  codex: "OpenAI Codex CLI（需要 codex 已登录）",
  codebuddy: "CodeBuddy CLI",
  workbuddy: "WorkBuddy CLI",
  command: "任意命令（不花 token，用来试链路）",
};

/** 需要 API key 的后端（其余靠各自 CLI 的登录态） */
function needsKey(backend) {
  const file = path.join(KERNEL, "plugins", backend, "agent.ts");
  if (!existsSync(file)) return false;
  const src = readFileSync(file, "utf8");
  return /secrets|API_KEY|apiKey/.test(src);
}

const MIN_NODE = "22.18";
function nodeOk() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major > 22) return true;
  if (major === 22) return minor >= 18;
  return false;
}

/** 读出真正的密钥行：跳过空行和 # 注释，认出占位符（注释里常提到占位符字样） */
function readKeyLine(file) {
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith("#"));
  if (!line) return "";
  if (line.includes("PASTE_YOUR_KEY") || line.includes("<") || line.length < 10) return "";
  return line;
}

function ask(rl, question, fallback) {
  return rl.question(`  ${question}${fallback ? `（默认 ${fallback}）` : ""}：`).then((a) => {
    const v = a.trim();
    return v || fallback || "";
  });
}

// ---------- 主流程 ----------
say("");
say("Agent 可视化工作台 · 一键配置");
say("─────────────────────────────");

say("\n[1/5] 检查环境");
if (!nodeOk()) {
  bad(`Node ${process.versions.node} 太旧，需要 ≥ ${MIN_NODE}。`);
  say(`    为什么：内核入口是 TypeScript（bin/agent-autoloop.ts），靠 Node 自带的类型剥离直接运行；`);
  say(`    22.18 起才默认开启，更早的版本会报 ERR_UNKNOWN_FILE_EXTENSION。`);
  say(`    怎么装：https://nodejs.org 下载 LTS（当前 24.x），装完开新终端 node -v 应显示 v22.18 以上。`);
  process.exit(1);
}
ok(`Node ${process.versions.node}`);

const KERNEL = findKernel();
if (!KERNEL) {
  bad(`找不到内核（bin/agent-autoloop.ts）——请在项目根目录运行（当前 ${ROOT}）`);
  process.exit(1);
}
if (!existsSync(path.join(KERNEL, "plugins"))) {
  bad(`找不到 plugins/（在 ${KERNEL}）`);
  process.exit(1);
}
ok("项目结构完整");

// init 只认这几个（其余插件目录里的适配器没有自动安装流程，列出来只会让人选到失败）
const INIT_AGENTS = ["deepseek", "workbuddy", "claude", "codex"];

function availableBackends() {
  const dir = path.join(KERNEL, "plugins");
  if (!existsSync(dir)) return [];
  const present = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, "agent.ts")))
    .map((d) => d.name);
  // 保持 INIT_AGENTS 的顺序（第一个就是默认项），只保留本机真的有的
  const ordered = INIT_AGENTS.filter((b) => present.includes(b));
  const extras = present.filter((b) => !INIT_AGENTS.includes(b)).sort();
  if (extras.length) {
    warn(`插件目录里还有 ${extras.join(" / ")}，但它们没有一键安装流程，没列进菜单`);
  }
  return ordered;
}

const backends = availableBackends();
if (!backends.length) {
  bad("plugins/ 里一个后端都没有");
  process.exit(1);
}
ok(`${backends.length} 个后端可用：${backends.join(" / ")}`);

const initialized = existsSync(path.join(HOME_DIR, "config.json"));
say(`\n[2/5] 中台配置`);
if (initialized) ok(`已初始化过（${HOME_DIR}），只补缺的部分`);
else warn(`还没初始化，会创建 ${HOME_DIR}`);

say(`\n[3/5] 选后端`);
let backend = String(flag("--backend") ?? "");
if (!backend) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  say("  可选（回车用第一个）：");
  backends.forEach((b, i) => say(`    ${i + 1}) ${b}  —— ${BACKEND_HINT[b] ?? "（无说明）"}`));
  const pick = await ask(rl, "输入序号或名字", "1");
  backend = /^\d+$/.test(pick) ? backends[Number(pick) - 1] ?? "" : pick;
  rl.close();
}
if (!backends.includes(backend)) {
  bad(`没有这个后端：${backend}`);
  process.exit(1);
}
ok(`后端：${backend}`);

say(`\n[4/5] 模型（可留空 = 用该后端的默认模型）`);
let model = String(flag("--model") ?? "");
if (!model && !YES && !flag("--dry-run")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  model = await ask(rl, "模型名，例如 deepseek-chat / deepseek-reasoner", "");
  rl.close();
}
if (model) ok(`模型：${model}`);
else ok("模型：默认");

say(`\n[5/5] API Key`);
const keyDir = path.join(HOME_DIR, "secrets");
const keyFile = path.join(keyDir, "deepseek.key");
if (!needsKey(backend)) {
  ok("这个后端用自己的登录态，不需要在这里配 Key");
} else if (readKeyLine(keyFile)) {
  ok(`已经有 Key（${keyFile}），不覆盖`);
} else {
  const fromFile = flag("--key-file");
  let key = "";
  if (typeof fromFile === "string") {
    const p = path.resolve(fromFile);
    if (!existsSync(p)) {
      bad(`找不到 ${p}`);
      process.exit(1);
    }
    key = readFileSync(p, "utf8").split(/\r?\n/)[0].trim();
  } else if (process.env.DSH_SETUP_KEY) {
    key = process.env.DSH_SETUP_KEY.trim();
  } else if (!DRY && !YES) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    say("  粘贴 Key 后回车（不会回显内容，也不会写进任何日志）：");
    key = (await rl.question("  Key：")).trim();
    rl.close();
  }
  if (!key) {
    warn(`没有提供 Key。可以稍后自己写进 ${keyFile}，或设环境变量 DEEPSEEK_API_KEY`);
  } else if (DRY) {
    ok(`（dry-run）会写入 ${keyFile}，长度 ${key.length}，不回显`);
  } else {
    mkdirSync(keyDir, { recursive: true });
    writeFileSync(keyFile, key + "\n", { encoding: "utf8", mode: 0o600 });
    ok(`已写入 ${keyFile}（不回显、不进日志）`);
  }
}

// ---------- 真正落地 ----------
say("\n── 执行 ──");
const node = process.execPath;
const runCli = (cliArgs, label) => {
  say(`  → ${label}`);
  if (DRY) {
    ok(`（dry-run）跳过：node bin/agent-autoloop.ts ${cliArgs.join(" ")}`);
    return true;
  }
  const r = spawnSync(node, ["--disable-warning=ExperimentalWarning", "--experimental-sqlite", "bin/agent-autoloop.ts", ...cliArgs], {
    cwd: KERNEL,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    bad(`${label} 失败（退出码 ${r.status}）`);
    return false;
  }
  return true;
};

if (!initialized) {
  say("  （这一步不会注册开机自启。想让中台开机自动运行，之后跑 `npm run init` 去掉 --no-service）");
  if (!runCli(["init", "--agent", backend, "--no-service"], "初始化中台")) process.exit(1);
} else {
  ok("跳过 init（已初始化）");
}

if (!runCli(["check"], "校验规则")) process.exit(1);

// 设模型（走和界面同一条路：写 rules.json 的 agents[x].model，带备份与回滚）
if (model && !DRY) {
  const { setBackendModel } = await import(path.join(ROOT, "console", "workflow", "rules-sync.mjs"));
  const r = setBackendModel({
    backend, // init 建的 agent 键就是 --agent 的值，别做映射
    model,
    workspace: ROOT,
    repoDir: KERNEL,
    log: (m) => say(`    ${m}`),
  });
  if (r.error) {
    bad(`设模型失败：${r.error}`);
    warn(`可以先跳过模型：控制台里点员工 →「这个后端的模型」手动填；或看 ${path.join(HOME_DIR, "rules.json")} 里 agents 下有哪些键`);
  } else if (r.changed) ok(`模型已写入 rules.json`);
  else ok("模型没有变化");
}

say("\n── 完成 ──");
say("下一步：");
say("  npm run up        启动中台（另开一个窗口）");
say("  npm run console   启动可视化控制台，然后打开它打印的地址");
say("");
say(`改模型：在控制台里点员工 →「这个后端的模型」；或直接改 ${path.join(HOME_DIR, "rules.json")} 里 agents.<后端>.model`);
