# -*- coding: utf-8 -*-
"""make_bat.py: find → findstr（GNU find 抢占 PATH 的坑）"""
import io

P = r"D:\lovelife\tests\make_bat.py"
s = io.open(P, encoding="utf-8").read()
old = 'netstat -ano | find ":8765 " | find "LISTENING" >nul 2>&1'
new = 'netstat -ano | findstr /c:":8765 " | findstr /c:"LISTENING" >nul 2>&1'
n = s.count(old)
s = s.replace(old, new)
io.open(P, "w", encoding="utf-8", newline="").write(s)
print("replaced", n)
