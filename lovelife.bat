@echo off
setlocal
cd /d "%~dp0"
title LoveLife - Life Keeper
chcp 936 >nul 2>nul

rem ===== 1. file integrity check =====
if not exist "%~dp0app\index.html" goto ERR_UNZIP
if not exist "%~dp0lovelife-server.exe" goto NO_EXE

rem ===== 2. port check (already running?) =====
netstat -ano | findstr /c:":8765 " | findstr /c:"LISTENING" >nul 2>&1
if %errorlevel%==0 goto ALREADY_RUNNING

rem ===== 3. start local server =====
start "" "%~dp0lovelife-server.exe"

rem ===== 4. wait until port ready (max 20s) =====
set /a tries=0
:WAIT_LOOP
netstat -ano | findstr /c:":8765 " | findstr /c:"LISTENING" >nul 2>&1
if %errorlevel%==0 goto OPEN_BROWSER
set /a tries+=1
if %tries% GEQ 20 goto ERR_START_FAIL
ping -n 2 127.0.0.1 >nul
goto WAIT_LOOP

rem ===== 5. open browser =====
:OPEN_BROWSER
set "BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if defined BROWSER goto RUN_BROWSER
echo [INFO] Edge and Chrome not found, open with system default browser.
start "" "http://127.0.0.1:8765/index.html"
exit /b 0
:RUN_BROWSER
start "" "%BROWSER%" --app="http://127.0.0.1:8765/index.html" --window-size=1480,940
exit /b 0

:ALREADY_RUNNING
echo [INFO] Service already running, open window directly.
goto OPEN_BROWSER

:NO_EXE
echo.
echo [ERROR] lovelife-server.exe NOT FOUND.
echo.
echo 常见原因与解决办法：
echo   1. 还没有解压：请把整个压缩包右键“解压到文件夹”，
echo      然后双击解压后文件夹里的 lovelife.bat。
echo      直接在压缩包窗口里双击 bat 是无法运行的。
echo   2. 被杀毒软件拦截或删除：请打开杀毒软件的隔离区，
echo      找到 lovelife-server.exe 恢复并添加信任。
echo.
echo 本软件不需要安装 Python，看到本提示也不代表缺少 Python。
echo 详细图文步骤见压缩包里的 首次使用说明.txt。
pause
exit /b 1

:ERR_UNZIP
echo.
echo [ERROR] app files NOT FOUND, package is incomplete.
echo.
echo 文件不完整或正在压缩包里直接运行。请按以下步骤操作：
echo   1. 右键压缩包，选择“解压到当前文件夹”或“解压到 lovelife”
echo   2. 进入解压出来的文件夹，确认里面有 app 文件夹
echo   3. 双击该文件夹里的 lovelife.bat
echo.
echo 注意：解压目标路径建议是纯英文路径，例如 D 盘 lovelife 文件夹。
echo 详细图文步骤见压缩包里的 首次使用说明.txt。
pause
exit /b 1

:ERR_START_FAIL
echo.
echo [ERROR] Service failed to start, port 8765 not ready in 20s.
echo.
echo 常见原因与解决办法：
echo   1. 杀毒软件拦截了 lovelife-server.exe：
echo      请查看杀毒软件的拦截记录，恢复程序并添加信任后重试。
echo   2. 端口 8765 被其他程序占用：
echo      请关闭占用该端口的程序，或重启电脑后重试。
echo   3. 程序文件损坏：重新解压一次压缩包覆盖即可，数据不会丢失。
echo.
echo 详细图文步骤见压缩包里的 首次使用说明.txt。
pause
exit /b 1
