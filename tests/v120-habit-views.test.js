/* v120-habit-views.test.js — v1.2.x 热力打卡 UI 改造回归锁（拍板 1 完成态 + 拍板 2 周/月/年视图）
   1 完成态 .hb-card.done：今日打卡绿卡/取消还原/即时同步/只看今天/无文字提示（作者修正版）+ CSS 配方锁
   2 主页 周|月 视图：seg-toggle/默认月（既有锁）/周一行 7 格/翻周翻月/今天/切换保持锚日/局部重绘不回顶
   3 统计 habitHeat 周|月|年 + 年视图二级 月块|连续：默认 年+月块 锁/连续平铺形态/月历只读/周一行 7 格
   4 既有元素保留：管理习惯空态/当年计数/最长连续/梯度色/showNum
   与 v118-habit-sim（37 项）/v117-habits/v120-stats-ui 并行不冲突；JSDOM 不加载外部 CSS，
   样式断言走 extra.css 文本锁；落盘/重启用内存仓库 mock（api/db + api/save），不改共享 harness。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWindow, waitFor, sleep, lastModal, waitNoModal, waitMain, assert, DEFAULT_DATA, APP } = require('./helpers/harness');

function pad(n) { return String(n).padStart(2, '0'); }
function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function dayN(n) { const d = new Date(); d.setDate(d.getDate() - n); return fmt(d); }
const TODAY = fmt(new Date());
const Y = new Date().getFullYear();
const M = new Date().getMonth() + 1;
const D = new Date().getDate();
const DAYS_IN_M = new Date(Y, M, 0).getDate();

/* 内存仓库窗口（同 v118 口径）：api/db 读仓库、api/save 写仓库 */
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

function monthLabelText(doc) {
  const l = doc.querySelector('#home-habits .hb-month-label');
  return l ? l.textContent.trim() : '';
}

/* 周区间标签（周一~周日，M/D ~ M/D） */
function weekRangeLabel(base) {
  const dow = (base.getDay() + 6) % 7;
  const mon = new Date(base.getFullYear(), base.getMonth(), base.getDate() - dow);
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  return (mon.getMonth() + 1) + '/' + mon.getDate() + ' ~ ' + (sun.getMonth() + 1) + '/' + sun.getDate();
}

/* 月视图翻月后的锚日/标签（与实现同款：同日换月、短月夹到月末） */
function shiftMonth(delta) {
  const target = new Date(Y, M - 1 + delta, 1);
  const dim = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(D, dim));
  return target;
}

let cur = '';

async function main() {
  cur = '';

  /* ==================== 1 完成态（拍板 1，作者修正：只变绿不加字） ==================== */
  cur = '1. 完成态：今日打卡即时绿卡（.hb-card.done）+ 取消还原 + 无文字提示 + CSS 配方锁';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const hb = await home(w);
    const card = hb.querySelector('[data-hb-card="h1"]');
    assert(card && !card.classList.contains('done'), '今日未打应为现状白卡（无 done）');
    const cell = hb.querySelector('[data-hb-cell="h1"][data-date="' + TODAY + '"]');
    cell.click(); // 打卡：done 态与格子变色同步即时切换
    assert(card.classList.contains('done'), '今日打卡后卡片应即时变 done（乐观更新）');
    assert(card.textContent.indexOf('今日已打卡') < 0 && card.textContent.indexOf('✓') < 0,
      '作者修正：完成态不加文字提示（只卡片变绿），实为 ' + card.textContent);
    cell.click(); // 取消：done 态同步消失
    assert(!card.classList.contains('done'), '取消打卡后 done 态应即时消失');
    // 落盘一致性：再打一次，updateHabitStat 路径一并同步 done
    cell.click();
    await waitFor(function () {
      return s.store.habits.log.h1 && s.store.habits.log.h1[TODAY] ? true : null;
    }, { label: '打卡未落盘' });
    assert(card.classList.contains('done'), '落盘成功后 done 态应保持');
    // CSS 配方锁：对齐 home-check.done（绿边 #34c759 + 淡绿底 #f0faf2）
    const css = fs.readFileSync(path.join(APP, 'css', 'extra.css'), 'utf8');
    const rule = /\.hb-card\.done\s*\{[^}]*\}/.exec(css);
    assert(rule, 'extra.css 应有 .hb-card.done 完成态规则');
    assert(/border-color:\s*#34c759/.test(rule[0]) && /background:\s*#f0faf2/.test(rule[0]),
      '.hb-card.done 应对齐 home-check.done 配方（#34c759/#f0faf2），实为 ' + rule[0]);
    console.log('PASS ' + cur);
  }

  cur = '2. 完成态：计数习惯 +1 绿卡 / 清零还原（updateHabitStat 一并更新）';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '喝水', color: '#aecbfa', type: 'count', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const hb = await home(w);
    const card = hb.querySelector('[data-hb-card="h1"]');
    const cell = hb.querySelector('[data-hb-cell="h1"][data-date="' + TODAY + '"]');
    cell.click();
    assert(card.classList.contains('done'), '计数 +1 后卡片应 done');
    cell.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); // 右键 -1 → 0
    assert(!card.classList.contains('done'), '清零后 done 态应消失');
    cell.click(); cell.click();
    assert(card.classList.contains('done'), '计数 +2 后卡片应 done');
    await waitFor(function () {
      return (s.store.habits.log.h1[TODAY] || 0) === 2 ? true : null;
    }, { label: '计数未落盘' });
    console.log('PASS ' + cur);
  }

  cur = '3. 完成态只看今天：补打/取消历史格不动 done 态';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const hb = await home(w);
    const card = hb.querySelector('[data-hb-card="h1"]');
    const yCell = hb.querySelector('[data-hb-cell="h1"][data-date="' + dayN(1) + '"]');
    yCell.click(); // 补打昨天
    assert(!card.classList.contains('done'), '补打历史格不应触发 done');
    const cell = hb.querySelector('[data-hb-cell="h1"][data-date="' + TODAY + '"]');
    cell.click();
    assert(card.classList.contains('done'), '今日打卡应触发 done');
    yCell.click(); // 取消昨天
    assert(card.classList.contains('done'), '取消历史格不应影响 done（只看今天）');
    cell.click();
    assert(!card.classList.contains('done'), '取消今日后 done 应消失');
    console.log('PASS ' + cur);
  }

  /* ==================== 2 主页 周|月 视图（拍板 2） ==================== */
  cur = '4. 主页 seg-toggle「周|月」：默认周视图（v1.2.3 拍板）';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const hb = await home(w);
    const seg = hb.querySelector('.seg-toggle-head');
    assert(seg, 'panel-head 右上应有 seg-toggle（seg-toggle-head 同款）');
    assert(seg.querySelector('[data-hb-view="week"]') && seg.querySelector('[data-hb-view="month"]'), '应有 周|月 两档');
    // v1.2.3 拍板：默认周视图（周区间标签 + 表格 7 格）
    assert(seg.querySelector('[data-hb-view="week"]').classList.contains('on'), '默认应周视图');
    assert(/\d{1,2}\/\d{1,2} ~ \d{1,2}\/\d{1,2}/.test(monthLabelText(doc)), '周区间标签，实为 ' + monthLabelText(doc));
    assert(hb.querySelectorAll('[data-hb-cell="h1"]').length === 7, '周视图 7 格');
    assert(hb.querySelector('.hb-row'), '默认应为表格行');
    console.log('PASS ' + cur);
  }

  cur = '5. 周视图形态：每卡一行 7 格（.hb-week）+ 周几标签 + 今日描边 + 未来 disabled';
  {
    const s = storeWindow({
      habits: {
        defs: [
          { id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true },
          { id: 'h2', name: '喝水', color: '#d7aefb', type: 'count', max: 5, showNum: true }
        ],
        log: {}
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    let hb = await home(w);
    hb.querySelector('[data-hb-view="week"]').click();
    hb = doc.querySelector('#home-habits');
    assert(/^\d{1,2}\/\d{1,2} ~ \d{1,2}\/\d{1,2}$/.test(monthLabelText(doc)),
      '周标签应为「M/D ~ M/D」周区间，实为 ' + monthLabelText(doc));
    assert(monthLabelText(doc) === weekRangeLabel(new Date()), '周区间应=锚日（今天）所在周');
    ['h1', 'h2'].forEach(function (id) {
      const cells = hb.querySelectorAll('[data-hb-cell="' + id + '"]');
      assert(cells.length === 7, id + ' 周视图应一行 7 格，实为 ' + cells.length);
    });
    // v1.2.3 表格化：格子直接在行网格内（每行 7 格），列头=习惯+周几 7 列（只周几无日期）
    assert(hb.querySelectorAll('.hb-row').length >= 2, '周视图应为表格行');
    assert(hb.querySelectorAll('.hb-th').length === 8, '列头=习惯+周几 7 列');
    assert(!/\d/.test(hb.querySelector('.hb-th:not(.hb-th-name)').textContent), '列头只周几不带日期');
    hb.querySelectorAll('.hb-row').forEach(function (c) {
      assert(c.querySelectorAll('.hb-cell').length === 7, '每行 7 格');
    });
    const tCell = hb.querySelector('[data-hb-cell="h1"][data-date="' + TODAY + '"]');
    assert(tCell.classList.contains('today'), '今日格应描边（today）');
    hb.querySelectorAll('[data-hb-cell]').forEach(function (c) {
      const ds = c.getAttribute('data-date');
      if (ds > TODAY) assert(c.disabled, '未来格应 disabled：' + ds);
    });
    console.log('PASS ' + cur);
  }

  cur = '6. 周视图交互不变：计数 +1/右键 -1、二值 toggle、历史格弹编辑、数据行/done 同步';
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
    const doc = w.document;
    const S = w.Storage;
    let hb = await home(w);
    hb.querySelector('[data-hb-view="week"]').click();
    hb = doc.querySelector('#home-habits');
    const cellC = hb.querySelector('[data-hb-cell="hc"][data-date="' + TODAY + '"]');
    cellC.click(); cellC.click();
    assert(S.habitCountOf('hc', TODAY) === 2, '周视图计数今日格 +1×2 应=2');
    const cardC = hb.querySelector('[data-hb-card="hc"]');
    assert(cardC.classList.contains('done'), '计数打卡后 done 应同步');
    // v1.2.3 拍板：周视图不显示统计行（月视图才有）——数据由 habitCountOf 断言锁
    assert(!cardC.querySelector('.hb-card-stat'), '周视图不应显示统计行');
    cellC.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    assert(S.habitCountOf('hc', TODAY) === 1, '周视图右键应 -1');
    // 二值今日 toggle
    const cellK = hb.querySelector('[data-hb-cell="hk"][data-date="' + TODAY + '"]');
    cellK.click();
    assert(S.habitCountOf('hk', TODAY) === 1 && hb.querySelector('[data-hb-card="hk"]').classList.contains('done'),
      '周视图二值 toggle + done 同步');
    cellK.click();
    assert(S.habitCountOf('hk', TODAY) === 0, '周视图二值再点应取消');
    // 历史格：计数弹编辑（同月视图口径）
    const yCell = hb.querySelector('[data-hb-cell="hc"][data-date="' + dayN(1) + '"]');
    yCell.click();
    const m = lastModal(doc);
    assert(m && m.querySelector('#hd-n'), '周视图计数历史格应弹日编辑层');
    m.querySelector('[data-x=c]').click();
    await waitNoModal(doc);
    console.log('PASS ' + cur);
  }

  cur = '7. 翻周/翻月 + 「今天」+ 周月切换保持锚日 + 翻页局部重绘不回顶';
  {
    const s = storeWindow({
      habits: { defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }], log: {} }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    let hb = await home(w);
    const cdPanel = doc.querySelector('#home-cd'); // 局部重绘哨兵（其他面板节点应保持同一节点）
    assert(cdPanel, '倒计时面板应存在（哨兵）');
    // 切月视图后翻月（v1.2.3 默认周）
    hb.querySelector('[data-hb-view="month"]').click();
    hb = doc.querySelector('#home-habits');
    hb.querySelector('[data-hb-mv="-1"]').click();
    const pm = shiftMonth(-1);
    assert(monthLabelText(doc) === pm.getFullYear() + ' 年 ' + (pm.getMonth() + 1) + ' 月',
      '月视图 ‹ 应翻上月，实为 ' + monthLabelText(doc));
    assert(doc.querySelector('#home-cd') === cdPanel, '翻页应局部重绘（#home-cd 节点不换）');
    // 切周视图：保持锚日（=翻月后的锚），显示锚日所在周
    hb = doc.querySelector('#home-habits');
    hb.querySelector('[data-hb-view="week"]').click();
    assert(monthLabelText(doc) === weekRangeLabel(pm), '切周应保持锚日所在周，实为 ' + monthLabelText(doc));
    // 周视图翻周（锚日 ±7 天）
    hb = doc.querySelector('#home-habits');
    hb.querySelector('[data-hb-mv="-1"]').click();
    const wPrev = new Date(pm.getFullYear(), pm.getMonth(), pm.getDate() - 7);
    assert(monthLabelText(doc) === weekRangeLabel(wPrev), '周视图 ‹ 应翻上一周，实为 ' + monthLabelText(doc));
    // 「今天」跳回今天所在周
    hb = doc.querySelector('#home-habits');
    hb.querySelector('[data-hb-today]').click();
    assert(monthLabelText(doc) === weekRangeLabel(new Date()), '今天按钮应回本周，实为 ' + monthLabelText(doc));
    // 切回月视图：锚日=今天 → 本月
    hb = doc.querySelector('#home-habits');
    hb.querySelector('[data-hb-view="month"]').click();
    assert(monthLabelText(doc) === Y + ' 年 ' + M + ' 月', '切月应回本月，实为 ' + monthLabelText(doc));
    assert(doc.querySelector('#home-cd') === cdPanel, '切视图应局部重绘（不整页刷新不回顶）');
    console.log('PASS ' + cur);
  }

  /* ==================== 3 统计 habitHeat 周|月|年 + 月块|连续（拍板 2） ==================== */
  cur = '8. 统计 head seg-toggle「周|月|年」+ 二级「月块|连续」：默认 年+月块（既有锁不破）';
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
    w.App.go('plan');
    const body = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('svg[data-habit-grid]') ? el : null;
    }, { label: 'habitHeat 未渲染' });
    const sec = doc.querySelector('.plan-sec[data-id=habitHeat]');
    const seg = sec.querySelector('.panel-head .hh-toggle');
    assert(seg && seg.classList.contains('seg-toggle-head'), 'head 右上应有 seg-toggle-head 同款切换器');
    assert(seg.querySelector('[data-hh-view="week"]') && seg.querySelector('[data-hh-view="month"]') &&
      seg.querySelector('[data-hh-view="year"]'), '应有 周|月|年 三档');
    assert(seg.querySelector('[data-hh-view="year"]').classList.contains('on'), '默认应年视图');
    const sub = seg.querySelector('.hh-sub');
    assert(sub && !sub.hidden, '年视图应显示二级切换 月块|连续');
    assert(sub.querySelector('[data-hh-y-mode="blocks"]').classList.contains('on'), '默认应月块形态');
    // 既有锁：默认年+月块 = 12 独立月块
    const g = body.querySelector('svg[data-habit-grid]');
    assert(g.getAttribute('data-months') === '12' && g.getAttribute('data-year') === String(Y), '默认应今年 12 月块');
    console.log('PASS ' + cur);
  }

  cur = '9. 年视图「连续」：GitHub 式连续平铺（列=周/行=周几/月标签/月间间隔）+ 切回月块 + 翻年';
  {
    const s = storeWindow({
      habits: {
        defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }],
        log: { h1: (function () { const o = {}; o[(Y - 1) + '-06-15'] = true; o[TODAY] = true; return o; })() }
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('plan');
    await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('svg[data-habit-grid]') ? el : null;
    }, { label: 'habitHeat 未渲染' });
    doc.querySelector('.plan-sec[data-id=habitHeat] [data-hh-y-mode="cont"]').click();
    const body = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('svg[data-habit-grid][data-months="cont"]') ? el : null;
    }, { label: '连续形态未渲染' });
    const g = body.querySelector('svg[data-habit-grid]');
    assert(g.getAttribute('data-year') === String(Y), '连续形态应保持今年，实为 ' + g.getAttribute('data-year'));
    const texts = Array.from(g.querySelectorAll('text')).map(function (t) { return t.textContent; });
    for (let mm = 1; mm <= 12; mm++) assert(texts.indexOf(mm + '月') >= 0, '连续形态缺 ' + mm + '月标签');
    const labels = Array.from(g.querySelectorAll('text'));
    for (let i = 1; i < labels.length; i++) {
      assert(Number(labels[i].getAttribute('x')) > Number(labels[i - 1].getAttribute('x')),
        '月标签应随周列递增（连续平铺 + 月间间隔），实为 x=' + labels[i].getAttribute('x'));
    }
    assert(Number(labels[0].getAttribute('x')) === 20, '1 月标签应落在首列 x=20，实为 ' + labels[0].getAttribute('x'));
    const rects = Array.from(g.querySelectorAll('rect'));
    const elapsed = Math.round((new Date(Y, M - 1, D) - new Date(Y, 0, 1)) / 86400000) + 1;
    assert(rects.length === elapsed, '连续形态应只画到今天（未来不画），实为 ' + rects.length + ' / ' + elapsed);
    assert(rects[0].getAttribute('width') === '11' && rects[0].getAttribute('height') === '11', '格应 11px');
    rects.forEach(function (r) {
      assert(/^\d{4}-\d{2}-\d{2}$/.test(r.getAttribute('data-hdate')), '格应带 YYYY-MM-DD 日期键');
    });
    // 连续形态下翻年仍夹紧（minYear=去年）；导航 v1.1.8 挪到 head 右上（.hh-head-nav）
    doc.querySelector('.plan-sec[data-id=habitHeat] [data-hy=prev]').click();
    const body2 = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('svg[data-habit-grid][data-months="cont"][data-year="' + (Y - 1) + '"]') ? el : null;
    }, { label: '连续形态未翻到去年' });
    doc.querySelector('.plan-sec[data-id=habitHeat] [data-hy=prev]').click();
    await sleep(150);
    assert(body2.querySelector('svg[data-habit-grid]').getAttribute('data-year') === String(Y - 1), '连续形态翻年应夹紧');
    // 切回月块
    doc.querySelector('.plan-sec[data-id=habitHeat] [data-hh-y-mode="blocks"]').click();
    const body3 = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('svg[data-habit-grid][data-months="12"]') ? el : null;
    }, { label: '未切回月块' });
    assert(body3.querySelector('svg[data-habit-grid]').getAttribute('data-months') === '12', '切回应 12 月块');
    console.log('PASS ' + cur);
  }

  cur = '10. 统计月视图：只读月历（无交互）+ 月份导航 ‹ › + 格数/既有口径保留';
  {
    const s = storeWindow({
      habits: {
        defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }],
        log: { h1: (function () { const o = {}; o[dayN(1)] = true; o[dayN(2)] = true; return o; })() }
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const S = w.Storage;
    w.App.go('plan');
    await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('svg[data-habit-grid]') ? el : null;
    }, { label: 'habitHeat 未渲染' });
    doc.querySelector('.plan-sec[data-id=habitHeat] [data-hh-view="month"]').click();
    const body = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('.hh-cal-grid') && doc.querySelector('.hh-head-nav [data-hhm=prev]') ? el : null;
    }, { label: '月视图未渲染' });
    assert(doc.querySelector('.plan-sec[data-id=habitHeat] [data-hh-view="month"]').classList.contains('on'), '选中态应同步到 head');
    // 导航 v1.1.8 挪到 head 右上（.hh-head-nav），与视图切换器同排
    assert(doc.querySelector('.hh-head-nav strong').textContent.trim() === Y + ' 年 ' + M + ' 月',
      '月视图标题应「YYYY 年 M 月」，实为 ' + doc.querySelector('.hh-head-nav strong').textContent);
    const cells = body.querySelectorAll('.hh-cal-grid .hh-cell');
    const real = body.querySelectorAll('.hh-cal-grid .hh-cell:not(.empty)');
    assert(real.length === DAYS_IN_M, '月历格数应=当月天数，实为 ' + real.length);
    assert(cells.length >= DAYS_IN_M, '月历含前导空格');
    assert(body.querySelectorAll('.hh-week-labels span').length === 7, '应有周几标签');
    // 既有元素保留：当年计数 / 最长连续
    const text = body.textContent;
    assert(text.indexOf('打卡 ' + S.habitYearCount('h1', Y) + ' 天') >= 0 && text.indexOf('最长连续') >= 0,
      '当年计数/最长连续应保留: ' + text.slice(0, 160));
    // 只读：格非按钮、无 data-hb-cell、点击不落库不弹层
    const cell = body.querySelector('.hh-cal-grid .hh-cell.today') || real[real.length - 1];
    assert(cell.tagName === 'SPAN' && !cell.getAttribute('data-hb-cell'), '统计月历格应只读（无交互属性）');
    cell.click();
    await sleep(120);
    assert(!doc.querySelector('.modal'), '只读格点击不应弹层');
    assert(S.habitCountOf('h1', cell.getAttribute('title').slice(0, 10)) >= 0 && !s.calls.some(function (c) {
      return c.target === 'habits';
    }), '只读格点击不应落盘');
    // 月份导航 ‹ ›（v1.1.8 在 head 右上）
    doc.querySelector('.hh-head-nav [data-hhm=prev]').click();
    const pm = shiftMonth(-1);
    await waitFor(function () {
      const el = doc.querySelector('.hh-head-nav strong');
      return el && el.textContent.trim() === pm.getFullYear() + ' 年 ' + (pm.getMonth() + 1) + ' 月' ? true : null;
    }, { label: '月视图未翻上月' });
    const real2 = doc.querySelectorAll('[data-body=habitHeat] .hh-cal-grid .hh-cell:not(.empty)');
    const dim = new Date(pm.getFullYear(), pm.getMonth() + 1, 0).getDate();
    assert(real2.length === dim, '上月格数应=上月天数，实为 ' + real2.length + ' / ' + dim);
    console.log('PASS ' + cur);
  }

  cur = '11. 统计周视图：每习惯一行 7 格 + 周几标签 + 只读（本周）';
  {
    const s = storeWindow({
      habits: {
        defs: [
          { id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true },
          { id: 'h2', name: '喝水', color: '#d7aefb', type: 'count', max: 5, showNum: false }
        ],
        log: { h2: (function () { const o = {}; o[TODAY] = 3; return o; })() }
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('plan');
    await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('svg[data-habit-grid]') ? el : null;
    }, { label: 'habitHeat 未渲染' });
    doc.querySelector('.plan-sec[data-id=habitHeat] [data-hh-view="week"]').click();
    const body = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('.hh-week-grid') ? el : null;
    }, { label: '周视图未渲染' });
    assert((doc.querySelector('.plan-sec[data-id=habitHeat]') || body).textContent.indexOf('本周') >= 0,
      '周视图应标注本周（v1.1.8 标注随导航挪到 head 右上）');
    const grids = body.querySelectorAll('.hh-week-grid');
    assert(grids.length === 2, '每习惯一周行，实为 ' + grids.length);
    grids.forEach(function (g2) {
      assert(g2.querySelectorAll('.hh-cell').length === 7, '周行应 7 格');
    });
    assert(body.querySelectorAll('.hh-week-labels span').length === 14, '每卡应有周几标签行（2 习惯 ×7）');
    // 只读 + showNum：h2 计数格心数字应显（showNum=false 不显——h2 showNum:false）
    const cell = body.querySelector('.hh-week-grid .hh-cell');
    assert(cell.tagName === 'SPAN' && !cell.getAttribute('data-hb-cell'), '周视图格应只读');
    assert(body.querySelectorAll('.hh-num').length === 0, 'showNum=false 不显格心数字');
    console.log('PASS ' + cur);
  }

  cur = '12. 视图切换只重绘本栏目 body（不整页刷新）+ 空态「管理习惯」任意视图保留';
  {
    const s = storeWindow({
      habits: {
        defs: [{ id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true }],
        log: {}
      }
    });
    const w = s.w;
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('plan');
    await waitFor(function () {
      return doc.querySelector('[data-body=habitHeat] svg[data-habit-grid]') ? true : null;
    }, { label: 'habitHeat 未渲染' });
    const other = doc.querySelector('[data-body=wBalance]');
    assert(other, 'wBalance 栏目应存在（哨兵）');
    const seg = doc.querySelector('.plan-sec[data-id=habitHeat] .hh-toggle');
    seg.querySelector('[data-hh-view="month"]').click();
    seg.querySelector('[data-hh-view="week"]').click();
    seg.querySelector('[data-hh-view="year"]').click();
    assert(doc.querySelector('[data-body=wBalance]') === other, '视图切换应只重绘 habitHeat body（其他栏目节点不换）');
    // 空态：任意视图都保留「管理习惯」引导
    const s2 = storeWindow({ settings: { habitSeeded: true } });
    const w2 = s2.w;
    if (!(await waitMain(w2))) throw new Error('no main');
    const doc2 = w2.document;
    w2.App.go('plan');
    await waitFor(function () {
      const el = doc2.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('[data-eg-go=home]') ? el : null;
    }, { label: '空态卡未出现' });
    doc2.querySelector('.plan-sec[data-id=habitHeat] [data-hh-view="week"]').click();
    const b2 = await waitFor(function () {
      const el = doc2.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('[data-eg-go=home]') ? el : null;
    }, { label: '周视图空态未保留' });
    assert(b2.textContent.indexOf('还没有习惯项') >= 0, '周视图空态应保留管理习惯引导');
    console.log('PASS ' + cur);
  }

  cur = '13. CSS 锁：.hb-card.done 配方 / .hb-week / .hh- 前缀视图样式 + 花括号平衡';
  {
    const css = fs.readFileSync(path.join(APP, 'css', 'extra.css'), 'utf8');
    let open = 0, close = 0;
    for (let i = 0; i < css.length; i++) {
      if (css[i] === '{') open++;
      if (css[i] === '}') close++;
    }
    assert(open === close, 'extra.css 花括号不平衡：{=' + open + ' }=' + close);
    assert(/\.hb-card\.done\s*\{/.test(css), '缺 .hb-card.done');
    assert(/\.hb-card-grid\.hb-week|\.hb-week\b/.test(css), '缺 .hb-week 周视图样式');
    assert(/\.hh-toggle/.test(css) && /\.hh-sub/.test(css), '缺 .hh-toggle/.hh-sub 视图切换样式');
    assert(/\.hh-cell/.test(css) && /\.hh-cal/.test(css) && /\.hh-week-labels/.test(css), '缺 .hh-* 视图格样式');
    console.log('PASS ' + cur);
  }

  cur = '14. 周视图表格化（习惯名左列 + 周几列头，功能不变）';
  {
    const w = makeWindow({
      data: {
        habits: {
          defs: [
            { id: 'h1', name: '运动', type: 'check', color: '#aecbfa' },
            { id: 'h2', name: '阅读', type: 'count', color: '#d7aefb' }
          ],
          log: { h1: {} }
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await waitFor(function () { return doc.querySelector('[data-hb-view=week]') ? true : null; }, { label: '周月切换未渲染' });
    doc.querySelector('[data-hb-view=week]').click();
    await waitFor(function () {
      return doc.querySelector('#home-habits .hb-row') ? true : null;
    }, { label: '周视图表格未渲染' });
    const rows = doc.querySelectorAll('#home-habits .hb-row');
    assert(rows.length === 2, '应两行（每习惯一行）: ' + rows.length);
    assert(doc.querySelectorAll('#home-habits .hb-th').length === 8, '列头=习惯+7 天');
    assert(rows[0].querySelectorAll('.hb-cell').length === 7, '每行 7 格');
    assert(rows[0].querySelector('.hb-row-label').textContent === '运动', '左列=习惯名');
    assert(doc.querySelectorAll('#home-habits .hb-card').length === 0, '周视图不出卡片');
    // 点格子打卡（交互零改动）：check 型任意格=toggle（count 型历史格弹编辑是既有语义）
    rows[0].querySelectorAll('.hb-cell')[2].click();
    await waitFor(function () {
      const lg = w.Storage.getDB().habits.log.h1 || {};
      return Object.keys(lg).length > 0 ? true : null;
    }, { label: '表格格子打卡未生效' });
    // 切月视图仍是卡片
    doc.querySelector('[data-hb-view=month]').click();
    await waitFor(function () {
      return doc.querySelector('#home-habits .hb-card') ? true : null;
    }, { label: '月视图卡片未渲染' });
    console.log('PASS 14. ' + cur);
  }

  cur = '15. 对齐固化：表头/行共用 .hb-tr 模板 + 格子正方 + 连续打卡';
  {
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'app', 'css', 'extra.css'), 'utf8');
    // 单源模板锁：只允许一条含 clamp(≤+20%) 的 7 列网格模板（曾 5 条规则打架致对齐反复坏）
    const m = css.match(/grid-template-columns:[^;]*repeat\(7, clamp[^;]*;/g) || [];
    assert(m.length === 1, '应仅一条定稿网格模板，实为 ' + m.length);
    assert(/\.hb-row \.hb-cell \{[^}]*aspect-ratio: 1/.test(css), '格子应正方（aspect-ratio:1）');
    assert(/\.hb-row-streak/.test(css), '连续打卡样式存在');
    const w = makeWindow({
      data: { habits: { defs: [{ id: 'h1', name: '运动健身打卡', type: 'check', color: '#aecbfa' }], log: { h1: {} } } }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await waitFor(function () { return doc.querySelector('[data-hb-view=week]') ? true : null; }, { label: 'x' });
    doc.querySelector('[data-hb-view=week]').click();
    await waitFor(function () { return doc.querySelector('.hb-row') ? true : null; }, { label: 'x' });
    assert(doc.querySelector('.hb-thead').classList.contains('hb-tr'), '表头应带 hb-tr（共用模板）');
    assert(doc.querySelector('.hb-row').classList.contains('hb-tr'), '数据行应带 hb-tr（共用模板）');
    console.log('PASS 15. ' + cur);
  }

  console.log('========== v1.2.x 热力打卡 UI 改造（完成态+周/月/年视图+周表格化）：15 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  if (process.env.SIM_DEBUG) console.error(e && e.stack);
  process.exit(1);
});
