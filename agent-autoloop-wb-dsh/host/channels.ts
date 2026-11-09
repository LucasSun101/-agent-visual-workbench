// 通道是一个到中台来要卡片的程序，把聊天应用和卡片对上：`plugins/<use>/channel.ts`，
// 先找本机装的那份，再找随程序带的。用别的语言写的通道只需要协议。
import type { Hub } from "../protocol/client.ts";
import { loadPlugin } from "./plugins.ts";

export type Card = {
  id: number;
  version: number;
  ref: string | null;
  kind: "ask" | "notice";
  state: "open" | "decided" | "done" | "closed";
  title: string;
  text: string;
  options: string[];
  recommend: number | null;
  choice: number | null;
  answer: string | null;
  result: string | null;
  link: string | null;
};
export type ChannelContext = {
  hub: Pick<Hub, "nextCard" | "delivered" | "failed" | "answer">;
  options: Record<string, unknown>;
  log: (line: string) => void;
  signal: AbortSignal;
};

export async function loadChannel(use: string) {
  return (await loadPlugin(use, "channel")) as (context: ChannelContext) => Promise<void>;
}
