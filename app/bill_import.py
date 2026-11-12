# -*- coding: utf-8 -*-
"""账单导入解析：多格式探测 + 解析 + 去重计划 + 分类归类

serve.py 调用链：parse_any（decode_bytes → detect_format → parse_bills）→ build_import_plan。
纯解析模块，不碰磁盘/网络，便于单测。
"""
import csv
import io
import json
import math
import re
from datetime import datetime, date

SUPPORTED_FORMATS = ("alipay_csv", "wechat_csv", "generic_csv", "app_json", "pasted_text", "unknown")

# 微信「当前状态」成功态（导出里还有红包/零钱通等变体，放行常见几种）
_WECHAT_OK_STATUS = {
    "支付成功", "已收钱", "已转账", "交易成功", "已收红包", "充值成功", "已存入零钱",
}

# 通用表头关键词 → 内部角色；按关键词长度降序匹配，避免「二级分类」被「分类」截胡
# 「时间」是独立 time 列（导出往返用，落到 b.time）；「交易时间」等组合日期列仍归 date
_HEADER_KEYWORDS = [
    ("date", "交易时间"), ("date", "交易日期"), ("date", "记账日期"), ("date", "日期"),
    ("time", "时间"),
    ("type", "收支类型"), ("type", "收/支"), ("type", "收支"), ("type", "类型"),
    ("subcat", "二级分类"), ("subcat", "子分类"), ("subcat", "subcategory"),
    ("cat", "一级分类"), ("cat", "分类"), ("cat", "类别"), ("cat", "category"),
    ("amount", "金额"), ("amount", "money"), ("amount", "price"),
    ("account", "支付方式"), ("account", "账户"), ("account", "account"),
    ("toaccount", "转入账户"), ("toaccount", "对方账户"), ("toaccount", "toaccount"),
    ("note", "备注"), ("note", "说明"), ("note", "摘要"), ("note", "remark"), ("note", "note"),
    ("tagsname", "标签名称"), ("tagsname", "tagnames"),
    ("tags", "标签"), ("tags", "tag"),
    ("itemid", "关联词条id"), ("itemid", "itemid"), ("itemid", "词条id"),
    ("foodid", "关联美食id"), ("foodid", "foodid"), ("foodid", "美食id"),
    ("date", "date"), ("type", "type"),
]
_HEADER_KEYWORDS.sort(key=lambda x: len(x[1]), reverse=True)

# 类型取值兼容：中文/英文/正负号/常见数字约定（1=支出 2=收入 3=转账）
_TYPE_EXACT = {
    "支出": "expense", "收入": "income", "转账": "transfer",
    "expense": "expense", "income": "income", "transfer": "transfer",
    "支": "expense", "收": "income", "转": "transfer",
    "-": "expense", "+": "income", "－": "expense", "＋": "income",
    "1": "expense", "2": "income", "3": "transfer",
}
_NUM_TYPE_WARN = "数字类型按 1=支出 2=收入 3=转账 约定解析"

# app_json 宽松字段名（比较时忽略大小写与下划线）
_DATE_KEYS = ("date", "time", "dateStr", "billDate", "datetime", "createTime", "createDate", "日期", "交易时间")
_AMOUNT_KEYS = ("amount", "money", "price", "amt", "金额")
_TYPE_KEYS = ("type", "billType", "direction", "收支", "类型")
_CAT_KEYS = ("category", "catName", "categoryName", "cate", "分类", "一级分类")
_SUBCAT_KEYS = ("subCategory", "childCategory", "subCatName", "二级分类", "子分类")
_ACCOUNT_KEYS = ("accountName", "account", "payAccount", "payWay", "账户", "支付方式")
_TO_ACCOUNT_KEYS = ("toAccountName", "toAccount", "toAccountNickName", "transferAccount", "targetAccount", "转入账户", "对方账户")
_TAGSNAME_KEYS = ("tagsName", "tagNames", "tagList", "tags", "标签")
_NOTE_KEYS = ("remark", "note", "description", "desc", "summary", "备注", "说明")
# 递归找账单数组时优先看的键
_LIST_KEYS = ("bills", "records", "list", "data", "items", "账单", "recordList", "billList", "details", "detail")


# ---------------- 基础工具 ----------------
def decode_bytes(data: bytes) -> str:
    """字节流转文本：UTF-8-sig → GBK → latin-1 兜底，永不抛异常。

    支付宝导出多为 GBK、微信为 UTF-8（带 BOM），编码探测放在入口统一做。
    """
    if data is None:
        return ""
    if isinstance(data, str):
        return data
    for enc in ("utf-8-sig", "gbk", "latin-1"):
        try:
            return data.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode("utf-8", errors="replace")


def _at(row, i):
    """安全取单元格，越界视为空。"""
    if row is None or i is None or i < 0 or i >= len(row):
        return ""
    v = row[i]
    return "" if v is None else str(v).strip()


def _norm_header(h):
    """表头归一：去空白、全角括号转半角、英文小写。"""
    s = str(h or "").strip().replace(" ", "").replace("（", "(").replace("）", ")")
    return s.lower()


def _header_role(h):
    """表头单元格 → 列角色（date/time/type/amount/cat/subcat/account/note/tags/itemid/foodid）。"""
    s = _norm_header(h)
    if not s:
        return None
    for role, key in _HEADER_KEYWORDS:
        if key in s:
            return role
    return None


def _norm_dt(value):
    """日期时间归一 → ('YYYY-MM-DD', 'HH:MM')；非法返回 None。

    兼容 2026-11-01 / 2026/11/1 / 2026年11月1日 / 11-01（缺年补当前年）、
    带时间的组合串、ISO 的 T 分隔、钱迹等 App 的秒/毫秒时间戳。
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        try:
            ts = float(value)
            if ts > 1e12:  # 毫秒时间戳
                ts /= 1000.0
            if ts < 0:
                return None
            dt = datetime.fromtimestamp(ts)
            return dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M")
        except (OverflowError, OSError, ValueError):
            return None
    s = str(value).strip()
    if not s:
        return None
    s = s.replace("T", " ").replace("年", "-").replace("月", "-").replace("日", "")
    time_part = ""
    m = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", s)
    if m:
        hh, mm = int(m.group(1)), int(m.group(2))
        # 时间范围校验（P2-3）：hh<24 且 mm<60 才收，越界（如 99:99）置空不让脏时间入库
        if hh < 24 and mm < 60:
            time_part = "%02d:%02d" % (hh, mm)
        s = s[: m.start()] + s[m.end():]
    s = s.strip().strip(",")
    m = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        m = re.match(r"^(\d{1,2})[-/.](\d{1,2})$", s)
        if not m:
            return None
        y, mo, d = date.today().year, int(m.group(1)), int(m.group(2))
    try:
        dt = datetime(y, mo, d)
    except ValueError:
        return None
    return dt.strftime("%Y-%m-%d"), time_part


def _norm_time(value):
    """时间列取 'HH:MM'；组合串（带秒/带日期）也能抽出时刻，非法/越界返回 ''。

    与 _norm_dt 的时刻校验同口径（P2-3）：hh<24 且 mm<60 才收，脏时间不入库。
    """
    if value is None:
        return ""
    m = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", str(value).strip())
    if not m:
        return ""
    hh, mm = int(m.group(1)), int(m.group(2))
    if hh < 24 and mm < 60:
        return "%02d:%02d" % (hh, mm)
    return ""


def _norm_amount(value):
    """金额归一 → (正 float 两位小数, 原值是否为负)；无法解析 (None, False)。

    去 ¥/￥/元/千分位；会计括号负数按负处理。方向由 type 表达，这里只出正数。
    非有限数（NaN/Inf）一律拒收：它们会让 json 序列化出非法的 NaN，前端解析崩。
    """
    if value is None or isinstance(value, bool):
        return None, False
    if isinstance(value, (int, float)):
        f = float(value)
    else:
        s = str(value).strip()
        for ch in ("¥", "￥", "元", ",", " ", "\t"):
            s = s.replace(ch, "")
        if not s:
            return None, False
        if s.startswith("(") and s.endswith(")"):
            s = "-" + s[1:-1]
        try:
            f = float(s)
        except ValueError:
            return None, False
    if not math.isfinite(f):
        return None, False
    neg = f < 0
    return round(abs(f), 2), neg


# 金额非法跳过行时的提示：NaN/Inf 单独注明原因
_NONFINITE_TOKENS = {"nan", "inf", "+inf", "-inf", "infinity", "+infinity", "-infinity", "∞", "-∞"}


def _amount_skip_reason(value):
    """金额无法解析时的 skipped 原因：NaN/Inf 单独注明，其余注明原值。"""
    s = str(value if value is not None else "").strip()
    probe = s.lower()
    for ch in ("¥", "￥", "元", ",", " ", "\t"):
        probe = probe.replace(ch, "")
    if probe in _NONFINITE_TOKENS:
        return "金额为 NaN/Inf，已跳过: %s" % s
    return "金额无效: %s" % s


def _norm_type(value, warnings):
    """类型归一 → 'expense'|'income'|'transfer'；无法识别返回 None。

    数字 1/2/3 按常见约定（1=支出 2=收入 3=转账），并在 warnings 注明约定。
    """
    s = str(value or "").strip()
    if not s:
        return None
    key = s.lower() if s.isascii() else s
    hit = _TYPE_EXACT.get(key)
    if hit is None:
        # 宽松：含「收」→收入，含「转」→转账，其余→支出（app_json 的兜底语义）
        if "收" in s:
            hit = "income"
        elif "转" in s:
            hit = "transfer"
        elif "支" in s or "付" in s or "消" in s:
            hit = "expense"
    if hit and key in ("1", "2", "3") and warnings is not None:
        if _NUM_TYPE_WARN not in warnings:
            warnings.append(_NUM_TYPE_WARN)
    return hit


def _flip_type(t):
    """负数金额转正后修正方向：支出↔收入；转账不变。"""
    return {"expense": "income", "income": "expense"}.get(t, t)


def _read_csv_rows(text):
    """CSV 切行；引号异常时退化为按逗号切，保证不抛。"""
    try:
        return list(csv.reader(io.StringIO(text or "")))
    except csv.Error:
        return [line.split(",") for line in (text or "").splitlines()]


def _join_note(*parts):
    """拼接备注段：去空、去重，空格连接。"""
    out = []
    for p in parts:
        s = str(p or "").strip()
        if s and s not in out:
            out.append(s)
    return " ".join(out)


def _raw_summary(cells, limit=160):
    """原始行摘要，便于前端预览/排查。"""
    s = ",".join(str(c) for c in cells)
    return s if len(s) <= limit else s[:limit] + "…"


# ---------------- 格式探测 ----------------
def detect_format(filename: str, text: str) -> str:
    """根据文件名+文本内容返回 SUPPORTED_FORMATS 之一。

    内容特征优先（支付宝/微信的标识很硬），其次 JSON，再次文件名 .json
    （CSV 伪装成 .json 也交给 app_json 路径去报 warning），最后通用 CSV 启发式。
    """
    name = (filename or "").strip().lower()
    t = text if isinstance(text, str) else decode_bytes(text or b"")
    if t.startswith("\ufeff"):
        t = t[1:]
    head = "\n".join(t.splitlines()[:20])
    # 支付宝：品牌词+时间/分类特征，或表头带商家订单号
    if ("支付宝" in head and ("交易时间" in head or "交易分类" in head)) or (
        "商家订单号" in head and "交易时间" in head
    ):
        return "alipay_csv"
    # 微信：账单标题，或 交易单号+商户单号 同现
    if "微信支付账单明细" in head or ("交易单号" in head and "商户单号" in head):
        return "wechat_csv"
    stripped = t.lstrip()
    if stripped[:1] in ("{", "["):
        try:
            json.loads(t)
            return "app_json"
        except ValueError:
            pass
    if name.endswith(".json"):
        return "app_json"
    if _looks_like_generic_csv(t):
        return "generic_csv"
    if _looks_like_pasted_text(t):
        return "pasted_text"
    return "unknown"


def _looks_like_generic_csv(text):
    """启发式：有表头同义词，或能从数据值猜出日期+金额列。"""
    rows = [r for r in _read_csv_rows(text) if any(str(c).strip() for c in r)]
    if len(rows) < 1:
        return False
    header = [str(c).strip() for c in rows[0]]
    if any(_header_role(h) for h in header):
        return True
    return _guess_columns(header, rows[1:6]) is not None


# ---------------- 支付宝 CSV ----------------
def _find_header_row(rows, need_any, need_all=()):
    """定位表头行：含 need_any 之一的单元格（need_all 全部命中者优先）。"""
    fallback = None
    for i, row in enumerate(rows):
        cells = [str(c).strip() for c in row]
        if not any(any(m == c or m in c for c in cells) for m in need_any):
            continue
        if all(any(m == c or m in c for c in cells) for m in need_all):
            return i, cells
        if fallback is None:
            fallback = (i, cells)
    return fallback if fallback else (None, None)


def _col_index(cells, *names):
    """按列名找索引：先全等再包含，取首个命中。"""
    for n in names:
        for i, c in enumerate(cells):
            if c == n:
                return i
    for n in names:
        for i, c in enumerate(cells):
            if n and n in c:
                return i
    return None


def _parse_alipay(text):
    """支付宝账单导出：GBK/UTF-8 均可（入口已转 str），表头行起为数据。"""
    res = {"bills": [], "skipped": [], "warnings": []}
    rows = _read_csv_rows(text)
    hi, cells = _find_header_row(rows, ("交易时间",), ("金额",))
    if hi is None:
        res["warnings"].append("未找到支付宝表头（含「交易时间」的行）")
        return res
    i_time = _col_index(cells, "交易时间")
    i_dir = _col_index(cells, "收/支", "收支")
    i_amt = _col_index(cells, "金额")
    i_acct = _col_index(cells, "收/付款方式", "支付方式", "账户")
    i_status = _col_index(cells, "交易状态", "状态")
    i_goods = _col_index(cells, "商品说明")
    i_party = _col_index(cells, "交易对方")
    if i_time is None or i_amt is None:
        res["warnings"].append("支付宝表头缺「交易时间」或「金额」列")
        return res
    for row in rows[hi + 1:]:
        cells_r = [str(c).strip() for c in row]
        if not any(cells_r):
            continue
        raw = _raw_summary(cells_r)
        dt = _norm_dt(_at(cells_r, i_time))
        if dt is None:
            res["skipped"].append({"raw": raw, "reason": "日期无效: %s" % _at(cells_r, i_time)})
            continue
        status = _at(cells_r, i_status)
        if i_status is not None and status and status != "交易成功":
            res["skipped"].append({"raw": raw, "reason": "状态：%s" % status})
            continue
        d = _at(cells_r, i_dir) if i_dir is not None else ""
        if d == "不计收支":
            res["skipped"].append({"raw": raw, "reason": "不计收支"})
            continue
        if d == "收入":
            t = "income"
        elif d == "支出":
            t = "expense"
        else:
            res["skipped"].append({"raw": raw, "reason": "无法识别收/支: %s" % d})
            continue
        amt, neg = _norm_amount(_at(cells_r, i_amt))
        if amt is None:
            res["skipped"].append({"raw": raw, "reason": _amount_skip_reason(_at(cells_r, i_amt))})
            continue
        if neg:  # 支付宝金额一般不为负，出现就修正方向
            t = _flip_type(t)
            res["warnings"].append("金额为负已转正并修正类型: %s" % raw)
        res["bills"].append({
            "date": dt[0], "time": dt[1], "type": t, "amount": amt,
            "catName": "", "subCatName": "",
            "accountName": _at(cells_r, i_acct),
            "note": _join_note(_at(cells_r, i_goods), _at(cells_r, i_party)),
            "raw": raw,
        })
    return res


# ---------------- 微信 CSV ----------------
def _parse_wechat(text):
    """微信支付账单：前 16 行左右是说明文字，跳到 交易单号 表头行起解析。"""
    res = {"bills": [], "skipped": [], "warnings": []}
    rows = _read_csv_rows(text)
    hi, cells = None, None
    for i, row in enumerate(rows):
        c = [str(x).strip() for x in row]
        if c and c[0] == "交易单号" and "交易时间" in c[:4]:
            hi, cells = i, c
            break
    if hi is None:
        res["warnings"].append("未找到微信表头（以「交易单号」开头的行）")
        return res
    i_time = _col_index(cells, "交易时间")
    i_txn = _col_index(cells, "交易类型")
    i_party = _col_index(cells, "交易对方")
    i_goods = _col_index(cells, "商品")
    i_dir = _col_index(cells, "收/支", "收支")
    i_amt = _col_index(cells, "金额(元)", "金额", "金额（元）")
    i_acct = _col_index(cells, "支付方式")
    i_status = _col_index(cells, "当前状态", "状态")
    for row in rows[hi + 1:]:
        cells_r = [str(c).strip() for c in row]
        if not any(cells_r):
            continue
        raw = _raw_summary(cells_r)
        dt = _norm_dt(_at(cells_r, i_time))
        if dt is None:
            res["skipped"].append({"raw": raw, "reason": "日期无效: %s" % _at(cells_r, i_time)})
            continue
        status = _at(cells_r, i_status)
        if i_status is not None and status and status not in _WECHAT_OK_STATUS:
            res["skipped"].append({"raw": raw, "reason": "状态：%s" % status})
            continue
        txn = _at(cells_r, i_txn)
        d = _at(cells_r, i_dir) if i_dir is not None else ""
        if d in ("收入",):
            t = "income"
        elif d in ("支出",):
            t = "expense"
        elif d in ("/", "其他", ""):
            # 转账/零钱通等内部流转：交易类型含「转账」才算 transfer
            if "转账" in txn:
                t = "transfer"
            else:
                res["skipped"].append({"raw": raw, "reason": "无法识别收/支: %s" % d})
                continue
        else:
            res["skipped"].append({"raw": raw, "reason": "无法识别收/支: %s" % d})
            continue
        amt, neg = _norm_amount(_at(cells_r, i_amt))
        if amt is None:
            res["skipped"].append({"raw": raw, "reason": _amount_skip_reason(_at(cells_r, i_amt))})
            continue
        if neg:
            t = _flip_type(t)
            res["warnings"].append("金额为负已转正并修正类型: %s" % raw)
        res["bills"].append({
            "date": dt[0], "time": dt[1], "type": t, "amount": amt,
            "catName": "", "subCatName": "",
            "accountName": _at(cells_r, i_acct),
            "note": _join_note(_at(cells_r, i_goods), _at(cells_r, i_party)),
            "raw": raw,
        })
    return res


# ---------------- 通用 CSV（模板 + 智能猜列） ----------------
def _guess_columns(header, data_rows):
    """表头不标准时按数据值猜列：日期列看形态，金额列看 float 化且多数>0。"""
    sample = [r for r in (data_rows or []) if any(str(c).strip() for c in r)][:20]
    if not sample:
        return None
    ncols = max([len(header)] + [len(r) for r in sample])
    date_col = amount_col = None
    best_date = best_amount = 0
    for i in range(ncols):
        vals = [v for v in (_at(r, i) for r in sample) if v]
        if len(vals) < max(1, len(sample) // 2):
            continue
        hits = sum(1 for v in vals if _norm_dt(v))
        if hits > best_date and hits >= len(vals) * 0.6:
            date_col, best_date = i, hits
    for i in range(ncols):
        if i == date_col:
            continue
        vals = [v for v in (_at(r, i) for r in sample) if v]
        if len(vals) < max(1, len(sample) // 2):
            continue
        parsed = [a for a, _n in (_norm_amount(v) for v in vals) if a is not None]
        if len(parsed) < len(vals) * 0.6:
            continue
        if sum(1 for a in parsed if a > 0) <= len(parsed) * 0.5:
            continue
        if len(parsed) > best_amount:
            amount_col, best_amount = i, len(parsed)
    if date_col is None or amount_col is None:
        return None
    out = {"date": date_col, "amount": amount_col}
    # 类型列：值大多能映射成收支
    for i in range(ncols):
        if i in (date_col, amount_col):
            continue
        vals = [v for v in (_at(r, i) for r in sample) if v]
        if vals and sum(1 for v in vals if _norm_type(v, None)) >= len(vals) * 0.6:
            out["type"] = i
            break
    return out


def _map_columns(header, data_rows):
    """列映射：先表头同义词，缺日期/金额再用数据值猜；都凑不齐返回 None。"""
    syn = {}
    for i, h in enumerate(header):
        role = _header_role(h)
        if role and role not in syn:
            syn[role] = i
    if "date" in syn and "amount" in syn:
        return syn
    guess = _guess_columns(header, data_rows)
    if not guess:
        return None
    merged = dict(guess)
    for k, v in syn.items():
        if k not in merged:
            merged[k] = v
    if "date" not in merged or "amount" not in merged:
        return None
    return merged


def _parse_generic(text):
    """通用模板 CSV + 智能猜列。列映射失败时明确提示下载模板。"""
    res = {"bills": [], "skipped": [], "warnings": []}
    rows = [r for r in _read_csv_rows(text) if any(str(c).strip() for c in r)]
    if not rows:
        res["warnings"].append("无法识别列映射，建议下载模板")
        return res
    header = [str(c).strip() for c in rows[0]]
    data = rows[1:]
    cols = _map_columns(header, data)
    if cols is None:
        res["warnings"].append("无法识别列映射，建议下载模板")
        return res
    for row in data:
        cells_r = [str(c).strip() for c in row]
        if not any(cells_r):
            continue
        raw = _raw_summary(cells_r)
        dt = _norm_dt(_at(cells_r, cols["date"]))
        if dt is None:
            res["skipped"].append({"raw": raw, "reason": "日期无效: %s" % _at(cells_r, cols["date"])})
            continue
        amt, neg = _norm_amount(_at(cells_r, cols["amount"]))
        if amt is None:
            res["skipped"].append({"raw": raw, "reason": _amount_skip_reason(_at(cells_r, cols["amount"]))})
            continue
        t = None
        if "type" in cols:
            t = _norm_type(_at(cells_r, cols["type"]), res["warnings"])
        if t is None:
            t = "expense"  # 缺类型按支出，宁可欠激进
            if "type" in cols and _at(cells_r, cols["type"]):
                res["warnings"].append("无法识别的类型「%s」，按支出处理" % _at(cells_r, cols["type"]))
        if neg:
            t = _flip_type(t)
            res["warnings"].append("金额为负已转正并修正类型: %s" % raw)
        tags = ""
        tag_col = cols.get("tagsname")
        if tag_col is None:
            tag_col = cols.get("tags")
        if tag_col is not None:
            raw_tags = _at(cells_r, tag_col)
            if raw_tags:
                # 标签支持 | 或 , 分隔多个；CSV 里的逗号已被引号处理
                parts = [p.strip() for p in re.split(r"[|,，]", raw_tags) if p.strip()]
                tags = "|".join(dict.fromkeys(parts))
        bill = {
            "date": dt[0], "time": dt[1], "type": t, "amount": amt,
            "catName": _at(cells_r, cols.get("cat")),
            "subCatName": _at(cells_r, cols.get("subcat")),
            "accountName": _at(cells_r, cols.get("account")),
            "note": _at(cells_r, cols.get("note")),
            "raw": raw,
        }
        # 独立时间列（导出往返，乙2）：合法时刻覆盖 b.time，组合日期里的时刻兜底
        if "time" in cols and cols["time"] != cols["date"]:
            tval = _norm_time(_at(cells_r, cols["time"]))
            if tval:
                bill["time"] = tval
        # 关联词条/美食 id 列（导出往返，乙2）：恢复 itemId/foodId；列缺失/空值静默忽略
        iid = _at(cells_r, cols.get("itemid"))
        if iid:
            bill["itemId"] = iid
        fid = _at(cells_r, cols.get("foodid"))
        if fid:
            bill["foodId"] = fid
        to_name = ""
        if "toaccount" in cols:
            to_name = _at(cells_r, cols["toaccount"])
        if to_name:
            bill["toAccountName"] = to_name  # 转入账户名称直出
        if tags:
            bill["tags"] = tags  # 额外字段：模板的标签列，不挤占主字段
            bill["tagsName"] = [p for p in tags.split("|") if p]  # 名称列表直出
        res["bills"].append(bill)
    return res


# ---------------- 多行粘贴文本（宽松解析） ----------------
# 每行形如「2026-11-01 支出 23.5 午饭」或「午饭 23.5」（缺日期用今天），空白分词
_PASTED_TYPE_TOKENS = {
    "支出": "expense", "收入": "income", "转账": "transfer",
    "支": "expense", "收": "income", "转": "transfer",
    "花": "expense", "赚": "income",
    "-": "expense", "+": "income", "－": "expense", "＋": "income",
}
_PASTED_TIME_RE = re.compile(r"^\d{1,2}:\d{2}$")
_PASTED_DATE_SHAPE_RE = re.compile(r"^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$")
# 纯数字 token（可带 ¥/元）才算金额；千分位必须 3 位一组，防「1,2」被当成 12
_PASTED_NUM_RE = re.compile(r"[+-]?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|[+-]?\d+(?:\.\d{1,2})?")


def _pasted_amount(tok):
    """宽松金额 token → float；不是纯数字形态返回 None。"""
    s = str(tok).strip()
    for ch in ("¥", "￥", "元", "块"):
        s = s.replace(ch, "")
    if not s or not _PASTED_NUM_RE.fullmatch(s):
        return None
    try:
        f = float(s.replace(",", ""))
    except ValueError:
        return None
    if not math.isfinite(f):
        return None
    return f


def _parse_pasted_line(line, warnings):
    """粘贴单行 → 账单 dict；缺金额/日期非法返回 None。

    词性判定顺序：金额 → 类型 → 时间 → 日期 → 备注（数字优先，防「6.5」被当日期）。
    首个金额/日期/时间/类型生效，多余的落备注。
    """
    tokens = [tk for tk in re.split(r"\s+", line.strip()) if tk]
    if not tokens:
        return None
    date_s = time_s = None
    t = None
    amt = None
    neg = False
    bad_date = None
    note_parts = []
    for tk in tokens:
        if amt is None:
            a = _pasted_amount(tk)
            if a is not None:
                neg = a < 0
                amt = round(abs(a), 2)
                continue
        if t is None and tk in _PASTED_TYPE_TOKENS:
            t = _PASTED_TYPE_TOKENS[tk]
            continue
        if time_s is None and _PASTED_TIME_RE.match(tk):
            try:
                hh, mm = tk.split(":")
                # 与 _norm_dt 同口径（P2-3）：越界时间置空，脏时间不入库
                if int(hh) < 24 and int(mm) < 60:
                    time_s = "%02d:%02d" % (int(hh), int(mm))
                continue
            except ValueError:
                pass
        if date_s is None and bad_date is None and _PASTED_DATE_SHAPE_RE.match(tk):
            dt = _norm_dt(tk)
            if dt is None:
                bad_date = tk  # 长得像日期但非法（如 2026-13-40）：整行跳过
                continue
            date_s, extra_time = dt[0], dt[1]
            if time_s is None and extra_time:
                time_s = extra_time
            continue
        note_parts.append(tk)
    if bad_date is not None:
        return {"__skip__": "日期无效: %s" % bad_date}
    if amt is None:
        return None
    if date_s is None:
        date_s = date.today().strftime("%Y-%m-%d")  # 缺日期用今天
    if t is None:
        t = "expense"  # 缺类型按支出
    if neg:
        t = _flip_type(t)
        warnings.append("金额为负已转正并修正类型: %s" % line[:160])
    return {
        "date": date_s, "time": time_s or "", "type": t, "amount": amt,
        "catName": "", "subCatName": "", "accountName": "",
        "note": " ".join(note_parts), "raw": _raw_summary([line]),
    }


def _parse_pasted(text):
    """多行粘贴文本 → 账单；解析不了的行进 skipped（含原因），整体不抛。"""
    res = {"bills": [], "skipped": [], "warnings": []}
    for line in (text or "").splitlines():
        s = line.strip()
        if not s:
            continue
        bill = _parse_pasted_line(s, res["warnings"])
        if bill is None:
            res["skipped"].append({"raw": _raw_summary([s]), "reason": "无法解析该行（缺金额）"})
        elif "__skip__" in bill:
            res["skipped"].append({"raw": _raw_summary([s]), "reason": bill["__skip__"]})
        else:
            res["bills"].append(bill)
    return res


def _looks_like_pasted_text(text):
    """启发式：多数非空行能拆出金额 token，即认为是粘贴文本（非 CSV）。"""
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()][:50]
    if not lines:
        return False
    ok = 0
    for ln in lines:
        tokens = [tk for tk in re.split(r"\s+", ln) if tk]
        if any(_pasted_amount(tk) is not None for tk in tokens):
            ok += 1
    return ok >= 1 and ok >= (len(lines) + 1) // 2


# ---------------- 其他记账 App 的 JSON ----------------
def _pick(d, keys):
    """宽松取字段：大小写/下划线不敏感，取首个非空值。"""
    flat = {}
    for k, v in d.items():
        if isinstance(k, str):
            flat[k.replace("_", "").lower()] = v
    for key in keys:
        v = flat.get(key.replace("_", "").lower())
        if v is not None and v != "":
            return v
    return None


def _name_of(v):
    """分类值可能是字符串或 {name: ...} 嵌套对象（对象嵌套风格），统一取名字。"""
    if v is None:
        return ""
    if isinstance(v, dict):
        for k in ("name", "title", "Name", "label", "id"):
            if v.get(k):
                return str(v[k]).strip()
        return ""
    if isinstance(v, list):
        return "|".join(filter(None, (_name_of(x) for x in v)))
    return str(v).strip()


def _names_list(v):
    """标签值统一成名称列表：列表逐项取名；字符串支持 | / ，分隔多个。"""
    if v is None:
        return []
    if isinstance(v, (list, tuple)):
        out = []
        for x in v:
            s = _name_of(x)
            if s:
                out.append(s)
        return out
    s = _name_of(v)
    if not s:
        return []
    parts = [p.strip() for p in re.split(r"[|,，]", s) if p.strip()]
    return list(dict.fromkeys(parts))


def _has_key(d, keys):
    flat = {k.replace("_", "").lower() for k in d.keys() if isinstance(k, str)}
    return any(k.replace("_", "").lower() in flat for k in keys)


def _find_bill_list(obj, depth=0):
    """递归找账单数组：优先常见键名，其次按「含 amount+date 特征」认领。"""
    if depth > 6:
        return None
    if isinstance(obj, list):
        dicts = [x for x in obj if isinstance(x, dict)]
        if dicts and len(dicts) >= max(1, len(obj) * 0.5):
            hits = sum(1 for d in dicts if _has_key(d, _AMOUNT_KEYS) and _has_key(d, _DATE_KEYS))
            if hits >= max(1, len(dicts) * 0.5):
                return dicts
        for x in obj:
            found = _find_bill_list(x, depth + 1)
            if found:
                return found
        return None
    if isinstance(obj, dict):
        for k in _LIST_KEYS:
            if k in obj:
                found = _find_bill_list(obj[k], depth + 1)
                if found:
                    return found
        for v in obj.values():
            found = _find_bill_list(v, depth + 1)
            if found:
                return found
    return None


def _parse_app_json(text):
    """其他记账 App 备份：对象/数组皆可，字段名宽松匹配。"""
    res = {"bills": [], "skipped": [], "warnings": []}
    try:
        obj = json.loads(text)
    except ValueError as e:
        # CSV 伪装成 .json 的错误情况：只报 warning 不抛
        res["warnings"].append("JSON 解析失败: %s" % e)
        return res
    records = _find_bill_list(obj)
    if not records:
        res["warnings"].append("JSON 中未找到账单数组")
        return res
    for rec in records:
        raw = json.dumps(rec, ensure_ascii=False, default=str)[:160]
        dv = _pick(rec, _DATE_KEYS)
        dt = _norm_dt(dv)
        if dt is None:
            res["skipped"].append({"raw": raw, "reason": "日期无效: %s" % dv})
            continue
        av = _pick(rec, _AMOUNT_KEYS)
        amt, neg = _norm_amount(av)
        if amt is None:
            res["skipped"].append({"raw": raw, "reason": _amount_skip_reason(av)})
            continue
        tv = _pick(rec, _TYPE_KEYS)
        t = _norm_type(tv, res["warnings"])
        if t is None:
            t = "expense"  # 其余→支出
            if tv is not None and str(tv).strip():
                res["warnings"].append("无法识别的类型「%s」，按支出处理" % tv)
        if neg:
            t = _flip_type(t)
            res["warnings"].append("金额为负已转正并修正类型: %s" % raw)
        bill = {
            "date": dt[0], "time": dt[1], "type": t, "amount": amt,
            "catName": _name_of(_pick(rec, _CAT_KEYS)),
            "subCatName": _name_of(_pick(rec, _SUBCAT_KEYS)),
            "accountName": _name_of(_pick(rec, _ACCOUNT_KEYS)),
            "note": _name_of(_pick(rec, _NOTE_KEYS)),
            "raw": raw,
        }
        to_name = _name_of(_pick(rec, _TO_ACCOUNT_KEYS))
        if to_name:
            bill["toAccountName"] = to_name  # 转入账户名称直出
        tags_list = _names_list(_pick(rec, _TAGSNAME_KEYS))
        if tags_list:
            bill["tagsName"] = tags_list  # 标签名称直出
        res["bills"].append(bill)
    return res


# ---------------- 公共接口 ----------------
_ENCODING_WARN = "文件可能为 GBK 编码，请另存为 UTF-8 后重试或使用新版前端"


def parse_bills(fmt: str, text: str) -> dict:
    """解析为统一账单结构，失败行进 skipped，整体不抛异常。

    返回 {"bills": [...], "skipped": [...], "warnings": [...], "format": fmt}；
    文本含替换符（\ufffd，多为 GBK 被按 UTF-8 硬解）时附加
    "suspect_encoding": True 并在 warnings 提示转存 UTF-8。
    金额出口保证有限数（NaN/Inf 行进 skipped 注明原因），分类为空时按关键词猜默认值。
    """
    fmt = fmt if fmt in SUPPORTED_FORMATS else "unknown"
    t = text if isinstance(text, str) else decode_bytes(text or b"")
    if t.startswith("\ufeff"):
        t = t[1:]
    try:
        if fmt == "alipay_csv":
            res = _parse_alipay(t)
        elif fmt == "wechat_csv":
            res = _parse_wechat(t)
        elif fmt == "app_json":
            res = _parse_app_json(t)
        elif fmt == "pasted_text":
            res = _parse_pasted(t)
        elif fmt == "generic_csv":
            res = _parse_generic(t)
        else:  # unknown：通用 CSV 兜底
            res = _parse_generic(t)
            res["warnings"].append("未知格式，已按通用 CSV 尝试解析")
    except Exception as e:  # 解析器兜底：任何意外都不该打断导入流程
        res = {"bills": [], "skipped": [], "warnings": ["解析异常: %s" % e]}
    res.setdefault("skipped", [])
    res.setdefault("warnings", [])
    res["format"] = fmt
    # 金额出口安全：非有限（NaN/Inf）一律拦下，防止 json 出 NaN 让前端解析崩
    safe = []
    for b in res["bills"]:
        a = b.get("amount")
        if isinstance(a, (int, float)) and not isinstance(a, bool) and math.isfinite(float(a)):
            safe.append(b)
        else:
            res["skipped"].append({"raw": b.get("raw", ""), "reason": _amount_skip_reason(a)})
    res["bills"] = safe
    # 分类自动归类：仅当原分类为空时填关键词猜出的默认值
    for b in res["bills"]:
        _apply_cat_guess(b)
    # 已乱码文本（含替换符）标记，提示换编码
    if "\ufffd" in t:
        res["suspect_encoding"] = True
        res["warnings"].append(_ENCODING_WARN)
    return res


def parse_any(fmt_hint, raw_bytes_or_text) -> dict:
    """统一解析入口：bytes 先 decode_bytes（UTF-8→GBK→latin-1 兜底），str 原样。

    fmt_hint 传 SUPPORTED_FORMATS 之一则直接按该格式解析，
    否则当文件名交给 detect_format 探测。
    """
    raw = raw_bytes_or_text
    if isinstance(raw, str):
        text = raw
    elif raw is None:
        text = ""
    elif isinstance(raw, (bytes, bytearray, memoryview)):
        text = decode_bytes(bytes(raw))
    else:
        text = str(raw)
    fmt = fmt_hint if fmt_hint in SUPPORTED_FORMATS else detect_format(fmt_hint or "", text)
    return parse_bills(fmt, text)


def _norm_note(note):
    """备注比较键：去掉全部空白。"""
    return re.sub(r"\s+", "", str(note or ""))


# ---------------- 分类自动归类 ----------------
# 备注关键词 → (一级分类, 二级分类)；名称对齐服务端主流记账分类树（DEFAULT_WALLET_CATS）。
# 收入类为平铺一级，二级为空。规则按需扩充，命中取最长关键词（同长取表内靠前者）。
_GUESS_RULES = [
    (("打车", "滴滴", "网约车", "出租车"), "出行交通", "打车"),
    (("地铁", "公交", "一卡通"), "出行交通", "公共交通"),
    (("加油", "中石化", "中石油"), "出行交通", "加油"),
    (("停车",), "出行交通", "停车费"),
    (("高铁", "火车", "12306"), "出行交通", "火车"),
    (("机票", "航空"), "出行交通", "飞机"),
    (("早餐", "早饭", "包子", "豆浆"), "食品餐饮", "早餐"),
    (("午餐", "午饭", "快餐", "便当", "外卖", "美团", "饿了么"), "食品餐饮", "午餐"),
    (("晚餐", "晚饭", "餐厅", "饭店"), "食品餐饮", "晚餐"),
    (("奶茶", "咖啡", "星巴克", "瑞幸", "蜜雪"), "食品餐饮", "饮料酒水"),
    (("超市", "菜市场", "生鲜", "盒马"), "食品餐饮", "生鲜食品"),
    (("零食", "便利店", "全家", "711"), "食品餐饮", "休闲零食"),
    (("淘宝", "天猫", "京东", "拼多多", "网购"), "购物消费", "其他"),
    (("手机", "数码", "耳机", "苹果", "华为"), "购物消费", "手机数码"),
    (("衣服", "鞋", "优衣库", "ZARA"), "购物消费", "服饰运动"),
    (("美妆", "护肤", "口红", "屈臣氏"), "购物消费", "个护美妆"),
    (("充值", "话费充值", "流量"), "购物消费", "虚拟充值"),
    (("水费",), "居家生活", "水费"),
    (("电费",), "居家生活", "电费"),
    (("燃气",), "居家生活", "燃气费"),
    (("物业",), "居家生活", "物业费"),
    (("房租",), "居家生活", "房租还贷"),
    (("话费", "宽带"), "居家生活", "话费宽带"),
    (("电影", "KTV", "唱歌"), "休闲娱乐", "电影唱歌"),
    (("演出",), "休闲娱乐", "演出"),
    (("健身", "游泳"), "休闲娱乐", "运动健身"),
    (("药店", "药房", "买药"), "健康医疗", "买药"),
    (("医院", "挂号"), "健康医疗", "医院"),
    (("红包",), "送礼人情", "红包"),
    (("礼物", "礼品", "送礼", "份子"), "送礼人情", "礼物"),
    (("工资", "薪资", "月薪"), "工资", ""),
    (("奖金", "年终奖"), "奖金", ""),
    (("报销",), "报销", ""),
]


def guess_category(note: str, cat_name: str = "") -> tuple:
    """按备注关键词猜分类 → (catName, subCatName)。

    规则：note 含关键词即命中，多个命中取最长关键词（同长取表内靠前者）；
    未命中回退 (cat_name, "") 保留原分类。
    """
    s = str(note or "").lower()
    best_len, best = 0, None
    for keywords, cat, sub in _GUESS_RULES:
        for kw in keywords:
            if kw.lower() in s and len(kw) > best_len:
                best_len, best = len(kw), (cat, sub)
    if best:
        return best
    return str(cat_name or "").strip(), ""


def _apply_cat_guess(bill):
    """分类默认值：仅当原分类（catName）为空时按关键词填 catName/subCatName。"""
    if bill.get("catName"):
        return
    cat, sub = guess_category(bill.get("note") or "", "")
    if cat:
        bill["catName"] = cat
    if sub and not bill.get("subCatName"):
        bill["subCatName"] = sub


# ---------------- 导入计划（去重） ----------------
def _acct_key(bill):
    """账户名比较键（v1.1.6 去重收紧）：取不到名称退空串；含转入侧，保证转账「账户名全同」。"""
    return (
        str(bill.get("accountName") or "").strip(),
        str(bill.get("toAccountName") or "").strip(),
    )


def _match_bill(item, pool):
    """pool 中找重复：同 date + 同 amount + 同 type，且备注判定命中。

    备注判定（v1.1.6 收紧，防同日同额空备注误吞——同价咖啡丢账）：
    - 两侧备注都为空：还须「日期+金额+类型+账户名」全同才算重复；
    - 任一侧有备注：维持既有判重语义（备注归一后相同或一侧为空即算重复）。
    """
    try:
        ba = round(float(item.get("amount")), 2)
        if not math.isfinite(ba):
            ba = None
    except (TypeError, ValueError):
        ba = None
    bn = _norm_note(item.get("note"))
    for e in pool:
        if e.get("date") != item.get("date") or e.get("type") != item.get("type"):
            continue
        try:
            ea = round(float(e.get("amount")), 2)
        except (TypeError, ValueError):
            continue
        if ba is None or not math.isfinite(ea) or ea != ba:
            continue
        en = _norm_note(e.get("note"))
        if not bn and not en:
            # 双方备注都为空：账户名也要全同才算重复（不同账户的同价消费不再被吞）
            if _acct_key(item) == _acct_key(e):
                return e
            continue
        if bn == en or not bn or not en:
            return e
    return None


def build_import_plan(bills: list, existing: list) -> dict:
    """与已有账单去重 + 文件内互查后生成导入计划。

    重复判定：同 date + 同 amount + 同 type，且备注判定命中——
    两侧备注都为空时还须账户名全同（v1.1.6 收紧），任一侧有备注维持既有语义
    （note 去空白后相同或其中一侧为空）；文件内互重（后出现者判重）matchNote 固定为「文件内重复」。
    返回：
      rows        非重复账单（带 dup=False、matchNote=""）
      duplicates  重复账单（带 dup=True、matchNote）
      bills       全部账单（保持输入顺序，逐条带 dup/matchNote）
      dups        重复笔数
    """
    rows, dups, all_rows = [], [], []
    ex = list(existing or [])
    seen = []  # 文件内已放行账单，供互查
    for b in bills or []:
        item = dict(b)
        match = _match_bill(item, ex)
        in_file = match is None
        if in_file:
            match = _match_bill(item, seen)
        if match is not None:
            item["dup"] = True
            item["matchNote"] = "文件内重复" if in_file else (match.get("note") or "")
            dups.append(item)
        else:
            item["dup"] = False
            item["matchNote"] = ""
            rows.append(item)
            seen.append(item)
        all_rows.append(item)
    return {"rows": rows, "duplicates": dups, "bills": all_rows, "dups": len(dups)}


def build_template_csv() -> str:
    """通用导入模板 CSV（UTF-8 with BOM，Excel 直接打开不乱码），附 2 行示例。"""
    lines = [
        ["日期", "类型", "金额", "一级分类", "二级分类", "账户", "备注", "标签"],
        ["2026-11-01", "支出", "23.50", "餐饮", "午餐", "微信钱包", "公司楼下快餐", "工作餐|午餐"],
        ["2026-11-02", "收入", "8000.00", "工资", "月薪", "招商银行(1234)", "10月工资", "薪资"],
    ]
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerows(lines)
    return "\ufeff" + buf.getvalue()
