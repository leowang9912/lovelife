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
    "device": [
        {"id": "console", "name": "主机", "lifeYears": 5, "residualRate": 0.10, "costModel": "daily_dep", "icon": "🎮"},
        {"id": "handheld", "name": "掌机/便携", "lifeYears": 3, "residualRate": 0.10, "costModel": "daily_dep", "icon": "🕹️"},
        {"id": "pc", "name": "电脑/平板", "lifeYears": 5, "residualRate": 0.10, "costModel": "daily_dep", "icon": "💻"},
        {"id": "display", "name": "显示器/外设", "lifeYears": 4, "residualRate": 0.10, "costModel": "daily_dep", "icon": "🖥️"},
        {"id": "phone", "name": "手机/穿戴", "lifeYears": 3, "residualRate": 0.15, "costModel": "daily_dep", "icon": "📱"},
        {"id": "accessory", "name": "配件", "lifeYears": 3, "residualRate": 0.05, "costModel": "daily_dep", "icon": "🔌", "attachable": True},
        {"id": "collectible", "name": "限定/周边收藏", "lifeYears": 8, "residualRate": 0.30, "costModel": "daily_hold", "icon": "🏆"},
    ],
    "game": [
        {"id": "physical", "name": "实体游戏（卡带/光盘）", "costModel": "per_title", "icon": "💿"},
        {"id": "digital", "name": "数字版游戏", "costModel": "per_title", "icon": "⬇️"},
        {"id": "dlc", "name": "DLC/季票", "costModel": "per_title", "icon": "🧩"},
        {"id": "game_acc", "name": "游戏周边", "costModel": "daily_hold", "lifeYears": 8, "residualRate": 0.30, "icon": "🧸", "attachable": True},
    ],
    "clothing": [
        {"id": "top", "name": "上衣", "icon": "👕"},
        {"id": "bottom", "name": "下装", "icon": "👖"},
        {"id": "outer", "name": "外套", "icon": "🧥"},
        {"id": "dress", "name": "连衣裙/套装", "icon": "👗"},
        {"id": "shoes", "name": "鞋", "icon": "👟"},
        {"id": "bag", "name": "包", "icon": "👜"},
        {"id": "acc", "name": "配饰", "icon": "🧣"},
        {"id": "other", "name": "其他", "icon": "📦"},
    ],
    "life": [
        {"id": "skin", "name": "护肤", "icon": "🧴", "children": [
            {"id": "skin_clean", "name": "洁面"}, {"id": "skin_toner", "name": "爽肤水"},
            {"id": "skin_serum", "name": "精华"}, {"id": "skin_lotion", "name": "乳液"},
            {"id": "skin_cream", "name": "面霜"}, {"id": "skin_eye", "name": "眼霜"},
            {"id": "skin_sun", "name": "防晒"}, {"id": "skin_mask", "name": "面膜"},
            {"id": "skin_exfol", "name": "去角质"},
        ]},
        {"id": "makeup", "name": "彩妆", "icon": "💄", "children": [
            {"id": "mk_base", "name": "底妆"}, {"id": "mk_conceal", "name": "遮瑕"},
            {"id": "mk_powder", "name": "散粉"}, {"id": "mk_brow", "name": "眉妆"},
            {"id": "mk_eye", "name": "眼妆"}, {"id": "mk_lip", "name": "唇妆"},
            {"id": "mk_blush", "name": "腮红"}, {"id": "mk_contour", "name": "修容高光"},
        ]},
        {"id": "fragrance", "name": "香氛", "icon": "🌸", "children": [
            {"id": "fg_perfume", "name": "香水"}, {"id": "fg_mist", "name": "身体喷雾"},
        ]},
        {"id": "hair", "name": "美发护发", "icon": "💇", "children": [
            {"id": "hr_shampoo", "name": "洗发"}, {"id": "hr_conditioner", "name": "护发"},
            {"id": "hr_oil", "name": "发油/造型"},
        ]},
        {"id": "body", "name": "身体护理", "icon": "🛁", "children": [
            {"id": "bd_bath", "name": "沐浴"}, {"id": "bd_lotion", "name": "身体乳"},
            {"id": "bd_hand", "name": "护手霜"},
        ]},
        {"id": "tool", "name": "工具", "icon": "🖌️", "children": [
            {"id": "tl_brush", "name": "刷具"}, {"id": "tl_sponge", "name": "美妆蛋"},
            {"id": "tl_other", "name": "其他工具"},
        ]},
        {"id": "sample", "name": "小样/旅行装", "icon": "🧳", "children": []},
        {"id": "daily", "name": "日用消耗", "icon": "🧻", "children": [
            {"id": "dl_paper", "name": "纸品"}, {"id": "dl_clean", "name": "清洁"},
            {"id": "dl_other", "name": "其他"},
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
    "occasion": ["通勤", "休闲", "运动", "正式", "居家", "约会", "旅行", "其他"],
    "season": ["春", "夏", "秋", "冬"],
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

    merged_settings = json.loads(json.dumps(DEFAULT_SETTINGS))
    merged_settings.update(settings.get("settings") or {})
    if "planSections" not in (settings.get("settings") or {}):
        merged_settings["planSections"] = DEFAULT_SETTINGS["planSections"]
    merged_cats = json.loads(json.dumps(DEFAULT_CATEGORIES))
    user_cats = settings.get("categories") or {}
    for key in merged_cats:
        if key in user_cats and user_cats[key]:
            merged_cats[key] = user_cats[key]
    # v3.1 美食分类迁移：旧 foodType 列表 → 新菜系+品类
    legacy_type = ["主食", "肉蛋", "蔬果", "汤粥", "甜品", "饮品", "零食", "其他"]
    if merged_cats.get("foodType") == legacy_type:
        merged_cats["foodType"] = DEFAULT_CATEGORIES["foodType"]
    if not merged_cats.get("foodCuisine"):
        merged_cats["foodCuisine"] = DEFAULT_CATEGORIES["foodCuisine"]

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
            return self._json(read_version_manifest())
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
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype)

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

    # ---------- 应用内更新 ----------
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


def check_update():
    local = read_version_manifest()
    local_ver = semver_tuple(local.get("version", "0"))
    remote = None
    used = ""
    errors = []
    for base in (local.get("updateManifest") or []):
        try:
            data = json.loads(fetch_url(base, timeout=12).decode("utf-8"))
            if isinstance(data, dict) and data.get("version"):
                remote = data
                used = base
                break
        except Exception as e:
            errors.append("%s: %s" % (base[:60], e))
    if not remote:
        return {"ok": False, "error": "无法连接更新源", "details": errors[:3]}
    remote_ver = semver_tuple(remote.get("version", "0"))
    return {
        "ok": True,
        "localVersion": local.get("version"),
        "remoteVersion": remote.get("version"),
        "hasUpdate": remote_ver > local_ver,
        "changelog": remote.get("changelog") or [],
        "assets": remote.get("assets") or {},
        "source": used,
    }


def apply_update(url):
    """下载 zip → 解压到 update-staging → 生成 updater.cmd 并执行"""
    staging = os.path.join(ROOT, "update-staging")
    if os.path.isdir(staging):
        shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(staging, exist_ok=True)

    # 镜像链：原始地址 + 常见加速前缀
    candidates = [url]
    for prefix in ("https://mirror.ghproxy.com/", "https://ghfast.top/", "https://gh-proxy.com/"):
        if url.startswith("https://github.com/") or url.startswith("https://objects.githubusercontent.com/"):
            candidates.append(prefix + url)

    data = None
    used = ""
    for u in candidates:
        try:
            data = fetch_url(u, timeout=300)
            used = u
            break
        except Exception:
            continue
    if not data:
        return {"ok": False, "error": "下载失败，请检查网络"}

    zpath = os.path.join(staging, "update.zip")
    with open(zpath, "wb") as f:
        f.write(data)
    with zipfile.ZipFile(zpath, "r") as z:
        z.extractall(staging)
    os.remove(zpath)

    # zip 内可能是 lovelife/ 根目录
    inner = os.path.join(staging, "lovelife")
    if os.path.isdir(inner):
        for name in os.listdir(inner):
            shutil.move(os.path.join(inner, name), os.path.join(staging, name))
        shutil.rmtree(inner, ignore_errors=True)

    # 校验关键文件
    if not os.path.isfile(os.path.join(staging, "app", "serve.py")):
        return {"ok": False, "error": "更新包格式不正确"}

    # 生成更新器（ASCII + CRLF，等待本进程退出后替换）
    bat_lines = [
        "@echo off",
        "setlocal",
        'cd /d "%~dp0"',
        "rem wait for server exit",
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
        'start "" cmd /c "ping -n 4 127.0.0.1 >nul & del /q \"%~f0\""',
    ]
    updater = os.path.join(ROOT, "updater.cmd")
    with open(updater, "w", encoding="ascii", newline="") as f:
        f.write("\r\n".join(bat_lines) + "\r\n")

    # 启动更新器后本进程退出
    subprocess.Popen(["cmd", "/c", updater], cwd=ROOT,
                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return {"ok": True, "message": "更新已开始", "source": used}


def main():
    if not port_free(PORT):
        return
    data_root()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
