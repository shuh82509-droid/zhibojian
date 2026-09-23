@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-recruitment-resume-trend.ps1"
set "exit_code=%errorlevel%"
if not "%exit_code%"=="0" echo Deployment stopped. Copy the first CANDIDATE_* error back to Codex.
pause
exit /b %exit_code%
