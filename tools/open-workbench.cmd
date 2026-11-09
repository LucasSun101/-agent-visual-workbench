@echo off
rem Double-click entry: start hub + console only if needed, then open the browser.
rem Keep this file ASCII-only: UTF-8 Chinese breaks cmd.exe parsing.
setlocal
if not defined NODE set "NODE=node"
if not exist "%NODE%" (
  echo Cannot find the bundled node runtime:
  echo   %NODE%
  pause
  exit /b 1
)
"%NODE%" "%~dp0open-workbench.mjs"
rem Only keep the window open when something went wrong.
if errorlevel 1 pause
