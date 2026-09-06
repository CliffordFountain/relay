@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Relay
color 0b

REM ============================================================
REM  Relay launcher - double-click to start Relay.
REM  Works from wherever you checked out the repo (path derived below).
REM ============================================================
REM Derive the repo folder from THIS script's own location. %~dp0 ends with a backslash.
set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"
set "URL=https://localhost:5173"

cls
echo(
echo   ====================================
echo             R E L A Y
echo   ====================================
echo(

if not exist "%REPO%" goto norepo
cd /d "%REPO%"

REM ---- 1) Make sure Docker is running -------------------------
echo   [1/3] Checking Docker...
docker info >nul 2>&1
if not errorlevel 1 goto dok
echo         Docker isn't running - starting Docker Desktop...
set "DD=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if not exist "!DD!" goto nodocker
start "" "!DD!"
set /a n=0
:dwait
set /a n+=1
timeout /t 3 /nobreak >nul
docker info >nul 2>&1 && goto dok
if !n! geq 40 goto dockertimeout
echo         ...waiting for Docker to start (!n!/40)
goto dwait
:dok
echo         Docker is up.

REM ---- 2) Start the Relay stack -------------------------------
echo   [2/3] Starting Relay services...
echo         (first run downloads and builds everything - this can take several minutes)
docker compose up -d
if errorlevel 1 goto composefail

REM ---- 3) Wait for the web client, then open ------------------
echo   [3/3] Waiting for Relay at %URL% ...
set /a n=0
:cwait
set /a n+=1
curl -sk -o nul -m 3 "%URL%/" && goto ready
if !n! geq 60 goto clienttimeout
timeout /t 2 /nobreak >nul
goto cwait
:ready
echo         Relay is ready.
echo(

REM ---- Open Relay: native app if built, else the browser -----
REM  The desktop app needs its dependencies installed (electron lives in
REM  node_modules). When they are, compile the shell first so the app that
REM  launches always matches the current source, then open it. Otherwise fall
REM  back to the browser - the web client is the same Relay.
set "ELECTRON=%REPO%\node_modules\electron\dist\electron.exe"
set "TSC=%REPO%\node_modules\.bin\tsc.cmd"
if not exist "%ELECTRON%" goto openbrowser
if exist "%TSC%" (
  echo   Building the Relay desktop app...
  call "%TSC%" -p "%REPO%\packages\desktop\tsconfig.json"
)
set "MAIN=%REPO%\packages\desktop\dist\main\main.js"
if not exist "%MAIN%" goto openbrowser
echo   Opening the Relay desktop app...
start "Relay" /d "%REPO%\packages\desktop" "%ELECTRON%" .
goto bye

:openbrowser
echo   Opening Relay in your browser...
start "" "%URL%"
goto bye

REM ---- error exits -------------------------------------------
:norepo
echo   [X] Relay project not found at:
echo       %REPO%
echo       Edit this .bat and set REPO to your relay folder.
echo(
pause
exit /b 1
:nodocker
echo   [X] Couldn't find Docker Desktop. Start it manually, then re-run.
echo(
pause
exit /b 1
:dockertimeout
echo   [X] Docker took too long to start. Open Docker Desktop, then re-run.
echo(
pause
exit /b 1
:composefail
echo   [X] "docker compose up -d" failed - see the messages above.
echo(
pause
exit /b 1
:clienttimeout
echo   [X] Relay didn't respond in time.
echo       Check the logs with:  docker compose logs
echo(
pause
exit /b 1

:bye
timeout /t 3 /nobreak >nul
exit /b 0
