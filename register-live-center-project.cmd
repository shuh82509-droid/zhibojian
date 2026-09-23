@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0register-live-center-project.ps1"
if errorlevel 1 echo Project registration stopped. Copy the output back to Codex.
pause
