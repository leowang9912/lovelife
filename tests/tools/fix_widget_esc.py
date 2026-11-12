# -*- coding: utf-8 -*-
"""修 widget.html 的 esc 单引号实体（shell 引号转义易错，用脚本文件）"""
import io

P = 'app/widget.html'
s = io.open(P, encoding='utf-8').read()
lines = s.split('\n')
for i, ln in enumerate(lines):
    if 'map[c]' in ln:
        lines[i] = '      return map[c] || ' + "'''" + ';'
        print('fixed line %d: %s' % (i + 1, lines[i]))
io.open(P, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print('done')
