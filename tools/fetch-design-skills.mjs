// 把两份设计规范（elayadesign/ai-design-skills 与 Nutlope/hallmark）下载到 docs/design-skills/。
// GitHub 直连被中间人干扰，走 jsDelivr。
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "docs", "design-skills");
mkdirSync(OUT, { recursive: true });

const FILES = [
  ["ai-design-skills__landing-page-design.md", "https://cdn.jsdelivr.net/gh/elayadesign/ai-design-skills@main/skills/landing-page-design/SKILL.md"],
  ["hallmark__SKILL.md", "https://cdn.jsdelivr.net/gh/Nutlope/hallmark@main/skills/hallmark/SKILL.md"],
  ["hallmark__README.md", "https://cdn.jsdelivr.net/gh/Nutlope/hallmark@main/README.md"],
  ["ai-design-skills__README.md", "https://cdn.jsdelivr.net/gh/elayadesign/ai-design-skills@main/README.md"],
];

let ok = 0;
for (const [name, url] of FILES) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`✗ ${name} · HTTP ${res.status}`);
      continue;
    }
    const text = await res.text();
    if (text.length < 200) {
      console.log(`✗ ${name} · 内容太短（${text.length}）`);
      continue;
    }
    writeFileSync(path.join(OUT, name), text, "utf8");
    console.log(`✓ ${name} · ${text.length} 字节`);
    ok++;
  } catch (e) {
    console.log(`✗ ${name} · ${e.message}`);
  }
}
console.log(`\n${ok}/${FILES.length} 下载成功 → ${OUT}`);
