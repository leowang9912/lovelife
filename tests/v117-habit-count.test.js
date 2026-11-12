/* v117-habit-count.test.js — v1.1.5 梯度式计数打卡：
   计数型习惯（喝水）一天多次 → 色块深浅梯度（默认 5 次最深、可编辑）+ 格心次数（可关）
   交互：今日点击 +1 / 右键 -1；历史格弹小编辑；二值习惯行为不变 */
const { makeWindow, waitMain, sleep, waitFor, lastModal, assert } = require('./helpers/harness');

function pad(n) { return String(n).padStart(2, '0'); }
const TODAY = (function () { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); })();

async function main() {
  const w = makeWindow({
    data: {
      habits: {
        defs: [{ id: 'h1', name: '喝水', color: '#aecbfa', type: 'count', max: 5, showNum: true },
               { id: 'h2', name: '跑步', color: '#b7e1c1', type: 'check', max: 5, showNum: true }],
        log: { h1: { '2026-01-05': 3 }, h2: { '2026-01-05': true } }
      }
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const S = w.Storage;
  const doc = w.document;
  w.App.go('home');
  await sleep(400);

  /* 1 梯度色：次数越高越深（1 < 3 < 5），满色=习惯色 */
  const c1 = S.habitColorScale('#aecbfa', 1, 5);
  const c3 = S.habitColorScale('#aecbfa', 3, 5);
  const c5 = S.habitColorScale('#aecbfa', 5, 5);
  const lum = function (hx) {
    return parseInt(hx.slice(1, 3), 16) * 0.299 + parseInt(hx.slice(3, 5), 16) * 0.587 + parseInt(hx.slice(5, 7), 16) * 0.114;
  };
  assert(lum(c1) > lum(c3) && lum(c3) > lum(c5), '梯度应随次数加深: ' + c1 + ' ' + c3 + ' ' + c5);
  assert(/^#[0-9a-f]{6}$/.test(c1), '梯度色应为合法 hex');
  console.log('PASS 1. 连续渐变梯度色（1 次最浅 → 满次最深）');

  /* 2 数据语义：setHabitCount 设次数/清零；normHabits 数字归一 */
  await S.setHabitCount('h1', '2026-01-06', 4);
  assert(S.habitCountOf('h1', '2026-01-06') === 4, '次数应=4');
  await S.setHabitCount('h1', '2026-01-06', 0);
  assert(S.habitCountOf('h1', '2026-01-06') === 0, '清零后应=0');
  const norm = S.habitCountOf('h2', '2026-01-05');
  assert(norm === 1, '旧 true 值 countOf 应=1（二值兼容），实际 ' + norm);
  console.log('PASS 2. 计数语义（设次/清零/true→1 归一）');

  /* 3 今日格交互：点击 +1、右键 -1（计数格显示 n 次） */
  const cell3 = doc.querySelector('[data-hb-cell="h1"][data-date="' + TODAY + '"]');
  assert(cell3, '计数习惯今日格应存在');
  const t = S.habitCountOf('h1', TODAY);
  cell3.click();
  await sleep(250);
  const t2 = w.Storage.habitCountOf('h1', TODAY);
  assert(t2 === t + 1, '点击应 +1，实际 ' + t + '→' + t2);
  cell3.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await sleep(250);
  const t3 = w.Storage.habitCountOf('h1', TODAY);
  assert(t3 === t, '右键应 -1，实际 ' + t2 + '→' + t3);
  // 计数交互（原 pill data-count 语义）：连点累加而非 toggle，格心同步显数字
  cell3.click();
  cell3.click();
  await sleep(250);
  assert(w.Storage.habitCountOf('h1', TODAY) === t + 2, '连点 2 次应累加 +2（计数交互非 toggle）');
  assert(cell3.querySelector('.hb-n') && cell3.querySelector('.hb-n').textContent === String(t + 2), '今日格应显示次数数字');
  console.log('PASS 3. 今日格：点击 +1、右键 -1（计数累加）');

  /* 4 格心次数显示（showNum）+ 二值习惯不显数字 */
  const today4 = TODAY;
  await w.Storage.setHabitCount('h1', today4, 2);
  w.App.go('home');
  await sleep(350);
  const hb = doc.querySelector('#home-habits');
  const numCells = hb.querySelectorAll('.hb-cell .hb-n');
  assert(numCells.length >= 1, '计数习惯格应显示次数数字');
  assert(hb.querySelector('[data-hb-cell="h1"][data-date="' + today4 + '"] .hb-n'), 'showNum 开的计数格应显数字');
  const cellH2 = hb.querySelector('[data-hb-cell="h2"][data-date="' + today4 + '"]');
  assert(cellH2 && !cellH2.querySelector('.hb-n'), '二值习惯今日格保持打卡语义（不显数字）');
  cellH2.click(); // 二值今日格 toggle：打卡
  await sleep(250);
  assert(w.Storage.habitCountOf('h2', today4) === 1 && cellH2.classList.contains('on'), '二值今日格点击应打卡');
  cellH2.click(); // 再点取消
  await sleep(250);
  assert(w.Storage.habitCountOf('h2', today4) === 0 && !cellH2.classList.contains('on'), '二值今日格再点应取消');
  console.log('PASS 4. 格心次数显示 + 二值习惯不受影响');

  /* 5 历史格弹小编辑（计数型）：改次数保存落库（用当月过去日，月视图可见） */
  await w.Storage.setHabitCount('h1', '2026-11-05', 3);
  w.App.go('home');
  await sleep(350);
  const cell = doc.querySelector('[data-hb-cell="h1"][data-date="2026-11-05"]');
  assert(cell, '历史格存在');
  cell.click();
  await sleep(250);
  const m = lastModal(doc);
  assert(m && m.querySelector('#hd-n'), '历史格应弹次数编辑弹层');
  assert(m.querySelector('#hd-n').value === '3', '弹层应带入当前次数 3');
  m.querySelector('#hd-n').value = '6';
  m.querySelector('[data-x="s"]').click();
  await sleep(350);
  assert(w.Storage.habitCountOf('h1', '2026-11-05') === 6, '保存后次数应=6');
  console.log('PASS 5. 历史格小编辑（改次数落库）');

  /* 6 编辑器：类型/满色阈值/显示数字落库 */
  w.App.go('home');
  await sleep(300);
  doc.querySelector('[data-hb-edit="h1"]').click();
  await sleep(250);
  const m2 = lastModal(doc);
  assert(m2.querySelector('#hb-type').value === 'count', '编辑器应带出计数类型');
  m2.querySelector('#hb-max').value = '8';
  m2.querySelector('[data-x="s"]').click();
  await sleep(350);
  const def2 = (w.Storage.habits().defs || []).find(function (d) { return d.id === 'h1'; });
  assert(def2.max === 8, '满色阈值应=8，实际 ' + def2.max);
  assert(def2.type === 'count' && def2.showNum === true, '类型/显示数字应保留');
  console.log('PASS 6. 编辑器三字段（类型/满色阈值/显示数字）');

  console.log('========== v1.1.5 梯度式计数打卡 全部通过 ==========');
  process.exit(0);
}
main().catch(function (e) { console.error('FAIL:', e.message); process.exit(1); });
