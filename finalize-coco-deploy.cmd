@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0finalize-coco-deploy.ps1"
if errorlevel 1 (
  echo.
  echo Final verification stopped. Copy the error above back to Codex.
)
pause
