// 接单程序：在一台谁都够不到的机器上，它一直来中台领活，每件活启动一个 Agent。
// Agent 以分离进程跑，写文件，所以接单程序可以停下来再回来，还能找到它——还在跑，或已经完事。
// 一件活在任何慢动作之前先存档；结果在交出去之前也先存档，一直留到中台收下为止。
// Windows 上用 runner.mjs 把 Agent 拉起来（输出落文件、退出码落文件），进程存活看 tasklist，停止用 taskkill。
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { HubError, type Hub } from "../protocol/client.ts";
import { HOME } from "../host/home.ts";
import type { Job } from "../protocol/job.ts";
import { addUsage, type Notice, type Result } from "../protocol/validate.ts";
import { adapterFor, type Adapter, type Reading, type Turn, type Usage } from "./agents.ts";
import { promptFor, readMessage, repairPrompt, resultFrom } from "./contract.ts";

const RUNS = path.join(HOME, "worker", "runs");
const RUNNER = path.join(import.meta.dirname, "runner.mjs");
const TIMEOUT_MINUTES = 180;
/** 读一轮结尾的读取器不退出，给它这么久。 */
const GRACE = 30_000;
/** 告诉一个进程停下后，给它这么久。 */
const STOP_GRACE = 10_000;
const REPAIRS = 2;
const KEEP_DAYS = 14;
const WAIT = 50;
const PAUSE = 30_000;
const UNREACHABLE = 10 * 60_000;
const TELL_TRIES = 5;
/** 一段长输出里，够找到它两头的东西。 */
const HEAD = 64 * 1024;
const TAIL = 1024 * 1024;

type Entry = {
  run: number;
  token: string;
  attempt: number;
  job: Job;
  dir: string;
  prompt: string;
  turn: number;
  session: string;
  resume: string | null;
  repairs: number;
  triedFresh: boolean;
  usage?: Usage;
  pid?: number;
  launchedAt?: number;
  finishedAt?: number;
  told?: string;
  stopping?: number;
  why?: "cancel" | "timeout" | "finished";
  result?: Result;
};
export type WorkerHub = Pick<Hub, "work" | "started" | "result">;
export type WorkerOptions = {
  hub: WorkerHub;
  name: string;
  capacity?: number;
  log?: (line: string) => void;
  /** 中台十连不上时用 {text} 跑一次：那之后没有别的办法告诉主人。 */
  unreachable?: string[];
  wait?: number;
  now?: () => number;
};

function save(entry: Entry) {
  const file = path.join(entry.dir, "entry.json");
  writeFileSync(`${file}.tmp`, JSON.stringify(entry));
  renameSync(`${file}.tmp`, file);
}

/** Agent 的环境：绝不给中台的密钥，也没有接单程序自己可能待着的会话。 */
function agentEnvironment(entry: Entry) {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(AGENT_AUTOLOOP_|CLAUDECODE$|CLAUDE_CODE_|CODEX_(?!HOME$))/i.test(name)) continue;
    env[name] = value;
  }
  return {
    ...env,
    AGENT_AUTOLOOP_HOME: HOME,
    AGENT_AUTOLOOP_RUN: String(entry.run),
    AGENT_AUTOLOOP_CONTEXT: path.join(entry.dir, "context.json"),
  };
}

const files = (entry: Entry) => ({
  out: path.join(entry.dir, `stdout-${entry.turn}.log`),
  err: path.join(entry.dir, `stderr-${entry.turn}.log`),
  exit: path.join(entry.dir, `exit-${entry.turn}`),
});

function alive(entry: Entry) {
  if (!entry.pid) return false;
  try {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${entry.pid}`, "/NH"], { encoding: "utf8" });
    return out.includes(String(entry.pid));
  } catch {
    return false;
  }
}

function signal(entry: Entry, force: boolean) {
  if (!entry.pid) return;
  try {
    // /T 把整棵进程树一起停；不带 /F 先发温和的，之后超时再 /F。
    const args = ["/PID", String(entry.pid), "/T"];
    if (force) args.push("/F");
    spawnSync("taskkill", args, { stdio: "ignore" });
  } catch {}
}
function groupAlive(entry: Entry) {
  return alive(entry);
}

function snapshot(file: string) {
  if (!existsSync(file)) return "";
  const size = statSync(file).size;
  if (size <= HEAD + TAIL) return readFileSync(file, "utf8");
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(HEAD);
    const end = Buffer.alloc(TAIL);
    readSync(fd, head, 0, HEAD, 0);
    readSync(fd, end, 0, TAIL, size - TAIL);
    return `${head.toString("utf8")}\n${end.toString("utf8")}`;
  } finally {
    closeSync(fd);
  }
}

export function createWorker({
  hub,
  name,
  capacity = 2,
  log = () => {},
  unreachable,
  wait = WAIT,
  now = Date.now,
}: WorkerOptions) {
  let claim = randomUUID();
  let unreachableSince: number | null = null;
  let told = false;
  let tries = 0;
  mkdirSync(RUNS, { recursive: true });

  const entries = () =>
    readdirSync(RUNS).flatMap((id) => {
      try {
        return [JSON.parse(readFileSync(path.join(RUNS, id, "entry.json"), "utf8")) as Entry];
      } catch {
        return [];
      }
    });

  /** 启动 Agent 的一轮：一个比接单程序活得久的进程，输出和退出码留在文件里。 */
  function launch(entry: Entry, adapter: Adapter, prompt: string) {
    entry.turn += 1;
    entry.launchedAt = now();
    delete entry.finishedAt;
    delete entry.pid;
    delete entry.stopping;
    delete entry.why;
    save(entry);
    const { rule, agent } = entry.job;
    const cwd = expandHome(rule.cwd);
    const turn: Turn = {
      prompt,
      session: entry.session,
      resume: entry.resume,
      cwd,
      model: agent.model,
      effort: agent.effort,
      access: agent.access as Turn["access"],
      command: agent.command,
      contextFile: path.join(entry.dir, "context.json"),
      folder: entry.dir,
    };
    if (!existsSync(cwd)) throw new Error(`在 ${cwd} 启动不了：这个目录不存在`);
    const argv = adapter.command(turn);
    const { out, err, exit } = files(entry);
    // runner 以独立进程组拉起 Agent：输出进文件、退出码进文件，接单程序死了它照跑。
    const child = spawn(process.execPath, [RUNNER, "--out", out, "--err", err, "--exit", exit, "--", ...argv], {
      cwd,
      env: agentEnvironment(entry),
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (error) => log(`run ${entry.run}: ${error}`));
    child.unref();
    entry.pid = child.pid;
    save(entry);
    log(`run ${entry.run} (${rule.name}) turn ${entry.turn} started, pid ${child.pid}`);
  }

  function endWith(entry: Entry, result: Result) {
    entry.result = result;
    save(entry);
  }

  async function start(job: Job) {
    const dir = path.join(RUNS, `${job.run}-${job.attempt}`);
    mkdirSync(dir, { recursive: true });
    const entry: Entry = {
      run: job.run,
      token: job.token,
      attempt: job.attempt,
      job,
      dir,
      prompt: "",
      turn: 0,
      session: job.session ?? randomUUID(),
      resume: job.session,
      repairs: 0,
      triedFresh: false,
    };
    // 在任何慢动作之前存档：从这里往后停下来的接单程序还有这件活。
    save(entry);
    try {
      writeFileSync(path.join(dir, "context.json"), JSON.stringify(job.context, null, 2));
      const adapter = await adapterFor(job.agent.use);
      entry.prompt = promptFor(job, path.join(dir, "context.json"));
      save(entry);
      launch(entry, adapter, entry.prompt);
    } catch (error) {
      endWith(entry, { outcome: "failed", error: String((error as Error).message ?? error).slice(0, 500) });
    }
  }

  function read(entry: Entry, adapter: Adapter, code: number | null): Reading {
    const { out, err } = files(entry);
    return adapter.read(snapshot(out), code, code === null ? "" : snapshot(err));
  }

  function discardReceipt(entry: Entry, adapter: Adapter, problem: string) {
    const original = { ...entry, turn: entry.turn - entry.repairs };
    const reading = read(original, adapter, 0);
    const { result } = resultFrom(readMessage(reading.text!), {
      session: reading.session ?? (adapter.link ? entry.session : undefined),
      usage: entry.usage,
    });
    const notice: Notice = {
      title: `「${entry.job.rule.name}」的回执读不懂`,
      text: `这一轮按第一行算结束了，但它要中台做的事没有生效（${problem}）。原文在 ${files(original).out}。`,
    };
    endWith(entry, { ...result, notice: [...(result.notice ?? []), notice] });
  }

  /** 一轮结束了。它说的话，要么是结果，要么是让它重写一遍的理由。 */
  function conclude(entry: Entry, adapter: Adapter, code: number | null) {
    const seen = read(entry, adapter, entry.finishedAt ? 0 : code);
    entry.usage = addUsage(entry.usage, seen.usage);
    const session = seen.session ?? (entry.turn > 0 && adapter.link ? entry.session : undefined);
    if (seen.session) entry.session = seen.session;
    const usage = entry.usage && { usage: entry.usage };
    const known = session && { session };
    if (entry.why === "cancel") return endWith(entry, { outcome: "cancelled", summary: "已停止", ...known, ...usage });
    if (entry.why === "timeout") {
      const minutes = entry.job.agent.timeout ?? TIMEOUT_MINUTES;
      const error = `超过 ${minutes} 分钟还没结束，已停止`;
      if (entry.repairs) return discardReceipt(entry, adapter, error);
      return endWith(entry, { outcome: "failed", error, ...known, ...usage });
    }
    if (seen.error !== undefined || !seen.text?.trim()) {
      const error = seen.error || "没留下结果";
      if (entry.repairs) return discardReceipt(entry, adapter, error);
      // 那个会话可能不在，或别人正开着：这一趟开个新会话继续。
      if (entry.resume && !entry.triedFresh && entry.repairs === 0) {
        log(`run ${entry.run}: couldn't go on in ${entry.resume} (${error}); starting a new session`);
        entry.triedFresh = true;
        entry.resume = null;
        entry.session = randomUUID();
        try {
          launch(entry, adapter, entry.prompt);
          return;
        } catch (failure) {
          return endWith(entry, { outcome: "failed", error: String(failure).slice(0, 500) });
        }
      }
      return endWith(entry, { outcome: "failed", error: error.slice(0, 500), ...known, ...usage });
    }
    const { result, problem } = resultFrom(readMessage(seen.text), { session, usage: entry.usage });
    if (entry.repairs && !problem && result.outcome === "failed") return discardReceipt(entry, adapter, result.error!);
    if (!problem) return endWith(entry, result);
    // 活干完了，只有回执不对：它重写一遍回执，什么都不用再做。
    if (adapter.link && entry.repairs < REPAIRS && seen.session) {
      log(`run ${entry.run}: receipt not readable (${problem}); asking again`);
      entry.repairs += 1;
      entry.resume = seen.session;
      try {
        launch(entry, adapter, repairPrompt(problem));
        return;
      } catch (error) {
        return discardReceipt(entry, adapter, String(error));
      }
    }
    discardReceipt(entry, adapter, problem);
  }

  /** 看看手上的这轮：还在跑、要停、还是已经结束。 */
  async function check(entry: Entry) {
    if (entry.result) return;
    let adapter: Adapter;
    try {
      adapter = await adapterFor(entry.job.agent.use);
    } catch (error) {
      return endWith(entry, { outcome: "failed", error: String((error as Error).message).slice(0, 500) });
    }
    if (entry.turn === 0) {
      // 接单程序在启动它时停了，还没拉起任何进程。
      if (!entry.prompt) entry.prompt = promptFor(entry.job, path.join(entry.dir, "context.json"));
      try {
        writeFileSync(path.join(entry.dir, "context.json"), JSON.stringify(entry.job.context, null, 2));
        return launch(entry, adapter, entry.prompt);
      } catch (error) {
        return endWith(entry, { outcome: "failed", error: String((error as Error).message ?? error).slice(0, 500) });
      }
    }
    const { exit } = files(entry);
    if (entry.stopping !== undefined) {
      if (groupAlive(entry)) {
        if (now() - entry.stopping > STOP_GRACE) signal(entry, true);
        return;
      }
      return conclude(entry, adapter, existsSync(exit) ? Number(readFileSync(exit, "utf8").trim()) : null);
    }
    if (existsSync(exit)) return conclude(entry, adapter, Number(readFileSync(exit, "utf8").trim()));
    // shell 可能在第一次检查文件和 ps 返回之间发布了它的退出码。
    if (!alive(entry)) {
      return conclude(entry, adapter, existsSync(exit) ? Number(readFileSync(exit, "utf8").trim()) : null);
    }
    const seen = read(entry, adapter, null);
    const session = seen.session ?? (adapter.link ? (entry.resume ?? entry.session) : undefined);
    if (session && session !== entry.told) {
      try {
        await hub.started(entry.run, entry.token, { session, ...(adapter.link && { link: adapter.link(session) }) });
        entry.told = session;
        save(entry);
      } catch (error) {
        log(`run ${entry.run}: couldn't say it started: ${error}`);
      }
    }
    const moment = now();
    const limit = (entry.job.agent.timeout ?? TIMEOUT_MINUTES) * 60_000;
    if (moment - (entry.launchedAt ?? moment) > limit) return stop(entry, "timeout");
    if (seen.finished) {
      // 这一轮结束了但还没走：卡在什么上，答案已经在了。
      if (!entry.finishedAt) {
        entry.finishedAt = moment;
        save(entry);
      } else if (moment - entry.finishedAt > GRACE) {
        stop(entry, "finished");
      }
    }
  }

  function stop(entry: Entry, why: "cancel" | "timeout" | "finished") {
    if (entry.stopping !== undefined || entry.result) return;
    entry.stopping = now();
    entry.why = why;
    save(entry);
    signal(entry, false);
    log(`run ${entry.run}: stopping (${why})`);
  }

  /** 交已经结束的。中台现在收不了的就等下次；拒不收的就丢掉并说明。 */
  async function settle(entry: Entry) {
    if (!entry.result) return;
    try {
      const answer = await hub.result(entry.run, entry.token, entry.result);
      for (const item of answer?.rejected ?? []) log(`run ${entry.run}: not applied: ${JSON.stringify(item)}`);
      log(`run ${entry.run}: ${entry.result.outcome}`);
    } catch (error) {
      if (!(error instanceof HubError) || error.status >= 500) {
        return log(`run ${entry.run}: couldn't hand in the result: ${error}`);
      }
      log(`run ${entry.run}: the hub refused its result (${error.status}: ${error.message}); dropped`);
    }
    unlinkSync(path.join(entry.dir, "entry.json"));
  }

  /** 中台没了的时候，没别的办法告诉主人。 */
  function watchHub(reachable: boolean, moment: number) {
    if (reachable) {
      unreachableSince = null;
      told = false;
      tries = 0;
      return;
    }
    unreachableSince ??= moment;
    if (!unreachable?.length || told || tries >= TELL_TRIES || moment - unreachableSince < UNREACHABLE) return;
    tries += 1;
    const minutes = Math.floor((moment - unreachableSince) / 60_000);
    const text = `${name} 连不上中台已经 ${minutes} 分钟了，派给它的活暂时没人接；它还在一直重试。`;
    const [program, ...args] = unreachable;
    try {
      execFileSync(
        program,
        args.map((part) => part.replaceAll("{text}", text)),
        { timeout: 60_000, stdio: "ignore" },
      );
      told = true;
    } catch (error) {
      log(`couldn't tell anyone the hub is gone: ${error}`);
    }
  }

  /** 一轮：看看手上的，交已经结束的，再来要更多。中台够没够到。 */
  async function tick() {
    for (const entry of entries()) await check(entry);
    for (const entry of entries()) await settle(entry);
    const held = entries();
    let reachable = true;
    try {
      const answer = await hub.work({
        claim,
        wait: held.length ? 1 : wait,
        running: held.map((entry) => entry.run),
        capacity: held.length < capacity,
      });
      for (const id of answer?.cancel ?? []) {
        const entry = held.find((entry) => entry.run === id);
        if (entry) stop(entry, "cancel");
      }
      if (answer?.job) {
        claim = randomUUID();
        await start(answer.job);
      }
    } catch (error) {
      log(`couldn't reach the hub: ${error}`);
      reachable = false;
    }
    watchHub(reachable, now());
    return reachable;
  }

  /** 已完成轮次的输出留一阵子备查，然后清掉。 */
  function tidy(moment = now()) {
    for (const id of readdirSync(RUNS)) {
      const dir = path.join(RUNS, id);
      const expired = moment - statSync(dir).mtimeMs > KEEP_DAYS * 24 * 3600_000;
      if (!existsSync(path.join(dir, "entry.json")) && expired) rmSync(dir, { recursive: true, force: true });
    }
  }

  async function run(signalled: AbortSignal) {
    log(`worker ${name} started`);
    tidy();
    while (!signalled.aborted) {
      if (!(await tick())) await new Promise((resolve) => setTimeout(resolve, PAUSE));
    }
  }

  return { tick, run, entries, tidy };
}

/** `~` 开头的目录在 Windows 上展开成用户目录。 */
function expandHome(cwd: string) {
  const home = homedir();
  return cwd.replace(/^~\//, `${home}/`).replace(/^~\\/, `${home}\\`);
}
