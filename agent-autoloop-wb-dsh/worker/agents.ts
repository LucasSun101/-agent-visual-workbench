// Agent 是一个进程：给它一段提示词，从它打印的最后一条消息读结果。适配器是每家的不同：
// 它的命令行和怎么读它的输出。`plugins/<use>/agent.ts`，先找本机装的，再找随程序带的。
// 有 print 模式的程序连文件都不用：rules.json 里写 `use: "command"` 加命令行就行。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadPlugin } from "../host/plugins.ts";
import type { Usage } from "../protocol/validate.ts";

export type { Usage } from "../protocol/validate.ts";
export type Access = "read" | "edit" | "full";
/** 一次启动 Agent。`resume` 是要接的会话；没有就是新会话的 id，它可以用。 */
export type Turn = {
  prompt: string;
  session: string;
  resume: string | null;
  cwd: string;
  model?: string;
  effort?: string;
  access: Access;
  command?: string[];
  contextFile: string;
  folder: string;
};
export type Reading = { text?: string; session?: string; usage?: Usage; error?: string; finished?: boolean };
export type Adapter = {
  /** 这一轮的命令行。 */
  command(turn: Turn): string[];
  /** 它的输出说到哪了。`code` 是 null 表示还在跑，或者它没留话就死了。 */
  read(stdout: string, code: number | null, stderr: string): Reading;
  /** 在哪里能打开这个会话。 */
  link?(session: string): string;
  /** 装好没有、登录没有：哪儿不对，说人话，或什么也不说。 */
  check?(): string | null;
};

const adapters = new Map<string, Adapter>();

export async function adapterFor(use: string): Promise<Adapter> {
  const known = adapters.get(use);
  if (known) return known;
  const adapter = (await loadPlugin(use, "agent")) as Adapter;
  adapters.set(use, adapter);
  return adapter;
}

const found = new Map<string, string | null>();

/** 程序在哪：PATH 上（任务计划和注册表启动时 PATH 很干净），或者在这些默认位置之一。 */
export function findProgram(name: string, elsewhere: () => string[] = () => []) {
  if (!found.has(name)) {
    let onPath: string | null = null;
    try {
      const printed = execFileSync("where", [name], { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] });
      onPath = printed.trim().split("\n").at(-1) || null;
    } catch {}
    found.set(name, onPath ?? elsewhere().find(existsSync) ?? null);
  }
  const program = found.get(name);
  if (!program) throw new Error(`找不到 ${name}：先装好并登录`);
  return program;
}

/** 一段输出的结尾，用来解释为什么失败。 */
export const tail = (text: string, length = 300) => text.trim().slice(-length);
