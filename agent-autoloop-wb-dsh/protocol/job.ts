// 派给接单程序的一件活：它要跑什么、在哪跑、带哪些上下文、用什么令牌交回。
// 事件里的 cwd、agent、access 会被拒收，只有本机规则说了算。
import type { Access } from "../kernel/rules.ts";

export type Job = {
  run: number;
  token: string;
  attempt: number;
  rule: {
    name: string;
    cwd: string;
    skill?: string;
    prompt?: string;
    emits?: { source: string; types: string[] };
  };
  agent: {
    id: string;
    name: string;
    use: string;
    access: Access;
    model?: string;
    effort?: string;
    timeout?: number;
    command?: string[];
  };
  session: string | null;
  askFirst: string[];
  context: {
    events: {
      id: string;
      source: string;
      sourceName: string;
      type: string;
      subject: string;
      summary: string;
      detail: string;
      link: string;
      receivedAt: string;
      hops: number;
    }[];
    answers: {
      card: number;
      title: string;
      options: string[];
      choice: number | null;
      text: string | null;
      about: string | null;
      by: string | null;
      at: string;
    }[];
    timers: { key: string; about: string; at: string }[];
    waiting: { key: string; about: string; at: string }[];
    open: { card: number; title: string; text: string; at: string }[];
    decided: { card: number; title: string; choice: string | number | null; at: string }[];
  };
};
