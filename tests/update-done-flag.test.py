# -*- coding: utf-8 -*-
"""update-done-flag.test.py — v1.0.7 更新完成落盘标记 + 预设标签精简迁移 + v1.0.9 启动稳定性"""
import io, json, os, sys, tempfile, time

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

orig_root = serve.ROOT
root = tempfile.mkdtemp()
serve.ROOT = root

# ---------- 1) 落盘标记四态：无 / 新鲜 / 过期 / 损坏 ----------
case(1, "更新完成标记：无/新鲜/过期/损坏 四态正确")
flag_path = os.path.join(root, "update-done.json")
assert serve._read_update_done_flag() is None, "no flag -> None"
with open(flag_path, "w", encoding="utf-8") as f:
    json.dump({"version": "1.0.7", "time": time.time()}, f)
flag = serve._read_update_done_flag()
assert flag and flag.get("version") == "1.0.7", "fresh flag readable"
with open(flag_path, "w", encoding="utf-8") as f:
    json.dump({"version": "1.0.7", "time": time.time() - 25 * 3600}, f)
assert serve._read_update_done_flag() is None, "stale flag ignored"
with open(flag_path, "w", encoding="utf-8") as f:
    f.write("{broken")
assert serve._read_update_done_flag() is None, "corrupt flag ignored"
ok(1)

# ---------- 2) update/status：进程重启后仍能报告 done ----------
case(2, "update/status：重启后仍报告 done（自动刷新的依据）")
with open(flag_path, "w", encoding="utf-8") as f:
    json.dump({"version": "1.0.7", "time": time.time()}, f)
serve.UPDATE_STATE.update(state="idle", phase="", error="", downloaded=0, total=0, source="")


class FakeHandler:
    def _json(self, obj, code=200):
        return {"__resp": obj, "__code": code}


resp = serve.Handler._handle_update_status(FakeHandler())
assert resp["__resp"]["state"] == "done" and resp["__resp"]["version"] == "1.0.7", \
    "status must report done from flag, got %r" % resp["__resp"]
ok(2)

# ---------- 3) clear-done 清标记 ----------
case(3, "clear-done：标记清除")
serve.Handler._handle_update_clear_done(FakeHandler())
assert not os.path.exists(flag_path), "clear-done removes flag"
ok(3)

# ---------- 4) 预设标签精简：以服务端 3 个为准，老预设不回填 ----------
case(4, "预设标签精简为 3，老预设不回填（物品已打标签保留）")
root2 = tempfile.mkdtemp()
serve.data_root = lambda: root2
serve.migrate_old_layout = lambda r: [{"id": "me", "name": "Me", "icon": "x"}]
d = serve.acc_dir(root2, "me")
os.makedirs(d, exist_ok=True)
with open(os.path.join(d, "settings.json"), "w", encoding="utf-8") as f:
    json.dump({
        "schemaVersion": 3,
        "settings": {"customTags": ["心头好"]},
        "categories": {"tagPresets": ["送人", "待清洗", "贵重", "心头好"]},
    }, f)
db = serve.load_db("me")
presets = db["categories"]["tagPresets"]
assert presets == ["贵重", "待清洗", "断舍离候选"], "tagPresets trimmed: %r" % presets
custom = db["settings"].get("customTags") or []
assert custom == ["心头好"], "old presets must NOT auto-fill customTags: %r" % custom
ok(4)

# ---------- 5) v1.0.9：DLL 释放目录 + v1.1.7 更新重启走标准 bat 入口 ----------
case(5, "DLL 释放目录(runtime) + 更新重启走 bat 标准入口(防弹窗叠罗汉) 已落地")
build = io.open(r"D:\lovelife\build_exe.py", encoding="utf-8").read()
assert "--runtime-tmpdir" in build, "build_exe.py 必须指定 runtime 释放目录（离开 %TEMP%）"
srv = io.open(r"D:\lovelife\app\serve.py", encoding="utf-8").read()
assert 'start "" "%~dp0lovelife.bat"' in srv, "updater 重启必须调 lovelife.bat 标准入口"
assert 'start "" "%~dp0lovelife-server.exe"' not in srv, \
    "updater 不得自行拉 exe（Fatal error 弹窗叠罗汉源头）"
assert ':RESTART' not in srv and ':RPOLL' not in srv, "自行重启/轮询逻辑应已删除（启动归 bat）"
assert ':COPYEXE' in srv and 'copy exe failed' in srv, \
    "updater.cmd 必须 exe 替换重试 3 次（防旧进程占用导致启动旧 exe）"
assert '_MEI*' in srv and 'rd /s /q' in srv, \
    "updater.cmd 必须清残留解压目录（残留被锁会导致解压创建失败）"
bat = io.open(r"D:\lovelife\lovelife.bat", encoding="latin1").read().encode("latin1").decode("gbk")
assert 'set "TMP=%~dp0runtime"' in bat and 'set "TEMP=%~dp0runtime"' in bat, \
    "bat 必须 TMP/TEMP 兜底到安装目录（防解压进系统 Temp 撞杀软）"
assert 'GTR 3 goto ERR_START_FAIL' in bat and ':CHECK_ALIVE' in bat, \
    "bat 启动重试 3 轮且带僵尸检测（弹框进程挂起不死，不杀会叠框）"
assert 'findstr /c:":8765 "' in bat, "就绪校验必须用 findstr 检查端口"
ok(5)

# 6 关窗空闲自动退出 + 更新等进程真死（v1.1.6，消除任务管理器残留/更新帮凶）
case(6, "关窗空闲退出(goodbye+10min) + 更新等进程真死 已落地")
srv = io.open(r"D:\lovelife\app\serve.py", encoding="utf-8").read()
assert ":WAITDEAD" in srv and "tasklist" in srv, "updater.cmd 必须等旧进程真正消失再替换"
assert "/api/goodbye" in srv and "_IDLE_EXIT_SEC = 600" in srv, "必须有关窗信标与 10 分钟空闲退出"
assert srv.count('if path == "/api/goodbye"') >= 2, \
    "goodbye 必须 GET/POST 双注册（sendBeacon 发 POST，曾只挂 GET 致 404、自动退出从未生效）"
assert "_idle_watchdog" in srv, "必须挂空闲看门线程"
# 行为：goodbye 置位、任何请求取消
assert "_CLIENT_GONE[0] = True" in srv and "_touch_activity()" in srv, "goodbye 置位/请求取消逻辑必须存在"
ok(6)

serve.ROOT = orig_root
print("========== update-done-flag：6 项全部通过 ==========")
