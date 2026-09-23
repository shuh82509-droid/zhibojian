@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0redeploy-data-center-snapshot.ps1"
pause
