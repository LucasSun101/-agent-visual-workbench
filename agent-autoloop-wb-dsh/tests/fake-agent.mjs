// 端到端测试用的假 Agent：模拟一个真实命令行 Agent 的「最后一条消息 + 回执」行为。
// - 收到 try.start 且还没有回答时：输出「问了一个问题」+ ask 回执（选颜色）
// - 收到回答（answers 非空）时：输出「你选了某某，试跑通过」
// 通过 AGENT_AUTOLOOP_CONTEXT 环境变量读中台给的资料文件。
import { readFileSync } from "node:fs";

const contextFile = process.env.AGENT_AUTOLOOP_CONTEXT;
let context = {};
try {
  context = JSON.parse(readFileSync(contextFile, "utf8"));
} catch {}
const answers = context.answers ?? [];
const events = context.events ?? [];
const isTry = events.some((e) => e.type && e.type.startsWith("try"));

if (isTry && answers.length === 0) {
  console.log("问了一个问题");
  console.log("```agent-autoloop");
  console.log(
    JSON.stringify({
      ask: [
        {
          title: "试跑：选一个颜色",
          text: "这是一次试跑，选哪个都行。",
          options: ["蓝色", "绿色"],
          key: "try-color",
        },
      ],
    }),
  );
  console.log("```");
} else if (answers.length > 0) {
  const chosen = answers[0].options?.[answers[0].choice] ?? answers[0].text ?? "蓝色";
  console.log(`你选了${chosen}，试跑通过`);
} else {
  console.log("没事可做：没有要处理的事件");
}
