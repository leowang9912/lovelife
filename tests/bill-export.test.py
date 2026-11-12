# -*- coding: utf-8 -*-
"""bill-export.test.py — 账单导出 CSV 单测（列顺序/转义/分类解析/BOM/空表/标签/名称解析/筛选）"""
import csv
import io
import os
import sys
import unittest

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')
APP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app")
if APP not in sys.path:
    sys.path.insert(0, APP)
import bill_export as be

# ---------------- 样例数据（内联常量，不依赖外部文件） ----------------
CATS = {
    "expense": [
        {"id": "e1", "name": "餐饮", "children": [{"id": "s1", "name": "午餐"}]},
    ],
    "income": [
        {"id": "i1", "name": "工资", "children": [{"id": "s2", "name": "月薪"}]},
    ],
}

HEADER = ["日期", "时间", "类型", "金额", "一级分类", "二级分类", "账户", "转入账户", "备注", "标签",
          "关联词条ID", "关联美食ID"]


def parse(text):
    """剥掉 BOM 后用 csv 反解析，验证引号转义可逆。"""
    if text.startswith("\ufeff"):
        text = text[1:]
    return list(csv.reader(io.StringIO(text)))


class TestBillsCsv(unittest.TestCase):
    def test_columns_types_and_cat_names(self):
        """正常支出/收入/转账各一条：列顺序、中文类型、分类 id 解析成名称。"""
        bills = [
            {"date": "2026-11-01", "time": "12:30", "type": "expense", "amount": 23.5,
             "catId": "e1", "subCatId": "s1", "accountName": "微信钱包",
             "note": "午饭", "tagIds": []},
            {"date": "2026-11-02", "time": "09:00", "type": "income", "amount": 8000,
             "catId": "i1", "subCatId": "s2", "accountName": "招商银行(1234)",
             "note": "10月工资", "tagIds": []},
            {"date": "2026-11-03", "time": "10:00", "type": "transfer", "amount": 500,
             "accountName": "微信钱包", "toAccountName": "招商银行(1234)",
             "note": "转存", "tagIds": []},
        ]
        rows = parse(be.build_bills_csv(bills, CATS))
        self.assertEqual(rows[0], HEADER)
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[1], ["2026-11-01", "12:30", "支出", "23.50",
                                   "餐饮", "午餐", "微信钱包", "", "午饭", "", "", ""])
        self.assertEqual(rows[2], ["2026-11-02", "09:00", "收入", "8000.00",
                                   "工资", "月薪", "招商银行(1234)", "", "10月工资", "", "", ""])
        self.assertEqual(rows[3], ["2026-11-03", "10:00", "转账", "500.00",
                                   "", "", "微信钱包", "招商银行(1234)", "转存", "", "", ""])

    def test_special_chars_quoting_roundtrip(self):
        """字段含逗号/引号/换行：CSV 加双引号转义，反解析后原样还原。"""
        tricky = '含,逗号"引号\n换行'
        bills = [{"date": "2026-11-01", "time": "", "type": "expense", "amount": 1.5,
                  "note": tricky, "tagIds": []}]
        rows = parse(be.build_bills_csv(bills, CATS))
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(len(r) == len(HEADER) for r in rows))  # 转义没把列冲乱
        self.assertEqual(rows[1][8], tricky)  # 备注列原样还原

    def test_unknown_cat_id_kept(self):
        """分类 id 解析不到：输出原 id，不崩。"""
        bills = [{"date": "2026-11-01", "type": "expense", "amount": 3,
                  "catId": "nope", "subCatId": "ghost", "tagIds": []}]
        rows = parse(be.build_bills_csv(bills, CATS))
        self.assertEqual(rows[1][4], "nope")
        self.assertEqual(rows[1][5], "ghost")

    def test_bom_and_csv_parseable(self):
        """UTF-8 BOM 开头，整体可被 csv.reader 解析且列数完整。"""
        text = be.build_bills_csv([{"date": "2026-11-01", "type": "expense", "amount": 1}],
                                  CATS)
        self.assertTrue(text.startswith("\ufeff"))
        rows = parse(text)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(len(r) == len(HEADER) for r in rows))

    def test_empty_bills_header_only(self):
        """空 bills 只有表头；cats 缺失也不崩。"""
        self.assertEqual(parse(be.build_bills_csv([], CATS)), [HEADER])
        self.assertEqual(parse(be.build_bills_csv([], None)), [HEADER])
        self.assertEqual(parse(be.build_bills_csv(None, CATS)), [HEADER])

    def test_tags_joined_with_pipe(self):
        """标签多值「|」连接；tagsName 优先，缺失退化为 tagIds。"""
        bills = [
            {"date": "2026-11-01", "type": "expense", "amount": 1,
             "tagsName": ["工作餐", "午餐"], "tagIds": ["t9"]},
            {"date": "2026-11-02", "type": "expense", "amount": 2,
             "tagIds": ["t1", "t2"]},
        ]
        rows = parse(be.build_bills_csv(bills, CATS))
        self.assertEqual(rows[1][9], "工作餐|午餐")  # tagsName 优先于 tagIds
        self.assertEqual(rows[2][9], "t1|t2")

    def test_amount_positive_two_decimals(self):
        """金额正数两位小数，日期原样输出。"""
        bills = [{"date": "2026/11/2", "type": "expense", "amount": -8.456},
                 {"date": "2026-11-03", "type": "income", "amount": ""}]
        rows = parse(be.build_bills_csv(bills, CATS))
        self.assertEqual(rows[1][3], "8.46")
        self.assertEqual(rows[1][0], "2026/11/2")  # 日期原样
        self.assertEqual(rows[2][3], "")  # 空值输出空串，不造假 0.00


ACCOUNTS = [
    {"id": "ac_cash", "name": "现金"},
    {"id": "ac_wechat", "name": "微信"},
    {"id": "ac_bank", "name": "招商银行(1234)"},
]

TAGS = [
    {"id": "t1", "name": "工作餐"},
    {"id": "t2", "name": "午餐"},
    {"id": "t3", "name": ""},
]


class TestNameResolution(unittest.TestCase):
    """accounts/tags 参数：id→名称解析（自带名称优先，无名称退化 id）。"""

    def test_account_id_resolved(self):
        bills = [{"date": "2026-11-01", "type": "transfer", "amount": 500,
                  "accountId": "ac_wechat", "toAccountId": "ac_bank", "note": "转存"}]
        rows = parse(be.build_bills_csv(bills, CATS, accounts=ACCOUNTS))
        self.assertEqual(rows[1][6], "微信")
        self.assertEqual(rows[1][7], "招商银行(1234)")

    def test_account_name_priority(self):
        """导入数据自带 accountName 时优先，不查表。"""
        bills = [{"date": "2026-11-01", "type": "expense", "amount": 1,
                  "accountId": "ac_wechat", "accountName": "导入自带", "note": ""}]
        rows = parse(be.build_bills_csv(bills, CATS, accounts=ACCOUNTS))
        self.assertEqual(rows[1][6], "导入自带")

    def test_unresolved_account_degrades_to_id(self):
        bills = [{"date": "2026-11-01", "type": "expense", "amount": 1,
                  "accountId": "ghost", "toAccountId": "phantom"}]
        rows = parse(be.build_bills_csv(bills, CATS, accounts=ACCOUNTS))
        self.assertEqual(rows[1][6], "ghost")   # 传了表未命中 → 退化 id
        self.assertEqual(rows[1][7], "phantom")

    def test_no_accounts_param_keeps_old_behavior(self):
        """向后兼容：不传 accounts 时无表可查输出空。"""
        bills = [{"date": "2026-11-01", "type": "expense", "amount": 1, "accountId": "ac_wechat"}]
        rows = parse(be.build_bills_csv(bills, CATS))
        self.assertEqual(rows[1][6], "")
        # 同样账单传 accounts 则解析出名称
        rows2 = parse(be.build_bills_csv(bills, CATS, accounts=ACCOUNTS))
        self.assertEqual(rows2[1][6], "微信")

    def test_tag_ids_resolved_to_names(self):
        bills = [{"date": "2026-11-01", "type": "expense", "amount": 1,
                  "tagIds": ["t1", "t2", "t9"]}]
        rows = parse(be.build_bills_csv(bills, CATS, tags=TAGS))
        self.assertEqual(rows[1][9], "工作餐|午餐|t9")  # 无名称退化 id

    def test_tag_empty_name_degrades_to_id(self):
        bills = [{"date": "2026-11-01", "type": "expense", "amount": 1, "tagIds": ["t3"]}]
        rows = parse(be.build_bills_csv(bills, CATS, tags=TAGS))
        self.assertEqual(rows[1][9], "t3")

    def test_tagsname_priority(self):
        bills = [{"date": "2026-11-01", "type": "expense", "amount": 1,
                  "tagsName": ["自带"], "tagIds": ["t1"]}]
        rows = parse(be.build_bills_csv(bills, CATS, tags=TAGS))
        self.assertEqual(rows[1][9], "自带")

    def test_backcompat_without_maps(self):
        bills = [{"date": "2026-11-01", "type": "expense", "amount": 1,
                  "accountName": "微信", "tagIds": ["t1"]}]
        rows = parse(be.build_bills_csv(bills, CATS))
        self.assertEqual(rows[1][6], "微信")
        self.assertEqual(rows[1][9], "t1")


class TestFilterBills(unittest.TestCase):
    """filter_bills：from/to/catId/type 筛选（缺省全量）。"""

    BILLS = [
        {"date": "2026-11-01", "type": "expense", "amount": 10, "catId": "e1", "subCatId": "s1"},
        {"date": "2026-11-02", "type": "income", "amount": 20, "catId": "i1", "subCatId": ""},
        {"date": "2026-11-03", "type": "transfer", "amount": 30, "catId": "", "subCatId": ""},
        {"date": "2026/11/4", "type": "expense", "amount": 40, "catId": "e1", "subCatId": "s2"},
        {"date": "garbage", "type": "expense", "amount": 50, "catId": "e1"},
    ]

    def test_no_filter_returns_all(self):
        self.assertEqual(len(be.filter_bills(self.BILLS)), 5)
        self.assertEqual(len(be.filter_bills(self.BILLS, None, None, None, None)), 5)

    def test_from_to(self):
        out = be.filter_bills(self.BILLS, date_from="2026-11-02", date_to="2026-11-03")
        self.assertEqual([b["amount"] for b in out], [20, 30])

    def test_boundary_inclusive(self):
        out = be.filter_bills(self.BILLS, date_from="2026-11-01", date_to="2026-11-01")
        self.assertEqual([b["amount"] for b in out], [10])

    def test_date_normalized_and_bad_date_excluded(self):
        # 2026/11/4 归一成 2026-11-04 落在区间；garbage 日期在有日期筛选时排除
        out = be.filter_bills(self.BILLS, date_from="2026-11-04", date_to="2026-11-05")
        self.assertEqual([b["amount"] for b in out], [40])

    def test_cat_id_matches_sub_too(self):
        out = be.filter_bills(self.BILLS, cat_id="e1")
        self.assertEqual([b["amount"] for b in out], [10, 40, 50])
        out2 = be.filter_bills(self.BILLS, cat_id="s1")
        self.assertEqual([b["amount"] for b in out2], [10])

    def test_type_filter(self):
        out = be.filter_bills(self.BILLS, bill_type="expense")
        self.assertEqual([b["amount"] for b in out], [10, 40, 50])
        out2 = be.filter_bills(self.BILLS, bill_type="转账")  # 中文兼容
        self.assertEqual([b["amount"] for b in out2], [30])

    def test_combined(self):
        out = be.filter_bills(self.BILLS, date_from="2026-11-01", date_to="2026-11-03",
                              cat_id="e1", bill_type="支出")
        self.assertEqual([b["amount"] for b in out], [10])

    def test_filtered_export_rows(self):
        out = be.filter_bills(self.BILLS, bill_type="income")
        rows = parse(be.build_bills_csv(out, CATS))
        self.assertEqual(len(rows), 2)  # 表头 + 1 行
        self.assertEqual(rows[1][2], "收入")


class TestLinkColumnsRoundtrip(unittest.TestCase):
    """乙2：关联词条ID/关联美食ID 导出列 + 导出→导入整圈往返（时间/链接不丢）。"""

    def test_link_columns_exported(self):
        """itemId/foodId 落最后两列；缺失输出空串。"""
        bills = [
            {"date": "2026-11-01", "time": "12:30", "type": "expense", "amount": 23.5,
             "note": "午饭", "tagIds": [], "itemId": "it_1", "foodId": "fd_1"},
            {"date": "2026-11-02", "time": "", "type": "expense", "amount": 5,
             "note": "水", "tagIds": []},
        ]
        rows = parse(be.build_bills_csv(bills, CATS))
        self.assertEqual(rows[0][10], "关联词条ID")
        self.assertEqual(rows[0][11], "关联美食ID")
        self.assertEqual(rows[1][10], "it_1")
        self.assertEqual(rows[1][11], "fd_1")
        self.assertEqual(rows[2][10], "")
        self.assertEqual(rows[2][11], "")

    def test_roundtrip_export_import_fields(self):
        """导出→导入整圈：时间列/关联 id/名称类字段全部还原（真往返）。"""
        import bill_import as bi
        bills = [
            {"date": "2026-11-01", "time": "23:30", "type": "expense", "amount": 23.5,
             "catId": "e1", "subCatId": "s1", "accountName": "微信钱包",
             "note": "晚饭", "tagIds": ["t1"], "itemId": "it_9", "foodId": "fd_9"},
        ]
        text = be.build_bills_csv(bills, CATS, tags=[{"id": "t1", "name": "工作餐"}])
        res = bi.parse_bills("generic_csv", text)
        self.assertEqual(len(res["bills"]), 1, res)
        b = res["bills"][0]
        self.assertEqual(b["date"], "2026-11-01")
        self.assertEqual(b["time"], "23:30")  # 时间列不再被日期列 first-wins 丢弃
        self.assertEqual(b["type"], "expense")
        self.assertEqual(b["amount"], 23.5)
        self.assertEqual(b["catName"], "餐饮")
        self.assertEqual(b["subCatName"], "午餐")
        self.assertEqual(b["accountName"], "微信钱包")
        self.assertEqual(b["note"], "晚饭")
        self.assertEqual(b["tagsName"], ["工作餐"])
        self.assertEqual(b["itemId"], "it_9")  # 词条链接不丢
        self.assertEqual(b["foodId"], "fd_9")  # 美食链接不丢


def _flatten(suite):
    for x in suite:
        if isinstance(x, unittest.TestSuite):
            for y in _flatten(x):
                yield y
        else:
            yield x


def _run_all():
    """统一输出：PASS n. 用例名 / FAIL n. 用例名: 原因 / 尾行套件统计（断言不变）"""
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(sys.modules[__name__])
    n = 0
    for t in _flatten(suite):
        n += 1
        name = "%s.%s" % (t.__class__.__name__, t._testMethodName)
        res = unittest.TestResult()
        t.run(res)
        if res.wasSuccessful():
            print("PASS %d. %s" % (n, name))
        else:
            tb = (res.failures + res.errors)[0][1]
            reason = tb.strip().splitlines()[-1]
            if reason.startswith("AssertionError: "):
                reason = reason[len("AssertionError: "):]
            print("FAIL %d. %s: %s" % (n, name, reason))
            sys.exit(1)
    print("========== bill-export：%d 项全部通过 ==========" % n)


if __name__ == "__main__":
    _run_all()
