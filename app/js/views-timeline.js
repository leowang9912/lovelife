/* views-timeline.js — 时间日历（v1.2.01）
   周视图时间轴（周一为第一列）：时间段块 + 记录类时间点 + 待办时间点（todos 派生，不双份存储）
   · 录入三入口：点空白（预填该时刻）/ 卡头「+」/ 条目悬停「再来一条」
   · 计时器：开始→结束自动生成时间段（持久化，重启可续）
   · 重叠并排分栏；跨天录入自动拆分；拖拽移动/底边拉伸改时间
   · 习惯综合联动：linkHabitId 保存=习惯+1、删除回退（storage.timelineHabitSync，再串待办）
   · 卡头两档：「时间记录 | 待办」（待办档=简化版，只看时间点） */
'use strict';
window.TimelineView = (function () {
  const S = window.Storage, U = window.Utils, UI = window.UI;
  const HOUR_H = 44; // 每小时像素（半小时 22px）
  let weekStart = ''; // 模块态：本周一 YYYY-MM-DD；'' = 今天所在周
  // v1.2.01 合并视图：两档切换已删（时间点/时间段同屏聚合）
  let tickTimer = null;

  function resetState() { weekStart = ''; }
  /* 卡头状态变化后局部刷新（容器是 #main-content——曾误用 #main 导致整 body 重置） */
  function refreshSelf() {
    const main = document.getElementById('main-content');
    // 数据操作后的自刷新：保持滚动（不回顶）
    if (main && main.querySelector('#tl-card')) render(main, true);
  }

  /* ---------- 时间/日期小工具 ---------- */
  function parseHM(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return 0;
    return Math.min(24 * 60, Math.max(0, Number(m[1]) * 60 + Number(m[2])));
  }
  function fmtHM(min) {
    min = Math.round(min);
    if (min >= 24 * 60) return '24:00'; // 当日尽头（end 合法值）；取模会绕回 00:00 引发误拆跨天
    min = ((min % (24 * 60)) + 24 * 60) % (24 * 60);
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  }
  function addDays(ds, n) {
    const p = ds.split('-');
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n);
    return U.todayStr(d);
  }
  function mondayOf(ds) {
    const p = ds.split('-');
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return U.todayStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)));
  }
  function weekDates() {
    const base = weekStart || mondayOf(U.todayStr());
    const out = [];
    for (let i = 0; i < 7; i++) out.push(addDays(base, i));
    return out;
  }
  function durText(min) {
    if (min < 60) return min + '分钟';
    const h = Math.floor(min / 60), m = min % 60;
    return h + '小时' + (m ? m + '分钟' : '');
  }
  function typeOf(id) {
    const ts = (S.timeline() || {}).types || [];
    for (let i = 0; i < ts.length; i++) if (ts[i].id === id) return ts[i];
    return { id: id, name: id, icon: 'circle', color: '#aeaeb2' };
  }
  /* 实心胶囊底色压深（白字对比度，浅色系不至于看不清） */
  function darkenHex(hex) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''));
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const f = 0.72;
    const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
  function habitOf(id) {
    const hs = ((S.getDB().habits || {}).defs) || [];
    for (let i = 0; i < hs.length; i++) if (hs[i].id === id) return hs[i];
    return null;
  }

  /* 重叠并排（Google 式簇内分列）：返回 [{rec, col, cols, startMin, endMin}] */
  function layoutBlocks(list) {
    const items = list.map(function (b) {
      const s = parseHM(b.start), e0 = parseHM(b.end);
      return { rec: b, s: s, e: e0 > s ? e0 : s + 1 }; // end<=start 保底 1 分钟
    }).sort(function (a, b) { return a.s - b.s || a.e - b.e; });
    const out = [];
    let cluster = [], clusterEnd = -1;
    function flush() {
      if (!cluster.length) return;
      // 贪心分列
      const cols = [];
      cluster.forEach(function (it) {
        let ci = 0;
        while (cols[ci] && cols[ci] > it.s) ci++;
        cols[ci] = it.e;
        it.col = ci;
      });
      const n = Math.max(1, cols.length);
      cluster.forEach(function (it) { out.push({ rec: it.rec, col: it.col, cols: n, startMin: it.s, endMin: it.e }); });
      cluster = [];
    }
    items.forEach(function (it) {
      if (cluster.length && it.s >= clusterEnd) { flush(); clusterEnd = -1; }
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.e);
    });
    flush();
    return out;
  }

  /* 待办时间点（todos 派生——同一条数据，首页改了日历跟着变） */
  function todoSpansOf(dateStr) {
    const defs = ((S.getDB().todos || {}).defs) || [];
    return defs.filter(function (d) {
      return d && !d.archived && !d.start && S.todoDueOn(d, dateStr); // 时间段待办走计划段，不重复出菱形点
    }).map(function (d) {
      return { def: d, dateStr: dateStr, done: !!S.todoStatus(d.id, dateStr) };
    });
  }
  /* 过夜时间段待办（start > due）：显示/物化都按天拆两段（与手工跨天录入同构） */
  function isOvernight(d) {
    return !!(d && d.start && d.due && parseHM(d.due) < parseHM(d.start));
  }
  /* 计划段（v1.2.4 状态机）：时间段待办（def.start）未完成=计划态派生显示；
     done 已物化为事实段（不再派生）；skipped 仍显示计划段（待手工删除，拍板 3）。
     v1.2.5：过夜实例按天拆两段显示——本日列只出**属于本日**的段：
     当天实例的头段（start→24:00）+ 前一天过夜实例的尾段（00:00→due）；
     返回 {def, instDate, start, end, endLabel, isTail}——完成按钮带实例日，
     在尾段（次日列）勾完成仍落回当天实例 */
  function planSpansOf(dateStr) {
    const defs = ((S.getDB().todos || {}).defs) || [];
    const out = [];
    defs.forEach(function (d) {
      if (!d || d.archived || !d.start || !S.todoDueOn(d, dateStr)) return;
      if (S.todoStatus(d.id, dateStr) === 'done') return;
      const end = d.due || d.start;
      out.push({
        def: d, instDate: dateStr, start: d.start,
        end: isOvernight(d) ? '24:00' : end, endLabel: end, isTail: false
      });
    });
    const prev = addDays(dateStr, -1);
    defs.forEach(function (d) {
      if (!d || d.archived || !d.start || !isOvernight(d)) return;
      if (!S.todoDueOn(d, prev) || S.todoStatus(d.id, prev) === 'done') return;
      out.push({ def: d, instDate: prev, start: '00:00', end: d.due || d.start, endLabel: d.due || d.start, isTail: true });
    });
    return out;
  }

  /* ---------- 卡头（两行 grid：icon/title/tools + nav 居中） ---------- */
  function weekLabel() {
    const ds = weekDates();
    const full = function (d) {
      return Number(d.slice(0, 4)) + '年' + Number(d.slice(5, 7)) + '月' + Number(d.slice(8, 10)) + '日';
    };
    return full(ds[0]) + ' – ' + full(ds[6]);
  }
  function timerRunning() {
    return (S.timeline() || {}).timer || null;
  }
  function cardHTML() {
    const t = timerRunning();
    // 页头与全站统一（h2 24px）。合并视图（v1.2.01 用户拍板）：时间点/时间段独立添加（图标+文字），
    // 计时收进「+ 时间段」hover 预留槽（op-float 划入不跳动）
    return '<div class="page-head"><h2>时间日历</h2><div class="page-actions">' +
      '<span class="tl-range-nav">' +
      '<button type="button" class="home-tool-btn" id="tl-prev" title="上一周">' + UI.icon('chevron-left', 15) + '</button>' +
      '<span class="tl-week-label">' + weekLabel() + '</span>' +
      '<button type="button" class="home-tool-btn" id="tl-next" title="下一周">' + UI.icon('chevron-right', 15) + '</button>' +
      '</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="tl-today">今天</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="tl-add-point">' + UI.icon('plus', 13) + ' 时间点</button>' +
      '<span class="op-host tl-add-block-host">' +
      '<button type="button" class="btn btn-primary btn-sm" id="tl-add-block">' + UI.icon('plus', 13) + ' 时间段</button>' +
      '<span class="op-float tl-timer-slot">' +
      (t
        ? '<button type="button" class="btn btn-danger btn-sm tl-timer-on" id="tl-timer-stop" title="结束计时并生成记录">' + UI.icon('square', 12) + ' <span id="tl-timer-elapsed">0:00</span></button>'
        : '<button type="button" class="btn btn-ghost btn-sm" id="tl-timer" title="开始计时（自动生成时间段）">' + UI.icon('timer', 13) + '</button>') +
      '</span></span>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="tl-types" title="记录类型管理">' + UI.icon('settings', 13) + '</button>' +
      '</div></div>' +
      '<div class="tl-card" id="tl-card"><div class="tl-week-wrap"><div id="tl-week"></div></div></div>';
  }

  /* ---------- 周视图 ---------- */
  /* mode='now'：定位当前时刻（打开/翻周，拍板 10）；'keep'：保持原滚动（数据局部重绘不回顶，
     交互铁律——保存/删除/勾完成后弹回页首是用户多次返工点） */
  function renderWeek(mode, scroll) {
    const box = document.getElementById('tl-week');
    if (!box) return;
    const prevEl = box.querySelector('.tl-week');
    let keep = null;
    if (mode === 'keep') keep = (scroll != null ? scroll : (prevEl ? prevEl.scrollTop : 0));
    const days = weekDates();
    const today = U.todayStr();
    const tl = S.timeline();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    // 左侧时间刻度
    let hours = '';
    for (let h = 0; h < 24; h++) {
      hours += '<div class="tl-hour" style="top:' + (h * HOUR_H) + 'px">' + String(h).padStart(2, '0') + ':00</div>';
    }
    let cols = '';
    days.forEach(function (ds) {
      const isToday = ds === today;
      let inner = '';
      if (isToday) inner += '<div class="tl-now" style="top:' + (nowMin / 60 * HOUR_H) + 'px"></div>';
      // 时间段块 + 计划段（v1.2.4）同池布局（重叠并排正确）；计划段=待办派生
      const items = (tl.blocks || []).filter(function (b) { return b.date === ds; })
        .map(function (b) { return Object.assign({ isPlan: false }, b); });
      planSpansOf(ds).forEach(function (p) {
        items.push({
          isPlan: true, def: p.def,
          id: 'plan:' + p.def.id + (p.isTail ? ':t' : ''),
          date: ds, start: p.start, end: p.end, endLabel: p.endLabel,
          typeId: 'other', note: p.def.name, location: p.def.location || '', todoId: p.def.id,
          instDate: p.instDate
        });
      });
      layoutBlocks(items).forEach(function (it) {
        const meta = it.rec;
        const top = it.startMin / 60 * HOUR_H;
        const h = Math.max(16, (it.endMin - it.startMin) / 60 * HOUR_H);
        const w = 100 / it.cols;
        const short = h < 38;
        if (it.rec.isPlan) {
          // 计划段：浅色虚线 + ◻（与事实段实色对照）
          inner += '<div class="tl-block tl-plan' + (short ? ' tl-short' : '') + '"' +
            ' data-tl-plan="' + U.escapeHtml(it.rec.def.id) + '" data-tl-kind="plan"' +
            ' style="top:' + top + 'px;height:' + h + 'px;left:' + (it.col * w) + '%;width:calc(' + w + '% - 2px);">' +
            '<div class="tl-b-t">◻ ' + U.escapeHtml(it.rec.def.name) +
            (short ? '' : '（' + durText(it.endMin - it.startMin) + '）') + '</div>' +
            (short ? '' : '<div class="tl-b-s">' + U.escapeHtml(it.rec.start) + ' - ' + U.escapeHtml(it.rec.endLabel != null ? it.rec.endLabel : it.rec.end) +
              (it.rec.location ? ' · ' + U.escapeHtml(it.rec.location) : '') + '</div>') +
            '<div class="tl-b-ops op-host"><span class="op-float">' +
            '<button type="button" class="home-tool-btn" data-tl-plan-del="' + U.escapeHtml(it.rec.def.id) + '" title="删除该待办">' + UI.icon('x', 12) + '</button>' +
            '<button type="button" class="home-tool-btn" data-tl-plan-done="' + U.escapeHtml(it.rec.def.id) + '" data-date="' + U.escapeHtml(it.rec.instDate || ds) + '" title="完成（转为时间记录）">' + UI.icon('check', 12) + '</button>' +
            '</span></div></div>';
          return;
        }
        const ty = typeOf(it.rec.typeId);
        // 物化块（拍板 2A）：标题优先显示待办名（类型名次之）——完成前后可对照
        const bTitle = it.rec.todoId ? (it.rec.note || ty.name) : ty.name;
        inner += '<div class="tl-block' + (short ? ' tl-short' : '') + '" data-tl-block="' + U.escapeHtml(it.rec.id) + '"' +
          ' data-tl-kind="block"' +
          ' style="top:' + top + 'px;height:' + h + 'px;left:' + (it.col * w) + '%;width:calc(' + w + '% - 2px);' +
          'background:' + U.escapeHtml(ty.color) + '1c;border-left-color:' + U.escapeHtml(ty.color) + '">' +
          '<div class="tl-b-t">' + UI.iconOrEmoji(ty.icon, 12) + ' ' + U.escapeHtml(bTitle) +
          (short ? '' : '（' + durText(it.endMin - it.startMin) + '）') + '</div>' +
          (short ? '' : '<div class="tl-b-s">' + U.escapeHtml(it.rec.start) + ' - ' + U.escapeHtml(it.rec.end) +
            (it.rec.location ? ' · ' + U.escapeHtml(it.rec.location) : '') + '</div>') +
          (short ? '' : '<div class="tl-b-ops op-host"><span class="op-float">' +
          '<button type="button" class="home-tool-btn" data-tl-again="' + U.escapeHtml(it.rec.id) + '" title="再来一条">' + UI.icon('copy', 12) + '</button>' +
          '</span></div>') +
          '<div class="tl-b-resize" data-tl-resize="' + U.escapeHtml(it.rec.id) + '"></div>' +
          '</div>';
      });
      // 时间点（实心胶囊）+ 待办菱形：同时刻并排分栏。
      // 注意：定位 style 由 flushMarks 统一注入（HTML 双 style 属性只认第一个，曾把背景顶掉）
      const marks = [];
      (tl.points || []).filter(function (p) { return p.date === ds; }).forEach(function (p) {
        const ty = typeOf(p.typeId || 'other');
        marks.push({
          min: parseHM(p.time),
          extraStyle: 'background:' + darkenHex(ty.color) + ';',
          html: '<div class="tl-point" data-tl-point="' + U.escapeHtml(p.id) + '" data-tl-kind="point"' +
            ' title="' + U.escapeHtml(p.note || p.name) + '">' +
            UI.iconOrEmoji(ty.icon, 11) + '<span class="tl-pt-name">' + U.escapeHtml(p.name) + '</span>' +
            '<b class="tl-pt-time">' + U.escapeHtml(p.time) + '</b></div>'
        });
      });
      todoSpansOf(ds).forEach(function (t) {
        marks.push({
          min: parseHM(t.def.due || '23:59'),
          extraStyle: '',
          html: '<div class="tl-todo' + (t.done ? ' done' : '') + '" data-tl-todo="' + U.escapeHtml(t.def.id) + '"' +
            ' data-date="' + U.escapeHtml(ds) + '" data-tl-kind="todo"' +
            ' title="' + U.escapeHtml(t.def.name) + ' · ' + U.escapeHtml(t.def.due || '23:59') + '">' +
            '<span class="tl-td-dia"></span><span class="tl-td-name">' + U.escapeHtml(t.def.name) + '</span>' +
            '<b class="tl-pt-time">' + U.escapeHtml(t.def.due || '') + '</b></div>'
        });
      });
      marks.sort(function (a, b) { return a.min - b.min; });
      // 簇内并排（差 <25min 视为同时刻簇）
      let cluster = [], clusterMin = -999;
      function flushMarks() {
        const n = Math.max(1, cluster.length);
        cluster.forEach(function (mk, i) {
          const w = 100 / n;
          inner += mk.html.replace('class="', 'style="top:' + (mk.min / 60 * HOUR_H) + 'px;left:' + (i * w) +
            '%;width:calc(' + w + '% - 2px);' + (mk.extraStyle || '') + '" class="');
        });
        cluster = [];
      }
      marks.forEach(function (mk) {
        if (cluster.length && mk.min - clusterMin >= 25) { flushMarks(); clusterMin = -999; }
        cluster.push(mk);
        clusterMin = cluster.length === 1 ? mk.min : clusterMin;
      });
      flushMarks();
      cols += '<div class="tl-col' + (isToday ? ' tl-today-col' : '') + '" data-tl-date="' + ds + '">' +
        '<div class="tl-day-head' + (isToday ? ' on' : '') + '">' +
        '周' + '一二三四五六日'.charAt((new Date(Number(ds.slice(0, 4)), Number(ds.slice(5, 7)) - 1, Number(ds.slice(8, 10))).getDay() + 6) % 7) +
        '<b>' + Number(ds.slice(8, 10)) + '</b></div>' +
        '<div class="tl-day-body">' + inner + '</div></div>';
    });
    box.innerHTML =
      '<div class="tl-week">' +
      '<div class="tl-gutter"><div class="tl-day-head tl-gh"></div><div class="tl-gutter-body">' + hours + '</div></div>' +
      cols +
      '</div>';
    bindWeek(box);
    // 打开/翻周自动定位当前时刻（今天列附近，拍板 10）；数据重绘保持原滚动不回顶
    const sc = box.querySelector('.tl-week');
    if (sc) sc.scrollTop = keep != null ? keep : Math.max(0, (nowMin / 60 * HOUR_H) - 140);
  }

  /* ---------- 交互 ---------- */
  function bindCard(root) {
    // 委托绑在整页容器（page-head 工具 + 周视图都盖住）
    // 幂等（同 views-plan data-eg-bound 先例）：#main-content 复用容器，render 重入会叠加监听，
    // 点一次「添加」弹 N 个窗（v1.2.01 真机 bug，JSDOM 全新窗口拦不住）
    if (root.hasAttribute('data-tl-bound')) { refreshTick(); return; } // 重进也要恢复读数（曾冻结）
    root.setAttribute('data-tl-bound', '1');
    root.addEventListener('click', function (e) {
      const t = e.target;
      if (t.closest && t.closest('#tl-prev')) { weekStart = addDays(weekStart || mondayOf(U.todayStr()), -7); refreshHead(); renderWeek(); return; }
      if (t.closest && t.closest('#tl-next')) { weekStart = addDays(weekStart || mondayOf(U.todayStr()), 7); refreshHead(); renderWeek(); return; }
      if (t.closest && t.closest('#tl-today')) { weekStart = ''; refreshHead(); renderWeek(); return; }
      if (t.closest && t.closest('#tl-add-point')) { openPointEditor({ date: U.todayStr() }); return; }
      if (t.closest && t.closest('#tl-add-block')) { openBlockEditor({ date: U.todayStr() }); return; }
      if (t.closest && t.closest('#tl-types')) { openTypeManager(); return; }
      if (t.closest && t.closest('#tl-timer')) { openTimerStart(); return; }
      if (t.closest && t.closest('#tl-timer-stop')) { stopTimer(); return; }
    });
    refreshTick();
  }
  function refreshHead() {
    const lab = document.querySelector('.tl-week-label');
    if (lab) lab.textContent = weekLabel();
  }
  function refreshTick() {
    if (tickTimer) clearInterval(tickTimer);
    if (window.navigator && /jsdom/i.test(window.navigator.userAgent || '')) return; // JSDOM 不启动常驻定时器（挂进程）
    const t = timerRunning();
    if (!t) return;
    tickTimer = setInterval(function () {
      const el = document.getElementById('tl-timer-elapsed');
      if (!el) { clearInterval(tickTimer); tickTimer = null; return; }
      const rt = timerRunning(); // 实时取（切计时/刷新后不冻结）
      if (!rt) { clearInterval(tickTimer); tickTimer = null; return; }
      const sec = Math.max(0, Math.floor((Date.now() - rt.startedAt) / 1000));
      const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
      el.textContent = hh + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    }, 1000);
  }

  /* hover 放大预览卡（拍板：浮出覆盖预览，不动相邻条目） */
  function showPreview(el) {
    let pv = document.getElementById('tl-preview');
    if (!pv) {
      pv = document.createElement('div');
      pv.id = 'tl-preview';
      document.body.appendChild(pv);
    }
    const kind = el.getAttribute('data-tl-kind');
    let html = '';
    if (kind === 'block') {
      const b = findBlock(el.getAttribute('data-tl-block'));
      if (!b) return;
      const ty = typeOf(b.typeId);
      const dur = Math.max(0, parseHM(b.end) - parseHM(b.start));
      html = '<div class="tl-pv-t">' + UI.iconOrEmoji(ty.icon, 16) + ' ' + U.escapeHtml(ty.name) + '</div>' +
        '<div class="tl-pv-s">' + U.escapeHtml(b.start) + ' - ' + U.escapeHtml(b.end) + ' · ' + durText(dur) + '</div>' +
        (b.note ? '<div class="tl-pv-n">' + U.escapeHtml(b.note) + '</div>' : '');
    } else if (kind === 'point') {
      const p = findPoint(el.getAttribute('data-tl-point'));
      if (!p) return;
      const ty = typeOf(p.typeId || 'other');
      html = '<div class="tl-pv-t">' + UI.iconOrEmoji(ty.icon, 16) + ' ' + U.escapeHtml(p.name) + '</div>' +
        '<div class="tl-pv-s">' + U.escapeHtml(p.time) + ' · 时间点</div>' +
        (p.note ? '<div class="tl-pv-n">' + U.escapeHtml(p.note) + '</div>' : '');
    } else if (kind === 'plan') {
      // 计划段独立提示（曾误写「点击勾完成」——实际点击=编辑，hover ✓ 才完成）
      const pid = el.getAttribute('data-tl-plan');
      const def = (((S.getDB().todos || {}).defs) || []).filter(function (x) { return x.id === pid; })[0];
      if (!def) return;
      html = '<div class="tl-pv-t">' + UI.icon('square', 15) + ' ' + U.escapeHtml(def.name) + '</div>' +
        '<div class="tl-pv-s">◻ 计划段 · ' + U.escapeHtml((def.start || '') + '-' + (def.due || '')) +
        (def.location ? ' · ' + U.escapeHtml(def.location) : '') + '</div>' +
        '<div class="tl-pv-n">点击编辑 · hover ✓ 完成（转为时间记录）</div>';
    } else {
      const name = el.querySelector('.tl-td-name');
      html = '<div class="tl-pv-t">' + UI.icon('check-square', 16) + ' ' + U.escapeHtml(name ? name.textContent : '待办') + '</div>' +
        '<div class="tl-pv-s">待办 · 点击勾完成</div>';
    }
    pv.innerHTML = html;
    const r = el.getBoundingClientRect();
    pv.style.left = Math.min(window.innerWidth - 220, r.left) + 'px';
    pv.style.top = Math.max(8, r.top - 8) + 'px';
    pv.classList.add('show');
  }
  function hidePreview() {
    const pv = document.getElementById('tl-preview');
    if (pv) pv.classList.remove('show');
  }
  function bindWeek(box) {
    // hover 预览（box 复用容器，幂等绑定）
    if (!box.hasAttribute('data-pv-bound')) {
      box.setAttribute('data-pv-bound', '1');
      box.addEventListener('mouseover', function (e) {
        const el = e.target && e.target.closest ? e.target.closest('[data-tl-block],[data-tl-point],[data-tl-todo]') : null;
        if (el) showPreview(el); else hidePreview();
      });
      box.addEventListener('mouseleave', hidePreview);
    }
    // 点击空白新建（预填该时刻，对齐 15 分钟）；点条目编辑
    box.querySelectorAll('.tl-day-body').forEach(function (body) {
      body.addEventListener('click', function (e) {
        if (body._dragMoved) { body._dragMoved = false; return; }
        const col = body.closest('.tl-col');
        const date = col ? col.getAttribute('data-tl-date') : U.todayStr();
        // 计划段：hover ✓=完成物化；点主体=待办编辑
        const pd = e.target.closest ? e.target.closest('[data-tl-plan-done]') : null;
        if (pd) {
          e.stopPropagation();
          S.setTodoDone(pd.getAttribute('data-tl-plan-done'), pd.getAttribute('data-date'), 'done').then(function () {
            UI.toast('已转为时间记录', 'success');
            renderWeek('keep');
          }).catch(function (err) { UI.toast('操作失败：' + ((err && err.message) || err), 'error'); });
          return;
        }
        const pdel = e.target.closest ? e.target.closest('[data-tl-plan-del]') : null;
        if (pdel) {
          e.stopPropagation();
          // 拍板 1A：✕=跳过今天（非破坏，对齐主页语义）；删除只留待办编辑弹窗
          const did = pdel.getAttribute('data-tl-plan-del');
          const ds = pdel.getAttribute('data-date') || U.todayStr();
          S.setTodoDone(did, ds, 'skipped').then(function () {
            UI.toast('已跳过今天（计划段保留）', 'info');
            renderWeek('keep');
          }).catch(function (err) { UI.toast('操作失败：' + ((err && err.message) || err), 'error'); });
          return;
        }
        const pl = e.target.closest ? e.target.closest('[data-tl-plan]') : null;
        if (pl) {
          const def = (((S.getDB().todos || {}).defs) || []).filter(function (x) {
            return x.id === pl.getAttribute('data-tl-plan');
          })[0];
          if (def) window.HomeView && window.HomeView.openTodoEditor
            ? window.HomeView.openTodoEditor(def, function () { renderWeek('keep'); })
            : UI.toast('待办编辑不可用', 'error');
          return;
        }
        const bl = e.target.closest ? e.target.closest('[data-tl-block]') : null;
        if (bl) { openBlockEditor({ block: findBlock(bl.getAttribute('data-tl-block')) }); return; }
        const pt = e.target.closest ? e.target.closest('[data-tl-point]') : null;
        if (pt) { openPointEditor({ point: findPoint(pt.getAttribute('data-tl-point')) }); return; }
        const td = e.target.closest ? e.target.closest('[data-tl-todo]') : null;
        if (td) { toggleTodo(td.getAttribute('data-tl-todo'), td.getAttribute('data-date'), td); return; }
        if (e.target.closest && e.target.closest('.tl-b-ops')) return;
        // 点空白 = 新建时间段（预填该时刻）
        const rect = body.getBoundingClientRect();
        const y = e.clientY - rect.top + body.scrollTop;
        const start = Math.round((y / HOUR_H * 60) / 15) * 15;
        openBlockEditor({ date: date, start: fmtHM(start), end: fmtHM(start + 60) });
      });
    });
    // 悬停「再来一条」（复制同类型同时长到此刻之后）
    box.querySelectorAll('[data-tl-again]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const b = findBlock(btn.getAttribute('data-tl-again'));
        if (!b) return;
        const dur = Math.max(15, parseHM(b.end) - parseHM(b.start));
        const s2 = Math.min(parseHM(b.end), 23 * 60 + 45); // 紧接其后；当日尽头则压回 23:45
        openBlockEditor({ date: b.date, start: fmtHM(s2), end: fmtHM(Math.min(24 * 60, s2 + dur)), typeId: b.typeId, note: b.note, linkHabitId: b.linkHabitId });
      });
    });
    // 拖拽移动 + 底边拉伸（尝试：命中阈值 4px 才算拖；触屏设备不启用）
    if (!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) {
      box.querySelectorAll('[data-tl-block]').forEach(function (el) {
        bindDrag(el, el.closest('.tl-day-body'));
      });
    }
  }

  function findBlock(id) {
    return (S.timeline().blocks || []).filter(function (b) { return b.id === id; })[0] || null;
  }
  function findPoint(id) {
    return (S.timeline().points || []).filter(function (p) { return p.id === id; })[0] || null;
  }
  /* 物化块 → 待办实例（gid 'todo:<defId>:<实例日>'；旧数据无前缀按块日期兜底） */
  function todoBlockInstance(b) {
    if (!b || !b.todoId) return null;
    const m = /^todo:(.+):(\d{4}-\d{2}-\d{2})$/.exec(String(b.gid || ''));
    return { defId: m ? m[1] : b.todoId, date: m ? m[2] : b.date };
  }

  function bindDrag(el, body) {
    if (!body) body = el.closest('.tl-day-body');
    let startY = 0, startTop = 0, startH = 0, mode = '', base = null, moved = false;
    function onDown(e) {
      if (e.button != null && e.button !== 0) return;
      base = findBlock(el.getAttribute('data-tl-block'));
      if (!base) return;
      mode = e.target.classList && e.target.classList.contains('tl-b-resize') ? 'resize' : 'move';
      startY = e.clientY;
      startTop = parseFloat(el.style.top) || 0;
      startH = parseFloat(el.style.height) || 16;
      moved = false;
      el.setPointerCapture && e.pointerId != null && el.setPointerCapture(e.pointerId);
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    }
    function onMove(e) {
      if (!base) return;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dy) < 4) return;
      moved = true;
      if (body) body._dragMoved = true;
      el.classList.add('tl-dragging');
      const dMin = Math.round(dy / HOUR_H * 60 / 15) * 15;
      if (mode === 'move') {
        const dur = parseHM(base.end) - parseHM(base.start);
        el.style.top = (startTop + dy) + 'px';
        el.dataset.tmpStart = fmtHM(parseHM(base.start) + dMin);
        el.dataset.tmpEnd = fmtHM(parseHM(base.start) + dur + dMin);
      } else {
        el.style.height = Math.max(16, startH + dy) + 'px'; // 基于按下时高度（防累积漂移）
        el.dataset.tmpEnd = fmtHM(parseHM(base.end) + dMin);
      }
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (!base) return;
      el.classList.remove('tl-dragging');
      if (!moved) return;
      let ns = el.dataset.tmpStart || base.start;
      let ne = el.dataset.tmpEnd || base.end;
      delete el.dataset.tmpStart; delete el.dataset.tmpEnd;
      // 拖拽限当天：过 24:00 clamp（跨天录入走弹窗自动拆分）
      if (parseHM(ns) >= 24 * 60) ns = fmtHM(23 * 60 + 45);
      if (parseHM(ne) <= parseHM(ns)) ne = fmtHM(Math.min(24 * 60, parseHM(ns) + 15));
      S.saveTimelineBlock(Object.assign({}, base, { start: ns, end: ne })).then(function () {
        renderWeek('keep');
      }).catch(function (e) {
        UI.toast('保存失败：' + ((e && e.message) || e) + '，已还原', 'error');
        renderWeek('keep');
      });
    }
    el.addEventListener('pointerdown', onDown);
  }

  function toggleTodo(todoId, dateStr, el) {
    const done = S.todoStatus(todoId, dateStr);
    Promise.resolve(S.setTodoDone(todoId, dateStr, done ? '' : 'done')).then(function () {
      el.classList.toggle('done', !done);
      UI.toast(done ? '已恢复未决' : '已完成', 'success');
    }).catch(function (e) {
      UI.toast('操作失败：' + ((e && e.message) || e), 'error');
    });
  }

  /* ---------- 录入/编辑弹窗 ---------- */
  function habitOptions(sel) {
    const hs = ((S.getDB().habits || {}).defs) || [];
    return '<option value="">不关联</option>' + hs.map(function (h) {
      return '<option value="' + U.escapeHtml(h.id) + '"' + (sel === h.id ? ' selected' : '') + '>' + U.escapeHtml(h.name) + '</option>';
    }).join('');
  }
  /* 两套类型（v1.2.01 拍板）：kind='block' 时间段 / 'point' 时间点；类型必选 */
  function typesOfKind(kind) {
    return (S.timeline().types || []).filter(function (t) { return (t.kind || 'block') === kind; });
  }
  function defaultTypeOf(kind) {
    const list = typesOfKind(kind);
    return list.length ? list[0].id : 'other';
  }
  function habitOfType(typeId) {
    const t = (S.timeline().types || []).filter(function (x) { return x.id === typeId; })[0];
    return t ? (t.linkHabitId || '') : '';
  }
  function typeOptions(kind, sel) {
    const list = typesOfKind(kind);
    return list.map(function (t) {
      return '<option value="' + U.escapeHtml(t.id) + '"' + (sel === t.id ? ' selected' : '') + '>' + U.escapeHtml(t.name) + '</option>';
    }).join('');
  }
  function openBlockEditor(opts) {
    opts = opts || {};
    const b = opts.block || null;
    UI.modal({
      title: b ? '编辑时间记录' : '添加时间记录', width: 460, formGuard: true,
      bodyHTML: '<div class="form-grid">' +
        '<label><span class="f-label">日期 <span class="req-star">*</span></span>' +
        '<input type="date" id="tl-date" value="' + U.escapeHtml(b ? b.date : (opts.date || U.todayStr())) + '"></label>' +
        '<label><span class="f-label">类型 <span class="req-star">*</span></span><select id="tl-type">' +
        typeOptions('block', b ? b.typeId : (opts.typeId || defaultTypeOf('block'))) + '</select></label>' +
        '<label><span class="f-label">开始 <span class="req-star">*</span></span>' +
        '<input id="tl-start" value="' + U.escapeHtml(b ? b.start : (opts.start || '09:00')) + '" placeholder="HH:MM"></label>' +
        '<label><span class="f-label">结束 <span class="req-star">*</span></span>' +
        '<input id="tl-end" value="' + U.escapeHtml(b ? b.end : (opts.end || '10:00')) + '" placeholder="HH:MM"></label>' +
        '<label class="f-full"><span class="f-label">备注</span><input id="tl-note" value="' + U.escapeHtml(b ? b.note : (opts.note || '')) + '" placeholder="可选"></label>' +
        '<label class="f-full"><span class="f-label">地点（可选）</span><input id="tl-loc" value="' + U.escapeHtml(b ? (b.location || '') : (opts.location || '')) + '" placeholder="如：公司 / 医院"></label>' +
        '<label class="f-full"><span class="f-label">关联习惯（保存即打卡 +1，可改/不绑）</span>' +
        '<select id="tl-habit">' + habitOptions(b ? b.linkHabitId : (opts.linkHabitId || habitOfType(opts.typeId || defaultTypeOf('block')))) + '</select></label>' +
        (b && b.todoId ? '' : '<label class="f-full cd-repeat-row"><input type="checkbox" id="tl-astodo"><span>同时作为待办（计划段：进主页、可循环/提醒；完成后才转为时间记录）</span></label>' +
          '<label class="f-full" id="tl-todo-name-row" hidden><span class="f-label">待办名称 <span class="req-star">*</span></span>' +
          '<input id="tl-todo-name" placeholder="如：写报告"></label>') +
        '</div>' +
        '<p class="muted small">类型必选；类型绑了习惯时这里默认跟随，可改。结束早于开始视为跨到次日，自动按天拆分保存。</p>',
      footerHTML: (b ? '<button type="button" class="btn btn-danger" data-x="del">删除</button>' +
        (b.todoId ? '<button type="button" class="btn btn-ghost" data-x="undo" title="撤销完成，回到计划段">撤销完成</button>'
          : '<button type="button" class="btn btn-ghost" data-x="todef" title="删除本记录并创建可勾完成的待办">转为待办</button>') : '') +
        '<div class="flex1"></div><button type="button" class="btn btn-ghost" data-x="c">取消</button>' +
        '<button type="button" class="btn btn-primary" data-x="s">保存</button>',
      onMount: function (w, close) {
        w.querySelector('[data-x=c]').addEventListener('click', close);
        // 「作为待办」勾选 → 显示名称行（必填）
        const asBox = w.querySelector('#tl-astodo');
        if (asBox) asBox.addEventListener('change', function () {
          const row = w.querySelector('#tl-todo-name-row');
          if (row) row.hidden = !asBox.checked;
        });
        // 切类型 → 习惯下拉默认跟随类型绑定（可改/不绑）
        w.querySelector('#tl-type').addEventListener('change', function (e) {
          const hid = habitOfType(e.target.value);
          const hs = w.querySelector('#tl-habit');
          if (hs) hs.value = hid;
        });
        // 拍板 3A：物化块显式「撤销完成（回计划）」
        const undoBtn = w.querySelector('[data-x=undo]');
        if (undoBtn) undoBtn.addEventListener('click', function () {
          const inst = todoBlockInstance(b);
          if (!inst) { UI.toast('不是待办物化记录', 'error'); return; }
          Promise.resolve(S.setTodoDone(inst.defId, inst.date, '')).then(function () {
            close();
            UI.toast('已回到计划段', 'success');
            setTimeout(function () { renderWeek('keep'); }, 60);
          }).catch(function (e) { UI.toast('操作失败：' + ((e && e.message) || e), 'error'); });
        });
        const del = w.querySelector('[data-x=del]');
        if (del) del.addEventListener('click', function () {
          // 拍板 7：删除确认（UI.confirmDialog——window.confirm 在 --app 被禁）
          UI.confirmDialog('删除时间记录', '删除这条记录？').then(function (ok) {
            if (!ok) return;
            // 待办物化块：删事实 = 撤销那次完成（回计划态）——保持「done ⇔ 物化块」不变量
            const inst = todoBlockInstance(b);
            const undo = (inst && S.todoDef(inst.defId))
              ? S.setTodoDone(inst.defId, inst.date, '')
              : Promise.resolve();
            undo.then(function () { return S.removeTimelineGroup(b.id); }).then(function () {
              close();
              UI.toast('已删除', 'success');
              setTimeout(function () { renderWeek('keep'); }, 60);
            }).catch(function (e) { UI.toast('删除失败：' + ((e && e.message) || e), 'error'); });
          });
        });
        w.querySelector('[data-x=s]').addEventListener('click', function () {
          const date = w.querySelector('#tl-date').value;
          const start = w.querySelector('#tl-start').value.trim();
          const end = w.querySelector('#tl-end').value.trim();
          const typeId = w.querySelector('#tl-type').value;
          if (!typeId) { UI.toast('请先选择类型', 'error'); return; }
          if (!date || !/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) {
            UI.toast('请填写日期与 HH:MM 时间', 'error');
            return;
          }
          const note = w.querySelector('#tl-note').value.trim();
          const linkHabitId = w.querySelector('#tl-habit').value;
          const location = w.querySelector('#tl-loc') ? w.querySelector('#tl-loc').value.trim() : '';
          const asTodo = w.querySelector('#tl-astodo') && w.querySelector('#tl-astodo').checked;
          if (asTodo) {
            // 作为待办（计划段）：写 todos（start=起、due=止），不写事实块
            const tname = (w.querySelector('#tl-todo-name') ? w.querySelector('#tl-todo-name').value.trim() : '') || note || '时间段待办';
            S.saveTodoDef({
              id: U.uid(), name: tname, date: date, due: end, start: start,
              repeat: 'none', repeatOn: [], interval: 1, remindBefore: 0,
              linkHabitId: linkHabitId, location: location, priority: 'mid',
              repeatUntil: '', createdAt: Date.now(), archived: false
            }).then(function () {
              close();
              UI.toast('已添加计划段（待办）', 'success');
              setTimeout(function () { renderWeek('keep'); }, 60);
            }).catch(function (e) {
              UI.toast('保存失败：' + ((e && e.message) || e) + '，请重试', 'error');
            });
            return;
          }
          saveSplitBlocks(b, date, start, end, typeId, note, linkHabitId, 'manual', location).then(function () {
            close();
            UI.toast(b ? '已保存' : '已添加', 'success');
            setTimeout(function () { renderWeek('keep'); }, 60);
          }).catch(function (e) {
            UI.toast('保存失败：' + ((e && e.message) || e) + '，请重试', 'error');
          });
        });
        // 转为待办（事实段 → 计划段）
        const todef = w.querySelector('[data-x=todef]');
        if (todef) todef.addEventListener('click', function () {
          const date = w.querySelector('#tl-date').value;
          const start = w.querySelector('#tl-start').value.trim();
          const end = w.querySelector('#tl-end').value.trim();
          const note = w.querySelector('#tl-note').value.trim();
          const location = w.querySelector('#tl-loc') ? w.querySelector('#tl-loc').value.trim() : '';
          const linkHabitId = w.querySelector('#tl-habit').value;
          const delJob = b ? S.removeTimelineGroup(b.id) : Promise.resolve();
          const tname2 = (w.querySelector('#tl-todo-name') ? w.querySelector('#tl-todo-name').value.trim() : '') || note || '时间段待办';
          delJob.then(function () {
            return S.saveTodoDef({
              id: U.uid(), name: tname2, date: date, due: end || start, start: start,
              repeat: 'none', repeatOn: [], interval: 1, remindBefore: 0,
              linkHabitId: linkHabitId, location: location, priority: 'mid',
              repeatUntil: '', createdAt: Date.now(), archived: false
            });
          }).then(function () {
            close();
            UI.toast('已转为待办（计划段）', 'success');
            setTimeout(function () { renderWeek('keep'); }, 60);
          }).catch(function (e) {
            UI.toast('操作失败：' + ((e && e.message) || e), 'error');
          });
        });
      }
    });
  }

  /* 跨天自动拆分：end<=start 视为过夜；同组共用 gid（删除/编辑整组）。
     习惯联动只记在第一段（防跨天两段各 +1）；第二段 linkHabitId 留空 */
  function saveSplitBlocks(orig, date, start, end, typeId, note, linkHabitId, source, location) {
    const s = parseHM(start), e = parseHM(end);
    const src = (orig && orig.source) || source || 'manual';
    const gid = (orig && orig.gid) || U.uid();
    // 编辑已有组：先清掉组内其他段（第一段随后就地更新，habitSynced 传续防重复计）
    const pre = orig && orig.gid
      ? S.removeTimelineGroup(orig.id)
      : Promise.resolve();
    if (e > s) {
      return pre.then(function () {
        return S.saveTimelineBlock(Object.assign({}, orig && orig.id ? orig : {}, {
          id: orig && orig.id ? orig.id : U.uid(), gid: gid, date: date, start: fmtHM(s), end: fmtHM(e),
          typeId: typeId, note: note, location: location || (orig && orig.location) || '', linkHabitId: linkHabitId,
          habitSynced: false, // pre 删组已回退联动，重建重新计（-1 后 +1 对称）
          source: src
        }));
      });
    }
    const parts = [
      { date: date, start: fmtHM(s), end: '24:00', link: linkHabitId },
      { date: addDays(date, 1), start: '00:00', end: fmtHM(e), link: '' } // 同组第二段不重复联动
    ];
    return pre.then(function () {
      return parts.reduce(function (p, part, i) {
        return p.then(function () {
          return S.saveTimelineBlock(Object.assign({}, (i === 0 && orig && orig.id) ? orig : {}, {
            id: (i === 0 && orig && orig.id) ? orig.id : U.uid(),
            gid: gid, date: part.date, start: part.start, end: part.end, typeId: typeId, note: note,
            location: location || (orig && orig.location) || '', linkHabitId: part.link,
            habitSynced: false, // 组内只有第一段带 linkHabitId，重建对称计一次
            source: src
          }));
        });
      }, Promise.resolve());
    });
  }

  function openPointEditor(opts) {
    opts = opts || {};
    const p = opts.point || null;
    UI.modal({
      title: p ? '编辑时间点' : '添加时间点', width: 420, formGuard: true,
      bodyHTML: '<div class="form-grid">' +
        '<label><span class="f-label">日期 <span class="req-star">*</span></span>' +
        '<input type="date" id="tp-date" value="' + U.escapeHtml(p ? p.date : (opts.date || U.todayStr())) + '"></label>' +
        '<label><span class="f-label">时刻 <span class="req-star">*</span></span>' +
        '<input id="tp-time" value="' + U.escapeHtml(p ? p.time : (opts.time || fmtHM(new Date().getHours() * 60 + new Date().getMinutes()))) + '" placeholder="HH:MM"></label>' +
        '<label><span class="f-label">类型 <span class="req-star">*</span></span><select id="tp-type">' +
        typeOptions('point', p ? p.typeId : (opts.typeId || defaultTypeOf('point'))) + '</select></label>' +
        '<label><span class="f-label">名称</span>' +
        '<input id="tp-name" value="' + U.escapeHtml(p ? p.name : '') + '" placeholder="默认同类型名"></label>' +
        '<label class="f-full"><span class="f-label">备注</span><input id="tp-note" value="' + U.escapeHtml(p ? p.note : '') + '"></label>' +
        '<label class="f-full"><span class="f-label">关联习惯（保存即打卡 +1，可改/不绑）</span>' +
        '<select id="tp-habit">' + habitOptions(p ? p.linkHabitId : habitOfType(opts.typeId || defaultTypeOf('point'))) + '</select></label>' +
        '</div><p class="muted small">类型必选，类型绑了习惯时这里默认跟随。循环提醒类事项请在「待办事项」创建，设了截止时刻会自动出现在本日历。</p>',
      footerHTML: (p ? '<button type="button" class="btn btn-danger" data-x="del">删除</button>' : '') +
        '<div class="flex1"></div><button type="button" class="btn btn-ghost" data-x="c">取消</button>' +
        '<button type="button" class="btn btn-primary" data-x="s">保存</button>',
      onMount: function (w, close) {
        w.querySelector('[data-x=c]').addEventListener('click', close);
        w.querySelector('#tp-type').addEventListener('change', function (e) {
          const hid = habitOfType(e.target.value);
          const hs = w.querySelector('#tp-habit');
          if (hs) hs.value = hid;
          const nm = w.querySelector('#tp-name');
          // 名称为空时随类型名走（默认同类型名）
          if (nm && !nm.value.trim()) {
            const t = (S.timeline().types || []).filter(function (x) { return x.id === e.target.value; })[0];
            if (t) nm.placeholder = t.name;
          }
        });
        const del = w.querySelector('[data-x=del]');
        if (del) del.addEventListener('click', function () {
          UI.confirmDialog('删除时间点', '删除这条时间点记录？').then(function (ok) {
          if (!ok) return;
          S.removeTimelinePoint(p.id).then(function () {
            close();
            UI.toast('已删除', 'success');
            setTimeout(function () { renderWeek('keep'); }, 60);
          }).catch(function (e) { UI.toast('删除失败：' + ((e && e.message) || e), 'error'); });
          });
        });
        w.querySelector('[data-x=s]').addEventListener('click', function () {
          const date = w.querySelector('#tp-date').value;
          const time = w.querySelector('#tp-time').value.trim();
          const typeId = w.querySelector('#tp-type').value;
          if (!typeId) { UI.toast('请先选择类型', 'error'); return; }
          const t = (S.timeline().types || []).filter(function (x) { return x.id === typeId; })[0];
          const name = w.querySelector('#tp-name').value.trim() || (t ? t.name : '时间点');
          if (!date || !/^\d{1,2}:\d{2}$/.test(time)) {
            UI.toast('请填写日期与时刻', 'error');
            return;
          }
          S.saveTimelinePoint({
            id: p ? p.id : U.uid(), date: date, time: time, typeId: typeId, name: name,
            note: w.querySelector('#tp-note').value.trim(),
            linkHabitId: w.querySelector('#tp-habit').value,
            habitSynced: p ? p.habitSynced : false
          }).then(function () {
            close();
            UI.toast(p ? '已保存' : '已添加', 'success');
            setTimeout(function () { renderWeek('keep'); }, 60);
          }).catch(function (e) {
            UI.toast('保存失败：' + ((e && e.message) || e) + '，请重试', 'error');
          });
        });
      }
    });
  }

  /* ---------- 计时器 ---------- */
  function openTimerStart() {
    UI.modal({
      title: '开始计时', width: 380,
      bodyHTML: '<div class="form-grid"><label class="f-full"><span class="f-label">类型</span>' +
        '<select id="tm-type">' + typeOptions('block', defaultTypeOf('block')) + '</select></label>' +
        '<label class="f-full"><span class="f-label">备注</span><input id="tm-note" placeholder="可选"></label></div>' +
        '<p class="muted small">点「开始」后卡头显示计时；点结束自动生成时间段记录。</p>',
      footerHTML: '<button type="button" class="btn btn-ghost" data-x="c">取消</button>' +
        '<button type="button" class="btn btn-primary" data-x="s">开始</button>',
      onMount: function (w, close) {
        w.querySelector('[data-x=c]').addEventListener('click', close);
        w.querySelector('[data-x=s]').addEventListener('click', function () {
          S.setTimelineTimer({
            typeId: w.querySelector('#tm-type').value,
            startedAt: Date.now(),
            note: w.querySelector('#tm-note').value.trim()
          }).then(function () {
            close();
            UI.toast('计时开始', 'success');
            setTimeout(refreshSelf, 60);
          });
        });
      }
    });
  }
  function stopTimer() {
    const t = timerRunning();
    if (!t) return;
    const startedAt = Number(t.startedAt) || Date.now();
    // 按真实时长逐日切段（v1.2.5）：跨天/超 24 小时计时完整落盘——
    // 此前只按起止 HH:MM 对比，昨天 10:00 开、今天 11:00 停会被压成 1 小时
    const totalMin = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
    const note = t.note || '';
    const typeId = t.typeId || 'other';
    const gid = U.uid();
    const st = new Date(startedAt);
    let segDate = U.todayStr(st);
    let segStart = st.getHours() * 60 + st.getMinutes();
    let remain = totalMin;
    const chain = [];
    while (remain > 0) {
      (function (date, from, len) {
        chain.push(function () {
          return S.saveTimelineBlock({
            gid: gid, date: date, start: fmtHM(from), end: fmtHM(from + len),
            typeId: typeId, note: note, location: '', linkHabitId: '', habitSynced: false, source: 'timer'
          });
        });
      })(segDate, segStart, Math.min(remain, 24 * 60 - segStart));
      remain -= Math.min(remain, 24 * 60 - segStart);
      segDate = addDays(segDate, 1);
      segStart = 0;
    }
    chain.reduce(function (p, job) { return p.then(job); }, Promise.resolve())
      .then(function () { return S.setTimelineTimer(null); })
      .then(function () {
        UI.toast('已生成时间记录', 'success');
        setTimeout(refreshSelf, 60);
      })
      .catch(function (e) {
        UI.toast('生成失败：' + ((e && e.message) || e) + '，请重试', 'error');
      });
  }

  /* ---------- 类型管理（自定义）：颜色盘自选 + 图标点选（不外显系统图标名） ---------- */
  const TYPE_ICONS = [
    'circle', 'moon', 'trending-up', 'book-open', 'messages-square', 'car', 'utensils', 'dumbbell', 'coffee',
    'list-todo', 'smartphone', 'users', 'heart', 'gamepad-2', 'music', 'film', 'cup-soda', 'pill', 'heart-pulse',
    'person-standing', 'bed', 'laptop', 'briefcase', 'plane', 'bike', 'dog', 'cat', 'baby', 'shopping-cart',
    'credit-card', 'house', 'wrench', 'palette', 'camera', 'mic', 'headphones', 'tv', 'gamepad', 'leaf',
    'sun', 'cloud-rain', 'footprints', 'phone', 'mail', 'calendar', 'alarm-clock', 'hourglass', 'sparkles', 'star'
  ];
  function iconGridHTML(cur, kind, id) {
    return '<div class="tm-icon-grid" data-tm-grid="' + U.escapeHtml(kind) + '" data-tm-grid-id="' + U.escapeHtml(id) + '">' +
      TYPE_ICONS.map(function (i) {
        return '<button type="button" class="tm-icon-cell' + (i === cur ? ' on' : '') + '" data-tm-icon="' + i + '" title="选这个">' + UI.icon(i, 16) + '</button>';
      }).join('') + '</div>';
  }
  function openTypeManager() {
    UI.modal({
      title: '记录类型管理', width: 560,
      bodyHTML: '<div id="tm-list"></div>' +
        '<div class="tm-new-row">' +
        '<select id="tm-new-kind"><option value="block">时间段</option><option value="point">时间点</option></select>' +
        '<input type="color" id="tm-new-color" value="#007aff" title="选颜色">' +
        '<input id="tm-new-name" placeholder="新类型名" style="flex:1">' +
        '<button type="button" class="btn btn-icon tm-icon-btn" id="tm-new-icon-btn" title="选图标">' + UI.icon('circle', 16) + '</button>' +
        '<select id="tm-new-habit">' + habitOptions('') + '</select>' +
        '<button type="button" class="btn btn-primary btn-sm" data-x="add">添加</button></div>' +
        '<div id="tm-new-icon-grid"></div>',
      footerHTML: '<div class="flex1"></div><button type="button" class="btn btn-primary" data-x="c">完成</button>',
      onMount: function (w, close) {
        const list = w.querySelector('#tm-list');
        const newIconBtn = w.querySelector('#tm-new-icon-btn');
        let newIcon = 'circle';
        function rowHTML(t) {
          return '<div class="tm-row" data-tm-id="' + U.escapeHtml(t.id) + '">' +
            '<input type="color" class="tm-color" value="' + U.escapeHtml(/^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color : '#8e8e93') + '" title="颜色盘">' +
            '<input class="tm-name" value="' + U.escapeHtml(t.name) + '">' +
            '<button type="button" class="btn btn-icon tm-icon-btn" data-tm-icon-btn="' + U.escapeHtml(t.id) + '" title="选图标">' + UI.iconOrEmoji(t.icon, 16) + '</button>' +
            '<select class="tm-habit" title="固定关联打卡（可不绑）">' + habitOptions(t.linkHabitId || '') + '</select>' +
            '<button type="button" class="btn-icon" data-tm-del="' + U.escapeHtml(t.id) + '" title="删除">' + UI.icon('trash-2', 14) + '</button>' +
            '<div class="tm-icon-slot"></div>' +
            '</div>';
        }
        function paint() {
          const ts = S.timeline().types || [];
          const blocks = ts.filter(function (t) { return (t.kind || 'block') === 'block'; });
          const points = ts.filter(function (t) { return t.kind === 'point'; });
          list.innerHTML =
            '<h4 class="detail-sub">时间段类型</h4>' + (blocks.map(rowHTML).join('') || '<p class="muted small">暂无</p>') +
            '<h4 class="detail-sub">时间点类型</h4>' + (points.map(rowHTML).join('') || '<p class="muted small">暂无</p>');
        }
        paint();
        // 图标点选：行内展开网格（系统图标名不外显）
        list.addEventListener('click', function (e) {
          const del = e.target.closest ? e.target.closest('[data-tm-del]') : null;
          if (del) {
            // 拍板 12：删除确认（引用记录归 other/pt_water）
            UI.confirmDialog('删除类型', '删除该类型？引用它的记录会归入默认类型').then(function (ok) {
              if (!ok) return;
              S.removeTimelineType(del.getAttribute('data-tm-del')).then(function () {
                paint();
                UI.toast('已删除，引用记录已归入默认类型', 'success');
              });
            });
            return;
          }
          const ib = e.target.closest ? e.target.closest('[data-tm-icon-btn]') : null;
          if (ib) {
            const row = ib.closest('[data-tm-id]');
            const slot = row && row.querySelector('.tm-icon-slot');
            if (!slot) return;
            if (slot.innerHTML) { slot.innerHTML = ''; return; }
            const t = (S.timeline().types || []).filter(function (x) { return x.id === row.getAttribute('data-tm-id'); })[0];
            slot.innerHTML = iconGridHTML(t ? t.icon : 'circle', 'row', row.getAttribute('data-tm-id'));
            return;
          }
          const cell = e.target.closest ? e.target.closest('[data-tm-icon]') : null;
          if (cell) {
            const grid = cell.closest('[data-tm-grid]');
            const kind = grid ? grid.getAttribute('data-tm-grid') : '';
            const pick = cell.getAttribute('data-tm-icon');
            if (kind === 'row') {
              const row = cell.closest('[data-tm-id]');
              const t = (S.timeline().types || []).filter(function (x) { return x.id === row.getAttribute('data-tm-id'); })[0];
              if (t) {
                S.saveTimelineType({
                  id: t.id, name: (row.querySelector('.tm-name').value.trim() || t.name),
                  color: row.querySelector('.tm-color').value, icon: pick,
                  kind: t.kind, linkHabitId: t.linkHabitId || ''
                }).then(paint);
              }
            } else {
              newIcon = pick;
              newIconBtn.innerHTML = UI.icon(newIcon, 16);
              w.querySelector('#tm-new-icon-grid').innerHTML = '';
            }
          }
        });
        // 颜色/名称/习惯关联改完即存
        list.addEventListener('change', function (e) {
          const row = e.target.closest ? e.target.closest('[data-tm-id]') : null;
          if (!row) return;
          const t = (S.timeline().types || []).filter(function (x) { return x.id === row.getAttribute('data-tm-id'); })[0];
          if (!t) return;
          S.saveTimelineType({
            id: t.id,
            name: row.querySelector('.tm-name').value.trim() || t.name,
            color: row.querySelector('.tm-color').value,
            icon: t.icon,
            kind: t.kind,
            linkHabitId: row.querySelector('.tm-habit').value
          }).then(paint);
        });
        newIconBtn.addEventListener('click', function () {
          const box = w.querySelector('#tm-new-icon-grid');
          box.innerHTML = box.innerHTML ? '' : iconGridHTML(newIcon, 'new', '');
        });
        w.querySelector('[data-x=add]').addEventListener('click', function () {
          const name = w.querySelector('#tm-new-name').value.trim();
          if (!name) { UI.toast('请填写类型名', 'error'); return; }
          S.saveTimelineType({
            name: name,
            color: w.querySelector('#tm-new-color').value,
            icon: newIcon,
            kind: w.querySelector('#tm-new-kind').value,
            linkHabitId: w.querySelector('#tm-new-habit').value
          }).then(function () {
            w.querySelector('#tm-new-name').value = '';
            w.querySelector('#tm-new-icon-grid').innerHTML = '';
            paint();
          });
        });
        w.querySelector('[data-x=c]').addEventListener('click', function () {
          close();
          setTimeout(refreshSelf, 60);
        });
      }
    });
  }

  /* ---------- 入口 ---------- */
  // 卡头两行 grid 自适应（与待办卡同款 head-wide：宽屏标题/导航一行，窄屏两行居中）
  // keep=true：数据自刷新，保持滚动不回顶（交互铁律）；默认进入页面定位当前时刻
  function render(main, keep) {
    if (!main) return;
    const old = main.querySelector('.tl-week');
    const saved = (keep && old) ? old.scrollTop : 0;
    main.innerHTML = cardHTML();
    bindCard(main);
    renderWeek(keep ? 'keep' : 'now', saved);
  }

  return {
    render: render,
    resetState: resetState,
    openBlockEditor: openBlockEditor,
    openPointEditor: openPointEditor,
    openTypeManager: openTypeManager,
    layoutBlocks: layoutBlocks,
    parseHM: parseHM,
    fmtHM: fmtHM
  };
})();
