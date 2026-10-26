# -*- coding: utf-8 -*-
"""release.py — 打包发布 zip（上传到 GitHub Release）

用法：
  python release.py            # 打包 dist/lovelife-v<version>-win64.zip
  python release.py 1.1.0      # 指定版本号（同步写入 version.json）

zip 内容 = app 全套 + bat + exe + README/LICENSE/version.json
不含 data（个人数据永不打包）。
"""
import json
import os
import re
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")
VERSION_FILE = os.path.join(ROOT, "version.json")

INCLUDE = ["app", "lovelife.bat", "lovelife-server.exe", "README.md", "LICENSE", "CHANGELOG.md", "version.json"]
EXCLUDE_DIRS = {"__pycache__", ".browser-profile", "update-staging"}


def read_version():
    with open(VERSION_FILE, encoding="utf-8") as f:
        return json.load(f)


def write_version(manifest):
    with open(VERSION_FILE, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)


def iter_files(base, rel=""):
    full = os.path.join(base, rel) if rel else base
    for name in sorted(os.listdir(full)):
        if name in EXCLUDE_DIRS or name.startswith("."):
            continue
        path = os.path.join(full, name)
        r = os.path.join(rel, name) if rel else name
        if os.path.isdir(path):
            yield from iter_files(base, r)
        else:
            yield r, path


def main():
    manifest = read_version()
    if len(sys.argv) > 1:
        new_ver = sys.argv[1].lstrip("v")
        if not re.match(r"^\d+\.\d+\.\d+$", new_ver):
            print("版本号需符合 x.y.z，如 1.1.0")
            sys.exit(1)
        old = manifest.get("version")
        manifest["version"] = new_ver
        # 同步下载地址中的版本号
        for k, v in list((manifest.get("assets") or {}).items()):
            manifest["assets"][k] = re.sub(r"v\d+\.\d+\.\d+", "v" + new_ver, v)
        write_version(manifest)
        print("version.json: %s -> %s" % (old, new_ver))

    ver = manifest["version"]
    os.makedirs(DIST, exist_ok=True)
    out_name = "lovelife-v%s-win64.zip" % ver
    out_path = os.path.join(DIST, out_name)

    missing = [n for n in INCLUDE if not os.path.exists(os.path.join(ROOT, n))]
    if missing:
        print("缺少文件:", missing)
        sys.exit(1)

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for name in INCLUDE:
            full = os.path.join(ROOT, name)
            if os.path.isfile(full):
                z.write(full, os.path.join("lovelife", name))
            else:
                for rel, path in iter_files(full, ""):
                    z.write(path, os.path.join("lovelife", name, rel.replace("\\", "/")))
    size_mb = os.path.getsize(out_path) / 1024 / 1024
    print("打包完成: %s (%.1f MB)" % (out_path, size_mb))
    print()
    print("下一步：")
    print("  1. 登录 GitHub 创建公开仓库 lovelife")
    print("  2. 把 version.json 里的 OWNER 替换为你的 GitHub 用户名")
    print("  3. 本地 git push 推送源码")
    print("  4. 创建 Release tag v%s，上传 %s" % (ver, out_name))


if __name__ == "__main__":
    main()
