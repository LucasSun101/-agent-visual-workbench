// 这台机器做的一切，都在一个进程里：中台、接单程序和它的通道，按 config.json 里说的来。
// 它们在这里互相说的协议和隔着一整个世界说的一样。停下来时 Agent 还在跑：它们是分离的，
// 接单程序回来时会再找到它们。
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadChannel } from "./channels.ts";
import { readConfig, type ChannelConfig } from "./config.ts";
import { HOME } from "./home.ts";
import { runningUp } from "./service.ts";
import { commitOf } from "./version.ts";
import { hubClient } from "../protocol/client.ts";
import { createWorker } from "../worker/worker.ts";

const log = (who: string) => (line: string) => console.log(`${new Date().toISOString()} [${who}] ${line}`);

/** 一份安装只能有一个：第二个会在第一个旁边接活。 */
function lock() {
  const running = runningUp();
  if (running !== null) throw new Error(`已经在跑了（进程 ${running}）`);
  const file = path.join(HOME, "up.pid");
  writeFileSync(file, String(process.pid));
  return () => {
    try {
      unlinkSync(file);
    } catch {}
  };
}

/** secrets.env：适配器验 webhook 要用，放 rules.json 之外。 */
function loadSecrets() {
  const file = path.join(HOME, "secrets.env");
  if (existsSync(file)) process.loadEnvFile(file);
}

/** 一个通道因任何原因停了就再启。 */
async function keepChannelRunning(
  id: string,
  { use, key, ...options }: ChannelConfig,
  url: string,
  signal: AbortSignal,
) {
  const say = log(id);
  while (!signal.aborted) {
    try {
      const start = await loadChannel(use ?? id);
      await start({ hub: hubClient(url, key), options, log: say, signal });
    } catch (error) {
      say(`stopped: ${error}; starting again in 30 seconds`);
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }
}

export async function up() {
  const config = readConfig();
  mkdirSync(HOME, { recursive: true });
  const unlock = lock();
  const stop = new AbortController();
  const jobs: Promise<unknown>[] = [];
  let close = () => {};
  if (config.hub) {
    loadSecrets();
    const [host, port] = config.hub.listen.split(":");
    process.env.AGENT_AUTOLOOP_PUBLIC_URL = config.hub.publicUrl ?? `http://${config.hub.listen}`;
    const { serve } = await import("./http.ts");
    const say = log("hub");
    const server = serve(Number(port), host, { commit: commitOf() });
    server.on("listening", () => say(`listening on ${config.hub!.listen}`));
    server.on("error", (error) => {
      say(`can't listen: ${error}`);
      process.exit(1);
    });
    close = () => {
      server.close();
      server.closeAllConnections();
    };
  }
  if (config.worker) {
    const { key, name, capacity, unreachable } = config.worker;
    const worker = createWorker({ hub: hubClient(config.url, key), name, capacity, unreachable, log: log("worker") });
    jobs.push(worker.run(stop.signal));
  }
  for (const [id, channel] of Object.entries(config.channels ?? {})) {
    jobs.push(keepChannelRunning(id, channel, config.url, stop.signal));
  }
  const finish = () => {
    stop.abort();
    close();
    unlock();
    process.exit(0);
  };
  process.on("SIGTERM", finish);
  process.on("SIGINT", finish);
  await Promise.all(jobs);
}
