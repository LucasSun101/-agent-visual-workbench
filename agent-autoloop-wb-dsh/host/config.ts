// 这台机器在系统里的位置：config.json，只属于它的主人。一台全能的机器什么都带；
// 只干活的机器只有中台地址和一把接单程序密钥。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HOME } from "./home.ts";

export type ChannelConfig = { use?: string; key: string; [option: string]: unknown };
export type Config = {
  url: string;
  hub?: { listen: string; publicUrl?: string };
  worker?: { name: string; key: string; capacity?: number; unreachable?: string[] };
  channels?: Record<string, ChannelConfig>;
  source?: { name: string; key: string };
  owner?: string;
};

export const CONFIG_FILE = path.join(HOME, "config.json");

export function readConfig(): Config {
  if (!existsSync(CONFIG_FILE)) throw new Error("还没装好：先运行 agent-autoloop init");
  return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Config;
}

export function writeConfig(config: Config) {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(`${CONFIG_FILE}.tmp`, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(`${CONFIG_FILE}.tmp`, CONFIG_FILE);
}
