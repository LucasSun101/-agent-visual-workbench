@echo off
rem Starts the autoloop hub and the workbench console, one window each.
rem Close a window to stop that piece.
rem NOTE: ASCII only. UTF-8 Chinese breaks cmd.exe parsing.
setlocal
if not defined NODE set "NODE=node"
set "WS=%~dp0.."

if defined WB_ECHO_ONLY (
  echo NODE=%NODE%
  echo WS=%WS%
  exit /b 0
)

if not exist "%NODE%" (
  echo Cannot find the bundled node runtime at:
  echo   %NODE%
  echo Reinstall or update DeepSeek Harness, then update NODE= in this file.
  pause
  exit /b 1
)

start "autoloop hub" cmd /k ""%NODE%" --disable-warning=ExperimentalWarning --experimental-sqlite "%WS%\agent-autoloop-wb-dsh\bin\agent-autoloop.ts" up"
start "workbench console" cmd /k ""%NODE%" "%WS%\console\server.mjs""

echo Two windows opened.
echo The console prints its URL (with ?k=...) in the second window.
