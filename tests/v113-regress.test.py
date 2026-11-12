# -*- coding: utf-8 -*-
"""v113-regress.test.py — v1.1.3 回归锁（审查+数据）
= 原 v113-review.test.py（模板账单不丢，3 组）+ v113-data.test.py（数据层漏洞修复，10 组）合并。

审查背景 bug：load_db 不读 wallet.json 的 templates 字段，前端拿到 undefined 后
下一次 persist('wallet') 会把 templates 写成 []，用户存的模板账单被静默洗掉。
数据背景：
P0-2 坏 JSON 不许被静默覆盖：解析失败先改名隔离（本体保留）再回退；
     隔离失败时禁止写入覆盖；load_db 下发 warnings。
P0-3 数组元素类型脏不得让 /api/db 整站不可用：元素级过滤 + settings/wallet 防御。
P1-2 acc 不在账号表 → 409（不许静默写进 accounts[0]）；读侧 /api/db 回落保留。
P2-6 schemaVersion 不许被 data 同名键覆盖。
"""
import io
import json
import os
import shutil
import sys
import tempfile

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')
APP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app")
if APP not in sys.path:
    sys.path.insert(0, APP)
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

# =====================================================================
# 前 3 组：v1.1.3 审查回归锁 —— 模板账单（wallet.templates）不得在读盘时丢失
# =====================================================================
root = tempfile.mkdtemp()
serve.data_root = lambda: root
serve.migrate_old_layout = lambda r: [{"id": "me", "name": "Me", "icon": "x"}]
d = serve.acc_dir(root, "me")
os.makedirs(d, exist_ok=True)

tpl = [{"id": "tpl-1", "name": "房租 3000", "type": "expense", "catId": "w_home",
        "subCatId": "w_hm_rent", "amount": 3000, "note": "房租", "accountId": "ac_bank"}]
with open(os.path.join(d, "wallet.json"), "w", encoding="utf-8") as f:
    json.dump({
        "schemaVersion": 3,
        "bills": [], "accounts": [{"id": "ac_bank", "name": "银行卡", "balance": 100}],
        "tags": [], "imports": [], "balances": [],
        "catsVersion": 2,
        "templates": tpl,
    }, f)

# 1) load_db 必须下发 templates（否则前端 persist 会写回 [] 洗数据）
case(1, "load_db 下发 wallet.templates（不丢模板）")
db = serve.load_db("me")
assert db["wallet"].get("templates") == tpl, "templates 读盘丢失: %r" % db["wallet"].get("templates")
ok(1)

# 2) default_wallet 含 templates 键（新账号初始结构完整）
case(2, "default_wallet 含 templates 键")
assert "templates" in serve.default_wallet(), "default_wallet 缺 templates 键"
ok(2)

# 3) 完整写回-再读回（模拟前端 persist → 重启加载）模板仍在
case(3, "模板写回-再读回不丢")
saved_wallet = dict(db["wallet"])
saved_wallet["catsVersion"] = 2
serve._write_json(os.path.join(d, "wallet.json"), {"schemaVersion": 3, **saved_wallet})
db2 = serve.load_db("me")
assert db2["wallet"].get("templates") == tpl, "写回再读回 templates 丢失: %r" % db2["wallet"].get("templates")
ok(3)

shutil.rmtree(root, ignore_errors=True)

# =====================================================================
# 后 10 组：v1.1.3 数据层漏洞修复回归锁
# =====================================================================
root = tempfile.mkdtemp()
serve.data_root = lambda: root
ACC = [{"id": "me", "name": "Me", "icon": "x"}]
serve.migrate_old_layout = lambda r: list(ACC)
d = serve.acc_dir(root, "me")
os.makedirs(d, exist_ok=True)
serve._read_unisolated.clear()

BAD_RAW = '{"items": [ {"id": "a", "name": "破损数据"'  # 坏 JSON（可手工修复的损坏）


def read_file(p):
    with io.open(p, "r", encoding="utf-8") as f:
        return f.read()


# ---------- P0-2 4) 坏 JSON 隔离：改名保留本体，不许被覆盖成空 ----------
case(4, "坏 JSON 改名隔离，本体保留不丢")
with io.open(os.path.join(d, "items.json"), "w", encoding="utf-8") as f:
    f.write(BAD_RAW)
db = serve.load_db("me")
assert db["items"] == [], "坏 JSON 应回退空集合: %r" % db["items"]
assert any("items.json" in w and "隔离" in w for w in db["warnings"]), \
    "load_db 应下发坏文件隔离警告: %r" % db["warnings"]
quarantined = [n for n in os.listdir(d) if n.startswith("items.json.corrupt-")]
assert quarantined, "坏文件应改名隔离为 .corrupt-<时间戳>: %r" % os.listdir(d)
assert not os.path.exists(os.path.join(d, "items.json")), "坏文件本体应改名走（不是原地覆盖）"
assert read_file(os.path.join(d, quarantined[0])) == BAD_RAW, "隔离件必须保留用户坏文件本体"
ok(4)

# ---------- P0-2 5) 隔离成功后可以正常写入（新数据不受影响） ----------
case(5, "隔离后新数据正常读写，隔离件不被波及")
serve._write_json(os.path.join(d, "items.json"), {"schemaVersion": 3, "items": [{"id": "new1"}]})
db = serve.load_db("me")
assert [i["id"] for i in db["items"]] == ["new1"], "隔离后新数据应正常读写"
assert os.path.exists(os.path.join(d, quarantined[0])), "后续写入不得动到隔离件"
ok(5)

# ---------- P0-2 6) 隔离失败（文件占用）→ 禁止写入覆盖 ----------
case(6, "隔离失败 → 禁写保护，坏文件不被覆盖")
orig_quar = serve._quarantine_corrupt
serve._quarantine_corrupt = lambda p: None  # 模拟改名失败（如文件被占用）
with io.open(os.path.join(d, "food.json"), "w", encoding="utf-8") as f:
    f.write("{{{ 不是 JSON")
db = serve.load_db("me")
assert any("food.json" in w for w in db["warnings"]), "隔离失败也要有警告: %r" % db["warnings"]
blocked = False
try:
    serve._write_json(os.path.join(d, "food.json"), {"schemaVersion": 3, "records": []})
except OSError:
    blocked = True
assert blocked, "隔离失败后 _write_json 必须拒绝覆盖损坏文件"
assert read_file(os.path.join(d, "food.json")) == "{{{ 不是 JSON", "损坏文件本体不许被写坏"
serve._quarantine_corrupt = orig_quar
serve._read_unisolated.clear()
ok(6)

# ---------- P0-3 7) 数组元素类型脏：元素级过滤 + warnings，整站不 500 ----------
case(7, "脏数组元素剔除 + warnings，/api/db 不炸")
with io.open(os.path.join(d, "items.json"), "w", encoding="utf-8") as f:
    json.dump({"schemaVersion": 3,
               "items": [{"id": "a", "name": "好记录"}, "脏字符串", 123, None,
                         {"id": "b", "name": "另一条"}]}, f)
with io.open(os.path.join(d, "outfits.json"), "w", encoding="utf-8") as f:
    json.dump({"schemaVersion": 3, "outfits": [[1, 2], {"id": "o1"}]}, f)
with io.open(os.path.join(d, "events.json"), "w", encoding="utf-8") as f:
    json.dump({"schemaVersion": 3, "events": "oops"}, f)
db = serve.load_db("me")
assert [i["id"] for i in db["items"]] == ["a", "b"], "脏元素应被剔除: %r" % db["items"]
assert [o["id"] for o in db["outfits"]] == ["o1"], "outfits 脏元素应被剔除"
assert db["events"] == [], "events 非列表应回退 []"
assert any("已剔除" in w for w in db["warnings"]), "剔除脏元素应计 warnings: %r" % db["warnings"]
assert any("events.json" in w for w in db["warnings"]), "非列表结构应计 warnings"
ok(7)

# ---------- P0-3 8) accounts 脏元素 / settings.settings 非 dict ----------
case(8, "accounts/settings 脏结构防御，整站可用")
with io.open(os.path.join(root, "accounts.json"), "w", encoding="utf-8") as f:
    json.dump([{"id": "me", "name": "Me"}, "脏账号", 42, {"no_id": 1}], f)
accts = serve.read_accounts(root)
assert [a["id"] for a in accts] == ["me"], "accounts 脏元素应被读取侧过滤: %r" % accts
with io.open(os.path.join(d, "settings.json"), "w", encoding="utf-8") as f:
    json.dump({"schemaVersion": 3, "settings": [1, 2, 3], "categories": "炸"}, f)
db = serve.load_db("me")  # 不许抛异常
assert db["account"]["id"] == "me", "脏账号元素不得影响账号解析: %r" % db["account"]
assert isinstance(db["settings"], dict) and db["settings"].get("currency") == "¥", \
    "settings.settings 非 dict 时应按默认合并: %r" % db["settings"]
assert any("settings" in w for w in db["warnings"]), "settings 脏结构应计 warnings"
ok(8)

# ---------- P0-3 9) wallet 子字段键级+元素级防御 ----------
case(9, "wallet 子字段键级/元素级防御")
with io.open(os.path.join(d, "wallet.json"), "w", encoding="utf-8") as f:
    json.dump({"schemaVersion": 3, "catsVersion": 2,
               "bills": "oops", "tags": [1, "x", {"id": "t1", "name": "标签"}],
               "imports": {"a": 1}, "balances": [], "templates": [None, {"id": "tpl1"}],
               "accounts": "bad", "cats": {"expense": ["junk", {"id": "e1", "name": "自定义"}],
                                           "income": "bad"}}, f)
db = serve.load_db("me")
w = db["wallet"]
assert w["bills"] == [], "bills 非列表应回退 []: %r" % w["bills"]
assert [t["id"] for t in w["tags"]] == ["t1"], "tags 脏元素应剔除: %r" % w["tags"]
assert w["imports"] == [], "imports 非列表应回退 []"
assert [t["id"] for t in w["templates"]] == ["tpl1"], "templates 脏元素应剔除（模板仍下发）"
assert isinstance(w["accounts"], list) and w["accounts"], "accounts 非列表应回退默认账户"
assert [c["id"] for c in w["cats"]["expense"]] == ["e1"], \
    "cats.expense 脏元素应剔除: %r" % w["cats"]["expense"]
assert w["cats"]["income"] == [], "cats.income 非列表应回退 []"
assert any("wallet.cats.income" in x for x in db["warnings"]), "cats 脏结构应计 warnings"
ok(9)

# ---------- P1-2 10) acc 不在账号表 → 409；合法 acc 正常保存 ----------
case(10, "未知 acc 保存/备份 409，合法 acc 正常")


class FakeHandler:
    def _json(self, obj, code=200):
        self.last = {"__resp": obj, "__code": code}
        return self.last

    def _read_body(self):
        return json.dumps(self.body).encode("utf-8")

    def _send(self, code, body, ctype=None, extra=None):
        self.last = {"__resp": None, "__code": code, "__body": body}
        return self.last


h = FakeHandler()
h.body = {"target": "items", "data": [{"id": "x"}], "acc": "ghost"}
resp = serve.Handler._handle_save(h)
assert resp["__code"] == 409, "未知 acc 必须 409，不许静默写 accounts[0]: %r" % resp
assert "刷新" in resp["__resp"]["error"], "409 文案应提示刷新: %r" % resp["__resp"]
h.body = {"target": "items", "data": [{"id": "x"}], "acc": "me"}
resp = serve.Handler._handle_save(h)
assert resp["__code"] == 200 and resp["__resp"].get("ok"), "合法 acc 应正常保存: %r" % resp
assert json.loads(read_file(os.path.join(d, "items.json")))["items"] == [{"id": "x"}]
# 备份读侧同样 409（不给别的账号数据）；_send_backup 成功路径只写响应不 return，看 h.last
serve.Handler._send_backup(h, "ghost")
assert h.last["__code"] == 409, "备份未知 acc 必须 409: %r" % h.last
serve.Handler._send_backup(h, "me")
assert h.last["__code"] == 200, "合法 acc 备份应正常: %r" % h.last
ok(10)

# ---------- P1-2 11) /api/db 读侧回落保留（不破坏打开页面） ----------
case(11, "/api/db 读侧账号回落保留")
db = serve.load_db("ghost-acc")  # 不抛异常，回落到真实账号
assert db["account"]["id"] == "me", "读侧应回落到真实账号: %r" % db["account"]
ok(11)

# ---------- P2-6 12) schemaVersion 不许被 data 覆盖 ----------
case(12, "schemaVersion 不可被 payload 覆盖")
h.body = {"target": "settings", "data": {"schemaVersion": 99, "settings": {"theme": "dark"}},
          "acc": "me"}
resp = serve.Handler._handle_save(h)
assert resp["__code"] == 200
saved = json.loads(read_file(os.path.join(d, "settings.json")))
assert saved["schemaVersion"] == 3, "schemaVersion 被 data 覆盖了: %r" % saved
assert saved["settings"]["theme"] == "dark"
h.body = {"target": "wallet", "data": {"schemaVersion": 99, "bills": [], "accounts": [],
                                      "cats": {}, "tags": [], "imports": [], "balances": [],
                                      "templates": [], "catsVersion": 2}, "acc": "me"}
resp = serve.Handler._handle_save(h)
assert resp["__code"] == 200
saved = json.loads(read_file(os.path.join(d, "wallet.json")))
assert saved["schemaVersion"] == 3, "wallet schemaVersion 被覆盖了: %r" % saved
ok(12)

# ---------- P1-4 13) 恢复备份：坏 JSON 中止不动盘 / 新版本拒绝 / 成功留快照 ----------
case(13, "恢复备份：坏包中止/新版本拒绝/成功留快照")
import tarfile  # noqa: E402


def make_tar(entries):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in entries:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


# 13a 坏 JSON 成员 → 400 中止，当前数据不动
before = read_file(os.path.join(d, "items.json"))
h._read_body = lambda: make_tar([("me/items.json", b'{"items": [broken')])
resp = serve.Handler._handle_restore(h, "me")
assert resp["__code"] == 400 and "损坏" in resp["__resp"]["error"], "坏 JSON 备份应中止: %r" % resp
assert read_file(os.path.join(d, "items.json")) == before, "中止恢复不得动当前数据"
# 13b 备份版本比当前 exe 新 → 拒绝
h._read_body = lambda: make_tar([("me/version.json", json.dumps({"version": "99.0.0"}).encode("utf-8"))])
resp = serve.Handler._handle_restore(h, "me")
assert resp["__code"] == 400 and "升级" in resp["__resp"]["error"], "新版本备份应拒绝并提示升级: %r" % resp
# 13c 正常恢复成功，且留恢复前快照
h._read_body = lambda: make_tar([("me/items.json", json.dumps({"schemaVersion": 3, "items": [{"id": "restored"}]}).encode("utf-8"))])
resp = serve.Handler._handle_restore(h, "me")
assert resp["__code"] == 200 and resp["__resp"].get("ok"), "正常备份应恢复成功: %r" % resp
assert json.loads(read_file(os.path.join(d, "items.json")))["items"] == [{"id": "restored"}]
snaps = [n for n in os.listdir(root) if n.startswith("me_restore_bak_")]
assert len(snaps) == 1, "恢复成功后应保留一份恢复前快照: %r" % snaps
ok(13)

shutil.rmtree(root, ignore_errors=True)
print("========== v1.1.3 回归锁（审查+数据）：13 项全部通过 ==========")
