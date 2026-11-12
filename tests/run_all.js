/* tests/run_all.js — 统一测试跑手
   用法：
     node tests/run_all.js               全量跑（JS + Python）
     node tests/run_all.js v113          只跑文件名含 v113 的套件
     node tests/run_all.js --js          只跑 JS 套件
     node tests/run_all.js --py          只跑 Python 套件
   输出规范（各套件遵守）：
     PASS <n>. <用例名>       单项通过
     FAIL <n>. <用例名>: 原因  单项失败（套件随即以非 0 退出）
     ========== <套件名>：N 项全部通过 ==========
   退出码：任一套件失败 → 1，全过 → 0。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TESTS = __dirname;
const args = process.argv.slice(2);
const filters = args.filter(function (a) { return a[0] !== '-'; });
const jsOnly = args.indexOf('--js') >= 0;
const pyOnly = args.indexOf('--py') >= 0;

function listFiles() {
  const all = fs.readdirSync(TESTS).filter(function (f) {
    if (filters.length && !filters.some(function (k) { return f.indexOf(k) >= 0; })) return false;
    if (jsOnly) return f.endsWith('.test.js');
    if (pyOnly) return f.endsWith('.test.py');
    return f.endsWith('.test.js') || f.endsWith('.test.py');
  }).sort();
  return all;
}

function tail(text, n) {
  const lines = String(text).split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
  return lines.slice(-n).join('\n');
}

const files = listFiles();
if (!files.length) { console.log('没有匹配的测试文件'); process.exit(1); }

console.log('共 ' + files.length + ' 套测试\n' + '='.repeat(56));
const results = [];
let failed = 0;

for (const f of files) {
  const isPy = f.endsWith('.test.py');
  const t0 = Date.now();
  const r = spawnSync(isPy ? 'python' : 'node', (isPy ? ['-I'] : []).concat([path.join(TESTS, f)]), {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' })
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  const ms = Date.now() - t0;
  results.push({ file: f, ok: ok, ms: ms, out: out });
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + f + '  (' + (ms / 1000).toFixed(1) + 's)');
  if (!ok) console.log(tail(out, 12).split('\n').map(function (l) { return '    | ' + l; }).join('\n'));
}

console.log('='.repeat(56));
const totalMs = results.reduce(function (s, r) { return s + r.ms; }, 0);
if (failed) {
  console.log('结果: ' + (results.length - failed) + '/' + results.length + ' 套通过，' + failed + ' 套失败（耗时 ' + (totalMs / 1000).toFixed(1) + 's）');
  process.exit(1);
} else {
  console.log('结果: ' + results.length + '/' + results.length + ' 套全部通过（耗时 ' + (totalMs / 1000).toFixed(1) + 's）');
  process.exit(0);
}
