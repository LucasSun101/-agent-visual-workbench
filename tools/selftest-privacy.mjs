#!/usr/bin/env node
// 对抗性自测：证明 check-privacy.mjs 真的能抓到东西。
//
// 为什么需要它：2026-11-09 第二轮审计构造了 10 个反例，9 个被当时的检查器 exit=0 放行，
// 而 `npm test` 是绿的 —— 绿得没有意义。这个脚本把那 10 个反例固定成回归用例：
// 每次 `npm test` 都重新造一遍，跑检查器，要求它**必须报错**。
//
// 所有假值都在临时目录里用字符串拼接现场生成，本文件里没有任何可被扫出的字面量。
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
  writeFileSync,
  existsSync,
  openSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
// 假值全部运行时拼接：本文件不该出现能被扫出的字面量（否则检查器会正确地报它自己）
const FAKE = "sk-" + "A1b2C3d4E5f6G7h8I9j0".repeat(2);
const REALNAME = "Real" + "Name";
const USERSEG = "demo" + "-user";
const CORPMAIL = "admin@" + "RealCorp" + ".com";
const TUNNEL = "abc123" + "def456";

const cases = [
  {
    name: "① 整文件豁免（文件名里带 audit-report）",
    setup: (d) => write(d, "docs/notes-audit-report.md", `key = ${FAKE}`),
    want: "疑似 API Key",
  },
  {
    name: "② 普通文档里的密钥（曾因整文件豁免而放过）",
    setup: (d) => write(d, "docs/notes.md", `key = ${FAKE}`),
    want: "疑似 API Key",
  },
  {
    name: "③ 构建目录里的泄漏",
    setup: (d) => write(d, "dist/leak.md", `key = ${FAKE}`),
    want: "疑似 API Key",
  },
  {
    name: "④ 正斜杠写法的个人目录",
    setup: (d) => write(d, "src/a.txt", "C:/Users/" + REALNAME + "/notes.txt"),
    want: "个人目录路径",
  },
  {
    name: "⑤ 真实管理员邮箱",
    setup: (d) => write(d, "src/b.txt", "mail: " + CORPMAIL),
    want: "邮箱地址",
  },
  {
    name: "⑥ 短 token 的 URL 参数",
    setup: (d) => write(d, "src/c.txt", "http://x/?tok" + "en=" + "abcd" + "1234"),
    want: "带凭据的 URL 参数",
  },
  {
    name: "⑦ 尖括号包住的真实用户名",
    setup: (d) => write(d, "src/d.txt", ["C:", "Users", "<" + USERSEG + ">", "secret.txt"].join("\\")),
    want: "个人目录路径",
  },
  {
    name: "⑧ .gitignore 用 **/workflow/ 这种等价写法",
    setup: (d) => {
      const p = path.join(d, ".gitignore");
      writeFileSync(p, readFileSync(p, "utf8") + "\n**/workflow/\n");
    },
    want: ".gitignore",
  },
  {
    name: "⑨ 超过 2 MB 的文件里藏 key",
    setup: (d) => write(d, "docs/big.md", "x".repeat(2_100_000) + `\nkey = ${FAKE}\n`),
    want: "文件过大",
  },
  {
    name: "⑩ 同一行先占位后真实隧道域名",
    setup: (d) => write(d, "src/e.txt", "见 xxxxx.lhr.life，实际 https://" + TUNNEL + ".lhr.life"),
    want: "隧道域名",
  },
  {
    name: "⑪ 文件名即秘密（控制台口令）",
    setup: (d) => write(d, "console/.passcode", "123456"),
    want: "控制台登录口令",
  },
];

function write(dir, rel, content) {
  const p = path.join(dir, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content, "utf8");
}

const tmp = mkdtempSync(path.join(tmpdir(), "wb-privacy-"));
let pass = 0;
let fail = 0;

try {
  // 复制检查器 + 造一个"基线干净"的仓库（有 LICENSE 和安全版 .gitignore，避免无关噪声）
  mkdirSync(path.join(tmp, "tools"), { recursive: true });
  copyFileSync(path.join(ROOT, "tools", "check-privacy.mjs"), path.join(tmp, "tools", "check-privacy.mjs"));
  writeFileSync(path.join(tmp, "LICENSE"), "MIT\n", "utf8");
  writeFileSync(path.join(tmp, ".gitignore"), "/workbench/\n/workflow/\n*.key\n", "utf8");

  const baseline = runChecker(tmp);
  if (baseline.status === 0) {
    console.log("  ✓ 基线（干净仓库）检查器报通过");
    pass++;
  } else {
    console.log(`  ✗ 基线不干净，用例会被噪声掩盖：\n${baseline.out.slice(0, 400)}`);
    fail++;
  }

  for (const c of cases) {
    const dir = mkdtempSync(path.join(tmpdir(), "wb-case-"));
    try {
      // 每个用例一个独立副本，互不干扰
      copyDir(tmp, dir);
      c.setup(dir);
      const r = runChecker(dir);
      const caught = r.status !== 0 && r.out.includes(c.want);
      if (caught) {
        console.log(`  ✓ ${c.name} → 被抓到（${c.want}）`);
        pass++;
      } else {
        console.log(`  ✗ ${c.name} → 漏了（期望含「${c.want}」，实际 exit=${r.status}）`);
        fail++;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function copyDir(from, to) {
  for (const name of readdirSync(from)) {
    const s = path.join(from, name);
    const t = path.join(to, name);
    let st;
    try {
      st = statSync(s);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      mkdirSync(t, { recursive: true });
      copyDir(s, t);
    } else {
      mkdirSync(path.dirname(t), { recursive: true });
      copyFileSync(s, t);
    }
  }
}

function runChecker(dir) {
  const log = path.join(tmpdir(), `wb-privacy-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
  const fd = openSync(log, "w");
  let status = 1;
  try {
    execFileSync(process.execPath, [path.join(dir, "tools", "check-privacy.mjs")], {
      cwd: dir,
      stdio: ["ignore", fd, fd],
      timeout: 120_000,
    });
    status = 0;
  } catch (e) {
    status = e.status ?? 1;
  } finally {
    closeSync(fd);
  }
  const out = existsSync(log) ? readFileSync(log, "utf8") : "";
  rmSync(log, { force: true });
  return { status, out };
}

console.log(`\n对抗性自测：${pass} 通过 · ${fail} 失败`);
if (fail) {
  console.log("检查器又漏东西了 —— 别把 npm test 当放行依据。");
  process.exit(1);
}
