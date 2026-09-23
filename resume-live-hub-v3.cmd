@echo off
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0resume-live-hub-v3.ps1"
if errorlevel 1 (
  echo.
  echo Deployment stopped. Copy the first candidate failure back to Codex.
)
pause
