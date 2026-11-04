# -*- coding: utf-8 -*-
"""update-done-flag.test.py — v1.0.7 更新完成落盘标记 + 预设标签精简迁移 + v1.0.9 启动稳定性"""
import io, json, os, sys, tempfile, time

sys.path.insert(0, r"D:\lovelife\app")
import serve

orig_root = serve.ROOT
root = tempfile.mkdtemp()
serve.ROOT = root

# ---------- 1) 落盘标记四态：无 / 新鲜 / 过期 / 损坏 ----------
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
print("OK  1 更新完成标记：无/新鲜/过期/损坏 四态正确")

# ---------- 2) update/status：进程重启后仍能报告 done ----------
with open(flag_path, "w", encoding="utf-8") as f:
    json.dump({"version": "1.0.7", "time": time.time()}, f)
serve.UPDATE_STATE.update(state="idle", phase="", error="", downloaded=0, total=0, source="")


class FakeHandler:
    def _json(self, obj, code=200):
        return {"__resp": obj, "__code": code}


resp = serve.Handler._handle_update_status(FakeHandler())
assert resp["__resp"]["state"] == "done" and resp["__resp"]["version"] == "1.0.7", \
    "status must report done from flag, got %r" % resp["__resp"]
print("OK  2 update/status：重启后仍报告 done（自动刷新的依据）")

# ---------- 3) clear-done 清标记 ----------
serve.Handler._handle_update_clear_done(FakeHandler())
assert not os.path.exists(flag_path), "clear-done removes flag"
print("OK  3 clear-done：标记清除")

# ---------- 4) 预设标签精简：以服务端 3 个为准，老预设不回填 ----------
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
print("OK  4 预设标签精简为 3，老预设不回填（物品已打标签保留）")

# ---------- 5) v1.0.9：DLL 释放目录 + 更新器自动重启重试 ----------
build = io.open(r"D:\lovelife\build_exe.py", encoding="utf-8").read()
assert "--runtime-tmpdir" in build, "build_exe.py 必须指定 runtime 释放目录（离开 %TEMP%）"
srv = io.open(r"D:\lovelife\app\serve.py", encoding="utf-8").read()
assert ":RESTART" in srv and "update-restart.log" in srv and "LSS 3" in srv, \
    "updater.cmd 必须带重启重试（3 次）与失败日志"
assert 'findstr /c:":8765 "' in srv, "重启就绪校验必须用 findstr 检查端口"
print("OK  5 DLL 释放目录(runtime) + 更新器重启重试x3 已落地")

serve.ROOT = orig_root

serve.ROOT = orig_root
print("========== 更新标记/标签迁移 全部通过 ==========")
