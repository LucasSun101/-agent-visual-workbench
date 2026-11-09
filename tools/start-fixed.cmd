@echo off
rem Fixed-address launcher: Cloudflare Tunnel + dsh web.
rem Needs tools\cloudflare.json with {"token":"...","hostname":"dsh.example.com"}
rem NOTE: ASCII only. UTF-8 Chinese breaks cmd.exe parsing.
setlocal
if not defined NODE set "NODE=node"
if not exist "%NODE%" (
  echo Cannot find the bundled node runtime:
  echo   %NODE%
  pause
  exit /b 1
)
title DSH fixed address - do not close
"%NODE%" "%~dp0cloudflare-start.mjs"
echo.
echo Stopped.
pause
