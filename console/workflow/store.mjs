// 编排层的数据：员工档案、图、运行记录。
// 全部落在 workspace/workflow/ 下，和内核的 rules.json 解耦——
// 员工和图是控制台的概念，内核只认"事件 → 规则 → Agent"。
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export const newId = (prefix, n = 6) =>
  prefix +
  "-" +
  Array.from(randomBytes(n))
    .map((b) => ID_ALPHABET[b % ID_ALPHABET.length])
    .join("");

/**
 * 现成的后端 Agent（对应 rules.json 里的 agents 键）。
 * 员工的身份（角色/默认任务）只是提示词；**后端才决定谁来执行、花不花钱**。
 * 新增后端要改 rules.json，这层不代劳。
 */
export const BACKENDS = [
  {
    id: "ds",
    short: "真实模型",
    label: "DeepSeek（真实模型）",
    note: "真调大模型：能读文件、跑命令、自己想。花 token。",
  },
  {
    id: "slow",
    short: "慢速测试",
    label: "慢速测试 Agent",
    note: "假的：固定跑 60 秒再返回。用来试并行、停止、实时输出，不花钱。",
  },
  {
    id: "agent",
    short: "假 Agent",
    label: "假 Agent（零模型）",
    note: "假的：立刻返回。只用来确认链路通不通，不花钱。",
  },
];
export const BACKEND_IDS = BACKENDS.map((b) => b.id);

// 本机钥匙文件放在这里（只检查存在性，永远不读内容、不回显）
const secretsDir = () => path.join(homedir(), ".agent-autoloop", "secrets");
const rulesFile = () => path.join(homedir(), ".agent-autoloop", "rules.json");

/**
 * 从 agent 的 command 字段里解析模型。
 *
 * 为什么模型放在 command 里：中台派活时只把白名单字段带进 job，`model` 会被丢掉，
 * 而 `command` 能传到适配器（worker.ts `command: agent.command`）。约定 `model=<名字>`。
 */
/**
 * 一个 agent 配置里定的模型。
 *
 * 正路是 `model` 字段（`query.ts` 整对象展开 → `worker.ts` 取 `agent.model` → turn.model）。
 * 兼容早期临时方案留下的 `command: ["model=xxx"]`，读的时候两种都认。
 */
export function modelOfCommand(command, model) {
  if (model) return String(model);
  const list = Array.isArray(command) ? command : command ? [command] : [];
  for (const item of list) {
    const s = String(item ?? "").trim();
    if (s.startsWith("model=")) return s.slice("model=".length).trim();
  }
  return "";
}

/**
 * 后端清单 = 自带的 3 个 + 本机 rules.json 里真实存在的 agent。
 *
 * 为什么这么设计：装了 Claude Code 的人 rules.json 里就会有 `claude`，
 * 界面上就该能选；没装的就不该出现一个选了会失败的选项。
 * 每个后端带上它当前的 model 和"有没有配钥匙"（只答有/没有，绝不回显内容）。
 */
export function backendsInfo() {
  let agents = {};
  try {
    const r = JSON.parse(readFileSync(rulesFile(), "utf8"));
    agents = r.agents ?? {};
  } catch {
    /* 没装中台就当只有自带后端 */
  }

  const seen = new Set();
  const list = [];

  for (const b of BACKENDS) {
    seen.add(b.id);
    list.push({
      ...b,
      model: modelOfCommand(agents[b.id]?.command, agents[b.id]?.model),
      installed: Boolean(agents[b.id]),
      hasKey: hasKeyFor(b.id),
    });
  }

  // 本机额外装了的适配器
  for (const [id, a] of Object.entries(agents)) {
    if (seen.has(id)) continue;
    list.push({
      id,
      short: a.use ?? id,
      label: `${id}（${a.use ?? "未知适配器"}）`,
      note: `来自本机 rules.json；权限 ${a.access ?? "默认"}`,
      model: modelOfCommand(a.command, a.model),
      installed: true,
      hasKey: hasKeyFor(id),
    });
  }

  return list;
}

/** 这个后端要不要自己的钥匙文件（只有 dsh-desktop 走 key 文件，其余靠各自 CLI 的登录态） */
function hasKeyFor(backend) {
  try {
    const r = JSON.parse(readFileSync(rulesFile(), "utf8"));
    const use = r.agents?.[backend]?.use;
    if (use !== "dsh-desktop" && use !== "deepseek") return null; // null = 不需要
    const f = path.join(secretsDir(), "deepseek.key");
    if (!existsSync(f)) return false;
    const line = readFileSync(f, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith("#"));
    return Boolean(line) && !line.includes("PASTE_YOUR_KEY");
  } catch {
    return false;
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

/** 员工角色：干活的，还是带人的 */
export const ROLES = [
  { id: "worker", label: "员工", note: "领一件活，干完交差。" },
  { id: "lead", label: "负责人", note: "能派活给别人、能往项目的工作状态里写结论。" },
];

export function createStore(workspace) {
  const dir = path.join(workspace, "workflow");
  const employeesFile = path.join(dir, "employees.json");
  const graphsDir = path.join(dir, "graphs");
  const runsDir = path.join(dir, "runs");
  const briefDir = path.join(dir, "brief");
  for (const d of [dir, graphsDir, runsDir, briefDir]) mkdirSync(d, { recursive: true });

  // ---- 员工 ----
  function employees() {
    const data = readJson(employeesFile, null);
    if (!data || !Array.isArray(data.employees)) {
      // 首次：给一个能直接跑的默认员工
      const seed = {
        version: 1,
        employees: [
          {
            id: "emp-default",
            name: "小D",
            backend: "ds",
            persona: "你是一名严谨的工程员工。执行前先读清楚指令，做完用一句话交代结论。",
            defaultTask: "",
            role: "worker",
            createdAt: new Date().toISOString(),
          },
        ],
      };
      writeJsonAtomic(employeesFile, seed);
      return seed.employees;
    }
    return data.employees;
  }

  function saveEmployees(list) {
    writeJsonAtomic(employeesFile, { version: 1, employees: list });
    return list;
  }

  function upsertEmployee(input) {
    const list = employees();
    const name = String(input?.name ?? "").trim().slice(0, 40);
    if (!name) throw new Error("员工要有名字");
    const backend = String(input?.backend ?? "ds");
    if (!BACKEND_IDS.includes(backend)) throw new Error(`后端只能是 ${BACKEND_IDS.join(" / ")}`);
    const persona = String(input?.persona ?? "").trim().slice(0, 2000);
    const defaultTask = String(input?.defaultTask ?? "").trim().slice(0, 4000);
    const role = input?.role === "lead" ? "lead" : "worker";

    const existing = input?.id ? list.find((e) => e.id === input.id) : null;
    if (existing) {
      Object.assign(existing, { name, backend, persona, defaultTask, role, updatedAt: new Date().toISOString() });
      saveEmployees(list);
      return existing;
    }
    if (list.length >= 12) throw new Error("员工上限 12 个，先把不用的删了");
    const created = {
      id: newId("emp"),
      name,
      backend,
      persona,
      defaultTask,
      role,
      createdAt: new Date().toISOString(),
    };
    list.push(created);
    saveEmployees(list);
    return created;
  }

  function removeEmployee(id) {
    const list = employees();
    const next = list.filter((e) => e.id !== id);
    if (next.length === list.length) return false;
    if (!next.length) throw new Error("至少留一个员工");
    saveEmployees(next);
    return true;
  }

  // ---- 图 ----
  const graphFile = (id) => path.join(graphsDir, `${id}.json`);

  function listGraphs() {
    return readdirSync(graphsDir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => readJson(path.join(graphsDir, n), null))
      .filter(Boolean);
  }

  function getGraph(id) {
    return readJson(graphFile(id), null);
  }

  function saveGraph(graph) {
    const id = String(graph?.id ?? "").trim() || newId("g");
    if (!/^[a-z0-9-]{4,40}$/.test(id)) throw new Error("图 id 不合法");
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph?.edges) ? graph.edges : [];
    if (nodes.length > 40) throw new Error("节点上限 40");
    const clean = {
      version: 1,
      id,
      name: String(graph?.name ?? "未命名").trim().slice(0, 60) || "未命名",
      // 工作状态：整个项目共享的背景，会注入到每个员工的任务说明里
      brief: String(graph?.brief ?? "").slice(0, 4000),
      nodes: nodes.map((n) => ({
        id: String(n.id ?? newId("n", 5)),
        type: ["input", "agent", "confirm", "output"].includes(n.type) ? n.type : "agent",
        x: Math.round(Number(n.x ?? 80)),
        y: Math.round(Number(n.y ?? 80)),
        employee: n.employee ? String(n.employee) : null,
        text: String(n.text ?? "").slice(0, 4000),
      })),
      // 负责人提的「招人/改人」提案，等老板批准
      proposals: Array.isArray(graph?.proposals)
        ? graph.proposals
            .filter((p) => p && (p.kind === "hire" || p.kind === "edit") && p.id)
            .slice(-50)
        : [],
      // 对话记录（按节点存）
      chats: graph?.chats && typeof graph.chats === "object" ? graph.chats : {},
      edges: edges
        .filter((e) => e && e.from && e.to && e.from !== e.to)
        .map((e) => ({ from: String(e.from), to: String(e.to) })),
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(graphFile(id), clean);
    return clean;
  }

  function deleteGraph(id) {
    const f = graphFile(id);
    if (!existsSync(f)) return false;
    // 改名而不是删掉，以便误删后还能捞回来
    writeFileSync(f + ".deleted", readFileSync(f, "utf8"));
    rmSync(f);
    return true;
  }

  // ---- 运行记录 ----
  function saveRun(run) {
    writeJsonAtomic(path.join(runsDir, `${run.id}.json`), run);
    return run;
  }

  function getRun(id) {
    return readJson(path.join(runsDir, `${id}.json`), null);
  }

  function listRuns(limit = 10) {
    return readdirSync(runsDir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => readJson(path.join(runsDir, n), null))
      .filter(Boolean)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      .slice(0, limit);
  }

  // ---- 项目资料（工作状态里的附件）----
  const SAFE = /^[\w\u4e00-\u9fa5.\-()（）\s]{1,80}$/;
  const briefDirOf = (graphId) => {
    const d = path.join(briefDir, String(graphId).replace(/[^a-z0-9-]/gi, ""));
    mkdirSync(d, { recursive: true });
    return d;
  };

  function listBriefFiles(graphId) {
    if (!graphId) return [];
    const d = briefDirOf(graphId);
    return readdirSync(d)
      .filter((n) => !n.endsWith(".tmp"))
      .map((name) => {
        const full = path.join(d, name);
        return { name, size: statSync(full).size, path: full };
      });
  }

  function saveBriefFile(graphId, name, base64) {
    if (!graphId) throw new Error("先把项目保存一次，再传资料");
    const clean = String(name ?? "").trim();
    if (!SAFE.test(clean)) throw new Error("文件名只能用中英文、数字、点、横线、括号");
    const buf = Buffer.from(String(base64 ?? ""), "base64");
    if (!buf.length) throw new Error("文件是空的");
    if (buf.length > 4 * 1024 * 1024) throw new Error("单个文件上限 4MB");
    const full = path.join(briefDirOf(graphId), clean);
    writeFileSync(full, buf);
    return { name: clean, size: buf.length, path: full };
  }

  function removeBriefFile(graphId, name) {
    const full = path.join(briefDirOf(graphId), path.basename(String(name ?? "")));
    if (!existsSync(full)) return false;
    rmSync(full);
    return true;
  }

  // ---- 对话记录落盘：员工随时能打开读，不靠上下文窗口 ----
  const chatDirOf = (graphId) => {
    const d = path.join(briefDir, "chats", String(graphId).replace(/[^a-z0-9-]/gi, ""));
    mkdirSync(d, { recursive: true });
    return d;
  };

  function appendChatLog(graphId, nodeId, role, text) {
    const file = path.join(chatDirOf(graphId), `${String(nodeId).replace(/[^a-z0-9-]/gi, "")}.md`);
    const who = role === "user" ? "老板" : "你";
    const line = `**${who}**（${new Date().toLocaleString("zh-CN", { hour12: false })}）\n\n${text}\n\n---\n\n`;
    try {
      if (!existsSync(file)) writeFileSync(file, `# 对话记录\n\n`, "utf8");
      writeFileSync(file, line, { encoding: "utf8", flag: "a" });
    } catch {}
    return file;
  }

  return {
    dir,
    employees,
    upsertEmployee,
    removeEmployee,
    listGraphs,
    getGraph,
    saveGraph,
    deleteGraph,
    listBriefFiles,
    saveBriefFile,
    removeBriefFile,
    appendChatLog,
    saveRun,
    getRun,
    listRuns,
  };
}
