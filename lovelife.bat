@echo off
setlocal
cd /d "%~dp0"
title LoveLife - Life Keeper

rem --- start local data server (lovelife-server.exe or python) ---
rem use "start" without /b so the console can close immediately
set "SERVER=%~dp0lovelife-server.exe"
if exist "%SERVER%" (
  start "" "%SERVER%"
) else (
  where pythonw >nul 2>nul
  if not errorlevel 1 (
    start "" pythonw "%~dp0app\serve.py"
  ) else (
    where python >nul 2>nul
    if not errorlevel 1 (
      start "" pythonw "%~dp0app\serve.py"
    ) else (
      echo No Python found and lovelife-server.exe is missing.
      echo Please install Python or restore lovelife-server.exe.
      pause
      exit /b 1
    )
  )
)

rem --- wait for server ---
ping -n 2 127.0.0.1 >nul

rem --- find Edge or Chrome ---
set "BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if defined BROWSER (
  start "" "%BROWSER%" --app="http://127.0.0.1:8765/index.html" --window-size=1480,940
) else (
  start "" "http://127.0.0.1:8765/index.html"
)
exit /b 0
