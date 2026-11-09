// 内核读到的规则形状：哪些事件被哪条规则接住。规则的合法性由 protocol/rules.ts 先检查。
export type Access = "read" | "edit" | "full";
export type Source = { name: string; adapter?: string };
type AgentOptions = { model?: string; effort?: string; command?: string[]; timeout?: number };
export type Agent = AgentOptions & { name: string; worker: string; use: string; access: Access };
export type Channel = { name: string; answerers?: string[]; links?: boolean };
export type Tell = "always" | "needed" | "never";
type EventFilter = { source: string; types: string[] };
type When = EventFilter | { cron: string };
type RuleOptions = { skill?: string; prompt?: string; parallel?: number; emits?: EventFilter };
/** 不写 parallel 的规则整组一次只跑一个线程；写了则每个 subject 各开一个，最多这么多个。 */
export type Rule = RuleOptions & { name: string; when: When; to: string; cwd: string; group: string; tell: Tell };
/** 在别处（比如某 App 里）跑的定时任务：中台既不启动也不记录它。 */
export type Elsewhere = { name: string; source: string; to: string; cron: string; where: string };
type Registered = { sources: Record<string, Source>; agents: Record<string, Agent>; channels: Record<string, Channel> };
export type Rules = Registered & { timezone: string; askFirst: string[]; rules: Rule[]; elsewhere: Elsewhere[] };

/** 时钟带来的事件都算这个来源。 */
export const SCHEDULE = "schedule";

function typeMatch(pattern: string, type: string) {
  return pattern === "*" || pattern === type || (pattern.endsWith(".*") && type.startsWith(pattern.slice(0, -1)));
}
export const typeMatches = (patterns: string[], type: string) => patterns.some((pattern) => typeMatch(pattern, type));
export const eventRule = (rule: Rule): rule is Rule & { when: EventFilter } => "source" in rule.when;
export const cronOf = (rule: Rule) => (rule.when as { cron: string }).cron;
