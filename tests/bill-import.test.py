# -*- coding: utf-8 -*-
"""bill-import.test.py — 账单导入解析单测（detect/parse/plan/template/归类/粘贴/去重）"""
import json
import math
import os
import sys
import unittest
from datetime import date

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')
APP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app")
if APP not in sys.path:
    sys.path.insert(0, APP)
import bill_import as bi

# ---------------- 样例数据（内联常量，不依赖外部文件） ----------------
ALIPAY_CSV = """支付宝交易记录明细查询
账号:[user@example.com]
起始日期:[2026-11-01 00:00:00] 终止日期:[2026-11-30 23:59:59]

交易时间,交易分类,交易对方,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注
2026-11-01 12:30:00,餐饮美食,星巴克,拿铁咖啡,支出,32.00元,招商银行(1234),交易成功,T1,M1,
2026-11-02 09:00:00,转账,张三,还款,收入,8000.00,招商银行(1234),交易成功,T2,M2,
2026-11-03 10:00:00,其他,某商户,测试,不计收支,99.00,支付宝余额,交易成功,T3,M3,
2026-11-04 11:00:00,餐饮,失败店,失败单,支出,15.00,招商银行(1234),交易关闭,T4,M4,
"""

ALIPAY_GBK_MINI = """支付宝交易记录明细查询
交易时间,交易分类,交易对方,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注
2026-11-05 08:00:00,餐饮,包子铺,早餐,支出,6.00元,支付宝余额,交易成功,T5,M5,
"""

WECHAT_CSV = "\n".join([
    "微信支付账单明细",
    "账单编号：202611011234567890",
    "微信昵称：[张三]",
    "起始时间：[2026-11-01 00:00:00]",
    "终止时间：[2026-11-30 23:59:59]",
    "导出时间：[2026-11-30 18:00:00]",
    "导出类型：[全部]",
    "币种：[CNY]",
    "",
    "----------------------微信支付账单明细列表--------------------",
    "",
    "以下为账单明细列表",
    "说明行1",
    "说明行2",
    "说明行3",
    "说明行4",
    "交易单号,交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注",
    "4200001,2026-11-01 12:30:00,商户消费,星巴克,拿铁,支出,¥32.00,零钱,支付成功,4200001,M1001,",
    "4200002,2026-11-02 09:00:00,微信转账,李四,红包,/,¥100.00,零钱,已转账,4200002,M1002,",
    "4200003,2026-11-03 10:00:00,商户消费,失败店,失败单,支出,¥15.00,零钱,支付失败,4200003,M1003,",
    "4200004,2026-11-04 20:00:00,微信红包,王五,生日红包,收入,88.88,零钱,已收钱,4200004,M1004,",
])

GENERIC_SYNONYM_CSV = (
    "日期,收支,金额(元),分类,子分类,支付方式,说明,标签\n"
    '2026-11-01,支出,23.50,餐饮,午餐,微信钱包,公司楼下快餐,工作餐|午餐\n'
    '2026/11/2,收入,8000,工资,月薪,招商银行,10月工资,"薪资,月结"\n'
)

SMART_HEADER_CSV = (
    "时间,收支,金额,说明\n"
    "2026-11-01 12:30,支出,12.5,午饭\n"
    "2026-11-02 08:00,收入,100,退款\n"
)

WEIRD_HEADER_CSV = (
    "记账日,方向,钱数,摘要\n"
    "2026-11-01,支出,12.5,午饭\n"
    "2026-11-02,收入,100,退款\n"
)

APP_JSON_CAMEL = json.dumps({
    "bills": [{
        "date": "2026-11-01 12:30:00", "amount": 12.5, "type": 1,
        "category": {"name": "餐饮"}, "subCategory": {"name": "午餐"},
        "accountName": "微信钱包", "remark": "午饭",
    }]
}, ensure_ascii=False)

APP_JSON_CN = json.dumps([
    {"日期": "2026年11月2日", "金额": "8000.00", "类型": "收入",
     "分类": "工资", "账户": "招商银行", "备注": "10月工资"},
], ensure_ascii=False)

APP_JSON_QIANJI = json.dumps({
    "records": [
        {"billDate": "2026-11-03", "money": 15.8, "billType": 2, "categoryName": "交通"},
    ]
}, ensure_ascii=False)


class TestDecodeBytes(unittest.TestCase):
    def test_utf8_bom(self):
        self.assertEqual(bi.decode_bytes("﻿你好".encode("utf-8-sig")), "﻿你好")

    def test_gbk(self):
        self.assertEqual(bi.decode_bytes("支付宝账单".encode("gbk")), "支付宝账单")

    def test_never_raise(self):
        self.assertIsInstance(bi.decode_bytes(b"\xff\xfe\x80garbage"), str)
        self.assertEqual(bi.decode_bytes(b""), "")
        self.assertEqual(bi.decode_bytes(None), "")
        self.assertEqual(bi.decode_bytes("已是文本"), "已是文本")


class TestDetectFormat(unittest.TestCase):
    def test_alipay(self):
        self.assertEqual(bi.detect_format("alipay_record.csv", ALIPAY_CSV), "alipay_csv")

    def test_wechat(self):
        self.assertEqual(bi.detect_format("wx.csv", WECHAT_CSV), "wechat_csv")

    def test_generic(self):
        self.assertEqual(bi.detect_format("t.csv", GENERIC_SYNONYM_CSV), "generic_csv")

    def test_app_json(self):
        self.assertEqual(bi.detect_format("b.json", APP_JSON_CAMEL), "app_json")
        self.assertEqual(bi.detect_format("b.txt", APP_JSON_CN), "app_json")

    def test_json_filename_disguise(self):
        # CSV 伪装成 .json：探测按文件名走 app_json，解析时进 warnings
        self.assertEqual(bi.detect_format("export.json", GENERIC_SYNONYM_CSV), "app_json")

    def test_unknown(self):
        self.assertEqual(bi.detect_format("x.txt", "hello world"), "unknown")
        self.assertEqual(bi.detect_format("x.csv", "abc,def\n1,2"), "unknown")

    def test_bom_text(self):
        self.assertEqual(bi.detect_format("t.csv", "﻿" + GENERIC_SYNONYM_CSV), "generic_csv")


class TestAlipay(unittest.TestCase):
    def setUp(self):
        self.res = bi.parse_bills("alipay_csv", ALIPAY_CSV)

    def test_basic(self):
        self.assertEqual(len(self.res["bills"]), 2)
        b0, b1 = self.res["bills"]
        self.assertEqual(b0["date"], "2026-11-01")
        self.assertEqual(b0["time"], "12:30")
        self.assertEqual(b0["type"], "expense")
        self.assertEqual(b0["amount"], 32.0)  # 金额带「元」
        self.assertEqual(b0["note"], "拿铁咖啡 星巴克")  # 商品说明 + 交易对方
        self.assertEqual(b0["accountName"], "招商银行(1234)")
        self.assertEqual(b1["type"], "income")
        self.assertEqual(b1["amount"], 8000.0)
        self.assertEqual(self.res["format"], "alipay_csv")

    def test_skips(self):
        reasons = " | ".join(s["reason"] for s in self.res["skipped"])
        self.assertEqual(len(self.res["skipped"]), 2)
        self.assertIn("不计收支", reasons)
        self.assertIn("状态：交易关闭", reasons)

    def test_gbk_roundtrip(self):
        text = bi.decode_bytes(ALIPAY_GBK_MINI.encode("gbk"))
        self.assertEqual(bi.detect_format("a.csv", text), "alipay_csv")
        res = bi.parse_bills("alipay_csv", text)
        self.assertEqual(len(res["bills"]), 1)
        self.assertEqual(res["bills"][0]["note"], "早餐 包子铺")
        self.assertEqual(res["bills"][0]["amount"], 6.0)


class TestWechat(unittest.TestCase):
    def setUp(self):
        self.res = bi.parse_bills("wechat_csv", WECHAT_CSV)

    def test_preamble_and_basic(self):
        # 前 16 行说明文字被跳过，表头定位后 4 行数据
        self.assertEqual(len(self.res["bills"]), 3)
        b0 = self.res["bills"][0]
        self.assertEqual(b0["date"], "2026-11-01")
        self.assertEqual(b0["time"], "12:30")
        self.assertEqual(b0["type"], "expense")
        self.assertEqual(b0["amount"], 32.0)  # ¥ 剥离
        self.assertEqual(b0["note"], "拿铁 星巴克")
        self.assertEqual(b0["accountName"], "零钱")

    def test_transfer(self):
        t = self.res["bills"][1]
        self.assertEqual(t["type"], "transfer")
        self.assertEqual(t["amount"], 100.0)

    def test_income_and_status_skip(self):
        self.assertEqual(self.res["bills"][2]["type"], "income")
        self.assertEqual(self.res["bills"][2]["amount"], 88.88)
        self.assertEqual(len(self.res["skipped"]), 1)
        self.assertIn("状态：支付失败", self.res["skipped"][0]["reason"])


class TestGeneric(unittest.TestCase):
    def test_synonym_headers(self):
        res = bi.parse_bills("generic_csv", GENERIC_SYNONYM_CSV)
        self.assertEqual(len(res["bills"]), 2)
        b0, b1 = res["bills"]
        self.assertEqual(b0["type"], "expense")
        self.assertEqual(b0["amount"], 23.5)
        self.assertEqual(b0["catName"], "餐饮")
        self.assertEqual(b0["subCatName"], "午餐")
        self.assertEqual(b0["accountName"], "微信钱包")
        self.assertEqual(b0["note"], "公司楼下快餐")
        self.assertEqual(b1["date"], "2026-11-02")  # 2026/11/2 归一
        self.assertEqual(b1["type"], "income")
        self.assertEqual(b1["amount"], 8000.0)

    def test_tags_multi(self):
        res = bi.parse_bills("generic_csv", GENERIC_SYNONYM_CSV)
        self.assertEqual(res["bills"][0]["tags"], "工作餐|午餐")  # | 分隔
        self.assertEqual(res["bills"][1]["tags"], "薪资|月结")  # 引号内逗号分隔

    def test_smart_header_synonym(self):
        res = bi.parse_bills("generic_csv", SMART_HEADER_CSV)
        self.assertEqual(len(res["bills"]), 2)
        self.assertEqual(res["bills"][0]["time"], "12:30")
        self.assertEqual(res["bills"][0]["type"], "expense")
        self.assertEqual(res["bills"][1]["type"], "income")

    def test_value_guess(self):
        # 完全非标准表头：按数据值猜日期/金额列
        res = bi.parse_bills("generic_csv", WEIRD_HEADER_CSV)
        self.assertEqual(len(res["bills"]), 2)
        self.assertEqual(res["bills"][0]["date"], "2026-11-01")
        self.assertEqual(res["bills"][0]["amount"], 12.5)
        self.assertEqual(res["bills"][0]["note"], "午饭")
        self.assertEqual(res["bills"][1]["type"], "income")

    def test_no_mapping_warning(self):
        res = bi.parse_bills("generic_csv", "a,b,c\nx,y,z\n")
        self.assertEqual(res["bills"], [])
        self.assertTrue(any("建议下载模板" in w for w in res["warnings"]))


class TestExportColumns(unittest.TestCase):
    """乙2 导出往返配套列：独立时间列 + 关联词条/美食 ID 列（不认识就忽略，不报错）。"""

    def test_time_and_link_columns_roundtrip(self):
        """「日期/时间」并存时时间列不再被 first-wins 丢弃；关联 id 列恢复 itemId/foodId。"""
        csv_text = (
            "日期,时间,类型,金额,备注,关联词条ID,关联美食ID\n"
            "2026-11-01,23:30,支出,23.5,晚饭,it_9,fd_9\n"
            "2026-11-02,,支出,5,水,,\n"
        )
        res = bi.parse_bills("generic_csv", csv_text)
        self.assertEqual(len(res["bills"]), 2, res)
        b0, b1 = res["bills"]
        self.assertEqual(b0["date"], "2026-11-01")
        self.assertEqual(b0["time"], "23:30")  # 时间列保留（b.time）
        self.assertEqual(b0["itemId"], "it_9")
        self.assertEqual(b0["foodId"], "fd_9")
        self.assertEqual(b1["date"], "2026-11-02")
        self.assertEqual(b1["time"], "")
        self.assertNotIn("itemId", b1)  # 空值不造字段
        self.assertNotIn("foodId", b1)
        self.assertEqual(res["warnings"], [])  # 不认识就忽略，不报错

    def test_time_column_same_as_date_no_override(self):
        """单一「时间」列同时被猜成日期列时（组合串）不覆盖时刻，与旧行为一致。"""
        res = bi.parse_bills("generic_csv", SMART_HEADER_CSV)
        self.assertEqual(res["bills"][0]["time"], "12:30")
        self.assertEqual(res["bills"][1]["time"], "08:00")


class TestAppJson(unittest.TestCase):
    def test_camel_case_nested_category(self):
        res = bi.parse_bills("app_json", APP_JSON_CAMEL)
        self.assertEqual(len(res["bills"]), 1)
        b = res["bills"][0]
        self.assertEqual(b["type"], "expense")  # 数字 1 = 支出
        self.assertEqual(b["amount"], 12.5)
        self.assertEqual(b["date"], "2026-11-01")
        self.assertEqual(b["time"], "12:30")
        self.assertEqual(b["catName"], "餐饮")  # category 对象取 name
        self.assertEqual(b["subCatName"], "午餐")
        self.assertEqual(b["accountName"], "微信钱包")
        self.assertEqual(b["note"], "午饭")
        self.assertTrue(any("1=支出" in w for w in res["warnings"]))  # 约定注明

    def test_chinese_keys(self):
        res = bi.parse_bills("app_json", APP_JSON_CN)
        self.assertEqual(len(res["bills"]), 1)
        b = res["bills"][0]
        self.assertEqual(b["date"], "2026-11-02")  # 2026年11月2日
        self.assertEqual(b["type"], "income")
        self.assertEqual(b["amount"], 8000.0)
        self.assertEqual(b["catName"], "工资")
        self.assertEqual(b["accountName"], "招商银行")
        self.assertEqual(b["note"], "10月工资")

    def test_snake_case_records(self):
        res = bi.parse_bills("app_json", APP_JSON_QIANJI)
        self.assertEqual(len(res["bills"]), 1)
        self.assertEqual(res["bills"][0]["type"], "income")  # billType 2 = 收入
        self.assertEqual(res["bills"][0]["amount"], 15.8)
        self.assertEqual(res["bills"][0]["catName"], "交通")


class TestImportPlan(unittest.TestCase):
    def setUp(self):
        self.existing = [
            {"date": "2026-11-01", "amount": 12.5, "type": "expense", "note": "午饭", "accountName": "现金"},
            {"date": "2026-11-02", "amount": 100.0, "type": "income", "note": "", "accountName": "现金"},
        ]

    def test_exact_dup(self):
        plan = bi.build_import_plan(
            [{"date": "2026-11-01", "amount": 12.5, "type": "expense", "note": "午饭", "accountName": "现金"}],
            self.existing)
        self.assertEqual(len(plan["rows"]), 0)
        self.assertEqual(len(plan["duplicates"]), 1)
        d = plan["duplicates"][0]
        self.assertTrue(d["dup"])
        self.assertEqual(d["matchNote"], "午饭")

    def test_note_whitespace_and_empty_match(self):
        bills = [
            {"date": "2026-11-01", "amount": 12.5, "type": "expense", "note": " 午 饭 ", "accountName": "现金"},
            {"date": "2026-11-02", "amount": 100.0, "type": "income", "note": "红包", "accountName": "现金"},
        ]
        plan = bi.build_import_plan(bills, self.existing)
        self.assertEqual(len(plan["duplicates"]), 2)  # 去空白相同 + 空备注匹配
        self.assertEqual(plan["duplicates"][1]["matchNote"], "")

    def test_different_day_not_dup(self):
        plan = bi.build_import_plan(
            [{"date": "2026-11-03", "amount": 12.5, "type": "expense", "note": "午饭", "accountName": "现金"}],
            self.existing)
        self.assertEqual(len(plan["rows"]), 1)
        self.assertEqual(len(plan["duplicates"]), 0)
        self.assertFalse(plan["rows"][0]["dup"])

    def test_amount_type_diff_not_dup(self):
        bills = [
            {"date": "2026-11-01", "amount": 12.5, "type": "income", "note": "午饭", "accountName": "现金"},
            {"date": "2026-11-01", "amount": 12.6, "type": "expense", "note": "午饭", "accountName": "现金"},
        ]
        plan = bi.build_import_plan(bills, self.existing)
        self.assertEqual(len(plan["rows"]), 2)


class TestTemplate(unittest.TestCase):
    def test_bom_and_columns(self):
        t = bi.build_template_csv()
        self.assertTrue(t.startswith("﻿"))
        self.assertEqual(t.lstrip("﻿").splitlines()[0].split(","),
                         ["日期", "类型", "金额", "一级分类", "二级分类", "账户", "备注", "标签"])

    def test_self_parseable(self):
        t = bi.build_template_csv()
        res = bi.parse_bills("generic_csv", t)
        self.assertEqual(len(res["bills"]), 2)
        self.assertEqual(res["bills"][0]["type"], "expense")
        self.assertEqual(res["bills"][1]["type"], "income")
        self.assertEqual(res["bills"][0]["amount"], 23.5)


class TestEdge(unittest.TestCase):
    def test_empty_text(self):
        for fmt in bi.SUPPORTED_FORMATS:
            res = bi.parse_bills(fmt, "")
            self.assertEqual(res["bills"], [])
            self.assertEqual(res["format"], fmt)

    def test_half_row(self):
        res = bi.parse_bills("alipay_csv", "交易时间,金额\n2026-11-01")
        self.assertEqual(res["bills"], [])
        self.assertTrue(res["skipped"])

    def test_garbage_no_raise(self):
        res = bi.parse_bills("unknown", "\x00��###,,,")
        self.assertIsInstance(res["bills"], list)
        res2 = bi.parse_bills("app_json", "{invalid")
        self.assertEqual(res2["bills"], [])
        self.assertTrue(any("JSON 解析失败" in w for w in res2["warnings"]))

    def test_bad_date_and_amount(self):
        res = bi.parse_bills("generic_csv", "日期,类型,金额\n2026-13-40,支出,1\nxxxx,支出,1\n2026-11-01,支出,abc\n")
        self.assertEqual(res["bills"], [])
        self.assertEqual(len(res["skipped"]), 3)

    def test_unknown_falls_back_to_generic(self):
        res = bi.parse_bills("unknown", GENERIC_SYNONYM_CSV)
        self.assertEqual(res["format"], "unknown")
        self.assertEqual(len(res["bills"]), 2)

    def test_bad_format_name(self):
        res = bi.parse_bills("nonsense", "x")
        self.assertEqual(res["format"], "unknown")

    def test_negative_amount_flips_type(self):
        res = bi.parse_bills("generic_csv", "日期,类型,金额,备注\n2026-11-01,支出,-8.00,退款\n")
        self.assertEqual(res["bills"][0]["type"], "income")
        self.assertEqual(res["bills"][0]["amount"], 8.0)
        self.assertTrue(any("转正" in w for w in res["warnings"]))


class TestImportPlanFileDups(unittest.TestCase):
    """去重：已有账单命中 + 文件内互查（后出现者判重）。"""

    @staticmethod
    def _bill(note="", date="2026-11-01", amount=12.5, t="expense"):
        return {"date": date, "amount": amount, "type": t, "note": note}

    def test_in_file_dup_marked(self):
        bills = [self._bill("午饭"), self._bill("午饭"), self._bill("午饭")]
        plan = bi.build_import_plan(bills, [])
        self.assertEqual(len(plan["rows"]), 1)
        self.assertEqual(plan["dups"], 2)
        self.assertEqual([b["dup"] for b in plan["bills"]], [False, True, True])
        self.assertEqual(plan["bills"][0]["matchNote"], "")
        self.assertEqual(plan["bills"][1]["matchNote"], "文件内重复")

    def test_in_file_note_normalize(self):
        # 备注去空白归一后相同也算文件内重复
        plan = bi.build_import_plan([self._bill(" 午 饭 "), self._bill("午饭")], [])
        self.assertEqual(plan["dups"], 1)

    def test_in_file_diff_note_not_dup(self):
        plan = bi.build_import_plan([self._bill("午饭"), self._bill("晚饭")], [])
        self.assertEqual(plan["dups"], 0)
        self.assertEqual(len(plan["rows"]), 2)

    def test_existing_dup_match_note(self):
        existing = [self._bill("午饭")]
        plan = bi.build_import_plan([self._bill("午饭"), self._bill("午饭")], existing)
        self.assertEqual(plan["dups"], 2)
        self.assertEqual(plan["bills"][0]["matchNote"], "午饭")  # 命中已有账单的备注
        self.assertEqual(plan["bills"][1]["matchNote"], "午饭")

    def test_order_preserved_and_dup_flag(self):
        plan = bi.build_import_plan([self._bill("a"), self._bill("a"), self._bill("b")], [])
        self.assertEqual([b["note"] for b in plan["bills"]], ["a", "a", "b"])
        self.assertEqual([b["dup"] for b in plan["bills"]], [False, True, False])
        self.assertTrue(all("matchNote" in b for b in plan["bills"]))

    def test_parse_pipeline_marks_dups(self):
        # 模拟 /api/import/parse：解析 → build_import_plan（含文件内互查）
        res = bi.parse_bills("generic_csv", GENERIC_SYNONYM_CSV)
        plan = bi.build_import_plan(res["bills"] + [dict(res["bills"][0])], [])
        self.assertEqual(plan["dups"], 1)  # 第二份「公司楼下快餐」互重
        self.assertEqual(plan["bills"][0]["dup"], False)
        self.assertEqual(plan["bills"][2]["dup"], True)


class TestNonFiniteAmount(unittest.TestCase):
    """NaN/Inf 金额：跳过该行进 skipped 注明原因，出口金额全部有限。"""

    def test_nan_inf_rows_skipped(self):
        res = bi.parse_bills("generic_csv",
                             "日期,类型,金额,备注\n"
                             "2026-11-01,支出,nan,坏行\n"
                             "2026-11-02,支出,inf,坏行\n"
                             "2026-11-03,支出,3.5,好行\n")
        self.assertEqual(len(res["bills"]), 1)
        self.assertEqual(res["bills"][0]["amount"], 3.5)
        self.assertEqual(len(res["skipped"]), 2)
        reasons = " | ".join(s["reason"] for s in res["skipped"])
        self.assertIn("NaN/Inf", reasons)

    def test_json_nan_skipped(self):
        res = bi.parse_bills("app_json",
                             '[{"date":"2026-11-01","amount":NaN,"type":"expense","remark":"坏"}]')
        self.assertEqual(res["bills"], [])
        self.assertTrue(any("NaN/Inf" in s["reason"] for s in res["skipped"]))

    def test_amounts_json_safe(self):
        res = bi.parse_bills("generic_csv",
                             "日期,类型,金额\n2026-11-01,支出,nan\n2026-11-02,支出,1.5\n")
        json.dumps(res, ensure_ascii=False, allow_nan=False)  # 抛异常即有 NaN/Inf 泄漏
        self.assertTrue(all(math.isfinite(b["amount"]) for b in res["bills"]))

    def test_norm_amount_rejects_non_finite(self):
        for v in ("nan", "inf", "-inf", "Infinity", float("nan"), float("inf")):
            self.assertEqual(bi._norm_amount(v), (None, False), v)


class TestGuessCategory(unittest.TestCase):
    """分类自动归类映射：命中/最长关键词/未命中回退。"""

    def test_hit(self):
        self.assertEqual(bi.guess_category("打车去机场"), ("出行交通", "打车"))
        self.assertEqual(bi.guess_category("早上买了包子"), ("食品餐饮", "早餐"))
        self.assertEqual(bi.guess_category("公司楼下快餐"), ("食品餐饮", "午餐"))
        self.assertEqual(bi.guess_category("医院挂号"), ("健康医疗", "医院"))
        self.assertEqual(bi.guess_category("10月工资到账"), ("工资", ""))

    def test_longest_keyword_wins(self):
        # 「话费充值」(4字) 压过「话费」(2字)/「充值」(2字)
        self.assertEqual(bi.guess_category("话费充值50"), ("购物消费", "虚拟充值"))
        self.assertEqual(bi.guess_category("交话费"), ("居家生活", "话费宽带"))

    def test_miss_keeps_original(self):
        self.assertEqual(bi.guess_category("随便看看"), ("", ""))
        self.assertEqual(bi.guess_category("随便看看", "原分类"), ("原分类", ""))

    def test_case_insensitive(self):
        self.assertEqual(bi.guess_category("zara 买裙子"), ("购物消费", "服饰运动"))


class TestCatGuessOnParse(unittest.TestCase):
    """归类结果作为 parse 输出默认值：仅当原分类为空时填。"""

    def test_empty_cat_filled(self):
        res = bi.parse_bills("generic_csv", "日期,类型,金额,备注\n2026-11-01,支出,12.5,打车去机场\n")
        b = res["bills"][0]
        self.assertEqual(b["catName"], "出行交通")
        self.assertEqual(b["subCatName"], "打车")

    def test_existing_cat_kept(self):
        res = bi.parse_bills("generic_csv",
                             "日期,类型,金额,分类,备注\n2026-11-01,支出,12.5,餐饮,打车去机场\n")
        b = res["bills"][0]
        self.assertEqual(b["catName"], "餐饮")  # 原分类非空不覆盖
        self.assertEqual(b["subCatName"], "")

    def test_no_hit_untouched(self):
        res = bi.parse_bills("generic_csv", "日期,类型,金额,备注\n2026-11-01,支出,12.5,随便看看\n")
        self.assertEqual(res["bills"][0]["catName"], "")


class TestPastedText(unittest.TestCase):
    """多行粘贴文本：宽松解析，缺日期用今天。"""

    TEXT = "2026-11-01 支出 23.5 午饭\n2026-11-02 收入 8000 工资"

    def test_detect_multiline(self):
        self.assertEqual(bi.detect_format("粘贴.txt", self.TEXT), "pasted_text")

    def test_detect_single_line(self):
        self.assertEqual(bi.detect_format("", "午饭 23.5"), "pasted_text")

    def test_in_supported_formats(self):
        self.assertIn("pasted_text", bi.SUPPORTED_FORMATS)

    def test_parse_multiline(self):
        res = bi.parse_bills("pasted_text", self.TEXT)
        self.assertEqual(res["format"], "pasted_text")
        self.assertEqual(len(res["bills"]), 2)
        b0, b1 = res["bills"]
        self.assertEqual(b0["date"], "2026-11-01")
        self.assertEqual(b0["type"], "expense")
        self.assertEqual(b0["amount"], 23.5)
        self.assertEqual(b0["note"], "午饭")
        self.assertEqual(b1["type"], "income")
        self.assertEqual(b1["amount"], 8000.0)
        self.assertEqual(b1["note"], "工资")

    def test_missing_date_defaults_today(self):
        res = bi.parse_bills("pasted_text", "晚饭 30")
        b = res["bills"][0]
        self.assertEqual(b["date"], date.today().strftime("%Y-%m-%d"))
        self.assertEqual(b["type"], "expense")
        self.assertEqual(b["amount"], 30.0)
        self.assertEqual(b["note"], "晚饭")
        self.assertEqual(b["catName"], "食品餐饮")  # 归类联动

    def test_time_and_type(self):
        res = bi.parse_bills("pasted_text", "2026-11-01 12:30 转账 500 零钱转存")
        b = res["bills"][0]
        self.assertEqual(b["date"], "2026-11-01")
        self.assertEqual(b["time"], "12:30")
        self.assertEqual(b["type"], "transfer")
        self.assertEqual(b["amount"], 500.0)
        self.assertEqual(b["note"], "零钱转存")

    def test_unparseable_line_skipped(self):
        res = bi.parse_bills("pasted_text", "2026-11-01 支出 23.5 午饭\n这一行没有金额")
        self.assertEqual(len(res["bills"]), 1)
        self.assertEqual(len(res["skipped"]), 1)
        self.assertIn("缺金额", res["skipped"][0]["reason"])

    def test_bad_date_shape_skipped(self):
        res = bi.parse_bills("pasted_text", "2026-13-40 支出 23.5 午饭")
        self.assertEqual(res["bills"], [])
        self.assertIn("日期无效", res["skipped"][0]["reason"])

    def test_amount_token_strict(self):
        # 「1,2」不是合法千分位金额，不能被当成 12（防 CSV 残行误判）
        self.assertIsNone(bi._pasted_amount("1,2"))
        self.assertEqual(bi._pasted_amount("1,234.56"), 1234.56)
        self.assertEqual(bi._pasted_amount("¥23.5元"), 23.5)


class TestParseAny(unittest.TestCase):
    """parse_any 入口：bytes 先 decode_bytes，str 原样；fmt_hint 可传格式名或文件名。"""

    def test_bytes_gbk(self):
        out = bi.parse_any("alipay_record.csv", ALIPAY_GBK_MINI.encode("gbk"))
        self.assertEqual(out["format"], "alipay_csv")
        self.assertEqual(len(out["bills"]), 1)
        self.assertEqual(out["bills"][0]["note"], "早餐 包子铺")

    def test_bytearray(self):
        out = bi.parse_any("generic_csv", bytearray(GENERIC_SYNONYM_CSV.encode("utf-8")))
        self.assertEqual(len(out["bills"]), 2)

    def test_str_passthrough(self):
        out = bi.parse_any("generic_csv", GENERIC_SYNONYM_CSV)  # fmt 名直用
        self.assertEqual(out["format"], "generic_csv")
        self.assertEqual(len(out["bills"]), 2)

    def test_fmt_hint_filename(self):
        out = bi.parse_any("wx.csv", WECHAT_CSV)
        self.assertEqual(out["format"], "wechat_csv")

    def test_none_input(self):
        out = bi.parse_any("x.csv", None)
        self.assertEqual(out["bills"], [])


class TestSuspectEncoding(unittest.TestCase):
    """已乱码文本（含替换符）：suspect_encoding 标记 + GBK 提示。"""

    def test_mojibake_flagged(self):
        text = "日期,类型,金额,备注\n2026-11-01,支出,12.5,午饭��\n"
        res = bi.parse_bills("generic_csv", text)
        self.assertTrue(res.get("suspect_encoding"))
        self.assertTrue(any("GBK" in w for w in res["warnings"]))

    def test_parse_any_mojibake_flagged(self):
        out = bi.parse_any("a.csv", "日期,类型,金额,备注\n2026-11-01,支出,12.5,午饭��\n")
        self.assertTrue(out.get("suspect_encoding"))
        self.assertTrue(any("GBK" in w for w in out["warnings"]))

    def test_clean_text_not_flagged(self):
        res = bi.parse_bills("generic_csv", GENERIC_SYNONYM_CSV)
        self.assertNotIn("suspect_encoding", res)
        self.assertFalse(any("GBK" in w for w in res["warnings"]))

    def test_gbk_bytes_clean_not_flagged(self):
        # 真 GBK 字节流经 decode_bytes 正确解码 → 不误报
        out = bi.parse_any("a.csv", ALIPAY_GBK_MINI.encode("gbk"))
        self.assertNotIn("suspect_encoding", out)


class TestNameFields(unittest.TestCase):
    """accountName/toAccountName/tagsName 字段直出（导入数据自带名称）。"""

    def test_generic_to_account_and_tags_names(self):
        csv_text = (
            "日期,类型,金额,账户,转入账户,标签,备注\n"
            "2026-11-01,转账,500,微信钱包,招商银行,搬家|生活,转存\n"
        )
        res = bi.parse_bills("generic_csv", csv_text)
        b = res["bills"][0]
        self.assertEqual(b["accountName"], "微信钱包")
        self.assertEqual(b["toAccountName"], "招商银行")
        self.assertEqual(b["tagsName"], ["搬家", "生活"])
        self.assertEqual(b["tags"], "搬家|生活")  # 旧字段保留

    def test_json_name_fields(self):
        rec = json.dumps({"bills": [{
            "date": "2026-11-01", "amount": 500, "type": "transfer",
            "accountName": "微信", "toAccountName": "银行卡",
            "tagsName": ["搬家", "生活"], "remark": "转存",
        }]}, ensure_ascii=False)
        res = bi.parse_bills("app_json", rec)
        b = res["bills"][0]
        self.assertEqual(b["accountName"], "微信")
        self.assertEqual(b["toAccountName"], "银行卡")
        self.assertEqual(b["tagsName"], ["搬家", "生活"])

    def test_generic_no_to_account_field_when_missing(self):
        res = bi.parse_bills("generic_csv", GENERIC_SYNONYM_CSV)
        self.assertNotIn("toAccountName", res["bills"][0])
        self.assertEqual(res["bills"][0]["tagsName"], ["工作餐", "午餐"])


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
    print("========== bill-import：%d 项全部通过 ==========" % n)


if __name__ == "__main__":
    _run_all()
