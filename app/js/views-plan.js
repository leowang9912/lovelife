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
    dPrice: { name: '数码价格排行', block: 'digital', size: 'm' },
    dUseRank: { name: '数码使用排行', block: 'digital', size: 'm' },
    dCostRank: { name: '单日使用成本排行', block: 'digital', size: 'm' },
    dHoldRank: { name: '已购买时长排行', block: 'digital', size: 'm' },
    dBuyTrend: { name: '购机月度曲线', block: 'digital', size: 'm' },
    dCatPie: { name: '数码分类构成', block: 'digital', size: 'm' },
    dWarranty: { name: '保修临期', block: 'digital', size: 'm' },
    resale: { name: '回血潜力', block: 'digital', size: 'm' },
    dIdle: { name: '数码吃灰排行', block: 'digital', size: 'm' },
    cPrice: { name: '衣物价格排行', block: 'clothing', size: 'm' },
    cWearRank: { name: '穿着次数排行', block: 'clothing', size: 'm' },
    cpw: { name: '单次穿着成本排行', block: 'clothing', size: 'm' },
    cOutfitRank: { name: '穿搭搭配次数排行', block: 'clothing', size: 'm' },
    cNoWear: { name: '未穿着清单', block: 'clothing', size: 'm' },
    cBuyTrend: { name: '购衣月度曲线', block: 'clothing', size: 'm' },
    cStreak: { name: '打卡连续与季节分布', block: 'clothing', size: 'm' },
    cCatPie: { name: '衣橱分类构成', block: 'clothing', size: 'm' },
    outfitStats: { name: '穿搭统计', block: 'clothing', size: 'l' },
    cIdle: { name: '衣物吃灰排行', block: 'clothing', size: 'm' },
    lPrice: { name: '美妆价格排行', block: 'life', size: 'm' },
    lCpw: { name: '单次使用成本排行', block: 'life', size: 'm' },
    lUseRank: { name: '使用次数排行', block: 'life', size: 'm' },
    lOutfitRank: { name: '妆品搭配次数排行', block: 'life', size: 'm' },
    lFresh: { name: '开封新鲜度排行', block: 'life', size: 'm' },
    lStock: { name: '未开封库存', block: 'life', size: 'm' },
    lCatPie: { name: '生活分类构成', block: 'life', size: 'm' },
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

  /* 新增栏目默认开启（老用户自动补到对应板块末尾） */
  const DEFAULT_ON = ['monthly', 'budget', 'cpw', 'game', 'foodStats',
    'dPrice', 'dCostRank', 'dHoldRank', 'dBuyTrend', 'dCatPie',
    'cPrice', 'cWearRank', 'cOutfitRank', 'cNoWear', 'cBuyTrend', 'cStreak', 'cCatPie',
    'lPrice', 'lCpw', 'lUseRank', 'lOutfitRank', 'lFresh', 'lStock', 'lCatPie'];

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
          enabled: SECTION_META[id].fixed || DEFAULT_ON.indexOf(id) >= 0,
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
      '<button class="btn btn-primary" data-act="add-life">＋ 记美妆</button>' +
      '<button class="btn btn-ghost" data-act="outfit">👗 穿搭打卡</button>' +
      '<button class="btn btn-ghost" data-act="food">🍱 饮食打卡</button></div></div>' +
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
            (meta.fixed ? '<span class="tag">固定</span>' : '') +
            '<div class="sec-size-btns">' +
            Object.keys(SIZE_LABELS).map(function (sz) {
              return '<button class="sec-size-btn' + ((sec.size || 'm') === sz ? ' on' : '') +
                '" data-size-btn="' + idx + '" data-size-val="' + sz + '">' + SIZE_LABELS[sz] + '</button>';
            }).join('') + '</div>' +
            (meta.fixed ? '' :
              '<button class="btn-icon" data-move="up" data-idx="' + idx + '">↑</button>' +
              '<button class="btn-icon" data-move="down" data-idx="' + idx + '">↓</button>' +
              '<button class="btn-icon" data-toggle="' + idx + '">' + (sec.enabled ? '👁' : '🚫') + '</button>') +
            '</div>' : '') +
          '</div><div class="panel-body" data-body="' + sec.id + '"></div>';
        grid.appendChild(el);
        try {
          renderSection(el.querySelector('[data-body]'), sec.id, db, sum);
        } catch (err) {
          el.querySelector('[data-body]').innerHTML = '<p class="empty-hint">该栏目渲染失败：' + U.escapeHtml(String(err && err.message || err)) + '</p>';
        }
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
        S.saveSettings().then(function () { UI.toast('顺序已保存', 'success'); render(root); }).catch(function () { UI.toast('保存失败，顺序未生效', 'error'); });
      });
    });
    root.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        const idx = Number(b.getAttribute('data-toggle'));
        db.settings.planSections[idx].enabled = !db.settings.planSections[idx].enabled;
        S.saveSettings().then(function () { render(root); }).catch(function () { UI.toast('保存失败', 'error'); });
      });
    });
    root.querySelectorAll('[data-size-btn]').forEach(function (b) {
      b.addEventListener('click', function () {
        const idx = Number(b.getAttribute('data-size-btn'));
        db.settings.planSections[idx].size = b.getAttribute('data-size-val');
        S.saveSettings().then(function () { render(root); }).catch(function () { UI.toast('保存失败', 'error'); });
      });
    });
    root.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const act = btn.getAttribute('data-act');
        if (act === 'add-device') window.Views.openItemEditor(null, 'digital');
        if (act === 'add-clothing') window.Views.openItemEditor(null, 'clothing');
        if (act === 'add-life') window.Views.openItemEditor(null, 'life');
        if (act === 'outfit') window.Views.openOutfitEditor(U.todayStr());
        if (act === 'food' && window.FoodView && window.FoodView.openFoodEditor) window.FoodView.openFoodEditor(U.todayStr(), null);
      });
    });
  }

  /* 拖动排序：Pointer Events（鼠标/触屏/手写笔通用），仅同一板块内 */
  function bindDrag(root, db) {
    let dragEl = null;
    let placeholder = null;
    function ph() {
      if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.className = 'drag-placeholder';
      }
      return placeholder;
    }
    function commit() {
      const p = placeholder;
      if (p && p.parentNode) {
        const parent = p.parentNode;
        const dragId = dragEl.getAttribute('data-id');
        // 块内 DOM 顺序 → 重排该块在数组里的相对顺序
        const domIds = Array.prototype.slice.call(parent.children)
          .filter(function (n) { return n.classList.contains('plan-sec') || n === p; })
          .map(function (n) { return n === p ? dragId : n.getAttribute('data-id'); });
        const arr = db.settings.planSections;
        const block = (SECTION_META[dragId] || {}).block;
        const blockIdxs = [];
        arr.forEach(function (s, i) { if ((SECTION_META[s.id] || {}).block === block) blockIdxs.push(i); });
        const byId = {};
        blockIdxs.forEach(function (i) { byId[arr[i].id] = arr[i]; });
        const reordered = [];
        domIds.forEach(function (id) {
          if (byId[id]) { reordered.push(byId[id]); delete byId[id]; }
        });
        Object.keys(byId).forEach(function (id) { reordered.push(byId[id]); });
        blockIdxs.forEach(function (arrI, k) { arr[arrI] = reordered[k]; });
        S.saveSettings().then(function () { UI.toast('顺序已保存', 'success'); render(root); }).catch(function () { UI.toast('保存失败，顺序未生效', 'error'); });
      }
      if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
      if (dragEl) dragEl.classList.remove('dragging');
      dragEl = null;
      placeholder = null;
    }
    root.querySelectorAll('.plan-sec[draggable]').forEach(function (el) {
      el.addEventListener('pointerdown', function (e) {
        if (e.button !== undefined && e.button !== 0) return;
        // 只允许从面板头起拖，避免误触面板内滚动/图表；按钮点击不触发拖动
        const head = e.target.closest ? e.target.closest('.panel-head') : null;
        if (!head) return;
        if (e.target.closest('button, input, select, a')) return;
        e.preventDefault();
        dragEl = el;
        el.classList.add('dragging');
        const p = ph();
        p.style.minHeight = Math.max(90, el.offsetHeight) + 'px';
        el.parentNode.insertBefore(p, el.nextSibling);
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      });
      el.addEventListener('pointermove', function (e) {
        if (!dragEl || dragEl !== el) return;
        const grid = el.parentNode;
        const over = document.elementFromPoint(e.clientX, e.clientY);
        const sec = over && over.closest ? over.closest('.plan-sec') : null;
        const p = ph();
        if (!sec || sec === el || sec.parentNode !== grid) return;
        const rect = sec.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        if (before) grid.insertBefore(p, sec);
        else grid.insertBefore(p, sec.nextSibling);
      });
      el.addEventListener('pointerup', function () { if (dragEl === el) commit(); });
      el.addEventListener('pointercancel', function () { if (dragEl === el) commit(); });
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
      /* KPI 资产驾驶舱（v1.0.7）：4 大卡 + 分域速览 + 本月 vs 上月 */
      const monthTotal = sum.monthSpend + (sum.food.monthSpend || 0);
      const curKey = U.monthKey(U.todayStr());
      const prevKey = U.monthKey(U.todayStr(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      let foodPrev = 0;
      (db.food || []).forEach(function (f) {
        if (U.monthKey(f.date || '') === prevKey) foodPrev += Number(f.price) || 0;
      });
      const prevTotal = (sum.monthlySpend[prevKey] || 0) + foodPrev;
      const delta = prevTotal ? Math.round((monthTotal - prevTotal) / prevTotal * 100) : null;
      const budgetTotal = Number(((db.settings || {}).budget || {}).monthlyTotal) || 0;
      const budgetLeft = budgetTotal - monthTotal;
      const active = sum.items.filter(function (i) { return i.status !== 'sold' && i.status !== 'gifted'; });
      const isD = function (i) { return i.kind === 'device' || i.kind === 'game'; };
      function domainInvest(fn) {
        return active.filter(fn).reduce(function (a, b) { return a + M.ownInvested(db, b); }, 0);
      }
      function monthBuy(fn) {
        return sum.items.filter(function (i) { return fn(i) && U.monthKey(i.purchaseDate || '') === curKey; })
          .reduce(function (a, b) { return a + (Number(b.purchasePrice) || 0); }, 0);
      }
      const dCnt = sum.counts.device + sum.counts.game;
      const cCnt = sum.counts.clothing;
      const lCnt = sum.counts.life;
      const worn = active.filter(function (i) { return i.kind === 'clothing' && (i.wearCount || 0) > 0; }).length;
      const wearRate = cCnt ? Math.round(worn / cCnt * 100) : 0;
      const lifeExpiring = sum.expiry.filter(function (x) { return x.kind === 'pao'; }).length;
      const outfitMonth = (db.outfits || []).filter(function (o) { return U.monthKey(o.date || '') === curKey; }).length;

      function hero(label, value, sub, cls) {
        return '<div class="kpi-hero"><div class="kpi-hero-label">' + label + '</div>' +
          '<div class="kpi-hero-value' + (cls ? ' ' + cls : '') + '">' + value + '</div>' +
          '<div class="kpi-hero-sub">' + sub + '</div></div>';
      }
      const deltaBadge = delta === null ? '<span class="muted">首月无对比</span>'
        : delta === 0 ? '<span class="muted">与上月持平</span>'
          : '<span class="kpi-delta ' + (delta > 0 ? 'bad' : 'good') + '">' +
            (delta > 0 ? '↑ +' : '↓ ') + delta + '%</span>';
      const budgetSub = budgetTotal > 0
        ? (budgetLeft >= 0 ? '预算余 ' + Math.round(budgetLeft / budgetTotal * 100) + '%' : '已超预算')
        : '未设置月预算';

      body.innerHTML =
        '<div class="kpi-hero-row">' +
        hero('总投入', U.formatMoney(sum.totalInvest), '全部历史购入') +
        hero('在手估值', U.formatMoney(sum.bookValue), '折旧现值 · 投入的 ' + (sum.totalInvest ? Math.round(sum.bookValue / sum.totalInvest * 100) : 0) + '%') +
        hero('本月花费', U.formatMoney(monthTotal), sum.monthNewCount + ' 件新物 ' + deltaBadge) +
        hero('预算剩余', budgetTotal > 0 ? U.formatMoney(budgetLeft) : '—', budgetSub, budgetLeft < 0 ? 'bad' : '') +
        '</div>' +
        '<div class="kpi-domain">' +
        '<div class="kpi-domain-title">分域速览</div>' +
        '<div class="kpi-domain-row"><span class="kpi-domain-icon">🎮</span><span class="kpi-domain-name">数码</span>' +
        '<span class="kpi-domain-parts"><span>投入 ' + U.formatMoney(domainInvest(isD)) + '</span><i>·</i><span>' + dCnt + ' 件</span><i>·</i><span>本月 ' + U.formatMoney(monthBuy(isD)) + '</span></span></div>' +
        '<div class="kpi-domain-row"><span class="kpi-domain-icon">👕</span><span class="kpi-domain-name">衣橱</span>' +
        '<span class="kpi-domain-parts"><span>投入 ' + U.formatMoney(domainInvest(function (i) { return i.kind === 'clothing'; })) + '</span><i>·</i><span>' + cCnt + ' 件</span><i>·</i><span>使用率 ' + wearRate + '%</span></span></div>' +
        '<div class="kpi-domain-row"><span class="kpi-domain-icon">💄</span><span class="kpi-domain-name">生活</span>' +
        '<span class="kpi-domain-parts"><span>投入 ' + U.formatMoney(domainInvest(function (i) { return i.kind === 'life'; })) + '</span><i>·</i><span>' + lCnt + ' 件</span><i>·</i><span>临期 ' + lifeExpiring + '</span></span></div>' +
        '<div class="kpi-domain-row"><span class="kpi-domain-icon">🍽</span><span class="kpi-domain-name">美食</span>' +
        '<span class="kpi-domain-parts"><span>本月 ' + (sum.food.monthCount || 0) + ' 顿</span><i>·</i><span>' + U.formatMoney(sum.food.monthSpend || 0) + '</span><i>·</i><span>累计 ' + U.formatMoney(sum.food.totalSpend || 0) + '</span></span></div>' +
        '</div>' +
        '<div class="kpi-month">' +
        '<div class="kpi-month-title">本月 vs 上月</div>' +
        '<div class="kpi-month-line">' +
        '<div class="rank-bar-track"><div class="rank-bar-fill" style="width:' +
        (prevTotal ? Math.min(100, Math.round(monthTotal / prevTotal * 50)) : 50) + '%;background:#0071e3"></div></div>' +
        '<span class="kpi-month-val">本月 ' + U.formatMoney(monthTotal) + ' · 上月 ' + U.formatMoney(prevTotal) + ' ' + deltaBadge + '</span>' +
        '</div>' +
        '<div class="kpi-month-mini">' +
        '<div class="kpi-mini">新物<strong>' + sum.monthNewCount + ' 件</strong></div>' +
        '<div class="kpi-mini">日均持有成本<strong>' + U.formatCost(sum.dailyCostTotal) + '</strong></div>' +
        '<div class="kpi-mini">穿搭打卡<strong>' + outfitMonth + ' 次</strong></div>' +
        '<div class="kpi-mini">回血潜力<strong>' + U.formatMoney(sum.resalePotential) + '</strong></div>' +
        '</div></div>';
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
      kindData.forEach(function (d) { d.valueText = U.formatMoney(Math.round(d.value)); });
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
    if (id === 'dPrice') {
      const top = sum.items.filter(function (i) { return isDigital(i) && i.status !== 'sold' && i.status !== 'gifted'; })
        .sort(function (a, b) { return (Number(b.purchasePrice) || 0) - (Number(a.purchasePrice) || 0); }).slice(0, 8);
      body.innerHTML = top.length ? C.rankBars(top.map(function (i) {
        return { label: i.name, value: Number(i.purchasePrice) || 0, valueText: U.formatMoney(i.purchasePrice) };
      })) : '<p class="empty-hint">暂无数码设备</p>';
      return;
    }
    if (id === 'dCostRank') {
      // 单日使用成本：总投入 / 持有天数（不依赖使用次数，所有在手设备可比）
      const ranked = sum.items.filter(function (i) { return isDigital(i) && i.status !== 'sold' && i.status !== 'gifted'; })
        .filter(function (i) { return i.cost && i.cost.dailyCost > 0; })
        .sort(function (a, b) { return b.cost.dailyCost - a.cost.dailyCost; }).slice(0, 8);
      body.innerHTML = ranked.length ? C.rankBars(ranked.map(function (i) {
        return { label: i.name, value: i.cost.dailyCost, valueText: U.formatCost(i.cost.dailyCost) + '/天' };
      })) : '<p class="empty-hint">暂无在手设备</p>';
      return;
    }
    if (id === 'dHoldRank') {
      const ranked = sum.items.filter(function (i) { return isDigital(i) && i.status !== 'sold' && i.status !== 'gifted'; })
        .filter(function (i) { return i.cost && i.cost.heldDays > 0; })
        .sort(function (a, b) { return b.cost.heldDays - a.cost.heldDays; }).slice(0, 8);
      body.innerHTML = ranked.length ? C.rankBars(ranked.map(function (i) {
        return { label: i.name, value: i.cost.heldDays, valueText: '已购 ' + i.cost.heldDays + ' 天' };
      })) : '<p class="empty-hint">暂无在手设备</p>';
      return;
    }
    if (id === 'dBuyTrend') {
      const byMonth = {};
      sum.items.forEach(function (i) {
        if (!isDigital(i) || !i.purchaseDate) return;
        const k = U.monthKey(i.purchaseDate);
        byMonth[k] = (byMonth[k] || 0) + (Number(i.purchasePrice) || 0);
      });
      const trend = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = U.monthKey(U.todayStr(d));
        trend.push({ label: key.slice(5) + '月', value: Math.round(byMonth[key] || 0) });
      }
      body.innerHTML = C.bar(trend);
      return;
    }
    if (id === 'dCatPie') {
      const byCat = {};
      sum.items.forEach(function (i) {
        if (!isDigital(i) || i.status === 'sold' || i.status === 'gifted') return;
        const c = (db.categories.digital || []).find(function (x) { return x.id === i.categoryId; });
        const name = c ? c.name : '其他';
        byCat[name] = (byCat[name] || 0) + M.ownInvested(db, i);
      });
      const keys = Object.keys(byCat);
      body.className = 'panel-body center';
      body.innerHTML = keys.length ? C.donut(keys.map(function (k, n) {
        return { label: k, value: Math.round(byCat[k]), valueText: U.formatMoney(Math.round(byCat[k])), color: ['#0071e3', '#5ac8fa', '#34c759', '#ff9500', '#ff2d55', '#af52de', '#ffcc00', '#aeaeb2'][n % 8] };
      }), { centerText: U.formatMoney(keys.reduce(function (a, k) { return a + byCat[k]; }, 0)), centerSub: '数码总投入' })
        : '<p class="empty-hint">暂无数码设备</p>';
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
    if (id === 'cPrice') {
      const top = sum.items.filter(function (i) { return i.kind === 'clothing' && i.status !== 'sold' && i.status !== 'gifted'; })
        .sort(function (a, b) { return (Number(b.purchasePrice) || 0) - (Number(a.purchasePrice) || 0); }).slice(0, 8);
      body.innerHTML = top.length ? C.rankBars(top.map(function (i) {
        return { label: i.name, value: Number(i.purchasePrice) || 0, valueText: U.formatMoney(i.purchasePrice) };
      })) : '<p class="empty-hint">暂无衣物</p>';
      return;
    }
    if (id === 'cWearRank') {
      const ranked = sum.items.filter(function (i) { return i.kind === 'clothing'; })
        .filter(function (i) { return (i.wearCount || 0) > 0; })
        .sort(function (a, b) { return (b.wearCount || 0) - (a.wearCount || 0); }).slice(0, 8);
      body.innerHTML = ranked.length ? C.rankBars(ranked.map(function (i) {
        return { label: i.name, value: i.wearCount, valueText: i.wearCount + ' 次' };
      })) : '<p class="empty-hint">还没有穿着记录</p>';
      return;
    }
    if (id === 'cpw') {
      const good = sum.cpwList.filter(function (c) { return c.wear > 0 && c.cpw != null; }).slice(0, 8);
      body.innerHTML = good.length ? C.rankBars(good.map(function (c) {
        return { label: c.item.name, value: c.cpw, valueText: U.formatCost(c.cpw) + '/次（穿 ' + c.wear + ' 次）' };
      })) : '<p class="empty-hint">还没有穿着记录</p>';
      return;
    }
    if (id === 'cOutfitRank') {
      const ranked = sum.items.filter(function (i) { return i.kind === 'clothing' && (i.autoWear || 0) > 0; })
        .sort(function (a, b) { return (b.autoWear || 0) - (a.autoWear || 0); }).slice(0, 8);
      body.innerHTML = ranked.length ? C.rankBars(ranked.map(function (i) {
        return { label: i.name, value: i.autoWear, valueText: i.autoWear + ' 次搭配' };
      })) : '<p class="empty-hint">穿搭打卡勾选衣物后自动统计</p>';
      return;
    }
    if (id === 'cNoWear') {
      const list = sum.items.filter(function (i) {
        return i.kind === 'clothing' && ['in_use', 'idle', 'to_sell'].indexOf(i.status) >= 0 && (i.wearCount || 0) === 0;
      }).slice(0, 8);
      body.innerHTML = list.length ? '<div class="mini-table">' + list.map(function (i) {
        return '<div class="mini-row"><span class="flex1">' + U.escapeHtml(i.name) + '</span>' +
          (i.keepTag ? '<span class="tag">吊牌在</span>' : '') +
          '<span class="muted">' + U.formatMoney(i.purchasePrice) + '</span></div>';
      }).join('') + '</div>' : '<p class="empty-hint">每件都穿过，没有闲置新衣</p>';
      return;
    }
    if (id === 'cBuyTrend') {
      const byMonth = {};
      sum.items.forEach(function (i) {
        if (i.kind !== 'clothing' || !i.purchaseDate) return;
        const k = U.monthKey(i.purchaseDate);
        byMonth[k] = (byMonth[k] || 0) + (Number(i.purchasePrice) || 0);
      });
      const trend = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = U.monthKey(U.todayStr(d));
        trend.push({ label: key.slice(5) + '月', value: Math.round(byMonth[key] || 0) });
      }
      body.innerHTML = C.bar(trend);
      return;
    }
    if (id === 'cStreak') {
      // 连续打卡天数（以最近一次打卡为终点往回数）
      const days = {};
      db.outfits.forEach(function (o) { if (o.date) days[o.date] = true; });
      let streak = 0;
      const cur = new Date();
      if (!days[U.todayStr(cur)]) cur.setDate(cur.getDate() - 1); // 今天还没打卡则从昨天起算
      while (days[U.todayStr(cur)]) { streak++; cur.setDate(cur.getDate() - 1); }
      const seasonOf = function (m) { return m === 12 || m <= 2 ? '冬' : m <= 5 ? '春' : m <= 8 ? '夏' : '秋'; };
      const seasonCount = { '春': 0, '夏': 0, '秋': 0, '冬': 0 };
      db.outfits.forEach(function (o) {
        const d = U.parseDate(o.date);
        if (d) seasonCount[seasonOf(d.getMonth() + 1)]++;
      });
      body.innerHTML = '<div class="kpi-mini-row" style="margin:0 0 8px">' +
        '<div class="kpi-mini">连续打卡<strong>' + streak + ' 天</strong></div>' +
        '<div class="kpi-mini">累计打卡<strong>' + Object.keys(days).length + ' 天</strong></div></div>' +
        C.rankBars(Object.keys(seasonCount).map(function (s) {
          return { label: s + '季', value: seasonCount[s], valueText: seasonCount[s] + ' 次' };
        }));
      return;
    }
    if (id === 'cCatPie') {
      const byCat = {};
      sum.items.forEach(function (i) {
        if (i.kind !== 'clothing' || i.status === 'sold' || i.status === 'gifted') return;
        const c = (db.categories.clothing || []).find(function (x) { return x.id === i.categoryId; });
        const name = c ? c.name : '其他';
        byCat[name] = (byCat[name] || 0) + M.ownInvested(db, i);
      });
      const keys = Object.keys(byCat);
      body.className = 'panel-body center';
      body.innerHTML = keys.length ? C.donut(keys.map(function (k, n) {
        return { label: k, value: Math.round(byCat[k]), valueText: U.formatMoney(Math.round(byCat[k])), color: ['#ff2d55', '#0071e3', '#af52de', '#ff9500', '#34c759', '#5ac8fa', '#ffcc00', '#aeaeb2'][n % 8] };
      }), { centerText: U.formatMoney(keys.reduce(function (a, k) { return a + byCat[k]; }, 0)), centerSub: '衣橱总投入' })
        : '<p class="empty-hint">暂无衣物</p>';
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
    if (id === 'lPrice') {
      const top = sum.items.filter(function (i) { return i.kind === 'life' && i.status !== 'sold' && i.status !== 'gifted'; })
        .sort(function (a, b) { return (Number(b.purchasePrice) || 0) - (Number(a.purchasePrice) || 0); }).slice(0, 8);
      body.innerHTML = top.length ? C.rankBars(top.map(function (i) {
        return { label: i.name, value: Number(i.purchasePrice) || 0, valueText: U.formatMoney(i.purchasePrice) };
      })) : '<p class="empty-hint">暂无妆品</p>';
      return;
    }
    if (id === 'lCpw') {
      const lifes = sum.lifeUseList.filter(function (c) { return c.uses > 0 && c.cpw != null; }).slice(0, 8);
      body.innerHTML = lifes.length ? C.rankBars(lifes.map(function (c) {
        return { label: c.item.name, value: c.cpw, valueText: U.formatCost(c.cpw) + '/次（用 ' + c.uses + ' 次）' };
      })) : '<p class="empty-hint">还没有使用记录</p>';
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
    if (id === 'lOutfitRank') {
      const ranked = sum.items.filter(function (i) { return i.kind === 'life' && (i.autoWear || 0) > 0; })
        .sort(function (a, b) { return (b.autoWear || 0) - (a.autoWear || 0); }).slice(0, 8);
      body.innerHTML = ranked.length ? C.rankBars(ranked.map(function (i) {
        return { label: i.name, value: i.autoWear, valueText: i.autoWear + ' 次搭配' };
      })) : '<p class="empty-hint">穿搭打卡勾选妆品后自动统计</p>';
      return;
    }
    if (id === 'lFresh') {
      // 开封新鲜度：开封最久的排前面（提醒尽快用完）
      const opened = sum.items.filter(function (i) { return i.kind === 'life' && U.parseDate(i.openedDate); })
        .map(function (i) { return { item: i, days: U.daysBetween(U.parseDate(i.openedDate), now) }; })
        .sort(function (a, b) { return b.days - a.days; }).slice(0, 8);
      body.innerHTML = opened.length ? C.rankBars(opened.map(function (x) {
        return { label: x.item.name, value: x.days, valueText: '已开封 ' + x.days + ' 天' };
      })) : '<p class="empty-hint">还没有填写开封日期</p>';
      return;
    }
    if (id === 'lStock') {
      const unopened = sum.items.filter(function (i) {
        return i.kind === 'life' && !i.openedDate && ['sold', 'gifted'].indexOf(i.status) < 0;
      });
      const near = unopened.filter(function (i) {
        const dd = U.parseDate(i.expiryDate);
        return !!dd && U.daysBetween(now, dd) <= 90;
      }).slice(0, 6);
      body.innerHTML = '<div class="mini-table">' +
        '<div class="mini-row"><span class="flex1">未开封库存</span><strong>' + unopened.length + ' 件</strong></div>' +
        '<div class="mini-row"><span class="flex1">其中 90 天内限用</span><strong>' + near.length + ' 件</strong></div></div>' +
        (near.length ? '<h4 class="detail-sub">限用预警</h4>' + '<div class="mini-table">' + near.map(function (i) {
          return '<div class="mini-row"><span class="flex1">' + U.escapeHtml(i.name) + '</span>' +
            '<span class="muted">' + U.escapeHtml(i.expiryDate || '') + '</span></div>';
        }).join('') + '</div>' : '');
      return;
    }
    if (id === 'lCatPie') {
      const byCat = {};
      sum.items.forEach(function (i) {
        if (i.kind !== 'life' || i.status === 'sold' || i.status === 'gifted') return;
        const c = (db.categories.life || []).find(function (x) { return x.id === i.categoryId; });
        const name = c ? c.name : '其他';
        byCat[name] = (byCat[name] || 0) + M.ownInvested(db, i);
      });
      const keys = Object.keys(byCat);
      body.className = 'panel-body center';
      body.innerHTML = keys.length ? C.donut(keys.map(function (k, n) {
        return { label: k, value: Math.round(byCat[k]), valueText: U.formatMoney(Math.round(byCat[k])), color: ['#af52de', '#ff2d55', '#0071e3', '#ff9500', '#34c759', '#5ac8fa', '#ffcc00', '#aeaeb2'][n % 8] };
      }), { centerText: U.formatMoney(keys.reduce(function (a, k) { return a + byCat[k]; }, 0)), centerSub: '生活总投入' })
        : '<p class="empty-hint">暂无妆品</p>';
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
