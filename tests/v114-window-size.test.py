# -*- coding: utf-8 -*-
"""v114-window-size.test.py — v1.1.4 窗口尺寸记忆（服务端 /api/window-size）"""
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import os, importlib.util, json

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app'))
spec = importlib.util.spec_from_file_location('serve', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'serve.py'))
serve = importlib.util.module_from_spec(spec)
spec.loader.exec_module(serve)

WS = os.path.join(serve.ROOT, 'window-size.txt')

def case(n, name):
    print('PASS %d. %s' % (n, name))

def stub(method, body=b''):
    class S(object):
        command = method
        def _json(self, obj, code=200):
            self.resp = (code, obj)
            return self.resp
        def _read_body(self):
            return body
    return S()

def cleanup():
    if os.path.exists(WS):
        os.remove(WS)

cleanup()
try:
    # 1 无记忆文件 → 默认 1480x940
    s = stub('GET')
    code, obj = serve.Handler._handle_window_size(s)
    assert code == 200 and obj['width'] == 1480 and obj['height'] == 940, '默认尺寸错: %s' % obj
    case(1, '无记忆文件返回默认 1480x940')

    # 2 POST 保存 → 文件写 "WxH"
    s = stub('POST', json.dumps({'width': 1600, 'height': 1000}).encode())
    code, obj = serve.Handler._handle_window_size(s)
    assert code == 200 and obj.get('ok'), 'POST 失败: %s' % (obj,)
    with open(WS, encoding='ascii') as f:
        v = f.read().strip()
    assert v == '1600x1000', '文件内容错: %r' % v
    case(2, 'POST 保存窗口尺寸并落盘 WxH')

    # 3 GET 读回
    s = stub('GET')
    code, obj = serve.Handler._handle_window_size(s)
    assert obj['width'] == 1600 and obj['height'] == 1000, '读回错: %s' % obj
    case(3, 'GET 读回保存的尺寸')

    # 4 低于最小 1024x700 → 拒绝（防畸形窗口被记住）
    s = stub('POST', json.dumps({'width': 800, 'height': 500}).encode())
    code, obj = serve.Handler._handle_window_size(s)
    assert code == 400, '小窗尺寸应被拒绝，实际 %s' % code
    with open(WS, encoding='ascii') as f:
        assert f.read().strip() == '1600x1000', '拒绝后不应覆盖已存尺寸'
    case(4, '低于 1024x700 拒绝保存（防畸形）')

    # 5 非法 body
    s = stub('POST', b'not-json')
    code, obj = serve.Handler._handle_window_size(s)
    assert code == 400, '坏 JSON 应 400'
    case(5, '坏 body 返回 400')

    print('========== v1.1.4 窗口尺寸记忆（服务端）：5 项全部通过 ==========')
finally:
    cleanup()
