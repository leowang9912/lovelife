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
    wBalance: { name: '收支统计', block: 'overall', size: 'l' },
    wTrend: { name: '收支走势', block: 'overall', size: 'l' },
    wCatPie: { name: '分类统计', block: 'overall', size: 'm' },
    wDaily: { name: '日均', block: 'overall', size: 'm' },
    wHeat: { name: '收支热力', block: 'overall', size: 'm' },
    habitHeat: { name: '热力打卡', block: 'overall', size: 'l' },
    wAssets: { name: '资产走势', block: 'overall', size: 'l' },
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

  // 钱袋分类 id → 显示名（子类带父名，如「购物消费·手机数码」）
  function findWalletCat(db, id) {
    const cats = ((db.wallet || {}).cats) || {};
    const kinds = ['expense', 'income'];
    for (let ki = 0; ki < kinds.length; ki++) {
      const list = cats[kinds[ki]] || [];
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.id === id) return c.name;
        const ch = c.children || [];
        for (let j = 0; j < ch.length; j++) {
          if (ch[j].id === id) return c.name + '·' + ch[j].name;
        }
      }
    }
    return '';
  }

  /* ===== 统一风格的收支统计（周期切换 周/月/年，全栏目共享） ===== */
  /* v1.1.5：周期每模块独立控制——statRanges 记录各栏目的周期，渲染上下文 _curSec 定位当前栏目 */
  let statRanges = {};
  let _curSec = '';
  function curRange() { return statRanges[_curSec] || 'month'; }
  const SR_ALL = ['week', 'month', 'year'];

  /* 账号切换重置（A3）：各模块周期会话态回默认「月」；持久偏好存 db.settings.statRanges（随账号） */
  function resetState() {
    statRanges = {};
    habitYear = 0; // 热力打卡年份切换回默认今年
    habitMonth = 0; // 热力打卡月视图锚月回默认当月
    hhView = 'year'; // 热力栏目视图回默认「年」
    hhYearMode = 'blocks'; // 年视图形态回默认「月块」
    editMode = false; // 甲19③：账号切换也退出栏目编辑态
  }

  /* 甲19②：统计周期记忆进 db.settings.statRange（随账号），渲染时恢复 */
  function loadStatRange(db) {
    // 兼容旧单值 statRange（v1.1.4 前）：读到字符串则作为所有栏目的初值
    const s = db && db.settings || {};
    statRanges = {};
    if (s.statRanges && typeof s.statRanges === 'object') {
      Object.keys(s.statRanges).forEach(function (k) {
        if (SR_ALL.indexOf(s.statRanges[k]) >= 0) statRanges[k] = s.statRanges[k];
      });
    } else if (SR_ALL.indexOf(s.statRange) >= 0) {
      ['wBalance', 'wTrend', 'wCatPie', 'wDaily', 'wHeat'].forEach(function (id) { statRanges[id] = s.statRange; });
    }
  }

  function statRangeTag(id) {
    // v1.1.5：紧凑切换器，panel-head 右上角；每模块独立周期（data-sr-id 区分）
    const cur = statRanges[id] || 'month';
    return '<div class="seg-toggle seg-toggle-head">' +
      [['week', '周'], ['month', '月'], ['year', '年']].map(function (r) {
        return '<button type="button" class="seg-btn' + (cur === r[0] ? ' on' : '') +
          '" data-sr="' + r[0] + '" data-sr-id="' + id + '">' + r[1] + '</button>';
      }).join('') + '</div>';
  }

  function bindStatRange(body) {
    // 切换器在 panel-head（v1.1.5 右上角）：搜索根扩到整个栏目容器（head+body）
    const root = (body.closest && body.closest('.panel')) || body;
    root.querySelectorAll('[data-sr]').forEach(function (el) {
      if (el.__srBound) return; // head 按钮不随 body 重绘：重复绑定会让连点时重渲染次数翻倍堆积
      el.__srBound = true;
      el.addEventListener('click', function () {
        const secId = el.getAttribute('data-sr-id') || '';
        const val = el.getAttribute('data-sr');
        // 周期切换 no-op（v1.1.9）：点当前已选中的档位（值未变）不重绘不落库，直接返回——
        // 连点同档不再反复重渲染/写盘
        if ((statRanges[secId] || 'month') === val) return;
        statRanges[secId] = val;
        // 周期偏好随账号持久化（每模块独立记忆）
        const db = S.getDB();
        if (db && db.settings) {
          db.settings.statRanges = statRanges;
          delete db.settings.statRange; // 清旧单值字段
          S.saveSettings();
        }
        // 只重渲染本模块（其余模块不动），滚动位置天然保持
        try {
          const sum2 = M.summary(db); // 与整页渲染同源（walletStats 缺 .wallet 嵌套会抛）
          renderSection(body, secId, db, sum2);
        } catch (e) { console.error('周期切换重渲染失败:', e); }
        // head 里的切换器不随 body 重绘：手动同步本模块按钮组的选中态
        root.querySelectorAll('.seg-toggle-head [data-sr]').forEach(function (b2) {
          b2.classList.toggle('on', b2 === el);
        });
      });
    });
  }

  function statPeriod() {
    const now = new Date();
    let start, end;
    if (curRange() === 'week') {
      const dow = (now.getDay() + 6) % 7; // 周一为一周开始
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    } else if (curRange() === 'year') {
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear() + 1, 0, 1);
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }
    return { start: start, end: end };
  }

  /* 已过天数（含今天）：周=周一起、月=1 号起、年=1 月 1 日起 → 今天。
     用于日均分母与走势取段：未来日还没发生，算进分母会把日均稀释、画成 0 柱 */
  function elapsedDays() {
    const p = statPeriod();
    return Math.max(1, U.daysBetween(p.start, new Date()) + 1);
  }

  /* ===== 统计下钻：点图跳钱袋流水（jumpTo 由钱袋视图提供，未就绪时静默忽略） ===== */
  function jumpToWallet(filter) {
    if (window.WalletView && typeof window.WalletView.jumpTo === 'function') window.WalletView.jumpTo(filter);
  }

  /* ===== 丙3 空态卡：统一结构（.empty-state.empty-card：图标 48 + 文案 + 引导按钮） ===== */
  function emptyCard(iconName, text, btnLabel, btnAttrs) {
    return '<div class="empty-state empty-card"><div class="empty-icon">' + UI.icon(iconName, 48) + '</div>' +
      '<p>' + text + '</p>' +
      (btnLabel ? '<button type="button" class="btn btn-ghost"' + (btnAttrs ? ' ' + btnAttrs : '') + '>' + btnLabel + '</button>' : '') +
      '</div>';
  }
  const EMPTY_GO = {
    digital: { icon: 'gamepad-2', label: '去添加数码' },
    clothing: { icon: 'shirt', label: '去添加衣物' },
    life: { icon: 'heart', label: '去添加美妆' },
    food: { icon: 'utensils', label: '去记美食' },
    wallet: { icon: 'wallet', label: '去记一笔' }
  };
  function emptyHint(text, goKey, btnLabel) {
    const g = EMPTY_GO[goKey] || EMPTY_GO.wallet;
    return emptyCard(g.icon, text, btnLabel || g.label, 'data-eg-go="' + goKey + '"');
  }

  /* ===== v1.2.0 戊：统计 KPI 数字卡统一结构（灰底白块层次法：灰卡 + 白色数值块 + 1px 接触影） =====
     标签（--f-cap / --text-2）→ 白色数值块（值 + 可选环比小箭头）→ 副信息（--f-cap-2 / --text-3）。
     kpi-hero / yw-bal-cell / yw-daily-cell / kpi-mini 共用一套 chrome（同圆角 --r-xl、同内距、
     数值同字阶 --f-num-l、tabular-nums），仅 cardCls 不同；字阶走 CSS 变量、font 简写带 var(--font)。 */
  function statTile(o) {
    return '<div class="stat-kpi' + (o.cardCls ? ' ' + o.cardCls : '') + '">' +
      '<div class="stat-kpi-label' + (o.labelCls ? ' ' + o.labelCls : '') + '">' + o.label + '</div>' +
      '<div class="stat-kpi-num">' +
      '<div class="stat-kpi-val' + (o.valCls ? ' ' + o.valCls : '') + '">' + o.value + '</div>' +
      (o.delta ? '<div class="stat-kpi-delta">' + o.delta + '</div>' : '') +
      '</div>' +
      (o.sub != null && o.sub !== '' ? '<div class="stat-kpi-sub' + (o.subCls ? ' ' + o.subCls : '') + '">' + o.sub + '</div>' : '') +
      '</div>';
  }

  /* 甲：环比小箭头 —— ↑ 绿 / ↓ 红 / 持平 →0%（方案字面色向：涨=绿、跌=红，全卡统一）。
     prev 为 null（无对比）或 prev=0 且 cur≠0（无基数）→ 显示「—」 */
  function pctDelta(cur, prev) {
    if (prev == null) return null;
    if (!prev) return cur ? null : 0;
    return Math.round((cur - prev) / Math.abs(prev) * 100);
  }
  function deltaHTML(cur, prev, prefix, invert) {
    const pct = pctDelta(cur, prev);
    if (pct === null) return '<span class="stat-delta none">' + prefix + ' —</span>';
    if (pct === 0) return '<span class="stat-delta flat">' + prefix + ' →0%</span>';
    // 语义色向（v1.1.6）：invert=true 用于支出类——支出上涨=红（bad）、下降=绿（good）
    const good = invert ? pct < 0 : pct > 0;
    return '<span class="stat-delta ' + (good ? 'up' : 'down') + '">' + prefix + ' ' +
      (pct > 0 ? '↑' : '↓') + Math.abs(pct) + '%</span>';
  }
  /* 甲：金额环比（资产卡「较月初 ↑¥X」形态，持平显 →¥0） */
  function deltaAmtHTML(cur, prev, prefix) {
    const diff = Math.round(((cur || 0) - (prev || 0)) * 100) / 100;
    if (!diff) return '<span class="stat-delta flat">' + prefix + ' →' + U.formatMoney(0) + '</span>';
    return '<span class="stat-delta ' + (diff > 0 ? 'up' : 'down') + '">' + prefix + ' ' +
      (diff > 0 ? '↑' : '↓') + U.formatMoney(Math.abs(diff)) + '</span>';
  }

  /* 甲：环比对比窗（同天数口径）——月=上月 1~N 日（与月度小结同源同口径，2 月不足按月末封顶）、
     周=上周同星期窗、年=去年同期窗；label/ptevWord 随周期出「较上月/较上周/较去年」 */
  function prevWindow() {
    const now = new Date();
    const r = curRange();
    if (r === 'week') {
      const dow = (now.getDay() + 6) % 7; // 周一为一周开始，与 statPeriod 一致
      return {
        start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow - 7),
        days: dow + 1, label: '较上周', prevWord: '上周'
      };
    }
    if (r === 'year') {
      const start = new Date(now.getFullYear() - 1, 0, 1);
      return {
        start: start,
        days: U.daysBetween(start, new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())) + 1,
        label: '较去年', prevWord: '去年'
      };
    }
    const prevFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevDays = new Date(prevFirst.getFullYear(), prevFirst.getMonth() + 1, 0).getDate();
    return {
      start: prevFirst,
      days: Math.min(now.getDate(), prevDays),
      label: '较上月', prevWord: '上月'
    };
  }
  /* 甲：对比窗内收支合计（与月度小结环比同源——同一批账单、同一窗口，仅一处计算） */
  function prevSums(bills, pw) {
    const end = new Date(pw.start.getFullYear(), pw.start.getMonth(), pw.start.getDate() + pw.days);
    let inc = 0, exp = 0;
    bills.forEach(function (b) {
      if (!b.date || b.type === 'transfer') return;
      const t = U.parseDate(b.date);
      if (!t || t < pw.start || t >= end) return;
      const a = Math.abs(Number(b.amount) || 0);
      if (b.type === 'income') inc += a; else exp += a;
    });
    return { inc: inc, exp: exp };
  }

  /* ===== 甲19③：离开统计页即退出 editMode =====
     外壳每次 App.render 整页重建、无法在 render 里判断上一页；用 MutationObserver 盯 #app：
     一旦 #plan-wrap 不在 DOM（切页/回启动页）即退出编辑态。
     本页自身重渲染是同步重建 plan-wrap，观察器回调（微任务）看到终态，不会误退。 */
  let leaveWatch = null;
  function watchLeave() {
    if (leaveWatch || typeof MutationObserver === 'undefined') return;
    const host = document.getElementById('app') || document.body;
    leaveWatch = new MutationObserver(function () {
      if (editMode && !document.getElementById('plan-wrap')) editMode = false;
    });
    leaveWatch.observe(host, { childList: true, subtree: true });
  }

  /* 绑定图表下钻点击（body 每次渲染都会重建，故每轮重绑）：
     data-drill-* 属性由图表内建（charts.js bar/donut 按 data item 的 drill/catId 直接落到形状与
     图例行；热力格 HTML 本文件自带），这里只统一绑点击 + 手型。
     （v1.2.0 丙：双色分组柱一根柱一形状、序号猜配对会串天，改为属性驱动） */
  function bindWalletDrill(body) {
    // 下钻周期在绑定当下定格（v1.1.5 修正）：点图时 _curSec 已被后续渲染的栏目覆盖，
    // 到点击时才取 curRange() 会带成别的模块/默认「月」的周期
    const rangeAtBind = curRange();
    body.querySelectorAll('[data-drill-cat]').forEach(function (el) {
      el.style.cursor = 'pointer';
      // 下钻带上本栏目统计周期（A13）：周/月/年不丢周期（绑定时定格，见上）
      el.addEventListener('click', function () { jumpToWallet({ catId: el.getAttribute('data-drill-cat'), range: rangeAtBind }); });
    });
    body.querySelectorAll('[data-drill-date]').forEach(function (el) {
      el.addEventListener('click', function () { jumpToWallet({ date: el.getAttribute('data-drill-date'), range: rangeAtBind }); });
    });
    body.querySelectorAll('[data-drill-month]').forEach(function (el) {
      el.addEventListener('click', function () { jumpToWallet({ month: el.getAttribute('data-drill-month'), range: rangeAtBind }); });
    });
  }

  function walletStatSection(id, db, tagHTML, sum) {
    const bills = ((db.wallet || {}).bills) || [];
    const p = statPeriod();
    const rs = bills.filter(function (b) {
      if (!b.date || b.type === 'transfer') return false;
      // 日期统一 U.parseDate 本地零点解析：new Date('YYYY-MM-DD') 按 UTC 解析，跨时区会错天/错月
      const t = U.parseDate(b.date);
      return !!t && t >= p.start && t < p.end;
    });
    let exp = 0, inc = 0;
    rs.forEach(function (b) {
      const a = Math.abs(Number(b.amount) || 0);
      if (b.type === 'income') inc += a; else exp += a;
    });

    if (id === 'wBalance') {
      /* 主流记账「收支统计」（甲）：收入 / 支出 / 结余 三大数字卡 + 环比小箭头 + 副信息语境；
         （乙）月度小结卡片化：数字块 + 支出 Top3 渐变条 + 预算达成小环（月周期才出，口径勿动） */
      const pw = prevWindow();
      const ps = prevSums(bills, pw); // 与月度小结环比同源同口径（同天数窗，一处计算）
      const budgetTotal = Number(((db.settings || {}).budget || {}).monthlyTotal) || 0;
      // 甲15 预算达成统一合并口径（与 KPI「本月花费」同源）：
      // 账单支出 + 物品购入 + 美食 − 已关联物品/美食的账单（bill.itemId||foodId 扣重），不再纯账单口径
      const combined = (sum && sum.combinedMonthSpend != null) ? sum.combinedMonthSpend : exp;
      const budgetPct = budgetTotal > 0 ? Math.min(999, Math.round(combined / budgetTotal * 100)) : null;
      let nInc = 0, nExp = 0;
      rs.forEach(function (b) { if (b.type === 'income') nInc++; else nExp++; });

      let summaryHTML = '';
      if (curRange() === 'month') {
        /* ===== 乙：月度小结卡片化 =====
           三口径勿动：「月初至今」（本期数=本月账单）/「同天数环比」（上月 1~N 日）/「合并口径」（预算达成） */
        const mk3 = U.monthKey(U.todayStr());
        const prevN = pw.days; // 上月不足 N 天（如 2 月）按其月末封顶（prevWindow 同源）
        // 支出块环比：可比时「环比 ↑X%，与上月同期 1~N 日比」；上月同期无支出→不可比（旧口径文案保留）
        const expDelta = ps.exp > 0
          ? deltaHTML(exp, ps.exp, '环比', true) + '<span class="stat-delta-note">，与上月同期 1~' + prevN + ' 日比</span>'
          : '<span class="stat-delta none">环比 —</span><span class="stat-delta-note">（上月同期无支出，环比不可比）</span>';
        // 支出 Top3（横向条：分类名 + 渐变条 + 金额，最多 3 行）
        const byTop = {};
        rs.forEach(function (b) {
          if (b.type !== 'expense') return;
          let top = b.catId || '其他';
          const cats = ((db.wallet || {}).cats || {}).expense || [];
          cats.forEach(function (c) {
            (c.children || []).forEach(function (ch) {
              if (ch.id === b.subCatId) top = c.name;
            });
            if (c.id === b.catId) top = c.name;
          });
          byTop[top] = (byTop[top] || 0) + Math.abs(Number(b.amount) || 0);
        });
        const top3 = Object.keys(byTop).sort(function (a, b) { return byTop[b] - byTop[a]; }).slice(0, 3);
        const top3Max = top3.length ? byTop[top3[0]] : 0;
        const top3Rows = top3.map(function (k) {
          return '<div class="yw-sum-top-row">' +
            '<span class="yw-sum-top-name">' + U.escapeHtml(k) + '</span>' +
            '<div class="yw-sum-top-track"><div class="yw-sum-top-fill" style="width:' +
            (top3Max ? Math.round(byTop[k] / top3Max * 100) : 0) + '%"></div></div>' +
            '<span class="yw-sum-top-amt">' + U.formatMoney(byTop[k]) + '</span></div>';
        }).join('');
        // 预算达成小环（百分比环 + 文字）：合并口径百分比与旧小结同一公式
        const ringPct = budgetPct;
        const ring = ringPct == null ? '' : (function () {
          const R = 24, CIRC = 2 * Math.PI * R;
          const shown = Math.min(100, ringPct) / 100;
          return '<div class="stat-kpi yw-sum-ring-card">' +
            '<div class="yw-sum-ring-row">' +
            '<svg viewBox="0 0 64 64" width="56" height="56" xmlns="http://www.w3.org/2000/svg">' +
            '<circle cx="32" cy="32" r="' + R + '" fill="none" stroke="#e9e9ee" stroke-width="7"/>' +
            '<circle cx="32" cy="32" r="' + R + '" fill="none" stroke="' + (ringPct > 100 ? '#ff3b30' : '#34c759') +
            '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + (CIRC * shown).toFixed(1) + ' ' + CIRC.toFixed(1) +
            '" transform="rotate(-90 32 32)"/>' +
            '<text x="32" y="36" text-anchor="middle" font-size="13" font-weight="700" fill="#1d1d1f">' + ringPct + '%</text>' +
            '</svg>' +
            '<div class="yw-sum-ring-label">预算达成（合并口径） <strong>' + ringPct + '%</strong></div>' +
            '</div></div>';
        })();
        summaryHTML = '<div class="yw-sum">' +
          '<div class="yw-sum-title">' + Number(mk3.slice(5, 7)) + ' 月小结（月初至今）</div>' +
          '<div class="yw-sum-row">' +
          statTile({
            cardCls: 'yw-sum-tile stat-kpi-sm', label: '支出', value: U.formatMoney(exp),
            valCls: 'out', delta: expDelta
          }) +
          statTile({
            cardCls: 'yw-sum-tile stat-kpi-sm', label: '收入', value: U.formatMoney(inc),
            valCls: 'in', delta: deltaHTML(inc, ps.inc, '环比')
          }) +
          statTile({
            cardCls: 'yw-sum-tile stat-kpi-sm', label: '结余', value: U.formatMoney(inc - exp),
            valCls: (inc - exp < 0 ? 'out' : ''), delta: deltaHTML(inc - exp, ps.inc - ps.exp, '环比')
          }) +
          (top3Rows ? '<div class="stat-kpi yw-sum-top3"><div class="stat-kpi-label">支出 Top3</div>' + top3Rows + '</div>' : '') +
          ring +
          '</div></div>';
      }
      return '<div class="yw-balance">' +
        statTile({
          cardCls: 'yw-bal-cell', labelCls: 'yw-bal-label', valCls: 'yw-bal-val in',
          label: '收入', value: U.formatMoney(inc),
          delta: deltaHTML(inc, ps.inc, pw.label),
          sub: '共 ' + nInc + ' 笔'
        }) +
        statTile({
          cardCls: 'yw-bal-cell', labelCls: 'yw-bal-label', valCls: 'yw-bal-val out',
          label: '支出', value: U.formatMoney(exp),
          delta: deltaHTML(exp, ps.exp, pw.label, true),
          sub: '共 ' + nExp + ' 笔' + (curRange() === 'month' && budgetPct != null ? ' · 预算已用 ' + budgetPct + '%' : '')
        }) +
        statTile({
          cardCls: 'yw-bal-cell', labelCls: 'yw-bal-label', valCls: 'yw-bal-val' + (inc - exp < 0 ? ' out' : ''),
          label: '结余', value: U.formatMoney(inc - exp),
          delta: deltaHTML(inc - exp, ps.inc - ps.exp, pw.label),
          sub: pw.prevWord + '同期 ' + U.formatMoney(ps.inc - ps.exp)
        }) +
        '</div>' + summaryHTML + tagHTML;
    }

    if (id === 'wTrend') {
      /* 主流记账「收支走势」（丙）：收入/支出双色分组柱（同一天两根相邻细柱）+ 图内小图例
         + 悬停 tooltip（日期·收入·支出）；图下文字注释行删除（信息进图例/tooltip）
         口径（统计修复）：只画「已过」的天/月（含今天/当月），未来日不进图，与日均的已过天数口径一致 */
      let data = [];
      if (curRange() === 'year') {
        const y = p.start.getFullYear();
        const curM = new Date().getMonth(); // 只画到当月（已过月份）
        for (let m = 0; m <= curM; m++) {
          let v = 0, vi = 0;
          rs.forEach(function (b) {
            const d = U.parseDate(b.date); // 本地解析，防跨时区错月
            if (!d || d.getMonth() !== m) return;
            const a = Math.abs(Number(b.amount) || 0);
            if (b.type === 'income') vi += a; else v += a;
          });
          data.push({
            label: (m + 1) + '月', exp: Math.round(v), inc: Math.round(vi),
            expText: U.formatMoney(v), incText: U.formatMoney(vi),
            drill: { month: y + '-' + String(m + 1).padStart(2, '0') }
          });
        }
      } else {
        const days = elapsedDays(); // 已过天数（含今天），不再把未来日画成 0 柱
        const base = p.start;
        for (let d = 0; d < days; d++) {
          const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d);
          const key = U.todayStr(day);
          let v = 0, vi = 0;
          rs.forEach(function (b) {
            if (b.date !== key) return;
            const a = Math.abs(Number(b.amount) || 0);
            if (b.type === 'income') vi += a; else v += a;
          });
          data.push({
            label: key.slice(5).replace('-', '/'), exp: Math.round(v), inc: Math.round(vi),
            expText: U.formatMoney(v), incText: U.formatMoney(vi),
            drill: { date: key }
          });
        }
      }
      return C.bar(data, { series: [
        { key: 'inc', name: '收入', color: '#34c759' },
        { key: 'exp', name: '支出', color: '#ff3b30' }
      ] }) + tagHTML;
    }

    if (id === 'wCatPie') {
      /* 主流记账「分类统计」：金额、笔数、占比（byCat 的 key 即分类 id，下钻时原样带回流水筛选）
         下钻属性由 C.donut 按 catId 内建（扇区 + 图例行），bindWalletDrill 只绑点击 */
      const byCat = {};
      rs.forEach(function (b) {
        if (b.type !== 'expense') return;
        const key = b.subCatId || b.catId || 'other';
        if (!byCat[key]) byCat[key] = { v: 0, n: 0 };
        byCat[key].v += Math.abs(Number(b.amount) || 0);
        byCat[key].n += 1;
      });
      const data = Object.keys(byCat).map(function (k) {
        return {
          label: findWalletCat(db, k) || k,
          value: Math.round(byCat[k].v * 100) / 100,
          valueText: U.formatMoney(byCat[k].v) + ' · ' + byCat[k].n + '笔',
          catId: k === 'other' ? '' : k // other 是无分类兜底桶，没有真实分类 id，不下钻
        };
      }).sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
      return (data.length ? C.donut(data) : emptyHint('本期还没有支出', 'wallet')) + tagHTML;
    }

    if (id === 'wDaily') {
      /* 主流记账「日均」（甲）：日均支出 / 日均收入 / 日均结余 / 日均预算数字卡
         + 环比小箭头（与对比窗同天数日均比）+ 副行「按已过 N 天」
         口径（统计修复）：收支分母 = 已过天数（含今天，不含未来日），避免整期天数把日均稀释；
         日均预算固定 = 月预算 ÷ 30，与周期无关、跨周期可比 */
      const dayCount = elapsedDays();
      const budget = ((db.settings || {}).budget || {}).monthlyTotal || 0;
      const pwd = prevWindow();
      const psd = prevSums(bills, pwd);
      const daily = function (v) { return U.formatMoney(v / dayCount); };
      const prevDaily = function (v) { return psd.days ? v / psd.days : null; };
      return '<div class="yw-daily">' +
        statTile({
          cardCls: 'yw-daily-cell', labelCls: 'yw-bal-label', valCls: 'yw-bal-val',
          label: '日均支出', value: daily(exp),
          delta: deltaHTML(exp / dayCount, prevDaily(psd.exp), pwd.label, true),
          sub: '按已过 ' + dayCount + ' 天'
        }) +
        statTile({
          cardCls: 'yw-daily-cell', labelCls: 'yw-bal-label', valCls: 'yw-bal-val',
          label: '日均收入', value: daily(inc),
          delta: deltaHTML(inc / dayCount, prevDaily(psd.inc), pwd.label),
          sub: '按已过 ' + dayCount + ' 天'
        }) +
        statTile({
          cardCls: 'yw-daily-cell', labelCls: 'yw-bal-label', valCls: 'yw-bal-val',
          label: '日均结余', value: daily(inc - exp),
          delta: deltaHTML((inc - exp) / dayCount, prevDaily(psd.inc - psd.exp), pwd.label),
          sub: '按已过 ' + dayCount + ' 天'
        }) +
        statTile({
          cardCls: 'yw-daily-cell', labelCls: 'yw-bal-label', valCls: 'yw-bal-val',
          label: '日均预算', value: budget > 0 ? U.formatMoney(budget / 30) : '未设置',
          sub: budget > 0 ? '= 月预算 ÷ 30' : '设置月预算后显示'
        }) +
        '</div>' + tagHTML;
    }

    if (id === 'wHeat') {
      /* 主流记账「收支热力」：热力格随周期切换（统计修复，此前固定画整月）
         week = 本周 7 格（周一起）、month = 当月日历格、year = 12 个月月度热力（深浅=当月支出） */
      const byDay = {};
      rs.forEach(function (b) {
        if (b.type !== 'expense' || !b.date) return;
        byDay[b.date] = (byDay[b.date] || 0) + Math.abs(Number(b.amount) || 0);
      });
      function heatBg(v, maxV) {
        return v ? 'rgba(255,59,48,' + Math.max(0.12, v / maxV * 0.85).toFixed(2) + ')' : '#f6f6f9';
      }
      const maxOf = function (obj) {
        return Math.max.apply(null, Object.keys(obj).map(function (k) { return obj[k]; }).concat([1]));
      };
      let cells = '', title = '';
      if (curRange() === 'year') {
        const y = p.start.getFullYear();
        const byMonth = {};
        Object.keys(byDay).forEach(function (k) {
          const mk = k.slice(0, 7);
          byMonth[mk] = (byMonth[mk] || 0) + byDay[k];
        });
        const maxV = maxOf(byMonth);
        // 未来月份格（乙4）：置灰、无 data-drill-month 无点击行为；tooltip 金额过 toFixed(2)
        const n0 = new Date();
        const nowY = n0.getFullYear(), nowM = n0.getMonth() + 1;
        for (let m = 1; m <= 12; m++) {
          const mk = y + '-' + String(m).padStart(2, '0');
          const v = byMonth[mk] || 0;
          if (y > nowY || (y === nowY && m > nowM)) {
            cells += '<div class="yw-heat-cell" title="' + mk + '（未来月份）" style="background:#f6f6f9;opacity:.55">' +
              '<span>' + m + '月</span></div>';
            continue;
          }
          cells += '<div class="yw-heat-cell' + (v ? ' has' : '') + '" data-drill-month="' + mk + '"' +
            ' title="' + mk + ' 支出 ' + v.toFixed(2) + '" style="background:' + heatBg(v, maxV) + ';cursor:pointer">' +
            '<span>' + m + '月</span>' + (v ? '<small>' + Math.round(v) + '</small>' : '') + '</div>';
        }
        title = y + ' 年 · 深浅=当月支出';
      } else if (curRange() === 'week') {
        const maxV = maxOf(byDay);
        for (let d = 0; d < 7; d++) {
          const day = new Date(p.start.getFullYear(), p.start.getMonth(), p.start.getDate() + d);
          const key = U.todayStr(day);
          const v = byDay[key] || 0;
          cells += '<div class="yw-heat-cell' + (v ? ' has' : '') + '" data-drill-date="' + key + '"' +
            ' title="' + key + ' 支出 ' + v.toFixed(2) + '" style="background:' + heatBg(v, maxV) + ';cursor:pointer">' +
            '<span>' + day.getDate() + '</span>' + (v ? '<small>' + Math.round(v) + '</small>' : '') + '</div>';
        }
        title = '本周 ' + U.todayStr(p.start) + ' ~ ' +
          U.todayStr(new Date(p.start.getFullYear(), p.start.getMonth(), p.start.getDate() + 6)) + ' · 深浅=当日支出';
      } else {
        const y = p.start.getFullYear(), m = p.start.getMonth();
        const first = new Date(y, m, 1);
        const days = new Date(y, m + 1, 0).getDate();
        const pad = (first.getDay() + 6) % 7;
        const maxV = maxOf(byDay);
        for (let i = 0; i < pad; i++) cells += '<div class="yw-heat-cell empty"></div>';
        for (let d = 1; d <= days; d++) {
          const key = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
          const v = byDay[key] || 0;
          cells += '<div class="yw-heat-cell' + (v ? ' has' : '') + '" data-drill-date="' + key + '"' +
            ' title="' + key + ' 支出 ' + v.toFixed(2) + '" style="background:' + heatBg(v, maxV) + ';cursor:pointer">' +
            '<span>' + d + '</span>' + (v ? '<small>' + Math.round(v) + '</small>' : '') + '</div>';
        }
        title = y + ' 年 ' + (m + 1) + ' 月 · 深浅=当日支出';
      }
      return '<div class="yw-heat-title muted small">' + title + '</div>' +
        '<div class="yw-heat">' + cells + '</div>' + tagHTML;
    }

    if (id === 'wAssets') {
      /* 资产走势（「资产走势」）：总资产随时间（账单倒推）+ 各账户构成 + 本月变动 */
      const wallet = db.wallet || {};
      const accs = wallet.accounts || [];
      const allBills = wallet.bills || [];
      const snaps = wallet.balances || [];
      const curTotal = accs.reduce(function (s, a) { return s + (Number(a.balance) || 0); }, 0);

      // 近 90 天总资产曲线：从当前余额按账单净影响逐日倒推
      // 口径（统计修复）：只计「区分账户」的账单（accountId 非空）——不区分账户的账单不动账户余额，计入会让历史失真
      const N = 90;
      const netByDay = {};
      allBills.forEach(function (b) {
        if (!b.accountId) return; // 不区分账户：不影响账户余额，不进曲线
        const a = Math.abs(Number(b.amount) || 0);
        const n = b.type === 'income' ? a : b.type === 'expense' ? -a : 0; // 转账不影响总资产
        if (b.date) netByDay[b.date] = (netByDay[b.date] || 0) + n;
      });
      const dayKeys = [];
      const now = new Date();
      for (let i = N - 1; i >= 0; i--) {
        dayKeys.push(U.todayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
      }
      // 序列收口：末点（今天）= 当前总资产；往前按「次日净影响」倒推，保证曲线终点与三大卡数字一致
      const series = new Array(N);
      series[N - 1] = curTotal;
      for (let i = N - 2; i >= 0; i--) {
        series[i] = series[i + 1] - (netByDay[dayKeys[i + 1]] || 0);
      }
      // 余额快照：同日同账户取最新一条（createdAt 优先，无 createdAt 时数组后者覆盖），不同账户才相加，
      // 避免同日多条快照被 += 双加把余额虚增
      const snapByDay = {};
      snaps.forEach(function (s) {
        if (!s || !s.date) return;
        const accKey = s.accountId || '';
        snapByDay[s.date] = snapByDay[s.date] || {};
        const prev = snapByDay[s.date][accKey];
        const bothTs = prev && prev.createdAt && s.createdAt;
        if (!prev || (bothTs ? String(s.createdAt) >= String(prev.createdAt) : true)) snapByDay[s.date][accKey] = s;
      });
      const snapMarks = Object.keys(snapByDay).map(function (d) {
        const dayTotal = Object.keys(snapByDay[d]).reduce(function (t, k) {
          return t + (Number(snapByDay[d][k].balance) || 0);
        }, 0);
        return d + ' ' + U.formatMoney(dayTotal);
      });

      // 本月净变动 = 收入 − 支出
      // 口径统一（A14）：只计「区分账户」的账单（accountId 非空），与 90 天倒推曲线同源——
      // 不区分账户的账单不动账户余额，计入会让净变动与曲线互相矛盾
      const mk2 = U.monthKey(U.todayStr());
      let mInc = 0, mExp = 0, pNet = 0; // pNet = 上月同天数窗净变动（同 A14 口径，甲环比用）
      const pwA = prevWindow();
      const pwEnd = new Date(pwA.start.getFullYear(), pwA.start.getMonth(), pwA.start.getDate() + pwA.days);
      allBills.forEach(function (b) {
        if (!b.accountId) return;
        const a = Math.abs(Number(b.amount) || 0);
        const net = b.type === 'income' ? a : b.type === 'expense' ? -a : 0;
        const t = U.parseDate(b.date || '');
        if (t && t >= pwA.start && t < pwEnd) pNet += net;
        if (U.monthKey(b.date || '') !== mk2) return;
        if (b.type === 'income') mInc += a;
        else if (b.type === 'expense') mExp += a;
      });

      /* 甲：「较上月」= 与上月同天数日（1~N 同口径）的总资产，90 天曲线上取点（与曲线同源） */
      const prevDayKeyA = U.todayStr(new Date(pwA.start.getFullYear(), pwA.start.getMonth(), pwA.days));
      const idxA = dayKeys.indexOf(prevDayKeyA);
      const prevAssets = idxA >= 0 ? series[idxA] : null;

      return '<div class="yw-balance" style="margin-bottom:10px">' +
        statTile({
          cardCls: 'yw-bal-cell', labelCls: 'yw-bal-label', valCls: 'yw-bal-val',
          label: '当前总资产', value: U.formatMoney(curTotal),
          delta: deltaHTML(curTotal, prevAssets, '较上月'),
          sub: deltaAmtHTML(curTotal, curTotal - (mInc - mExp), '较月初')
        }) +
        statTile({
          cardCls: 'yw-bal-cell', labelCls: 'yw-bal-label', valCls: 'yw-bal-val' + (mInc - mExp < 0 ? ' out' : ' in'),
          label: '本月净变动', value: (mInc - mExp >= 0 ? '+' : '') + U.formatMoney(mInc - mExp),
          delta: deltaAmtHTML(mInc - mExp, pNet, '较上月'),
          sub: '仅统计区分账户账单'
        }) +
        statTile({
          cardCls: 'yw-bal-cell', labelCls: 'yw-bal-label', valCls: 'yw-bal-val',
          label: '余额记录', value: snaps.length + ' 条',
          sub: '同日同账户取最新'
        }) +
        '</div>' +
        C.line(dayKeys.map(function (k, i) {
          return { label: k.slice(5).replace('-', '/'), value: Math.round(series[i] * 100) / 100 };
        }), { endLabel: U.formatMoney(curTotal) }) +
        '<div class="muted small" style="margin:6px 0">总资产走势（近 90 天，区分账户账单倒推 · 末点=当前总资产' +
        (snapMarks.length ? ' · 快照：' + U.escapeHtml(snapMarks.join('，')) : '') + '）</div>' +
        C.rankBars(accs.map(function (a) {
          const bal = Number(a.balance) || 0;
          return {
            label: a.name, value: bal,
            // 丁：排行条带占比百分比（该账户 / 总资产）
            valueText: U.formatMoney(a.balance) + (curTotal !== 0 ? ' · ' + Math.round(bal / curTotal * 100) + '%' : ''),
            color: a.balance < 0 ? '#ff3b30' : undefined
          };
        }).sort(function (x, y) { return y.value - x.value; })) +
        tagHTML;
    }
    return '';
  }

  /* ===== 热力打卡（habitHeat，v1.1.7）：整年 GitHub 式年热力格（只读展示） =====
     共用约定（与主页热力卡一致）：色板 Storage.HABIT_COLORS；日期键 'YYYY-MM-DD'；
     打卡数=当年天数（Storage.habitYearCount），最长连续=历史峰值（Storage.habitLongestStreak）。
     打卡/补打/管理习惯入口在主页热力卡；本栏目只读 +「管理习惯」按钮跳主页。
     视图体系（v1.2.x 拍板 2，会话态）：hhView='week'|'month'|'year'（默认 年）；
     年视图二级 hhYearMode='blocks'|'cont'（默认 月块）；月视图锚月 habitMonth（默认当月）。 */
  let habitYear = 0; // 0=默认今年（视图态，不持久）
  let habitMonth = 0; // 'YYYY-MM' 月视图锚月，0=默认当月
  let hhView = 'year';
  let hhYearMode = 'blocks';

  /* head 右上视图切换器（seg-toggle-head 同款紧凑视觉）：周|月|年 + 年视图二级 月块|连续 */
  function habitHeatTag() {
    return '<div class="seg-toggle seg-toggle-head hh-toggle">' +
      [['week', '周'], ['month', '月'], ['year', '年']].map(function (r) {
        return '<button type="button" class="seg-btn' + (hhView === r[0] ? ' on' : '') +
          '" data-hh-view="' + r[0] + '">' + r[1] + '</button>';
      }).join('') +
      '<span class="hh-sub"' + (hhView === 'year' ? '' : ' hidden') + '>' +
      [['blocks', '月块'], ['cont', '连续']].map(function (r) {
        return '<button type="button" class="seg-btn hh-sub-btn' + (hhYearMode === r[0] ? ' on' : '') +
          '" data-hh-y-mode="' + r[0] + '">' + r[1] + '</button>';
      }).join('') +
      '</span></div>';
  }

  // 习惯色：def.color 仅接受合法 hex（3/6 位，用户数据不得直接进 style 属性），否则回落 8 色池
  function habitColorOf(def, idx) {
    const pool = S.HABIT_COLORS || ['#aecbfa', '#d7aefb', '#b7e1c1', '#fbd2a7', '#f6b8d0', '#a8e0e8', '#f7e6a1', '#f2b3b3'];
    const c = String((def && def.color) || '');
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c) ? c : pool[idx % pool.length];
  }

  /* 月块式年热力图（v1.1.5 定稿）：每月一个**独立小月历块**（7 列=周一~周日、行=周），
     块间彻底断开——每个月真正独立、无共享列（周列式天然横跨两月会粘连，弃用）；
     格 11px + 2px 间隙；打过=习惯色、未打=浅灰；未来日不画；今天描边 */
  function habitYearGrid(logMap, color, year, def) {
    const CELL = 11, GAP = 2, STEP = CELL + GAP;
    const BLOCK_W = 7 * STEP;  // 每月块宽（7 天列）
    const BLOCK_GAP = 18;      // 块间大间隔 = 月份彻底独立
    const X0 = 20, Y0 = 20;
    const todayKey = U.todayStr();
    const isCount = def && def.type === 'count'; // 计数习惯：梯度色 + 可选数字（v1.1.5）
    const max = Math.max(1, Number(def && def.max) || 5);
    const showNum = def && def.showNum !== false;
    const countOf = function (v) { return typeof v === 'number' ? v : (v ? 1 : 0); };
    let cells = '', labels = '';
    for (let m = 0; m < 12; m++) {
      const bx = X0 + m * (BLOCK_W + BLOCK_GAP);
      labels += '<text x="' + bx + '" y="11" font-size="8" fill="#8e8e93">' + (m + 1) + '月</text>';
      const daysInMonth = new Date(year, m + 1, 0).getDate();
      const startDow = (new Date(year, m, 1).getDay() + 6) % 7; // 周一=0
      for (let d = 1; d <= daysInMonth; d++) {
        const key = year + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        if (key > todayKey) continue; // 未来日不画
        const idx = startDow + d - 1;
        const col = idx % 7, row = Math.floor(idx / 7); // 列=周一~周日，行=第几周
        const v = countOf(logMap[key]);
        const on = v > 0;
        const isToday = key === todayKey;
        const fill = on ? (isCount ? S.habitColorScale(color, v, max) : color) : '#f2f2f4';
        cells += '<rect x="' + (bx + col * STEP) + '" y="' + (Y0 + row * STEP) +
          '" width="' + CELL + '" height="' + CELL + '" rx="2"' +
          (isToday ? ' stroke="#0071e3" stroke-width="1.5"' : '') +
          ' fill="' + fill + '" data-hdate="' + key + '" data-on="' + (on ? 1 : 0) + '">' +
          '<title>' + key + (on ? (isCount ? ' · ' + v + ' 次' : ' 已打卡') : '') + '</title></rect>';
        if (isCount && on && showNum) {
          // 格心次数：深色格白字、浅格深字（按填充亮度）
          const lum = parseInt(fill.slice(1, 3), 16) * 0.299 + parseInt(fill.slice(3, 5), 16) * 0.587 + parseInt(fill.slice(5, 7), 16) * 0.114;
          cells += '<text x="' + (bx + col * STEP + CELL / 2) + '" y="' + (Y0 + row * STEP + CELL / 2 + 2.5) +
            '" text-anchor="middle" font-size="7" font-weight="600" fill="' + (lum < 150 ? '#fff' : '#555') +
            '" pointer-events="none">' + v + '</text>';
        }
      }
    }
    const W = X0 + 12 * BLOCK_W + 11 * BLOCK_GAP + 1, H = Y0 + 6 * STEP + 1;
    return '<div style="overflow-x:auto">' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" style="display:block;width:100%;max-width:' + W + 'px;height:auto"' +
      ' data-habit-grid="1" data-year="' + year + '" data-months="12">' +
      labels + cells + '</svg></div>';
  }

  /* 连续平铺年热力（v1.2.x 拍板 2「连续」形态）：GitHub 式连续贡献图——
     列=周 52~53 列连续排、行=周一~周日、格 11px；月标签在月初列上方；
     月间留小间隔（MGAP）不必分块；未来日不画、今天描边、梯度色/格心数字同月块 */
  function habitYearContinuous(logMap, color, year, def) {
    const CELL = 11, GAP = 2, STEP = CELL + GAP, MGAP = 5;
    const X0 = 20, Y0 = 20;
    const todayKey = U.todayStr();
    const isCount = def && def.type === 'count';
    const max = Math.max(1, Number(def && def.max) || 5);
    const showNum = def && def.showNum !== false;
    const countOf = function (v) { return typeof v === 'number' ? v : (v ? 1 : 0); };
    // 起点=含 1/1 的周的周一（可能落在上一年 12 月）
    const jan1 = new Date(year, 0, 1);
    const start = new Date(year, 0, 1 - ((jan1.getDay() + 6) % 7));
    const colOf = function (d) { return Math.floor(Math.round((d - start) / 86400000) / 7); };
    const monthCols = []; // 每月 1 日所在列
    for (let m = 0; m < 12; m++) monthCols.push(colOf(new Date(year, m, 1)));
    const xOf = function (col) {
      let extra = 0;
      for (let m = 1; m < 12; m++) if (col >= monthCols[m]) extra += MGAP; // 月间小间隔
      return X0 + col * STEP + extra;
    };
    let cells = '', labels = '';
    for (let m = 0; m < 12; m++) {
      labels += '<text x="' + xOf(monthCols[m]) + '" y="11" font-size="8" fill="#8e8e93">' + (m + 1) + '月</text>';
    }
    const dec31 = new Date(year, 11, 31);
    for (let d = new Date(year, 0, 1); d <= dec31; d.setDate(d.getDate() + 1)) {
      const key = year + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (key > todayKey) continue; // 未来日不画
      const idx = Math.round((d - start) / 86400000);
      const col = Math.floor(idx / 7), row = idx % 7;
      const v = countOf(logMap[key]);
      const on = v > 0;
      const isToday = key === todayKey;
      const fill = on ? (isCount ? S.habitColorScale(color, v, max) : color) : '#f2f2f4';
      cells += '<rect x="' + xOf(col) + '" y="' + (Y0 + row * STEP) +
        '" width="' + CELL + '" height="' + CELL + '" rx="2"' +
        (isToday ? ' stroke="#0071e3" stroke-width="1.5"' : '') +
        ' fill="' + fill + '" data-hdate="' + key + '" data-on="' + (on ? 1 : 0) + '">' +
        '<title>' + key + (on ? (isCount ? ' · ' + v + ' 次' : ' 已打卡') : '') + '</title></rect>';
      if (isCount && on && showNum) {
        const lum = parseInt(fill.slice(1, 3), 16) * 0.299 + parseInt(fill.slice(3, 5), 16) * 0.587 + parseInt(fill.slice(5, 7), 16) * 0.114;
        cells += '<text x="' + (xOf(col) + CELL / 2) + '" y="' + (Y0 + row * STEP + CELL / 2 + 2.5) +
          '" text-anchor="middle" font-size="7" font-weight="600" fill="' + (lum < 150 ? '#fff' : '#555') +
          '" pointer-events="none">' + v + '</text>';
      }
    }
    const nCols = colOf(dec31) + 1;
    const W = xOf(nCols - 1) + CELL + 1, H = Y0 + 7 * STEP + 1;
    return '<div style="overflow-x:auto">' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" style="display:block;width:100%;max-width:' + W + 'px;height:auto"' +
      ' data-habit-grid="1" data-year="' + year + '" data-months="cont">' +
      labels + cells + '</svg></div>';
  }

  /* ===== 视图公共件（v1.2.x 拍板 2）：只读格 / 周几标签 / 习惯头行 / 周·月视图体 ===== */
  /* 只读格（统计周/月视图）：梯度色 + 格心数字（showNum），无交互（非按钮、无 data-hb-cell） */
  function roCellHTML(def, color, logMap, ds, todayKey) {
    const isCount = def.type === 'count';
    const max = Math.max(1, Number(def.max) || 5);
    const showNum = def.showNum !== false;
    const raw = logMap[ds];
    const v = typeof raw === 'number' ? raw : (raw ? 1 : 0);
    const on = v > 0;
    const future = ds > todayKey;
    const bg = on ? (isCount ? S.habitColorScale(color, v, max) : color) : '#f2f2f4';
    return '<span class="hh-cell' + (on ? ' on' : '') + (future ? ' future' : '') + (ds === todayKey ? ' today' : '') + '"' +
      ' style="background:' + bg + '" title="' + ds + (on ? (isCount ? ' · ' + v + ' 次' : ' · 已打卡') : '') + '">' +
      (isCount && on && showNum ? '<span class="hh-num">' + v + '</span>' : '') + '</span>';
  }

  function hhWeekLabelsHTML() {
    return '<div class="hh-week-labels">' + ['一', '二', '三', '四', '五', '六', '日'].map(function (w) {
      return '<span>' + w + '</span>';
    }).join('') + '</div>';
  }

  /* 习惯头行：色点 + 名称 + 当年计数 + 最长连续（三视图共用，口径=Storage 同源） */
  function habitBlockHead(def, color, year) {
    const name = U.escapeHtml(def.name || '未命名');
    const count = S.habitYearCount(def.id, year);
    const best = S.habitLongestStreak(def.id);
    return '<div class="hh-head">' +
      '<span style="width:10px;height:10px;border-radius:50%;background:' + color + ';flex:none"></span>' +
      '<strong style="font-size:13px">' + name + '</strong>' +
      '<span class="muted small">打卡 ' + count + ' 天</span>' +
      '<span class="muted small">最长连续 ' + best + ' 天</span>' +
      '</div>';
  }

  /* 周视图体（只读）：每习惯一行 7 格（本周 周一~周日）+ 周几标签 */
  function habitWeekBody(defs, log) {
    const t = U.todayStr();
    const now = new Date();
    const dow = (now.getDay() + 6) % 7;
    const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    const fmt = function (d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
    let html = '<div class="hh-nav">' +
      '<strong>' + (mon.getMonth() + 1) + '/' + mon.getDate() + ' ~ ' + (sun.getMonth() + 1) + '/' + sun.getDate() + '</strong>' +
      '<span class="tag">本周</span><div class="flex1"></div>' +
      '<span class="muted small">行=周一至周日 · 只读</span></div>';
    defs.forEach(function (def, i) {
      const color = habitColorOf(def, i);
      let cells = '';
      for (let k = 0; k < 7; k++) {
        cells += roCellHTML(def, color, log[def.id] || {}, fmt(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + k)), t);
      }
      html += '<div class="hh-block">' + habitBlockHead(def, color, now.getFullYear()) +
        '<div class="hh-cal hh-week-strip"><div class="hh-week-grid">' + cells + '</div>' + hhWeekLabelsHTML() + '</div></div>';
    });
    return html;
  }

  /* 月视图体（只读）：月历卡（形态同主页卡片，无交互）+ 月份导航 ‹ › */
  function habitMonthBody(defs, log) {
    const t = U.todayStr();
    const cur = habitMonth || U.monthKey(U.todayStr());
    const y = Number(cur.slice(0, 4)), m = Number(cur.slice(5, 7));
    const daysInMonth = new Date(y, m, 0).getDate();
    const pad = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 周一=0
    let html = '<div class="hh-nav">' +
      '<button class="btn-icon" data-hhm="prev" title="上一月">' + UI.icon('chevron-left', 14) + '</button>' +
      '<strong>' + y + ' 年 ' + m + ' 月</strong>' +
      '<button class="btn-icon" data-hhm="next" title="下一月">' + UI.icon('chevron-right', 14) + '</button>' +
      '<div class="flex1"></div><span class="muted small">只读月历</span></div>';
    defs.forEach(function (def, i) {
      const color = habitColorOf(def, i);
      const cells = [];
      for (let k = 0; k < pad; k++) cells.push('<span class="hh-cell empty"></span>');
      for (let d = 1; d <= daysInMonth; d++) {
        cells.push(roCellHTML(def, color, log[def.id] || {},
          y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'), t));
      }
      html += '<div class="hh-block">' + habitBlockHead(def, color, y) +
        '<div class="hh-cal"><div class="hh-cal-grid">' + cells.join('') + '</div>' + hhWeekLabelsHTML() + '</div></div>';
    });
    return html;
  }

  function renderHabitHeat(body, db) {
    // 预设播种（v1.1.9 拍板 6 两页温差修复）：defs 为空/仅预设时同款纯内存播种
    // （Storage.ensureHabitSeeds，habitSeeded/habitPresetGone 口径与主页一致）——
    // 从未打开主页也不落空态误导
    if (S.ensureHabitSeeds) S.ensureHabitSeeds();
    const thisYear = new Date().getFullYear();
    const defs = (db.habits && db.habits.defs) || [];
    const log = (db.habits && db.habits.log) || {};
    // 年份下限：至少今年/去年两档（用户拍板），有更早打卡数据再往前放开
    let minYear = thisYear - 1;
    Object.keys(log).forEach(function (hid) {
      Object.keys(log[hid] || {}).forEach(function (k) {
        const y = parseInt(k.slice(0, 4), 10);
        if (!isNaN(y) && y && y < minYear) minYear = y;
      });
    });
    if (!habitYear || habitYear > thisYear || habitYear < minYear) habitYear = thisYear;

    if (!defs.length) {
      // 丙3 空态卡统一结构；「管理习惯」跳主页热力卡区（添加入口在主页）
      body.innerHTML = emptyCard('flame', '还没有习惯项，去「我的主页」添加习惯后开始打卡', '管理习惯', 'data-eg-go="home"');
      bindHabitHeatHead(body, db);
      return;
    }

    let html = '';
    if (hhView === 'week') {
      html = habitWeekBody(defs, log);
    } else if (hhView === 'month') {
      html = habitMonthBody(defs, log);
    } else {
      const yearTag = habitYear === thisYear ? '<span class="tag">今年</span>'
        : habitYear === thisYear - 1 ? '<span class="tag">去年</span>' : '';
      html =
        '<div class="hh-nav">' +
        '<button class="btn-icon" data-hy="prev" title="上一年"' +
        (habitYear <= minYear ? ' style="opacity:.35"' : '') + '>' + UI.icon('chevron-left', 14) + '</button>' +
        '<strong>' + habitYear + ' 年</strong>' + yearTag +
        '<button class="btn-icon" data-hy="next" title="下一年"' +
        (habitYear >= thisYear ? ' style="opacity:.35"' : '') + '>' + UI.icon('chevron-right', 14) + '</button>' +
        '<div class="flex1"></div>' +
        '<span class="muted small">列=周 · 行=周一至周日</span></div>';
      defs.forEach(function (def, i) {
        const color = habitColorOf(def, i);
        html +=
          '<div class="hh-block">' + habitBlockHead(def, color, habitYear) +
          (hhYearMode === 'cont'
            ? habitYearContinuous(log[def.id] || {}, color, habitYear, def)
            : habitYearGrid(log[def.id] || {}, color, habitYear, def)) +
          '</div>';
      });
    }
    body.innerHTML = html;
    bindHabitHeatHead(body, db);

    // 年份切换只重建本栏目 body（不整页刷新，保持滚动/其他栏目不动）
    body.querySelectorAll('[data-hy]').forEach(function (b) {
      b.addEventListener('click', function () {
        const dir = b.getAttribute('data-hy');
        if (dir === 'prev' && habitYear > minYear) habitYear--;
        else if (dir === 'next' && habitYear < thisYear) habitYear++;
        else return;
        renderHabitHeat(body, db);
      });
    });
    // 月份切换（月视图 ‹ ›）同口径：只重绘本栏目 body
    body.querySelectorAll('[data-hhm]').forEach(function (b) {
      b.addEventListener('click', function () {
        const dir = b.getAttribute('data-hhm') === 'prev' ? -1 : 1;
        const cur = habitMonth || U.monthKey(U.todayStr());
        const d = new Date(Number(cur.slice(0, 4)), Number(cur.slice(5, 7)) - 1 + dir, 1);
        habitMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        renderHabitHeat(body, db);
      });
    });
  }

  /* head 里的视图切换器不随 body 重绘：per-element 守卫防重复绑定，重绘后同步选中态/二级显隐 */
  function bindHabitHeatHead(body, db) {
    const root = (body.closest && body.closest('.panel')) || body;
    root.querySelectorAll('[data-hh-view]').forEach(function (el) {
      if (el.__hhBound) return;
      el.__hhBound = true;
      el.addEventListener('click', function () {
        const v = el.getAttribute('data-hh-view');
        if (hhView === v) return; // 点当前档位 no-op（同 statRange 口径）
        hhView = v;
        renderHabitHeat(body, db);
      });
    });
    root.querySelectorAll('[data-hh-y-mode]').forEach(function (el) {
      if (el.__hhBound) return;
      el.__hhBound = true;
      el.addEventListener('click', function () {
        const v = el.getAttribute('data-hh-y-mode');
        if (hhYearMode === v) return;
        hhYearMode = v;
        renderHabitHeat(body, db);
      });
    });
    root.querySelectorAll('[data-hh-view]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-hh-view') === hhView);
    });
    root.querySelectorAll('[data-hh-y-mode]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-hh-y-mode') === hhYearMode);
    });
    const sub = root.querySelector('.hh-sub');
    if (sub) sub.hidden = hhView !== 'year';
  }

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
    'lPrice', 'lCpw', 'lUseRank', 'lOutfitRank', 'lFresh', 'lStock', 'lCatPie',
    'wBalance', 'wTrend', 'wCatPie', 'wDaily', 'wHeat', 'wAssets', 'habitHeat'];

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
    watchLeave();
    loadStatRange(db); // 甲19②：恢复本账号持久化的统计周期
    const sum = M.summary(db);
    db.settings.planSections = normalizeSections(db);
    const sections = db.settings.planSections;
    const blocks = blockState(db);

    root.innerHTML =
      '<div class="page-head"><h2>我的统计</h2><div class="page-actions">' +
      '<button class="btn btn-ghost" id="btn-edit-sections">' + (editMode ? '完成' : UI.icon('sliders-horizontal', 14) + ' 栏目设置') + '</button>' +
      // 快捷记账/打卡已移至「我的主页」，此处不再重复（v1.1.2）
      '</div></div>' +
      (editMode ? '<p class="muted pad-8">拖动面板可块内换序；按钮调宽度/隐藏/上下移；可整块屏蔽（屏蔽后可在栏目设置或设置页恢复）。</p>' : '') +
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
        (visible ? '屏蔽此板块' : '恢复此板块') + '">' + (visible ? UI.icon('eye', 16) : UI.icon('eye-off', 16)) + '</button>' +
        '</div>' +
        '<div class="plan-grid" data-grid="' + block.id + '"></div>';
      wrap.appendChild(bEl);
      const grid = bEl.querySelector('.plan-grid');

      if (!visible) {
        // 丙3：空态卡统一结构；引导按钮复用块级屏蔽开关（bindControls 已绑 [data-block-toggle]）
        grid.innerHTML = emptyCard('eye-off', '此板块已屏蔽（点右上角恢复）', '恢复此板块',
          'data-block-toggle="' + block.id + '"');
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
          (editMode && !meta.fixed ? '<span class="sec-drag-handle" title="拖动排序">' + UI.icon('grip-vertical', 14) + '</span>' : '') +
          '<h3>' + meta.name + '</h3>' +
          // 周期切换器放标题右侧（右上角），紧凑尺寸（v1.1.5）；资产走势固定 90 天无切换器；
          // 热力打卡：周|月|年 视图切换 + 年视图二级 月块|连续（v1.2.x 拍板 2）
          (editMode ? '' : (sec.id === 'habitHeat' ? habitHeatTag() :
            (['wBalance', 'wTrend', 'wCatPie', 'wDaily', 'wHeat'].indexOf(sec.id) >= 0 ? statRangeTag(sec.id) : ''))) +
          (editMode
            ? '<div class="sec-ctrl">' +
            (meta.fixed ? '<span class="tag">固定</span>' : '') +
            '<div class="sec-size-btns">' +
            Object.keys(SIZE_LABELS).map(function (sz) {
              return '<button class="sec-size-btn' + ((sec.size || 'm') === sz ? ' on' : '') +
                '" data-size-btn="' + idx + '" data-size-val="' + sz + '">' + SIZE_LABELS[sz] + '</button>';
            }).join('') + '</div>' +
            (meta.fixed ? '' :
              '<button class="btn-icon" title="上移" data-move="up" data-idx="' + idx + '">' + UI.icon('chevron-up', 14) + '</button>' +
              '<button class="btn-icon" title="下移" data-move="down" data-idx="' + idx + '">' + UI.icon('chevron-down', 14) + '</button>' +
              '<button class="btn-icon" title="' + (sec.enabled ? '隐藏此栏目' : '显示此栏目') + '" data-toggle="' + idx + '">' + (sec.enabled ? UI.icon('eye', 16) : UI.icon('eye-off', 16)) + '</button>') +
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
    // 空态卡引导按钮（丙3）：事件委托（每 root 只绑一次，防 render(root) 重入叠加监听）
    if (!root.hasAttribute('data-eg-bound')) {
      root.setAttribute('data-eg-bound', '1');
      root.addEventListener('click', function (e) {
        const b = e.target && e.target.closest ? e.target.closest('[data-eg-go]') : null;
        if (b && root.contains(b)) window.App.go(b.getAttribute('data-eg-go'));
      });
    }
    // 块级屏蔽（随时可点）
    root.querySelectorAll('[data-block-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = b.getAttribute('data-block-toggle');
        db.settings.planBlocks = db.settings.planBlocks || {};
        const st = blockState(db);
        db.settings.planBlocks[id] = !st[id];
        S.saveSettings().then(function () {
          render(root);
          UI.toast(db.settings.planBlocks[id] ? '板块已恢复' : '板块已屏蔽（栏目设置或设置页可恢复）', 'success');
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
      if (p && p.parentNode && dragEl) {
        const parent = p.parentNode;
        const dragId = dragEl.getAttribute('data-id');
        // 块内 DOM 顺序 → 重排该块在数组里的相对顺序。
        // 拖拽本体（dragEl）仍留在 DOM 里，必须排除（A12）：否则 dragId 收集两次、
        // 挤掉别的栏目，向下拖无效
        const domIds = Array.prototype.slice.call(parent.children)
          .filter(function (n) { return (n.classList.contains('plan-sec') && n !== dragEl) || n === p; })
          .map(function (n) { return n === p ? dragId : n.getAttribute('data-id'); });
        const arr = db.settings.planSections;
        const block = (SECTION_META[dragId] || {}).block;
        const blockIdxs = [];
        arr.forEach(function (s, i) { if ((SECTION_META[s.id] || {}).block === block) blockIdxs.push(i); });
        // placeholder 从未移动过 = 顺序没变：不保存、不弹「顺序已保存」（假反馈，A12）
        const curOrder = blockIdxs.map(function (i) { return arr[i].id; });
        const changed = domIds.join(',') !== curOrder.join(',');
        if (changed) {
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
    _curSec = id; // 渲染上下文：curRange() 返回本栏目的独立周期（v1.1.5）
    const now = new Date();
    const wstat = sum.wallet || { monthlyExpense: {}, monthlyIncome: {}, monthlyLinkedExpense: {}, byCat: {} };
    // 合并口径（每月一致）：账单支出 + 物品购入 + 美食 − 已关联物品的账单
    function foodMonth(key) {
      if (key === U.monthKey(U.todayStr())) return sum.food.monthSpend || 0;
      let s = 0;
      (db.food || []).forEach(function (f) {
        if (U.monthKey(f.date || '') === key) s += Number(f.price) || 0;
      });
      return s;
    }
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = U.monthKey(U.todayStr(d));
      const itemV = sum.monthlySpend[key] || 0;
      const billV = wstat.monthlyExpense[key] || 0;
      const linkedV = wstat.monthlyLinkedExpense[key] || 0;
      months.push({
        label: key.slice(5) + '月', key: key,
        value: Math.round(billV + itemV + foodMonth(key) - linkedV),
        itemValue: Math.round(itemV), billValue: Math.round(billV),
        billIncome: Math.round(wstat.monthlyIncome[key] || 0)
      });
    }
    const isDigital = function (i) { return i.kind === 'device' || i.kind === 'game'; };

    if (id === 'kpi') {
      /* KPI 资产驾驶舱（v1.0.7）：4 大卡 + 分域速览 + 本月 vs 上月 */
      /* v1.1.0 统计合并：花费口径 = 记账支出 + 物品购入 + 美食 − 已关联物品的账单（不重复计） */
      const monthTotal = sum.combinedMonthSpend != null ? sum.combinedMonthSpend : (sum.monthSpend + (sum.food.monthSpend || 0));
      const curKey = U.monthKey(U.todayStr());
      const prevKey = U.monthKey(U.todayStr(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      const prevM = months.find(function (m) { return m.key === prevKey; });
      const prevTotal = prevM ? prevM.value : 0;
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
      const cmpMax = Math.max(monthTotal, prevTotal) || 1;

      function hero(label, value, sub, cls, delta) {
        // 戊：KPI 总览卡与统计页数字卡共用 stat-kpi 形态（灰底白块 + 接触影、同圆角/内距/字阶）
        return '<div class="stat-kpi kpi-hero">' +
          '<div class="stat-kpi-label kpi-hero-label">' + label + '</div>' +
          '<div class="stat-kpi-num">' +
          '<div class="stat-kpi-val kpi-hero-value' + (cls ? ' ' + cls : '') + '">' + value + '</div>' +
          (delta ? '<div class="stat-kpi-delta">' + delta + '</div>' : '') +
          '</div>' +
          '<div class="stat-kpi-sub kpi-hero-sub">' + sub + '</div></div>';
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
        hero('本月花费', U.formatMoney(monthTotal), sum.monthNewCount + ' 件新物', '', deltaBadge) +
        // 未设预算（—）走中性色，仅设了预算且超支才标红（乙4）
        hero('预算剩余', budgetTotal > 0 ? U.formatMoney(budgetLeft) : '—', budgetSub, budgetTotal > 0 && budgetLeft < 0 ? 'bad' : '') +
        '</div>' +
        '<div class="kpi-domain">' +
        '<div class="kpi-domain-title">分域速览</div>' +
        '<div class="kpi-domain-row"><span class="kpi-domain-icon">' + UI.icon('gamepad-2', 16) + '</span><span class="kpi-domain-name">数码</span>' +
        '<span class="kpi-domain-parts"><span>投入 ' + U.formatMoney(domainInvest(isD)) + '</span><i>·</i><span>' + dCnt + ' 件</span><i>·</i><span>本月 ' + U.formatMoney(monthBuy(isD)) + '</span></span></div>' +
        '<div class="kpi-domain-row"><span class="kpi-domain-icon">' + UI.icon('shirt', 16) + '</span><span class="kpi-domain-name">衣橱</span>' +
        '<span class="kpi-domain-parts"><span>投入 ' + U.formatMoney(domainInvest(function (i) { return i.kind === 'clothing'; })) + '</span><i>·</i><span>' + cCnt + ' 件</span><i>·</i><span>使用率 ' + wearRate + '%</span></span></div>' +
        '<div class="kpi-domain-row"><span class="kpi-domain-icon">' + UI.icon('heart', 16) + '</span><span class="kpi-domain-name">生活</span>' +
        '<span class="kpi-domain-parts"><span>投入 ' + U.formatMoney(domainInvest(function (i) { return i.kind === 'life'; })) + '</span><i>·</i><span>' + lCnt + ' 件</span><i>·</i><span>临期 ' + lifeExpiring + '</span></span></div>' +
        '<div class="kpi-domain-row"><span class="kpi-domain-icon">' + UI.icon('utensils', 16) + '</span><span class="kpi-domain-name">美食</span>' +
        '<span class="kpi-domain-parts"><span>本月 ' + (sum.food.monthCount || 0) + ' 顿</span><i>·</i><span>' + U.formatMoney(sum.food.monthSpend || 0) + '</span><i>·</i><span>累计 ' + U.formatMoney(sum.food.totalSpend || 0) + '</span></span></div>' +
        '<div class="kpi-domain-row"><span class="kpi-domain-icon">' + UI.icon('wallet', 16) + '</span><span class="kpi-domain-name">钱袋</span>' +
        '<span class="kpi-domain-parts"><span>本月支出 ' + U.formatMoney(wstat.monthExpense || 0) + '</span><i>·</i><span>收入 ' + U.formatMoney(wstat.monthIncome || 0) + '</span><i>·</i><span>记账 ' + (wstat.billCount || 0) + ' 笔</span></span></div>' +
        '</div>' +
        '<div class="kpi-month">' +
        '<div class="kpi-month-title">本月 vs 上月</div>' +
        '<div class="kpi-cmp">' +
        '<div class="kpi-cmp-row"><span class="kpi-cmp-label">本月</span>' +
        '<div class="rank-bar-track"><div class="rank-bar-fill" style="width:' +
        (cmpMax ? Math.round(monthTotal / cmpMax * 100) : 0) + '%;background:#0071e3"></div></div>' +
        '<span class="kpi-cmp-val">' + U.formatMoney(monthTotal) + '</span></div>' +
        '<div class="kpi-cmp-row"><span class="kpi-cmp-label">上月</span>' +
        '<div class="rank-bar-track"><div class="rank-bar-fill" style="width:' +
        (cmpMax ? Math.round(prevTotal / cmpMax * 100) : 0) + '%;background:#8e8e93"></div></div>' +
        '<span class="kpi-cmp-val">' + U.formatMoney(prevTotal) + '</span></div>' +
        '<div class="kpi-month-val">对比 ' + deltaBadge + '</div>' +
        '</div>' +
        '<div class="kpi-month-mini">' +
        statTile({ cardCls: 'kpi-mini', label: '新物', value: sum.monthNewCount + ' 件' }) +
        statTile({ cardCls: 'kpi-mini', label: '日均持有成本', value: U.formatCost(sum.dailyCostTotal) }) +
        statTile({ cardCls: 'kpi-mini', label: '穿搭打卡', value: outfitMonth + ' 次' }) +
        statTile({ cardCls: 'kpi-mini', label: '回血潜力', value: U.formatMoney(sum.resalePotential) }) +
        '</div></div>';
      return;
    }
    if (id === 'composition') {
      body.className = 'panel-body center';
      const kindData = [
        { label: '数码', value: sum.items.filter(function (i) { return isDigital(i) && i.status !== 'sold' && i.status !== 'gifted'; })
          .reduce(function (a, b) { return a + M.ownInvested(db, b); }, 0), color: '#0071e3' },
        { label: '衣橱', value: sum.items.filter(function (i) { return i.kind === 'clothing' && i.status !== 'sold'; })
          .reduce(function (a, b) { return a + M.ownInvested(db, b); }, 0), color: '#ff2d55' },
        // 生活域口径统一（统计修复）：卖出/赠送的不再计入，与数码域一致；此前 sold/gifted 也算导致虚高
        { label: '生活', value: sum.items.filter(function (i) { return i.kind === 'life' && i.status !== 'sold' && i.status !== 'gifted'; })
          .reduce(function (a, b) { return a + M.ownInvested(db, b); }, 0), color: '#af52de' },
        { label: '美食', value: sum.food.totalSpend || 0, color: '#ff9500' }
      ];
      kindData.forEach(function (d) { d.valueText = U.formatMoney(Math.round(d.value)); });
      // 中心数字=四扇区展示值合计（同口径）：此前用 sum.activeInvest 与扇区合计对不上（口径不同）
      const investSum = kindData.reduce(function (a, d) { return a + Math.round(d.value); }, 0);
      body.innerHTML = C.donut(kindData, { centerText: U.formatMoney(investSum), centerSub: '合计投入' });
      return;
    }
    if (id === 'monthly') {
      body.innerHTML = C.line(months.map(function (m) { return { label: m.label, value: m.value }; })) +
        '<div class="muted small" style="margin-top:6px">口径：记账支出 + 物品购入 + 美食 − 已关联物品的账单（不重复计）</div>';
      return;
    }
    /* ===== 统一风格的收支统计（复刻主流记账统计模块） ===== */
    if (id === 'wBalance' || id === 'wTrend' || id === 'wCatPie' || id === 'wDaily' || id === 'wHeat' || id === 'wAssets') {
      // 周期切换器已移入 panel-head 右上角（v1.1.5），内容尾部不再拼
      body.innerHTML = walletStatSection(id, db, '', sum);
      bindStatRange(body);
      bindWalletDrill(body); // 点图下钻流水（data-drill-* 由图表/热力格内建，这里绑点击）
      return;
    }
    if (id === 'catRank') {
      const spent = sum.catSpend || {};
      body.innerHTML = C.rankBars([
        { label: '数码', value: spent.digital || 0, valueText: U.formatMoney(spent.digital || 0), color: '#0071e3' },
        { label: '衣橱', value: spent.clothing || 0, valueText: U.formatMoney(spent.clothing || 0), color: '#ff2d55' },
        { label: '生活', value: spent.life || 0, valueText: U.formatMoney(spent.life || 0), color: '#af52de' },
        { label: '美食', value: spent.food || 0, valueText: U.formatMoney(spent.food || 0), color: '#ff9500' }
      ].sort(function (a, b) { return b.value - a.value; }));
      return;
    }
    if (id === 'budget') {
      const b = db.settings.budget || { monthlyTotal: 0, categories: {} };
      const spent = sum.catSpend || {};
      const rows = [
        // 总花费走合并口径（记账+物品+美食−关联重复），分域预算仍是物品口径
        { label: '本月总花费', v: sum.combinedMonthSpend != null ? sum.combinedMonthSpend : (sum.monthSpend + (sum.food.monthSpend || 0)), max: Number(b.monthlyTotal) || 0 },
        { label: '数码', v: spent.digital || 0, max: Number((b.categories || {}).digital) || 0 },
        { label: '衣橱', v: spent.clothing || 0, max: Number((b.categories || {}).clothing) || 0 },
        { label: '生活', v: spent.life || 0, max: Number((b.categories || {}).life) || 0 },
        { label: '美食', v: spent.food || 0, max: Number((b.categories || {}).food) || 0 }
      ];
      // 记账分类预算（v1.2.0，设置页维护）：本月该一级分类的账单支出 vs 预算
      const wc = b.walletCats || {};
      Object.keys(wc).forEach(function (cid) {
        const max = Number(wc[cid]) || 0;
        if (!(max > 0)) return;
        let v = 0;
        ((db.wallet || {}).bills || []).forEach(function (bill) {
          if (bill.type !== 'expense') return;
          if (U.monthKey(bill.date || '') !== U.monthKey(U.todayStr())) return;
          // 归到一级分类
          let top = bill.catId || '';
          const cats = ((db.wallet || {}).cats || {}).expense || [];
          cats.forEach(function (c) {
            (c.children || []).forEach(function (ch) {
              if (ch.id === bill.subCatId) top = c.id;
            });
          });
          if (top === cid) v += Math.abs(Number(bill.amount) || 0);
        });
        rows.push({ label: findWalletCat(db, cid), v: Math.round(v * 100) / 100, max: max });
      });
      body.innerHTML = rows.map(function (r) {
        if (r.max > 0) {
          const pct = Math.min(100, Math.round(r.v / r.max * 100));
          const over = r.v > r.max;
          return '<div class="rank-row"><div class="rank-label">' + r.label + '</div>' +
            '<div class="rank-bar-track"><div class="rank-bar-fill" style="width:' + pct + '%;background:' + (over ? '#ff3b30' : '#34c759') + '"></div></div>' +
            '<div class="rank-value">' + U.formatMoney(r.v) + ' / ' + U.formatMoney(r.max) + '</div></div>';
        }
        // 未设置预算：灰虚线占位，不误导成"健康"
        return '<div class="rank-row"><div class="rank-label">' + r.label + '</div>' +
          '<div class="rank-bar-track no-budget"></div>' +
          '<div class="rank-value">' + U.formatMoney(r.v) + ' <span class="muted small">未设置预算</span></div></div>';
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
      })) : emptyHint('暂无数码设备', 'digital');
      return;
    }
    if (id === 'dCostRank') {
      // 单日使用成本：总投入 / 持有天数（不依赖使用次数，所有在手设备可比）
      const ranked = sum.items.filter(function (i) { return isDigital(i) && i.status !== 'sold' && i.status !== 'gifted'; })
        .filter(function (i) { return i.cost && i.cost.dailyCost > 0; })
        .sort(function (a, b) { return b.cost.dailyCost - a.cost.dailyCost; }).slice(0, 8);
      body.innerHTML = ranked.length ? C.rankBars(ranked.map(function (i) {
        return { label: i.name, value: i.cost.dailyCost, valueText: U.formatCost(i.cost.dailyCost) + '/天' };
      })) : emptyHint('暂无在手设备', 'digital');
      return;
    }
    if (id === 'dHoldRank') {
      const ranked = sum.items.filter(function (i) { return isDigital(i) && i.status !== 'sold' && i.status !== 'gifted'; })
        .filter(function (i) { return i.cost && i.cost.heldDays > 0; })
        .sort(function (a, b) { return b.cost.heldDays - a.cost.heldDays; }).slice(0, 8);
      body.innerHTML = ranked.length ? C.rankBars(ranked.map(function (i) {
        return { label: i.name, value: i.cost.heldDays, valueText: '已购 ' + i.cost.heldDays + ' 天' };
      })) : emptyHint('暂无在手设备', 'digital');
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
        : emptyHint('暂无数码设备', 'digital');
      return;
    }
    if (id === 'dUseRank') {
      const ranked = sum.items.filter(isDigital).filter(function (i) { return (i.useCount || 0) > 0; })
        .sort(function (a, b) { return (b.useCount || 0) - (a.useCount || 0); }).slice(0, 8);
      body.innerHTML = ranked.length ? C.rankBars(ranked.map(function (i) {
        return { label: i.name, value: i.useCount, valueText: i.useCount + ' 次使用' };
      })) : emptyHint('暂无使用记录（编辑物品可填使用次数）', 'digital');
      return;
    }
    if (id === 'dWarranty') {
      const list = sum.expiry.filter(function (x) { return x.kind === 'warranty'; }).slice(0, 8);
      body.innerHTML = list.length ? miniExpiry(list) : emptyHint('暂无保修临期设备', 'digital');
      return;
    }
    if (id === 'resale') {
      const top = sum.items.filter(function (i) { return isDigital(i) && Number(i.estimatedResalePrice) > 0; })
        .sort(function (a, b) { return b.estimatedResalePrice - a.estimatedResalePrice; }).slice(0, 6);
      body.innerHTML = top.length ? C.rankBars(top.map(function (i) {
        return { label: i.name, value: i.estimatedResalePrice, valueText: U.formatMoney(i.estimatedResalePrice) };
      })) : emptyHint('填写预估二手价后显示', 'digital');
      return;
    }
    if (id === 'dIdle' || id === 'cIdle') {
      const kindFilter = id === 'dIdle' ? isDigital : function (i) { return i.kind === 'clothing'; };
      const warn = db.settings.idleWarnDays || 60;
      const idle = sum.idleList.filter(function (x) { return kindFilter(x.item) && x.idle >= warn; }).slice(0, 8);
      body.innerHTML = idle.length ? C.rankBars(idle.map(function (x) {
        return { label: x.item.name, value: x.idle, valueText: x.idle + ' 天' };
      })) : emptyHint('没有吃灰物品，状态很好', id === 'dIdle' ? 'digital' : 'clothing', '去看看');
      return;
    }
    if (id === 'cPrice') {
      const top = sum.items.filter(function (i) { return i.kind === 'clothing' && i.status !== 'sold' && i.status !== 'gifted'; })
        .sort(function (a, b) { return (Number(b.purchasePrice) || 0) - (Number(a.purchasePrice) || 0); }).slice(0, 8);
      body.innerHTML = top.length ? C.rankBars(top.map(function (i) {
        return { label: i.name, value: Number(i.purchasePrice) || 0, valueText: U.formatMoney(i.purchasePrice) };
      })) : emptyHint('暂无衣物', 'clothing');
      return;
    }
    if (id === 'cWearRank') {
      const ranked = sum.items.filter(function (i) { return i.kind === 'clothing'; })
        .filter(function (i) { return (i.wearCount || 0) > 0; })
        .sort(function (a, b) { return (b.wearCount || 0) - (a.wearCount || 0); }).slice(0, 8);
      body.innerHTML = ranked.length ? C.rankBars(ranked.map(function (i) {
        return { label: i.name, value: i.wearCount, valueText: i.wearCount + ' 次' };
      })) : emptyHint('还没有穿着记录', 'clothing');
      return;
    }
    if (id === 'cpw') {
      const good = sum.cpwList.filter(function (c) { return c.wear > 0 && c.cpw != null; }).slice(0, 8);
      body.innerHTML = good.length ? C.rankBars(good.map(function (c) {
        return { label: c.item.name, value: c.cpw, valueText: U.formatCost(c.cpw) + '/次（穿 ' + c.wear + ' 次）' };
      })) : emptyHint('还没有穿着记录', 'clothing');
      return;
    }
    if (id === 'cOutfitRank') {
      const ranked = sum.items.filter(function (i) { return i.kind === 'clothing' && (i.autoWear || 0) > 0; })
        .sort(function (a, b) { return (b.autoWear || 0) - (a.autoWear || 0); }).slice(0, 8);
      body.innerHTML = ranked.length ? C.rankBars(ranked.map(function (i) {
        return { label: i.name, value: i.autoWear, valueText: i.autoWear + ' 次搭配' };
      })) : emptyHint('穿搭打卡勾选衣物后自动统计', 'clothing');
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
      }).join('') + '</div>' : emptyHint('每件都穿过，没有闲置新衣', 'clothing', '去衣橱看看');
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
        statTile({ cardCls: 'kpi-mini', label: '连续打卡', value: streak + ' 天' }) +
        statTile({ cardCls: 'kpi-mini', label: '累计打卡', value: Object.keys(days).length + ' 天' }) + '</div>' +
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
        : emptyHint('暂无衣物', 'clothing');
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
      })) : emptyHint('暂无妆品', 'life');
      return;
    }
    if (id === 'lCpw') {
      const lifes = sum.lifeUseList.filter(function (c) { return c.uses > 0 && c.cpw != null; }).slice(0, 8);
      body.innerHTML = lifes.length ? C.rankBars(lifes.map(function (c) {
        return { label: c.item.name, value: c.cpw, valueText: U.formatCost(c.cpw) + '/次（用 ' + c.uses + ' 次）' };
      })) : emptyHint('还没有使用记录', 'life');
      return;
    }
    if (id === 'lUseRank') {
      const ranked = sum.items.filter(function (i) { return i.kind === 'life'; })
        .filter(function (i) { return (i.useCount || 0) > 0; })
        .sort(function (a, b) { return (b.useCount || 0) - (a.useCount || 0); }).slice(0, 8);
      body.innerHTML = ranked.length ? C.rankBars(ranked.map(function (i) {
        return { label: i.name, value: i.useCount, valueText: i.useCount + ' 次' };
      })) : emptyHint('暂无使用记录', 'life');
      return;
    }
    if (id === 'lOutfitRank') {
      const ranked = sum.items.filter(function (i) { return i.kind === 'life' && (i.autoWear || 0) > 0; })
        .sort(function (a, b) { return (b.autoWear || 0) - (a.autoWear || 0); }).slice(0, 8);
      body.innerHTML = ranked.length ? C.rankBars(ranked.map(function (i) {
        return { label: i.name, value: i.autoWear, valueText: i.autoWear + ' 次搭配' };
      })) : emptyHint('穿搭打卡勾选妆品后自动统计', 'life');
      return;
    }
    if (id === 'lFresh') {
      // 开封新鲜度：开封最久的排前面（提醒尽快用完）
      // 终点用 useEndDate（售出/退役截止日）：非在用物品开封时长冻结不再增长，与详情页 lifeStatus.openedDays 同口径
      const opened = sum.items.filter(function (i) { return i.kind === 'life' && U.parseDate(i.openedDate); })
        .map(function (i) { return { item: i, days: U.daysBetween(U.parseDate(i.openedDate), M.useEndDate(i, now)) }; })
        .sort(function (a, b) { return b.days - a.days; }).slice(0, 8);
      body.innerHTML = opened.length ? C.rankBars(opened.map(function (x) {
        return { label: x.item.name, value: x.days, valueText: '已开封 ' + x.days + ' 天' };
      })) : emptyHint('还没有填写开封日期', 'life');
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
        : emptyHint('暂无妆品', 'life');
      return;
    }
    if (id === 'lExpiry') {
      const list = sum.expiry.filter(function (x) { return x.kind === 'pao'; }).slice(0, 8);
      body.innerHTML = list.length ? miniExpiry(list) : emptyHint('暂无 PAO 临期妆品', 'life');
      return;
    }
    if (id === 'empty') {
      const list = sum.empties.slice(0, 8);
      body.innerHTML = list.length ? '<div class="mini-table">' + list.map(function (i) {
        return '<div class="mini-row"><span class="flex1">' + U.escapeHtml(i.name) + '</span>' +
          '<span class="tag">' + (i.repurchase ? '待回购' : '已空瓶') + '</span>' +
          '<span class="muted">' + U.escapeHtml(i.emptyDate || '') + '</span></div>';
      }).join('') + '</div>' : emptyHint('暂无空瓶记录', 'life');
      return;
    }
    if (id === 'foodStats') {
      const f = sum.food;
      const byMeal = Object.keys(f.byMeal || {});
      body.innerHTML = '<div class="mini-table">' +
        '<div class="mini-row"><span class="flex1">本月餐食</span><span>' + f.monthCount + ' 顿</span></div>' +
        '<div class="mini-row"><span class="flex1">本月花费</span><span>' + U.formatMoney(f.monthSpend) + '</span></div>' +
        '<div class="mini-row"><span class="flex1">本月热量</span><span>' + Math.round(f.monthCalories) + ' kcal</span></div>' +
        '<div class="mini-row"><span class="flex1">平均评分</span><span>' + (f.avgRating ? f.avgRating.toFixed(1) + ' ' + UI.icon('star', 14) : '—') + '</span></div>' +
        '</div>' +
        (byMeal.length ? '<h4 class="detail-sub">餐别分布</h4>' + C.rankBars(byMeal.map(function (m) {
          return { label: m, value: f.byMeal[m], valueText: f.byMeal[m] + ' 顿' };
        })) : '');
      return;
    }
    if (id === 'habitHeat') {
      renderHabitHeat(body, db);
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

  return { render: render, BLOCKS: BLOCKS, SECTION_META: SECTION_META, normalizeSections: normalizeSections, blockState: blockState, resetState: resetState };
})();
