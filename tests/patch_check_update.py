# -*- coding: utf-8 -*-
"""patch_check_update.py — 修复更新检测误报：多源取最高版本 + cache-buster
同时清理 serve.py 尾部重复的旧更新代码块（第二份同名函数会覆盖第一份）
"""
import io, sys

PATH = r"D:\lovelife\app\serve.py"
src = io.open(PATH, encoding="utf-8").read()

# ---------- 1) 删除重复块：第二处 'def port_free(p):' 起，到 'def main():' 前 ----------
first = src.find("def port_free(p):")
second = src.find("def port_free(p):", first + 1)
main_idx = src.find("\ndef main():", second)
assert first > 0 and second > 0 and main_idx > second, "定位重复块失败"
print("删除重复块: 字符 %d ~ %d（%d 行）" % (second, main_idx + 1, src[second:main_idx].count("\n")))
src = src[:second] + src[main_idx + 1:]

# ---------- 2) 重写 check_update：多源取最高版本 + cache-buster ----------
NEW = '''def _manifest_fetch(base):
    """取 version.json：先带 cache-buster 穿透 CDN 缓存，失败退回原 URL"""
    sep = "&" if "?" in base else "?"
    for u in (base + sep + "t=%d" % int(time.time()), base):
        try:
            data = json.loads(fetch_url(u, timeout=8).decode("utf-8"))
            if isinstance(data, dict) and data.get("version"):
                return data
        except Exception:
            continue
    return None


def check_update():
    """遍历全部镜像源、取版本号最高者。

    不再"第一个源成功就采纳"——CDN（jsdelivr/jsdmirror）可能压着旧
    version.json 缓存（stale-while-revalidate 可达 24h），单源命中缓存
    会把真实新版误报成"已是最新"。cache-buster 逐源穿透缓存；只要任一
    源报出更高版本即认定有更新；全部失败才算"检测失败"（≠无更新）。
    """
    local = read_version_manifest()
    local_ver = semver_tuple(local.get("version", "0"))
    best, best_ver, used = None, (0, 0, 0), ""
    errors = []
    for base in build_manifest_urls(local):
        data = _manifest_fetch(base)
        if not data:
            errors.append("%s: unreachable" % base[:50])
            continue
        used = base
        ver = semver_tuple(data.get("version", "0"))
        if best is None or ver > best_ver:
            best, best_ver = data, ver
        if ver > local_ver:
            break  # 已确认有新版，无需再问其它源
    if not best:
        return {"ok": False, "error": "无法连接更新源", "details": errors[:3]}
    return {
        "ok": True,
        "localVersion": local.get("version"),
        "remoteVersion": best.get("version"),
        "hasUpdate": best_ver > local_ver,
        "changelog": best.get("changelog") or [],
        "assets": best.get("assets") or {},
        "source": used,
    }


'''
start = src.find("def check_update():")
end = src.find("UPDATE_STATE = {", start)
assert start > 0 and end > start, "定位 check_update 失败"
print("替换 check_update: 字符 %d ~ %d" % (start, end))
src = src[:start] + NEW + "\n" + src[end:]

io.open(PATH, "w", encoding="utf-8", newline="").write(src)
print("OK 补丁完成，共 %d 行" % src.count("\n"))

# 语法自检
import py_compile
py_compile.compile(PATH, doraise=True)
print("OK 语法检查通过")
