// 验证「工作状态」确实进了每个员工的提示词，而且顺序/裁剪正确。
// 这是唯一能证实"所有员工都知道"的办法——真跑模型太贵，直接测拼接函数。
import { instructionFor } from "../console/workflow/runner.mjs";

let ok = 0;
let bad = 0;
const check = (name, pass, extra = "") => {
  if (pass) ok++;
  else bad++;
  console.log(`${pass ? "✓" : "✗"} ${name}${extra ? " · " + extra : ""}`);
};

const base = {
  employee: { persona: "你是复核员。" },
  node: { text: "复核上一步。" },
  runDir: "C:\\tmp\\ws-1\\run-1",
  upstream: ["C:\\tmp\\ws-1\\run-1\\a.md"],
  outFile: "C:\\tmp\\ws-1\\run-1\\b.md",
  brief: "目标：把 X 做成 Y。\n约定：只改 src/，别碰 lock 文件。",
};

const withBrief = instructionFor(base);
check("含有项目状态段", withBrief.includes("【项目状态】"));
check("项目状态原样带入", withBrief.includes("只改 src/，别碰 lock 文件"));
check("角色设定还在", withBrief.includes("你是复核员"));
check("本次任务还在", withBrief.includes("复核上一步"));
check("上游文件还在", withBrief.includes("a.md"));
check("项目状态排在最前", withBrief.indexOf("【项目状态】") < withBrief.indexOf("【你的角色】"));

const noBrief = instructionFor({ ...base, brief: "" });
check("没有工作状态时不出现空段落", !noBrief.includes("【项目状态】"));

const huge = instructionFor({ ...base, brief: "长".repeat(5000) });
check("超长工作状态被裁到 1200 字", huge.includes("【项目状态】") && huge.length <= 3900, `${huge.length} 字`);
check("裁剪后仍保留本次任务", huge.includes("复核上一步"));

// 负责人应该拿到工作手册，普通员工不该看到
const lead = instructionFor({ ...base, employee: { persona: "你是负责人。", role: "lead" } });
check("负责人拿到工作手册", lead.includes("工作手册") && lead.includes("[[ASSIGN 员工名字]]"));
check("手册里写了「最多派两件」", lead.includes("最多派两件"));
check("普通员工没有工作手册", !withBrief.includes("工作手册"));
check("负责人提示词仍在额度内", lead.length <= 3900, `${lead.length} 字`);

console.log(`\n${ok} 通过 · ${bad} 失败`);
process.exit(bad ? 1 : 0);
