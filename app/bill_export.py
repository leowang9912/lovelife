# -*- coding: utf-8 -*-
"""账单导出 CSV（Excel 可直接打开）

serve.py 调用链：load_db → build_bills_csv → 文本直接回传下载。
纯转换模块，不碰磁盘/网络，便于单测（与 bill_import 同风格）。
"""
import csv
import io
import math

# 列顺序固定，前端/文档按此表头对齐
HEADER = ["日期", "时间", "类型", "金额", "一级分类", "二级分类", "账户", "转入账户", "备注", "标签"]

# 类型内部值 → 中文展示；未知类型原样输出，避免导出丢信息
_TYPE_CN = {"expense": "支出", "income": "收入", "transfer": "转账"}


def _cell(value):
    """空值统一输出空串，其余转字符串。"""
    return "" if value is None else str(value)


def _amount_cell(value):
    """金额正数两位小数；缺失/非法输出空串（空值不造假 0.00）。"""
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


def _tag_cell(bill):
    """标签列：优先 tagsName，缺失时退化为 tagIds（同样「|」连接）。"""
    names = _join_names(bill.get("tagsName"))
    return names or _join_names(bill.get("tagIds"))


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


def build_bills_csv(bills, cats) -> str:
    """把账单导出为 CSV 文本（UTF-8 with BOM '\\ufeff' 开头，逗号分隔，字段含逗号/引号/换行时用双引号包裹）。

    参数：
      bills: 账单列表，字段 {date, time, type, amount, catId, subCatId, accountId,
             toAccountId, note, tagIds, source}；调用方已解析出名称时可附带
             accountName/toAccountName/tagsName，优先使用。
      cats:  {"expense": [ {id, name, children:[{id,name}]} ], "income": [...]}
      accountId/toAccountId 无法解析名称时输出空（无账户名称表可查）。
    列（固定顺序）：日期,时间,类型,金额,一级分类,二级分类,账户,转入账户,备注,标签
    - 类型输出中文：支出/收入/转账
    - 一级/二级分类按 cats 树把 id 解析成名称（解析不到输出原 id）
    - 标签列：tagsName 列表用「|」连接；没有 tagsName 只有 tagIds 时输出 tagIds
    - 金额正数两位小数，日期原样输出，空值输出空串
    """
    top, sub = _cat_maps(cats or {})
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
            _cell(bill.get("accountName")),   # 名称优先；accountId 无表可查时输出空
            _cell(bill.get("toAccountName")),
            _cell(bill.get("note")),
            _tag_cell(bill),
        ])
    return "\ufeff" + buf.getvalue()
