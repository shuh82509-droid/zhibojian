@echo off
setlocal EnableExtensions
set "PROJECT=C:\Users\Administrator\.codex\.chatgpt-projects\g-p-6a7157d4fafc8191b01651c6f280c9de"
set "REMOTE=fandow-deploy@120.27.143.111"
set "REMOTE_DIR=/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench"
set "BUNDLE_NAME=live-center-workbench-%RANDOM%%RANDOM%.tar.gz"
set "BUNDLE=%TEMP%\%BUNDLE_NAME%"

cd /d "%PROJECT%" || goto :failed
tar -czf "%BUNDLE%" --exclude=.git --exclude=.agents --exclude=.codex --exclude=sources --exclude=node_modules .
if errorlevel 1 goto :failed

echo [1/3] Preparing server directory. Enter SSH password when prompted.
ssh %REMOTE% "mkdir -p '%REMOTE_DIR%'"
if errorlevel 1 goto :failed

echo [2/3] Uploading the deployment bundle. Enter SSH password when prompted.
scp "%BUNDLE%" %REMOTE%:%REMOTE_DIR%/%BUNDLE_NAME%
if errorlevel 1 goto :failed

echo [3/3] Deploying. Enter SSH password and sudo password if prompted.
ssh -tt %REMOTE% "cd '%REMOTE_DIR%' && tar -xzf '%BUNDLE_NAME%' && rm -f '%BUNDLE_NAME%' && chmod +x deploy-remote.sh && ./deploy-remote.sh"
if errorlevel 1 goto :failed

del /q "%BUNDLE%"
echo.
echo Deployment completed. Copy the final DEPLOYED_URL line back to Codex.
pause
exit /b 0

:failed
echo.
echo Deployment stopped. Copy the error above back to Codex.
if exist "%BUNDLE%" del /q "%BUNDLE%"
pause
exit /b 1
