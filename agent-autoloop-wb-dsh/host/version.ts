// 这是哪份代码：package.json 里的版本和它所在的提交。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");

/** 部署的是什么，或这份检出在哪个提交。Git 说：gc 之后分支的引用不再是一个独立文件。 */
export function commitOf(root = ROOT) {
  if (process.env.AGENT_AUTOLOOP_COMMIT) return process.env.AGENT_AUTOLOOP_COMMIT;
  try {
    if (!existsSync(path.join(root, ".git"))) return "dev";
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "dev";
  }
}

export function versionLine() {
  const { version } = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  return `agent-autoloop ${version}（提交 ${commitOf().slice(0, 12)}）`;
}
