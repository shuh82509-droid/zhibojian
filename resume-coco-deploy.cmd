@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0resume-coco-deploy.ps1"
if errorlevel 1 (
  echo.
  echo Deployment resume stopped. Copy the error above back to Codex.
)
pause
