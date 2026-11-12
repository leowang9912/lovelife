# -*- coding: utf-8 -*-
"""v118-update-cmd.test.py — v1.1.5 更新重启强化 + 窗口尺寸记忆链路 回归锁：
   1) updater.cmd 生成内容断言：替换/清残留/自删除 + 重启走 lovelife.bat 标准入口
      （updater 不得自行拉 exe——自行 RESTART 是 Fatal error 弹窗叠罗汉的主源）
   2) 启动防叠窗归 bat：TMP/TEMP 兜底、杀僵尸重试 3 轮、端口校验、中文报错引导
   3) _stage_and_install 真接 _updater_cmd_lines（生成内容=测试内容，杜绝两张皮）
   4) window-size 记忆链路：POST→txt"WxH"→GET 读回 + 启动脚本解析格式一致
   5) window-size 边界：低于 1024x700 拒绝、超大钳制 10000、坏 body 400
"""
import io, json, os, re, sys, tempfile, time

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app'))
import serve

# ---------- 输出/失败统一（PASS n. 名 / FAIL n. 名: 原因） ----------
_CUR = {"n": 0, "name": ""}


def case(n, name):
    _CUR["n"], _CUR["name"] = n, name


def ok(n):
    print("PASS %d. %s" % (n, _CUR["name"]))


def _fail_hook(tp, val, tb):
    print("FAIL %d. %s: %s" % (_CUR["n"], _CUR["name"], val))
    sys.exit(1)


sys.excepthook = _fail_hook

orig_root = serve.ROOT
root = tempfile.mkdtemp()
serve.ROOT = root

try:
    # ---------- 1) updater.cmd 生成内容断言 ----------
    case(1, "updater.cmd 生成内容：替换/清残留/自删除 + 重启走 lovelife.bat 标准入口（防弹窗叠罗汉）")
    lines = serve._updater_cmd_lines()
    text = "\n".join(lines)
    assert 'if not exist "runtime" mkdir "runtime"' in text, "缺 runtime 目录创建"
    assert 'taskkill /f /im lovelife-server.exe' in text, "缺杀旧进程"
    assert ':WAITDEAD' in text, "必须等旧进程真死再替换文件"
    assert 'robocopy "update-staging\\app" "app" /E /PURGE' in text, "缺 app 目录替换"
    assert 'copy /y "update-staging\\version.json" "version.json"' in text, "缺 version.json 替换"
    assert 'del /q "%~f0"' in text, "updater.cmd 用完必须自删除"
    # v1.1.7 完全关闭旧软件后重新打开：重启走 lovelife.bat 标准入口（完整性检查/
    # 杀僵尸重试/开新窗都在 bat）。updater 不得自行拉 exe——自行 RESTART 是
    # Fatal error 弹窗叠罗汉的主源（v1.1.6 更新后 5 连弹事故）
    assert 'start "" "%~dp0lovelife.bat"' in text, "重启必须调 lovelife.bat 标准入口"
    assert 'start "" "%~dp0lovelife-server.exe"' not in text, "updater 不得自行拉 exe"
    assert ':RESTART' not in text and ':RPOLL' not in text, "自行重启/轮询逻辑应已删除（启动归 bat）"
    assert text.index('rd /s /q') < text.index('start "" "%~dp0lovelife.bat"'), "必须先清 _MEI 残留再调 bat"
    ok(1)

    # ---------- 2) 启动防叠窗归 bat（v1.1.7：更新重启与手动双击同一条链路） ----------
    case(2, "启动防叠窗归 bat：TMP/TEMP 兜底 + 杀僵尸重试 3 轮 + 端口校验 + 中文报错")
    # Fatal error 弹框进程挂起不死，盲目重启会叠出多个弹窗（v1.1.6 五连弹事故）——
    # 防叠窗职责全在 bat：杀僵尸再重试、上限 3 轮、失败有中文引导
    bat_raw = io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lovelife.bat'),
                      encoding='latin1').read()
    bat = bat_raw.encode('latin1').decode('gbk')
    assert 'set "TMP=%~dp0runtime"' in bat and 'set "TEMP=%~dp0runtime"' in bat, \
        "bat 必须 TMP/TEMP 兜底到安装目录"
    assert bat.count('taskkill /f /im lovelife-server.exe') >= 2, "bat 启动链路必须杀僵尸（重试前/报错前）"
    assert ':LAUNCH' in bat and ':CHECK_ALIVE' in bat and ':RETRY' in bat, "bat 必须有启动重试循环"
    assert 'GTR 3 goto ERR_START_FAIL' in bat, "bat 启动重试上限 3 轮"
    assert 'findstr /c:":8765 "' in bat, "bat 就绪校验必须查 8765 端口"
    assert 'ERR_START_FAIL' in bat and '常见原因与解决办法' in bat, "启动失败必须有中文报错引导"
    ok(2)

    # ---------- 3) 生成器真实接线 ----------
    case(3, "_stage_and_install 生成 updater.cmd 真用 _updater_cmd_lines")
    src = io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'serve.py'),
                  encoding='utf-8').read()
    assert 'bat_lines = _updater_cmd_lines()' in src, "_stage_and_install 必须复用 _updater_cmd_lines"
    assert '"\\r\\n".join(bat_lines)' in src, "updater.cmd 必须按 CRLF 写出（LF-only cmd 解析不了）"
    assert '"\\n".join' not in src.split('def _stage_and_install')[1].split('def _cleanup')[0], \
        "_stage_and_install 内不得再出现 LF 拼接"
    ok(3)

    # ---------- 4) window-size 记忆链路：POST→txt→GET + bat 解析一致 ----------
    case(4, "window-size 链路：POST→window-size.txt(WxH)→GET 读回 + bat 解析格式一致")

    def stub(method, body=b''):
        class S(object):
            command = method

            def _json(self, obj, code=200):
                self.resp = (code, obj)
                return self.resp

            def _read_body(self):
                return body
        return S()

    s = stub('POST', json.dumps({'width': 1680, 'height': 1050}).encode())
    code, obj = serve.Handler._handle_window_size(s)
    assert code == 200 and obj.get('ok'), 'POST 保存失败: %r' % (obj,)
    ws = os.path.join(root, 'window-size.txt')
    with open(ws, encoding='ascii') as f:
        v = f.read().strip()
    assert v == '1680x1050', '落盘格式应为 WxH，实为 %r' % v
    s = stub('GET')
    code, obj = serve.Handler._handle_window_size(s)
    assert obj['width'] == 1680 and obj['height'] == 1050, 'GET 读回错: %r' % (obj,)
    bat = io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lovelife.bat'),
                  encoding='latin1').read()
    assert 'window-size.txt' in bat and 'delims=x' in bat, 'bat 必须按 x 分隔解析 WxH'
    assert '--window-size=%WW%,%WH%' in bat, 'bat 必须把记忆尺寸传给 --window-size'
    ok(4)

    # ---------- 5) window-size 边界 ----------
    case(5, "window-size 边界：低于 1024x700 拒绝 / 超大钳 10000 / 坏 body 400")
    s = stub('POST', json.dumps({'width': 800, 'height': 500}).encode())
    code, obj = serve.Handler._handle_window_size(s)
    assert code == 400, '低于最小应 400 拒绝，实为 %s' % code
    with open(ws, encoding='ascii') as f:
        assert f.read().strip() == '1680x1050', '拒绝后不得覆盖已存尺寸'
    s = stub('POST', json.dumps({'width': 20000, 'height': 9000}).encode())
    code, obj = serve.Handler._handle_window_size(s)
    assert code == 200 and obj.get('ok'), '超大尺寸应钳制保存，实为 %r' % (obj,)
    with open(ws, encoding='ascii') as f:
        got = f.read().strip()
    assert got == '10000x9000', '超大应钳到 10000，实为 %r' % got
    s = stub('POST', b'not-json')
    code, obj = serve.Handler._handle_window_size(s)
    assert code == 400, '坏 body 应 400'
    ok(5)

    serve.ROOT = orig_root
    print("========== v1.1.5 更新重启强化 + 窗口尺寸链路：5 项全部通过 ==========")
finally:
    serve.ROOT = orig_root
