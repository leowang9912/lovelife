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
    // 排序：未过期近→远在前、过期近→远垫底、非法日期最后（cdDaysLeft=NaN）
    const cdList = (Array.isArray(db.settings.countdowns) ? db.settings.countdowns : [])
      .filter(function (c) { return c && c.date; })
      .map(function (c) { return { c: c, left: cdDaysLeft(t, c) }; });
    cdList.sort(function (a, b) {
      const fa = isFinite(a.left), fb = isFinite(b.left);
      if (fa !== fb) return fa ? -1 : 1;
      if (!fa) return 0;
      const ua = a.left >= 0, ub = b.left >= 0;
      if (ua !== ub) return ua ? -1 : 1;
      return ua ? a.left - b.left : b.left - a.left;
    });
    // hero 简报只显示未过期的最近一个（v1.1.9 拍板 2）：全部过期或没有 → 不显示「·」和文案
    const upcoming = cdList.filter(function (x) { return isFinite(x.left) && x.left >= 0; })[0];
    const cdBrief = upcoming
      ? '<span class="home-cd-brief"> · 距离' + esc(upcoming.c.name || '目标') + '还有 ' + upcoming.left + ' 天</span>'
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
      countdownsHTML(cdList) +
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

  /* 剩余天数：每年循环（生日/纪念日）按下一个周年算，一次性按原日期；
     02-29 特判（v1.1.9 拍板 1）：非闰年周年落 2 月最后一天（2-28，保守提醒早 1 天），
     不再让 JS Date 滚动到 3-01；闰年周年仍为 2-29。
     日期非法（缺段/非数字/非真实日历日）返回 NaN——排序垫底、卡片显示「—」，不进 hero */
  function cdDaysLeft(todayStr, c) {
    const p = String((c && c.date) || '').split('-');
    if (p.length !== 3 || !/^\d{4}$/.test(p[0]) || !/^\d{2}$/.test(p[1]) || !/^\d{2}$/.test(p[2])) return NaN;
    const probe = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (probe.getFullYear() !== Number(p[0]) || probe.getMonth() !== Number(p[1]) - 1 || probe.getDate() !== Number(p[2])) return NaN;
    if (c.repeat === 'year') {
      const ty = Number(todayStr.split('-')[0]);
      const occOf = function (yy) {
        if (p[1] === '02' && p[2] === '29') {
          const leap = (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
          return yy + '-02-' + (leap ? '29' : '28');
        }
        return yy + '-' + p[1] + '-' + p[2];
      };
      let occ = occOf(ty);
      if (occ < todayStr) occ = occOf(ty + 1);
      return dayDiff(todayStr, occ);
    }
    return dayDiff(todayStr, c.date);
  }

  /* 单张倒计时卡（主条/折叠组共用） */
  function cdCardHTML(x) {
    const c = x.c;
    const left = x.left;
    const ok = isFinite(left);
    const yearly = c.repeat === 'year';
    const p = String(c.date || '').split('-');
    return '<div class="cd-card" data-cd-edit="' + esc(c.id) + '">' +
      '<div class="cd-name">' + esc(c.name || '目标') + (yearly ? ' <span class="tag">每年</span>' : '') + '</div>' +
      '<div class="cd-days' + (ok && left < 0 ? ' over' : '') + '">' +
      (ok ? (left < 0 ? '已过 ' + (-left) : left) : '—') + '</div>' +
      '<div class="cd-date muted small">' + (ok ? (left < 0 ? '天前 · ' : '天 · ') : '· ') +
      // 年循环显示 MM-DD（不露年份）；日期部件来自数据，转义后拼接（防脏数据注入）
      (yearly ? esc(p[1] || '') + '-' + esc(p[2] || '') + ' 每年' : esc(c.date)) + '</div>' +
      '</div>';
  }

  /* 倒计时卡列表：cds = [{c, left}]（render 已算好剩余天数并排序）。
     过期折叠（v1.1.9 拍板 3）：过期的**一次性**倒计时收进「已过期 · N」折叠组（默认收起、不删除）；
     每年循环不过期（永远有下个周年）不进折叠组 */
  function countdownsHTML(cds) {
    const expired = cds.filter(function (x) { return isFinite(x.left) && x.left < 0 && x.c.repeat !== 'year'; });
    const active = cds.filter(function (x) { return !(isFinite(x.left) && x.left < 0 && x.c.repeat !== 'year'); });
    return '<div class="panel" id="home-cd"><div class="panel-head">' + UI.icon('timer', 16) + ' 倒计时' +
      '<div class="flex1"></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-cd-add>' + UI.icon('plus', 14) + ' 添加</button></div>' +
      '<div class="panel-body">' +
      (active.length ? '<div class="cd-strip">' + active.map(cdCardHTML).join('') + '</div>' : '') +
      (expired.length
        ? '<div style="margin-top:8px">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-cd-exp-toggle aria-expanded="false">' +
        UI.icon('chevron-down', 14) + ' 已过期 · ' + expired.length + '</button>' +
        '<div data-cd-exp-body hidden style="margin-top:6px"><div class="cd-strip">' +
        expired.map(cdCardHTML).join('') + '</div></div></div>'
        : '') +
      (!active.length && !expired.length
        ? '<div class="empty-hint muted">还没有倒计时，点「添加」记录一个重要日子</div>'
        : '') +
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
          const list = Array.isArray(db.settings.countdowns) ? db.settings.countdowns : (db.settings.countdowns = []);
          const i = list.findIndex(function (c) { return c.id === rec.id; });
          if (i < 0) { close(); return; }
          const bak = list[i];
          list.splice(i, 1);
          try {
            await S.saveSettings();
          } catch (e) {
            list.splice(i, 0, bak); // 落盘失败回滚，防内存/磁盘分叉
            UI.toast('删除失败：' + (e.message || '请重试'), 'error');
            return;
          }
          close(); UI.toast('倒计时已删除', 'success'); window.App.refresh();
        });
        w.querySelector('[data-x=s]').addEventListener('click', async function () {
          const name = w.querySelector('#cd-name').value.trim();
          const date = w.querySelector('#cd-date').value;
          const repeat = w.querySelector('#cd-repeat').checked ? 'year' : '';
          if (!name) { UI.toast('请填写名称', 'error'); return; }
          // 校验真实日历日（type=date 在部分环境/历史数据下可能带出非法值）
          const dp = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split('-').map(Number) : null;
          const dt = dp ? new Date(dp[0], dp[1] - 1, dp[2]) : null;
          if (!dt || dt.getFullYear() !== dp[0] || dt.getMonth() !== dp[1] - 1 || dt.getDate() !== dp[2]) {
            UI.toast('请选择合法日期', 'error');
            return;
          }
          const db = S.getDB();
          const list = Array.isArray(db.settings.countdowns) ? db.settings.countdowns : (db.settings.countdowns = []);
          if (editing) {
            const it = list.find(function (c) { return c.id === rec.id; });
            if (!it) { UI.toast('倒计时不存在，请重新添加', 'error'); return; }
            const bak = { name: it.name, date: it.date, repeat: it.repeat };
            it.name = name; it.date = date; it.repeat = repeat;
            try {
              await S.saveSettings();
            } catch (e) {
              it.name = bak.name; it.date = bak.date; it.repeat = bak.repeat;
              UI.toast('保存失败：' + (e.message || '请重试'), 'error');
              return;
            }
          } else {
            const item = { id: U.uid(), name: name, date: date, repeat: repeat };
            list.push(item);
            try {
              await S.saveSettings();
            } catch (e) {
              const i = list.indexOf(item);
              if (i >= 0) list.splice(i, 1); // 回滚本次新增（连点重试也不会重复堆积）
              UI.toast('保存失败：' + (e.message || '请重试'), 'error');
              return;
            }
          }
          close(); UI.toast(editing ? '已保存' : '已添加倒计时', 'success'); window.App.refresh();
        });
      }
    });
  }

  /* ---------- 热力打卡（v1.1.5）：月视图（首页），数据域 habits ----------
     视图状态（v1.2.x 拍板 2）：habView='week'|'month'（会话态，默认月）；
     habAnchor='YYYY-MM-DD' 锚日（默认今天）——月=锚日所在月、周=锚日所在周；
     翻页移动锚日（月=±1 月、周=±7 天）、周/月切换保持锚日、「今天」跳回今天。 */
  let habView = 'month';
  let habAnchor = (function () {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  })();
  const HABIT_COLORS = ['#aecbfa', '#d7aefb', '#b7e1c1', '#fbd2a7', '#f6b8d0', '#a8e0e8', '#f7e6a1', '#f2b3b3'];

  function hfmt(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function hparse(s) {
    const p = String(s || '').split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  /* 单日格子 HTML（月/周视图共用）：梯度色/格心数字/未来 disabled/今天描边 */
  function habitCellHTML(def, log, ds, t) {
    const isCount = def.type === 'count';
    const max = Math.max(1, Number(def.max) || 5);
    const showNum = def.showNum !== false;
    const v = typeof log[ds] === 'number' ? log[ds] : (log[ds] ? 1 : 0);
    const on = v > 0;
    const future = ds > t;
    const bg = on ? (isCount ? S.habitColorScale(def.color, v, max) : (def.color || '#aecbfa')) : '#f2f2f4';
    return '<button type="button" class="hb-cell' + (on ? ' on' : '') + (future ? ' future' : '') + (ds === t ? ' today' : '') + '"' +
      ' data-hb-cell="' + esc(def.id) + '" data-date="' + ds + '"' + (future ? ' disabled' : '') +
      ' style="--hc:' + esc(def.color || '#aecbfa') + ';background:' + bg + '"' +
      ' title="' + ds + (on ? (isCount ? ' · ' + v + ' 次' : ' · 已打卡') : '') + '">' +
      (isCount && on && showNum ? '<span class="hb-n">' + v + '</span>' : '') + '</button>';
  }

  function habitsHTML(db) {
    // 预设三例播种（v1.1.9 拍板 5）：**纯内存零副作用**（Storage.ensureHabitSeeds 同款口径，
    // 统计页 habitHeat 共用）——建议带 __seed 标记不落盘；被交互的那条才随交互转正落盘；
    // habitSeeded（删光标记）/ habitPresetGone（删除墓碑）控制重启后哪些还播。
    if (S.ensureHabitSeeds) S.ensureHabitSeeds();
    const hb = db.habits || { defs: [], log: {} };
    const defs = hb.defs || [];
    const aw = hparse(habAnchor);
    const y = aw.getFullYear(), m = aw.getMonth() + 1;
    const daysInMonth = new Date(y, m, 0).getDate();
    const t = U.todayStr();
    const countOf = function (v) { return typeof v === 'number' ? v : (v ? 1 : 0); };
    const isWeek = habView === 'week';
    const pad = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 周一=0
    // 周视图：锚日所在周（周一~周日）7 天
    const wDow = (aw.getDay() + 6) % 7;
    const wMon = new Date(aw.getFullYear(), aw.getMonth(), aw.getDate() - wDow);
    const wSun = new Date(wMon.getFullYear(), wMon.getMonth(), wMon.getDate() + 6);
    // 卡片式月视图（v1.1.6 改版）：每习惯一卡 = 标题 + 数据行 + 7 列格 + 周几标签；
    // 周视图（v1.2.x 拍板 2）= 同卡一行 7 格（锚定周），其余元素（标题/数据行/done 态）不变
    const cards = defs.map(function (def) {
      const log = ((S.getDB().habits || {}).log || {})[def.id] || {};
      const isCount = def.type === 'count'; // 梯度式计数习惯（v1.1.5）
      // 数据行：本月次数（计数=次数和 / 二值=打卡天数）· 当前连续（两视图同口径=锚日所在月）
      let monthSum = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        monthSum += countOf(log[y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')]);
      }
      const cells = [];
      if (isWeek) {
        for (let i = 0; i < 7; i++) {
          cells.push(habitCellHTML(def, log, hfmt(new Date(wMon.getFullYear(), wMon.getMonth(), wMon.getDate() + i)), t));
        }
      } else {
        for (let i = 0; i < pad; i++) cells.push('<span class="hb-cell empty"></span>');
        for (let d = 1; d <= daysInMonth; d++) {
          cells.push(habitCellHTML(def, log, y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'), t));
        }
      }
      const streak = (S.habitCurrentStreak ? S.habitCurrentStreak(def.id) : 0) || 0;
      // 完成态（v1.2.x 拍板 1）：今日已打卡 → 绿卡（对齐 home-check.done 视觉，无文字提示）
      const done = countOf(log[t]) > 0;
      return '<div class="hb-card' + (done ? ' done' : '') + '" data-hb-card="' + esc(def.id) + '" style="--hc:' + esc(def.color || '#aecbfa') + '">' +
        '<button type="button" class="hb-card-head" data-hb-edit="' + esc(def.id) + '" title="编辑习惯">' +
        '<span class="hb-dot" style="background:' + esc(def.color || '#aecbfa') + '"></span>' + esc(def.name) + '</button>' +
        '<div class="hb-card-stat">' + (isCount ? '本月 ' + monthSum + ' 次' : '本月 ' + monthSum + ' 天') +
        (streak ? ' · 连续 ' + streak + ' 天' : '') + '</div>' +
        '<div class="hb-card-grid' + (isWeek ? ' hb-week' : '') + '">' + cells.join('') + '</div>' +
        '<div class="hb-card-week">' + ['一', '二', '三', '四', '五', '六', '日'].map(function (w) {
          return '<span>' + w + '</span>';
        }).join('') + '</div>' +
        '</div>';
    }).join('');
    const label = isWeek
      ? (wMon.getMonth() + 1) + '/' + wMon.getDate() + ' ~ ' + (wSun.getMonth() + 1) + '/' + wSun.getDate()
      : y + ' 年 ' + m + ' 月';
    return '<div class="panel" id="home-habits"><div class="panel-head">' + UI.icon('flame', 16) + ' 热力打卡' +
      '<div class="flex1"></div>' +
      // 周/月切换（v1.2.x 拍板 2）：seg-toggle-head 同款紧凑视觉，panel-head 右上
      '<div class="seg-toggle seg-toggle-head hb-view-toggle">' +
      '<button type="button" class="seg-btn' + (isWeek ? ' on' : '') + '" data-hb-view="week">周</button>' +
      '<button type="button" class="seg-btn' + (isWeek ? '' : ' on') + '" data-hb-view="month">月</button>' +
      '</div>' +
      '<div class="hb-month-nav">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-hb-mv="-1">' + UI.icon('chevron-left', 14) + '</button>' +
      '<span class="hb-month-label">' + label + '</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-hb-mv="1">' + UI.icon('chevron-right', 14) + '</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-hb-today title="回到今天所在周/月">今天</button>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-hb-add>' + UI.icon('plus', 14) + ' 添加</button></div>' +
      '<div class="panel-body"><div class="hb-cards">' +
      (cards || '<div class="empty-hint muted">还没有习惯项，点「添加」开始记录</div>') +
      '</div></div></div>';
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
        // 默认勾选（域口径 showNum 默认 true）；编辑时按现值，显式 false 才不勾
        ((def ? def.showNum !== false : true) ? ' checked' : '') + '>' +
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
          try {
            if (S.removeHabitDef) await S.removeHabitDef(def.id);
          } catch (e) {
            UI.toast('删除失败：' + (e.message || '请重试'), 'error');
            return;
          }
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
          try {
            if (S.saveHabitDef) await S.saveHabitDef(payload);
          } catch (e) {
            UI.toast('保存失败：' + (e.message || '请重试'), 'error');
            return;
          }
          close(); UI.toast(editing ? '已保存' : '已添加习惯', 'success'); window.App.refresh();
        });
      }
    });
  }

  function bindHabits(root) {
    const box = root.querySelector('#home-habits');
    if (!box) return;
    // 局部重绘热力面板（v1.1.6）：翻页/切视图不整页刷新——不再跳回页面顶端
    function redrawHabits() {
      const host = root.querySelector('#home-habits');
      if (host) {
        host.outerHTML = habitsHTML(S.getDB());
        bindHabits(root);
      }
    }
    // 周/月视图切换（v1.2.x 拍板 2）：保持锚日，仅重绘本面板
    box.querySelectorAll('[data-hb-view]').forEach(function (el) {
      el.addEventListener('click', function () {
        const v = el.getAttribute('data-hb-view');
        if (habView === v) return;
        habView = v;
        redrawHabits();
      });
    });
    // 「今天」：锚日回今天（月=今天所在月、周=今天所在周）
    const todayBtn = box.querySelector('[data-hb-today]');
    if (todayBtn) todayBtn.addEventListener('click', function () {
      habAnchor = U.todayStr();
      redrawHabits();
    });
    box.querySelectorAll('[data-hb-mv]').forEach(function (el) {
      el.addEventListener('click', function () {
        const delta = Number(el.getAttribute('data-hb-mv'));
        const aw = hparse(habAnchor);
        if (habView === 'week') {
          // 周视图 ‹ › 翻周（锚日 ±7 天）
          habAnchor = hfmt(new Date(aw.getFullYear(), aw.getMonth(), aw.getDate() + delta * 7));
        } else {
          // 月视图 ‹ › 翻月：锚日换到目标月同日（短月夹到月末）
          const target = new Date(aw.getFullYear(), aw.getMonth() + delta, 1);
          const dim = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
          target.setDate(Math.min(aw.getDate(), dim));
          habAnchor = hfmt(target);
        }
        redrawHabits();
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
      const hid = el.getAttribute('data-hb-cell');
      const ds = el.getAttribute('data-date');
      const def = ((S.getDB().habits || {}).defs || []).find(function (x) { return x.id === hid; });
      const isToday = ds === U.todayStr();
      if (def && def.type === 'count') {
        if (isToday) {
          // 计数习惯今日格：点击 +1、右键 -1（v1.1.6 改版：原今日行操作迁到今日格）
          el.addEventListener('click', function () {
            if (el.disabled) return;
            bumpHabitToday(hid, 1, box);
          });
          el.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            if (el.disabled) return;
            bumpHabitToday(hid, -1, box);
          });
        } else {
          // 计数习惯历史格：弹小编辑（改次数/清零），避免误触连加
          el.addEventListener('click', function () {
            if (el.disabled) return;
            openHabitDayEditor(def, ds);
          });
        }
      } else {
        el.addEventListener('click', function () {
          if (el.disabled) return;
          toggleHabitAt(hid, ds, box, el);
        });
      }
    });
  }

  /* 打卡交互（v1.1.5）：乐观更新——点击即时变色/切状态 + toast 确认，不整页刷新（消除延迟）。
     状态以 db 同步现值派生（toggleHabit/setHabitCount 是同步改内存再落盘）：
     - 不依赖格子 class（翻月后今日格不在 DOM，pill 也能正确切态）
     - 今日 pill 只反映「今天」的次数——补打/取消历史格不动 pill
     - 落盘失败：数据层已回滚内存，这里按 db 现值重绘（含失败前的连点），保持三处一致 */
  async function toggleHabitAt(habitId, dateStr, box, cellEl) {
    const def = ((S.getDB().habits || {}).defs || []).find(function (x) { return x.id === habitId; }) || {};
    const cur = S.habitCountOf ? S.habitCountOf(habitId, dateStr) : 0;
    const on = cur <= 0;
    if (cellEl) renderHabitDay(box, habitId, dateStr, on ? 1 : 0, def);
    UI.toast(on ? '已打卡 ✓' : '已取消打卡', on ? 'success' : 'info');
    try {
      if (S.toggleHabit) await S.toggleHabit(habitId, dateStr);
      updateHabitStat(box, habitId);
    } catch (e) {
      const now = S.habitCountOf ? S.habitCountOf(habitId, dateStr) : 0;
      if (cellEl) renderHabitDay(box, habitId, dateStr, now, def);
      updateHabitStat(box, habitId);
      UI.toast('打卡失败：' + (e.message || '请重试'), 'error');
    }
  }

  /* 计数习惯今日 +1/-1（v1.1.5 梯度式）：乐观更新格子色/数字，失败按 db 现值重绘 */
  async function bumpHabitToday(habitId, delta, box) {
    const t = U.todayStr();
    const def = ((S.getDB().habits || {}).defs || []).find(function (x) { return x.id === habitId; }) || {};
    const cur = S.habitCountOf ? S.habitCountOf(habitId, t) : 0;
    const next = Math.max(0, cur + delta);
    renderHabitDay(box, habitId, t, next, def);
    UI.toast(next > 0 ? ('已打卡 ' + next + ' 次 ✓') : '已清零', next > 0 ? 'success' : 'info');
    try {
      if (S.setHabitCount) await S.setHabitCount(habitId, t, next);
      updateHabitStat(box, habitId);
    } catch (e) {
      const now = S.habitCountOf ? S.habitCountOf(habitId, t) : 0;
      renderHabitDay(box, habitId, t, now, def);
      updateHabitStat(box, habitId);
      UI.toast('打卡失败：' + (e.message || '请重试'), 'error');
    }
  }

  /* 单日格子重绘（次数→梯度色/数字），乐观更新共用；今日格变化同步卡片 done 态（拍板 1） */
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
    // 完成态即时切换（与格子变色同步）：done 只看「今天」
    if (dateStr === U.todayStr()) {
      const card = box.querySelector('[data-hb-card="' + habitId + '"]');
      if (card) card.classList.toggle('done', on);
    }
  }

  /* 卡片数据行更新（v1.1.6 改版）：本月 N 次/天 · 连续 M 天（从 db 重算）+ done 态一并更新 */
  function updateHabitStat(box, habitId) {
    const card = box.querySelector('[data-hb-card="' + habitId + '"]');
    if (!card) return;
    const stat = card.querySelector('.hb-card-stat');
    if (!stat) return;
    const def = ((S.getDB().habits || {}).defs || []).find(function (x) { return x.id === habitId; }) || {};
    const [y, m] = habAnchor.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const log = ((S.getDB().habits || {}).log || {})[habitId] || {};
    const countOf = function (v) { return typeof v === 'number' ? v : (v ? 1 : 0); };
    let monthSum = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      monthSum += countOf(log[ds]);
    }
    const streak = (S.habitCurrentStreak ? S.habitCurrentStreak(habitId) : 0) || 0;
    stat.textContent = (def.type === 'count' ? '本月 ' + monthSum + ' 次' : '本月 ' + monthSum + ' 天') +
      (streak ? ' · 连续 ' + streak + ' 天' : '');
    // 完成态（拍板 1）：今日已打卡 → .hb-card.done（对齐 home-check.done），无文字提示
    card.classList.toggle('done', (S.habitCountOf ? S.habitCountOf(habitId, U.todayStr()) : 0) > 0);
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
        '<input type="number" min="0" max="99" id="hd-n" value="' + cur + '" style="width:90px;text-align:center">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-hd="1">' + UI.icon('plus', 14) + '</button>' +
        '</div></label></div>' +
        '<p class="muted small">保存后色块深浅随次数变化（' + Math.max(1, Number(def.max) || 5) + ' 次最深）</p>',
      footerHTML: '<button type="button" class="btn btn-ghost" data-hd="0">清零</button>' +
        '<button type="button" class="btn btn-ghost" data-x="c">取消</button>' +
        '<button type="button" class="btn btn-primary" data-x="s">保存</button>',
      onMount: function (w, close) {
        const inp = w.querySelector('#hd-n');
        // 次数上限 0~99（v1.1.9 拍板 4，与定义层 max=99 对齐）：+/− 与直接输入都限幅
        const clampN = function (v) { return Math.min(99, Math.max(0, Math.floor(Number(v) || 0))); };
        w.querySelectorAll('[data-hd]').forEach(function (b) {
          b.addEventListener('click', function () {
            const d = Number(b.getAttribute('data-hd'));
            if (d === 0) { inp.value = '0'; return; }
            inp.value = String(clampN((Number(inp.value) || 0) + d));
          });
        });
        inp.addEventListener('input', function () {
          if (inp.value === '') return; // 允许清空重输，保存时再兜底
          const n = clampN(inp.value);
          if (String(n) !== inp.value) inp.value = String(n);
        });
        w.querySelector('[data-x=c]').addEventListener('click', close);
        w.querySelector('[data-x=s]').addEventListener('click', async function () {
          const n = clampN(inp.value);
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
    // 过期折叠组展开/收起（v1.1.9 拍板 3，默认收起）
    root.querySelectorAll('[data-cd-exp-toggle]').forEach(function (el) {
      el.addEventListener('click', function () {
        const body = root.querySelector('[data-cd-exp-body]');
        if (!body) return;
        body.hidden = !body.hidden;
        el.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
      });
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
