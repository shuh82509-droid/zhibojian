@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure-data-center-mcp.ps1"
if errorlevel 1 (
  echo.
  echo Configuration stopped. Copy the error above back to Codex.
)
pause
