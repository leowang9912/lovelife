# -*- coding: utf-8 -*-
"""检查 _stage_and_install 中 bat 行的反斜杠转义是否正确（\a \v 等会被 Python 吃掉）"""
src = open(r"D:\lovelife\app\serve.py", encoding="utf-8").read().splitlines()
for i, l in enumerate(src, 1):
    if "update-staging" in l and ("if exist" in l or "robocopy" in l or "copy" in l):
        print(i, repr(l.strip()[:100]))
print()
print("python 解释后实际写入 bat 的内容:")
print(repr("update-staging\app"))
print(repr("update-staging\version.json"))
print(repr("update-staging\lovelife-server.exe"))
