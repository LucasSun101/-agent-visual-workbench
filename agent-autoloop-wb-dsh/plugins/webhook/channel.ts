// 通用 Webhook 通道：把卡片按各家机器人的格式 POST 到一条 webhook 地址。能发不能直接点，
// 回答靠卡片链接：rules.json 里该通道写 "links": true，config.json 里 hub.publicUrl 配成手机能打开的地址。
//  config.json:  "channels": { "dingtalk": { "use": "webhook", "key": "…", "url": "https://oapi.dingtalk.com/robot/send?access_token=…" } }
//  rules.json:   "channels": { "dingtalk": { "name": "钉钉", "links": true } }
import type { Card, ChannelContext } from "../../host/channels.ts";

type Template = (card: Card, link: string | null) => { [key: string]: unknown };

/** 各家机器人的 markdown 模板；可自己加。 */
const TEMPLATES: Record<string, Template> = {
  dingtalk(card, link) {
    const options = card.options.map((option, index) => `${index + 1}. ${option}`).join("\n\n");
    const text = `### ${card.title}\n\n${card.text}\n\n${options}\n\n> [打开回答](${link})`;
    return { msgtype: "markdown", markdown: { title: card.title, text } };
  },
  wecom(card, link) {
    const options = card.options.map((option, index) => `${index + 1}. ${option}`).join("\n");
    const content = `${card.title}\n${card.text}\n${options}\n<a href="${link}">打开回答</a>`;
    return { msgtype: "markdown", markdown: { content } };
  },
  slack(card, link) {
    const blocks = [
      { type: "header", text: { type: "plain_text", text: card.title } },
      { type: "section", text: { type: "mrkdwn", text: card.text } },
      ...card.options.map((option) => ({
        type: "section",
        text: { type: "mrkdwn", text: option },
        accessory: { type: "button", text: { type: "plain_text", text: "选这个" }, value: option, url: link },
      })),
    ];
    return { blocks };
  },
  discord(card, link) {
    const content = `## ${card.title}\n${card.text}\n\n${card.options
      .map((option, index) => `${index + 1}. ${option}`)
      .join("\n")}\n\n[打开回答](${link})`;
    return { content };
  },
};

export default async function webhook({ hub, options, log, signal }: ChannelContext) {
  const url = String(options.url ?? "");
  const template = TEMPLATES[String(options.template ?? "dingtalk")] ?? TEMPLATES.dingtalk;
  if (!url) throw new Error("webhook 通道要配 url");
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
    try {
      const payload = template(card, card.link);
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`返回 ${response.status}`);
      const ref = `webhook-${card.id}-${Date.now()}`;
      await hub.delivered(card.id, card.version, ref);
      log(`卡片 ${card.id} 发到 webhook`);
    } catch (error) {
      log(`卡片 ${card.id} 没发出去：${error}`);
      await hub.failed(card.id, card.version, String(error)).catch(() => {});
    }
  }
}
