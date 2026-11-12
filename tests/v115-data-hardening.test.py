# -*- coding: utf-8 -*-
"""v115-data-hardening.test.py — v1.1.5 数据加固回归锁
戊2 读写边界规范化（进盘前+出盘前双侧）：
     amount 强制 Number+round2（非法→0 计 warnings，字符串数字转数字）；
     date ^\\d{4}-\\d{2}-\\d{2}$（可解析归一+警告，不能解析置空+警告）；
     time ^\\d{2}:\\d{2}$ 范围校验（否则置空）；type 三枚举外剔除；id 非空字符串外剔除；
     accountId:''（不区分账户）合法不动；规范化结果写盘（一次归一永久生效）。
戊5 备份 manifest + 快照轮转 + 备份并发锁：
     tar 内 manifest.json（version/createdAt/account/files/totals）；恢复校验成员齐全
     （缺文件报"备份不完整"，无 manifest 旧备份兼容）；恢复前快照只留最近 5 份；
     打包持锁、排除 *.tmp、保留 .corrupt-* 隔离件。
戊6 数据体检服务端化 + 变更日志：
     /api/health 每文件解析状态（ok/corrupt-isolated/missing）+ 隔离件 + 悬空引用计数（只统计不修）；
     changelog.jsonl 追加 {ts,target,action,count}（不记内容本体），超 5000 行截断留 4000。
"""
import io
import json
import os
import shutil
import sys
import tarfile
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


class FakeHandler:
    def _json(self, obj, code=200):
        self.last = {"__resp": obj, "__code": code}
        return self.last

    def _read_body(self):
        return json.dumps(self.body).encode("utf-8")

    def _send(self, code, body, ctype=None, extra=None):
        self.last = {"__resp": None, "__code": code, "__body": body}
        return self.last


def read_file(p):
    with io.open(p, "r", encoding="utf-8") as f:
        return f.read()


def make_tar(entries):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in entries:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


# =====================================================================
# 场景 A：戊2 读写边界规范化
# =====================================================================
root = tempfile.mkdtemp()
serve.data_root = lambda: root
ACC = [{"id": "me", "name": "Me", "icon": "x"}]
serve.migrate_old_layout = lambda r: list(ACC)
d = serve.acc_dir(root, "me")
os.makedirs(os.path.join(d, "images"), exist_ok=True)
serve._read_unisolated.clear()

# ---------- 1) 金额：字符串数字转数字 / 非法置 0 计 warnings / round2 / int 原样 ----------
case(1, "金额归一：字符串数字转数字、非法置 0 计 warnings、round2、整数不改写")
with io.open(os.path.join(d, "wallet.json"), "w", encoding="utf-8") as f:
    json.dump({
        "schemaVersion": 3, "catsVersion": 2,
        "accounts": [{"id": "ac_cash", "name": "现金", "balance": 0}],
        "bills": [
            {"id": "b1", "type": "expense", "amount": "12.345", "date": "2026-11-06", "accountId": ""},
            {"id": "b2", "type": "expense", "amount": "abc", "date": "2026-11-06"},
            {"id": "b3", "type": "income", "amount": None, "date": "2026-11-06"},
            {"id": "b4", "type": "transfer", "amount": 3000, "date": "2026-11-06"},
        ],
        "tags": [], "imports": [], "balances": [], "templates": [],
    }, f)
db = serve.load_db("me")
bills = {b["id"]: b for b in db["wallet"]["bills"]}
assert abs(bills["b1"]["amount"] - 12.35) < 1e-9, "字符串数字应转数字并 round2: %r" % bills["b1"]["amount"]
assert isinstance(bills["b1"]["amount"], float), "字符串数字应转成数值类型: %r" % type(bills["b1"]["amount"])
assert bills["b2"]["amount"] == 0, "非数金额应置 0: %r" % bills["b2"]["amount"]
assert bills["b3"]["amount"] == 0, "null 金额（strict）应置 0: %r" % bills["b3"]["amount"]
assert bills["b4"]["amount"] == 3000 and isinstance(bills["b4"]["amount"], int), \
    "已是 round2 的整数不应被改写成浮点: %r" % bills["b4"]["amount"]
assert any("已置 0" in w and "b2" in w for w in db["warnings"]), "非法金额应计 warnings: %r" % db["warnings"]
assert any("b3" in w for w in db["warnings"]), "null 金额应计 warnings: %r" % db["warnings"]
ok(1)

# ---------- 2) 日期：可解析归一化 / 不能解析置空 / 合法不动 ----------
case(2, "日期归一：可解析归一化+警告、不能解析置空+警告、合法不动")
with io.open(os.path.join(d, "wallet.json"), "w", encoding="utf-8") as f:
    json.dump({
        "schemaVersion": 3, "catsVersion": 2, "accounts": [], "tags": [], "imports": [],
        "balances": [], "templates": [],
        "bills": [
            {"id": "d1", "type": "expense", "amount": 1, "date": "2026/11/6"},
            {"id": "d2", "type": "expense", "amount": 1, "date": "2026-13-45"},
            {"id": "d3", "type": "expense", "amount": 1, "date": "乱七八糟"},
            {"id": "d4", "type": "expense", "amount": 1, "date": "2026-11-06"},
        ],
    }, f)
db = serve.load_db("me")
bills = {b["id"]: b for b in db["wallet"]["bills"]}
assert bills["d1"]["date"] == "2026-11-06", "可解析日期应归一化为 YYYY-MM-DD: %r" % bills["d1"]["date"]
assert bills["d2"]["date"] == "", "非法日历日期应置空: %r" % bills["d2"]["date"]
assert bills["d3"]["date"] == "", "不能解析应置空: %r" % bills["d3"]["date"]
assert bills["d4"]["date"] == "2026-11-06", "合法日期必须原样不动: %r" % bills["d4"]["date"]
assert any("已归一化" in w and "d1" in w for w in db["warnings"]), "归一化应计 warnings: %r" % db["warnings"]
assert any("已置空" in w and "d3" in w for w in db["warnings"]), "置空应计 warnings: %r" % db["warnings"]
ok(2)

# ---------- 3) 时间：HH:MM 范围校验 ----------
case(3, "时间归一：HH:MM 范围校验，越界/格式非法定空")
with io.open(os.path.join(d, "wallet.json"), "w", encoding="utf-8") as f:
    json.dump({
        "schemaVersion": 3, "catsVersion": 2, "accounts": [], "tags": [], "imports": [],
        "balances": [], "templates": [],
        "bills": [
            {"id": "t1", "type": "expense", "amount": 1, "date": "2026-11-06", "time": "23:59"},
            {"id": "t2", "type": "expense", "amount": 1, "date": "2026-11-06", "time": "24:00"},
            {"id": "t3", "type": "expense", "amount": 1, "date": "2026-11-06", "time": "09:60"},
            {"id": "t4", "type": "expense", "amount": 1, "date": "2026-11-06", "time": "9:30"},
        ],
    }, f)
db = serve.load_db("me")
bills = {b["id"]: b for b in db["wallet"]["bills"]}
assert bills["t1"]["time"] == "23:59", "合法时间原样不动: %r" % bills["t1"]["time"]
assert bills["t2"]["time"] == "", "hh=24 应置空: %r" % bills["t2"]["time"]
assert bills["t3"]["time"] == "", "mm=60 应置空: %r" % bills["t3"]["time"]
assert bills["t4"]["time"] == "", "非 ^\\d{2}:\\d{2}$ 格式应置空: %r" % bills["t4"]["time"]
assert any("时间非法" in w and "t2" in w for w in db["warnings"]), "时间置空应计 warnings: %r" % db["warnings"]
ok(3)

# ---------- 4) type 三枚举 + id 非空字符串：非法剔除；accountId:'' 合法保留 ----------
case(4, "type/id 非法剔除计 warnings；accountId:'' 不区分账户合法保留")
with io.open(os.path.join(d, "wallet.json"), "w", encoding="utf-8") as f:
    json.dump({
        "schemaVersion": 3, "catsVersion": 2, "accounts": [], "tags": [], "imports": [],
        "balances": [], "templates": [],
        "bills": [
            {"id": "k1", "type": "expense", "amount": 1, "date": "2026-11-06", "accountId": ""},
            {"id": "k2", "type": "消费", "amount": 1, "date": "2026-11-06"},
            {"id": "k3", "amount": 1, "date": "2026-11-06"},
            {"id": "", "type": "expense", "amount": 1, "date": "2026-11-06"},
            {"type": "expense", "amount": 1, "date": "2026-11-06"},
            {"id": 123, "type": "expense", "amount": 1, "date": "2026-11-06"},
        ],
    }, f)
db = serve.load_db("me")
ids = [b.get("id") for b in db["wallet"]["bills"]]
assert ids == ["k1"], "type/id 非法应剔除，合法且 accountId:'' 的保留: %r" % ids
assert db["wallet"]["bills"][0]["accountId"] == "", "accountId:'' 是合法值不得当空值剔除"
assert any("type 非法" in w and "k2" in w for w in db["warnings"]), "type 非法应计 warnings: %r" % db["warnings"]
assert any("id 缺失或非法" in w for w in db["warnings"]), "id 非法应计 warnings: %r" % db["warnings"]
ok(4)

# ---------- 5) items/food 轻量归一：未填不动，脏值归一 ----------
case(5, "items/food 轻量归一：''/null 未填语义不动，脏金额/脏日期归一")
with io.open(os.path.join(d, "items.json"), "w", encoding="utf-8") as f:
    json.dump({"schemaVersion": 3, "items": [
        {"id": "i1", "name": "手机", "purchasePrice": "3.456", "purchaseDate": "2026.11.6",
         "soldPrice": "", "soldDate": ""},
        {"id": "i2", "name": "未填", "purchasePrice": None, "purchaseDate": None},
        {"id": "i3", "name": "脏价", "purchasePrice": "x元", "purchaseDate": "不知名"},
    ]}, f)
with io.open(os.path.join(d, "food.json"), "w", encoding="utf-8") as f:
    json.dump({"schemaVersion": 3, "records": [
        {"id": "f1", "name": "午饭", "price": "10.5", "date": "2026-11-06T12:00:00"},
    ]}, f)
db = serve.load_db("me")
it = {i["id"]: i for i in db["items"]}
assert abs(it["i1"]["purchasePrice"] - 3.46) < 1e-9, "字符串金额应转数字并 round2: %r" % it["i1"]["purchasePrice"]
assert it["i1"]["purchaseDate"] == "2026-11-06", "可解析日期应归一化: %r" % it["i1"]["purchaseDate"]
assert it["i1"]["soldPrice"] == "" and it["i1"]["soldDate"] == "", "未填 '' 必须原样保留"
assert it["i2"]["purchasePrice"] is None and it["i2"]["purchaseDate"] is None, "null 未填语义必须原样保留"
assert it["i3"]["purchasePrice"] == 0, "非数金额轻量归一也应置 0: %r" % it["i3"]["purchasePrice"]
assert it["i3"]["purchaseDate"] == "", "不能解析的日期应置空"
fd = db["food"][0]
assert abs(fd["price"] - 10.5) < 1e-9 and fd["date"] == "2026-11-06", "food 金额/日期轻量归一: %r %r" % (fd["price"], fd["date"])
assert any("i3" in w for w in db["warnings"]), "items 脏值应计 warnings: %r" % db["warnings"]
ok(5)

# ---------- 6) 规范化结果写盘：一次归一永久生效 ----------
case(6, "规范化结果写盘，二次加载零 warning 永久生效")
saved = json.loads(read_file(os.path.join(d, "items.json")))
saved_bills = json.loads(read_file(os.path.join(d, "wallet.json")))
assert abs(saved["items"][0]["purchasePrice"] - 3.46) < 1e-9, "归一化结果必须写盘: %r" % saved["items"][0]
assert saved["items"][1]["purchasePrice"] is None, "未填字段写盘也不许被改成 0: %r" % saved["items"][1]
db2 = serve.load_db("me")
norm_warnings = [w for w in db2["warnings"] if "归一" in w or "已置" in w or "已剔除" in w]
assert norm_warnings == [], "二次加载不应再产生归一化 warning（一次归一永久生效）: %r" % db2["warnings"]
assert abs(db2["items"][0]["purchasePrice"] - 3.46) < 1e-9, "二次加载应读到归一值"
ok(6)

# ---------- 7) save 侧归一化（进盘前）+ warnings 随响应下发 ----------
case(7, "save 侧进盘前归一：金额/日期/枚举/id 处理与 load 侧同语义")
h = FakeHandler()
h.body = {"target": "wallet", "acc": "me", "data": {
    "bills": [
        {"id": "s1", "type": "expense", "amount": "12.345", "date": "2026/1/2", "time": "25:00", "accountId": ""},
        {"id": "s2", "type": "买买买", "amount": 5, "date": "2026-11-06"},
        {"id": "", "type": "expense", "amount": 5, "date": "2026-11-06"},
        {"id": "s3", "type": "income", "amount": "xyz", "date": "2026-11-06"},
    ],
    "accounts": [], "cats": {"expense": [], "income": []}, "tags": [], "imports": [],
    "balances": [{"id": "bl1", "accountId": "ac_x", "date": "2026-11-06", "balance": "88.888"}],
    "templates": [], "catsVersion": 2,
}}
resp = serve.Handler._handle_save(h)
assert resp["__code"] == 200 and resp["__resp"].get("ok"), "save 应成功: %r" % resp
assert isinstance(resp["__resp"].get("warnings"), list) and resp["__resp"]["warnings"], \
    "save 侧归一化 warnings 应随响应下发: %r" % resp["__resp"]
disk = json.loads(read_file(os.path.join(d, "wallet.json")))
dbills = {b["id"]: b for b in disk["bills"]}
assert [b["id"] for b in disk["bills"]] == ["s1", "s3"], "进盘前应剔除 type/id 非法账单: %r" % disk["bills"]
assert abs(dbills["s1"]["amount"] - 12.35) < 1e-9 and dbills["s1"]["date"] == "2026-01-02" \
    and dbills["s1"]["time"] == "", "save 侧金额/日期/时间归一: %r" % dbills["s1"]
assert dbills["s3"]["amount"] == 0, "save 侧非法金额应置 0: %r" % dbills["s3"]
assert disk["bills"][0]["accountId"] == "", "save 侧 accountId:'' 同样合法保留"
assert abs(disk["balances"][0]["balance"] - 88.89) < 1e-9, "余额快照金额归一（不动余额语义）: %r" % disk["balances"][0]
h.body = {"target": "items", "acc": "me", "data": [{"id": "x1", "purchasePrice": "2.5", "purchaseDate": "20260315"}]}
resp = serve.Handler._handle_save(h)
saved_items = json.loads(read_file(os.path.join(d, "items.json")))["items"]
assert saved_items[0]["purchasePrice"] == 2.5 and saved_items[0]["purchaseDate"] == "2026-03-15", \
    "items save 侧轻量归一: %r" % saved_items[0]
ok(7)

# ---------- 8) changelog：save/load 变更日志（元数据、不含内容本体） ----------
case(8, "changelog.jsonl：save/load 各记元数据行，不记内容本体")
log_path = os.path.join(d, "changelog.jsonl")
assert os.path.isfile(log_path), "changelog.jsonl 应生成: %s" % log_path
lines = [json.loads(x) for x in read_file(log_path).strip().splitlines()]
save_lines = [x for x in lines if x["action"] == "save" and x["target"] == "wallet"]
assert save_lines and save_lines[-1]["count"] == 2, "save 应记 target/count: %r" % save_lines
load_lines = [x for x in lines if x["action"] == "load"]
targets = {x["target"] for x in load_lines}
assert {"items", "outfits", "food", "events", "settings", "wallet"} <= targets, \
    "load 应按数据域记行: %r" % targets
for x in lines:
    assert set(x.keys()) == {"ts", "target", "action", "count"}, "changelog 行只记元数据: %r" % x
assert "12.345" not in read_file(log_path) and "手机" not in read_file(log_path), \
    "changelog 不得记内容本体"
ok(8)

# ---------- 9) changelog 截断：超 5000 行保留最近 4000 ----------
case(9, "changelog 截断：超 5000 行保留最近 4000 行")
with io.open(log_path, "w", encoding="utf-8") as f:
    for i in range(5000):
        f.write(json.dumps({"ts": "2026-01-01 00:00:00", "target": "items",
                            "action": "save", "count": i}) + "\n")
serve._log_change(d, "items", "save", 5000)
kept = read_file(log_path).strip().splitlines()
assert len(kept) == 4000, "截断后应保留 4000 行: %d" % len(kept)
assert json.loads(kept[-1])["count"] == 5000, "必须保留最近的行: %r" % kept[-1]
assert json.loads(kept[0])["count"] == 1001, "最旧的行应被清理（5001 行截断留 4000 = count 1001..5000）: %r" % kept[0]
ok(9)

shutil.rmtree(root, ignore_errors=True)

# =====================================================================
# 场景 B：戊5 备份 manifest + 快照轮转
# =====================================================================
root = tempfile.mkdtemp()
serve.data_root = lambda: root
serve.migrate_old_layout = lambda r: list(ACC)
d = serve.acc_dir(root, "me")
os.makedirs(os.path.join(d, "images"), exist_ok=True)
with io.open(os.path.join(d, "items.json"), "w", encoding="utf-8") as f:
    json.dump({"schemaVersion": 3, "items": [{"id": "i1"}, {"id": "i2"}]}, f)
with io.open(os.path.join(d, "wallet.json"), "w", encoding="utf-8") as f:
    json.dump({"schemaVersion": 3, "catsVersion": 2, "accounts": [], "tags": [], "imports": [],
               "balances": [], "templates": [],
               "bills": [{"id": "b1", "type": "expense", "amount": 1, "date": "2026-11-06"},
                         {"id": "b2", "type": "expense", "amount": 2, "date": "2026-11-06"},
                         {"id": "b3", "type": "income", "amount": 3, "date": "2026-11-06"}]}, f)
with io.open(os.path.join(d, "food.json.corrupt-20260101-000000"), "w", encoding="utf-8") as f:
    f.write("{ 坏文件留档")
with io.open(os.path.join(d, "items.json.tmp-99-00ab"), "w", encoding="utf-8") as f:
    f.write("半成品")
with io.open(os.path.join(d, "images", "img-a.webp"), "wb") as f:
    f.write(b"RIFF0000WEBP")

# ---------- 10) 备份 manifest ----------
case(10, "备份 manifest：files/totals 齐全，排除 *.tmp、保留 .corrupt-*")
h = FakeHandler()
serve.Handler._send_backup(h, "me")
assert h.last["__code"] == 200, "备份应成功: %r" % h.last
tar_bytes = h.last["__body"]
names = []
manifest = None
with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as tar:
    for m in tar.getmembers():
        names.append(m.name)
        if m.name.endswith("/manifest.json"):
            manifest = json.loads(tar.extractfile(m).read().decode("utf-8"))
assert manifest is not None, "备份 tar 内必须有 manifest.json: %r" % names
assert manifest.get("version") == serve.SERVER_BUILD, "manifest.version 应为 SERVER_BUILD: %r" % manifest
assert isinstance(manifest.get("createdAt"), int), "manifest.createdAt 应为时间戳: %r" % manifest
assert manifest.get("account") == "me", "manifest.account: %r" % manifest
files = manifest.get("files") or {}
assert files.get("items.json", {}).get("count") == 2, "files.items.json.count: %r" % files
assert files.get("wallet.json", {}).get("count") == 3, "files.wallet.json.count: %r" % files
assert files.get("items.json", {}).get("size", 0) > 0, "files 应记 size: %r" % files
assert "images/img-a.webp" in files, "图片成员应进清单: %r" % files
totals = manifest.get("totals") or {}
assert totals.get("items") == 2 and totals.get("bills") == 3, "totals: %r" % totals
assert not any(".tmp" in n for n in names), "*.tmp 半成品不得进备份: %r" % names
assert any(".corrupt-" in n for n in names), ".corrupt-* 隔离件应保留进备份: %r" % names
assert any(n.endswith("items.json") for n in names), "数据文件应进备份: %r" % names
ok(10)

# ---------- 11) manifest 恢复往返 / 缺文件"备份不完整" / 无 manifest 兼容 ----------
case(11, "manifest 恢复往返：缺文件报备份不完整，无 manifest 旧备份照常恢复")
h._read_body = lambda: tar_bytes
resp = serve.Handler._handle_restore(h, "me")
assert resp["__code"] == 200 and resp["__resp"].get("ok"), "齐全备份应恢复成功: %r" % resp
assert len(json.loads(read_file(os.path.join(d, "items.json")))["items"]) == 2, "恢复后数据完整"
# 从备份中剔掉一个成员 → 备份不完整
stripped = io.BytesIO()
with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as src, \
        tarfile.open(fileobj=stripped, mode="w:gz") as dst:
    for m in src.getmembers():
        if m.name.endswith("items.json") and not m.name.endswith("manifest.json"):
            continue  # 故意漏掉清单里的 items.json
        dst.addfile(m, src.extractfile(m) if m.isfile() else None)
before = read_file(os.path.join(d, "items.json"))
h._read_body = lambda: stripped.getvalue()
resp = serve.Handler._handle_restore(h, "me")
assert resp["__code"] == 400 and "备份不完整" in resp["__resp"]["error"], \
    "缺文件必须报备份不完整: %r" % resp
assert read_file(os.path.join(d, "items.json")) == before, "备份不完整不得动现网数据"
# 无 manifest 的旧备份：兼容照常恢复
h._read_body = lambda: make_tar([("me/items.json", json.dumps(
    {"schemaVersion": 3, "items": [{"id": "legacy"}]}).encode("utf-8"))])
resp = serve.Handler._handle_restore(h, "me")
assert resp["__code"] == 200 and resp["__resp"].get("ok"), "无 manifest 旧备份应照常恢复: %r" % resp
assert json.loads(read_file(os.path.join(d, "items.json")))["items"] == [{"id": "legacy"}]
ok(11)

# ---------- 12) 快照轮转：同类快照只留最近 5 份 ----------
case(12, "快照轮转：恢复前快照只保留最近 5 份，更旧自动清理")
for i in range(7):
    h._read_body = lambda i=i: make_tar([("me/items.json", json.dumps(
        {"schemaVersion": 3, "items": [{"id": "r%d" % i}]}).encode("utf-8"))])
    resp = serve.Handler._handle_restore(h, "me")
    assert resp["__code"] == 200, "第 %d 次恢复应成功: %r" % (i + 1, resp)
snaps = sorted(n for n in os.listdir(root) if n.startswith("me_restore_bak_"))
assert len(snaps) == 5, "同类快照只留最近 5 份: %r" % snaps
newest = sorted(os.listdir(root))
assert all(s in snaps for s in sorted(n for n in os.listdir(root)
                                      if n.startswith("me_restore_bak_"))), "保留的应是最近 5 份"
assert json.loads(read_file(os.path.join(d, "items.json")))["items"] == [{"id": "r6"}], "最后一次恢复的数据应在位"
ok(12)

shutil.rmtree(root, ignore_errors=True)

# =====================================================================
# 场景 C：戊6 /api/health 数据体检（只统计不修）
# =====================================================================
root = tempfile.mkdtemp()
serve.data_root = lambda: root
serve.migrate_old_layout = lambda r: list(ACC)
d = serve.acc_dir(root, "me")
os.makedirs(os.path.join(d, "images"), exist_ok=True)
with io.open(os.path.join(d, "items.json"), "w", encoding="utf-8") as f:
    json.dump({"schemaVersion": 3, "items": [
        {"id": "i1", "name": "好", "linkedBillIds": ["b1", "ghost-bill"]},
        {"id": "i2", "name": "父", "parentItemId": "ghost-item"},
    ]}, f)
with io.open(os.path.join(d, "food.json"), "w", encoding="utf-8") as f:
    f.write("{ 坏 JSON，health 只报告不隔离")
with io.open(os.path.join(d, "food.json.corrupt-20260101-000000"), "w", encoding="utf-8") as f:
    f.write("{ 早前隔离件")
with io.open(os.path.join(d, "wallet.json"), "w", encoding="utf-8") as f:
    json.dump({"schemaVersion": 3, "catsVersion": 2, "tags": [], "imports": [],
               "templates": [],
               "accounts": [{"id": "ac_cash", "name": "现金", "balance": 0}],
               "bills": [
                   {"id": "b1", "type": "expense", "amount": 1, "date": "2026-11-06",
                    "itemId": "i1", "foodId": "ghost-food", "accountId": "ac_cash"},
                   {"id": "b2", "type": "expense", "amount": 1, "date": "2026-11-06",
                    "itemId": "ghost-item", "accountId": "ac_gone", "toAccountId": "ac_gone2"},
                   {"id": "b3", "type": "expense", "amount": 1, "date": "2026-11-06", "accountId": ""},
               ],
               "balances": [{"id": "bl1", "accountId": "ac_cash", "date": "2026-11-06", "balance": 1},
                            {"id": "bl2", "date": "2026-11-06", "balance": 2}]}, f)

# ---------- 13) /api/health 响应结构 ----------
case(13, "/api/health：文件状态/隔离件/悬空引用计数/只读不修")
h = FakeHandler()
serve.Handler._handle_health(h, "me")
resp = h.last["__resp"]
assert h.last["__code"] == 200 and resp.get("ok"), "health 应 200: %r" % h.last
assert resp.get("serverBuild") == serve.SERVER_BUILD, "serverBuild: %r" % resp
assert resp.get("account", {}).get("id") == "me", "account: %r" % resp
files = resp["files"]
assert files["items.json"]["status"] == "ok" and files["items.json"]["records"] == 2, \
    "items.json 状态: %r" % files["items.json"]
assert files["food.json"]["status"] == "corrupt-isolated", "坏文件状态: %r" % files["food.json"]
assert files["outfits.json"]["status"] == "missing", "缺文件状态: %r" % files["outfits.json"]
assert files["settings.json"]["status"] == "missing", "settings 缺失: %r" % files["settings.json"]
assert "food.json.corrupt-20260101-000000" in resp["isolated"], "隔离件清单: %r" % resp["isolated"]
integ = resp["integrity"]
assert set(integ.keys()) == {"danglingItemId", "danglingFoodId", "danglingAccountId", "danglingBillId"}, \
    "integrity 键: %r" % integ
assert integ["danglingItemId"] == 2, \
    "悬空 itemId=2（b2.itemId + i2.parentItemId）: %r" % integ
assert integ["danglingFoodId"] == 1, "悬空 foodId=1: %r" % integ
assert integ["danglingAccountId"] == 2, \
    "悬空 accountId=2（ac_gone/ac_gone2；'' 与旧余额无 accountId 不计）: %r" % integ
assert integ["danglingBillId"] == 1, "悬空 billId=1（ghost-bill）: %r" % integ
assert any("food.json" in w for w in resp["warnings"]), "坏文件应进 warnings: %r" % resp["warnings"]
# 只读不修：坏文件未被隔离改名、悬空引用原样在盘
assert os.path.isfile(os.path.join(d, "food.json")), "health 不得隔离坏文件"
assert json.loads(read_file(os.path.join(d, "wallet.json")))["bills"][1]["itemId"] == "ghost-item", \
    "health 不得修悬空引用（修复走前端 repairData）"
ok(13)

shutil.rmtree(root, ignore_errors=True)
print("========== v115 数据加固（戊2/戊5/戊6）：13 项全部通过 ==========")
