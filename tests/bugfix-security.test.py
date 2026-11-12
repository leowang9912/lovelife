# -*- coding: utf-8 -*-
"""bugfix-security.test.py — v1.0.5 审查修复单测：防穿越 / 类型防御 / 账号校验"""
import io, json, os, shutil, sys, tarfile, tempfile

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

# ---------- 1) 账号删除：拒绝路径穿越 id ----------
case(1, "账号删除：穿越 id 拒绝，合法删除正常")
_orig_data_root = serve.data_root  # 保存真函数供第 4 步恢复
root = tempfile.mkdtemp()
serve.data_root = lambda: root
accounts = [{"id": "me", "name": "Me", "icon": "x"}, {"id": "acc-2", "name": "B", "icon": "y"}]
serve.migrate_old_layout = lambda r: list(accounts)

class FakeHandler:
    def _json(self, obj, code=200):
        return {"__resp": obj, "__code": code}
    def _read_body(self):
        return json.dumps(self.body).encode("utf-8")

h = FakeHandler()
h.body = {"action": "delete", "id": "..", "purge": True}
resp = serve.Handler._handle_account(h)
assert resp["__code"] == 400, "delete '..' must be rejected: %r" % resp
h.body = {"action": "delete", "id": "me/x", "purge": True}
resp = serve.Handler._handle_account(h)
assert resp["__code"] == 400, "delete 'me/x' must be rejected"
h.body = {"action": "delete", "id": "ghost", "purge": True}
resp = serve.Handler._handle_account(h)
assert resp["__code"] == 404, "delete ghost id must be rejected"
parent_before = os.listdir(os.path.dirname(root))
h.body = {"action": "delete", "id": "acc-2", "purge": True}
resp = serve.Handler._handle_account(h)
assert resp["__code"] == 200, "legit delete must pass"
assert os.listdir(os.path.dirname(root)) == parent_before, "delete must not touch parent dir"
ok(1)

# ---------- 2) 备份恢复：穿越成员不落盘 + 非法 acc 拒绝 ----------
case(2, "备份恢复：穿越成员被拦截，正常文件恢复")
root2 = tempfile.mkdtemp()
serve.data_root = lambda: root2
acc_dir = serve.acc_dir(root2, "me")
outside_marker = os.path.join(os.path.dirname(root2), "pwned.txt")
if os.path.exists(outside_marker):
    os.remove(outside_marker)

buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w:gz") as tar:
    # 正常文件
    data = b"hello"
    info = tarfile.TarInfo("me/ok.txt")
    info.size = len(data)
    tar.addfile(info, io.BytesIO(data))
    # 穿越文件 x/../..
    info2 = tarfile.TarInfo("me/x/../../pwned.txt")
    info2.size = 4
    tar.addfile(info2, io.BytesIO(b"bad!"))
payload = buf.getvalue()

h2 = FakeHandler()
h2._read_body = lambda: payload
serve.migrate_old_layout = lambda r: [{"id": "me", "name": "Me", "icon": "x"}]
resp = serve.Handler._handle_restore(h2, "..")
assert resp["__code"] in (400, 404), "restore to '..' must be rejected: %r" % resp
resp = serve.Handler._handle_restore(h2, "me")
assert resp["__code"] == 200
assert os.path.isfile(os.path.join(acc_dir, "ok.txt")), "normal file restored"
assert not os.path.exists(outside_marker), "traversal file must NOT be written"
ok(2)

# ---------- 3) _read_json 类型防御 ----------
case(3, "_read_json：null/数组回退默认值")
p = os.path.join(root2, "null.json")
with io.open(p, "w", encoding="utf-8") as f:
    f.write("null")
assert serve._read_json(p, {"fallback": 1}) == {"fallback": 1}, "null content must fall back"
with io.open(p, "w", encoding="utf-8") as f:
    f.write("[]")
assert serve._read_json(p, {"fallback": 1}) == {"fallback": 1}, "array content must fall back"
with io.open(p, "w", encoding="utf-8") as f:
    f.write('{"a": 1}')
assert serve._read_json(p, {}) == {"a": 1}, "valid dict passes"
ok(3)

# ---------- 4) data_root 回退（跨电脑迁移场景） ----------
case(4, "data_root：盘符不存在自动回退安装目录")
serve.data_root = _orig_data_root  # restore
import importlib
bad_cfg = {"dataRoot": "Q:\\nonexist-drive-xx\\data"}
orig_rac = serve.read_app_config
serve.read_app_config = lambda: bad_cfg
r = serve.data_root()
assert r == os.path.join(serve.ROOT, "data"), "fallback to ROOT/data, got %r" % r
serve.read_app_config = orig_rac
ok(4)

shutil.rmtree(root, ignore_errors=True)
shutil.rmtree(root2, ignore_errors=True)
print("========== bugfix-security：4 项全部通过 ==========")
