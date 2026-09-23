@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0inspect-live-hub-v2-sources.ps1"
if errorlevel 1 echo Inspection stopped. Copy the error back to Codex.
pause
