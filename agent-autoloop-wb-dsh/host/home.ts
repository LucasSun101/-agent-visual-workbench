// 这套程序把东西放哪：rules.json、config.json、secrets.env、hub.db 和接单程序的 runs。
// Windows 上默认在 %USERPROFILE%\.agent-autoloop。
import { homedir } from "node:os";
import path from "node:path";

export const HOME = path.resolve(process.env.AGENT_AUTOLOOP_HOME ?? path.join(homedir(), ".agent-autoloop"));
export const RULES_FILE = path.resolve(process.env.AGENT_AUTOLOOP_RULES ?? path.join(HOME, "rules.json"));
