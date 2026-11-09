// 新装的默认通道：这台电脑上的一条通知，说有东西要看。它不能收回答；
// `agent-autoloop status` 看卡片，`agent-autoloop answer` 回答。
//   "channels": { "desktop": { "key": "…" } } 在 config.json
//   "channels": { "desktop": { "name": "桌面通知" } } 在 rules.json
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Card, ChannelContext } from "../../host/channels.ts";

const WORDS = "运行 agent-autoloop status 查看";
const TITLE = "Agent 问你一个问题";
const NOTIFY = fileURLToPath(new URL("notify.ps1", import.meta.url));

/** 卡片标题是 Agent 写的，所以只当参数，绝不当脚本的一部分。 */
export function notifyCommand(title: string): [string, string[]] {
  const body = `${title}\n${WORDS}`;
  const powershell =
    process.env.SystemRoot + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  return [powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", NOTIFY, "-Title", TITLE, "-Text", body]];
}

function hasDesktop() {
  // 交互登录会话（Console 或 RDP）才有托盘可弹；服务会话（SESSIONNAME 为空）没有。
  return Boolean(process.env.SESSIONNAME);
}

/** 别的通道可以同步一下；这个在中台自己的进程里跑，可能等一个对话框。 */
function show(title: string) {
  const [program, args] = notifyCommand(title);
  return new Promise<void>((resolve, reject) => {
    execFile(program, args, { timeout: 30_000 }, (error) => (error ? reject(error) : resolve()));
  });
}

export default async function desktop({ hub, log, signal }: ChannelContext) {
  const available = hasDesktop();
  while (!signal.aborted) {
    let card: Card | null;
    try {
      ({ card } = await hub.nextCard(50));
    } catch (error) {
      log(`连不上中台：${error}`);
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      continue;
    }
    if (!card) continue;
    // 通知一旦弹出去就没了：更新了也没处去。
    if (card.ref) {
      await hub.delivered(card.id, card.version, card.ref);
      continue;
    }
    if (!available) {
      await hub.delivered(card.id, card.version, `skipped-${card.id}`);
      continue;
    }
    try {
      await show(card.title);
      await hub.delivered(card.id, card.version, `shown-${card.id}`);
    } catch (error) {
      log(`卡片 ${card.id} 的桌面通知没发出：${error}`);
      await hub.failed(card.id, card.version, String(error)).catch(() => {});
    }
  }
}
