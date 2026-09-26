@echo off
REM ===========================================================================
REM  PlayzAnime Web - local launcher
REM    start.bat          development: the server (5310) in its own window and the
REM                       site with hot reload on http://localhost:5311
REM    start.bat built    production: builds everything and serves it from one
REM                       server on http://localhost:5310
REM  Close the windows (or press Ctrl+C) to stop. Only what this file started stops.
REM ===========================================================================
setlocal
title PlayzAnime Web
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Node.js is not installed or not on PATH.
  echo  Install the LTS version from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

echo [PlayzAnime Web] Cleaning up after earlier sessions...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\cleanup.ps1"

if not exist "node_modules\vite\package.json" (
  echo [PlayzAnime Web] Installing the site's dependencies. This happens once.
  call npm install --no-fund --no-audit --prefer-offline
  if errorlevel 1 goto :failed
)
if not exist "server\node_modules\esbuild\package.json" (
  echo [PlayzAnime Web] Installing the server's dependencies. This happens once.
  call npm install --prefix server --no-fund --no-audit --prefer-offline
  if errorlevel 1 goto :failed
)

if /i "%~1"=="built" goto :built

echo [PlayzAnime Web] Starting the server in its own window...
start "PlayzAnime Web server" cmd /c "cd /d "%~dp0server" && npm run dev"
echo [PlayzAnime Web] Starting the site on http://localhost:5311 ...
start "" http://localhost:5311
call npm run dev
exit /b %ERRORLEVEL%

:built
echo [PlayzAnime Web] Building the site...
call npm run build
if errorlevel 1 goto :failed
echo [PlayzAnime Web] Building the server...
call npm --prefix server run build
if errorlevel 1 goto :failed
echo [PlayzAnime Web] Serving on http://localhost:5310 ...
start "" http://localhost:5310
call npm --prefix server start
exit /b %ERRORLEVEL%

:failed
echo.
echo  Something failed above. Check your internet connection and try again.
pause
exit /b 1
