# 固定地址：域名 + Cloudflare Tunnel

> 目标：手机永远打开 `https://dsh.你的域名.com`，不用再换地址。
> 代价：域名一年几十块；Cloudflare Tunnel 免费。

## 为什么是这条路

| 方案 | 固定域名 | 要公网 IP | 要管理员 |
|---|---|---|---|
| localhost.run 免费隧道 | ❌ 每次变 | ❌ | ❌ |
| **Cloudflare Tunnel + 自己的域名** | ✅ | ❌ | ❌ |
| frp + VPS | ✅ | ✅ 要买 | ❌ |

Cloudflare Tunnel 是**主动往外连**的，不开任何入站端口，所以不用动防火墙、不用管理员。

## 第 1 步：买一个域名

任选一家，别买贵的（首年 ¥10–40 就够）：

- 阿里云 <https://wanwang.aliyun.com>（.top/.xyz 首年很便宜，需实名）
- 腾讯云 <https://dnspod.cloud.tencent.com>
- Namesilo <https://www.namesilo.com>（美元，约 $9/年，不用实名）
- Porkbun <https://porkbun.com>

**建议**：随便一个后缀都行，`dsh.` 这个子域名是我们自己加的。域名**不需要备案**——因为服务器不在国内，流量走 Cloudflare。

## 第 2 步：把域名交给 Cloudflare 托管

1. 打开 <https://dash.cloudflare.com/sign-up> 注册（邮箱即可）
2. 登录后点 **Add a domain**（或 "添加站点"）
3. 输入你刚买的域名 → 选 **Free** 计划 → 继续
4. Cloudflare 会给你**两个 nameserver**，形如：
   ```
   ada.ns.cloudflare.com
   bob.ns.cloudflare.com
   ```
5. 回到你买域名的网站，找 **DNS 服务器 / Nameservers / 修改 DNS**，把默认的两个换成上面这两个
6. 回 Cloudflare 点 **Check nameservers**，等状态变成 **Active**（几分钟到几小时）

> 这一步是唯一需要等的。等的时候可以先做第 3 步。

## 第 3 步：建隧道，拿 token

1. Cloudflare 控制台左侧 → **Zero Trust**（第一次进会让你起个团队名，随便填）
2. **Networks → Tunnels → Create a tunnel**
3. 类型选 **Cloudflared** → Next
4. 名字随便（如 `dsh`）→ Save
5. 它会显示一条安装命令，**里面 `--token` 后面那一长串**就是要的东西
   ```
   cloudflared.exe service install eyJhIjoi...（很长的 base64）
   ```
   **只复制 `eyJ...` 那一段**，别复制整条命令（service install 需要管理员，我们不用它）

## 第 4 步：配公开域名（在同一个页面）

1. 同一个隧道的 **Public Hostname** 标签 → **Add a public hostname**
2. 填：
   - **Subdomain**: `dsh`
   - **Domain**: 下拉选你的域名
   - **Type**: `HTTP`
   - **URL**: `127.0.0.1:51426`
3. Save

这样 `https://dsh.你的域名.com` 就会转发到本机 51426。

## 第 5 步：告诉我两样东西

- 隧道 token（`eyJ...` 那串）
- 你配的完整域名（如 `dsh.example.com`）

我会把它们写进 `tools/cloudflare.json`，然后：

```
tools\start-fixed.cmd
```

一条命令同时起 cloudflared 和 `dsh web`，而且 `--trusted-host` / `--public-url` 会自动用你的固定域名——**这就是之前"界面能开但数据全空"的根因，这里一次解决**。

## 之后你会得到什么

- 固定地址：`https://dsh.你的域名.com/?token=...`（第一次带 token，之后靠 cookie）
- 自动 HTTPS 证书，Cloudflare 管
- 换网络、重启电脑只要重跑 `start-fixed.cmd`
- 手机可以把这个地址加到主屏

## 安全边界（重要）

- Cloudflare 会**终止 TLS**，所以它能看到明文——但它是正规大厂，且域名只给你自己用。
- 更有价值的那道门是 `dsh web` 自己的 **token**：没有它，`/` 直接 401。
- token 在 URL 里，**当密码对待**；`tools/mobile-url.txt` 里也会存一份，别外传。
- 想立刻让所有旧链接失效：重启 `dsh web`，它会生成新 token。

## 排错

| 现象 | 看什么 |
|---|---|
| 域名打不开 | Cloudflare 后台域名是否 **Active**；Public Hostname 是否指到 `127.0.0.1:51426` |
| 502 Bad Gateway | 本机 `dsh web` 没起；`cloudflared` 窗口是否还开着 |
| 界面能开但数据空 | `--trusted-host` 和实际域名不一致（用 `start-fixed.cmd` 就不会） |
| 手机很慢 | Cloudflare 在国内时快时慢；换手机网络试试 |
