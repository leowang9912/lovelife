# -*- coding: utf-8 -*-
"""taxonomy-guard.test.py — v1.0.9 回归锁：分类迁移不得改写新体系物品"""
import json, os, sys, tempfile

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

# 1) 新建物品（无 taxonomy 标记）不被当旧数据洗
case(1, "新建物品分类不被改写")
new_item = {"id": "x1", "kind": "device", "categoryId": "host", "subCategoryId": "host_phone", "name": "手机"}
out = serve.migrate_taxonomy([dict(new_item)])
assert out[0]["categoryId"] == "host" and out[0]["subCategoryId"] == "host_phone", \
    "新体系物品被误迁移: %r" % out[0]
assert out[0].get("taxonomy") == 2, "应盖章防再入"
ok(1)

# 2) 已盖章 + 撞名子类（mk_contour）原样保留
case(2, "已盖章物品（含撞名子类）原样保留")
stamped = {"id": "x2", "kind": "life", "categoryId": "makeup", "subCategoryId": "mk_contour", "taxonomy": 2}
out = serve.migrate_taxonomy([dict(stamped)])
assert out[0]["subCategoryId"] == "mk_contour", "撞名子类被改写: %r" % out[0]
ok(2)

# 3) 旧体系物品仍正常迁移
case(3, "旧体系物品迁移路径不受影响")
legacy = {"id": "x3", "kind": "device", "categoryId": "console", "subCategoryId": ""}
out = serve.migrate_taxonomy([dict(legacy)])
assert out[0]["categoryId"] not in ("", None) and out[0].get("taxonomy") == 2, "旧数据迁移失效: %r" % out[0]
ok(3)

# 4) 成本模型覆盖键带 kind 前缀：digital 配件 与 clothing 配饰（同 id 'acc'）互不覆盖
case(4, "成本模型覆盖键按 kind 隔离")
root = tempfile.mkdtemp()
serve.data_root = lambda: root
serve.migrate_old_layout = lambda r: [{"id": "me", "name": "Me", "icon": "x"}]
d = serve.acc_dir(root, "me")
os.makedirs(d, exist_ok=True)
with open(os.path.join(d, "settings.json"), "w", encoding="utf-8") as f:
    json.dump({
        "schemaVersion": 3,
        "settings": {"costModelOverrides": {"digital:acc": {"lifeYears": 8}, "clothing:acc": {"lifeYears": 2}}},
        "categories": {},
    }, f)
db = serve.load_db("me")
dig_acc = next(n for n in db["categories"]["digital"] if n["id"] == "acc")
clo_acc = next(n for n in db["categories"]["clothing"] if n["id"] == "acc")
assert dig_acc.get("lifeYears") == 8, "digital 配件寿命未按 kind 键套用: %r" % dig_acc
assert clo_acc.get("lifeYears") == 2, "clothing 配饰寿命未按 kind 键套用: %r" % clo_acc
ok(4)

# 5 美妆「工具」新增子类「发饰」（v1.1.5）：默认树含发饰且迁移集已收录
case(5, "美妆「工具」含「发饰」子类")
tool = next(n for n in serve.DEFAULT_CATEGORIES["life"] if n["id"] == "tool")
assert any(c["id"] == "tl_hairacc" and c["name"] == "发饰" for c in tool["children"]), \
    "工具类应含发饰子类: %r" % tool["children"]
assert "tl_hairacc" in serve.NEW_SUB_IDS, "发饰应进合法子类迁移集（防被误判旧数据改写）"
ok(5)

print("========== taxonomy-guard：5 项全部通过 ==========")
