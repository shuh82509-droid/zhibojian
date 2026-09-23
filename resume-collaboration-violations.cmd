@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0resume-collaboration-violations.ps1"
echo.
echo Copy the final verification lines back to Codex.
pause
