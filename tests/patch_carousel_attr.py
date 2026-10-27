# -*- coding: utf-8 -*-
"""data-carousel JSON 内单引号会破 HTML 属性 → 实体编码"""
import io

OLD = "JSON.stringify(imgs) + '\\'>' +"
NEW = "JSON.stringify(imgs).replace(/'/g, '&#39;') + '\\'>' +"

for p in (r"D:\lovelife\app\js\views-main.js", r"D:\lovelife\app\js\views-food.js"):
    s = io.open(p, encoding="utf-8").read()
    n = s.count(OLD)
    s = s.replace(OLD, NEW)
    io.open(p, "w", encoding="utf-8", newline="").write(s)
    print(p, "replaced", n)
