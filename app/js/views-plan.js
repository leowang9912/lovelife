/* views-plan.js — 我的统计（五组分块：核心/消费/使用/提醒/分品类） */
window.PlanView = (function () {
  const U = window.Utils;
  const M = window.Models;
  const S = window.Storage;
  const UI = window.UI;
  const C = window.Charts;

  /* 栏目定义：group 归属 + 布局宽度 */
  const SECTION_META = {
    kpi: { name: 'KPI 总览', group: 'core', fixed: true, span: 3 },
    composition: { name: '投入构成', group: 'core', fixed: true, span: 1 },
    monthly: { name: '月度消费曲线', group: 'spend', span: 2 },
    budget: { name: '预算进度', group: 'spend', span: 1 },
    catRank: { name: '分类消费排行', group: 'spend', span: 1 },
    cpw: { name: 'cost per wear 精算', group: 'usage', span: 1 },
    useRank: { name: '使用频率排行', group: 'usage', span: 1 },
    idle: { name: '吃灰预警', group: 'usage', span: 1 },
    expiry: { name: '临期提醒', group: 'remind', span: 1 },
    empty: { name: '空瓶/回购', group: 'remind', span: 1 },
    game: { name: '游戏通关状态', group: 'category', span: 1 },
    outfitStats: { name: '穿搭统计', group: 'category', span: 1 },
    foodStats: { name: '美食统计', group: 'category', span: 1 }
  };

  const GROUPS = [
    { id: 'core', name: '核心' },
    { id: 'spend', name: '消费' },
    { id: 'usage', name: '使用' },
    { id: 'remind', name: '提醒' },
    { id: 'category', name: '分品类' }
  ];

  let editMode = false;

  function defaultSections() {
    return Object.keys(SECTION_META).map(function (id) {
      return { id: id, enabled: SECTION_META[id].group !== 'category', fixed: !!SECTION_META[id].fixed };
    });
  }

  /* 兼容旧配置：映射到新栏目集合 */
  function normalizeSections(db) {
    const cur = (db.settings.planSections || []).filter(function (s) { return SECTION_META[s.id]; });
    const have = {};
    cur.forEach(function (s) { have[s.id] = true; });
    // 补齐新增默认栏目
    Object.keys(SECTION_META).forEach(function (id) {
      if (!have[id]) cur.push({ id: id, enabled: SECTION_META[id].group === 'core' || SECTION_META[id].group === 'spend', fixed: !!SECTION_META[id].fixed });
    });
    // 按 meta 顺序排（GROUPS 顺序）
    const order = Object.keys(SECTION_META);
    cur.sort(function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); });
    return cur;
  }

  function render(root) {
    const db = S.getDB();
    if (!db) return;
    const sum = M.summary(db);
    db.settings.planSections = normalizeSections(db);
    const sections = db.settings.planSections;

    root.innerHTML =
      '<div class="page-head"><h2>我的统计</h2><div class="page-actions">' +
      '<button class="btn btn-ghost" id="btn-edit-sections">' + (editMode ? '完成' : '⚙️ 栏目设置') + '</button>' +
      '<button class="btn btn-primary" data-act="add-device">＋ 记数码</button>' +
      '<button class="btn btn-primary" data-act="add-clothing">＋ 记衣服</button>' +
      '<button class="btn btn-ghost" data-act="outfit">今日打卡</button></div></div>' +
      '<div class="plan-wrap" id="plan-wrap"></div>';

    const wrap = root.querySelector('#plan-wrap');
    let globalIdx = 0;
    GROUPS.forEach(function (g) {
      const gSecs = sections.filter(function (s) {
        return (SECTION_META[s.id] || {}).group === g.id && (s.enabled || editMode);
      });
      if (!gSecs.length) return;
      const gEl = document.createElement('div');
      gEl.className = 'plan-group';
      gEl.innerHTML = '<div class="plan-group-title">' + g.name + '</div><div class="plan-grid"></div>';
      wrap.appendChild(gEl);
      const grid = gEl.querySelector('.plan-grid');

      gSecs.forEach(function (sec) {
        const meta = SECTION_META[sec.id];
        const idx = sections.indexOf(sec);
        const el = document.createElement('div');
        el.className = 'panel plan-sec span-' + (meta.span || 1) + (sec.enabled ? '' : ' sec-off');
        el.innerHTML =
          '<div class="panel-head"><h3>' + meta.name + '</h3>' +
          (editMode
            ? '<div class="sec-ctrl">' +
            (meta.fixed ? '<span class="tag">固定</span>' :
              '<button class="btn-icon" data-move="up" data-idx="' + idx + '">↑</button>' +
              '<button class="btn-icon" data-move="down" data-idx="' + idx + '">↓</button>' +
              '<button class="btn-icon" data-toggle="' + idx + '">' + (sec.enabled ? '👁' : '🚫') + '</button>') +
            '</div>' : '') +
          '</div><div class="panel-body" data-body="' + sec.id + '"></div>';
        grid.appendChild(el);
        renderSection(el.querySelector('[data-body]'), sec.id, db, sum);
      });
    });

    root.querySelector('#btn-edit-sections').addEventListener('click', function () {
      editMode = !editMode;
      render(root);
    });
    root.querySelectorAll('[data-move]').forEach(function (b) {
      b.addEventListener('click', function () {
        const idx = Number(b.getAttribute('data-idx'));
        const dir = b.getAttribute('data-move');
        const arr = db.settings.planSections;
        const t = dir === 'up' ? idx - 1 : idx + 1;
        if (t < 0 || t >= arr.length) return;
        const tmp = arr[idx]; arr[idx] = arr[t]; arr[t] = tmp;
        S.saveSettings().then(function () { render(root); });
      });
    });
    root.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        const idx = Number(b.getAttribute('data-toggle'));
        db.settings.planSections[idx].enabled = !db.settings.planSections[idx].enabled;
        S.saveSettings().then(function () { render(root); });
      });
    });
    root.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const act = btn.getAttribute('data-act');
        if (act === 'add-device') window.Views.openItemEditor(null, 'digital');
        if (act === 'add-clothing') window.Views.openItemEditor(null, 'clothing');
        if (act === 'outfit') window.App.go('outfits');
      });
    });
  }

  function renderSection(body, id, db, sum) {
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = U.monthKey(U.todayStr(d));
      months.push({ label: key.slice(5) + '月', value: Math.round(sum.monthlySpend[key] || 0) });
    }

    if (id === 'kpi') {
      body.innerHTML = '<div class="kpi-row" style="margin:0">' +
        kpi('总投入', U.formatMoney(sum.totalInvest), '全部历史购入') +
        kpi('在手估值', U.formatMoney(sum.bookValue), '折旧现值') +
        kpi('回血潜力', U.formatMoney(sum.resalePotential), '按预估二手价') +
        kpi('本月花费', U.formatMoney(sum.monthSpend + (sum.food.monthSpend || 0)), sum.monthNewCount + ' 件新物') +
        kpi('在手物品', sum.counts.all + ' 件', '数码 ' + (sum.counts.device + sum.counts.game) + ' · 衣 ' + sum.counts.clothing + ' · 生活 ' + sum.counts.life) +
        '</div>' +
        '<div class="kpi-mini-row">' +
        '<div class="kpi-mini">日均持有成本<strong>' + U.formatCost(sum.dailyCostTotal) + '</strong></div>' +
        '<div class="kpi-mini">估值/投入比<strong>' + (sum.totalInvest ? Math.round(sum.bookValue / sum.totalInvest * 100) : 0) + '%</strong></div>' +
        '<div class="kpi-mini">本月餐食<strong>' + sum.food.monthCount + ' 顿</strong></div>' +
        '<div class="kpi-mini">穿搭打卡<strong>' + db.outfits.length + ' 次</strong></div>' +
        '</div>';
      return;
    }
    if (id === 'composition') {
      body.className = 'panel-body center';
      const kindData = [
        { label: '数码', value: sum.items.filter(function (i) { return (i.kind === 'device' || i.kind === 'game') && i.status !== 'sold' && i.status !== 'gifted'; })
          .reduce(function (a, b) { return a + M.ownInvested(db, b); }, 0), color: '#0071e3' },
        { label: '衣服', value: sum.items.filter(function (i) { return i.kind === 'clothing' && i.status !== 'sold'; })
          .reduce(function (a, b) { return a + M.ownInvested(db, b); }, 0), color: '#ff2d55' },
        { label: '生活', value: sum.items.filter(function (i) { return i.kind === 'life'; })
          .reduce(function (a, b) { return a + M.ownInvested(db, b); }, 0), color: '#af52de' },
        { label: '美食', value: sum.food.totalSpend || 0, color: '#ff9500' }
      ];
      body.innerHTML = C.donut(kindData, { centerText: U.formatMoney(sum.activeInvest), centerSub: '在手总投入' });
      return;
    }
    if (id === 'monthly') {
      body.innerHTML = C.line(months);
      return;
    }
    if (id === 'budget') {
      const b = db.settings.budget || { monthlyTotal: 0, categories: {} };
      const spent = sum.catSpend || {};
      const rows = [
        { label: '本月总花费', v: sum.monthSpend + (sum.food.monthSpend || 0), max: Number(b.monthlyTotal) || 0 },
        { label: '数码', v: spent.digital || 0, max: Number((b.categories || {}).digital) || 0 },
        { label: '衣服', v: spent.clothing || 0, max: Number((b.categories || {}).clothing) || 0 },
        { label: '生活', v: spent.life || 0, max: Number((b.categories || {}).life) || 0 },
        { label: '美食', v: spent.food || 0, max: Number((b.categories || {}).food) || 0 }
      ];
      body.innerHTML = rows.map(function (r) {
        const pct = r.max > 0 ? Math.min(100, Math.round(r.v / r.max * 100)) : 3;
        const over = r.max > 0 && r.v > r.max;
        return '<div class="rank-row"><div class="rank-label">' + r.label + '</div>' +
          '<div class="rank-bar-track"><div class="rank-bar-fill" style="width:' + pct + '%;background:' + (over ? '#ff3b30' : '#34c759') + '"></div></div>' +
          '<div class="rank-value">' + U.formatMoney(r.v) + (r.max > 0 ? ' / ' + U.formatMoney(r.max) : '') + '</div></div>';
      }).join('');
      return;
    }
    if (id === 'catRank') {
      const spent = sum.catSpend || {};
      const rows = [
        { label: '数码', value: spent.digital || 0, color: '#0071e3' },
        { label: '衣服', value: spent.clothing || 0, color: '#ff2d55' },
        { label: '生活', value: spent.life || 0, color: '#af52de' },
        { label: '美食', value: spent.food || 0, color: '#ff9500' }
      ].sort(function (a, b) { return b.value - a.value; });
      body.innerHTML = C.rankBars(rows.map(function (r) {
        return { label: r.label, value: r.value, valueText: U.formatMoney(r.value), color: r.color };
      }));
      return;
    }
    if (id === 'expiry') {
      const list = sum.expiry.slice(0, 8);
      body.innerHTML = list.length ? '<div class="mini-table">' + list.map(function (x) {
        return '<div class="mini-row"><span class="flex1">' + U.escapeHtml(x.item.name) + '</span>' +
          '<span class="tag ' + (x.daysLeft < 0 ? 'tag-warn' : '') + '">' + x.label + '</span>' +
          '<span class="muted">' + (x.daysLeft < 0 ? '已超 ' + (-x.daysLeft) + ' 天' : '剩 ' + x.daysLeft + ' 天') + '</span></div>';
      }).join('') + '</div>' : '<p class="empty-hint">暂无临期物品</p>';
      return;
    }
    if (id === 'idle') {
      const warn = db.settings.idleWarnDays || 60;
      const idle = sum.idleList.filter(function (x) { return x.idle >= warn; }).slice(0, 8);
      body.innerHTML = idle.length ? C.rankBars(idle.map(function (x) {
        return { label: x.item.name, value: x.idle, valueText: x.idle + ' 天' };
      })) : '<p class="empty-hint">没有吃灰物品，状态很好</p>';
      return;
    }
    if (id === 'cpw') {
      const good = sum.cpwList.filter(function (c) { return c.wear > 0 && c.cpw != null; }).slice(0, 6);
      const lifes = sum.lifeUseList.filter(function (c) { return c.uses > 0 && c.cpw != null; }).slice(0, 4);
      body.innerHTML =
        (good.length ? good.map(function (c) {
          return '<div class="mini-row"><span class="flex1">' + U.escapeHtml(c.item.name) + '</span>' +
            '<span class="muted">穿 ' + c.wear + ' 次</span><strong>' + U.formatCost(c.cpw) + '/次</strong></div>';
        }).join('') : '<p class="empty-hint">还没有穿着记录</p>') +
        (lifes.length ? '<h4 class="detail-sub">美妆单次成本</h4>' + lifes.map(function (c) {
          return '<div class="mini-row"><span class="flex1">' + U.escapeHtml(c.item.name) + '</span>' +
            '<span class="muted">用 ' + c.uses + ' 次</span><strong>' + U.formatCost(c.cpw) + '/次</strong></div>';
        }).join('') : '');
      return;
    }
    if (id === 'useRank') {
      // 使用/穿着频率排行（含设备最近使用）
      const ranked = sum.items.slice().sort(function (a, b) {
        return (b.wearCount || b.useCount || 0) - (a.wearCount || a.useCount || 0);
      }).filter(function (i) { return (i.wearCount || i.useCount || 0) > 0; }).slice(0, 8);
      body.innerHTML = ranked.length ? C.rankBars(ranked.map(function (i) {
        const n = i.kind === 'clothing' ? i.wearCount : (i.useCount || 0);
        return {
          label: i.name, value: n,
          valueText: n + (i.kind === 'clothing' ? ' 次穿着' : ' 次使用')
        };
      })) : '<p class="empty-hint">暂无使用记录</p>';
      return;
    }
    if (id === 'empty') {
      const list = sum.empties.slice(0, 8);
      body.innerHTML = list.length ? '<div class="mini-table">' + list.map(function (i) {
        return '<div class="mini-row"><span class="flex1">' + U.escapeHtml(i.name) + '</span>' +
          '<span class="tag">' + (i.repurchase ? '待回购' : '已空瓶') + '</span>' +
          '<span class="muted">' + U.escapeHtml(i.emptyDate || '') + '</span></div>';
      }).join('') + '</div>' : '<p class="empty-hint">暂无空瓶记录</p>';
      return;
    }
    if (id === 'game') {
      const gs = sum.gameStatusCount;
      const total = (gs.unopened + gs.playing + gs.finished + gs.dropped) || 1;
      body.className = 'panel-body center';
      body.innerHTML = C.donut([
        { label: '未开坑', value: gs.unopened, color: '#ff9500' },
        { label: '在玩', value: gs.playing, color: '#0071e3' },
        { label: '通关', value: gs.finished, color: '#34c759' },
        { label: '弃坑', value: gs.dropped, color: '#aeaeb2' }
      ], { centerText: Math.round(gs.finished / total * 100) + '%', centerSub: '通关率' });
      return;
    }
    if (id === 'outfitStats') {
      // 穿搭统计三合一：打卡趋势 + 场合分布
      const wearByMonth = {};
      db.outfits.forEach(function (o) {
        const k = U.monthKey(o.date);
        wearByMonth[k] = (wearByMonth[k] || 0) + 1;
      });
      const trend = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = U.monthKey(U.todayStr(d));
        trend.push({ label: key.slice(5) + '月', value: wearByMonth[key] || 0 });
      }
      const occCount = {};
      (db.categories.occasion || []).forEach(function (o) { occCount[o] = 0; });
      db.outfits.forEach(function (o) {
        if (o.occasion && occCount[o.occasion] !== undefined) occCount[o.occasion]++;
      });
      body.innerHTML = C.bar(trend) +
        '<h4 class="detail-sub">场合分布</h4>' +
        C.rankBars(Object.keys(occCount).map(function (o) {
          return { label: o, value: occCount[o], valueText: occCount[o] + ' 次' };
        }));
      return;
    }
    if (id === 'foodStats') {
      const f = sum.food;
      const byMeal = Object.keys(f.byMeal || {});
      body.innerHTML = '<div class="mini-table">' +
        '<div class="mini-row"><span class="flex1">本月餐食</span><span>' + f.monthCount + ' 顿</span></div>' +
        '<div class="mini-row"><span class="flex1">本月花费</span><span>' + U.formatMoney(f.monthSpend) + '</span></div>' +
        '<div class="mini-row"><span class="flex1">本月热量</span><span>' + Math.round(f.monthCalories) + ' kcal</span></div>' +
        '<div class="mini-row"><span class="flex1">平均评分</span><span>' + (f.avgRating ? f.avgRating.toFixed(1) + ' ★' : '—') + '</span></div>' +
        '</div>' +
        (byMeal.length ? '<h4 class="detail-sub">餐别分布</h4>' + C.rankBars(byMeal.map(function (m) {
          return { label: m, value: f.byMeal[m], valueText: f.byMeal[m] + ' 顿' };
        })) : '');
      return;
    }
    body.innerHTML = '<p class="empty-hint">—</p>';
  }

  function kpi(label, value, sub) {
    return '<div class="kpi"><div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-value">' + value + '</div><div class="kpi-sub">' + U.escapeHtml(sub) + '</div></div>';
  }

  return { render: render, defaultSections: defaultSections };
})();
