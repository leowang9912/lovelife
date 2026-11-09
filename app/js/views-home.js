/* views-home.js — 我的主页（v1.1.2）：快捷记录 / 打卡 / 天气穿搭推荐 / 概览提醒 */
window.HomeView = (function () {
  const S = window.Storage;
  const U = window.Utils;
  const UI = window.UI;
  const M = window.Models;

  function today() { return U.todayStr(); }

  function greet() {
    const h = new Date().getHours();
    if (h < 6) return '夜深了';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }

  function weekName() {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date().getDay()];
  }

  function render(root) {
    const db = S.getDB();
    const t = today();
    // 今日概览
    const todayBills = ((db.wallet || {}).bills || []).filter(function (b) { return b.date === t; });
    let todayExp = 0, todayInc = 0;
    todayBills.forEach(function (b) {
      const a = Math.abs(Number(b.amount) || 0);
      if (b.type === 'income') todayInc += a; else if (b.type === 'expense') todayExp += a;
    });
    const outfitDone = (db.outfits || []).filter(function (o) { return o.date === t; });
    const foodDone = (db.food || []).filter(function (f) { return f.date === t; });

    // 倒计时（v1.1.5）：settings.countdowns [{id,name,date,repeat}]，日期行只显示最近一个
    // repeat='year' = 每年循环（生日/纪念日）：按下一个周年计算剩余天数
    const cds = (db.settings.countdowns || []).filter(function (c) { return c && c.date; })
      .sort(function (a, b) { return cdDaysLeft(t, a) - cdDaysLeft(t, b); });
    const upcoming = cds[0];
    const cdBrief = upcoming
      ? '<span class="home-cd-brief"> · 距离' + esc(upcoming.name || '目标') + '还有 ' + cdDaysLeft(t, upcoming) + ' 天</span>'
      : '';

    root.innerHTML =
      '<div class="home-hero">' +
      '<div class="home-greet">' + greet() + ' 👋</div>' +
      '<div class="home-date">' + U.cnDate(t) + ' ' + weekName() + cdBrief + '</div>' +
      '</div>' +

      // 四大快捷记录（大按钮、各颜色）
      '<div class="home-quick-grid">' +
      homeQuick('hq-digital', 'gamepad-2', '记数码', '#0071e3') +
      homeQuick('hq-clothing', 'shirt', '记衣服', '#ff2d55') +
      homeQuick('hq-life', 'heart', '记美妆', '#af52de') +
      homeQuick('hq-bill', 'wallet', '记一笔账', '#34c759') +
      '</div>' +

      // 打卡区（完成态）
      '<div class="home-check-row">' +
      homeCheck('hc-outfit', 'shirt', '穿搭打卡', outfitDone.length) +
      homeCheck('hc-food', 'utensils', '美食打卡', foodDone.length) +
      '</div>' +

      // 左列：天气穿搭推荐 + 倒计时卡；右列：今日概览 + 热力打卡（v1.1.5 并排布局）
      '<div class="home-two">' +
      '<div class="home-col">' +
      '<div class="panel weather-card" id="home-weather"><div class="panel-body"></div></div>' +
      countdownsHTML(cds) +
      '</div>' +
      '<div class="home-col">' +
      '<div class="panel"><div class="panel-head">' + UI.icon('sun', 16) + ' 今日概览</div><div class="panel-body">' +
      '<div class="home-mini-grid">' +
      '<div class="home-mini"><div class="yw-bal-label">今日记账</div><div class="home-mini-val">' + todayBills.length + ' 笔</div></div>' +
      '<div class="home-mini"><div class="yw-bal-label">今日支出</div><div class="home-mini-val out">' + U.formatMoney(todayExp) + '</div></div>' +
      '<div class="home-mini"><div class="yw-bal-label">今日收入</div><div class="home-mini-val in">' + U.formatMoney(todayInc) + '</div></div>' +
      '<div class="home-mini"><div class="yw-bal-label">打卡</div><div class="home-mini-val">' +
      (outfitDone.length ? '穿搭✓ ' : '穿搭✗ ') + (foodDone.length ? '美食✓' : '美食✗') + '</div></div>' +
      '</div></div></div>' +
      habitsHTML(db) +
      '</div>' +
      '</div>';

    bind(root, outfitDone, foodDone);
  }

  function esc(t) { return U.escapeHtml(t == null ? '' : t); }

  /* ---------- 倒计时（v1.1.5） ---------- */
  function dayDiff(a, b) {
    const pa = a.split('-'), pb = b.split('-');
    const da = new Date(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
    const db2 = new Date(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
    return Math.round((db2 - da) / 86400000);
  }

  /* 剩余天数：每年循环（生日/纪念日）按下一个周年算，一次性按原日期 */
  function cdDaysLeft(todayStr, c) {
    if (c.repeat === 'year') {
      const p = (c.date || '').split('-');
      if (p.length < 3) return 0;
      const ty = Number(todayStr.split('-')[0]);
      let occ = ty + '-' + p[1] + '-' + p[2];
      if (occ < todayStr) occ = (ty + 1) + '-' + p[1] + '-' + p[2];
      return dayDiff(todayStr, occ);
    }
    return dayDiff(todayStr, c.date);
  }

  function countdownsHTML(cds) {
    return '<div class="panel" id="home-cd"><div class="panel-head">' + UI.icon('timer', 16) + ' 倒计时' +
      '<div class="flex1"></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-cd-add>' + UI.icon('plus', 14) + ' 添加</button></div>' +
      '<div class="panel-body">' +
      (cds.length
        ? '<div class="cd-strip">' + cds.map(function (c) {
          const left = cdDaysLeft(U.todayStr(), c);
          const yearly = c.repeat === 'year';
          const p = (c.date || '').split('-');
          return '<div class="cd-card" data-cd-edit="' + esc(c.id) + '">' +
            '<div class="cd-name">' + esc(c.name || '目标') + (yearly ? ' <span class="tag">每年</span>' : '') + '</div>' +
            '<div class="cd-days' + (left < 0 ? ' over' : '') + '">' + (left < 0 ? '已过 ' + (-left) : left) + '</div>' +
            '<div class="cd-date muted small">' + (left < 0 ? '天前 · ' : '天 · ') +
            (yearly ? (p[1] || '') + '-' + (p[2] || '') + ' 每年' : esc(c.date)) + '</div>' +
            '</div>';
        }).join('') + '</div>'
        : '<div class="empty-hint muted">还没有倒计时，点「添加」记录一个重要日子</div>') +
      '</div></div>';
  }

  function openCountdownEditor(rec) {
    const editing = !!rec;
    UI.modal({
      title: editing ? '编辑倒计时' : '添加倒计时', width: 440, formGuard: true,
      bodyHTML: '<div class="form-grid">' +
        '<label class="f-full"><span class="f-label">名称 <span class="req-star">*</span></span>' +
        '<input id="cd-name" value="' + esc(rec ? rec.name : '') + '" placeholder="如：考研 / 旅行"></label>' +
        '<label class="f-full"><span class="f-label">目标日期 <span class="req-star">*</span></span>' +
        '<input type="date" id="cd-date" value="' + esc(rec ? rec.date : '') + '"></label>' +
        '<label class="f-full cd-repeat-row"><input type="checkbox" id="cd-repeat"' +
        (rec && rec.repeat === 'year' ? ' checked' : '') + '>' +
        '<span>每年重复（生日 / 纪念日，按月日每年循环）</span></label></div>',
      footerHTML: (editing ? '<button type="button" class="btn btn-danger" data-cd-del>删除</button>' : '') +
        '<button type="button" class="btn btn-ghost" data-x="c">取消</button>' +
        '<button type="button" class="btn btn-primary" data-x="s">保存</button>',
      onMount: function (w, close) {
        w.querySelector('[data-x=c]').addEventListener('click', close);
        const delBtn = w.querySelector('[data-cd-del]');
        if (delBtn) delBtn.addEventListener('click', async function () {
          if (!(await UI.confirmDialog('删除确认', '删除倒计时「' + (rec.name || '') + '」？'))) return;
          const db = S.getDB();
          db.settings.countdowns = (db.settings.countdowns || []).filter(function (c) { return c.id !== rec.id; });
          await S.saveSettings();
          close(); UI.toast('倒计时已删除', 'success'); window.App.refresh();
        });
        w.querySelector('[data-x=s]').addEventListener('click', async function () {
          const name = w.querySelector('#cd-name').value.trim();
          const date = w.querySelector('#cd-date').value;
          const repeat = w.querySelector('#cd-repeat').checked ? 'year' : '';
          if (!name) { UI.toast('请填写名称', 'error'); return; }
          if (!date) { UI.toast('请选择目标日期', 'error'); return; }
          const db = S.getDB();
          const list = db.settings.countdowns || (db.settings.countdowns = []);
          if (editing) {
            const it = list.find(function (c) { return c.id === rec.id; });
            if (it) { it.name = name; it.date = date; it.repeat = repeat; }
          } else {
            list.push({ id: U.uid(), name: name, date: date, repeat: repeat });
          }
          await S.saveSettings();
          close(); UI.toast(editing ? '已保存' : '已添加倒计时', 'success'); window.App.refresh();
        });
      }
    });
  }

  /* ---------- 热力打卡（v1.1.5）：月视图（首页），数据域 habits ---------- */
  let habMonth = (function () { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); })();
  const HABIT_COLORS = ['#aecbfa', '#d7aefb', '#b7e1c1', '#fbd2a7', '#f6b8d0', '#a8e0e8', '#f7e6a1', '#f2b3b3'];
  const HABIT_PRESETS = ['运动', '阅读', '早睡'];

  function habitsHTML(db) {
    const hb = db.habits || { defs: [], log: {} };
    const defs = hb.defs || [];
    // 首次为空自动播种预设示例（运动/阅读/早睡）——**纯内存零副作用**：
    // 渲染期不落盘（避免污染保存计数/保存失败拖垮渲染）；用户首次打卡/编辑时随交互落盘
    if (!defs.length) {
      (function () {
        const d2 = S.getDB();
        const h2 = d2.habits || (d2.habits = { defs: [], log: {} });
        if (!h2.defs.length) {
          HABIT_PRESETS.forEach(function (n, i) {
            h2.defs.push({ id: 'hb_preset_' + i, name: n, color: HABIT_COLORS[i % HABIT_COLORS.length] });
          });
        }
      })();
    }
    const [y, m] = habMonth.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const t = U.todayStr();
    const countOf = function (v) { return typeof v === 'number' ? v : (v ? 1 : 0); };
    const rows = (S.getDB().habits || { defs: [] }).defs.map(function (def) {
      const log = ((S.getDB().habits || {}).log || {})[def.id] || {};
      const isCount = def.type === 'count'; // 梯度式计数习惯（v1.1.5）
      const max = Math.max(1, Number(def.max) || 5);
      const showNum = def.showNum !== false;
      const cells = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const v = countOf(log[ds]);
        const on = v > 0;
        const future = ds > t;
        const bg = on ? (isCount ? S.habitColorScale(def.color, v, max) : (def.color || '#aecbfa')) : '#f2f2f4';
        cells.push('<button type="button" class="hb-cell' + (on ? ' on' : '') + (future ? ' future' : '') + (ds === t ? ' today' : '') + '"' +
          ' data-hb-cell="' + esc(def.id) + '" data-date="' + ds + '"' + (future ? ' disabled' : '') +
          ' style="--hc:' + esc(def.color || '#aecbfa') + ';background:' + bg + '"' +
          ' title="' + ds + (on ? (isCount ? ' · ' + v + ' 次' : ' · 已打卡') : '') + '">' +
          (isCount && on && showNum ? '<span class="hb-n">' + v + '</span>' : '') + '</button>');
      }
      const todayN = countOf(log[t]);
      const doneToday = todayN > 0;
      const pill = isCount
        ? '<button type="button" class="hb-pill' + (doneToday ? ' done' : '') + '" data-hb-today="' + esc(def.id) + '" data-count="1" title="点击 +1，右键 -1">' +
        (doneToday ? '今日已打 ' + todayN + ' 次' : '去打卡') + '</button>'
        : '<button type="button" class="hb-pill' + (doneToday ? ' done' : '') + '" data-hb-today="' + esc(def.id) + '">' +
        (doneToday ? '今日已打 ✓' : '去打卡') + '</button>';
      return '<div class="hb-row">' +
        '<button type="button" class="hb-name" data-hb-edit="' + esc(def.id) + '">' +
        '<span class="hb-dot" style="background:' + esc(def.color || '#aecbfa') + '"></span>' + esc(def.name) + '</button>' +
        '<div class="hb-cells">' + cells.join('') + '</div>' + pill +
        '</div>';
    }).join('');
    return '<div class="panel" id="home-habits"><div class="panel-head">' + UI.icon('flame', 16) + ' 热力打卡' +
      '<div class="flex1"></div>' +
      '<div class="hb-month-nav">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-hb-mv="-1">' + UI.icon('chevron-left', 14) + '</button>' +
      '<span class="hb-month-label">' + y + ' 年 ' + m + ' 月</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-hb-mv="1">' + UI.icon('chevron-right', 14) + '</button>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-hb-add>' + UI.icon('plus', 14) + ' 添加</button></div>' +
      '<div class="panel-body">' +
      (rows || '<div class="empty-hint muted">还没有习惯项，点「添加」开始记录</div>') +
      '</div></div>';
  }

  function openHabitEditor(def) {
    const editing = !!def;
    const color = (def && def.color) || HABIT_COLORS[0];
    const type = (def && def.type) || 'check';
    UI.modal({
      title: editing ? '编辑习惯' : '添加习惯', width: 440, formGuard: true,
      bodyHTML: '<div class="form-grid">' +
        '<label class="f-full"><span class="f-label">名称 <span class="req-star">*</span></span>' +
        '<input id="hb-name" value="' + esc(def ? def.name : '') + '" placeholder="如：跑步 / 喝水"></label>' +
        '<label><span class="f-label">类型</span><select id="hb-type">' +
        '<option value="check"' + (type === 'check' ? ' selected' : '') + '>打卡一次（打 / 取消）</option>' +
        '<option value="count"' + (type === 'count' ? ' selected' : '') + '>计数型（一天多次，如喝水）</option>' +
        '</select></label>' +
        '<label id="hb-max-row"' + (type === 'count' ? '' : ' hidden') + '><span class="f-label">多少次最深</span>' +
        '<input type="number" id="hb-max" min="1" max="99" value="' + Math.max(1, Number(def && def.max) || 5) + '">' +
        '<span class="muted small">色块随次数渐深，达到即满色</span></label>' +
        '<label class="f-full"><span class="f-label">颜色</span><div class="chip-row" id="hb-colors">' +
        HABIT_COLORS.map(function (c) {
          return '<button type="button" class="hb-color-swatch' + (c === color ? ' on' : '') + '" data-hc="' + c + '" style="background:' + c + '"></button>';
        }).join('') + '</div></label>' +
        '<label class="f-full cd-repeat-row"><input type="checkbox" id="hb-shownum"' +
        ((def && def.showNum !== false) ? ' checked' : '') + '>' +
        '<span>色块中心显示次数（计数型）</span></label></div>',
      footerHTML: (editing ? '<button type="button" class="btn btn-danger" data-hb-del>删除</button>' : '') +
        '<button type="button" class="btn btn-ghost" data-x="c">取消</button>' +
        '<button type="button" class="btn btn-primary" data-x="s">保存</button>',
      onMount: function (w, close) {
        let picked = color;
        w.querySelectorAll('[data-hc]').forEach(function (el) {
          el.addEventListener('click', function () {
            picked = el.getAttribute('data-hc');
            w.querySelectorAll('[data-hc]').forEach(function (x) { x.classList.toggle('on', x === el); });
          });
        });
        // 计数型才显示「多少次最深」
        const typeSel = w.querySelector('#hb-type');
        typeSel.addEventListener('change', function () {
          w.querySelector('#hb-max-row').hidden = typeSel.value !== 'count';
        });
        w.querySelector('[data-x=c]').addEventListener('click', close);
        const delBtn = w.querySelector('[data-hb-del]');
        if (delBtn) delBtn.addEventListener('click', async function () {
          if (!(await UI.confirmDialog('删除确认', '删除习惯「' + (def.name || '') + '」及其打卡记录？'))) return;
          if (S.removeHabitDef) await S.removeHabitDef(def.id);
          close(); UI.toast('习惯已删除', 'success'); window.App.refresh();
        });
        w.querySelector('[data-x=s]').addEventListener('click', async function () {
          const name = w.querySelector('#hb-name').value.trim();
          if (!name) { UI.toast('请填写名称', 'error'); return; }
          const payload = editing
            ? { id: def.id, name: name, color: picked }
            : { id: U.uid(), name: name, color: picked };
          payload.type = typeSel.value === 'count' ? 'count' : 'check';
          payload.max = Math.max(1, Math.floor(Number(w.querySelector('#hb-max').value) || 5));
          payload.showNum = w.querySelector('#hb-shownum').checked;
          if (S.saveHabitDef) await S.saveHabitDef(payload);
          close(); UI.toast(editing ? '已保存' : '已添加习惯', 'success'); window.App.refresh();
        });
      }
    });
  }

  function bindHabits(root) {
    const box = root.querySelector('#home-habits');
    if (!box) return;
    box.querySelectorAll('[data-hb-mv]').forEach(function (el) {
      el.addEventListener('click', function () {
        const delta = Number(el.getAttribute('data-hb-mv'));
        const [y, m] = habMonth.split('-').map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        habMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        window.App.refresh();
      });
    });
    const addBtn = box.querySelector('[data-hb-add]');
    if (addBtn) addBtn.addEventListener('click', function () { openHabitEditor(null); });
    box.querySelectorAll('[data-hb-edit]').forEach(function (el) {
      el.addEventListener('click', function () {
        const def = ((S.getDB().habits || {}).defs || []).find(function (x) { return x.id === el.getAttribute('data-hb-edit'); });
        if (def) openHabitEditor(def);
      });
    });
    box.querySelectorAll('[data-hb-cell]').forEach(function (el) {
      el.addEventListener('click', function () {
        if (el.disabled) return;
        const hid = el.getAttribute('data-hb-cell');
        const def = ((S.getDB().habits || {}).defs || []).find(function (x) { return x.id === hid; });
        if (def && def.type === 'count') {
          // 计数习惯：历史格弹小编辑（改次数/清零），避免误触连加
          openHabitDayEditor(def, el.getAttribute('data-date'));
        } else {
          toggleHabitAt(hid, el.getAttribute('data-date'), box, el);
        }
      });
    });
    box.querySelectorAll('[data-hb-today]').forEach(function (el) {
      const id = el.getAttribute('data-hb-today');
      const isCount = el.getAttribute('data-count') === '1';
      if (isCount) {
        // 计数习惯今日行：点击 +1、右键 -1（拍板交互）
        el.addEventListener('click', function () {
          bumpHabitToday(id, 1, box);
        });
        el.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          bumpHabitToday(id, -1, box);
        });
      } else {
        el.addEventListener('click', function () {
          const cell = box.querySelector('[data-hb-cell="' + id + '"][data-date="' + U.todayStr() + '"]');
          toggleHabitAt(id, U.todayStr(), box, cell);
        });
      }
    });
  }

  /* 打卡交互（v1.1.5）：乐观更新——点击即时变色/切状态 + toast 确认，不整页刷新（消除延迟）；
     落盘失败回滚 UI 并提示。n 为乐观后的次数（不读 db，db 此时尚未落盘） */
  async function toggleHabitAt(habitId, dateStr, box, cellEl) {
    const on = cellEl ? !cellEl.classList.contains('on') : true;
    if (cellEl) cellEl.classList.toggle('on', on);
    updateHabitPill(box, habitId, on ? 1 : 0);
    UI.toast(on ? '已打卡 ✓' : '已取消打卡', on ? 'success' : 'info');
    try {
      if (S.toggleHabit) await S.toggleHabit(habitId, dateStr);
    } catch (e) {
      if (cellEl) cellEl.classList.toggle('on', !on);
      updateHabitPill(box, habitId, on ? 0 : 1);
      UI.toast('打卡失败：' + (e.message || '请重试'), 'error');
    }
  }

  /* 计数习惯今日 +1/-1（v1.1.5 梯度式）：乐观更新格子色/数字/pill，失败回滚 */
  async function bumpHabitToday(habitId, delta, box) {
    const t = U.todayStr();
    const def = ((S.getDB().habits || {}).defs || []).find(function (x) { return x.id === habitId; }) || {};
    const cur = S.habitCountOf ? S.habitCountOf(habitId, t) : 0;
    const next = Math.max(0, cur + delta);
    renderHabitDay(box, habitId, t, next, def);
    updateHabitPill(box, habitId, next);
    UI.toast(next > 0 ? ('已打卡 ' + next + ' 次 ✓') : '已清零', next > 0 ? 'success' : 'info');
    try {
      if (S.setHabitCount) await S.setHabitCount(habitId, t, next);
    } catch (e) {
      renderHabitDay(box, habitId, t, cur, def);
      updateHabitPill(box, habitId, cur);
      UI.toast('打卡失败：' + (e.message || '请重试'), 'error');
    }
  }

  /* 单日格子重绘（次数→梯度色/数字），乐观更新共用 */
  function renderHabitDay(box, habitId, dateStr, n, def) {
    const cell = box.querySelector('[data-hb-cell="' + habitId + '"][data-date="' + dateStr + '"]');
    if (!cell) return;
    const isCount = def && def.type === 'count';
    const max = Math.max(1, Number(def && def.max) || 5);
    const on = n > 0;
    cell.classList.toggle('on', on);
    cell.style.background = on
      ? (isCount ? S.habitColorScale(def.color, n, max) : ((def && def.color) || '#aecbfa'))
      : '#f2f2f4';
    cell.innerHTML = (isCount && on && def.showNum !== false) ? '<span class="hb-n">' + n + '</span>' : '';
    cell.title = dateStr + (on ? (isCount ? ' · ' + n + ' 次' : ' · 已打卡') : '');
  }

  function updateHabitPill(box, habitId, n) {
    const pill = box.querySelector('[data-hb-today="' + habitId + '"]');
    if (!pill) return;
    const def = ((S.getDB().habits || {}).defs || []).find(function (x) { return x.id === habitId; }) || {};
    const done = n > 0;
    if (def.type === 'count') {
      pill.classList.toggle('done', done);
      pill.textContent = done ? ('今日已打 ' + n + ' 次') : '去打卡';
    } else {
      pill.classList.toggle('done', done);
      pill.textContent = done ? '今日已打 ✓' : '去打卡';
    }
  }

  /* 计数习惯：历史日小编辑弹层（改次数/清零） */
  function openHabitDayEditor(def, dateStr) {
    const cur = S.habitCountOf ? S.habitCountOf(def.id, dateStr) : 0;
    UI.modal({
      title: def.name + ' · ' + dateStr, width: 380, formGuard: true,
      bodyHTML: '<div class="form-grid">' +
        '<label class="f-full"><span class="f-label">当日次数</span>' +
        '<div class="tag-add-row">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-hd="-1">' + UI.icon('minus', 14) + '</button>' +
        '<input type="number" min="0" id="hd-n" value="' + cur + '" style="width:90px;text-align:center">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-hd="1">' + UI.icon('plus', 14) + '</button>' +
        '</div></label></div>' +
        '<p class="muted small">保存后色块深浅随次数变化（' + Math.max(1, Number(def.max) || 5) + ' 次最深）</p>',
      footerHTML: '<button type="button" class="btn btn-ghost" data-hd="0">清零</button>' +
        '<button type="button" class="btn btn-ghost" data-x="c">取消</button>' +
        '<button type="button" class="btn btn-primary" data-x="s">保存</button>',
      onMount: function (w, close) {
        const inp = w.querySelector('#hd-n');
        w.querySelectorAll('[data-hd]').forEach(function (b) {
          b.addEventListener('click', function () {
            const d = Number(b.getAttribute('data-hd'));
            if (d === 0) { inp.value = '0'; return; }
            inp.value = String(Math.max(0, (Number(inp.value) || 0) + d));
          });
        });
        w.querySelector('[data-x=c]').addEventListener('click', close);
        w.querySelector('[data-x=s]').addEventListener('click', async function () {
          const n = Math.max(0, Math.floor(Number(inp.value) || 0));
          try {
            if (S.setHabitCount) await S.setHabitCount(def.id, dateStr, n);
          } catch (e) {
            UI.toast('保存失败：' + (e.message || '请重试'), 'error');
            return;
          }
          close();
          UI.toast(n > 0 ? ('已记录 ' + n + ' 次') : '已清零', 'success');
          window.App.refresh();
        });
      }
    });
  }

  function homeQuick(id, icon, label, color) {
    return '<button class="home-quick" id="' + id + '" style="--hq:' + color + '">' +
      '<span class="home-quick-ic">' + UI.icon(icon, 28) + '</span>' +
      '<span class="home-quick-label">' + label + '</span></button>';
  }

  function homeCheck(id, icon, label, done) {
    return '<button class="home-check' + (done ? ' done' : '') + '" id="' + id + '">' +
      UI.icon(icon, 20) + '<span>' + label + '</span>' +
      '<span class="home-check-state">' + (done ? '今日已打 ✓' : '去打卡') + '</span></button>';
  }

  function bind(root, outfitDone, foodDone) {
    root.querySelector('#hq-digital').addEventListener('click', function () {
      window.Views.openItemEditor(null, 'digital');
    });
    root.querySelector('#hq-clothing').addEventListener('click', function () {
      window.Views.openItemEditor(null, 'clothing');
    });
    root.querySelector('#hq-life').addEventListener('click', function () {
      window.Views.openItemEditor(null, 'life');
    });
    root.querySelector('#hq-bill').addEventListener('click', function () {
      window.WalletView.openBillForm(null);
    });
    // 打卡：已有今日记录直接编辑那条，没有则新建（完成后按钮变已打）
    root.querySelector('#hc-outfit').addEventListener('click', function () {
      const rec = outfitDone[0] || null;
      window.Views.openOutfitEditor(today(), rec);
    });
    root.querySelector('#hc-food').addEventListener('click', function () {
      const rec = foodDone[0] || null;
      window.FoodView.openFoodEditor(today(), rec);
    });
    // 天气穿搭推荐卡（沿用穿搭日历的推荐渲染）
    const weatherCard = root.querySelector('#home-weather');
    if (weatherCard && window.Views && window.Views.renderOutfitRec) {
      window.Views.renderOutfitRec(weatherCard);
    }
    // 倒计时：添加 / 点卡编辑（v1.1.5）
    root.querySelectorAll('[data-cd-add]').forEach(function (el) {
      el.addEventListener('click', function () { openCountdownEditor(null); });
    });
    root.querySelectorAll('[data-cd-edit]').forEach(function (el) {
      el.addEventListener('click', function () {
        const rec = (S.getDB().settings.countdowns || []).find(function (c) { return c.id === el.getAttribute('data-cd-edit'); });
        openCountdownEditor(rec || null);
      });
    });
    // 热力打卡（v1.1.5）
    bindHabits(root);
  }

  return { render: render };
})();
