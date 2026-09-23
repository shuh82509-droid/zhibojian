@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0preflight-live-hub-v2.ps1"
if errorlevel 1 (
  echo.
  echo Preflight stopped. Copy the error output back to Codex.
) else (
  echo.
  echo Preflight passed. Return to Codex before starting deployment.
)
pause
