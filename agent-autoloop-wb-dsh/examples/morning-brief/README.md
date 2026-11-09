# 每日早报

默认每天早上 8 点整理本地笔记和 Git 提交，写入 `briefs/YYYY-MM-DD.md`。

## 启用

1. 把 `rules.json` 里的 `cwd` 改成你的笔记目录（Windows 路径，比如 `C:\Users\you\notes`）。
2. 把规则合入 `%USERPROFILE%\.agent-autoloop\rules.json`。
3. 运行 `agent-autoloop check`，等它到点自动跑；或随时手动触发：
   `agent-autoloop emit schedule.tick --subject now`（不会命中 cron 事件，用真实测试可改 types）。

## 规则

```json
{
  "name": "早报",
  "when": { "cron": "0 8 * * *" },
  "to": "wb",
  "cwd": "C:\\Users\\you\\notes",
  "prompt": "整理昨天到今天本目录的笔记和 git 提交，写今天的早报，存到 briefs/今天日期.md。"
}
```

Agent 结束时按中台约定在最后一条消息里写一句结论即可，不需要回执。
