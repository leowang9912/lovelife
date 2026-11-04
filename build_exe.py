# -*- coding: utf-8 -*-
"""build_exe.py — 构建 lovelife-server.exe（带版本资源，降低杀软误报）

用法：python build_exe.py
产出：build-exe/lovelife-server.exe → 拷贝到项目根目录
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "build-exe")

cmd = [
    sys.executable, "-m", "PyInstaller",
    "--onefile", "--noconsole",
    "--name", "lovelife-server",
    "--version-file", os.path.join(ROOT, "exe-version-info.txt"),
    # DLL 释放到安装目录下 runtime\（而非 %TEMP%\_MEI）：
    # 避开杀软临时目录扫描/清理工具的干扰，消除 python313.dll 偶发加载失败弹窗（v1.0.9）
    "--runtime-tmpdir", "runtime",
    "--distpath", DIST,
    "-y",
    os.path.join(ROOT, "app", "serve.py"),
]
print("building:", " ".join(cmd[3:]))
subprocess.run(cmd, check=True, cwd=ROOT)

src = os.path.join(DIST, "lovelife-server.exe")
dst = os.path.join(ROOT, "lovelife-server.exe")
shutil.copy2(src, dst)
print("OK lovelife-server.exe -> %s (%.1f MB)" % (dst, os.path.getsize(dst) / 1048576))
