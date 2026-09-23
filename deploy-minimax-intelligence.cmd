@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-minimax-intelligence.ps1"
if errorlevel 1 (
  echo.
  echo MiniMax deployment stopped. Copy the error above back to Codex.
)
pause
