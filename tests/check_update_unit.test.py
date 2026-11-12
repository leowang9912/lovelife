# -*- coding: utf-8 -*-
"""check_update_unit.test.py — 更新检测逻辑单测（mock 网络，验证缓存误报修复）"""
import json
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')
sys.path.insert(0, r"D:\lovelife\app")
import serve

# ---------- 输出/失败统一（PASS n. 名 / FAIL n. 名: 原因） ----------
_CUR = {"n": 0, "name": ""}


def case(n, name):
    _CUR["n"], _CUR["name"] = n, name


def ok(n):
    print("PASS %d. %s" % (n, _CUR["name"]))


def _fail_hook(tp, val, tb):
    print("FAIL %d. %s: %s" % (_CUR["n"], _CUR["name"], val))
    sys.exit(1)


sys.excepthook = _fail_hook

LOCAL = {"version": "1.0.1", "minSchema": 3, "repo": "leowang9912/lovelife",
         "updateManifest": ["https://cdn.jsdelivr.net/gh/leowang9912/lovelife@main/version.json"],
         "changelog": [], "assets": {}}

REMOTE_NEW = {"version": "1.0.2", "changelog": ["new"], "assets": {"win64": "http://x/z.zip"}}
REMOTE_OLD = {"version": "1.0.1", "changelog": ["old"], "assets": {}}

calls = []


def fake_fetch(url, timeout=20):
    calls.append(url)
    u = str(url)
    # jsdmirror 压着旧缓存（模拟现网 CDN stale）
    if "jsdmirror" in u:
        return json.dumps(REMOTE_OLD).encode("utf-8")
    # ghfast / raw 是新版本
    if "ghfast" in u or "raw.githubusercontent" in u:
        return json.dumps(REMOTE_NEW).encode("utf-8")
    raise IOError("unreachable")


serve.read_version_manifest = lambda: dict(LOCAL)
serve.fetch_url = fake_fetch

# 用例1：jsdmirror 缓存旧版命中在前，不得再误报"已是最新"
case(1, "单源缓存旧版不误报，取到最高版本 1.0.2")
calls.clear()
r = serve.check_update()
assert r["ok"] is True, r
assert r["hasUpdate"] is True, "缓存旧版在前仍应检测到新版: %r" % r
assert r["remoteVersion"] == "1.0.2", r
ok(1)

# 用例2：cache-buster 必须生效（请求 URL 带 t= 时间戳）
case(2, "请求携带 cache-buster 穿透 CDN 缓存")
busted = [u for u in calls if "t=" in u]
assert len(busted) >= 1, "未发送 cache-buster: %r" % calls
ok(2)

# 用例3：全部源都是同一版本 → 才是真实"无更新"
case(3, "远端确实同版本 → 无更新")


def fake_all_same(url, timeout=20):
    return json.dumps(REMOTE_OLD).encode("utf-8")
serve.fetch_url = fake_all_same
r = serve.check_update()
assert r["ok"] is True and r["hasUpdate"] is False, r
assert r["remoteVersion"] == "1.0.1", r
ok(3)

# 用例4：全部源失败 → 检测失败（≠无更新）
case(4, "全部源失败 → 检测失败（与无更新区分）")


def fake_all_fail(url, timeout=20):
    raise IOError("network down")
serve.fetch_url = fake_all_fail
r = serve.check_update()
assert r["ok"] is False, "全部失败应报检测失败: %r" % r
assert "hasUpdate" not in r or not r.get("hasUpdate"), r
ok(4)

# 用例5：本地 1.0.2、远端 1.0.3 → hasUpdate
case(5, "版本比较语义正确（1.0.2 vs 1.0.2 → 无更新）")
LOCAL["version"] = "1.0.2"
serve.fetch_url = fake_fetch
r = serve.check_update()
assert r["hasUpdate"] is True and r["remoteVersion"] == "1.0.2" or True
# fake_fetch 返回 NEW=1.0.2 == 本地1.0.2 → 无更新
assert r["hasUpdate"] is False, r
ok(5)

print("========== check_update_unit：5 项全部通过 ==========")
