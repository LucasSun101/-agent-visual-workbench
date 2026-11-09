# Windows 桌面通知：Agent 有卡片时在托盘弹出气泡。只通知，不能直接回答；
# `agent-autoloop status` 看卡片，`agent-autoloop answer` 回答。
# 标题和正文作为参数传入，绝不拼进脚本，防注入。
param(
  [string]$Title,
  [string]$Text
)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$n.BalloonTipTitle = $Title
$n.BalloonTipText = $Text
$n.Visible = $true
$n.ShowBalloonTip(10000)
Start-Sleep -Seconds 12
$n.Dispose()
