/* v114-window-size.test.js — v1.1.4 窗口尺寸记忆 + 最小窗口防畸形（前端/启动脚本/CSS） */
const fs = require('fs');
const path = require('path');
const { makeWindow, waitMain, sleep, assert } = require('./helpers/harness');

async function main() {
  /* 1 CSS 最小窗口限制：内容不小于 1024px，窗口再小横滚不畸形 */
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'css', 'extra.css'), 'utf8');
  const seg = css.split('.app, #app {')[1] || '';
  assert(/min-width:\s*1024px/.test(seg), 'CSS 缺 #app min-width 1024px（窗口畸形防护）');
  console.log('PASS 1. CSS 最小窗口限制（min-width 1024px，横滚不畸形）');

  /* 2 启动脚本按记忆尺寸开窗（读 window-size.txt 传 --window-size）；行尾必须 CRLF */
  const batBin = fs.readFileSync(path.join(__dirname, '..', 'lovelife.bat'));
  const bat = batBin.toString('latin1');
  assert(!/(^|[^\r])\n/.test(bat), 'bat 行尾必须 CRLF——LF-only 会让 cmd 解析失败、软件打不开');
  assert(/window-size\.txt/.test(bat), 'bat 未读取 window-size.txt');
  assert(/--window-size=%WW%,%WH%/.test(bat), 'bat 未用记忆尺寸传 --window-size');
  console.log('PASS 2. 启动脚本 CRLF + 读取记忆尺寸开窗（--app --window-size）');

  /* 3 前端 resize 记忆：调整窗口后 POST /api/window-size（≥1024x700 才记） */
  const calls = [];
  const w = makeWindow({
    routes: {
      'api/window-size': function (ctx) {
        calls.push({ method: (ctx.opts && ctx.opts.method) || 'GET', body: ctx.body });
        return ctx.ok({ ok: true });
      }
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  // 模拟窗口尺寸并触发 resize
  Object.defineProperty(w, 'outerWidth', { value: 1600, configurable: true });
  Object.defineProperty(w, 'outerHeight', { value: 1000, configurable: true });
  w.dispatchEvent(new w.Event('resize'));
  await sleep(900); // debounce 600ms
  const hit = calls.find(function (c) { return c.method === 'POST' && c.body && c.body.width === 1600; });
  assert(hit, 'resize 后未记录窗口尺寸: ' + JSON.stringify(calls));
  console.log('PASS 3. 调整窗口后记录尺寸（POST 1600x1000）');

  /* 4 畸形小窗不记（防记住畸形尺寸）+ 最小窗口硬限制：拖过界 resizeTo 拉回 */
  calls.length = 0;
  let resizedTo = null;
  w.resizeTo = function (ww, hh) { resizedTo = { w: ww, h: hh }; };
  Object.defineProperty(w, 'outerWidth', { value: 800, configurable: true });
  Object.defineProperty(w, 'outerHeight', { value: 500, configurable: true });
  w.dispatchEvent(new w.Event('resize'));
  await sleep(900);
  assert(!calls.some(function (c) { return c.method === 'POST'; }), '小窗尺寸不应被记录');
  assert(resizedTo && resizedTo.w === 1024 && resizedTo.h === 700,
    '拖过界应 resizeTo 拉回 1024x700，实际 ' + JSON.stringify(resizedTo));
  console.log('PASS 4. 小窗不记录 + 拖过界强制拉回最小 1024x700');

  console.log('========== v1.1.4 窗口尺寸记忆/防畸形 全部通过 ==========');
  process.exit(0);
}
main().catch(function (e) { console.error('FAIL:', e.message); process.exit(1); });
