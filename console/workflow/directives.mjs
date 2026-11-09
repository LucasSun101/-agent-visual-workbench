// 负责人的"指令块"解析器。
//
// 负责人没法直接改世界——它只是输出文字。它想改变什么，就在输出里写指令块，
// 控制台解析后按权限执行：派活和写工作状态直接做；招人/改人先进审批队列等你点头。
//
//   [[ASSIGN 小D]]
//   把这部分重写一遍
//   [[/ASSIGN]]
//
//   [[BRIEF]]
//   结论：方案 A 不可行。
//   [[/BRIEF]]
//
//   [[HIRE 小周]]
//   backend=ds
//   role=worker
//   persona=你负责写测试。
//   [[/HIRE]]
//
//   [[EDIT 小D]]
//   persona=你现在只做复核。
//   [[/EDIT]]

const block = (tag) => new RegExp(`\\[\\[${tag}(?:[ \\t]+([^\\]\\n]*))?\\]\\]([\\s\\S]*?)\\[\\[\\/${tag}\\]\\]`, "g");

function fields(body) {
  const out = {};
  for (const line of String(body ?? "").split("\n")) {
    const m = line.match(/^\s*([a-zA-Z_\u4e00-\u9fa5]+)\s*[=:：]\s*(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

/**
 * @returns {{assign: Array, brief: Array, hire: Array, edit: Array, unknown: string[]}}
 */
export function parseDirectives(text) {
  const out = { assign: [], brief: [], hire: [], edit: [] };
  if (!text) return out;
  const src = String(text);

  for (const m of src.matchAll(block("ASSIGN"))) {
    const to = (m[1] ?? "").trim();
    const task = m[2].trim();
    if (to && task) out.assign.push({ to: to.slice(0, 40), task: task.slice(0, 2000) });
  }
  for (const m of src.matchAll(block("BRIEF"))) {
    const t = m[2].trim();
    if (t) out.brief.push(t.slice(0, 1200));
  }
  for (const m of src.matchAll(block("HIRE"))) {
    const name = (m[1] ?? "").trim();
    if (!name) continue;
    const f = fields(m[2]);
    out.hire.push({
      name: name.slice(0, 40),
      backend: (f.backend ?? "ds").slice(0, 10),
      role: f.role === "lead" ? "lead" : "worker",
      persona: (f.persona ?? "").slice(0, 2000),
      defaultTask: (f.defaultTask ?? "").slice(0, 4000),
    });
  }
  for (const m of src.matchAll(block("EDIT"))) {
    const name = (m[1] ?? "").trim();
    if (!name) continue;
    const f = fields(m[2]);
    const patch = {};
    for (const k of ["backend", "role", "persona", "defaultTask", "name"]) {
      if (f[k] !== undefined) patch[k] = String(f[k]).slice(0, 2000);
    }
    if (Object.keys(patch).length) out.edit.push({ name: name.slice(0, 40), patch });
  }
  return out;
}

/** 给负责人看的指令说明（拼进它的提示词）。 */
export const DIRECTIVE_HELP = [
  "你是这个项目的负责人，老板会直接跟你对话。记住几条：",
  "1. 你手上有工具（读文件、写文件、跑命令）。凡是问「项目里现在是什么样」，先去看，别凭印象答。",
  "2. 回答先给结论，再给理由。老板要判断，不要过程。",
  "3. 你能指挥别的员工，但不能自己改员工档案——招人/改人要老板批准。",
  "",
  "派活（它会独立执行，结果不会自动回到你这里）：",
  "[[ASSIGN 员工名字]]",
  "写清三件事：做什么、怎么算做完、产出放哪",
  "[[/ASSIGN]]",
  "",
  "把结论写进项目工作状态（之后每个员工都会看到）：",
  "[[BRIEF]]",
  "一句话结论或约定",
  "[[/BRIEF]]",
  "",
  "招人 / 改人（进审批队列，老板点了才生效）：",
  "[[HIRE 名字]]",
  "backend=ds",
  "role=worker",
  "persona=它是干什么的、边界在哪",
  "[[/HIRE]]",
  "",
  "[[EDIT 名字]]",
  "persona=新的角色设定",
  "[[/EDIT]]",
  "",
  "不要做的：",
  "- 没有明确需要就别写指令块。老板问「你觉得呢」不等于让你派人。",
  "- 一次最多派两件活，先确认方向再铺开。",
  "- 拿不准就问，别猜。",
].join("\n");
