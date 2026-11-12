/* v120-datepicker.test.js — 自定义日期选择控件 v1.2.1 专项锁：
   ① 年份快速修改：点头部年份→输入框键入年份，回车/失焦生效跳该年月（跨年不再逐月翻）
   ② 恢复直接输入：可键入，失焦/回车容错解析（2026-11-10 / 2026/11/10 / 20261110 /
      2026.2.3 / 2026年2月3日）规范化为 YYYY-MM-DD；非法输入回退原值+轻提示
   ③ 整体检查：disabled 置灰不弹层 / 清空后重新输入 / Tab 聚焦不弹层 / Esc 只关弹层 /
      多实例切换锚定 / 今天·清空按钮 / 闰年 2-29 / FormData 值兼容 */
const { makeWindow, waitMain, sleep, waitFor, lastModal, waitNoModal, assert } = require('./helpers/harness');

function popOf(doc) { return doc.querySelector('.dp-pop'); }
function openPop(w, inp) {
  inp.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  return popOf(w.document);
}
function blurInput(w, inp) {
  inp.dispatchEvent(new w.Event('blur'));
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

  /* ============ 1 转换与占位 ============ */
  cur = '1. 全局转换：date 输入变可键入文本框（占位/标记保留），readonly 已去除';
  w.Views.openItemEditor(null, 'life');
  let m = await waitFor(function () {
    const mm = lastModal(doc);
    return mm && mm.querySelector('[name=purchaseDate]') ? mm : null;
  }, { label: '物品编辑弹窗未出现' });
  const pd = m.querySelector('[name=purchaseDate]');
  assert(pd.getAttribute('type') === 'text', 'purchaseDate 应转 text，实为 ' + pd.getAttribute('type'));
  assert(!pd.hasAttribute('readonly'), 'v1.2.1 应恢复可键入（readonly 已去）');
  assert(pd.getAttribute('data-dp-bound') === '1', '应有 data-dp-bound 幂等标记');
  assert(pd.getAttribute('placeholder') === '年 / 月 / 日', '占位应为「年 / 月 / 日」');
  assert(pd.classList.contains('dp-input'), '应带 dp-input 类');
  assert(m.querySelector('[name=openedDate]') && m.querySelector('[name=emptyDate]'), '美妆日期字段应在');
  assert(!m.querySelector('input[type="date"]'), '弹窗内不应残留原生 date 输入');
  console.log('PASS ' + cur);

  /* ============ 2 年份快速修改 ============ */
  cur = '2. 年份快改：点年份→键入 2024 回车→跳 2024 年月视图；非法年份丢弃不跳';
  let pop = openPop(w, pd);
  assert(pop, 'pointerdown 应弹出月历');
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

  /* ============ 3 直接输入容错 ============ */
  cur = '3. 直接输入容错：多格式失焦/回车规范化为 YYYY-MM-DD（有净变化补发 input/change）';
  pd.value = '';
  blurInput(w, pd); // 落定基值（空），后续用例均为净变化
  const cases = [
    ['2026/11/10', '2026-11-10'],
    ['20261110', '2026-11-10'],
    ['2026.2.3', '2026-02-03'],
    ['2026年2月3日', '2026-02-03']
  ];
  for (const [raw, want] of cases) {
    pd.value = '';
    blurInput(w, pd); // 回到空基值（净变化→会响一次，监听随后挂）
    pd.value = raw;
    const fired = [];
    const onIn = function () { fired.push('i'); };
    const onCh = function () { fired.push('c'); };
    pd.addEventListener('input', onIn);
    pd.addEventListener('change', onCh);
    blurInput(w, pd);
    assert(pd.value === want, '「' + raw + '」应规范为 ' + want + '，实为 ' + pd.value);
    assert(fired.indexOf('i') >= 0 && fired.indexOf('c') >= 0, '「' + raw + '」规范化应补发 input/change');
    pd.removeEventListener('input', onIn);
    pd.removeEventListener('change', onCh);
  }
  // 回车同样提交
  pd.value = '2026/3/4';
  pressEnter(w, pd);
  assert(pd.value === '2026-03-04', '回车应规范化为 2026-03-04，实为 ' + pd.value);
  console.log('PASS ' + cur);

  /* ============ 4 非法输入回退 ============ */
  cur = '4. 非法输入回退原值 + 轻提示；未编辑的历史脏值不打扰';
  pd.value = '2026-03-04';
  blurInput(w, pd); // 落定原值
  pd.value = 'abc';
  blurInput(w, pd);
  assert(pd.value === '2026-03-04', '非法输入应还原 2026-03-04，实为 ' + pd.value);
  assert(toastTexts(doc).indexOf('日期格式不正确') >= 0, '非法输入应有轻提示');
  // 非真实日历日同样回退
  pd.value = '2026-02-30';
  blurInput(w, pd);
  assert(pd.value === '2026-03-04', '2026-02-30 应还原，实为 ' + pd.value);
  // 历史脏值（未编辑）不触发回退/提示
  const toastBefore = doc.querySelectorAll('.toast').length;
  pd.value = 'legacy-garbage';
  pd._dpOrig = 'legacy-garbage'; // 模拟带脏值打开（未编辑）
  blurInput(w, pd);
  assert(pd.value === 'legacy-garbage', '未编辑的历史脏值不应被改写');
  assert(doc.querySelectorAll('.toast').length === toastBefore, '未编辑的历史脏值不应弹提示');
  console.log('PASS ' + cur);

  /* ============ 5 Tab 不弹层 / 点击弹层 / Esc 只关弹层 ============ */
  cur = '5. 纯键盘 Tab 聚焦不弹层；点击弹层；Esc 只关弹层不关弹窗';
  pd.focus();
  assert(!popOf(doc), 'Tab/聚焦不应弹出月历（打字不被日历挡住）');
  pd.value = '2026-11-10';
  blurInput(w, pd);
  pop = openPop(w, pd);
  assert(pop, '点击应弹出月历');
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

  /* ============ 6 清空/今天 + 清空后重新输入 ============ */
  cur = '6. 清空按钮置空合法；今天按钮跳当月；清空后重新输入正常提交';
  pop = openPop(w, pd);
  pop.querySelector('[data-dp-clear]').click();
  assert(pd.value === '', '清空应置空值');
  assert(!popOf(doc), '清空后应关弹层');
  // 清空后重新键入
  pd.value = '20261110';
  blurInput(w, pd);
  assert(pd.value === '2026-11-10', '清空后重新输入应正常提交，实为 ' + pd.value);
  // 今天按钮：跳回今天所在月（不写值）
  pop = openPop(w, pd);
  pop.querySelector('[data-dp-nav="1"]').click(); // 先翻走
  pop.querySelector('[data-dp-today]').click();
  const now = new Date();
  assert(pop.querySelector('.dp-title').textContent.indexOf(now.getFullYear() + ' 年 ' + (now.getMonth() + 1)) >= 0,
    '今天按钮应跳回今天所在月');
  assert(pd.value === '2026-11-10', '今天按钮不应改值');
  // 选日期：写值 + 事件 + 关弹层
  let picked = [];
  pd.addEventListener('input', function () { picked.push('i'); });
  pd.addEventListener('change', function () { picked.push('c'); });
  pop.querySelector('[data-dp-date="2026-11-05"]').click();
  assert(pd.value === '2026-11-05', '点月格应写入 YYYY-MM-DD，实为 ' + pd.value);
  assert(picked.join('') === 'ic', '选日期应触发 input+change');
  assert(!popOf(doc), '选日期后应关弹层');
  console.log('PASS ' + cur);

  /* ============ 7 disabled + 多实例 ============ */
  cur = '7. disabled 置灰不弹层；多实例同屏切换锚定（全局单例弹层）';
  const od = m.querySelector('[name=openedDate]');
  const ed = m.querySelector('[name=emptyDate]');
  od.disabled = true;
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

  /* ============ 8 值兼容 + 闰年 ============ */
  cur = '8. FormData 落库 YYYY-MM-DD；闰年 2-29 合法、平年 2-29 回退';
  pd.value = '2024-02-29';
  blurInput(w, pd);
  assert(pd.value === '2024-02-29', '闰年 2-29 应合法保留');
  pd.value = '2026-02-29';
  blurInput(w, pd);
  assert(pd.value === '2024-02-29', '平年 2-29 应还原，实为 ' + pd.value);
  // 键入未规范化值 → 失焦 → 保存 → 落库为 YYYY-MM-DD
  pd.value = '2026/2/3';
  blurInput(w, pd);
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

  console.log('========== v1.2.1 日期选择控件（年份快改/直接输入/整体检查）：8 项全部通过 ==========');
  process.exit(0);
}
main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
