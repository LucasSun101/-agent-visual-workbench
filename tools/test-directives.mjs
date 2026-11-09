// 负责人指令块解析：这是"负责人能指挥世界"的唯一入口，解析错了会乱套，所以单独测。
import { parseDirectives } from "../console/workflow/directives.mjs";

let ok = 0;
let bad = 0;
const check = (name, pass, extra = "") => {
  if (pass) ok++;
  else bad++;
  console.log(`${pass ? "✓" : "✗"} ${name}${extra ? " · " + extra : ""}`);
};

const sample = `
我已经看过素材了，分两件事。

[[ASSIGN 小D]]
把第一段翻译成英文，只输出译文。
[[/ASSIGN]]

[[ASSIGN 小Q]]
检查术语是否前后一致。
[[/ASSIGN]]

[[BRIEF]]
约定：术语统一用 "orchestration"，不要用 "scheduling"。
[[/BRIEF]]

[[HIRE 小周]]
backend=ds
role=worker
persona=你负责写测试，不写功能。
[[/HIRE]]

[[EDIT 小D]]
persona=你现在只做复核，不再翻译。
[[/EDIT]]

就这样。
`;

const d = parseDirectives(sample);
check("解析出 2 个派活", d.assign.length === 2, d.assign.map((a) => a.to).join("、"));
check("派活对象正确", d.assign[0]?.to === "小D" && d.assign[1]?.to === "小Q");
check("派活内容正确", d.assign[0]?.task.includes("翻译成英文"));
check("解析出 1 段工作状态", d.brief.length === 1);
check("工作状态内容正确", d.brief[0]?.includes("orchestration"));
check("解析出 1 个招人", d.hire.length === 1 && d.hire[0]?.name === "小周");
check("招人字段正确", d.hire[0]?.backend === "ds" && d.hire[0]?.role === "worker" && d.hire[0]?.persona.includes("写测试"));
check("解析出 1 个改人", d.edit.length === 1 && d.edit[0]?.name === "小D");
check("改人 patch 正确", d.edit[0]?.patch?.persona?.includes("不再翻译"));

// 普通文字不该被误判
const plain = parseDirectives("这就是一段普通回复，没有任何指令块。");
check("普通文字不产生指令", !plain.assign.length && !plain.brief.length && !plain.hire.length && !plain.edit.length);

// 空内容、残缺块都不该炸
check("空字符串安全", Object.keys(parseDirectives("")).length === 4);
check("残缺块不触发", parseDirectives("[[ASSIGN 小D]] 没有结束标记").assign.length === 0);
check("空派活被忽略", parseDirectives("[[ASSIGN ]]\n\n[[/ASSIGN]]").assign.length === 0);

// 一行里只有块名不该当成内容
const inline = parseDirectives("[[BRIEF]]一句话[[/BRIEF]]");
check("单行块也能解析", inline.brief[0] === "一句话");

console.log(`\n${ok} 通过 · ${bad} 失败`);
process.exit(bad ? 1 : 0);
