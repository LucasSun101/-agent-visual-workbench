// 任何带 print 模式的程序：命令行写在 rules.json，最后一条消息在 stdout。脚本也是 Agent，
// 一个普通命令也不必接提示词：它通过环境（AGENT_AUTOLOOP_CONTEXT）找它需要的。
import { tail, type Adapter } from "../../worker/agents.ts";

export default {
  command: (turn) =>
    (turn.command ?? []).map((part) =>
      part
        .replaceAll("{prompt}", turn.prompt)
        .replaceAll("{model}", turn.model ?? "")
        .replaceAll("{effort}", turn.effort ?? "")
        .replaceAll("{cwd}", turn.cwd)
        .replaceAll("{context}", turn.contextFile),
    ),
  read(stdout, code, stderr) {
    if (code === null) return {};
    if (code !== 0) return { error: `退出码 ${code}：${tail(stderr || stdout) || "没留下原因"}` };
    return { text: stdout };
  },
} satisfies Adapter;
