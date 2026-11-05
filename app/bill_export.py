# -*- coding: utf-8 -*-
"""账单导出 CSV（Excel 可直接打开）+ 筛选

serve.py 调用链：load_db → filter_bills（可选） → build_bills_csv → 文本直接回传下载。
纯转换模块，不碰磁盘/网络，便于单测（与 bill_import 同风格）。
"""
import csv
import io
import math
import re

# 列顺序固定，前端/文档按此表头对齐
HEADER = ["日期", "时间", "类型", "金额", "一级分类", "二级分类", "账户", "转入账户", "备注", "标签"]

# 类型内部值 → 中文展示；未知类型原样输出，避免导出丢信息
_TYPE_CN = {"expense": "支出", "income": "收入", "transfer": "转账"}

# 筛选 type 参数兼容中文/内部值
_TYPE_FILTER = {"支出": "expense", "收入": "income", "转账": "transfer",
                "expense": "expense", "income": "income", "transfer": "transfer"}


def _cell(value):
    """空值统一输出空串，其余转字符串。"""
    return "" if value is None else str(value)


def _amount_cell(value):
    """金额正数两位小数；缺失/非法/非有限输出空串（空值不造假 0.00）。"""
    if value is None or value == "":
        return ""
    try:
        num = abs(round(float(value), 2))
    except (TypeError, ValueError):
        return ""
    if not math.isfinite(num):
        return ""
    return f"{num:.2f}"


def _join_names(values):
    """标签列表用「|」连接，忽略空项；标量按单元素处理。"""
    if values is None:
        return ""
    if isinstance(values, (str, int, float)):
        values = [values]
    return "|".join(str(v) for v in values if v is not None and v != "")


def _id_name_map(items):
    """[{id, name}, ...] → {str(id): name}；name 缺失退化为 id。"""
    out = {}
    for it in items or []:
        if not isinstance(it, dict):
            continue
        nid = it.get("id")
        if nid is None or nid == "":
            continue
        out[str(nid)] = _cell(it.get("name")) or str(nid)
    return out


def _account_cell(bill, id_key, name_key, acc_map):
    """账户列：bill 自带名称优先（导入数据直出），其次按 accounts 表解析 id→名称。

    acc_map 为 None（未传 accounts，老调用）时解析不到输出空；
    传了 accounts 时未命中退化输出原 id。
    """
    name = _cell(bill.get(name_key)).strip()
    if name:
        return name
    raw = bill.get(id_key)
    if raw is None or raw == "":
        return ""
    if acc_map is None:
        return ""
    return acc_map.get(str(raw), str(raw))


def _tag_cell(bill, tag_map=None):
    """标签列：优先 tagsName；缺失时退化为 tagIds，经 tags 表解析成名称（无名称退化 id）。"""
    names = _join_names(bill.get("tagsName"))
    if names:
        return names
    ids = bill.get("tagIds")
    if ids is None:
        return ""
    if isinstance(ids, (str, int, float)):
        ids = [ids]
    out = []
    for v in ids:
        if v is None or v == "":
            continue
        s = str(v)
        out.append(tag_map.get(s, s) if tag_map else s)
    return "|".join(out)


def _cat_maps(cats):
    """cats 树展平成 id→名称表：一级/二级分开，expense/income 分组各自建表。"""
    top = {}
    sub = {}
    for grp in ("expense", "income"):
        top[grp], sub[grp] = {}, {}
        for node in (cats.get(grp) or []):
            if not isinstance(node, dict):
                continue
            nid = node.get("id")
            if nid is not None:
                top[grp][str(nid)] = _cell(node.get("name")) or str(nid)
            for child in (node.get("children") or []):
                if not isinstance(child, dict):
                    continue
                cid = child.get("id")
                if cid is not None:
                    sub[grp][str(cid)] = _cell(child.get("name")) or str(cid)
    return top, sub


def _resolve_cat(raw_id, group, maps):
    """id→名称：先查本类型分组再查另一分组；解析不到输出原 id，不崩。"""
    if raw_id is None or raw_id == "":
        return ""
    key = str(raw_id)
    order = [group] if group in maps else []
    order += [g for g in ("expense", "income") if g not in order]
    for grp in order:
        if key in maps[grp]:
            return maps[grp][key]
    return key


# ---------------- 筛选 ----------------
def _date_key(value):
    """日期归一成 'YYYY-MM-DD' 比较键；解析不了返回 ''。

    兼容 2026-11-1 / 2026/11/1 / 2026年11月1日 / 带时间的组合串。
    """
    if value is None:
        return ""
    s = str(value).strip()
    if not s:
        return ""
    s = s.replace("T", " ").replace("年", "-").replace("月", "-").replace("日", "")
    s = s.split(" ")[0].strip().strip(",")
    m = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$", s)
    if not m:
        return ""
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return ""
    return "%04d-%02d-%02d" % (y, mo, d)


def filter_bills(bills, date_from=None, date_to=None, cat_id=None, bill_type=None) -> list:
    """按条件过滤账单；参数全空时原样返回（逐条引用，不复制）。

    date_from/date_to: YYYY-MM-DD，含边界；日期无法归一的账单在有日期筛选时排除。
    cat_id: 同时匹配 catId 或 subCatId（按一级分类筛含其子类）。
    bill_type: expense/income/transfer 或中文 支出/收入/转账。
    """
    df = _date_key(date_from) if date_from else ""
    dt = _date_key(date_to) if date_to else ""
    cid = str(cat_id or "").strip()
    bts = str(bill_type or "").strip()
    bt = _TYPE_FILTER.get(bts, bts) if bts else ""
    out = []
    for bill in bills or []:
        if not isinstance(bill, dict):
            continue
        if bt and str(bill.get("type") or "") != bt:
            continue
        if cid and cid not in (str(bill.get("catId") or ""), str(bill.get("subCatId") or "")):
            continue
        if df or dt:
            key = _date_key(bill.get("date"))
            if not key:
                continue
            if df and key < df:
                continue
            if dt and key > dt:
                continue
        out.append(bill)
    return out


# ---------------- 导出 ----------------
def build_bills_csv(bills, cats, accounts=None, tags=None) -> str:
    """把账单导出为 CSV 文本（UTF-8 with BOM '\\ufeff' 开头，逗号分隔，字段含逗号/引号/换行时用双引号包裹）。

    参数：
      bills: 账单列表，字段 {date, time, type, amount, catId, subCatId, accountId,
             toAccountId, note, tagIds, source}；调用方已解析出名称时可附带
             accountName/toAccountName/tagsName，优先使用（导入数据自带名称直出）。
      cats:  {"expense": [ {id, name, children:[{id,name}]} ], "income": [...]}
      accounts: 可选 [{id, name}]；账户/转入账户列按它把 accountId/toAccountId 解析成名称
             （自带 accountName/toAccountName 优先；未命中退化原 id）。
             不传（None）时维持旧行为：无名称表可查则输出空。
      tags:  可选 [{id, name}]；标签列无 tagsName 时按它把 tagIds 解析成名称，无名称退化 id。
    列（固定顺序）：日期,时间,类型,金额,一级分类,二级分类,账户,转入账户,备注,标签
    - 类型输出中文：支出/收入/转账
    - 一级/二级分类按 cats 树把 id 解析成名称（解析不到输出原 id）
    - 标签列：tagsName 优先，其次 tagIds 解析名称，「|」连接
    - 金额正数两位小数（非有限输出空串），日期原样输出，空值输出空串
    """
    top, sub = _cat_maps(cats or {})
    acc_map = _id_name_map(accounts) if accounts is not None else None
    tag_map = _id_name_map(tags) if tags is not None else None
    buf = io.StringIO()
    # lineterminator 用 \n：字段含逗号/引号/换行时 csv 自动加双引号转义，反解析可还原
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(HEADER)
    for bill in bills or []:
        if not isinstance(bill, dict):
            continue
        btype = bill.get("type") or ""
        group = btype if btype in ("expense", "income") else None
        w.writerow([
            _cell(bill.get("date")),          # 日期原样输出
            _cell(bill.get("time")),
            _TYPE_CN.get(btype, _cell(btype)),
            _amount_cell(bill.get("amount")),
            _resolve_cat(bill.get("catId"), group, top),
            _resolve_cat(bill.get("subCatId"), group, sub),
            _account_cell(bill, "accountId", "accountName", acc_map),
            _account_cell(bill, "toAccountId", "toAccountName", acc_map),
            _cell(bill.get("note")),
            _tag_cell(bill, tag_map),
        ])
    return "\ufeff" + buf.getvalue()
