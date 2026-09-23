@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-live-center-modules.ps1"
echo.
pause
