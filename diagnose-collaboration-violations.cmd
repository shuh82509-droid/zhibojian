@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnose-collaboration-violations.ps1"
echo.
echo Copy the diagnostic output back to Codex.
pause
