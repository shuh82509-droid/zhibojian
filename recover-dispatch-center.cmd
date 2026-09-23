@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0recover-dispatch-center.ps1"
if errorlevel 1 (
  echo.
  echo Recovery stopped. Copy the output above back to Codex.
)
pause
