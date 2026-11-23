/* v120-datepicker.test.js — 日期三段式控件 v1.2.6 专项锁（拍板 10，替代 v1.2.1 文本框锁）：
   ① 全局转换：input[type=date] → hidden 值载体 + 年｜月｜日三段（一个框内分段，点击框弹月历，幂等标记）
   ② 段输入聚合：三段全填→YYYY-MM-DD（自动跳段/↑↓微调/方向键）；不完整/非法还原+轻提示；全空=清空
   ③ 月历保留：点击框弹层、年份快改、今天/清空/选日期、Esc 只关弹层、多实例锚定、闰年、落库 */
const { makeWindow, waitMain, sleep, waitFor, lastModal, waitNoModal, assert } = require('./helpers/harness');

function popOf(doc) { return doc.querySelector('.dp-pop'); }
function segWrapOf(inp) { return inp._dpSeg || inp.parentNode.querySelector('.dp-seg'); }
function segs(inp) { return segWrapOf(inp).querySelectorAll('.dp-seg-p'); }
function openPop(w, inp) {
  // 点击框任意处=弹月历（二次定稿：无外挂日历钮）
  segWrapOf(inp).dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  return popOf(w.document);
}
function setSegs(inp, y, mo, d) {
  const s = segs(inp);
  s[0].value = y; s[1].value = mo; s[2].value = d;
}
function blurSegs(w, inp) {
  // 焦点残留段上会被 blur 守卫当作"段间跳转"不聚合——先真实移出焦点
  const ae = w.document.activeElement;
  if (ae && ae.blur && segWrapOf(inp).contains(ae)) ae.blur();
  segs(inp).forEach(function (s) { s.dispatchEvent(new w.Event('blur')); });
}
function pressEnter(w, inp) {
  inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}
function toastTexts(doc) {
  return Array.from(doc.querySelectorAll('.toast')).map(function (t) { return t.textContent; }).join('|');
}

let cur = '';
async function main() {
  const w = makeWindow({});
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;

  /* ============ 1 转换与三段结构 ============ */
  cur = '1. 全局转换：date 输入变 hidden 值载体 + 年月日三段 + 日历钮';
  w.Views.openItemEditor(null, 'life');
  let m = await waitFor(function () {
    const mm = lastModal(doc);
    return mm && mm.querySelector('[name=purchaseDate]') ? mm : null;
  }, { label: '物品编辑弹窗未出现' });
  const pd = m.querySelector('[name=purchaseDate]');
  assert(pd.getAttribute('type') === 'hidden', 'purchaseDate 应转 hidden 值载体，实为 ' + pd.getAttribute('type'));
  assert(pd.getAttribute('data-dp-bound') === '1', '应有 data-dp-bound 幂等标记');
  assert(pd.classList.contains('dp-input'), '应带 dp-input 类');
  const sw = segWrapOf(pd);
  assert(sw && sw.classList.contains('dp-seg'), '应有 dp-seg 三段容器');
  const segEls = segs(pd);
  assert(segEls.length === 3, '应有年月日三段: ' + segEls.length);
  assert(segEls[0].getAttribute('data-seg') === 'y' && segEls[1].getAttribute('data-seg') === 'm' && segEls[2].getAttribute('data-seg') === 'd', '段序应为年-月-日');
  assert(!sw.querySelector('.dp-cal-btn'), '无外挂日历钮（点击框即弹月历，二次定稿）');
  assert(m.querySelector('[name=openedDate]') && m.querySelector('[name=emptyDate]'), '美妆日期字段应在');
  assert(!m.querySelector('input[type="date"]'), '弹窗内不应残留原生 date 输入');
  console.log('PASS ' + cur);

  /* ============ 2 年份快速修改（月历内，保留） ============ */
  cur = '2. 年份快改：点年份→键入 2024 回车→跳 2024 年月视图；非法年份丢弃不跳';
  let pop = openPop(w, pd);
  assert(pop, '点击框应弹出月历');
  const yearBtn = pop.querySelector('[data-dp-year]');
  assert(yearBtn, '头部应有可点年份按钮');
  yearBtn.click();
  const yin = pop.querySelector('.dp-year-in');
  assert(yin, '点年份后应变输入框');
  assert(yin.value === String(new Date().getFullYear()), '年份输入应预填当前年');
  yin.value = '2024';
  pressEnter(w, yin);
  assert(popOf(doc) === pop, '回车改年不应关弹层');
  assert(pop.querySelector('.dp-title').textContent.indexOf('2024') >= 0, '标题应跳到 2024 年');
  assert(pop.querySelector('[data-dp-date^="2024-11-"]'), '月格应渲染 2024 年日期');
  // 非法年份：丢弃输入，停留原视图
  pop.querySelector('[data-dp-year]').click();
  const yin2 = pop.querySelector('.dp-year-in');
  yin2.value = '99';
  pressEnter(w, yin2);
  assert(pop.querySelector('.dp-title').textContent.indexOf('2024') >= 0, '非法年份应停留 2024 视图');
  // 翻月导航仍正常（月份保留 11 月，+1 到 12 月）
  pop.querySelector('[data-dp-nav="1"]').click();
  assert(pop.querySelector('.dp-title').textContent.indexOf('2024 年 12 月') >= 0, '翻月应到 2024 年 12 月');
  pop.querySelector('[data-dp-close]').click();
  assert(!popOf(doc), '关闭按钮应收弹层');
  console.log('PASS ' + cur);

  /* ============ 3 段输入聚合 ============ */
  cur = '3. 段输入聚合：三段全填→YYYY-MM-DD（补发 input/change）；自动跳段';
  pd.value = '';
  await sleep(30);
  const fired = [];
  const onIn = function () { fired.push('i'); };
  const onCh = function () { fired.push('c'); };
  pd.addEventListener('input', onIn);
  pd.addEventListener('change', onCh);
  setSegs(pd, '2026', '11', '10');
  blurSegs(w, pd);
  await sleep(30);
  assert(pd.value === '2026-11-10', '三段聚合应为 2026-11-10，实为 ' + pd.value);
  assert(fired.indexOf('i') >= 0 && fired.indexOf('c') >= 0, '聚合有净变化应补发 input/change');
  // 自动跳段：年满 4 位 → 焦点跳月段
  const s = segs(pd);
  s[0].focus();
  s[0].value = '2026';
  s[0].dispatchEvent(new w.Event('input', { bubbles: true }));
  assert(doc.activeElement === s[1], '年满 4 位应自动跳月段');
  // ↑↓ 微调
  s[1].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  assert(s[1].value === '12', '月段 ↑ 应 +1: ' + s[1].value);
  pd.removeEventListener('input', onIn);
  pd.removeEventListener('change', onCh);
  console.log('PASS ' + cur);

  /* ============ 4 非法/不完整还原 ============ */
  cur = '4. 不完整/非法还原原值 + 轻提示；全空=清空合法';
  pd.value = '2026-03-04'; // setter 回填三段
  await sleep(10);
  setSegs(pd, '2026', '02', '30');
  blurSegs(w, pd);
  await sleep(30);
  assert(pd.value === '2026-03-04', '2026-02-30 非真实日应还原 2026-03-04，实为 ' + pd.value);
  assert(toastTexts(doc).indexOf('日期不完整或不合法') >= 0, '非法应有轻提示');
  // 缺日=不完整还原
  setSegs(pd, '2026', '12', '');
  blurSegs(w, pd);
  await sleep(30);
  assert(pd.value === '2026-03-04', '缺日应还原，实为 ' + pd.value);
  // 全空=清空合法（不提示不还原）
  setSegs(pd, '', '', '');
  blurSegs(w, pd);
  await sleep(30);
  assert(pd.value === '', '全空应清空，实为 ' + pd.value);
  console.log('PASS ' + cur);

  /* ============ 5 键盘聚焦不弹层 / 点击框弹层 / Esc ============ */
  cur = '5. 键盘聚焦不弹层；点击框弹层；Esc 只关弹层不关弹窗';
  segs(pd)[0].focus();
  assert(!popOf(doc), '键盘聚焦不应弹出月历（打字不被日历挡住）');
  pop = openPop(w, pd);
  assert(pop, '点击框应弹出月历');
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert(!popOf(doc), 'Esc 应关弹层');
  assert(lastModal(doc) === m, 'Esc 不应连锁关掉底层弹窗');
  // 点外部关闭（模拟点遮罩：吞点击不关弹窗）
  pop = openPop(w, pd);
  const mask = m.parentNode;
  mask.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(300);
  assert(!popOf(doc), '点外部应关弹层');
  assert(doc.body.contains(m) || lastModal(doc), '点遮罩吞点击后弹窗不应被关');
  console.log('PASS ' + cur);

  /* ============ 6 清空/今天/选日期（月历保留） ============ */
  cur = '6. 清空置空合法；今天按钮跳当月；选日期写值+事件+关弹层';
  pd.value = '2026-11-10';
  await sleep(10);
  pop = openPop(w, pd);
  pop.querySelector('[data-dp-clear]').click();
  assert(pd.value === '', '清空应置空值');
  assert(!popOf(doc), '清空后应关弹层');
  assert(!segs(pd)[0].value && !segs(pd)[1].value && !segs(pd)[2].value, '清空应同步三段');
  // 今天按钮：跳回今天所在月（不写值）
  pop = openPop(w, pd);
  pop.querySelector('[data-dp-nav="1"]').click(); // 先翻走
  pop.querySelector('[data-dp-today]').click();
  const now = new Date();
  assert(pop.querySelector('.dp-title').textContent.indexOf(now.getFullYear() + ' 年 ' + (now.getMonth() + 1)) >= 0,
    '今天按钮应跳回今天所在月');
  assert(pd.value === '', '今天按钮不应改值');
  // 选日期：写值 + 事件 + 关弹层 + 回填三段
  let picked = [];
  pd.addEventListener('input', function () { picked.push('i'); });
  pd.addEventListener('change', function () { picked.push('c'); });
  pop.querySelector('[data-dp-date="2026-11-05"]').click();
  assert(pd.value === '2026-11-05', '点月格应写入 YYYY-MM-DD，实为 ' + pd.value);
  assert(picked.join('') === 'ic', '选日期应触发 input+change');
  assert(segs(pd)[0].value === '2026' && segs(pd)[1].value === '11' && segs(pd)[2].value === '05', '选日期应回填三段');
  assert(!popOf(doc), '选日期后应关弹层');
  console.log('PASS ' + cur);

  /* ============ 7 disabled + 多实例 ============ */
  cur = '7. disabled 三段置灰不弹层；多实例同屏切换锚定（全局单例弹层）';
  const od = m.querySelector('[name=openedDate]');
  const ed = m.querySelector('[name=emptyDate]');
  od.disabled = true;
  segs(od).forEach(function (s) { assert(s.disabled, 'disabled 应同步三段'); });
  assert(!openPop(w, od), 'disabled 输入点击不应弹层');
  od.disabled = false;
  od.value = '2026-01-01';
  pop = openPop(w, od);
  assert(pop, 'enabled 后点击应弹层');
  const pop2 = openPop(w, ed);
  assert(pop2, '第二个输入点击应弹层');
  assert(doc.querySelectorAll('.dp-pop').length === 1, '多实例同屏应只有一层弹层');
  assert(pop2.querySelector('.dp-title').textContent.length > 0, '弹层应锚定到新输入');
  pop2.querySelector('[data-dp-close]').click();
  console.log('PASS ' + cur);

  /* ============ 8 值兼容 + 闰年 + 落库 ============ */
  cur = '8. 闰年 2-29 合法、平年 2-29 回退；FormData 落库 YYYY-MM-DD';
  pd.value = '2024-02-29';
  assert(pd.value === '2024-02-29', '闰年 2-29 应合法保留');
  setSegs(pd, '2026', '02', '29');
  blurSegs(w, pd);
  await sleep(30);
  assert(pd.value === '2024-02-29', '平年 2-29 应还原，实为 ' + pd.value);
  // 段输入 → 失焦 → 保存 → 落库为 YYYY-MM-DD
  setSegs(pd, '2026', '2', '3');
  blurSegs(w, pd);
  await sleep(30);
  assert(pd.value === '2026-02-03', '月日应补零规范化，实为 ' + pd.value);
  m.querySelector('[name=name]').value = '日期控件测试霜';
  m.querySelector('[name=categoryId]').value = 'skin';
  m.querySelector('[name=purchasePrice]').value = '10';
  m.querySelector('[data-act=save]').click();
  await waitFor(function () {
    return w.Storage.getDB().items.some(function (i) { return i.name === '日期控件测试霜'; });
  }, { label: '保存未落库' });
  const it = w.Storage.getDB().items.find(function (i) { return i.name === '日期控件测试霜'; });
  assert(it.purchaseDate === '2026-02-03', 'FormData 应落库规范化日期 2026-02-03，实为 ' + it.purchaseDate);
  await waitNoModal(doc);
  console.log('PASS ' + cur);

  console.log('========== 日期三段式控件（转换/聚合/月历/闰年/落库）：8 项全部通过 ==========');
  process.exit(0);
}
main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
