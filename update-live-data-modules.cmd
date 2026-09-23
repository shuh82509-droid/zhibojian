@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-live-data-modules.ps1"
if errorlevel 1 (
  echo.
  echo Module update stopped. Copy the output above back to Codex.
)
pause
