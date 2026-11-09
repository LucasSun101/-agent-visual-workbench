// `agent-autoloop status` 里的花费行，来自 /v1/state 的完成时合计。Agent 自己报使用量，或者不报：
// 一个普通命令什么都不说，有些给 token 不给价格。所以每个数字都说明它漏掉了多少轮。
import type { Spending } from "../kernel/state.ts";
const count = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
/** 保留两位：便宜模型上的一天会读作零。 */
const dollars = (amount: number) => (amount > 0 && amount < 0.01 ? "<$0.01" : `$${amount.toFixed(2)}`);

function tally(label: string, { rounds, tokens, cost, missingTokens, missingCost }: Spending) {
  if (!rounds) return `${label} 0 轮`;
  const missing = (silent: number) => (silent ? `（${silent} 轮没上报）` : "");
  const shownTokens =
    missingTokens === rounds
      ? "Token 没上报"
      : `${count.format(tokens).replace(/(万|亿)/, " $1")} Token${missing(missingTokens)}`;
  const shownCost = missingCost === rounds ? "费用没上报" : `${dollars(cost)}${missing(missingCost)}`;
  return `${label} ${rounds} 轮 · ${shownTokens} · ${shownCost}`;
}

export function spendLine(spending: { today: Spending; week: Spending }) {
  return `${tally("今天", spending.today)}    ${tally("最近 7 天", spending.week)}`;
}
