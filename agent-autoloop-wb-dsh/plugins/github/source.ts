// GitHub 事件源：收 GitHub 的 webhook，把 issue、PR、评论验签后翻译成中台的事件。
// 配置：rules.json 里 sources.github 写 "adapter": "github"，
// 密钥放 secrets.env 里：AGENT_AUTOLOOP_SECRET_GITHUB=你的 webhook secret
import { createHmac, timingSafeEqual } from "node:crypto";

type Hook = { headers: Record<string, string>; body: string; secret: string };

function verify(secret: string, signature: string | undefined, body: string) {
  if (!signature || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** GitHub 的 webhook 负载里那些人写的文字，只进 detail 当资料，不拼进任何指令。 */
export default function github({ headers, body, secret }: Hook) {
  if (!verify(secret, headers["x-hub-signature-256"], body)) return [];
  const event = headers["x-github-event"] ?? "";
  const delivered = headers["x-github-delivery"] ?? "";
  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return [];
  }
  const kind = payload.action ?? "";
  const type = `${event}.${kind}`;
  if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(type)) return [];
  const repo = payload.repository?.full_name ?? "";
  const issue = payload.issue;
  const pr = payload.pull_request;
  const subject = issue ? `#${issue.number}` : pr ? `#${pr.number}` : "";
  const title = (issue ?? pr)?.title ?? "";
  const bodyText = (issue ?? pr)?.body ?? "";
  const comment = payload.comment?.body ?? "";
  const sender = payload.sender?.login ?? "";
  const detail = [
    `仓库：${repo}`,
    `类型：${event} / ${kind}`,
    `发起人：${sender}`,
    `标题：${title}`,
    "",
    ...(bodyText ? ["## 正文", bodyText, ""] : []),
    ...(comment ? ["## 评论", comment] : []),
  ].join("\n");
  return [
    {
      id: delivered || `${repo}:${subject}:${event}:${kind}`,
      type,
      subject,
      summary: title || `${event} ${kind}`,
      detail,
      link: payload.html_url ?? "",
    },
  ];
}
