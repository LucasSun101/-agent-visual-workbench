@echo off
rem dsh-remote host check. No cd needed, no PATH node needed.
rem Uses the bundled Harness runtime, which survives a Harness restart.
rem NOTE: keep this file ASCII-only. UTF-8 Chinese breaks cmd.exe parsing.
if not defined DRC_NODE if not defined DRC_NODE set "DRC_NODE=node"
"%DRC_NODE%" "%~dp0drc-status.mjs"
echo.
if not defined DRC_NOPAUSE pause
