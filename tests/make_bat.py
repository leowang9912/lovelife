# -*- coding: utf-8 -*-
"""生成 lovelife.bat：GBK + CRLF + 危险字节校验（反斜杠/管道/尖括号/脱字符会破坏 cmd 解析）"""
import io

LINES = [
    r"@echo off",
    r"setlocal",
    r'cd /d "%~dp0"',
    r"title LoveLife - Life Keeper",
    r"chcp 936 >nul 2>nul",
    r"",
    r"rem ===== 1. file integrity check =====",
    r'if not exist "%~dp0app\index.html" goto ERR_UNZIP',
    r'if not exist "%~dp0lovelife-server.exe" goto NO_EXE',
    r"",
    r"rem ===== 2. port check (already running?) =====",
    r'netstat -ano | findstr /c:":8765 " | findstr /c:"LISTENING" >nul 2>&1',
    r"if %errorlevel%==0 goto ALREADY_RUNNING",
    r"rem process check: exe already starting (double click) -> just wait, do not launch again",
    r'tasklist /fi "imagename eq lovelife-server.exe" | findstr /c:"lovelife-server.exe" >nul 2>&1',
    r"if %errorlevel%==0 goto WAIT_LOOP",
    r"",
    r"rem ===== 3. start local server (auto retry up to 3x) =====",
    r"set /a attempt=1",
    r":LAUNCH",
    r'start "" "%~dp0lovelife-server.exe"',
    r"",
    r"rem ===== 4. wait until port ready; retry if process died =====",
    r"set /a tries=0",
    r":WAIT_LOOP",
    r'netstat -ano | findstr /c:":8765 " | findstr /c:"LISTENING" >nul 2>&1',
    r"if %errorlevel%==0 goto OPEN_BROWSER",
    r"set /a tries+=1",
    r"if %tries% GEQ 24 goto ERR_START_FAIL",
    r"if %tries% GEQ 3 goto CHECK_ALIVE",
    r"ping -n 2 127.0.0.1 >nul",
    r"goto WAIT_LOOP",
    r":CHECK_ALIVE",
    r'tasklist /fi "imagename eq lovelife-server.exe" | findstr /c:"lovelife-server.exe" >nul 2>&1',
    r"if %errorlevel%==0 goto WAIT_LOOP",
    r"set /a attempt+=1",
    r"if %attempt% GTR 3 goto ERR_START_FAIL",
    r"echo [INFO] Service exited unexpectedly, retrying to start ...",
    r"ping -n 3 127.0.0.1 >nul",
    r"goto LAUNCH",
    r"",
    r"rem ===== 5. open browser =====",
    r":OPEN_BROWSER",
    r'set "BROWSER="',
    r'if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"',
    r'if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"',
    r'if not defined BROWSER if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"',
    r'if not defined BROWSER if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"',
    r'if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"',
    r"if defined BROWSER goto RUN_BROWSER",
    r"echo [INFO] Edge and Chrome not found, open with system default browser.",
    r'start "" "http://127.0.0.1:8765/index.html"',
    r"exit /b 0",
    r":RUN_BROWSER",
    r'start "" "%BROWSER%" --app="http://127.0.0.1:8765/index.html" --window-size=1480,940',
    r"exit /b 0",
    r"",
    r":ALREADY_RUNNING",
    r"echo [INFO] Service already running, open window directly.",
    r"goto OPEN_BROWSER",
    r"",
    r":NO_EXE",
    r"echo.",
    r"echo [ERROR] lovelife-server.exe NOT FOUND.",
    r"echo.",
    r"echo 常见原因与解决办法：",
    r"echo   1. 还没有解压：请把整个压缩包右键“解压到文件夹”，",
    r"echo      然后双击解压后文件夹里的 lovelife.bat。",
    r"echo      直接在压缩包窗口里双击 bat 是无法运行的。",
    r"echo   2. 被杀毒软件拦截或删除：请打开杀毒软件的隔离区，",
    r"echo      找到 lovelife-server.exe 恢复并添加信任。",
    r"echo.",
    r"echo 本软件不需要安装 Python，看到本提示也不代表缺少 Python。",
    r"echo 详细图文步骤见压缩包里的 首次使用说明.txt。",
    r"pause",
    r"exit /b 1",
    r"",
    r":ERR_UNZIP",
    r"echo.",
    r"echo [ERROR] app files NOT FOUND, package is incomplete.",
    r"echo.",
    r"echo 文件不完整或正在压缩包里直接运行。请按以下步骤操作：",
    r"echo   1. 右键压缩包，选择“解压到当前文件夹”或“解压到 lovelife”",
    r"echo   2. 进入解压出来的文件夹，确认里面有 app 文件夹",
    r"echo   3. 双击该文件夹里的 lovelife.bat",
    r"echo.",
    r"echo 注意：解压目标路径建议是纯英文路径，例如 D 盘 lovelife 文件夹。",
    r"echo 详细图文步骤见压缩包里的 首次使用说明.txt。",
    r"pause",
    r"exit /b 1",
    r"",
    r":ERR_START_FAIL",
    r"echo.",
    r"echo [ERROR] Service failed to start, port 8765 not ready in 20s.",
    r"echo.",
    r"echo 常见原因与解决办法：",
    r"echo   1. 杀毒软件拦截了 lovelife-server.exe：",
    r"echo      请查看杀毒软件的拦截记录，恢复程序并添加信任后重试。",
    r"echo   2. 端口 8765 被其他程序占用：",
    r"echo      请关闭占用该端口的程序，或重启电脑后重试。",
    r"echo   3. 程序文件损坏：重新解压一次压缩包覆盖即可，数据不会丢失。",
    r"echo   4. 弹出过 Failed to load Python DLL 提示：点确定后，",
    r"echo      重新双击 lovelife.bat 即可，一般第二次就正常。",
    r"echo      长期解决：把本软件文件夹加入杀毒软件信任区。",
    r"echo.",
    r"echo 详细图文步骤见压缩包里的 首次使用说明.txt。",
    r"pause",
    r"exit /b 1",
]

# 危险字节：\ | ^ & < > % " 以及括号(出现在 if 块内会截断)
DANGEROUS = {0x22, 0x25, 0x26, 0x28, 0x29, 0x3c, 0x3e, 0x5c, 0x5e, 0x7c}

content = "\r\n".join(LINES) + "\r\n"
data = content.encode("gbk")

bad = []
for ln in LINES:
    if "echo" in ln and ln.strip().startswith("echo"):
        enc = ln.encode("gbk")
        hits = [hex(b) for b in enc if b in DANGEROUS]
        # 允许 echo 前面已有的 ASCII 结构（"echo " 本身无危险字节）；只查中文部分
        if hits:
            bad.append((ln[:40], hits))
if bad:
    for t, h in bad:
        print("DANGEROUS BYTES:", t, h)
    raise SystemExit("abort: unsafe bytes in echo lines")

out = r"D:\lovelife\lovelife.bat"
with io.open(out, "w", encoding="gbk", newline="") as f:
    f.write(content)

raw = open(out, "rb").read()
assert raw.count(b"\r\n") > 30 and b"\n" not in raw.replace(b"\r\n", b""), "line endings must be CRLF"
print("OK lovelife.bat written: %d lines, %d bytes (GBK+CRLF)" % (len(LINES), len(raw)))
