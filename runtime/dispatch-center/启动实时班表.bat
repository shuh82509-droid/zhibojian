@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required.
  pause
  exit /b 1
)

if "%MCP_BEARER_TOKEN%"=="" (
  echo MCP_BEARER_TOKEN is unavailable.
  pause
  exit /b 1
)

netstat -ano | findstr ":3100" >nul 2>&1
if errorlevel 1 start "LiveDashboard" /min node "%~dp0schedule-api-server.js"

timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:3100/"
exit /b 0
