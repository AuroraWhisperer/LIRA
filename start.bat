@REM Date: 2026-07-24
@REM Author: Aurora
@REM Project Version: 1.0.0
@echo off
setlocal EnableExtensions

title Bilibili Live Song Helper - Running
set "APP_DIR=%~dp0"
set "NODE_CMD=node"

echo.
echo ==========================================
echo   Bilibili Live Song Helper
echo ==========================================
echo.
echo This window is the app switch.
echo Keep it open while streaming.
echo Close this window to stop the app and release the port.
echo.

if exist "%APP_DIR%node.exe" (
  set "NODE_CMD=%APP_DIR%node.exe"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js was not found.
    echo.
    echo Please install Node.js 24 or newer first:
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
  )
)

cd /d "%APP_DIR%"
set "AUTO_OPEN_ADMIN=1"
"%NODE_CMD%" src\server.js

echo.
echo The app has stopped. The local port has been released.
echo.
pause
exit /b 0
