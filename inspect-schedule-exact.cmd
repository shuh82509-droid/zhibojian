@echo off
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0inspect-schedule-exact.ps1"
if errorlevel 1 echo Exact inspection stopped. Copy the output back to Codex.
pause
