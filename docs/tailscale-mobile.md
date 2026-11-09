# 手机上用工作台

> 你的机器：Windows，控制台 `127.0.0.1:51425`，中台 `127.0.0.1:3350`。
> 手机：**HarmonyOS NEXT（纯血鸿蒙）一类装不了 APK 的机型**。
> 结论：**Tailscale 这条路对这类机器不通**（官方无鸿蒙版，社区版 MeshArc 在应用市场搜不到），
> 改走第 1 节的公网隧道。

## 1. 主路径：公网 HTTPS 隧道（手机零安装）

不需要装任何 App，手机只用浏览器。也不需要管理员权限——隧道客户端是**主动往外连**，
不开任何入站端口，**所以不用改防火墙**。

### 起隧道

双击 `tools\tunnel.cmd`，窗口里会出现一行：

```
xxxxx.lhr.life tunneled with tls termination, https://xxxxx.lhr.life
```

**那个窗口不能关**，关了隧道就断。每次重开都会换一个新的随机地址。

### 手机打开

```
https://xxxxx.lhr.life
```

会先看到登录页，输入口令（在起控制台的窗口里打印，也存在 `console/.passcode`）。

### 为什么这条路比 Tailscale 更适合你

| | 隧道 | Tailscale（鸿蒙） |
|---|---|---|
| 手机要装东西 | ❌ 不用 | ✅ 要装，而且搜不到 |
| PWA 能不能装 | ✅ **能**（真 HTTPS） | ❌ 不能（只能 IP + HTTP） |
| 要不要管理员 | ❌ 不用 | ❌ 不用 |
| 出门能不能用 | ✅ 能 | ✅ 能 |

### 代价（必须知道）

1. **地址每次变**。免费版没有固定域名；要固定得注册 localhost.run 账号并配 SSH key。
2. **中继看得见明文**。TLS 在 localhost.run 那边终止，所以它能看到页面内容和 cookie。
   口令能挡住陌生人，但挡不住中继运营方。介意的话只有自建服务器 + frp 才能既固定又私密。
3. 免费隧道有时限和带宽限制，长时间挂着可能被断，重连换地址。

## 2. 口令与安全边界

- 口令在 `console/.passcode`，删掉它再重启控制台会生成新的
- 同一来源 5 分钟内错 6 次就锁 5 分钟（`LOGIN_MAX` / `LOGIN_WINDOW`）
- 写操作（回答卡片、停止一轮）仍然要额外带 `X-WB` 头，跨站表单带不了
- `console/.session` 是本机免登录令牌；**不要把它写进任何会公开的地方**
- owner key 始终只在服务端，浏览器拿不到

## 3. 备用路径 A：同一 Wi-Fi 直连（不收发公网流量）

控制台以 `WB_BIND=lan` 启动时，会额外监听私有网段地址：

```
WB_BIND=lan node console/server.mjs
```

手机打开 `http://<电脑局域网 IP>:51425/?k=<令牌>`。

- 明文 HTTP，只在自己家网络里用
- 需要放行防火墙端口（需管理员）：
  ```powershell
  New-NetFirewallRule -DisplayName "Workbench 51425" -Direction Inbound -Protocol TCP -LocalPort 51425 -Action Allow
  ```
- 装不了 PWA（不是安全上下文）

## 4. 备用路径 B：Tailscale（当前不可用，留档）

- 官方没有鸿蒙版；Android APK 只适用于鸿蒙 4.x 及以下
- 社区原生客户端 **MeshArc**（`io.github.tailscaleohos`）理论可用，但**你的机型和地区搜不到**
- 若哪天装上了：控制台默认 `WB_BIND=auto` 会自动监听 `100.x` 地址，
  手机打开 `http://100.x.x.x:51425`（MeshArc 没有 MagicDNS，只能用 IP）

## 5. 排错

| 现象 | 先看什么 |
|---|---|
| 隧道地址打不开 / 502 | 隧道窗口关了；或 ssh 那条命令写成了 `localhost` 而不是 `127.0.0.1`（IPv6 回环问题）|
| 打开是登录页 | 正常，输口令 |
| 口令输对了还是回登录页 | 浏览器禁了 cookie；换成自带浏览器再试 |
| 锁 5 分钟 | 错 6 次触发了限速，等一会 |
| 页面能开但一直是「中台连不上」 | 中台没起：`node bin\agent-autoloop.ts up` |
| 手机上点按钮没反应 | 看控制台窗口有没有 `回答卡片 #N → 200` |

## 6. 还没做的

- **开机自启**：中台、控制台、隧道三者都要手动起。要常驻得注册计划任务或做个批处理三连。
- **固定域名**：需要 localhost.run 账号 + key，或自建 frp。

