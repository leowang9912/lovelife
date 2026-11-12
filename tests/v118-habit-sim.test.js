/* v118-habit-sim.test.js — v1.1.5 热力打卡 + 倒计时 深度用户动线模拟（回归锁）
   以真实用户动线驱动点击/输入/保存，覆盖 9 类路径：
   1 习惯管理（增/改/类型互改/删）  2 每日打卡（二值/计数/连点/边界）
   3 补打历史（历史格/弹层/未来格/跨月）  4 梯度色与数字（渐变/封顶/showNum）
   5 月视图（翻月跨年/今天描边/空月/月末闰年格数）  6 统计整年（12 月块/翻年夹紧/口径/空态）
   7 倒计时（增改删/一次性 vs 每年/2-29/hero 简报/过期）  8 边界（播种/删光/XSS/日期/连点/存盘失败）
   9 多账号隔离  10 v1.1.9 拍板 6 项（2-29→2-28 / hero 过期不显示 / 过期一次性折叠 /
     计数日编辑 0~99 / 预设只存被交互那条+删除墓碑 / 统计页同款播种）
   落盘/重启一致性用内存仓库 mock（api/db + api/save 双向），不改共享 harness。 */
'use strict';
const { makeWindow, waitFor, sleep, lastModal, waitNoModal, waitMain, assert, DEFAULT_DATA } = require('./helpers/harness');

function pad(n) { return String(n).padStart(2, '0'); }
function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function dayN(n) { const d = new Date(); d.setDate(d.getDate() - n); return fmt(d); }
const TODAY = fmt(new Date());
const Y = new Date().getFullYear();

/* 颜色归一（hex/rgb 互认） */
function normColor(s) {
  s = String(s || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [m[1][0] + m[1][0], m[1][1] + m[1][1], m[1][2] + m[1][2]].map(function (x) { return parseInt(x, 16); }).join(',');
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)].join(',');
  m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(s);
  if (m) return m[1] + ',' + m[2] + ',' + m[3];
  return s;
}
function bgOf(el) {
  let s = (el.style && el.style.background) || '';
  if (!s) {
    const m = /(?:^|;)\s*background\s*:([^;"]+)/i.exec(el.getAttribute('style') || '');
    s = m ? m[1] : '';
  }
  return normColor(s);
}

/* 卡数据行文本（.hb-card-stat）：「本月 N 次/天 · 连续 M 天」（v1.1.6 卡片式月视图） */
function statOf(hb, id) {
  const card = hb.querySelector('[data-hb-card="' + id + '"]');
  const stat = card && card.querySelector('.hb-card-stat');
  return stat ? stat.textContent : '';
}

/* 内存仓库窗口：api/db 读仓库、api/save 写仓库（可模拟重启/断言落盘/注入存盘失败） */
function storeWindow(opts) {
  opts = opts || {};
  const defaults = DEFAULT_DATA();
  const store = {
    habits: opts.habits ? JSON.parse(JSON.stringify(opts.habits)) : { defs: [], log: {} },
    settings: Object.assign({ planSections: [], rememberAccount: true }, opts.settings || {})
  };
  const ctl = { failSave: opts.failSave || false };
  const calls = [];
  const w = makeWindow({
    routes: Object.assign({
      'api/db': function (r) {
        return r.ok(JSON.parse(JSON.stringify({
          ok: true, schemaVersion: 3,
          account: { id: 'me', name: 'Me', icon: 'x' },
          accounts: [{ id: 'me', name: 'Me', icon: 'x' }],
          items: [], outfits: [], events: [], food: [],
          settings: store.settings, categories: defaults.categories, wallet: defaults.wallet,
          habits: store.habits, dataRoot: 'm'
        })));
      },
      'api/save': function (r) {
        if (ctl.failSave) return r.fail({ ok: false, error: '磁盘罢工' }, 500);
        calls.push({ target: r.body.target, acc: r.body.acc, data: JSON.parse(JSON.stringify(r.body.data)) });
        if (r.body.target === 'habits') store.habits = JSON.parse(JSON.stringify(r.body.data));
        else if (r.body.target === 'settings') store.settings = JSON.parse(JSON.stringify(r.body.data.settings));
        return r.ok({ ok: true });
      }
    }, opts.routes || {})
  });
  return { w: w, store: store, calls: calls, ctl: ctl };
}

async function home(w, ms) {
  w.App.go('home');
  await sleep(ms || 320);
  return w.document.querySelector('#home-habits');
}

let cur = '';

async function main() {
  cur = '';

  /* ==================== 1 习惯管理 ==================== */
  cur = '1. 添加二值习惯（名称/颜色/类型 check/显示数字默认勾选）';
  {
    const s = storeWindow({});
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const hb = await home(w);
    // 首次进入空数据：预设三例播种（纯内存，不落盘）
    assert(hb.querySelectorAll('.hb-card').length === 3, '空数据首次进入应播种预设三例（卡片）');
    assert(!s.calls.some(function (c) { return c.target === 'habits'; }), '渲染期播种应纯内存零落盘');
    hb.querySelector('[data-hb-add]').click();
    let m = lastModal(doc);
    assert(m && m.querySelector('#hb-name'), '添加习惯弹窗应出现');
    m.querySelector('#hb-name').value = '晨跑';
    m.querySelector('[data-hc="#b7e1c1"]').click();
    // 显示数字默认勾选（域口径 showNum 默认 true）
    assert(m.querySelector('#hb-shownum').checked, '新习惯「显示次数」应默认勾选（域口径默认 true）');
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return (w.Storage.getDB().habits.defs || []).some(function (d) { return d.name === '晨跑'; });
    }, { label: '习惯未落库' });
    const def = w.Storage.getDB().habits.defs.find(function (d) { return d.name === '晨跑'; });
    assert(def.type === 'check' && def.color === '#b7e1c1', '二值习惯应带颜色，实为 ' + JSON.stringify(def));
    assert(def.showNum === true, 'showNum 默认应 true');
    console.log('PASS ' + cur);
  }

  cur = '2. 添加计数习惯（切换类型出满色阈值、设 max=8）';
  {
    const s = storeWindow({});
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const hb = await home(w);
    hb.querySelector('[data-hb-add]').click();
    const m = lastModal(doc);
    m.querySelector('#hb-name').value = '喝水';
    const typeSel = m.querySelector('#hb-type');
    assert(m.querySelector('#hb-max-row').hidden, 'check 类型时满色阈值行应隐藏');
    typeSel.value = 'count';
    typeSel.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert(!m.querySelector('#hb-max-row').hidden, '切到计数型应显示满色阈值行');
    m.querySelector('#hb-max').value = '8';
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return (w.Storage.getDB().habits.defs || []).some(function (d) { return d.name === '喝水'; });
    }, { label: '计数习惯未落库' });
    const def = w.Storage.getDB().habits.defs.find(function (d) { return d.name === '喝水'; });
    assert(def.type === 'count' && def.max === 8, '计数习惯应 type=count/max=8，实为 ' + JSON.stringify(def));
    console.log('PASS ' + cur);
  }

  cur = '3. 编辑改名/改色（就地更新不新增）';
  {
    const s = storeWindow({ habits: { defs: [{ id: 'h1', name: '阅读', color: '#aecbfa', type: 'check', max: 5, showNum: true }], log: {} } });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const hb = await home(w);
    hb.querySelector('[data-hb-edit="h1"]').click();
    const m = lastModal(doc);
    assert(m.querySelector('#hb-name').value === '阅读', '编辑弹窗应带出原名');
    m.querySelector('#hb-name').value = '夜读';
    m.querySelector('[data-hc="#f6b8d0"]').click();
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      const d = w.Storage.getDB().habits.defs.find(function (x) { return x.id === 'h1'; });
      return d && d.name === '夜读' ? d : null;
    }, { label: '改名未落库' });
    const defs = w.Storage.getDB().habits.defs;
    assert(defs.length === 1 && defs[0].color === '#f6b8d0', '应就地改色且不新增，实为 ' + JSON.stringify(defs));
    console.log('PASS ' + cur);
  }

  cur = '4. 类型互改：check→count（true 记 1 次）/ count→check（数字=已打）';
  {
    const s = storeWindow({
      habits: {
        defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }],
        log: { h1: {} }
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    await S.toggleHabit('h1', TODAY); // 二值打卡写 true
    assert(S.getDB().habits.log.h1[TODAY] === true, 'toggleHabit 应写 true');
    // check→count：已有 true 值按 1 次展示
    await S.saveHabitDef({ id: 'h1', name: '运动', color: '#aecbfa', type: 'count', max: 5, showNum: true });
    assert(S.habitCountOf('h1', TODAY) === 1, 'true 值应归一为 1 次');
    const hb = await home(w);
    const cell = hb.querySelector('[data-hb-cell="h1"][data-date="' + TODAY + '"]');
    assert(cell.querySelector('.hb-n') && cell.querySelector('.hb-n').textContent === '1', 'check→count 后 true 应显示 1 次');
    // count→check：数字值按已打处理，点击即清除
    await S.setHabitCount('h1', dayN(3), 5);
    await S.saveHabitDef({ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true });
    assert(S.habitCountOf('h1', dayN(3)) === 5, '数字记录应保留');
    const hb2 = await home(w);
    const cell2 = hb2.querySelector('[data-hb-cell="h1"][data-date="' + dayN(3) + '"]');
    assert(cell2.classList.contains('on') && !cell2.querySelector('.hb-n'), 'count→check 后数字应只显已打不显数字');
    cell2.click();
    assert(S.habitCountOf('h1', dayN(3)) === 0 && !(S.getDB().habits.log.h1 && S.getDB().habits.log.h1[dayN(3)]), 'check 态点击历史格应清除该日记录');
    console.log('PASS ' + cur);
  }

  cur = '5. 删除习惯（确认弹窗 + 连带 log 清理 + 落盘）';
  {
    const s = storeWindow({
      habits: {
        defs: [{ id: 'h1', name: '早睡', color: '#b7e1c1', type: 'check', max: 5, showNum: true },
               { id: 'h2', name: '喝水', color: '#a8e0e8', type: 'check', max: 5, showNum: true }],
        log: { h1: (function () { const o = {}; o[TODAY] = true; o[dayN(2)] = true; return o; })(), h2: {} }
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const hb = await home(w);
    hb.querySelector('[data-hb-edit="h1"]').click();
    const m = lastModal(doc);
    m.querySelector('[data-hb-del]').click();
    await waitFor(function () { return lastModal(doc) && lastModal(doc).querySelector('[data-act=yes]'); }, { label: '删除确认弹窗未出现' });
    lastModal(doc).querySelector('[data-act=yes]').click();
    await waitFor(function () {
      return (w.Storage.getDB().habits.defs || []).every(function (d) { return d.id !== 'h1'; });
    }, { label: '习惯未删除' });
    assert(!w.Storage.getDB().habits.log.h1, '删除应连带清 log');
    assert(s.store.habits.defs.length === 1 && !s.store.habits.log.h1, '删除应落盘');
    console.log('PASS ' + cur);
  }

  /* ==================== 2 每日打卡 ==================== */
  cur = '6. 二值打卡：点击即时变色（灰↔习惯色）+ 卡数据行同步 + 取消还原';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const hb = await home(w);
    const cell = hb.querySelector('[data-hb-cell="h1"][data-date="' + TODAY + '"]');
    const cOff = normColor('#f2f2f4'), cOn = normColor('#aecbfa');
    assert(cell, '今日格应存在');
    assert(bgOf(cell) === cOff && !cell.classList.contains('on'), '初始今日格应未打（灰）');
    assert(statOf(hb, 'h1').indexOf('本月 0 天') >= 0, '初始数据行应「本月 0 天」（未打），实为 ' + statOf(hb, 'h1'));
    cell.click(); // 打卡
    assert(cell.classList.contains('on'), '打卡后格子应带 on');
    assert(bgOf(cell) === cOn, '打卡后格子应即时变习惯色，实为 ' + bgOf(cell));
    await waitFor(function () { return statOf(hb, 'h1').indexOf('本月 1 天') >= 0 ? true : null; }, { label: '数据行未同步已打' });
    assert(S.habitCountOf('h1', TODAY) === 1 && S.getDB().habits.log.h1[TODAY] === true, 'db 应写 true');
    cell.click(); // 取消
    assert(!cell.classList.contains('on') && bgOf(cell) === cOff, '取消后格子应还原灰底');
    await waitFor(function () { return statOf(hb, 'h1').indexOf('本月 0 天') >= 0 ? true : null; }, { label: '数据行未同步还原' });
    assert(S.habitCountOf('h1', TODAY) === 0 && !(S.getDB().habits.log.h1 && S.getDB().habits.log.h1[TODAY]), '取消应删键（空映射连键清理）');
    console.log('PASS ' + cur);
  }

  cur = '7. 计数打卡：今日格点击 +1 / 右键 -1 至 0 边界（卡数据行同步）';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '喝水', color: '#aecbfa', type: 'count', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const hb = await home(w);
    const cell = hb.querySelector('[data-hb-cell="h1"][data-date="' + TODAY + '"]');
    assert(cell, '计数习惯今日格应存在（计数交互）');
    cell.click();
    cell.click();
    cell.click();
    assert(S.habitCountOf('h1', TODAY) === 3, '点击 3 次应 3 次，实为 ' + S.habitCountOf('h1', TODAY));
    assert(cell.querySelector('.hb-n') && cell.querySelector('.hb-n').textContent === '3', '格子应显示数字 3');
    await waitFor(function () { return statOf(hb, 'h1').indexOf('本月 3 次') >= 0 ? true : null; }, { label: '数据行未同步 3 次' });
    // 右键 -1 ×5 → 0 边界不为负
    for (let i = 0; i < 5; i++) cell.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    assert(S.habitCountOf('h1', TODAY) === 0, '0 边界不应为负，实为 ' + S.habitCountOf('h1', TODAY));
    assert(S.habitCountOf('h1', TODAY) === 0 && !(S.getDB().habits.log.h1 && S.getDB().habits.log.h1[TODAY]), '清零应删键（空映射连键清理）');
    assert(!cell.classList.contains('on') && !cell.querySelector('.hb-n') && bgOf(cell) === normColor('#f2f2f4'), '清零后今日格应回未打（灰/无数字）');
    await waitFor(function () { return statOf(hb, 'h1').indexOf('本月 0 次') >= 0 ? true : null; }, { label: '数据行未同步清零' });
    console.log('PASS ' + cur);
  }

  cur = '8. 快速连点：计数 +1×5=5；二值双击=取消、三击=打卡（幂等防抖）';
  {
    const s = storeWindow({
      habits: {
        defs: [
          { id: 'hc', name: '喝水', color: '#aecbfa', type: 'count', max: 5, showNum: true },
          { id: 'hk', name: '运动', color: '#b7e1c1', type: 'check', max: 5, showNum: true }
        ],
        log: {}
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const hb = await home(w);
    const cellC = hb.querySelector('[data-hb-cell="hc"][data-date="' + TODAY + '"]');
    for (let i = 0; i < 5; i++) cellC.click();
    assert(S.habitCountOf('hc', TODAY) === 5, '连点 5 次应 =5，实为 ' + S.habitCountOf('hc', TODAY));
    assert(cellC.querySelector('.hb-n') && cellC.querySelector('.hb-n').textContent === '5', '连点后今日格应显数字 5');
    const cellK = hb.querySelector('[data-hb-cell="hk"][data-date="' + TODAY + '"]');
    cellK.click(); cellK.click();
    assert(S.habitCountOf('hk', TODAY) === 0 && !(S.getDB().habits.log.hk && S.getDB().habits.log.hk[TODAY]), '二值双击应=取消');
    cellK.click();
    assert(S.getDB().habits.log.hk[TODAY] === true, '三击应=打卡');
    console.log('PASS ' + cur);
  }

  cur = '9. 翻月往返今日态：已打→取消、未打→打卡（状态派生不串）';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    await S.toggleHabit('h1', TODAY); // 今日已打
    const doc = w.document;
    const hb = await home(w);
    const pm = (function () { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月'; })();
    hb.querySelector('[data-hb-mv="-1"]').click(); // 翻到上月（今日格不在 DOM）
    await waitFor(function () {
      const l = doc.querySelector('#home-habits .hb-month-label');
      return l && l.textContent.trim() === pm ? true : null;
    }, { label: '月视图未翻到上月' });
    const hb2 = doc.querySelector('#home-habits');
    assert(!hb2.querySelector('[data-hb-cell="h1"][data-date="' + TODAY + '"]'), '上月视图不应含今日格');
    assert(statOf(hb2, 'h1').indexOf('本月 0 天') >= 0, '翻月后数据行应按所翻月份统计（今日不影响上月），实为 ' + statOf(hb2, 'h1'));
    hb2.querySelector('[data-hb-mv="1"]').click(); // 翻回本月
    await waitFor(function () {
      return doc.querySelector('#home-habits [data-hb-cell="h1"][data-date="' + TODAY + '"]') ? true : null;
    }, { label: '未翻回本月' });
    const cell = doc.querySelector('#home-habits [data-hb-cell="h1"][data-date="' + TODAY + '"]');
    assert(cell.classList.contains('on') && bgOf(cell) === normColor('#aecbfa'), '翻回后今日格应按 db 派生已打态（不残留）');
    cell.click(); // 已打 → 应取消
    assert(S.habitCountOf('h1', TODAY) === 0, '翻月往返后点击应正确取消，实为 ' + S.habitCountOf('h1', TODAY));
    assert(!cell.classList.contains('on'), '取消后今日格应未打');
    cell.click(); // 未打 → 应打卡
    assert(S.habitCountOf('h1', TODAY) === 1, '翻月往返后点击应正确打卡');
    assert(cell.classList.contains('on') && bgOf(cell) === normColor('#aecbfa'), '打卡后今日格应已打（习惯色）');
    console.log('PASS ' + cur);
  }

  cur = '10. 补打历史格不动今日格（今日格只代表今天）';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const S = w.Storage;
    const hb = await home(w);
    const pm = (function () { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月'; })();
    hb.querySelector('[data-hb-mv="-1"]').click();
    await waitFor(function () {
      const l = doc.querySelector('#home-habits .hb-month-label');
      return l && l.textContent.trim() === pm ? true : null;
    }, { label: '上月格子未渲染' });
    const hb2 = doc.querySelector('#home-habits');
    assert(statOf(hb2, 'h1').indexOf('本月 0 天') >= 0, '今日未打（补打前数据行应 0）');
    const pastCell = hb2.querySelector('[data-hb-cell="h1"][data-date$="-15"]');
    pastCell.click(); // 补打上月 15 号
    assert(S.habitCountOf('h1', pastCell.getAttribute('data-date')) === 1, '历史格应补打成功');
    assert(S.habitCountOf('h1', TODAY) === 0, '补打历史不应影响今天');
    assert(pastCell.classList.contains('on') && bgOf(pastCell) === normColor('#aecbfa'), '历史格应即时变色');
    await waitFor(function () { return statOf(hb2, 'h1').indexOf('本月 1 天') >= 0 ? true : null; }, { label: '数据行未同步补打' });
    // 翻回本月：今日格只代表今天，补打历史不动今日态
    hb2.querySelector('[data-hb-mv="1"]').click();
    await waitFor(function () {
      return doc.querySelector('#home-habits [data-hb-cell="h1"][data-date="' + TODAY + '"]') ? true : null;
    }, { label: '未翻回本月' });
    const cell = doc.querySelector('#home-habits [data-hb-cell="h1"][data-date="' + TODAY + '"]');
    assert(!cell.classList.contains('on') && S.habitCountOf('h1', TODAY) === 0,
      '补打历史后今日格不应变（今日仍为未打），实为今日 ' + S.habitCountOf('h1', TODAY));
    console.log('PASS ' + cur);
  }

  /* ==================== 3 补打历史 ==================== */
  cur = '11. 二值历史格 toggle（补打/取消 + 变色）';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const hb = await home(w);
    const ds = dayN(2);
    const cell = hb.querySelector('[data-hb-cell="h1"][data-date="' + ds + '"]');
    if (!cell) { hb.querySelector('[data-hb-mv="-1"]').click(); await sleep(300); }
    const c2 = w.document.querySelector('[data-hb-cell="h1"][data-date="' + ds + '"]');
    assert(c2, '历史格应存在');
    c2.click();
    assert(bgOf(c2) === normColor('#aecbfa') && S.habitCountOf('h1', ds) === 1, '补打应变色且落库');
    c2.click();
    assert(bgOf(c2) === normColor('#f2f2f4') && S.habitCountOf('h1', ds) === 0, '再点应取消还原');
    console.log('PASS ' + cur);
  }

  cur = '12. 计数历史格弹层：+/−/直接输/清零';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '喝水', color: '#aecbfa', type: 'count', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const S = w.Storage;
    const ds = dayN(1);
    await S.setHabitCount('h1', ds, 2);
    const hb = await home(w);
    const cell = hb.querySelector('[data-hb-cell="h1"][data-date="' + ds + '"]');
    if (!cell) { hb.querySelector('[data-hb-mv="-1"]').click(); await sleep(300); }
    doc.querySelector('[data-hb-cell="h1"][data-date="' + ds + '"]').click();
    const m = await waitFor(function () { const x = lastModal(doc); return x && x.querySelector('#hd-n') ? x : null; }, { label: '计数编辑弹层未出现' });
    assert(m.querySelector('#hd-n').value === '2', '弹层应带入当前 2 次');
    m.querySelector('[data-hd="1"]').click();
    m.querySelector('[data-hd="1"]').click();
    assert(m.querySelector('#hd-n').value === '4', '+应生效，实为 ' + m.querySelector('#hd-n').value);
    m.querySelector('[data-hd="-1"]').click();
    assert(m.querySelector('#hd-n').value === '3', '−应生效');
    m.querySelector('#hd-n').value = '9'; // 直接输
    m.querySelector('[data-hd="0"]').click(); // 清零
    assert(m.querySelector('#hd-n').value === '0', '清零按钮应置 0');
    m.querySelector('#hd-n').value = '6';
    m.querySelector('[data-x=s]').click();
    await waitFor(function () { return S.habitCountOf('h1', ds) === 6; }, { label: '次数未落库' });
    // 清零路径：再开弹层 → 清零 → 保存 → 删键
    doc.querySelector('[data-hb-cell="h1"][data-date="' + ds + '"]').click();
    const m2 = await waitFor(function () { const x = lastModal(doc); return x && x.querySelector('#hd-n') ? x : null; }, { label: '弹层未出现' });
    m2.querySelector('[data-hd="0"]').click();
    m2.querySelector('[data-x=s]').click();
    await waitFor(function () { return S.habitCountOf('h1', ds) === 0; }, { label: '清零未落库' });
    assert(S.habitCountOf('h1', ds) === 0 && !(S.getDB().habits.log.h1 && S.getDB().habits.log.h1[ds]), '清零应删键（空映射连键清理）');
    console.log('PASS ' + cur);
  }

  cur = '13. 未来格不可点（disabled 不落库）';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const hb = await home(w);
    let future = hb.querySelector('[data-hb-cell="h1"].future');
    if (!future) { // 今天恰是月末 → 翻到下月（整月皆未来）
      hb.querySelector('[data-hb-mv="1"]').click();
      await sleep(300);
      future = w.document.querySelector('#home-habits [data-hb-cell="h1"].future');
    }
    assert(future && future.disabled, '未来格应 disabled');
    future.click();
    assert(S.habitCountOf('h1', future.getAttribute('data-date')) === 0, '点未来格不应落库');
    console.log('PASS ' + cur);
  }

  cur = '14. 跨月翻月补打 + 翻月跨年边界（1 月↔12 月）';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const S = w.Storage;
    const hb = await home(w);
    const label = function () { return doc.querySelector('#home-habits .hb-month-label').textContent.trim(); };
    // 一路前翻到 1 月，再往前 = 上一年 12 月（跨年）
    let guard = 0;
    while (label().indexOf(' 年 1 月') < 0 && guard++ < 24) {
      doc.querySelector('#home-habits [data-hb-mv="-1"]').click();
      await waitFor(function () { return doc.querySelector('#home-habits .hb-month-label'); }, { label: '翻月未刷新' });
    }
    assert(label().indexOf(' 年 1 月') >= 0, '应翻到 1 月，实为 ' + label());
    doc.querySelector('#home-habits [data-hb-mv="-1"]').click();
    await waitFor(function () { return doc.querySelector('#home-habits .hb-month-label').textContent.indexOf(' 年 12 月') >= 0 ? true : null; }, { label: '未跨年到 12 月' });
    const y1 = Number(label().slice(0, 4));
    assert(y1 === new Date().getFullYear() - 1, '1 月再前翻应到上一年 12 月，实为 ' + label());
    // 跨月补打：在上一年 12 月 10 号打一次
    const ds = y1 + '-12-10';
    const cell = doc.querySelector('#home-habits [data-hb-cell="h1"][data-date="' + ds + '"]');
    assert(cell, '上一年 12/10 格应存在');
    cell.click();
    assert(S.habitCountOf('h1', ds) === 1, '跨月补打应落库');
    // 再翻回来（12 月→1 月同跨年）
    doc.querySelector('#home-habits [data-hb-mv="1"]').click();
    await waitFor(function () { return doc.querySelector('#home-habits .hb-month-label').textContent.indexOf(' 年 1 月') >= 0 ? true : null; }, { label: '未翻回 1 月' });
    console.log('PASS ' + cur);
  }

  /* ==================== 4 梯度色与数字 ==================== */
  cur = '15. 梯度色：1<3<5 渐深、超 max 封顶、3 位 hex 展开、脏色兜底';
  {
    const s = storeWindow({});
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const lum = function (hx) {
      const rgb = normColor(hx).split(',').map(Number);
      return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
    };
    const c1 = S.habitColorScale('#aecbfa', 1, 5);
    const c3 = S.habitColorScale('#aecbfa', 3, 5);
    const c5 = S.habitColorScale('#aecbfa', 5, 5);
    assert(lum(c1) > lum(c3) && lum(c3) > lum(c5), '梯度应随次数渐深: ' + c1 + ' ' + c3 + ' ' + c5);
    assert(S.habitColorScale('#aecbfa', 9, 5) === c5, '超 max 应封顶为满色');
    // 3 位 hex = 等价 6 位展开（#abc ≡ #aabbcc）
    assert(S.habitColorScale('#abc', 3, 5) === S.habitColorScale('#aabbcc', 3, 5),
      '3 位 hex 应正确展开，实为 ' + S.habitColorScale('#abc', 3, 5));
    // 脏色兜底：返回合法 hex 且不抛错
    const bad = S.habitColorScale('red', 3, 5);
    assert(/^#[0-9a-f]{6}$/.test(bad), '脏色应兜底为合法 hex，实为 ' + bad);
    console.log('PASS ' + cur);
  }

  cur = '16. showNum 开关：主页格子 + 统计年格 数字显隐';
  {
    const s = storeWindow({
      habits: {
        defs: [
          { id: 'h1', name: '喝水', color: '#aecbfa', type: 'count', max: 5, showNum: true },
          { id: 'h2', name: '喝茶', color: '#d7aefb', type: 'count', max: 5, showNum: false }
        ],
        log: { h1: (function () { const o = {}; o[TODAY] = 3; return o; })(), h2: (function () { const o = {}; o[TODAY] = 3; return o; })() }
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const hb = await home(w);
    const n1 = hb.querySelector('[data-hb-cell="h1"][data-date="' + TODAY + '"] .hb-n');
    const n2 = hb.querySelector('[data-hb-cell="h2"][data-date="' + TODAY + '"]');
    assert(n1 && n1.textContent === '3', 'showNum 开应显数字');
    assert(!n2.querySelector('.hb-n'), 'showNum 关不应显数字');
    // 统计页年格
    w.App.go('plan');
    const body = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('svg[data-habit-grid]') ? el : null;
    }, { label: 'habitHeat 未渲染' });
    const grids = body.querySelectorAll('svg[data-habit-grid]');
    const texts1 = Array.from(grids[0].querySelectorAll('text')).map(function (t) { return t.textContent; });
    const texts2 = Array.from(grids[1].querySelectorAll('text')).map(function (t) { return t.textContent; });
    assert(texts1.indexOf('3') >= 0, '统计年格 showNum 开应显数字');
    assert(texts2.indexOf('3') < 0, '统计年格 showNum 关不应显数字');
    console.log('PASS ' + cur);
  }

  cur = '17. 二值习惯不显数字（主页 + 统计）';
  {
    const s = storeWindow({
      habits: {
        defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }],
        log: { h1: (function () { const o = {}; o[TODAY] = true; return o; })() }
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const hb = await home(w);
    assert(hb.querySelectorAll('.hb-cell .hb-n').length === 0, '二值习惯格子不应显数字');
    w.App.go('plan');
    const body = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('svg[data-habit-grid]') ? el : null;
    }, { label: 'habitHeat 未渲染' });
    const g = body.querySelector('svg[data-habit-grid]');
    const nums = Array.from(g.querySelectorAll('text')).filter(function (t) { return /^\d+$/.test(t.textContent) && t.textContent.indexOf('月') < 0; });
    assert(nums.length === 0, '统计年格二值习惯不应显数字，实为 ' + nums.map(function (t) { return t.textContent; }));
    console.log('PASS ' + cur);
  }

  /* ==================== 5 月视图 ==================== */
  cur = '18. 月视图格数边界：31 天月 / 平年 2 月 28 / 闰年 2 月 29 + 今天描边 + 空月';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const hb = await home(w);
    const label = function () { return doc.querySelector('#home-habits .hb-month-label').textContent.trim(); };
    const cells = function () { return doc.querySelectorAll('#home-habits [data-hb-cell="h1"]').length; };
    assert(doc.querySelector('#home-habits [data-hb-cell="h1"][data-date="' + TODAY + '"]').classList.contains('today'), '今天应描边');
    // 翻到 2026-01（31 天）
    let guard = 0;
    while (label().indexOf(Y + ' 年 1 月') < 0 && guard++ < 24) {
      doc.querySelector('#home-habits [data-hb-mv="-1"]').click();
      await waitFor(function () { return doc.querySelector('#home-habits .hb-month-label'); }, { label: '翻月未刷新' });
    }
    assert(cells() === 31, '1 月应 31 格，实为 ' + cells());
    assert(doc.querySelectorAll('#home-habits [data-hb-cell="h1"].on').length === 0, '空月应全灰无打卡');
    // 到当年 2 月（格数=当月天数）
    doc.querySelector('#home-habits [data-hb-mv="1"]').click();
    await waitFor(function () { return label().indexOf(Y + ' 年 2 月') === 0 ? true : null; }, { label: '未到 2 月' });
    assert(cells() === new Date(Y, 2, 0).getDate(), '当年 2 月格数应=当月天数，实为 ' + cells());
    // 到下一个闰年 2 月（29 天）
    let ly = Y;
    while (!((ly % 4 === 0 && ly % 100 !== 0) || ly % 400 === 0)) ly++;
    for (let i = (ly - Y) * 12; i > 0; i--) {
      doc.querySelector('#home-habits [data-hb-mv="1"]').click();
      await waitFor(function () { return doc.querySelector('#home-habits .hb-month-label'); }, { label: '翻月未刷新' });
    }
    assert(label().indexOf(ly + ' 年 2 月') === 0, '应到 ' + ly + '-02，实为 ' + label());
    assert(cells() === 29, '闰年 2 月应 29 格，实为 ' + cells());
    console.log('PASS ' + cur);
  }

  cur = '19. 编辑习惯后月视图保持月份并刷新显示';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const hb = await home(w);
    hb.querySelector('[data-hb-mv="-1"]').click();
    await waitFor(function () { return doc.querySelector('#home-habits .hb-month-label'); }, { label: '翻月未刷新' });
    const before = doc.querySelector('#home-habits .hb-month-label').textContent.trim();
    doc.querySelector('#home-habits [data-hb-edit="h1"]').click();
    const m = lastModal(doc);
    m.querySelector('#hb-name').value = '跑步';
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return doc.querySelector('#home-habits [data-hb-edit="h1"]') &&
        doc.querySelector('#home-habits [data-hb-edit="h1"]').textContent.indexOf('跑步') >= 0 ? true : null;
    }, { label: '编辑后未刷新' });
    assert(doc.querySelector('#home-habits .hb-month-label').textContent.trim() === before,
      '编辑后应保持所翻月份，实为 ' + doc.querySelector('#home-habits .hb-month-label').textContent.trim());
    console.log('PASS ' + cur);
  }

  /* ==================== 6 统计整年视图 ==================== */
  cur = '20. 统计年视图：12 月块 + 月标签 + 翻年上下限夹紧';
  {
    const s = storeWindow({
      habits: {
        defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }],
        log: { h1: (function () { const o = {}; o[(Y - 2) + '-03-05'] = true; o[(Y - 1) + '-06-15'] = true; o[TODAY] = true; return o; })() }
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('plan');
    const body = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('svg[data-habit-grid]') ? el : null;
    }, { label: 'habitHeat 未渲染' });
    const g = body.querySelector('svg[data-habit-grid]');
    assert(g.getAttribute('data-months') === '12' && g.getAttribute('data-year') === String(Y), '应为今年 12 月块');
    const labels = Array.from(g.querySelectorAll('text')).map(function (t) { return t.textContent; });
    for (let mm = 1; mm <= 12; mm++) assert(labels.indexOf(mm + '月') >= 0, '缺 ' + mm + '月标签');
    // 翻年：下限 = 前年（数据更早），再翻夹紧；上限 = 今年
    // v1.1.8 导航挪 head 右上（.hh-head-nav）：翻年按钮在 panel 内找
    const nav = doc.querySelector('.plan-sec[data-id=habitHeat]') || body;
    nav.querySelector('[data-hy=prev]').click();
    nav.querySelector('[data-hy=prev]').click();
    nav.querySelector('[data-hy=prev]').click();
    await waitFor(function () {
      const x = body.querySelector('svg[data-habit-grid]');
      return x && x.getAttribute('data-year') === String(Y - 2) ? x : null;
    }, { label: '未翻到数据下限年' });
    nav.querySelector('[data-hy=prev]').click();
    await sleep(200);
    assert(body.querySelector('svg[data-habit-grid]').getAttribute('data-year') === String(Y - 2), '翻年下限应夹紧');
    for (let i = 0; i < 5; i++) nav.querySelector('[data-hy=next]').click();
    await waitFor(function () {
      const x = body.querySelector('svg[data-habit-grid]');
      return x && x.getAttribute('data-year') === String(Y) ? x : null;
    }, { label: '未翻回今年' });
    nav.querySelector('[data-hy=next]').click();
    await sleep(200);
    assert(body.querySelector('svg[data-habit-grid]').getAttribute('data-year') === String(Y), '翻年上限应夹紧在今年');
    console.log('PASS ' + cur);
  }

  cur = '21. 统计口径：当年计数 / 最长连续 / 今天未打不断签 + 计数梯度同步';
  {
    const s = storeWindow({
      habits: {
        defs: [
          { id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true },
          { id: 'h2', name: '喝水', color: '#d7aefb', type: 'count', max: 5, showNum: false }
        ],
        log: {
          h1: (function () { const o = {}; o[dayN(1)] = true; o[dayN(2)] = true; o[dayN(3)] = true; return o; })(),
          h2: (function () { const o = {}; o[TODAY] = 4; return o; })()
        }
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const doc = w.document;
    // 今天未打不断签：h1 今天没打 → 从昨天往回数 3 天
    assert(S.habitCurrentStreak('h1') === 3, '今天未打应从昨天往回数 3 天，实为 ' + S.habitCurrentStreak('h1'));
    const yCount = [dayN(1), dayN(2), dayN(3)].filter(function (k) { return k.slice(0, 4) === String(Y); }).length;
    assert(S.habitYearCount('h1', Y) === yCount, '当年打卡应 ' + yCount + ' 天');
    assert(S.habitLongestStreak('h1') === 3, '最长连续应 3 天');
    w.App.go('plan');
    const body = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('svg[data-habit-grid]') ? el : null;
    }, { label: 'habitHeat 未渲染' });
    const text = body.textContent;
    assert(text.indexOf('打卡 ' + yCount + ' 天') >= 0 && text.indexOf('最长连续 3 天') >= 0, '统计口径应与 Storage 同源: ' + text.slice(0, 200));
    // 计数梯度同步：h2 今天 4 次格 = habitColorScale(色,4,max)
    const grid2 = body.querySelectorAll('svg[data-habit-grid]')[1];
    const onRects = Array.from(grid2.querySelectorAll('rect[data-on="1"]'));
    assert(onRects.length === 1, 'h2 打卡格应 1 个');
    const expect = normColor(S.habitColorScale('#d7aefb', 4, 5));
    assert(normColor(onRects[0].getAttribute('fill')) === expect, '计数格应梯度色，实为 ' + onRects[0].getAttribute('fill'));
    console.log('PASS ' + cur);
  }

  cur = '22. 统计空态引导（无习惯项 → 管理习惯跳主页）';
  {
    const s = storeWindow({ settings: { habitSeeded: true } }); // 已初始化过 → 主页不播种，空态可见
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('plan');
    const body = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('[data-eg-go=home]') ? el : null;
    }, { label: '空态卡未出现' });
    assert(body.textContent.indexOf('还没有习惯项') >= 0, '应有空态引导');
    body.querySelector('[data-eg-go=home]').click();
    await waitFor(function () { return doc.querySelector('#home-habits'); }, { label: '未跳主页' });
    console.log('PASS ' + cur);
  }

  /* ==================== 7 倒计时 ==================== */
  cur = '23. 倒计时全流程：添加 / 编辑 / 删除（确认弹窗 + 落盘）';
  {
    const s = storeWindow({});
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await home(w);
    doc.querySelector('[data-cd-add]').click();
    let m = lastModal(doc);
    m.querySelector('#cd-name').value = '考研';
    m.querySelector('#cd-date').value = dayN(-30); // 30 天后
    m.querySelector('[data-x=s]').click();
    await waitFor(function () { return s.store.settings.countdowns && s.store.settings.countdowns.length === 1; }, { label: '倒计时未落盘' });
    let card = await waitFor(function () {
      const c = doc.querySelector('.cd-card');
      return c && c.textContent.indexOf('考研') >= 0 ? c : null;
    }, { label: '倒计时卡未渲染' });
    assert(card.querySelector('.cd-days').textContent.trim() === '30', '应显示剩余 30 天，实为 ' + card.querySelector('.cd-days').textContent);
    // 编辑改名 + 延期
    card.click();
    m = lastModal(doc);
    assert(m.querySelector('#cd-name').value === '考研', '编辑应带出名称');
    m.querySelector('#cd-name').value = '考研冲刺';
    m.querySelector('#cd-date').value = dayN(-40);
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return s.store.settings.countdowns[0].name === '考研冲刺' ? true : null;
    }, { label: '编辑未落盘' });
    // 删除
    await waitFor(function () {
      const c = doc.querySelector('.cd-card');
      return c && c.textContent.indexOf('考研冲刺') >= 0 ? c : null;
    }, { label: '编辑后卡片未刷新' }).then(function (c) { c.click(); });
    m = await waitFor(function () { const x = lastModal(doc); return x && x.querySelector('[data-cd-del]') ? x : null; }, { label: '编辑弹窗未出现' });
    m.querySelector('[data-cd-del]').click();
    await waitFor(function () { const x = lastModal(doc); return x && x.querySelector('[data-act=yes]'); }, { label: '删除确认未出现' });
    lastModal(doc).querySelector('[data-act=yes]').click();
    await waitFor(function () { return !(s.store.settings.countdowns || []).length; }, { label: '删除未落盘' });
    await waitFor(function () { return !doc.querySelector('.cd-card'); }, { label: '卡片未消失' });
    console.log('PASS ' + cur);
  }

  cur = '24. 一次性 vs 每年循环（过期已过 / 周年已过算明年 / 2-29 非闰年落 2-28）';
  {
    const s = storeWindow({
      settings: {
        countdowns: [
          { id: 'c1', name: '考研', date: dayN(3), repeat: '' },            // 3 天前过期
          { id: 'c2', name: '生日', date: '2000-12-31', repeat: 'year' },   // 今年 12-31 未到
          { id: 'c3', name: '纪念', date: '2000-01-05', repeat: 'year' },   // 今年 01-05 已过 → 明年
          { id: 'c4', name: '闰闰', date: '2000-02-29', repeat: 'year' }    // 闰日周年
        ]
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await home(w);
    const dayDiff = function (a, b) {
      const pa = a.split('-'), pb = b.split('-');
      return Math.round((new Date(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2])) - new Date(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]))) / 86400000);
    };
    // 每年循环期望天数：月日周年；已过算明年；2-29 非闰年按 2-28（v1.1.9 拍板 1，保守早 1 天）
    const daysToYearly = function (md) {
      let y = Y;
      const occStr = function (yy) {
        if (md === '0229') {
          const leap = (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
          return yy + '-02-' + (leap ? '29' : '28');
        }
        return yy + '-' + md.slice(0, 2) + '-' + md.slice(2, 4);
      };
      if (occStr(y) < TODAY) y++;
      return dayDiff(TODAY, occStr(y));
    };
    const cardOf = function (name) {
      return Array.from(doc.querySelectorAll('.cd-card')).filter(function (c) { return c.textContent.indexOf(name) >= 0; })[0];
    };
    // 一次性过期：卡「已过 3」
    const c1 = cardOf('考研');
    assert(c1.querySelector('.cd-days').textContent.trim() === '已过 3', '过期应显示已过，实为 ' + c1.querySelector('.cd-days').textContent);
    // 每年：今年 12-31
    const c2 = cardOf('生日');
    assert(c2.textContent.indexOf('每年') >= 0, '每年循环应带标签');
    assert(c2.textContent.indexOf('2000') < 0, '每年卡不应显示原始年份');
    assert(c2.querySelector('.cd-days').textContent.trim() === String(daysToYearly('1231')), '周年剩余天数应按下一周年，实为 ' + c2.querySelector('.cd-days').textContent);
    // 今年已过的周年 → 算明年
    const c3 = cardOf('纪念');
    assert(c3.querySelector('.cd-days').textContent.trim() === String(daysToYearly('0105')),
      '已过周年应算明年，实为 ' + c3.querySelector('.cd-days').textContent);
    // 2-29：非闰年周年落 2-28（v1.1.9 拍板 1：保守提醒早 1 天，不滚 3-1）
    const c4 = cardOf('闰闰');
    assert(c4.querySelector('.cd-days').textContent.trim() === String(daysToYearly('0229')),
      '2-29 周年非闰年应落 2-28，实为 ' + c4.querySelector('.cd-days').textContent);
    console.log('PASS ' + cur);
  }

  cur = '25. hero 简报：最近优先 / 过期不显示 / 空态无分隔符 / 12-31 跨年算明年';
  {
    // a) 多个倒计时：未来最近优先，过期垫底
    const s = storeWindow({
      settings: {
        countdowns: [
          { id: 'c1', name: '远期', date: dayN(-90), repeat: '' },
          { id: 'c2', name: '近期', date: dayN(-5), repeat: '' },
          { id: 'c3', name: '过期甲', date: dayN(10), repeat: '' },
          { id: 'c4', name: '过期乙', date: dayN(400), repeat: '' }
        ]
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await home(w);
    const brief = doc.querySelector('.home-cd-brief');
    assert(brief && brief.textContent.indexOf('近期') >= 0 && brief.textContent.indexOf('还有 5 天') >= 0,
      'hero 应取最近的未来项，实为 ' + (brief && brief.textContent));
    const cards = Array.from(doc.querySelectorAll('.cd-card'));
    assert(cards[0].textContent.indexOf('近期') >= 0, '卡序应最近优先，实为 ' + cards[0].textContent);
    assert(cards[cards.length - 1].textContent.indexOf('过期乙') >= 0, '最久过期应垫底');

    // b) 全部过期：hero 不显示简报（v1.1.9 拍板 2：过期不进 hero，不显示「·」和文案）
    const s2 = storeWindow({ settings: { countdowns: [{ id: 'c1', name: '考研', date: dayN(3), repeat: '' }] } });
    const w2 = s2.w;
    if (!(await waitMain(w2))) throw new Error('no main');
    const doc2 = w2.document;
    await home(w2);
    assert(!doc2.querySelector('.home-cd-brief'), '全过期时 hero 不应显示简报（过期不进 hero）');
    assert(doc2.querySelector('.home-date').textContent.indexOf('·') < 0, '全过期日期行不应残留分隔符');
    assert(doc2.querySelector('.cd-card'), '过期卡应保留（收进折叠组，不删除）');

    // c) 空态：无简报、无 · 分隔符
    const s3 = storeWindow({});
    const w3 = s3.w;
    if (!(await waitMain(w3))) throw new Error('no main');
    await home(w3);
    assert(!w3.document.querySelector('.home-cd-brief'), '空态不应有简报');
    assert(w3.document.querySelector('.home-date').textContent.indexOf('·') < 0, '空态日期行不应残留分隔符');
    assert(w3.document.querySelector('#home-cd .empty-hint'), '空态应有添加引导');

    // d) 12-31 周期生日跨年后算明年（伪造今天=次年 1 月 5 日）
    const s4 = storeWindow({ settings: { countdowns: [{ id: 'c1', name: '生日', date: '2000-12-31', repeat: 'year' }] } });
    const w4 = s4.w;
    if (!(await waitMain(w4))) throw new Error('no main');
    const realToday = w4.Utils.todayStr;
    const fake = (Y + 1) + '-01-05';
    w4.Utils.todayStr = function (d) { return d ? realToday(d) : fake; };
    try {
      await home(w4);
      const brief4 = w4.document.querySelector('.home-cd-brief');
      const days = Math.round((new Date(Y + 1, 11, 31) - new Date(Y + 1, 0, 5)) / 86400000);
      assert(brief4 && brief4.textContent.indexOf('还有 ' + days + ' 天') >= 0,
        '12-31 生日在次年 1 月应算当年 12-31（' + days + ' 天），实为 ' + (brief4 && brief4.textContent));
    } finally {
      w4.Utils.todayStr = realToday;
    }
    console.log('PASS ' + cur);
  }

  cur = '26. 倒计时脏数据防御：非数组/非法日期/名称与年循环日期部件 XSS';
  {
    const s = storeWindow({
      settings: {
        countdowns: [
          { id: 'c1', name: '<img src=x onerror="window.__xss1=1">坏名', date: '2026-<b>x</b>-01', repeat: 'year' },
          { id: 'c2', name: '坏日期', date: 'abc', repeat: '' },
          { id: 'c3', name: '好', date: dayN(-3), repeat: '' }
        ]
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const hb = await home(w);
    assert(hb, '脏倒计时不应炸主页');
    assert(!doc.querySelector('.cd-card img') && w.__xss1 === undefined, '名称 XSS 不应执行');
    assert(!doc.querySelector('.cd-card b'), '年循环日期部件不应注入 HTML');
    assert(doc.querySelector('#home-cd').innerHTML.indexOf('&lt;b&gt;') >= 0, '日期部件应转义显示');
    // 非数组 countdowns 不炸
    const s2 = storeWindow({});
    const w2 = s2.w;
    if (!(await waitMain(w2))) throw new Error('no main');
    w2.Storage.getDB().settings.countdowns = { junk: 1 };
    let ok = true;
    try { await home(w2); } catch (e) { ok = false; }
    assert(ok && w2.document.querySelector('#home-cd'), '非数组 countdowns 不应炸渲染');
    // 编辑器拒非法日期
    const doc2 = w2.document;
    doc2.querySelector('[data-cd-add]').click();
    const m = lastModal(doc2);
    m.querySelector('#cd-name').value = '测试';
    m.querySelector('#cd-date').value = '2026-02-30'; // 非法日历日
    m.querySelector('[data-x=s]').click();
    await sleep(150);
    assert((w2.Storage.getDB().settings.countdowns || []).length === 0 || !Array.isArray(w2.Storage.getDB().settings.countdowns),
      '非法日期不应入库');
    assert(lastModal(doc2), '非法日期应留在弹窗提示');
    console.log('PASS ' + cur);
  }

  /* ==================== 8 边界与异常 ==================== */
  cur = '27. 空数据首次进入：预设三例纯内存播种，交互只存被交互的那条';
  {
    const s = storeWindow({});
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const hb = await home(w);
    const names = Array.from(hb.querySelectorAll('.hb-card-head')).map(function (e) { return e.textContent.trim(); });
    assert(names.join(',') === '运动,阅读,早睡', '预设三例应播种，实为 ' + names.join(','));
    assert(!s.calls.some(function (c) { return c.target === 'habits'; }), '播种应零落盘');
    // 首次交互（打卡）即随交互落盘——只落被交互的那条（v1.1.9 拍板 5）
    hb.querySelector('[data-hb-cell="hb_preset_0"][data-date="' + TODAY + '"]').click();
    await waitFor(function () {
      return s.calls.some(function (c) { return c.target === 'habits'; });
    }, { label: '首次交互未落盘' });
    const saved = s.calls.filter(function (c) { return c.target === 'habits'; }).pop();
    assert(saved.data.defs.length === 1 && saved.data.defs[0].id === 'hb_preset_0',
      '交互落盘应只含被交互的那条，实为 ' + JSON.stringify(saved.data.defs.map(function (d) { return d.id; })));
    assert(saved.data.log && saved.data.log.hb_preset_0 && saved.data.log.hb_preset_0[TODAY] === true,
      '落盘应含被交互条的打卡 log');
    console.log('PASS ' + cur);
  }

  cur = '28. 删光所有习惯：显示空态且重启不复活';
  {
    const s = storeWindow({
      habits: {
        defs: [
          { id: 'h1', name: '运动', color: '#aecbfa' },
          { id: 'h2', name: '阅读', color: '#d7aefb' },
          { id: 'h3', name: '早睡', color: '#b7e1c1' }
        ],
        log: {}
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const S = w.Storage;
    let hb = await home(w);
    for (const id of ['h1', 'h2', 'h3']) {
      doc.querySelector('#home-habits [data-hb-edit="' + id + '"]').click();
      const m = lastModal(doc);
      m.querySelector('[data-hb-del]').click();
      await waitFor(function () { const x = lastModal(doc); return x && x.querySelector('[data-act=yes]'); }, { label: '确认弹窗未出现' });
      lastModal(doc).querySelector('[data-act=yes]').click();
      await waitFor(function () {
        return !(S.getDB().habits.defs || []).some(function (d) { return d.id === id; });
      }, { label: '删除未生效' });
    }
    hb = doc.querySelector('#home-habits');
    assert(hb.querySelectorAll('.hb-card').length === 0, '删光后不应再有习惯卡，实为 ' + hb.querySelectorAll('.hb-card').length);
    assert(hb.querySelector('.empty-hint'), '删光后应显示空态引导');
    // 模拟重启：重新 loadAll + 渲染 → 预设不得复活
    await S.loadAll();
    await home(w);
    hb = doc.querySelector('#home-habits');
    assert(hb.querySelectorAll('.hb-card').length === 0, '重启后预设不应复活，实为 ' + hb.querySelectorAll('.hb-card').length);
    assert(hb.querySelector('.empty-hint'), '重启后仍应空态');
    assert(s.store.settings.habitSeeded === true, '删光应落初始化标记');
    console.log('PASS ' + cur);
  }

  cur = '29. 名称含特殊字符/XSS：转义渲染不执行';
  {
    const evil = '<img src=x onerror="window.__xss=1">';
    const s = storeWindow({
      habits: {
        defs: [{ id: 'h1', name: evil, color: '#aecbfa', type: 'count', max: 5, showNum: true }],
        log: {}
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const hb = await home(w);
    const nameBtn = hb.querySelector('[data-hb-edit="h1"]');
    assert(nameBtn.innerHTML.indexOf('&lt;img') >= 0 && !nameBtn.querySelector('img'),
      '名称应转义为文本展示（不解析为元素）');
    assert(!doc.querySelector('#home-habits img') && w.__xss === undefined, '习惯名 XSS 不应执行');
    // 编辑弹窗/删除确认也不执行
    hb.querySelector('[data-hb-edit="h1"]').click();
    const m = lastModal(doc);
    assert(m.querySelector('#hb-name').value === evil, '编辑框应完整带出原名');
    assert(w.__xss === undefined, '弹窗内 XSS 不应执行');
    m.querySelector('[data-x=c]').click();
    await waitNoModal(doc);
    // 统计页同步转义
    w.App.go('plan');
    const body = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('svg[data-habit-grid]') ? el : null;
    }, { label: 'habitHeat 未渲染' });
    assert(!body.querySelector('img') && body.innerHTML.indexOf('&lt;img') >= 0 && w.__xss === undefined, '统计页名称应转义为文本');
    console.log('PASS ' + cur);
  }

  cur = '30. 存盘失败（mock 500）：打卡回滚不坏 UI / 弹窗保存失败可重试不重复';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }], log: {} },
      failSave: true
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const S = w.Storage;
    const hb = await home(w);
    const cell = hb.querySelector('[data-hb-cell="h1"][data-date="' + TODAY + '"]');
    cell.click();
    await waitFor(function () {
      return Array.from(doc.querySelectorAll('.toast')).some(function (t) { return t.textContent.indexOf('打卡失败') >= 0; });
    }, { label: '失败提示未出现' });
    assert(bgOf(cell) === normColor('#f2f2f4') && !cell.classList.contains('on'), '失败后格子应回滚');
    assert(statOf(hb, 'h1').indexOf('本月 0 天') >= 0, '失败后卡数据行应回滚，实为 ' + statOf(hb, 'h1'));
    assert(S.habitCountOf('h1', TODAY) === 0, '失败后内存不应残留（防幽灵打卡）');
    assert(!s.calls.some(function (c) { return c.target === 'habits'; }), '失败不应落盘');
    // 计数 +1 同样回滚（先正常加一条计数习惯，再在失败态下 +1）
    s.ctl.failSave = false;
    await S.saveHabitDef({ id: 'h2', name: '喝水', color: '#a8e0e8', type: 'count', max: 5, showNum: true });
    s.ctl.failSave = true;
    const hb3 = await home(w);
    const cell2 = hb3.querySelector('[data-hb-cell="h2"][data-date="' + TODAY + '"]');
    assert(cell2, '计数习惯今日格应在');
    cell2.click();
    await sleep(250);
    assert(S.habitCountOf('h2', TODAY) === 0, '计数存盘失败也应清内存');
    assert(!cell2.classList.contains('on') && !cell2.querySelector('.hb-n') && bgOf(cell2) === normColor('#f2f2f4'), '失败后计数格应回滚（灰/无数字）');
    // 倒计时保存失败：留在弹窗 + 重试不产生重复
    s.ctl.failSave = true;
    doc.querySelector('[data-cd-add]').click();
    const m = lastModal(doc);
    m.querySelector('#cd-name').value = '考试';
    m.querySelector('#cd-date').value = dayN(-10);
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return Array.from(doc.querySelectorAll('.toast')).some(function (t) { return t.textContent.indexOf('保存失败') >= 0 || t.textContent.indexOf('失败') >= 0; });
    }, { label: '倒计时失败提示未出现' });
    assert(lastModal(doc) && lastModal(doc).querySelector('#cd-name'), '保存失败应留在弹窗（可重试）');
    m.querySelector('[data-x=s]').click();
    m.querySelector('[data-x=s]').click(); // 快速重试
    await sleep(250);
    assert(!(s.store.settings.countdowns || []).length, '失败期间不应产生重复倒计时');
    s.ctl.failSave = false;
    m.querySelector('[data-x=s]').click();
    await waitFor(function () { return (s.store.settings.countdowns || []).length === 1; }, { label: '恢复后保存未成功' });
    assert(s.store.settings.countdowns.length === 1, '重试后应只有一条（不重复）');
    console.log('PASS ' + cur);
  }

  /* ==================== 9 多账号 ==================== */
  cur = '31. 多账号隔离：习惯/倒计时不串号 + 落盘带正确 acc';
  {
    const defaults = DEFAULT_DATA();
    const stores = {
      accA: {
        habits: { defs: [{ id: 'ha', name: 'A习惯', color: '#aecbfa' }], log: (function () { const o = {}; o[TODAY] = true; return o; })() },
        settings: { planSections: [], rememberAccount: true, countdowns: [{ id: 'ca', name: 'A生日', date: '2000-12-31', repeat: 'year' }] }
      },
      accB: {
        habits: { defs: [{ id: 'hb', name: 'B习惯', color: '#f6b8d0' }], log: {} },
        settings: { planSections: [], rememberAccount: true, countdowns: [] }
      }
    };
    const calls = [];
    const w = makeWindow({
      routes: {
        'api/session': function (r) {
          return r.ok({ ok: true, accounts: [{ id: 'accA', name: '甲', icon: 'x' }, { id: 'accB', name: '乙', icon: 'y' }], lastAccountId: '', dataRoot: 'm', schemaVersion: 3 });
        },
        'api/account': function (r) {
          return r.ok({ ok: true, accounts: [{ id: 'accA', name: '甲', icon: 'x' }, { id: 'accB', name: '乙', icon: 'y' }], lastAccountId: r.body && r.body.id });
        },
        'api/db': function (r) {
          const acc = /acc=([^&]+)/.exec(r.url) ? decodeURIComponent(/acc=([^&]+)/.exec(r.url)[1]) : 'accA';
          const st = stores[acc] || { habits: { defs: [], log: {} }, settings: {} };
          return r.ok(JSON.parse(JSON.stringify({
            ok: true, schemaVersion: 3,
            account: acc === 'accA' ? { id: 'accA', name: '甲', icon: 'x' } : { id: 'accB', name: '乙', icon: 'y' },
            accounts: [{ id: 'accA', name: '甲', icon: 'x' }, { id: 'accB', name: '乙', icon: 'y' }],
            items: [], outfits: [], events: [], food: [],
            settings: st.settings, categories: defaults.categories, wallet: defaults.wallet,
            habits: st.habits, dataRoot: 'm'
          })));
        },
        'api/save': function (r) {
          calls.push({ target: r.body.target, acc: r.body.acc });
          const st = stores[r.body.acc];
          if (!st) return r.fail({ ok: false, error: '账号不存在' }, 409);
          if (r.body.target === 'habits') st.habits = JSON.parse(JSON.stringify(r.body.data));
          else if (r.body.target === 'settings') st.settings = JSON.parse(JSON.stringify(r.body.data.settings));
          return r.ok({ ok: true });
        }
      }
    });
    const doc = w.document;
    // 登录选甲
    await waitFor(function () { return doc.querySelector('[data-acc="accA"]'); }, { label: '账号选择屏未出现' });
    doc.querySelector('[data-acc="accA"]').click();
    await waitFor(function () { return doc.querySelector('#main-content'); }, { label: '未进入主界面' });
    await sleep(300);
    w.App.go('home');
    await sleep(350);
    assert(doc.querySelector('#home-habits').textContent.indexOf('A习惯') >= 0, '甲应看到自己的习惯');
    assert(doc.querySelector('#home-habits').textContent.indexOf('B习惯') < 0, '不应串到乙的习惯');
    assert(doc.querySelector('#home-cd').textContent.indexOf('A生日') >= 0, '甲应看到自己的倒计时');
    // 甲打卡一条 → acc 正确
    doc.querySelector('#home-habits [data-hb-cell="ha"][data-date="' + TODAY + '"]').click();
    await waitFor(function () {
      return calls.some(function (c) { return c.target === 'habits' && c.acc === 'accA'; });
    }, { label: '甲落盘未带 accA' });
    // 切到乙（设置页切换按钮 = 真实用户动线）
    w.App.go('settings');
    await waitFor(function () { return doc.querySelector('[data-switch="accB"]'); }, { label: '设置页未出切换按钮' });
    doc.querySelector('[data-switch="accB"]').click();
    await waitFor(function () { return w.Storage.accId() === 'accB' ? true : null; }, { label: '未切到乙' });
    await sleep(300);
    w.App.go('home');
    await sleep(350);
    assert(doc.querySelector('#home-habits').textContent.indexOf('B习惯') >= 0, '乙应看到自己的习惯');
    assert(doc.querySelector('#home-habits').textContent.indexOf('A习惯') < 0, '乙不应看到甲的习惯');
    assert(!doc.querySelector('.home-cd-brief') && doc.querySelector('#home-cd').textContent.indexOf('A生日') < 0, '乙不应看到甲的倒计时');
    // 乙打卡 → accB；甲的数据不丢
    doc.querySelector('#home-habits [data-hb-cell="hb"][data-date="' + TODAY + '"]').click();
    await waitFor(function () {
      return calls.some(function (c) { return c.target === 'habits' && c.acc === 'accB'; });
    }, { label: '乙落盘未带 accB' });
    assert(stores.accA.habits.log.ha[TODAY] === true, '甲的打卡应保留在甲仓库');
    assert(!stores.accB.habits.log.ha, '乙仓库不应有甲的记录');
    console.log('PASS ' + cur);
  }

  /* ==================== v1.1.9 拍板 6 项锁 ==================== */
  cur = '32. 闰年 2-29 周年落点：非闰年 2-28（保守早 1 天）/ 闰年 2-29';
  {
    const s = storeWindow({ settings: { countdowns: [{ id: 'c1', name: '闰闰', date: '2000-02-29', repeat: 'year' }] } });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const realToday = w.Utils.todayStr;
    const dayDiff = function (a, b) {
      const pa = a.split('-'), pb = b.split('-');
      return Math.round((new Date(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2])) - new Date(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]))) / 86400000);
    };
    const check = async function (fake, occ, label) {
      const expect = occ ? dayDiff(fake, occ) : 0;
      w.Utils.todayStr = function (d) { return d ? realToday(d) : fake; };
      try {
        await home(w);
        const card = Array.from(doc.querySelectorAll('.cd-card')).filter(function (c) { return c.textContent.indexOf('闰闰') >= 0; })[0];
        assert(card && card.querySelector('.cd-days').textContent.trim() === String(expect),
          label + '：应 ' + expect + ' 天，实为 ' + (card && card.querySelector('.cd-days').textContent));
      } finally {
        w.Utils.todayStr = realToday;
      }
    };
    // 非闰年（2025）：周年落 2-28，不再滚 3-1
    await check('2025-02-27', '2025-02-28', '非闰年 2-27 应指向 2-28');
    await check('2025-02-28', '2025-02-28', '非闰年 2-28 当天应 0 天');
    await check('2025-03-01', '2026-02-28', '非闰年 3-1 后应指下年 2-28');
    // 闰年（2028）：周年仍落 2-29
    await check('2028-01-15', '2028-02-29', '闰年应指向 2-29');
    await check('2028-03-01', '2029-02-28', '闰年过后下个非闰年应落 2-28');
    console.log('PASS ' + cur);
  }

  cur = '33. hero 过期倒计时不显示（全过期无「·」/ 混合时只出最近未过期）';
  {
    // a) 全过期：无简报、无分隔符，卡仍在（折叠组）
    const s = storeWindow({
      settings: { countdowns: [{ id: 'c1', name: '甲', date: dayN(3), repeat: '' }, { id: 'c2', name: '乙', date: dayN(30), repeat: '' }] }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await home(w);
    assert(!doc.querySelector('.home-cd-brief'), '全过期不应有 hero 简报');
    assert(doc.querySelector('.home-date').textContent.indexOf('·') < 0, '全过期日期行不应有「·」');
    assert(doc.querySelectorAll('.cd-card').length === 2, '过期卡应保留（折叠组内）');
    // b) 混合：hero 只取最近未过期，过期的不出现
    const s2 = storeWindow({
      settings: { countdowns: [{ id: 'c1', name: '过期甲', date: dayN(5), repeat: '' }, { id: 'c2', name: '未来乙', date: dayN(-12), repeat: '' }] }
    });
    const w2 = s2.w;
    if (!(await waitMain(w2))) throw new Error('no main');
    await home(w2);
    const brief = w2.document.querySelector('.home-cd-brief');
    assert(brief && brief.textContent.indexOf('未来乙') >= 0 && brief.textContent.indexOf('还有 12 天') >= 0,
      '混合时 hero 应只显示最近未过期，实为 ' + (brief && brief.textContent));
    assert(brief.textContent.indexOf('过期甲') < 0 && brief.textContent.indexOf('已过') < 0,
      'hero 不应出现过期文案');
    console.log('PASS ' + cur);
  }

  cur = '34. 过期一次性折叠组（默认收起/点击展开，每年循环不过期不进组）';
  {
    const s = storeWindow({
      settings: {
        countdowns: [
          { id: 'c1', name: '过期一', date: dayN(3), repeat: '' },
          { id: 'c2', name: '过期二', date: dayN(20), repeat: '' },
          { id: 'c3', name: '生日', date: '2000-01-05', repeat: 'year' }, // 今年周年已过 → 算明年，不过期
          { id: 'c4', name: '未来', date: dayN(-5), repeat: '' }
        ]
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await home(w);
    const toggle = doc.querySelector('[data-cd-exp-toggle]');
    assert(toggle && toggle.textContent.indexOf('已过期 · 2') >= 0, '折叠组标头应「已过期 · 2」，实为 ' + (toggle && toggle.textContent.trim()));
    const body = doc.querySelector('[data-cd-exp-body]');
    assert(body && body.hidden, '折叠组应默认收起');
    const expText = body.textContent;
    assert(expText.indexOf('过期一') >= 0 && expText.indexOf('过期二') >= 0, '过期一次性应进折叠组');
    assert(expText.indexOf('生日') < 0 && expText.indexOf('未来') < 0, '未过期/每年循环不应进折叠组');
    const yearCard = Array.from(doc.querySelectorAll('.cd-card')).filter(function (c) { return c.textContent.indexOf('生日') >= 0; })[0];
    assert(yearCard && !body.contains(yearCard), '每年循环（有下个周年）不应过期进组');
    // 展开/收起
    toggle.click();
    assert(!doc.querySelector('[data-cd-exp-body]').hidden, '点击应展开');
    toggle.click();
    assert(doc.querySelector('[data-cd-exp-body]').hidden, '再点应收起');
    // 折叠组卡保留编辑入口（折叠不删除）
    body.querySelector('.cd-card').click();
    const m = await waitFor(function () { const x = lastModal(doc); return x && x.querySelector('#cd-name') ? x : null; }, { label: '折叠组卡编辑未响应' });
    assert(m.querySelector('#cd-name').value === '过期一', '折叠组卡应可编辑，实为 ' + m.querySelector('#cd-name').value);
    console.log('PASS ' + cur);
  }

  cur = '35. 计数日编辑次数上限 0~99（+/− 与直接输入都限幅）';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '喝水', color: '#aecbfa', type: 'count', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const S = w.Storage;
    const ds = dayN(1);
    await S.setHabitCount('h1', ds, 2);
    const hb = await home(w);
    if (!hb.querySelector('[data-hb-cell="h1"][data-date="' + ds + '"]')) {
      hb.querySelector('[data-hb-mv="-1"]').click(); await sleep(300);
    }
    doc.querySelector('[data-hb-cell="h1"][data-date="' + ds + '"]').click();
    const m = await waitFor(function () { const x = lastModal(doc); return x && x.querySelector('#hd-n') ? x : null; }, { label: '计数编辑弹层未出现' });
    const inp = m.querySelector('#hd-n');
    assert(inp.getAttribute('max') === '99', '次数输入应带 max=99（与定义层对齐）');
    for (let i = 0; i < 120; i++) m.querySelector('[data-hd="1"]').click();
    assert(inp.value === '99', '+ 应限幅 99，实为 ' + inp.value);
    m.querySelector('[data-hd="-1"]').click();
    assert(inp.value === '98', '− 应生效，实为 ' + inp.value);
    inp.value = '150';
    inp.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert(inp.value === '99', '直接输入应限幅 99，实为 ' + inp.value);
    inp.value = '-5';
    inp.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert(inp.value === '0', '直接输入下限应 0，实为 ' + inp.value);
    inp.value = '150'; // 直接输入未触发 input 事件也按保存限幅
    m.querySelector('[data-x=s]').click();
    await waitFor(function () { return S.habitCountOf('h1', ds) === 99; }, { label: '保存应限幅 99' });
    console.log('PASS ' + cur);
  }

  cur = '36. 预设只存被交互那条（打卡/编辑转正、删除墓碑、未交互重启仍是建议）';
  {
    const s = storeWindow({});
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const S = w.Storage;
    let hb = await home(w);
    assert(hb.querySelectorAll('.hb-card').length === 3, '首次应显示预设三例（卡片）');
    // a) 打卡其中一条 → 只存那条；重启后未交互的两条仍是建议
    hb.querySelector('[data-hb-cell="hb_preset_0"][data-date="' + TODAY + '"]').click();
    await waitFor(function () {
      return s.calls.some(function (c) { return c.target === 'habits'; });
    }, { label: '打卡未落盘' });
    let saved = s.calls.filter(function (c) { return c.target === 'habits'; }).pop();
    assert(saved.data.defs.length === 1 && saved.data.defs[0].id === 'hb_preset_0',
      '打卡应只存被交互那条，实为 ' + JSON.stringify(saved.data.defs.map(function (d) { return d.id; })));
    assert(!saved.data.defs[0].__seed, '转正落盘的 def 不应带建议标记');
    await S.loadAll();
    await home(w);
    const defs2 = S.getDB().habits.defs;
    const seeds = defs2.filter(function (d) { return d.__seed; }).map(function (d) { return d.id; }).sort();
    assert(seeds.join(',') === 'hb_preset_1,hb_preset_2', '重启后未交互预设应仍是建议，实为 ' + seeds.join(','));
    assert(defs2.filter(function (d) { return !d.__seed; }).length === 1, '已交互的应为正式 def');
    assert(doc.querySelectorAll('#home-habits .hb-card').length === 3, '重启后应 3 卡（1 正式 + 2 建议）');
    // 建议渲染纯内存零落盘
    const callsBefore = s.calls.length;
    await S.loadAll();
    await home(w);
    assert(s.calls.length === callsBefore, '播种渲染应零落盘');
    // b) 编辑另一条 → 该条转正落盘（0+1 两条；未交互的 2 不落盘）
    doc.querySelector('#home-habits [data-hb-edit="hb_preset_1"]').click();
    const m = lastModal(doc);
    m.querySelector('#hb-name').value = '夜跑';
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return s.calls.some(function (c) {
        return c.target === 'habits' && c.data.defs.some(function (d) { return d.name === '夜跑'; });
      });
    }, { label: '编辑未落盘' });
    saved = s.calls.filter(function (c) { return c.target === 'habits'; }).pop();
    assert(saved.data.defs.length === 2, '编辑后应落盘 2 条（0+1），实为 ' + saved.data.defs.length);
    assert(!saved.data.defs.some(function (d) { return d.id === 'hb_preset_2'; }), '未交互的建议不应落盘');
    // c) 删除预设 → 墓碑：重启不复活；未交互的仍是建议
    await home(w);
    doc.querySelector('#home-habits [data-hb-edit="hb_preset_1"]').click();
    const m2 = lastModal(doc);
    m2.querySelector('[data-hb-del]').click();
    await waitFor(function () { const x = lastModal(doc); return x && x.querySelector('[data-act=yes]'); }, { label: '确认弹窗未出现' });
    lastModal(doc).querySelector('[data-act=yes]').click();
    await waitFor(function () {
      return (s.store.settings.habitPresetGone || []).indexOf('hb_preset_1') >= 0 ? true : null;
    }, { label: '删除墓碑未落盘' });
    await S.loadAll();
    await home(w);
    const ids3 = Array.from(doc.querySelectorAll('#home-habits [data-hb-edit]')).map(function (e) { return e.getAttribute('data-hb-edit'); }).sort();
    assert(ids3.join(',') === 'hb_preset_0,hb_preset_2', '被删预设重启不应复活，实为 ' + ids3.join(','));
    assert(S.getDB().habits.defs.some(function (d) { return d.id === 'hb_preset_2' && d.__seed; }), '未交互的 2 应仍是建议');
    assert(!S.getDB().habits.defs.some(function (d) { return d.id === 'hb_preset_1'; }), '墓碑条不应再出现在 defs');
    console.log('PASS ' + cur);
  }

  cur = '37. 统计页 habitHeat 空数据同款播种（两页温差修复，纯内存零落盘）';
  {
    const s = storeWindow({});
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    // 从未打开主页，直接进统计
    w.App.go('plan');
    const body = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('svg[data-habit-grid]') ? el : null;
    }, { label: 'habitHeat 未渲染' });
    const grids = body.querySelectorAll('svg[data-habit-grid]');
    assert(grids.length === 3, '统计页空数据应播种预设三例，实为 ' + grids.length);
    assert(body.textContent.indexOf('运动') >= 0 && body.textContent.indexOf('早睡') >= 0, '应显示预设名');
    assert(!s.calls.some(function (c) { return c.target === 'habits'; }), '统计页播种应纯内存零落盘');
    const seeds = w.Storage.getDB().habits.defs.filter(function (d) { return d.__seed; });
    assert(seeds.length === 3, '三例都应是建议态，实为 ' + seeds.length);
    // 已删光（habitSeeded）→ 两页都维持空态（既有口径）
    const s2 = storeWindow({ settings: { habitSeeded: true } });
    const w2 = s2.w;
    if (!(await waitMain(w2))) throw new Error('no main');
    w2.App.go('plan');
    const body2 = await waitFor(function () {
      const el = w2.document.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('[data-eg-go=home]') ? el : null;
    }, { label: '空态卡未出现' });
    assert(body2.textContent.indexOf('还没有习惯项') >= 0, '删光后统计页应空态');
    console.log('PASS ' + cur);
  }

  console.log('========== v1.1.5 热力打卡+倒计时 深度模拟（含 v1.1.9 拍板 6 项）：37 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  if (process.env.SIM_DEBUG) console.error(e && e.stack);
  process.exit(1);
});
