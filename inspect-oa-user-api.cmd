@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0inspect-oa-user-api.ps1"
if errorlevel 1 echo Diagnostic stopped. Copy the output back to Codex.
pause
