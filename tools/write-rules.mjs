// Rewrite ~/.agent-autoloop/rules.json with correct UTF-8.
// Why: passing non-ASCII paths through the Windows console code page mangles them,
// so the agent command and rule names must be composed inside this file, not on a command line.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const home = path.join(homedir(), ".agent-autoloop");
const rulesFile = path.join(home, "rules.json");
const repo = process.cwd(); // workspace 下 agent-autoloop-wb-dsh；从仓库根跑
const ws = path.resolve(repo, "..");
const nodeExe = process.execPath;
const fakeAgent = path.join(repo, "tests", "fake-agent.mjs");
const slowAgent = path.join(ws, "tools", "slow-agent.mjs");

const WORKER = process.env.AGENT_AUTOLOOP_WORKER ?? "worker-1";

const rules = {
  sources: { local: { name: "本机" } },
  agents: {
    agent: {
      name: "假 Agent（零模型试运行）",
      worker: WORKER,
      use: "command",
      command: [nodeExe, fakeAgent],
    },
    slow: {
      name: "慢 Agent（测停止与实时输出）",
      worker: WORKER,
      use: "command",
      command: [nodeExe, slowAgent],
    },
    ds: {
      name: "DeepSeek Harness（真实模型）",
      worker: WORKER,
      use: "dsh-desktop",
      access: "edit",
    },
  },
  channels: { desktop: { name: "桌面通知" } },
  rules: [
    {
      name: "试一下",
      when: { source: "local", types: ["try.*"] },
      to: "ds",
      cwd: path.join(home, "try"),
      prompt:
        "这是一次试跑，不要改任何文件。读资料文件：answers 为空时，第一行写「问了一个问题」，" +
        "并在 agent-autoloop 代码块里交一张 ask（title「试跑：选一个颜色」，options [\"蓝色\",\"绿色\"]，key \"try-color\"）；" +
        "answers 非空时，第一行写「你选了某某，试跑通过」，某某换成 answers 里选的那一项，不附回执。",
    },
    {
      name: "慢跑",
      when: { source: "local", types: ["slow.*"] },
      to: "slow",
      cwd: repo,
      prompt: "会跑 30 秒并每 2 秒打一行进度。用来测「实时输出」和「停止」。",
    },
  ],
  elsewhere: [],
};

writeFileSync(rulesFile, JSON.stringify(rules, null, 2) + "\n", "utf8");

const back = JSON.parse(readFileSync(rulesFile, "utf8"));
console.log("rules.json written and re-parsed OK");
console.log("rule name:", back.rules[0].name);
console.log("agent name:", back.agents.agent.name);
console.log("command[0]:", back.agents.agent.command[0]);
console.log("command[1]:", back.agents.agent.command[1]);
console.log("cwd exists:", existsSync(back.rules[0].cwd), "| agent script exists:", existsSync(back.agents.agent.command[1]));
