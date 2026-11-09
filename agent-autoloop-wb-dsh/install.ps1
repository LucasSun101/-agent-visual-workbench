# 安装 Agent 自动化中台（Windows 版）：一份检出放在 %USERPROFILE%\.agent-autoloop\app，
# 什么都不用编译、不用装别的。用法：
#   powershell -ExecutionPolicy Bypass -File install.ps1
# 或从 GitHub 直接跑：  irm <你的仓库 install.ps1 的 raw 地址> | iex
#
# 注意：本文件必须保存为 **UTF-8 带 BOM**。Windows PowerShell 5.1 遇到不含 BOM 的 UTF-8
# 会按 ANSI 解码，中文注释会吃掉后面的引号，导致解析阶段就报错（而 7.x 默认 UTF-8，看不出问题）。
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Arguments
)
$ErrorActionPreference = "Stop"

$Root = if ($env:AGENT_AUTOLOOP_HOME) { $env:AGENT_AUTOLOOP_HOME } else { Join-Path $HOME ".agent-autoloop" }
$App = Join-Path $Root "app"
$Program = Join-Path $App "bin\agent-autoloop.ts"

function Die($words) { Write-Host $words; exit 1 }

# ---- 检查依赖 ---------------------------------------------------------------
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
  Die "需要 Node.js 22.18 或更新（推荐 24），这台电脑上没找到。去 https://nodejs.org 装好再跑。"
}
$NodeVersion = (& $NodeCmd.Source --version).Trim()
if ($NodeVersion -notmatch '^v(\d+)\.(\d+)') { Die "读不出 Node 版本：$NodeVersion" }
if ([int]$Matches[1] -lt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -lt 5)) {
  Die "需要 Node.js 22.18 或更新（推荐 24），现在是 $NodeVersion。"
}
$HasGit = [bool](Get-Command git -ErrorAction SilentlyContinue)

# ---- 拉代码 ----------------------------------------------------------------
# 本地跑（当前目录就是仓库）时不需要 git、也不需要 AGENT_AUTOLOOP_REPO；
# 只有真正要 clone 的分支才要求仓库地址，别让本地用户被一个用不到的变量卡住。
$InApp = $PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "bin\agent-autoloop.ts"))
if ($InApp) {
  $App = $PSScriptRoot
  $Program = Join-Path $App "bin\agent-autoloop.ts"
} elseif (Test-Path (Join-Path $App ".git")) {
  if (-not $HasGit) { Die "需要 git 才能更新。装 Git for Windows 后重跑。" }
  Write-Host "更新中……"
  & git -C $App pull --ff-only --quiet
  if ($LASTEXITCODE -ne 0) { Die "更新失败。" }
} else {
  if (-not $HasGit) { Die "需要 git 才能下载。装 Git for Windows 后重跑。" }
  $Repo = $env:AGENT_AUTOLOOP_REPO
  if (-not $Repo) {
    Die "要从远程下载，请先设置环境变量 AGENT_AUTOLOOP_REPO=<你的仓库地址>.git（例如 https://github.com/<your-name>/<repo>.git）。`n或者在仓库目录里直接跑本脚本（本地安装不需要它）。"
  }
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  Write-Host "下载中……"
  & git clone --quiet --depth 1 -- $Repo $App
  if ($LASTEXITCODE -ne 0) { Die "下载失败。" }
}

# ---- 把命令装到 PATH -------------------------------------------------------
$BinDir = Join-Path $HOME ".local\bin"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$Shim = Join-Path $BinDir "agent-autoloop.cmd"
# 用本机 node 的实际路径生成 shim，避免 PATH 里没有 node 时命令不可用。
# 顺序很重要：node.exe 必须是**被执行的程序**，不能作为参数传给 node。
$NodePath = $NodeCmd.Source
$ShimText = "@echo off`r`n`"$NodePath`" --disable-warning=ExperimentalWarning --experimental-sqlite `"$Program`" %*"
Set-Content -Path $Shim -Value $ShimText -Encoding ASCII

# 把 .local\bin 加进用户 PATH（若还不在）。
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -and ($UserPath -split ';') -notcontains $BinDir) {
  [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
} elseif (-not $UserPath) {
  [Environment]::SetEnvironmentVariable("Path", $BinDir, "User")
}
$env:Path = "$BinDir;$env:Path"

# ---- 首次装，或更新 ---------------------------------------------------------
# 直接调用 node，别拼字符串再 Invoke-Expression（路径里有空格时会碎）。
$NodeArgs = @("--disable-warning=ExperimentalWarning", "--experimental-sqlite", $Program)
if (Test-Path (Join-Path $Root "config.json")) {
  Write-Host "更新好了。"
  if ($Arguments -notcontains "--no-service") { & $NodePath @NodeArgs service install }
} else {
  & $NodePath @NodeArgs init @Arguments
}

Write-Host ""
Write-Host "装好了。打开新的终端，运行 agent-autoloop try 跑一遍完整流程。"
Write-Host "需要拍板时它会在桌面弹通知；运行 agent-autoloop status 看全貌。"
