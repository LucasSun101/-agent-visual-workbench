@echo off
rem One-click: tunnel + dsh web, prints a fresh https URL with token.
rem Keep this window open. Closing it stops both.
rem NOTE: ASCII only. UTF-8 Chinese breaks cmd.exe parsing.
setlocal
if not defined NODE set "NODE=node"
if not exist "%NODE%" (
  echo Cannot find the bundled node runtime:
  echo   %NODE%
  pause
  exit /b 1
)
title DSH mobile - do not close
"%NODE%" "%~dp0dsh-mobile.mjs"
echo.
echo Stopped. Run this again for a new address.
pause
