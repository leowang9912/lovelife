@echo off
setlocal
cd /d "%~dp0"
title LoveLife Widget
chcp 936 >nul 2>nul

rem ===== 桌面小窗 Widget（v1.2.2）：今日待办置顶悬浮小窗 =====
rem 依赖 lovelife-server.exe 在跑（主程序 lovelife.bat 已启动即可）

netstat -ano | findstr /c:":8765 " | findstr /c:"LISTENING" >nul 2>&1
if errorlevel 1 goto NO_SVC

rem --- 找 Chrome ---
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined CHROME goto NO_CHROME

rem --- 小窗启动（320x430）---
start "" "%CHROME%" --app=http://127.0.0.1:8765/widget.html --window-size=320,430 --window-position=1240,80

rem --- 等窗口起来后设为置顶悬浮 ---
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command ^
  "$sig='[DllImport(\"user32.dll\")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);';" ^
  "$t=Add-Type -MemberDefinition $sig -Name W -PassThru;" ^
  "Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*yao ban*' -or $_.MainWindowTitle -like '*今日待办*' -or $_.MainWindowTitle -like '*待办*' } | ForEach-Object { $t::SetWindowPos($_.MainWindowHandle, [IntPtr](-1), 0,0,0,0, 3) | Out-Null }"
goto EOF

:NO_SVC
echo 本地服务未运行。请先双击 lovelife.bat 启动主程序，再开本小窗。
pause
goto EOF

:NO_CHROME
echo 未找到 Google Chrome，无法打开小窗。可手动用浏览器打开：
echo   http://127.0.0.1:8765/widget.html
pause

:EOF
endlocal
