# 设计规范（不随仓库分发）

这个目录**故意是空的**。

前端设计规范取自两个第三方项目：

| 来源 | 用途 |
|---|---|
| [Nutlope/hallmark](https://github.com/Nutlope/hallmark) | 设计系统的硬线（间距、字重、焦点态） |
| [elayadesign/ai-design-skills](https://github.com/elayadesign/ai-design-skills) | 落地页与排版的具体做法 |

**为什么不把正文放进仓库**：这两份内容是别人写的，Hallmark 还是一家商业产品（usehallmark.com）。
在 MIT 仓库里原样分发它们，涉及上游许可是否允许再分发——我没法替你判断，所以选择不分发。

需要看的时候自己拉：

```bash
node tools/fetch-design-skills.mjs
```

它会下载到本目录，文件名形如 `hallmark__SKILL.md`。下载得到的文件**属于上游**，
受上游许可约束，不要把它们提交进你自己的仓库。
