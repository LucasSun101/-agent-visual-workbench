// 规则文件的合法性检查，外加默认值补全。校验在进入内核前做，所以写错也能继续按旧规则跑。
import { parseCron } from "../kernel/cron.ts";

export class RulesError extends Error {}

type Raw = Record<string, any>;

const fail = (message: string): never => {
  throw new RulesError(`rules.json 写错了：${message}`);
};
const asRecord = (value: unknown, name: string): Raw => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${name} 要是一个对象`);
  return value as Raw;
};
const asArray = (value: unknown, name: string): Raw[] => {
  if (!Array.isArray(value)) fail(`${name} 要是一个数组`);
  return value as Raw[];
};
const has = (value: Raw, ...names: string[]): boolean =>
  Object.keys(value).every((name) => names.includes(name)) && names.some((name) => Object.hasOwn(value, name));

const text = (value: unknown, name: string, limit: number, required = true): string => {
  const given = value as string | undefined;
  if (given === undefined) {
    if (required) fail(`缺少 ${name}`);
    return "";
  }
  if (typeof given !== "string" || !given.trim() || [...given].length > limit)
    fail(`${name} 要是 ${limit} 字以内的文字`);
  return given.trim();
};
const word = (value: unknown, name: string): string => {
  const given = value as string;
  if (typeof given !== "string" || !/^[a-z][a-z0-9-]*$/.test(given)) fail(`${name} 要用小写字母、数字和 - 开头是字母`);
  return given;
};
const choice = (value: unknown, name: string, options: readonly string[], fallback: string): string => {
  const given = value as string | undefined;
  if (given === undefined) return fallback;
  if (typeof given !== "string" || !options.includes(given)) fail(`${name} 只能是 ${options.join("、")}`);
  return given;
};
const boolean = (value: unknown, name: string, fallback: boolean): boolean => {
  const given = value as boolean | undefined;
  if (given === undefined) return fallback;
  if (typeof given !== "boolean") fail(`${name} 要是 true 或 false`);
  return given;
};
const integer = (value: unknown, name: string, low: number, high: number, fallback: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < low || (value as number) > high)
    fail(`${name} 要是 ${low} 到 ${high} 的整数`);
  return value as number;
};
const typeText = (value: unknown): boolean => typeof value === "string" && /^[a-z][a-z0-9.*-]{0,63}$/.test(value);

/** 校验 when 里的 source/types 或 cron。 */
function whenOf(value: unknown): { when: { source: string; types: string[] } | { cron: string } } {
  const when = asRecord(value, "when");
  if (has(when, "source", "types")) {
    const source = word(when.source, "when.source");
    const types: any[] = asArray(when.types, "when.types");
    if (!types.length || types.length > 20 || types.some((type: any) => !typeText(type)))
      fail("when.types 要是 20 个以内的小写类型，可以用 * 和 .*");
    return { when: { source, types: types.map(String) } };
  }
  if (has(when, "cron")) {
    const cron = text(when.cron, "when.cron", 100);
    if (!parseCron(cron)) fail(`when.cron 要是 5 段 cron：${cron}`);
    return { when: { cron } };
  }
  return fail("when 要是 { source, types } 或 { cron }");
}

function parseRoot(json: string): Raw {
  try {
    return asRecord(JSON.parse(json), "rules.json");
  } catch (error) {
    if (error instanceof RulesError) throw error;
    return fail(`不是合法的 JSON：${(error as Error).message}`);
  }
}

export function parseRules(json: string, now = Date.now(), timezone = "Asia/Shanghai") {
  const root = parseRoot(json);
  const sources: Record<string, { name: string; adapter?: string }> = {};
  for (const [id, value] of Object.entries(asRecord(root.sources ?? {}, "sources"))) {
    const source = asRecord(value, `sources.${id}`);
    word(id, `sources.${id} 的名字`);
    const name = text(source.name, `sources.${id}.name`, 100);
    const adapter = source.adapter === undefined ? undefined : word(source.adapter, `sources.${id}.adapter`);
    sources[id] = { name, ...(adapter ? { adapter } : {}) };
  }
  const agents: Record<string, any> = {};
  for (const [id, value] of Object.entries(asRecord(root.agents ?? {}, "agents"))) {
    const agent = asRecord(value, `agents.${id}`);
    word(id, `agents.${id} 的名字`);
    const name = text(agent.name, `agents.${id}.name`, 100);
    const worker = word(agent.worker, `agents.${id}.worker`);
    const use = word(agent.use, `agents.${id}.use`);
    const access = choice(agent.access, `agents.${id}.access`, ["read", "edit", "full"], "edit");
    agents[id] = {
      name,
      worker,
      use,
      access,
      ...(agent.model !== undefined && { model: text(agent.model, `agents.${id}.model`, 100) }),
      ...(agent.effort !== undefined && { effort: text(agent.effort, `agents.${id}.effort`, 100) }),
      ...(agent.timeout !== undefined && { timeout: integer(agent.timeout, `agents.${id}.timeout`, 1, 1440, 180) }),
      ...(agent.command !== undefined && {
        command: asArray(agent.command, `agents.${id}.command`).map((part: any) => {
          if (typeof part !== "string" || part.length > 500) fail(`agents.${id}.command 要是 500 字以内的命令`);
          return part;
        }),
      }),
    };
  }
  const channels: Record<string, any> = {};
  for (const [id, value] of Object.entries(asRecord(root.channels ?? {}, "channels"))) {
    const channel = asRecord(value, `channels.${id}`);
    word(id, `channels.${id} 的名字`);
    channels[id] = {
      name: text(channel.name, `channels.${id}.name`, 100),
      ...(channel.answerers !== undefined && {
        answerers: asArray(channel.answerers, `channels.${id}.answerers`).map((name) =>
          text(name, "answerers 里的名字", 100),
        ),
      }),
      ...(channel.links !== undefined && { links: boolean(channel.links, `channels.${id}.links`, false) }),
    };
  }
  const rules: any[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of asArray(root.rules ?? [], "rules").entries()) {
    const rule = asRecord(raw, `rules[${index}]`);
    const name = text(rule.name, `rules[${index}].name`, 100);
    if (seen.has(name)) fail(`规则名字重复：${name}`);
    seen.add(name);
    const to = text(rule.to, `rules[${index}].to`, 100);
    if (!agents[to]) fail(`rules[${index}] 的 to 没有对应的 agents：${to}`);
    const cwd = text(rule.cwd, `rules[${index}].cwd`, 300);
    if (!/^(~[/\\]|[A-Za-z]:[\\/]|\\\\|[A-Za-z]:\/|\/)/.test(cwd))
      fail(`rules[${index}].cwd 要是本机目录（Windows 盘符、~/ 或 / 开头）`);
    const group = text(rule.group, `rules[${index}].group`, 100, false) || name;
    const when = whenOf(rule.when);
    rules.push({
      name,
      to,
      cwd,
      group,
      ...when,
      tell: choice(rule.tell, `rules[${index}].tell`, ["always", "needed", "never"], "needed"),
      ...(rule.skill !== undefined && { skill: text(rule.skill, `rules[${index}].skill`, 100) }),
      ...(rule.prompt !== undefined && { prompt: text(rule.prompt, `rules[${index}].prompt`, 10000) }),
      ...(rule.parallel !== undefined && { parallel: integer(rule.parallel, `rules[${index}].parallel`, 1, 20, 1) }),
      ...(rule.emits !== undefined && {
        emits: (() => {
          const emits = asRecord(rule.emits, `rules[${index}].emits`);
          const source = word(emits.source, `rules[${index}].emits.source`);
          if (!sources[source]) fail(`rules[${index}].emits.source 没有对应的 sources：${source}`);
          const types: any[] = asArray(emits.types, `rules[${index}].emits.types`);
          if (!types.length || types.some((type: any) => !typeText(type))) fail(`rules[${index}].emits.types 要是小写类型`);
          return { source, types: types.map(String) };
        })(),
      }),
    });
  }
  const elsewhere: any[] = [];
  for (const [index, raw] of asArray(root.elsewhere ?? [], "elsewhere").entries()) {
    const task = asRecord(raw, `elsewhere[${index}]`);
    const name = text(task.name, `elsewhere[${index}].name`, 100);
    const source = text(task.source, `elsewhere[${index}].source`, 100);
    const to = text(task.to, `elsewhere[${index}].to`, 100);
    const cron = text(task.cron, `elsewhere[${index}].cron`, 100);
    if (!parseCron(cron)) fail(`elsewhere[${index}].cron 要是 5 段 cron`);
    const where = text(task.where, `elsewhere[${index}].where`, 100);
    elsewhere.push({ name, source, to, cron, where });
  }
  const askFirst = asArray(root.askFirst ?? [], "askFirst").map((item: any) => {
    if (typeof item !== "string" || !item.trim() || [...item].length > 200)
      fail("askFirst 里的每一项要是 200 字以内的文字");
    return item.trim();
  });
  return {
    sources,
    agents,
    channels,
    rules,
    elsewhere,
    timezone: root.timezone !== undefined ? text(root.timezone, "timezone", 100) : timezone,
    askFirst,
  };
}
