@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-coco-server.ps1"
if errorlevel 1 (
  echo.
  echo Deployment stopped. Copy the error above back to Codex.
) else (
  echo.
  echo Deployment completed. Copy the final DEPLOYED_URL line back to Codex.
)
pause
