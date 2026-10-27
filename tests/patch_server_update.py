# -*- coding: utf-8 -*-
"""serve.py 更新模块补丁：异步下载 + 进度 + 状态机 + 原子安装"""
import io, re

p = 'D:/lovelife/app/serve.py'
s = open(p, encoding='utf-8').read()

# ---- 1) Handler 方法 ----
old_handlers = '''    # ---------- 应用内更新 ----------
    def _handle_update_check(self):
        return self._json(check_update())

    def _handle_update_apply(self):
        payload = json.loads(self._read_body().decode("utf-8"))
        url = payload.get("url") or ""
        if not url:
            return self._json({"ok": False, "error": "缺少下载地址"}, 400)
        result = apply_update(url)
        if result.get("ok"):
            # 延迟退出，让响应先送达
            threading.Timer(0.6, lambda: os._exit(0)).start()
        return self._json(result)
'''
new_handlers = '''    # ---------- 应用内更新（异步下载 + 进度状态机） ----------
    def _handle_update_check(self):
        result = check_update()
        result["checkedAt"] = int(time.time())
        return self._json(result)

    def _handle_update_apply(self):
        payload = json.loads(self._read_body().decode("utf-8"))
        url = payload.get("url") or ""
        if not url:
            return self._json({"ok": False, "error": "缺少下载地址"}, 400)
        with _update_lock:
            if UPDATE_STATE["state"] == "downloading":
                return self._json({"ok": True, "state": "downloading", "message": "更新正在下载中"})
            if UPDATE_STATE["state"] == "done":
                return self._json({"ok": True, "state": "done", "message": "更新已完成，等待重启"})
            start_update_job(url)
        return self._json({"ok": True, "state": "downloading", "message": "下载已开始"})

    def _handle_update_status(self):
        with _update_lock:
            snap = dict(UPDATE_STATE)
        snap["percent"] = round(snap["downloaded"] / snap["total"] * 100, 1) if snap.get("total") else 0
        return self._json(snap)
'''
assert old_handlers in s
s = s.replace(old_handlers, new_handlers)

# ---- 2) GET 路由 ----
old_route = '''        if path == "/api/update/check":
            return self._json(check_update())'''
new_route = '''        if path == "/api/update/check":
            result = check_update()
            result["checkedAt"] = int(time.time())
            return self._json(result)
        if path == "/api/update/status":
            return self._handle_update_status()'''
assert old_route in s
s = s.replace(old_route, new_route)

# ---- 3) apply_update 整体替换 ----
start = s.index('def apply_update(url):')
end = s.index('def port_free(p):')
new_block = '''# ---------------- 更新状态机：idle / downloading / done / failed ----------------
UPDATE_STATE = {
    "state": "idle",
    "downloaded": 0,
    "total": 0,
    "source": "",
    "error": "",
    "phase": "",
}
_update_lock = threading.Lock()


def start_update_job(url):
    """后台线程执行 下载 -> 校验 -> 安装；HTTP 请求立即返回"""
    UPDATE_STATE.update(state="downloading", downloaded=0, total=0, source="", error="", phase="downloading")
    threading.Thread(target=_update_job, args=(url,), daemon=True).start()


def _update_job(url):
    try:
        data = _download_with_progress(url)
        if data is None:
            with _update_lock:
                UPDATE_STATE.update(state="failed", phase="", error=UPDATE_STATE["error"] or "下载失败，请检查网络")
            return
        with _update_lock:
            UPDATE_STATE["phase"] = "verifying"
        if not _verify_zip(data):
            return
        with _update_lock:
            UPDATE_STATE["phase"] = "installing"
        if not _stage_and_install(data):
            return
        with _update_lock:
            UPDATE_STATE.update(state="done", phase="installing")
        threading.Timer(0.8, lambda: os._exit(0)).start()
    except Exception as e:
        with _update_lock:
            UPDATE_STATE.update(state="failed", phase="", error=str(e))


def _download_with_progress(url):
    """候选源依次下载（直连在前、镜像兜底，不设优先级），每 256KB 回报进度"""
    candidates = [url]
    for prefix in ("https://ghfast.top/", "https://gh-proxy.com/", "https://mirror.ghproxy.com/"):
        if url.startswith("https://github.com/") or url.startswith("https://objects.githubusercontent.com/"):
            candidates.append(prefix + url)
    last_err = ""
    for u in candidates:
        try:
            with _update_lock:
                UPDATE_STATE.update(source=u, downloaded=0, total=0, error="")
            req = urllib.request.Request(u, headers={"User-Agent": "lovelife-updater/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                total = int(resp.headers.get("Content-Length") or 0)
                with _update_lock:
                    UPDATE_STATE["total"] = total
                buf = io.BytesIO()
                while True:
                    chunk = resp.read(256 * 1024)
                    if not chunk:
                        break
                    buf.write(chunk)
                    with _update_lock:
                        UPDATE_STATE["downloaded"] = buf.tell()
                if total and buf.tell() < total:
                    raise IOError("download incomplete %d/%d" % (buf.tell(), total))
                return buf.getvalue()
        except Exception as e:
            last_err = "%s: %s" % (u[:60], e)
            with _update_lock:
                UPDATE_STATE["error"] = last_err
            continue
    with _update_lock:
        UPDATE_STATE["error"] = last_err or "all sources failed"
    return None


def _verify_zip(data):
    """完整校验更新包，不通过绝不触碰现网文件"""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        bad = zf.testzip()
        if bad is not None:
            raise IOError("corrupt entry: %s" % bad)
        names = [n.replace(chr(92), "/") for n in zf.namelist()]
        if not any(n.endswith("app/serve.py") for n in names):
            raise IOError("missing app/serve.py")
        return True
    except Exception as e:
        with _update_lock:
            UPDATE_STATE.update(state="failed", phase="", error="zip verify failed: %s" % e)
        return False


def _stage_and_install(data):
    """解压到 update-staging，校验通过后交给 updater.cmd 做替换（现网文件不动到最后一刻）"""
    staging = os.path.join(ROOT, "update-staging")
    if os.path.isdir(staging):
        shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(staging, exist_ok=True)
    try:
        zpath = os.path.join(staging, "update.zip")
        with open(zpath, "wb") as f:
            f.write(data)
        with zipfile.ZipFile(zpath, "r") as z:
            z.extractall(staging)
        os.remove(zpath)
        inner = os.path.join(staging, "lovelife")
        if os.path.isdir(inner):
            for name in os.listdir(inner):
                shutil.move(os.path.join(inner, name), os.path.join(staging, name))
            shutil.rmtree(inner, ignore_errors=True)
        if not os.path.isfile(os.path.join(staging, "app", "serve.py")):
            raise IOError("bad package layout")
    except Exception as e:
        with _update_lock:
            UPDATE_STATE.update(state="failed", phase="", error=str(e))
        return False

    bat_lines = [
        "@echo off",
        "setlocal",
        'cd /d "%~dp0"',
        "ping -n 4 127.0.0.1 >nul",
        'taskkill /f /im lovelife-server.exe >nul 2>&1',
        'if exist "update-staging\\app" robocopy "update-staging\\app" "app" /E /PURGE >nul',
        'if exist "update-staging\\lovelife-server.exe" copy /y "update-staging\\lovelife-server.exe" "lovelife-server.exe" >nul',
        'if exist "update-staging\\lovelife.bat" copy /y "update-staging\\lovelife.bat" "lovelife.bat" >nul',
        'if exist "update-staging\\version.json" copy /y "update-staging\\version.json" "version.json" >nul',
        'if exist "update-staging\\README.md" copy /y "update-staging\\README.md" "README.md" >nul',
        'if exist "update-staging\\CHANGELOG.md" copy /y "update-staging\\CHANGELOG.md" "CHANGELOG.md" >nul',
        'if exist "update-staging\\LICENSE" copy /y "update-staging\\LICENSE" "LICENSE" >nul',
        'rmdir /s /q "update-staging" >nul 2>&1',
        'start "" "%~dp0lovelife-server.exe"',
        'start "" cmd /c "ping -n 4 127.0.0.1 >nul & del /q \\"%~f0\\""',
    ]
    updater = os.path.join(ROOT, "updater.cmd")
    with open(updater, "w", encoding="ascii", newline="") as f:
        f.write("\\r\\n".join(bat_lines) + "\\r\\n")
    subprocess.Popen(["cmd", "/c", updater], cwd=ROOT,
                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return True


'''
s = s[:start] + new_block + s[end:]
open(p, 'w', encoding='utf-8').write(s)
print('serve.py patched')
