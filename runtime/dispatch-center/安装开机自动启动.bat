@echo off
setlocal
set "APP_DIR=%~dp0"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCHER=%STARTUP_DIR%\LiveDashboardAutoStart.cmd"

if not exist "%STARTUP_DIR%" (
  echo Windows Startup folder was not found.
  pause
  exit /b 1
)

> "%LAUNCHER%" echo @echo off
>> "%LAUNCHER%" echo call "%APP_DIR%启动实时班表.bat"

echo Auto-start has been installed for this Windows account.
pause
