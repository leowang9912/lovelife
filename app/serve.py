# -*- coding: utf-8 -*-
"""lovelife / 人生管家 — 本地数据服务 v3

数据布局（账号隔离 + 根目录可迁移）：
  <app-config.json>            全局配置：数据根目录 dataRoot
  <dataRoot>/accounts.json     账号列表
  <dataRoot>/<accountId>/      各账号独立数据
      items.json outfits.json food.json events.json settings.json
      images/
"""
import json
import os
import re
import sys
import socket
import tarfile
import zipfile
import io
import time
import shutil
import subprocess
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

if getattr(sys, "frozen", False):
    ROOT = os.path.dirname(os.path.abspath(sys.executable))
else:
    ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

APP_DIR = os.path.join(ROOT, "app")
CONFIG_FILE = os.path.join(ROOT, "app-config.json")
SCHEMA_VERSION = 3
PORT = 8765
# 服务端构建版本（release.py 发版时与 version.json 同步）。
# 与 version.json 不一致 = 更新只换了 exe 没换 version.json（反之亦然），
# 设置页据此提示"更新未完整落地"。
SERVER_BUILD = "1.0.4"

_lock = threading.Lock()


# ---------------- 全局配置（数据根目录） ----------------
def read_app_config():
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"dataRoot": os.path.join(ROOT, "data"), "lastAccountId": ""}


def write_app_config(cfg):
    tmp = CONFIG_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CONFIG_FILE)


def data_root():
    cfg = read_app_config()
    root = cfg.get("dataRoot") or os.path.join(ROOT, "data")
    os.makedirs(root, exist_ok=True)
    return root


DEFAULT_CATEGORIES = {
    # ===== 数码（含游戏）：L1 大类 × L2 子类 =====
    "digital": [
        {"id": "host", "name": "主机类", "icon": "💻", "lifeYears": 5, "residualRate": 0.10, "costModel": "daily_dep", "children": [
            {"id": "host_phone", "name": "手机"}, {"id": "host_tablet", "name": "平板"},
            {"id": "host_laptop", "name": "笔记本"}, {"id": "host_desktop", "name": "台式机"},
            {"id": "host_switch", "name": "Switch"}, {"id": "host_handheld", "name": "掌机"},
            {"id": "host_other", "name": "其他主机"},
        ]},
        {"id": "camera", "name": "影像类", "icon": "📷", "lifeYears": 6, "residualRate": 0.15, "costModel": "daily_dep", "children": [
            {"id": "cam_body", "name": "相机"}, {"id": "cam_lens", "name": "镜头"},
            {"id": "cam_flash", "name": "闪光灯"}, {"id": "cam_stab", "name": "稳定器"},
        ]},
        {"id": "audio", "name": "音频类", "icon": "🎧", "lifeYears": 4, "residualRate": 0.10, "costModel": "daily_dep", "children": [
            {"id": "aud_headphone", "name": "耳机"}, {"id": "aud_speaker", "name": "音箱"},
            {"id": "aud_player", "name": "播放器"}, {"id": "aud_mic", "name": "麦克风"},
        ]},
        {"id": "display", "name": "显示外设", "icon": "🖥️", "lifeYears": 5, "residualRate": 0.10, "costModel": "daily_dep", "children": [
            {"id": "dsp_monitor", "name": "显示器"}, {"id": "dsp_projector", "name": "投影"},
        ]},
        {"id": "storage", "name": "存储", "icon": "💾", "lifeYears": 5, "residualRate": 0.10, "costModel": "daily_dep", "children": [
            {"id": "sto_ssd", "name": "固态"}, {"id": "sto_hdd", "name": "移动硬盘"},
            {"id": "sto_usb", "name": "U盘"}, {"id": "sto_card", "name": "存储卡"},
        ]},
        {"id": "acc", "name": "配件", "icon": "🔌", "lifeYears": 3, "residualRate": 0.05, "costModel": "daily_dep", "attachable": True, "children": [
            {"id": "ac_charger", "name": "充电器"}, {"id": "ac_cable", "name": "线材"},
            {"id": "ac_hub", "name": "拓展坞"}, {"id": "ac_kbmouse", "name": "键鼠"},
            {"id": "ac_case", "name": "保护壳"}, {"id": "ac_battery", "name": "电池"},
        ]},
        {"id": "gadget", "name": "其他数码", "icon": "⌚", "lifeYears": 4, "residualRate": 0.10, "costModel": "daily_dep", "children": [
            {"id": "gd_watch", "name": "手表"}, {"id": "gd_band", "name": "手环"},
            {"id": "gd_drone", "name": "无人机"}, {"id": "gd_reader", "name": "阅读器"},
            {"id": "gd_other", "name": "其他"},
        ]},
        {"id": "game", "name": "游戏", "icon": "🎮", "costModel": "per_title", "children": [
            {"id": "gm_cartridge", "name": "卡带"}, {"id": "gm_disc", "name": "光盘"},
            {"id": "gm_digital", "name": "数字版"}, {"id": "gm_dlc", "name": "DLC/季票"},
            {"id": "gm_acc", "name": "游戏周边"},
        ]},
    ],
    # ===== 服饰 =====
    "clothing": [
        {"id": "top", "name": "上装", "icon": "👕", "children": [
            {"id": "top_tee", "name": "T恤"}, {"id": "top_shirt", "name": "衬衫"},
            {"id": "top_hoodie", "name": "卫衣"}, {"id": "top_sweater", "name": "毛衣"},
            {"id": "top_coat", "name": "外套"}, {"id": "top_suit", "name": "西装"},
            {"id": "top_jacket", "name": "冲锋衣"}, {"id": "top_other", "name": "其他上装"},
        ]},
        {"id": "bottom", "name": "下装", "icon": "👖", "children": [
            {"id": "bt_pants", "name": "裤子"}, {"id": "bt_skirt", "name": "半裙"},
            {"id": "bt_dress", "name": "长裙"}, {"id": "bt_other", "name": "其他下装"},
        ]},
        {"id": "under", "name": "内衣家居", "icon": "🩱", "children": [
            {"id": "un_underwear", "name": "内衣"}, {"id": "un_socks", "name": "袜子"},
            {"id": "un_home", "name": "家居服"},
        ]},
        {"id": "shoes", "name": "鞋靴", "icon": "👟", "children": [
            {"id": "sh_sneaker", "name": "运动鞋"}, {"id": "sh_leather", "name": "皮鞋"},
            {"id": "sh_boot", "name": "靴子"}, {"id": "sh_slipper", "name": "拖鞋"},
        ]},
        {"id": "acc", "name": "配饰", "icon": "👜", "children": [
            {"id": "ac_hat", "name": "帽子"}, {"id": "ac_scarf", "name": "围巾"},
            {"id": "ac_belt", "name": "腰带"}, {"id": "ac_bag", "name": "包包"},
            {"id": "ac_sunglass", "name": "墨镜"},
        ]},
        {"id": "formal", "name": "正装/礼服", "icon": "👔", "children": [
            {"id": "fm_suit", "name": "正装"}, {"id": "fm_dress", "name": "礼服"},
        ]},
        {"id": "sport", "name": "运动服饰", "icon": "🏃", "children": [
            {"id": "sp_top", "name": "运动上装"}, {"id": "sp_bottom", "name": "运动下装"},
            {"id": "sp_other", "name": "运动其他"},
        ]},
    ],
    # ===== 美妆生活 =====
    "life": [
        {"id": "skin", "name": "护肤", "icon": "🧴", "children": [
            {"id": "sk_toner", "name": "水"}, {"id": "sk_lotion", "name": "乳"},
            {"id": "sk_serum", "name": "精华"}, {"id": "sk_cream", "name": "面霜"},
            {"id": "sk_mask", "name": "面膜"}, {"id": "sk_sun", "name": "防晒"},
            {"id": "sk_clean", "name": "洁面"}, {"id": "sk_other", "name": "其他"},
        ]},
        {"id": "makeup", "name": "彩妆", "icon": "💄", "children": [
            {"id": "mk_foundation", "name": "粉底"}, {"id": "mk_eyeshadow", "name": "眼影"},
            {"id": "mk_lip", "name": "口红"}, {"id": "mk_blush", "name": "腮红"},
            {"id": "mk_brow", "name": "眉笔"}, {"id": "mk_powder", "name": "散粉"},
            {"id": "mk_other", "name": "其他"},
        ]},
        {"id": "tool", "name": "工具", "icon": "🖌️", "children": [
            {"id": "tl_brush", "name": "化妆刷"}, {"id": "tl_puff", "name": "粉扑"},
            {"id": "tl_sponge", "name": "美妆蛋"}, {"id": "tl_curler", "name": "睫毛夹"},
            {"id": "tl_other", "name": "其他"},
        ]},
        {"id": "fragrance", "name": "香氛", "icon": "🌸", "children": [
            {"id": "fg_perfume", "name": "香水"}, {"id": "fg_candle", "name": "香薰"},
            {"id": "fg_other", "name": "其他"},
        ]},
        {"id": "body", "name": "身体护理", "icon": "🛁", "children": [
            {"id": "bd_lotion", "name": "身体乳"}, {"id": "bd_bath", "name": "沐浴"},
            {"id": "bd_hand", "name": "护手霜"}, {"id": "bd_other", "name": "其他"},
        ]},
    ],
    "foodCuisine": [
        "中餐", "川菜", "粤菜", "湘菜", "鲁菜", "东北菜", "西北面食",
        "日料", "韩餐", "东南亚菜", "西餐", "快餐简餐", "火锅",
        "烧烤", "烘焙甜品", "咖啡饮品", "水果生鲜", "小吃饭", "其他"
    ],
    "foodType": ["主食", "肉菜", "素菜", "汤粥", "甜品", "小吃", "饮品", "水果", "其他"],
    "meal": ["早餐", "午餐", "晚餐", "加餐", "夜宵"],
    "foodTag": ["自制", "外卖", "餐厅", "聚餐", "零食"],
    "occasion": ["日常", "通勤", "运动", "正式", "居家", "约会", "旅行", "其他"],
    "season": ["春", "夏", "秋", "冬", "四季"],
    "tagPresets": ["送人", "待清洗", "待维修", "限量款", "贵重", "断舍离候选", "心头好", "换季收纳", "待出闲置", "备用"],
    "condition": ["全新", "几乎全新", "9成新", "8成新", "有痕迹", "战损"],
    "remainLevel": ["满", "¾", "½", "¼", "空"],
    "sizeSystem": ["中国码", "美国码", "欧码", "均码", "其他"],
    "skinType": ["干皮", "油皮", "混干", "混油", "敏皮", "通用"],
    "usageFreq": ["天天用", "每周几次", "偶尔用", "低频"],
    "washMethod": ["干洗", "手洗", "机洗", "不可水洗", "其他"],
}

DEFAULT_SETTINGS = {
    "idleWarnDays": 60,
    "currency": "¥",
    "theme": "light",
    "rememberAccount": False,
    "requiredFields": {
        "name": True, "category": True, "purchaseDate": True, "purchasePrice": True,
    },
    "budget": {"monthlyTotal": 0, "categories": {"clothing": 0, "life": 0, "food": 0, "digital": 0}},
    "planSections": [
        {"id": "kpi", "enabled": True, "fixed": True},
        {"id": "composition", "enabled": True, "fixed": True},
        {"id": "monthly", "enabled": True},
        {"id": "budget", "enabled": True},
        {"id": "expiry", "enabled": True},
        {"id": "idle", "enabled": True},
        {"id": "cpw", "enabled": True},
        {"id": "game", "enabled": True},
        {"id": "empty", "enabled": True},
        {"id": "valueTrend", "enabled": True},
        {"id": "foodStats", "enabled": True},
        {"id": "resale", "enabled": False},
        {"id": "seasonOccasion", "enabled": False},
        {"id": "wearTrend", "enabled": False},
        {"id": "deviceRank", "enabled": False},
    ],
    "makeupLooks": [],
}

# ---------------- 账号 ----------------
def read_accounts(root):
    path = os.path.join(root, "accounts.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else data.get("accounts", [])
    except (OSError, ValueError):
        return []


def write_accounts(root, accounts):
    path = os.path.join(root, "accounts.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(accounts, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def acc_dir(root, acc_id):
    d = os.path.join(root, acc_id)
    os.makedirs(os.path.join(d, "images"), exist_ok=True)
    return d


def migrate_old_layout(root):
    """v2 平铺数据 → v3 账号子目录（迁入默认账号「我」）"""
    legacy = ["items.json", "outfits.json", "events.json", "settings.json"]
    has_legacy = any(os.path.isfile(os.path.join(root, n)) for n in legacy)
    accounts = read_accounts(root)
    if not accounts:
        default = {"id": "me", "name": "我", "icon": "😊", "createdAt": int(time.time())}
        accounts = [default]
        write_accounts(root, accounts)
        acc_dir(root, "me")
    if has_legacy:
        dest = acc_dir(root, accounts[0]["id"])
        for name in legacy:
            src = os.path.join(root, name)
            if os.path.isfile(src):
                shutil.move(src, os.path.join(dest, name))
        old_img = os.path.join(root, "images")
        new_img = os.path.join(dest, "images")
        if os.path.isdir(old_img):
            for fn in os.listdir(old_img):
                s = os.path.join(old_img, fn)
                d = os.path.join(new_img, fn)
                if os.path.isfile(s) and not os.path.exists(d):
                    shutil.move(s, d)
            try:
                os.rmdir(old_img)
            except OSError:
                pass
    return accounts


def ensure_default_data(d):
    os.makedirs(os.path.join(d, "images"), exist_ok=True)


def _read_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read().strip()
            return json.loads(raw) if raw else fallback
    except (OSError, ValueError):
        return fallback


def _write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


# 旧分类 → 新分类树（自动迁移；映射不到的归入对应大类其他并标记待整理）
CATEGORY_MAP = {
    # 旧 device
    "console": ("device", "host", ""), "handheld": ("device", "host", "host_handheld"),
    "pc": ("device", "host", "host_laptop"), "display": ("device", "display", "dsp_monitor"),
    "phone": ("device", "host", "host_phone"), "accessory": ("device", "acc", ""),
    "collectible": ("device", "gadget", "gd_other"),
    # 旧 game
    "physical": ("game", "game", "gm_cartridge"), "digital": ("game", "game", "gm_digital"),
    "dlc": ("game", "game", "gm_dlc"), "game_acc": ("game", "game", "gm_acc"),
    # 旧 clothing
    "top": ("clothing", "top", ""), "outer": ("clothing", "top", "top_coat"),
    "bottom": ("clothing", "bottom", ""), "dress": ("clothing", "formal", "fm_dress"),
    "shoes": ("clothing", "shoes", ""), "bag": ("clothing", "acc", "ac_bag"),
    "acc": ("clothing", "acc", ""),
    # 旧 life
    "skin": ("life", "skin", ""), "skin_clean": ("life", "skin", "sk_clean"),
    "skin_toner": ("life", "skin", "sk_toner"), "skin_serum": ("life", "skin", "sk_serum"),
    "skin_lotion": ("life", "skin", "sk_lotion"), "skin_cream": ("life", "skin", "sk_cream"),
    "skin_eye": ("life", "skin", "sk_cream"), "skin_sun": ("life", "skin", "sk_sun"),
    "skin_mask": ("life", "skin", "sk_mask"), "skin_exfol": ("life", "skin", "sk_other"),
    "makeup": ("life", "makeup", ""), "mk_base": ("life", "makeup", "mk_foundation"),
    "mk_conceal": ("life", "makeup", "mk_foundation"), "mk_powder": ("life", "makeup", "mk_powder"),
    "mk_brow": ("life", "makeup", "mk_brow"), "mk_eye": ("life", "makeup", "mk_eyeshadow"),
    "mk_lip": ("life", "makeup", "mk_lip"), "mk_blush": ("life", "makeup", "mk_blush"),
    "mk_contour": ("life", "makeup", "mk_other"),
    "fragrance": ("life", "fragrance", ""), "fg_perfume": ("life", "fragrance", "fg_perfume"),
    "fg_mist": ("life", "fragrance", "fg_other"),
    "tool": ("life", "tool", ""), "tl_brush": ("life", "tool", "tl_brush"),
    "tl_sponge": ("life", "tool", "tl_sponge"), "tl_other": ("life", "tool", "tl_other"),
    "body": ("life", "body", ""), "bd_lotion": ("life", "body", "bd_lotion"),
    "bd_bath": ("life", "body", "bd_bath"), "bd_hand": ("life", "body", "bd_hand"),
    "hair": ("life", "body", "bd_other"), "hr_shampoo": ("life", "body", "bd_other"),
    "hr_conditioner": ("life", "body", "bd_other"), "hr_oil": ("life", "body", "bd_other"),
    "sample": ("life", "makeup", "mk_other"), "daily": ("life", "body", "bd_other"),
    "dl_paper": ("life", "body", "bd_other"), "dl_clean": ("life", "body", "bd_other"),
    "dl_other": ("life", "body", "bd_other"),
}
# 新分类树的兜底「其他」
FALLBACK = {"device": ("gadget", "gd_other"), "game": ("game", "gm_acc"),
            "clothing": ("top", "top_other"), "life": ("body", "bd_other")}


def migrate_taxonomy(items):
    """旧 categoryId/subCategoryId → 新分类树；映射不到的标记 needsReview"""
    for it in items:
        old_sub = it.get("subCategoryId") or ""
        if it.get("taxonomy") == 2 and old_sub not in CATEGORY_MAP:
            continue
        old = it.get("categoryId") or ""
        mapped = CATEGORY_MAP.get(old)
        if mapped:
            kind, l1, l2 = mapped
            it["kind"] = kind
            it["categoryId"] = l1
            if l2:
                it["subCategoryId"] = l2
            it.pop("needsReview", None)
        else:
            fb = FALLBACK.get(it.get("kind") or "device", ("gadget", "gd_other"))
            it["categoryId"] = fb[0]
            it["subCategoryId"] = fb[1]
            it["needsReview"] = True
        # 子分类旧 ID 也要重映射（如 skin_exfol → sk_other）
        sub = it.get("subCategoryId") or ""
        if sub in CATEGORY_MAP:
            mapped_sub = CATEGORY_MAP[sub]
            it["subCategoryId"] = mapped_sub[2] or None
        # 旧状态映射到新枚举
        st = it.get("status")
        if st == "collected":
            it["status"] = "in_use"
        elif st == "dropped":
            it["status"] = "broken"
        elif st == "empty":
            it["status"] = "idle"
            it.setdefault("remainLevel", "空")
        it["taxonomy"] = 2
    return items


def load_db(acc_id):
    root = data_root()
    accounts = migrate_old_layout(root)
    if not acc_id:
        cfg = read_app_config()
        acc_id = cfg.get("lastAccountId") or accounts[0]["id"]
    acc = next((a for a in accounts if a["id"] == acc_id), accounts[0])
    d = acc_dir(root, acc["id"])
    ensure_default_data(d)

    items = _read_json(os.path.join(d, "items.json"), {"schemaVersion": SCHEMA_VERSION, "items": []})
    outfits = _read_json(os.path.join(d, "outfits.json"), {"schemaVersion": SCHEMA_VERSION, "outfits": []})
    food = _read_json(os.path.join(d, "food.json"), {"schemaVersion": SCHEMA_VERSION, "records": []})
    events = _read_json(os.path.join(d, "events.json"), {"schemaVersion": SCHEMA_VERSION, "events": []})
    settings = _read_json(os.path.join(d, "settings.json"), {})
    items["items"] = migrate_taxonomy(items.get("items", []))

    merged_settings = json.loads(json.dumps(DEFAULT_SETTINGS))
    merged_settings.update(settings.get("settings") or {})
    if "planSections" not in (settings.get("settings") or {}):
        merged_settings["planSections"] = DEFAULT_SETTINGS["planSections"]
    merged_cats = json.loads(json.dumps(DEFAULT_CATEGORIES))
    user_cats = settings.get("categories") or {}
    # 物品分类树以服务端为准（v1.0.1 新分类）；用户可改的是枚举/标签/美食分类
    user_editable = ("foodCuisine", "foodType", "meal", "foodTag", "occasion", "season",
                     "tagPresets", "condition", "remainLevel", "sizeSystem", "skinType",
                     "usageFreq", "washMethod")
    for key in user_editable:
        if key in user_cats and user_cats[key]:
            merged_cats[key] = user_cats[key]

    return {
        "schemaVersion": SCHEMA_VERSION,
        "account": acc,
        "accounts": accounts,
        "items": items.get("items", []),
        "outfits": outfits.get("outfits", []),
        "food": food.get("records", []),
        "events": events.get("events", []),
        "settings": merged_settings,
        "categories": merged_cats,
        "dataRoot": root,
    }


# ---------------- HTTP ----------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False))

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def _acc(self, parsed):
        return urllib.parse.parse_qs(parsed.query).get("acc", [""])[0]

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/ping":
            return self._json({"ok": True, "schemaVersion": SCHEMA_VERSION, "root": ROOT})
        if path == "/api/session":
            root = data_root()
            accounts = migrate_old_layout(root)
            cfg = read_app_config()
            return self._json({"ok": True, "accounts": accounts,
                               "lastAccountId": cfg.get("lastAccountId", ""),
                               "dataRoot": root, "schemaVersion": SCHEMA_VERSION})
        if path == "/api/db":
            with _lock:
                return self._json(load_db(self._acc(parsed)))
        if path == "/api/backup":
            return self._send_backup(self._acc(parsed))
        if path == "/api/version":
            manifest = read_version_manifest()
            manifest["serverBuild"] = SERVER_BUILD
            return self._json(manifest)
        if path == "/api/update/check":
            result = check_update()
            result["checkedAt"] = int(time.time())
            return self._json(result)
        if path == "/api/update/status":
            return self._handle_update_status()
        if path.startswith("/api/images/"):
            rest = path[len("/api/images/"):]
            return self._send_image(rest)
        return self._send_static(path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        try:
            if path == "/api/save":
                return self._handle_save()
            if path == "/api/upload":
                return self._handle_upload(self._acc(parsed))
            if path == "/api/restore":
                return self._handle_restore(self._acc(parsed))
            if path == "/api/account":
                return self._handle_account()
            if path == "/api/data-root":
                return self._handle_data_root()
            if path == "/api/update/check":
                return self._handle_update_check()
            if path == "/api/update/apply":
                return self._handle_update_apply()
        except Exception as e:
            return self._json({"error": str(e)}, 500)
        return self._json({"error": "not found"}, 404)

    # ---------- 静态 ----------
    def _send_static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        rel = urllib.parse.unquote(path).lstrip("/")
        full = os.path.normpath(os.path.join(APP_DIR, rel))
        if not full.startswith(os.path.normpath(APP_DIR)):
            return self._json({"error": "forbidden"}, 403)
        if not os.path.isfile(full):
            return self._json({"error": "not found"}, 404)
        ctype = {
            ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
            ".ico": "image/x-icon", ".onnx": "application/octet-stream",
            ".wasm": "application/wasm", ".json": "application/json",
        }.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
        extra = {}
        if full.lower().endswith(".html"):
            # 防止更新后浏览器沿用旧版 JS/CSS 缓存（"半更新"假象的另一个来源）
            extra["Clear-Site-Data"] = '"cache"'
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype, extra)

    # ---------- 数据 ----------
    def _handle_save(self):
        payload = json.loads(self._read_body().decode("utf-8"))
        acc_id = payload.get("acc") or read_app_config().get("lastAccountId") or "me"
        target = payload.get("target")
        data = payload.get("data")
        root = data_root()
        accounts = migrate_old_layout(root)
        if not any(a["id"] == acc_id for a in accounts):
            acc_id = accounts[0]["id"]
        d = acc_dir(root, acc_id)
        with _lock:
            if target == "items":
                _write_json(os.path.join(d, "items.json"), {"schemaVersion": SCHEMA_VERSION, "items": data})
            elif target == "outfits":
                _write_json(os.path.join(d, "outfits.json"), {"schemaVersion": SCHEMA_VERSION, "outfits": data})
            elif target == "food":
                _write_json(os.path.join(d, "food.json"), {"schemaVersion": SCHEMA_VERSION, "records": data})
            elif target == "events":
                _write_json(os.path.join(d, "events.json"), {"schemaVersion": SCHEMA_VERSION, "events": data})
            elif target == "settings":
                _write_json(os.path.join(d, "settings.json"), {"schemaVersion": SCHEMA_VERSION, **data})
            else:
                return self._json({"error": "bad target"}, 400)
        return self._json({"ok": True})

    def _handle_upload(self, acc_id):
        acc_id = acc_id or read_app_config().get("lastAccountId") or "me"
        root = data_root()
        accounts = migrate_old_layout(root)
        if not any(a["id"] == acc_id for a in accounts):
            acc_id = accounts[0]["id"]
        d = acc_dir(root, acc_id)
        ctype = self.headers.get("Content-Type", "")
        m = re.search(r'boundary="?([^";]+)"?', ctype)
        if not m:
            return self._json({"error": "no boundary"}, 400)
        boundary = m.group(1).encode()
        body = self._read_body()
        for part in body.split(b"--" + boundary):
            if b"Content-Disposition" not in part:
                continue
            header_blob, _, content = part.partition(b"\r\n\r\n")
            if b'name="file"' not in header_blob:
                continue
            content = content.rstrip(b"\r\n")
            if content.endswith(b"--"):
                content = content[:-2].rstrip(b"\r\n")
            ext = ".png" if b"image/png" in header_blob else ".webp"
            fm = re.search(r'filename="([^"]*)"', header_blob.decode("utf-8", "ignore"))
            if fm and "." in fm.group(1):
                ext = os.path.splitext(fm.group(1))[1].lower() or ext
            name = "img-%d-%04x%s" % (int(time.time() * 1000), os.getpid() & 0xFFFF, ext)
            with open(os.path.join(d, "images", name), "wb") as f:
                f.write(content)
            return self._json({"ok": True, "path": "images/" + name})
        return self._json({"error": "no file part"}, 400)

    def _send_image(self, rest):
        parts = urllib.parse.unquote(rest).split("/", 1)
        if len(parts) == 2:
            acc_id, name = parts
        else:
            acc_id, name = read_app_config().get("lastAccountId") or "me", parts[0]
        name = os.path.basename(name)
        root = data_root()
        accounts = migrate_old_layout(root)
        if not any(a["id"] == acc_id for a in accounts):
            acc_id = accounts[0]["id"]
        full = os.path.join(acc_dir(root, acc_id), "images", name)
        if not os.path.isfile(full):
            return self._json({"error": "not found"}, 404)
        ctype = ("image/png" if name.endswith(".png") else
                 "image/jpeg" if name.lower().endswith((".jpg", ".jpeg")) else "image/webp")
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype)

    # ---------- 账号 ----------
    def _handle_account(self):
        payload = json.loads(self._read_body().decode("utf-8"))
        action = payload.get("action")
        root = data_root()
        accounts = migrate_old_layout(root)
        if action == "create":
            name = (payload.get("name") or "").strip()
            if not name:
                return self._json({"error": "name required"}, 400)
            acc = {"id": "acc-" + str(int(time.time() * 1000)), "name": name,
                   "icon": payload.get("icon") or "😊", "createdAt": int(time.time())}
            accounts.append(acc)
            write_accounts(root, accounts)
            acc_dir(root, acc["id"])
            return self._json({"ok": True, "account": acc, "accounts": accounts})
        if action == "rename":
            for a in accounts:
                if a["id"] == payload.get("id"):
                    a["name"] = payload.get("name") or a["name"]
                    a["icon"] = payload.get("icon") or a["icon"]
            write_accounts(root, accounts)
            return self._json({"ok": True, "accounts": accounts})
        if action == "delete":
            target = payload.get("id")
            if len(accounts) <= 1:
                return self._json({"error": "至少保留一个账号"}, 400)
            accounts = [a for a in accounts if a["id"] != target]
            write_accounts(root, accounts)
            if payload.get("purge"):
                d = os.path.join(root, target)
                if os.path.isdir(d):
                    shutil.rmtree(d, ignore_errors=True)
            return self._json({"ok": True, "accounts": accounts})
        if action == "select":
            cfg = read_app_config()
            cfg["lastAccountId"] = payload.get("id") or ""
            write_app_config(cfg)
            return self._json({"ok": True})
        return self._json({"error": "bad action"}, 400)

    # ---------- 数据根目录 ----------
    def _handle_data_root(self):
        payload = json.loads(self._read_body().decode("utf-8"))
        new_root = payload.get("path") or ""
        if not new_root:
            return self._json({"error": "path required"}, 400)
        new_root = os.path.abspath(new_root)
        cfg = read_app_config()
        old_root = data_root()
        os.makedirs(new_root, exist_ok=True)
        if os.path.abspath(old_root) != new_root and payload.get("move"):
            for fn in os.listdir(old_root):
                s = os.path.join(old_root, fn)
                d = os.path.join(new_root, fn)
                if os.path.isdir(s):
                    shutil.copytree(s, d, dirs_exist_ok=True)
                else:
                    shutil.copy2(s, d)
        cfg["dataRoot"] = new_root
        write_app_config(cfg)
        return self._json({"ok": True, "dataRoot": new_root})

    # ---------- 应用内更新（异步下载 + 进度状态机） ----------
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

    # ---------- 备份 ----------
    def _send_backup(self, acc_id):
        root = data_root()
        accounts = migrate_old_layout(root)
        if not acc_id:
            acc_id = read_app_config().get("lastAccountId") or accounts[0]["id"]
        if not any(a["id"] == acc_id for a in accounts):
            acc_id = accounts[0]["id"]
        d = acc_dir(root, acc_id)
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for dirpath, _, filenames in os.walk(d):
                for fn in filenames:
                    full = os.path.join(dirpath, fn)
                    arc = os.path.relpath(full, root).replace("\\", "/")
                    tar.add(full, arcname=arc)
        fname = "lovelife-backup-%s-%s.tar.gz" % (acc_id, time.strftime("%Y%m%d"))
        self._send(200, buf.getvalue(), "application/gzip",
                   {"Content-Disposition": 'attachment; filename="%s"' % fname})

    def _handle_restore(self, acc_id):
        root = data_root()
        accounts = migrate_old_layout(root)
        if not acc_id:
            acc_id = accounts[0]["id"]
        d = acc_dir(root, acc_id)
        body = self._read_body()
        with tarfile.open(fileobj=io.BytesIO(body), mode="r:gz") as tar:
            for member in tar.getmembers():
                if not member.isfile():
                    continue
                name = member.name.replace("\\", "/")
                rel = name.split("/", 1)[1] if "/" in name else name
                rel = rel.split("/", 1)[1] if rel.startswith(acc_id + "/") else rel
                if rel.startswith("..") or rel.startswith("/"):
                    continue
                dest = os.path.normpath(os.path.join(d, rel))
                if not dest.startswith(os.path.normpath(d)):
                    continue
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                src = tar.extractfile(member)
                if src is None:
                    continue
                with open(dest, "wb") as f:
                    f.write(src.read())
        return self._json({"ok": True})


def port_free(p):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.connect(("127.0.0.1", p))
        return False
    except OSError:
        return True
    finally:
        s.close()


# ---------------- 版本与应用内更新 ----------------
def read_version_manifest():
    path = os.path.join(ROOT, "version.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"version": "0.0.0", "minSchema": SCHEMA_VERSION, "changelog": []}


def semver_tuple(v):
    try:
        return tuple(int(x) for x in str(v).lstrip("v").split(".")[:3])
    except ValueError:
        return (0, 0, 0)


def fetch_url(url, timeout=20):
    """urllib 下载（供更新检查/下载使用）"""
    req = urllib.request.Request(url, headers={"User-Agent": "lovelife-updater/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


# 国内可用性较好的镜像前缀（会与 version.json 中的源合并去重）
GH_RAW_PREFIXES = [
    "https://ghfast.top/https://raw.githubusercontent.com/",
    "https://cdn.jsdmirror.com/gh/",
    "https://gh-proxy.com/https://raw.githubusercontent.com/",
    "https://mirror.ghproxy.com/https://raw.githubusercontent.com/",
    "https://raw.githubusercontent.com/",
]


def build_manifest_urls(local):
    """合并 version.json 的 updateManifest + 根据 repo 生成的镜像链"""
    urls = list(local.get("updateManifest") or [])
    repo = local.get("repo") or ""
    if repo and "/" in repo:
        owner, name = repo.split("/", 1)
        raw_path = "%s/%s/main/version.json" % (owner, name)
        for p in GH_RAW_PREFIXES:
            if p.endswith("/gh/"):
                urls.append(p + owner + "/" + name + "@main/version.json")
            else:
                urls.append(p + raw_path)
    # 去重 + 可靠源优先（jsdmirror/ghfast 实测国内可达率高）
    seen, out = set(), []
    def score(u):
        return 0 if ("jsdmirror" in u or "ghfast" in u or "jsdelivr" in u) else 1
    for u in sorted(urls, key=score):
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _manifest_fetch(base):
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
        r'if exist "update-staging\app" robocopy "update-staging\app" "app" /E /PURGE >nul',
        r'if exist "update-staging\lovelife-server.exe" copy /y "update-staging\lovelife-server.exe" "lovelife-server.exe" >nul',
        r'if exist "update-staging\lovelife.bat" copy /y "update-staging\lovelife.bat" "lovelife.bat" >nul',
        r'if exist "update-staging\version.json" copy /y "update-staging\version.json" "version.json" >nul',
        r'if exist "update-staging\README.md" copy /y "update-staging\README.md" "README.md" >nul',
        r'if exist "update-staging\CHANGELOG.md" copy /y "update-staging\CHANGELOG.md" "CHANGELOG.md" >nul',
        r'if exist "update-staging\LICENSE" copy /y "update-staging\LICENSE" "LICENSE" >nul',
        'rmdir /s /q "update-staging" >nul 2>&1',
        'start "" "%~dp0lovelife-server.exe"',
        'start "" cmd /c "ping -n 4 127.0.0.1 >nul & del /q \"%~f0\""',
    ]
    updater = os.path.join(ROOT, "updater.cmd")
    with open(updater, "w", encoding="ascii", newline="") as f:
        f.write("\r\n".join(bat_lines) + "\r\n")
    subprocess.Popen(["cmd", "/c", updater], cwd=ROOT,
                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return True


def main():
    if not port_free(PORT):
        return
    data_root()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
