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
