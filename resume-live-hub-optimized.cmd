@echo off
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0resume-live-hub-optimized.ps1"
set "result=%ERRORLEVEL%"
if not "%result%"=="0" echo.
if not "%result%"=="0" echo Release resume stopped. Copy the terminal output back to Codex.
pause
exit /b %result%
