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
      el.addEventListener('click', function () {
        const secId = el.getAttribute('data-sr-id') || '';
        statRanges[secId] = el.getAttribute('data-sr');
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

  /* 渲染后给图表元素补 data-drill-* 并绑定点击（body 每次渲染都会重建，故每轮重绑）：
     - svg 图表（wTrend 柱 rect / wCatPie 扇区 path|circle）由 charts.js 生成、无属性入口，
       这里按数据顺序补属性；环图图例与扇区同序同参
     - 热力格 HTML 由本文件生成，已自带 data-drill-*，这里统一绑点击 */
  function bindWalletDrill(body, drills) {
    if (drills && drills.length) {
      const shapes = body.querySelectorAll('svg rect, svg path, svg circle');
      drills.forEach(function (d, i) {
        const el = shapes[i];
        if (!el || !d) return;
        if (d.catId) el.setAttribute('data-drill-cat', d.catId);
        else if (d.date) el.setAttribute('data-drill-date', d.date);
        else if (d.month) el.setAttribute('data-drill-month', d.month);
        else return;
        el.style.cursor = 'pointer';
      });
      const rows = body.querySelectorAll('.donut-legend-row');
      drills.forEach(function (d, i) {
        const el = rows[i];
        if (!el || !d || !d.catId) return;
        el.setAttribute('data-drill-cat', d.catId);
        el.style.cursor = 'pointer';
      });
    }
    body.querySelectorAll('[data-drill-cat]').forEach(function (el) {
      // 下钻带上当前统计周期（A13）：周/月/年不丢周期
      el.addEventListener('click', function () { jumpToWallet({ catId: el.getAttribute('data-drill-cat'), range: curRange() }); });
    });
    body.querySelectorAll('[data-drill-date]').forEach(function (el) {
      el.addEventListener('click', function () { jumpToWallet({ date: el.getAttribute('data-drill-date'), range: curRange() }); });
    });
    body.querySelectorAll('[data-drill-month]').forEach(function (el) {
      el.addEventListener('click', function () { jumpToWallet({ month: el.getAttribute('data-drill-month'), range: curRange() }); });
    });
  }

  function walletStatSection(id, db, tagHTML, out, sum) {
    out = out || {};
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
      /* 主流记账「收支统计」：收入 / 支出 / 结余 三大数字 + 月度小结（自动生成，可复制存档） */
      let summaryLine = '';
      if (curRange() === 'month') {
        const mk3 = U.monthKey(U.todayStr());
        const now3 = new Date();
        const dayN = now3.getDate(); // 月初至今已过天数（1~N）
        // 甲15 环比同口径：只跟「上月同期 1~N 日」比，不再拿月初至今比上月全月（月初必现假下跌）；
        // 上月月份键用 (y, m-1, 1) 构造——不走 setMonth 日期滚动（29~31 号会溢出串月，月末 bug）
        const prevFirst = new Date(now3.getFullYear(), now3.getMonth() - 1, 1);
        const pk3 = U.monthKey(U.todayStr(prevFirst));
        const prevDays = new Date(prevFirst.getFullYear(), prevFirst.getMonth() + 1, 0).getDate();
        const prevN = Math.min(dayN, prevDays); // 上月不足 N 天（如 2 月）按其月末封顶
        let pExp = 0;
        bills.forEach(function (b) {
          if (b.type !== 'expense' || U.monthKey(b.date || '') !== pk3) return;
          const d = U.parseDate(b.date);
          if (d && d.getDate() <= prevN) pExp += Math.abs(Number(b.amount) || 0);
        });
        const deltaPct = pExp ? Math.round((exp - pExp) / pExp * 100) : null;
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
        const top3 = Object.keys(byTop).sort(function (a, b) { return byTop[b] - byTop[a]; }).slice(0, 3)
          .map(function (k) { return k + ' ' + U.formatMoney(byTop[k]); }).join(' / ');
        const budgetTotal = Number(((db.settings || {}).budget || {}).monthlyTotal) || 0;
        // 甲15 预算达成统一合并口径（与 KPI「本月花费」同源）：
        // 账单支出 + 物品购入 + 美食 − 已关联物品/美食的账单（bill.itemId||foodId 扣重），不再纯账单口径
        const combined = (sum && sum.combinedMonthSpend != null) ? sum.combinedMonthSpend : exp;
        summaryLine = '<div class="yw-summary muted small" style="margin-top:8px">' + Number(mk3.slice(5, 7)) + ' 月小结（月初至今）：支出 ' +
          U.formatMoney(exp) + (deltaPct === null
            ? '（上月同期无支出，环比不可比）'
            : '（环比 ' + (deltaPct >= 0 ? '↑' : '↓') + Math.abs(deltaPct) + '%，与上月同期 1~' + prevN + ' 日比）') +
          '，收入 ' + U.formatMoney(inc) + '，结余 ' + U.formatMoney(inc - exp) +
          (top3 ? '。支出 Top3：' + top3 : '') +
          (budgetTotal > 0 ? '。预算达成（合并口径） ' + Math.min(999, Math.round(combined / budgetTotal * 100)) + '%' : '') +
          '。</div>';
      }
      return '<div class="yw-balance">' +
        '<div class="yw-bal-cell"><div class="yw-bal-label">收入</div><div class="yw-bal-val in">' + U.formatMoney(inc) + '</div></div>' +
        '<div class="yw-bal-cell"><div class="yw-bal-label">支出</div><div class="yw-bal-val out">' + U.formatMoney(exp) + '</div></div>' +
        '<div class="yw-bal-cell"><div class="yw-bal-label">结余</div><div class="yw-bal-val' + (inc - exp < 0 ? ' out' : '') + '">' + U.formatMoney(inc - exp) + '</div></div>' +
        '</div>' + summaryLine + tagHTML;
    }

    if (id === 'wTrend') {
      /* 主流记账「收支走势」：柱状图（周/月按日、年按月）
         口径（统计修复）：只画「已过」的天/月（含今天/当月），未来日不进图，与日均的已过天数口径一致 */
      let data = [];
      if (curRange() === 'year') {
        const y = p.start.getFullYear();
        const curM = new Date().getMonth(); // 只画到当月（已过月份）
        for (let m = 0; m <= curM; m++) {
          let v = 0;
          rs.forEach(function (b) {
            const d = U.parseDate(b.date); // 本地解析，防跨时区错月
            if (b.type === 'expense' && d && d.getMonth() === m) v += Math.abs(Number(b.amount) || 0);
          });
          data.push({
            label: (m + 1) + '月', value: Math.round(v), color: '#ff3b30',
            drill: { month: y + '-' + String(m + 1).padStart(2, '0') }
          });
        }
      } else {
        const days = elapsedDays(); // 已过天数（含今天），不再把未来日画成 0 柱
        const base = p.start;
        for (let d = 0; d < days; d++) {
          const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d);
          const key = U.todayStr(day);
          let v = 0;
          rs.forEach(function (b) {
            if (b.type === 'expense' && b.date === key) v += Math.abs(Number(b.amount) || 0);
          });
          data.push({ label: key.slice(5).replace('-', '/'), value: Math.round(v), color: '#ff3b30', drill: { date: key } });
        }
      }
      out.drill = data.map(function (d) { return d.drill; });
      return C.bar(data) + '<div class="muted small" style="margin-top:6px">红柱=支出　本期收入 ' + U.formatMoney(inc) +
        (curRange() === 'year' ? '（按已过月份：1 月至今）' : '（按已过天数：' + data.length + ' 天）') + '</div>' + tagHTML;
    }

    if (id === 'wCatPie') {
      /* 主流记账「分类统计」：金额、笔数、占比（byCat 的 key 即分类 id，下钻时原样带回流水筛选） */
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
      out.drill = data.map(function (d) { return d.catId ? { catId: d.catId } : null; });
      return (data.length ? C.donut(data) : emptyHint('本期还没有支出', 'wallet')) + tagHTML;
    }

    if (id === 'wDaily') {
      /* 主流记账「日均」：日均支出 / 日均收入 / 日均结余 / 日均预算
         口径（统计修复）：收支分母 = 已过天数（含今天，不含未来日），避免整期天数把日均稀释；
         日均预算固定 = 月预算 ÷ 30，与周期无关、跨周期可比 */
      const dayCount = elapsedDays();
      const budget = ((db.settings || {}).budget || {}).monthlyTotal || 0;
      return '<div class="yw-daily">' +
        '<div class="yw-daily-cell"><div class="yw-bal-label">日均支出</div><div class="yw-bal-val">' + U.formatMoney(exp / dayCount) + '</div></div>' +
        '<div class="yw-daily-cell"><div class="yw-bal-label">日均收入</div><div class="yw-bal-val">' + U.formatMoney(inc / dayCount) + '</div></div>' +
        '<div class="yw-daily-cell"><div class="yw-bal-label">日均结余</div><div class="yw-bal-val">' + U.formatMoney((inc - exp) / dayCount) + '</div></div>' +
        '<div class="yw-daily-cell"><div class="yw-bal-label">日均预算</div><div class="yw-bal-val">' +
        (budget > 0 ? U.formatMoney(budget / 30) : '未设置') + '</div></div>' +
        '</div><div class="muted small" style="margin-top:6px">口径：收支按已过 ' + dayCount + ' 天计（含今天）；日均预算 = 月预算 ÷ 30</div>' + tagHTML;
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
      let mInc = 0, mExp = 0;
      allBills.forEach(function (b) {
        if (!b.accountId) return;
        if (U.monthKey(b.date || '') !== mk2) return;
        const a = Math.abs(Number(b.amount) || 0);
        if (b.type === 'income') mInc += a;
        else if (b.type === 'expense') mExp += a;
      });

      return '<div class="yw-balance" style="margin-bottom:10px">' +
        '<div class="yw-bal-cell"><div class="yw-bal-label">当前总资产</div><div class="yw-bal-val">' + U.formatMoney(curTotal) + '</div></div>' +
        '<div class="yw-bal-cell"><div class="yw-bal-label">本月净变动</div><div class="yw-bal-val' + (mInc - mExp < 0 ? ' out' : ' in') + '">' +
        (mInc - mExp >= 0 ? '+' : '') + U.formatMoney(mInc - mExp) + '</div>' +
        '<div class="muted small">仅统计区分账户账单</div></div>' +
        '<div class="yw-bal-cell"><div class="yw-bal-label">余额记录</div><div class="yw-bal-val">' + snaps.length + ' 条</div></div>' +
        '</div>' +
        C.line(dayKeys.map(function (k, i) {
          return { label: k.slice(5).replace('-', '/'), value: Math.round(series[i] * 100) / 100 };
        })) +
        '<div class="muted small" style="margin:6px 0">总资产走势（近 90 天，区分账户账单倒推 · 末点=当前总资产' +
        (snapMarks.length ? ' · 快照：' + U.escapeHtml(snapMarks.join('，')) : '') + '）</div>' +
        C.rankBars(accs.map(function (a) {
          return {
            label: a.name, value: Number(a.balance) || 0,
            valueText: U.formatMoney(a.balance),
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
     打卡/补打/管理习惯入口在主页热力卡；本栏目只读 +「管理习惯」按钮跳主页。 */
  let habitYear = 0; // 0=默认今年（视图态，不持久）

  // 习惯色：def.color 仅接受合法 hex（用户数据不得直接进 style 属性），否则回落 8 色池
  function habitColorOf(def, idx) {
    const pool = S.HABIT_COLORS || ['#aecbfa', '#d7aefb', '#b7e1c1', '#fbd2a7', '#f6b8d0', '#a8e0e8', '#f7e6a1', '#f2b3b3'];
    const c = String((def && def.color) || '');
    return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : pool[idx % pool.length];
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

  function renderHabitHeat(body, db) {
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
      return;
    }

    const yearTag = habitYear === thisYear ? '<span class="tag">今年</span>'
      : habitYear === thisYear - 1 ? '<span class="tag">去年</span>' : '';
    let html =
      '<div style="display:flex;align-items:center;gap:6px;margin:0 0 10px">' +
      '<button class="btn-icon" data-hy="prev" title="上一年"' +
      (habitYear <= minYear ? ' style="opacity:.35"' : '') + '>' + UI.icon('chevron-left', 14) + '</button>' +
      '<strong>' + habitYear + ' 年</strong>' + yearTag +
      '<button class="btn-icon" data-hy="next" title="下一年"' +
      (habitYear >= thisYear ? ' style="opacity:.35"' : '') + '>' + UI.icon('chevron-right', 14) + '</button>' +
      '<div class="flex1"></div>' +
      '<span class="muted small">列=周 · 行=周一至周日</span></div>';

    defs.forEach(function (def, i) {
      const color = habitColorOf(def, i);
      const name = U.escapeHtml(def.name || '未命名');
      const count = S.habitYearCount(def.id, habitYear);
      const best = S.habitLongestStreak(def.id);
      html +=
        '<div style="margin:0 0 14px">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 6px">' +
        '<span style="width:10px;height:10px;border-radius:50%;background:' + color + ';flex:none"></span>' +
        '<strong style="font-size:13px">' + name + '</strong>' +
        '<span class="muted small">打卡 ' + count + ' 天</span>' +
        '<span class="muted small">最长连续 ' + best + ' 天</span>' +
        '</div>' +
        habitYearGrid(log[def.id] || {}, color, habitYear, def) +
        '</div>';
    });
    body.innerHTML = html;

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
          // 周期切换器放标题右侧（右上角），紧凑尺寸（v1.1.5）；资产走势固定 90 天无切换器
          (editMode ? '' : (['wBalance', 'wTrend', 'wCatPie', 'wDaily', 'wHeat'].indexOf(sec.id) >= 0 ? statRangeTag(sec.id) : '')) +
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
      const wout = {};
      // 周期切换器已移入 panel-head 右上角（v1.1.5），内容尾部不再拼
      body.innerHTML = walletStatSection(id, db, '', wout, sum);
      bindStatRange(body);
      bindWalletDrill(body, wout.drill); // 点图下钻流水（body 每次渲染重建，绑定放渲染后逐次执行）
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
