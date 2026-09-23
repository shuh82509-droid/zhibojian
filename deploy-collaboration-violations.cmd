@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-collaboration-violations.ps1"
if errorlevel 1 (
  echo.
  echo Deployment stopped. Copy the error above back to Codex.
)
pause
