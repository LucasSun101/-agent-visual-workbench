// 卡片链接打开的极简网页：看内容、点选项回答。中台的门面用它展示给别人。
import type { Row } from "./evolve.ts";

const html = (body: string) =>
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent 中台 · 卡片</title><style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:#0f1115;color:#e6e6e6;line-height:1.6}
main{max-width:560px;margin:48px auto;padding:0 20px}h1{font-size:20px;margin:0 0 8px}
p{margin:8px 0;white-space:pre-wrap;color:#c9cdd4}form{margin-top:24px;display:flex;flex-direction:column;gap:8px}
button{font:inherit;padding:10px 14px;border:1px solid #2b2f3a;border-radius:8px;background:#1a1d26;color:#e6e6e6;text-align:left;cursor:pointer}
button:hover{background:#242836;border-color:#3b4250}button.recommended{border-color:#4a7dff}
.note{margin-top:16px;font-size:13px;color:#7a8291}</style><main>${body}</main>`;

const PAGE_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };

export function cardPage(card: Row) {
  const options = (JSON.parse(card.options) as string[]).map(
    (option, index) =>
      `<button type="submit" name="choice" value="${index}"${index === card.recommend ? ' class="recommended"' : ""}>${escapeHtml(option)}${index === card.recommend ? "（推荐）" : ""}</button>`,
  );
  return html(
    `<h1>${escapeHtml(card.title)}</h1><p>${escapeHtml(card.text)}</p>
<form method="post">${options.join("")}</form>
<p class="note">回答后这条链接原地刷新显示结果，不用重新打开。</p>`,
  );
}

export function wordsPage(words: string) {
  return html(`<h1>出错了</h1><p>${escapeHtml(words)}</p>`);
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export { PAGE_HEADERS };
