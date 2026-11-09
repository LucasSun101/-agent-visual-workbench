# 前端设计规则（调试界面时先读这个）

改 `console/public/` 下任何界面之前，对照这份清单。它把两份外部规范里**对我们适用**的条款挑出来，落成了可检查的形式。

## 来源

这两份规范**不随仓库分发**（第三方内容，见 `docs/design-skills/README.md`）。需要原文时自己拉取。

| 规范 | 原始地址 |
|---|---|
| **Nutlope/hallmark**（Hallmark 是商业产品） | https://github.com/Nutlope/hallmark |
| **elayadesign/ai-design-skills** | https://github.com/elayadesign/ai-design-skills |

拉取到本地：`node tools/fetch-design-skills.mjs` → 写入 `docs/design-skills/`（**已被 .gitignore 排除，别提交**）

## 硬性底线（hallmark 的 Floor，不可豁免）

只列**对我们这个控制台适用**的；不适用的已略去。

| # | 规则 | 我们怎么算过 |
|---|---|---|
| 1 | 所有颜色和字体都走 `:root` 令牌，令牌块之后不许出现字面色值 | ✅ 56 个令牌；令牌块之后 0 处 `#hex`/`rgba()`（透明度用 `color-mix`） |
| 2 | 禁止 `transition: all`；禁止动 `width/height/top/left` | ✅ 只动 `transform`/`opacity`/`background`/`border-color` |
| 5 | 图片类栅格轨道用 `minmax(0, 1fr)`；长标题加 `overflow-wrap` | ✅ `.wf` 栅格已用 `minmax(0, 1fr)` |
| 6 | **每个可交互元素都要有 `:focus-visible`，且立即出现** | ✅ 全局 `*:focus-visible { box-shadow: var(--ring) }` |
| 7 | 每个动效都要有 `prefers-reduced-motion: reduce` 兜底 | ✅ 全局降级为 1ms |
| 9 | **禁止小号大写、字距加宽（tracked caps）的标签** | ✅ 已清除 4 处 `letter-spacing`（中文加字距会显得断字） |
| 10 | 禁止装饰性状态圆点 | ✅ 运行区已改用文字状态 + 边框色 |
| 11 | 禁止：紫蓝渐变 / 卡中卡 / **emoji 当图标** / 手画浏览器窗口 | ✅ 图标全是统一笔画的内联 SVG；渐变已清零 |

## 落地到本项目的三条自查

改完界面，跑一遍：

```powershell
# 1. 样式硬线：字面色值、令牌完整性、渐变、单边描边、字距、动效、焦点环
node tools/check-css.mjs

# 2. DOM 契约：JS 里 $("id") 用到的元素必须在 index.html 里
node tools/verify-console.mjs <session-token>
```

改过颜色之后，额外确认"只动了颜色、没动结构"：

```powershell
node tools/verify-tokenize.mjs   # 剔除 :root 后逐行比对，应该完全一致
```

肉眼检查（这两条机器查不出来）：

- [ ] 每个能点/能拖的东西，**hover 时样子会变**（不然用户不知道它能操作）
- [ ] 拖拽类交互，**拖起来之后能看清落点**（虚线框 / 高亮目标）

## 设计令牌（`style.css` 顶部）

```
间距  --sp-25/50/75/100/200/300/400  = 2/4/8/12/16/24/32
字号  --fs-12/14/16/18
圆角  --r-sm/md/lg/xl
动效  --ease = cubic-bezier(0.22, 1, 0.36, 1)

底色（越亮层级越高）
  --bg --bg-sunken
  --surface-0 输入框/列表行   --surface-1 面板   --surface-2 内嵌块   --surface-3 按钮
  --surface-hover 悬停   --surface-raised 抽屉/浮层   --surface-bar 顶栏   --surface-notice 通知卡

描边    --line（普通） --line-2（聚焦/悬停） --line-strong（选中/浮层） --dot（画布点阵）
文字    --text --text-soft --dim --faint --dot-off
状态    --accent --ok --warn --bad --run --unknown
状态变体 --bad-text --bad-text-strong --bad-text-soft --accent-text
        --accent-bg --accent-bg-hover --accent-line --edge（画布连线）
阴影    --shade-35/40/45/55  --hairline
```

**规则**：

1. 写新样式只能取上面的档位值，不要写 `11.5px`、`7px`、`13px`。
2. 需要透明度的时颜色，用 `color-mix(in srgb, var(--accent) 45%, transparent)`，**不要写 rgba**。
   - 需要 Chrome/Edge 111+ / Safari 16.2+（2023 年 3 月起的版本）。本机浏览器满足。
3. 新增颜色先问"它属于哪一层"，别新开令牌。之前 `#121d28`/`#101c27`/`#1c2c3b` 三种几乎一样的悬停底色，已经合并成一个 `--surface-hover`。

## 欠账

1. ~~字面色值未令牌化~~ —— **已还**（2026-11-08，56 个令牌，结构等价性已验证）
2. **没有 `sloplint`**——hallmark 自带一个 lint 脚本（`scripts/sloplint.mjs`），我们没引。`check-css.mjs` 是它的廉价替代。
3. **触控目标尺寸**——移动端按钮普遍 34-36px，低于 44px 的建议值。手机端实际用起来需确认。
