/* views-plan.js — 我的统计 v2：4 板块（总体/数码/衣橱/生活）+ 块级屏蔽 + 块内拖动 */
window.PlanView = (function () {
  const U = window.Utils;
  const M = window.Models;
  const S = window.Storage;
  const UI = window.UI;
  const C = window.Charts;

  const BLOCKS = [
    { id: 'overall', name: '总体统计' },
    { id: 'digital', name: '我的数码' },
    { id: 'clothing', name: '我的衣橱' },
    { id: 'life', name: '我的生活' }
  ];

  /* 栏目定义：block 归属 + 默认宽度档位 */
  const SECTION_META = {
    kpi: { name: 'KPI 总览', block: 'overall', fixed: true, size: 'l' },
    composition: { name: '投入构成', block: 'overall', fixed: true, size: 'm' },
    monthly: { name: '月度消费曲线', block: 'overall', size: 'l' },
    catRank: { name: '分类消费排行', block: 'overall', size: 'm' },
    budget: { name: '预算进度', block: 'overall', size: 'l' },
    game: { name: '游戏通关状态', block: 'digital', size: 's' },
    dUseRank: { name: '数码使用排行', block: 'digital', size: 'm' },
    dWarranty: { name: '保修临期', block: 'digital', size: 'm' },
    resale: { name: '回血潜力', block: 'digital', size: 'm' },
    dIdle: { name: '数码吃灰排行', block: 'digital', size: 'm' },
    cpw: { name: 'cost per wear 精算', block: 'clothing', size: 'm' },
    outfitStats: { name: '穿搭统计', block: 'clothing', size: 'l' },
    cIdle: { name: '衣物吃灰排行', block: 'clothing', size: 'm' },
    lCpw: { name: '美妆单次成本', block: 'life', size: 'm' },
    lUseRank: { name: '美妆使用频率', block: 'life', size: 'm' },
    lExpiry: { name: 'PAO 临期', block: 'life', size: 'm' },
    empty: { name: '空瓶/回购', block: 'life', size: 'm' },
    foodStats: { name: '美食统计', block: 'life', size: 'm' }
  };

  const SIZE_LABELS = { s: '小', m: '中', l: '大' };

  let editMode = false;

  /* 旧栏目 → 新栏目迁移映射 */
  const LEGACY_MAP = {
    useRank: ['dUseRank'], idle: ['dIdle', 'cIdle'],
    expiry: ['dWarranty', 'lExpiry'], cpwLife: ['lCpw'], lifeUseRank: ['lUseRank']
  };

  /* 补齐/迁移栏目，保留用户已有顺序（块内相对顺序不变） */
  function normalizeSections(db) {
    const raw = db.settings.planSections || [];
    const flat = [];
    const have = {};
    raw.forEach(function (s) {
      if (SECTION_META[s.id]) {
        if (!have[s.id]) { flat.push(s); have[s.id] = true; }
      } else if (LEGACY_MAP[s.id]) {
        LEGACY_MAP[s.id].forEach(function (nid) {
          if (!have[nid] && SECTION_META[nid]) {
            flat.push({ id: nid, enabled: s.enabled !== false, size: s.size });
            have[nid] = true;
          }
        });
      }
    });
    Object.keys(SECTION_META).forEach(function (id) {
      if (!have[id]) {
        flat.push({
          id: id,
          enabled: SECTION_META[id].fixed || ['monthly', 'budget', 'cpw', 'game', 'foodStats'].indexOf(id) >= 0,
          fixed: !!SECTION_META[id].fixed
        });
      }
    });
    flat.forEach(function (s) {
      if (!s.size || !SIZE_LABELS[s.size]) s.size = SECTION_META[s.id].size || 'm';
    });
    return flat;
  }

  function blockState(db) {
    const st = db.settings.planBlocks || {};
    return { overall: st.overall !== false, digital: st.digital !== false, clothing: st.clothing !== false, life: st.life !== false };
  }

  function render(root) {
    const db = S.getDB();
    if (!db) return;
    const sum = M.summary(db);
    db.settings.planSections = normalizeSections(db);
    const sections = db.settings.planSections;
    const blocks = blockState(db);

    root.innerHTML =
      '<div class="page-head"><h2>我的统计</h2><div class="page-actions">' +
      '<button class="btn btn-ghost" id="btn-edit-sections">' + (editMode ? '完成' : '⚙️ 栏目设置') + '</button>' +
      '<button class="btn btn-primary" data-act="add-device">＋ 记数码</button>' +
      '<button class="btn btn-primary" data-act="add-clothing">＋ 记衣服</button>' +
      '<button class="btn btn-ghost" data-act="outfit">今日打卡</button></div></div>' +
      (editMode ? '<p class="muted pad-8">拖动面板可块内换序；按钮调宽度/隐藏/上下移；👁 可整块屏蔽。</p>' : '') +
      '<div class="plan-wrap" id="plan-wrap"></div>';

    const wrap = root.querySelector('#plan-wrap');
    BLOCKS.forEach(function (block) {
      const visible = blocks[block.id];
      if (!visible && !editMode) return;
      const gSecs = sections.filter(function (s) {
        return (SECTION_META[s.id] || {}).block === block.id && (s.enabled || editMode);
      });
      const bEl = document.createElement('div');
      bEl.className = 'plan-block' + (visible ? '' : ' block-off');
      bEl.setAttribute('data-block', block.id);
      bEl.innerHTML =
        '<div class="plan-block-head">' +
        '<h3 class="plan-block-title">' + block.name + '</h3>' +
        '<button class="btn-icon block-eye" data-block-toggle="' + block.id + '" title="' +
        (visible ? '屏蔽此板块' : '恢复此板块') + '">' + (visible ? '👁' : '🚫') + '</button>' +
        '</div>' +
        '<div class="plan-grid" data-grid="' + block.id + '"></div>';
      wrap.appendChild(bEl);
      const grid = bEl.querySelector('.plan-grid');

      if (!visible) {
        grid.innerHTML = '<p class="empty-hint">此板块已屏蔽（点右上角恢复）</p>';
        return;
      }
      gSecs.forEach(function (sec) {
        const meta = SECTION_META[sec.id];
        const idx = sections.indexOf(sec);
        const el = document.createElement('div');
        el.className = 'panel plan-sec' + (sec.enabled ? '' : ' sec-off');
        el.setAttribute('data-size', sec.size || 'm');
        el.setAttribute('data-id', sec.id);
        if (editMode && !meta.fixed) el.setAttribute('draggable', 'true');
        el.innerHTML =
          '<div class="panel-head">' +
          (editMode && !meta.fixed ? '<span class="sec-drag-handle" title="拖动排序">⠿</span>' : '') +
          '<h3>' + meta.name + '</h3>' +
          (editMode
            ? '<div class="sec-ctrl">' +
            (meta.fixed ? '<span class="tag">固定</span>' :
              '<div class="sec-size-btns">' +
              Object.keys(SIZE_LABELS).map(function (sz) {
                return '<button class="sec-size-btn' + ((sec.size || 'm') === sz ? ' on' : '') +
                  '" data-size-btn="' + idx + '" data-size-val="' + sz + '">' + SIZE_LABELS[sz] + '</button>';
              }).join('') + '</div>' +
              '<button class="btn-icon" data-move="up" data-idx="' + idx + '">↑</button>' +
              '<button class="btn-icon" data-move="down" data-idx="' + idx + '">↓</button>' +
              '<button class="btn-icon" data-toggle="' + idx + '">' + (sec.enabled ? '👁' : '🚫') + '</button>') +
            '</div>' : '') +
          '</div><div class="panel-body" data-body="' + sec.id + '"></div>';
        grid.appendChild(el);
        renderSection(el.querySelector('[data-body]'), sec.id, db, sum);
      });
    });

    bindControls(root, db);
    if (editMode) bindDrag(root, db);
  }

  function bindControls(root, db) {
    root.querySelector('#btn-edit-sections').addEventListener('click', function () {
      editMode = !editMode;
      render(root);
    });
    // 块级屏蔽（随时可点）
    root.querySelectorAll('[data-block-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = b.getAttribute('data-block-toggle');
        db.settings.planBlocks = db.settings.planBlocks || {};
        const st = blockState(db);
        db.settings.planBlocks[id] = !st[id];
        S.saveSettings().then(function () {
          render(root);
          UI.toast(db.settings.planBlocks[id] ? '板块已恢复' : '板块已屏蔽（设置页可恢复）', 'success');
        });
      });
    });
    // ↑↓：与同块内相邻栏目交换
    root.querySelectorAll('[data-move]').forEach(function (b) {
      b.addEventListener('click', function () {
        const idx = Number(b.getAttribute('data-idx'));
        const arr = db.settings.planSections;
        const block = (SECTION_META[arr[idx].id] || {}).block;
        const dir = b.getAttribute('data-move') === 'up' ? -1 : 1;
        let t = idx + dir;
        while (t >= 0 && t < arr.length && (SECTION_META[arr[t].id] || {}).block !== block) t += dir;
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
    root.querySelectorAll('[data-size-btn]').forEach(function (b) {
      b.addEventListener('click', function () {
        const idx = Number(b.getAttribute('data-size-btn'));
        db.settings.planSections[idx].size = b.getAttribute('data-size-val');
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

  /* 拖动排序：仅同一板块内 */
  function bindDrag(root, db) {
    let dragId = null;
    let placeholder = null;
    function ph() {
      if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.className = 'drag-placeholder';
      }
      return placeholder;
    }
    root.querySelectorAll('.plan-sec[draggable]').forEach(function (el) {
      el.addEventListener('dragstart', function (e) {
        dragId = el.getAttribute('data-id');
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', dragId); } catch (err) { /* noop */ }
        const p = ph();
        p.style.minHeight = Math.max(90, el.offsetHeight) + 'px';
        el.parentNode.insertBefore(p, el.nextSibling);
      });
      el.addEventListener('dragend', function () {
        el.classList.remove('dragging');
        if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
      });
    });
    root.querySelectorAll('.plan-grid').forEach(function (grid) {
      grid.addEventListener('dragover', function (e) {
        if (!dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const over = e.target.closest ? e.target.closest('.plan-sec') : null;
        const p = ph();
        // 只允许同块内移动
        const dragEl = root.querySelector('.plan-sec[data-id="' + dragId + '"]');
        if (!dragEl || dragEl.parentNode !== grid) return;
        if (!over || over.getAttribute('data-id') === dragId) return;
        const rect = over.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        if (before) grid.insertBefore(p, over);
        else grid.insertBefore(p, over.nextSibling);
      });
      grid.addEventListener('drop', function (e) {
        if (!dragId) return;
        e.preventDefault();
        const p = ph();
        const parent = p.parentNode;
        if (!parent) return;
        // 块内 DOM 顺序 → 重排该块在数组里的相对顺序
        const domIds = Array.prototype.slice.call(parent.children)
          .filter(function (n) { return n.classList.contains('plan-sec') || n === p; })
          .map(function (n) { return n === p ? dragId : n.getAttribute('data-id'); });
        const arr = db.settings.planSections;
        const block = (SECTION_META[dragId] || {}).block;
        // 抽出该块的栏目按 DOM 序放回
        const blockIdxs = [];
        arr.forEach(function (s, i) { if ((SECTION_META[s.id] || {}).block === block) blockIdxs.push(i); });
        const blockSecs = blockIdxs.map(function (i) { return arr[i]; });
        const byId = {};
        blockSecs.forEach(function (s) { byId[s.id] = s; });
        const reordered = [];
        domIds.forEach(function (id) {
          if (byId[id]) { reordered.push(byId[id]); delete byId[id]; }
        });
        Object.keys(byId).forEach(function (id) { reordered.push(byId[id]); });
        blockIdxs.forEach(function (arrI, k) { arr[arrI] = reordered[k]; });
        dragId = null;
        if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
        S.saveSettings().then(function () { render(root); });
      });
    });
  }

  /* ================= 各栏目内容 ================= */
  function renderSection(body, id, db, sum) {
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = U.monthKey(U.todayStr(d));
      months.push({ label: key.slice(5) + '月', value: Math.round(sum.monthlySpend[key] || 0) });
    }
    const isDigital = function (i) { return i.kind === 'device' || i.kind === 'game'; };

    if (id === 'kpi') {
      body.innerHTML = '<div class="kpi-row" style="margin:0">' +
        kpi('总投入', U.formatMoney(sum.totalInvest), '全部历史购入') +
        kpi('在手估值', U.formatMoney(sum.bookValue), '折旧现值') +
        kpi('回血潜力', U.formatMoney(sum.resalePotential), '按预估二手价') +
        kpi('本月花费', U.formatMoney(sum.monthSpend + (sum.food.monthSpend || 0)), sum.monthNewCount + ' 件新物') +
        kpi('在手物品', sum.counts.all + ' 件', '数码 ' + (sum.counts.device + sum.counts.game) + ' · 衣 ' + sum.counts.clothing + ' · 生活 ' + sum.counts.life) +
        '</div><div class="kpi-mini-row">' +
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
        { label: '数码', value: sum.items.filter(function (i) { return isDigital(i) && i.status !== 'sold' && i.status !== 'gifted'; })
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
    if (id === 'monthly') { body.innerHTML = C.line(months); return; }
    if (id === 'catRank') {
      const spent = sum.catSpend || {};
      body.innerHTML = C.rankBars([
        { label: '数码', value: spent.digital || 0, valueText: U.formatMoney(spent.digital || 0), color: '#0071e3' },
        { label: '衣服', value: spent.clothing || 0, valueText: U.formatMoney(spent.clothing || 0), color: '#ff2d55' },
        { label: '生活', value: spent.life || 0, valueText: U.formatMoney(spent.life || 0), color: '#af52de' },
        { label: '美食', value: spent.food || 0, valueText: U.formatMoney(spent.food || 0), color: '#ff9500' }
      ].sort(function (a, b) { return b.value - a.value; }));
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
    if (id === 'dUseRank') {
      const ranked = sum.items.filter(isDigital).filter(function (i) { return (i.useCount || 0) > 0; })
        .sort(function (a, b) { return (b.useCount || 0) - (a.useCount || 0); }).slice(0, 8);
      body.innerHTML = ranked.length ? C.rankBars(ranked.map(function (i) {
        return { label: i.name, value: i.useCount, valueText: i.useCount + ' 次使用' };
      })) : '<p class="empty-hint">暂无使用记录（编辑物品可填使用次数）</p>';
      return;
    }
    if (id === 'dWarranty') {
      const list = sum.expiry.filter(function (x) { return x.kind === 'warranty'; }).slice(0, 8);
      body.innerHTML = list.length ? miniExpiry(list) : '<p class="empty-hint">暂无保修临期设备</p>';
      return;
    }
    if (id === 'resale') {
      const top = sum.items.filter(function (i) { return isDigital(i) && Number(i.estimatedResalePrice) > 0; })
        .sort(function (a, b) { return b.estimatedResalePrice - a.estimatedResalePrice; }).slice(0, 6);
      body.innerHTML = top.length ? C.rankBars(top.map(function (i) {
        return { label: i.name, value: i.estimatedResalePrice, valueText: U.formatMoney(i.estimatedResalePrice) };
      })) : '<p class="empty-hint">填写预估二手价后显示</p>';
      return;
    }
    if (id === 'dIdle' || id === 'cIdle') {
      const kindFilter = id === 'dIdle' ? isDigital : function (i) { return i.kind === 'clothing'; };
      const warn = db.settings.idleWarnDays || 60;
      const idle = sum.idleList.filter(function (x) { return kindFilter(x.item) && x.idle >= warn; }).slice(0, 8);
      body.innerHTML = idle.length ? C.rankBars(idle.map(function (x) {
        return { label: x.item.name, value: x.idle, valueText: x.idle + ' 天' };
      })) : '<p class="empty-hint">没有吃灰物品，状态很好</p>';
      return;
    }
    if (id === 'cpw') {
      const good = sum.cpwList.filter(function (c) { return c.wear > 0 && c.cpw != null; }).slice(0, 8);
      body.innerHTML = good.length ? good.map(function (c) {
        return '<div class="mini-row"><span class="flex1">' + U.escapeHtml(c.item.name) + '</span>' +
          '<span class="muted">穿 ' + c.wear + ' 次</span><strong>' + U.formatCost(c.cpw) + '/次</strong></div>';
      }).join('') : '<p class="empty-hint">还没有穿着记录</p>';
      return;
    }
    if (id === 'outfitStats') {
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
      body.innerHTML = C.bar(trend) + '<h4 class="detail-sub">场合分布</h4>' +
        C.rankBars(Object.keys(occCount).map(function (o) {
          return { label: o, value: occCount[o], valueText: occCount[o] + ' 次' };
        }));
      return;
    }
    if (id === 'lCpw') {
      const lifes = sum.lifeUseList.filter(function (c) { return c.uses > 0 && c.cpw != null; }).slice(0, 8);
      body.innerHTML = lifes.length ? lifes.map(function (c) {
        return '<div class="mini-row"><span class="flex1">' + U.escapeHtml(c.item.name) + '</span>' +
          '<span class="muted">用 ' + c.uses + ' 次</span><strong>' + U.formatCost(c.cpw) + '/次</strong></div>';
      }).join('') : '<p class="empty-hint">还没有使用记录</p>';
      return;
    }
    if (id === 'lUseRank') {
      const ranked = sum.items.filter(function (i) { return i.kind === 'life'; })
        .filter(function (i) { return (i.useCount || 0) > 0; })
        .sort(function (a, b) { return (b.useCount || 0) - (a.useCount || 0); }).slice(0, 8);
      body.innerHTML = ranked.length ? C.rankBars(ranked.map(function (i) {
        return { label: i.name, value: i.useCount, valueText: i.useCount + ' 次' };
      })) : '<p class="empty-hint">暂无使用记录</p>';
      return;
    }
    if (id === 'lExpiry') {
      const list = sum.expiry.filter(function (x) { return x.kind === 'pao'; }).slice(0, 8);
      body.innerHTML = list.length ? miniExpiry(list) : '<p class="empty-hint">暂无 PAO 临期妆品</p>';
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

  function miniExpiry(list) {
    return '<div class="mini-table">' + list.map(function (x) {
      return '<div class="mini-row"><span class="flex1">' + U.escapeHtml(x.item.name) + '</span>' +
        '<span class="tag ' + (x.daysLeft < 0 ? 'tag-warn' : '') + '">' + x.label + '</span>' +
        '<span class="muted">' + (x.daysLeft < 0 ? '已超 ' + (-x.daysLeft) + ' 天' : '剩 ' + x.daysLeft + ' 天') + '</span></div>';
    }).join('') + '</div>';
  }

  function kpi(label, value, sub) {
    return '<div class="kpi"><div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-value">' + value + '</div><div class="kpi-sub">' + U.escapeHtml(sub) + '</div></div>';
  }

  return { render: render, BLOCKS: BLOCKS, SECTION_META: SECTION_META, normalizeSections: normalizeSections, blockState: blockState };
})();
