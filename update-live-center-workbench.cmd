@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-live-center-workbench.ps1"
if errorlevel 1 (
  echo.
  echo Deployment stopped. Copy the error above back to Codex.
)
pause
