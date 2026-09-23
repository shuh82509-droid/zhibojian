@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0inspect-coco-document-access-direct.ps1"
pause
