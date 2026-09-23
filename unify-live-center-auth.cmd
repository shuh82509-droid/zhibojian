@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0unify-live-center-auth.ps1"
if errorlevel 1 (
  echo.
  echo Authentication update stopped. Copy the output above back to Codex.
)
pause
