@echo off
rem Public HTTPS tunnel to the workbench console (localhost.run).
rem Keep this window open: closing it kills the tunnel.
rem Each start gives a NEW random https URL - copy it from the output.
rem NOTE: ASCII only. UTF-8 Chinese breaks cmd.exe parsing.
rem NOTE: must be 127.0.0.1, not "localhost": localhost may resolve to ::1 first
rem and the console only listens on IPv4, which shows up as HTTP 502.
ssh -T -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -R 80:127.0.0.1:51425 nokey@localhost.run
echo.
echo Tunnel closed. Run this again for a new URL.
if not defined WB_NOPAUSE pause
