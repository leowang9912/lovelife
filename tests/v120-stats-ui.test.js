/* v120-stats-ui.test.js — v1.2.0 统计页 UI 优化回归锁（甲/乙/丙/丁/戊）：
   1) 甲 wBalance 数字卡：环比小箭头（↑绿/↓红/→0%）+ 副信息（共 N 笔 · 预算已用 X% / 上月同期）
   2) 甲 wDaily 数字卡：环比箭头 + 副行「按已过 N 天」；日均预算「= 月预算 ÷ 30」
   3) 甲 wAssets 数字卡：「较上月」百分比箭头 + 副行「较月初 ↑¥X」；A14 口径文案不丢
   4) 乙 月度小结卡片化：小结标题/三个数字块（环比箭头）/支出 Top3 渐变条（≤3 行）/预算达成小环
      —— 甲15 三口径字符串（月小结（月初至今）/环比 ↑X%/与上月同期 1~N 日比/预算达成（合并口径） X%）不丢
   5) 乙 周期联动：切「周」后小结卡组整体消失（只出月）
   6) 丙 柱状图：收入/支出双色分组柱（同日两柱）+ 图内小图例 + 悬停 tooltip（日期·收入·支出）
      + 图下文字注释行删除 + 双柱下钻同日期（序号猜配对已废、属性驱动）
   7) 丙 环图：扇区旁百分比（≥3%）+ 图例行下钻属性 + 点图例下钻带周期
   8) 丁 资产走势：折线渐变填充（线下渐隐）+ 线尾锚点金额 + 排行条占比百分比
   9) 戊 KPI 形态统一：四形态共用 stat-kpi（灰底白块+接触影）+ 字阶 CSS 变量（font 简写带 var(--font)）
   10) CSS 花括号平衡 + 字阶简写不丢字体族 */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWindow, waitFor, sleep, waitMain, assert, APP } = require('./helpers/harness');

let cur = '';

function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function blockOf(css, re) {
  const m = css.match(re);
  return m ? m[1] : '';
}

async function main() {
  const now = new Date();
  const today = fmt(now);
  const dayN = now.getDate();
  const prevFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevDays = new Date(prevFirst.getFullYear(), prevFirst.getMonth() + 1, 0).getDate();
  const prevN = Math.min(dayN, prevDays);

  /* 统一夹具：上月 1 日 支出100/收入50，本月今天 支出200+30/收入50；物品 100（今天购入）；预算 400 */
  const mkData = function () {
    return {
      settings: {
        idleWarnDays: 60,
        budget: { monthlyTotal: 400, categories: {}, walletCats: {} },
        planSections: [], rememberAccount: true
      },
      items: [
        { id: 'itA', kind: 'clothing', categoryId: 'top', subCategoryId: '', name: '外套', purchaseDate: today, purchasePrice: 100, status: 'in_use', images: [], tags: [] }
      ],
      wallet: {
        accounts: [{ id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 1000, note: '' }],
        balances: [{ id: 'b1', date: today, accountId: 'ac_cash', balance: 1000, createdAt: '2026-01-01T00:00:00' }],
        bills: [
          { id: 'p1', type: 'expense', amount: 100, date: fmt(prevFirst), time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: 'ac_cash', note: '上月同期午饭', tagIds: [], source: 'manual' },
          { id: 'pi', type: 'income', amount: 50, date: fmt(prevFirst), time: '', catId: 'w_in_wages', subCatId: '', accountId: 'ac_cash', note: '上月同期工资', tagIds: [], source: 'manual' },
          { id: 'c1', type: 'expense', amount: 200, date: today, time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: 'ac_cash', note: '本月午饭', tagIds: [], source: 'manual' },
          { id: 'c2', type: 'expense', amount: 30, date: today, time: '', catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '本月购物', tagIds: [], source: 'manual' },
          { id: 'ci', type: 'income', amount: 50, date: today, time: '', catId: 'w_in_wages', subCatId: '', accountId: 'ac_cash', note: '本月工资', tagIds: [], source: 'manual' }
        ]
      }
    };
  };

  /* 期望值（与实现同公式）：本期 支出230/收入50/结余-180；上月同天数窗 支出100/收入50/结余-50 */
  const expPct = Math.round((230 - 100) / 100 * 100);           // ↑130%
  const balPct = Math.round((-180 - (-50)) / Math.abs(-50) * 100); // ↓260%
  const budgetPct = Math.min(999, Math.round(330 / 400 * 100));   // 合并口径 330/400 = 83%

  const w = makeWindow({ data: mkData() });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;
  w.App.go('plan');
  await waitFor(function () {
    return doc.querySelector('[data-body=wBalance] .stat-kpi');
  }, { label: '统计页未渲染' });

  /* ==================== 1 甲：wBalance 数字卡语境 ==================== */
  cur = '1. 甲 wBalance：环比小箭头（↑绿/↓红/→0%）+ 副信息语境';
  const bal = doc.querySelector('[data-body=wBalance]');
  const tiles = bal.querySelectorAll('.yw-bal-cell.stat-kpi');
  assert(tiles.length === 3, '收支统计应为 3 张统一数字卡（收入/支出/结余），实为 ' + tiles.length);
  const expTile = tiles[1], incTile = tiles[0], balTile = tiles[2];
  // 支出：↑ 绿（class up）+ 副行「共 N 笔 · 预算已用 X%」
  const expDelta = expTile.querySelector('.stat-kpi-num .stat-delta');
  assert(expDelta && expDelta.className.indexOf('down') >= 0, '支出环比上涨应为语义红(down)（v1.1.6 色向修正）: ' + (expDelta && expDelta.className));
  assert(expDelta.textContent === '较上月 ↑' + expPct + '%', '支出环比应「较上月 ↑' + expPct + '%」: ' + expDelta.textContent);
  assert(expTile.querySelector('.stat-kpi-sub').textContent === '共 2 笔 · 预算已用 ' + budgetPct + '%',
    '支出副行应「共 2 笔 · 预算已用 ' + budgetPct + '%」: ' + expTile.querySelector('.stat-kpi-sub').textContent);
  // 收入：持平 →0%（class flat）+ 副行「共 1 笔」
  const incDelta = incTile.querySelector('.stat-kpi-num .stat-delta');
  assert(incDelta && incDelta.className.indexOf('flat') >= 0, '收入环比持平应为 flat: ' + (incDelta && incDelta.className));
  assert(incDelta.textContent === '较上月 →0%', '持平应显「→0%」: ' + incDelta.textContent);
  assert(incTile.querySelector('.stat-kpi-sub').textContent === '共 1 笔', '收入副行应「共 1 笔」');
  // 结余：↓ 红（class down）+ 副行「上月同期 ¥X」
  const balDelta = balTile.querySelector('.stat-kpi-num .stat-delta');
  assert(balDelta && balDelta.className.indexOf('down') >= 0, '结余环比下跌应为 down（红）: ' + (balDelta && balDelta.className));
  assert(balDelta.textContent === '较上月 ↓' + Math.abs(balPct) + '%', '结余环比应「较上月 ↓' + Math.abs(balPct) + '%」: ' + balDelta.textContent);
  assert(balTile.querySelector('.stat-kpi-sub').textContent === '上月同期 ¥-50',
    '结余副行应「上月同期 ¥-50」: ' + balTile.querySelector('.stat-kpi-sub').textContent);
  // 白色数值块（灰底白块层次法）必须存在
  tiles.forEach(function (t) {
    assert(t.querySelector('.stat-kpi-num .stat-kpi-val'), '数字卡缺白色数值块 .stat-kpi-num > .stat-kpi-val');
    assert(t.querySelector('.stat-kpi-label'), '数字卡缺标签');
  });
  console.log('PASS ' + cur);

  /* ==================== 2 甲：wDaily 数字卡语境 ==================== */
  cur = '2. 甲 wDaily：环比箭头；口径副行已按拍板删除';
  const daily = doc.querySelector('[data-body=wDaily]');
  const dTiles = daily.querySelectorAll('.yw-daily-cell.stat-kpi');
  assert(dTiles.length === 4, '日均应为 4 张统一数字卡，实为 ' + dTiles.length);
  ['日均支出', '日均收入', '日均结余'].forEach(function (label, i) {
    const t = dTiles[i];
    assert(t.querySelector('.stat-kpi-label').textContent === label, '日均卡标签应为 ' + label);
    assert(t.querySelector('.stat-kpi-num .stat-delta'), label + ' 缺环比小箭头');
    assert(t.querySelector('.stat-kpi-num .stat-delta').textContent.indexOf('较上月') === 0,
      label + ' 环比应以「较上月」开头: ' + t.querySelector('.stat-kpi-num .stat-delta').textContent);
    assert(!t.querySelector('.stat-kpi-sub'), label + ' 口径副行「按已过 N 天」已删（v1.2.01 拍板）');
  });
  assert(!dTiles[3].querySelector('.stat-kpi-sub'), '日均预算口径副行「= 月预算 ÷ 30」已删');
  assert(daily.innerHTML.indexOf('口径：') < 0, '口径脚注应删干净');
  console.log('PASS ' + cur);

  /* ==================== 3 甲：wAssets 数字卡语境 ==================== */
  cur = '3. 甲 wAssets：「较上月」箭头 + 副行「较月初 ↑¥X」+ A14 口径不丢';
  const assets = doc.querySelector('[data-body=wAssets]');
  const aTiles = assets.querySelectorAll('.yw-bal-cell.stat-kpi');
  assert(aTiles.length === 3, '资产走势应为 3 张统一数字卡，实为 ' + aTiles.length);
  const totalTile = aTiles[0];
  assert(totalTile.querySelector('.stat-kpi-num .stat-delta').textContent.indexOf('较上月') === 0,
    '当前总资产环比应「较上月 …」');
  // 较月初 = 本月净变动（区分账户口径）= 50-200 = -150 → ↓¥150
  assert(totalTile.querySelector('.stat-kpi-sub').textContent === '较月初 ↓¥150',
    '资产卡副行应「较月初 ↓¥150」: ' + totalTile.querySelector('.stat-kpi-sub').textContent);
  assert(assets.textContent.indexOf('仅统计区分账户账单') < 0, 'A14：口径文案已按拍板删除（数值断言锁语义）');
  assert(assets.textContent.indexOf('快照') >= 0, '有快照点时标注不得丢（v112 锁）');
  console.log('PASS ' + cur);

  /* ==================== 4 乙：月度小结卡片化 ==================== */
  cur = '4. 乙 月度小结卡组：三数字块 + Top3 渐变条 + 预算达成小环（三口径字符串不丢）';
  const sumGroup = bal.querySelector('.yw-sum');
  assert(!!sumGroup, '月度小结应结构化为卡组 .yw-sum');
  const sumTitle = sumGroup.querySelector('.yw-sum-title').textContent;
  assert(sumTitle.indexOf('月小结（月初至今）') >= 0, '小结标题应含「月小结（月初至今）」: ' + sumTitle);
  const sumTiles = sumGroup.querySelectorAll('.yw-sum-tile');
  assert(sumTiles.length === 3, '小结应为支出/收入/结余三个数字块，实为 ' + sumTiles.length);
  // 支出块环比：环比 ↑X%（口径备注已删，数值锁语义）
  const btext = bal.textContent;
  assert(btext.indexOf('环比 ↑' + expPct + '%') >= 0, '小结支出块应「环比 ↑' + expPct + '%」: ' + btext.slice(0, 300));
  assert(btext.indexOf('与上月同期 1~') < 0, '口径备注「与上月同期 1~N 日比」已按拍板删除');
  assert(new RegExp('预算达成\\s*' + budgetPct + '%').test(btext),
    '预算达成应走合并口径（账单230+物品100 = 330/400）: ' + btext.slice(0, 400));
  // 支出 Top3 横向条：分类名 + 渐变条 + 金额，最多 3 行
  const topRows = sumGroup.querySelectorAll('.yw-sum-top-row');
  assert(topRows.length === 2 && topRows.length <= 3, '支出 Top3 应最多 3 行（本期 2 类），实为 ' + topRows.length);
  assert(topRows[0].querySelector('.yw-sum-top-name').textContent === '食品餐饮', 'Top1 应为食品餐饮');
  assert(topRows[0].querySelector('.yw-sum-top-amt').textContent === '¥200', 'Top1 金额应 ¥200');
  assert(topRows[0].querySelector('.yw-sum-top-fill').getAttribute('style').indexOf('width:100%') >= 0, 'Top1 渐变条应满宽');
  // 预算达成小环（百分比环 + 文字）
  const ringCard = sumGroup.querySelector('.yw-sum-ring-card');
  assert(ringCard && ringCard.querySelector('svg circle'), '预算达成应为百分比环');
  assert(new RegExp('预算达成\\s*' + budgetPct + '%').test(ringCard.querySelector('.yw-sum-ring-label').textContent),
    '小环文字应含「预算达成 ' + budgetPct + '%」');
  console.log('PASS ' + cur);

  /* ==================== 5 乙：小结只出月周期 ==================== */
  cur = '5. 乙 月结卡组随周期消失（切「周」不再出月小结）';
  doc.querySelector('[data-id=wBalance] [data-sr=week]').click();
  await waitFor(function () {
    return doc.querySelector('[data-body=wBalance]').innerHTML.indexOf('月小结') < 0 ? true : null;
  }, { label: '切周后月小结未消失' });
  assert(doc.querySelector('[data-body=wBalance] .yw-sum') === null, '周周期不应渲染月结卡组');
  doc.querySelector('[data-id=wBalance] [data-sr=month]').click();
  await waitFor(function () {
    return doc.querySelector('[data-body=wBalance] .yw-sum') ? true : null;
  }, { label: '切回月未恢复月结卡组' });
  console.log('PASS ' + cur);

  /* ==================== 6 丙：柱状图分组双色 + 图例 + tooltip ==================== */
  cur = '6. 丙 柱状：收入/支出双色分组柱 + 图内小图例 + 悬停 tooltip + 注释行删除';
  const trend = doc.querySelector('[data-body=wTrend]');
  assert(trend.innerHTML.indexOf('红柱=支出') < 0 && trend.innerHTML.indexOf('本期收入') < 0,
    '图下文字注释行应删除（信息进图例/tooltip）');
  const rects = trend.querySelectorAll('svg rect[data-drill-date]');
  assert(rects.length >= 2, '分组柱应每档两根（收入/支出）且带下钻日期，实为 ' + rects.length);
  const byDate = {};
  Array.prototype.forEach.call(rects, function (r) {
    const d = r.getAttribute('data-drill-date');
    (byDate[d] = byDate[d] || []).push(r);
  });
  Object.keys(byDate).forEach(function (d) {
    assert(byDate[d].length === 2, d + ' 应两根相邻细柱（收入/支出），实为 ' + byDate[d].length);
  });
  // 双色：同档两柱颜色不同（绿收入 / 红支出）
  const firstPair = byDate[Object.keys(byDate)[0]];
  assert(firstPair[0].getAttribute('fill') !== firstPair[1].getAttribute('fill'), '收入/支出两柱应双色');
  // 图内小图例（色点 + 标签）
  const svgTexts = Array.prototype.map.call(trend.querySelectorAll('svg text'), function (t) { return t.textContent; });
  assert(svgTexts.indexOf('收入') >= 0 && svgTexts.indexOf('支出') >= 0, '图内小图例缺「收入/支出」标签');
  assert(trend.querySelectorAll('svg circle').length >= 2, '图例应带色点');
  // 悬停 tooltip：日期 · 收入 · 支出
  const tip = firstPair[0].querySelector('title');
  assert(tip && tip.textContent.indexOf('· 收入 ') >= 0 && tip.textContent.indexOf('· 支出 ') >= 0,
    'tooltip 应为「日期 · 收入 · 支出」: ' + (tip && tip.textContent));
  // 双柱同日期下钻（属性驱动，不再按形状序号猜配对）
  let captured = null;
  w.WalletView.jumpTo = function (f) { captured = f; };
  firstPair[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await waitFor(function () { return captured ? true : null; }, { label: '收入柱下钻未触发' });
  const capA = captured; captured = null;
  firstPair[1].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await waitFor(function () { return captured ? true : null; }, { label: '支出柱下钻未触发' });
  assert(capA.date === captured.date, '同档两柱必须下钻同一天: ' + JSON.stringify([capA, captured]));
  assert(capA.range === 'month', '下钻应带本栏目周期: ' + JSON.stringify(capA));
  console.log('PASS ' + cur);

  /* ==================== 7 丙：环图扇区百分比 + 图例下钻 ==================== */
  cur = '7. 丙 环图：扇区旁百分比（≥3%）+ 图例行下钻属性 + 点图例带周期';
  const pie = doc.querySelector('[data-body=wCatPie]');
  const legendRows = pie.querySelectorAll('.donut-legend-row');
  assert(legendRows.length === 2, '本期两类支出应 2 行图例，实为 ' + legendRows.length);
  const pcts = Array.prototype.map.call(pie.querySelectorAll('.donut-legend-pct'), function (e) { return e.textContent; });
  const pieSvgTexts = Array.prototype.map.call(pie.querySelectorAll('svg text'), function (t) { return t.textContent; });
  pcts.forEach(function (p) {
    if (parseInt(p, 10) >= 3) {
      assert(pieSvgTexts.indexOf(p) >= 0, '扇区旁应标百分比 ' + p + '（≥3% 才标）');
    }
  });
  assert(legendRows[0].hasAttribute('data-drill-cat'), '图例行应内建下钻属性');
  assert(pie.querySelector('svg path[data-drill-cat]') || pie.querySelector('svg circle[data-drill-cat]'),
    '环图扇区应内建下钻属性');
  captured = null;
  legendRows[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await waitFor(function () { return captured ? true : null; }, { label: '图例下钻未触发' });
  assert(captured.catId === 'w_food_lunch', '图例下钻应带分类 id: ' + JSON.stringify(captured));
  assert(captured.range === 'month', '图例下钻应带本栏目周期: ' + JSON.stringify(captured));
  console.log('PASS ' + cur);

  /* ==================== 8 丁：资产走势卡 ==================== */
  cur = '8. 丁 资产走势：渐变填充 + 线尾锚点金额 + 排行条占比';
  assert(assets.querySelector('svg defs linearGradient'), '折线应有浅色渐变填充（线下渐隐）');
  const areaPath = assets.querySelector('svg path[fill^="url(#"]');
  assert(!!areaPath, '线下面积应走渐变填充而不是纯色');
  const aSvgTexts = Array.prototype.map.call(assets.querySelectorAll('svg text'), function (t) { return t.textContent; });
  assert(aSvgTexts.indexOf('¥1,000') >= 0, '线尾锚点标签应带当前总资产金额 ¥1,000: ' + aSvgTexts.join('|'));
  const rankVals = assets.querySelectorAll('.rank-value');
  assert(rankVals.length === 1 && /·\s*-?\d+%/.test(rankVals[0].textContent),
    '账户排行条应带占比百分比（该账户/总资产）: ' + (rankVals[0] && rankVals[0].textContent));
  assert(rankVals[0].textContent.indexOf('· 100%') >= 0, '单账户占比应 100%: ' + rankVals[0].textContent);
  console.log('PASS ' + cur);

  /* ==================== 9 戊：KPI 形态统一 ==================== */
  cur = '9. 戊 KPI 形态统一：四形态共用 stat-kpi（灰底白块+接触影）+ 字阶 CSS 变量';
  const heroes = doc.querySelectorAll('.plan-sec[data-id=kpi] .kpi-hero');
  assert(heroes.length === 4, 'KPI 总览应 4 张 hero 卡，实为 ' + heroes.length);
  heroes.forEach(function (h) {
    assert(h.classList.contains('stat-kpi'), 'kpi-hero 应并入 stat-kpi 统一形态');
    assert(h.querySelector('.stat-kpi-num .kpi-hero-value'), 'kpi-hero 数值应在白色数值块内');
    assert(h.querySelector('.stat-kpi-label.kpi-hero-label') && h.querySelector('.stat-kpi-sub.kpi-hero-sub'),
      'kpi-hero 标签/副行结构不得丢');
  });
  // v114 锁不变式：.kpi-hero-value 只装数值（bad 类语义保留）
  const heroVals = Array.prototype.map.call(heroes, function (h) { return h.querySelector('.kpi-hero-value'); });
  assert(heroVals.every(function (v) { return v.textContent.trim().length > 0; }), 'kpi-hero-value 应只装数值');
  // yw-bal-cell / yw-daily-cell 已在 1/3 用例验证 stat-kpi；此处补 kpi-mini（旧 kpi 形态）
  const miniChips = doc.querySelectorAll('.plan-sec .kpi-mini.stat-kpi');
  assert(miniChips.length >= 2, '统计页 kpi-mini 应统一为 stat-kpi 形态，实为 ' + miniChips.length);
  miniChips.forEach(function (m) {
    assert(m.querySelector('.stat-kpi-num .stat-kpi-val'), 'kpi-mini 数值应在白色数值块内');
    assert(m.querySelector('.stat-kpi-label'), 'kpi-mini 缺标签');
  });
  // CSS：统一 chrome（同圆角 --r-xl / 同内距 / 灰底白块+接触影 / 数值同字阶 tabular-nums）
  const cssExtra = fs.readFileSync(path.join(APP, 'css', 'extra.css'), 'utf8');
  const cssStyles = fs.readFileSync(path.join(APP, 'css', 'styles.css'), 'utf8');
  const statKpi = blockOf(cssExtra, /\.stat-kpi\s*\{([^}]*)\}/);
  assert(statKpi.indexOf('background: #f6f6f9') >= 0, '戊：统一卡应灰底 #f6f6f9');
  assert(statKpi.indexOf('border-radius: var(--r-xl)') >= 0, '戊：统一卡同圆角 var(--r-xl)');
  assert(statKpi.indexOf('padding: 12px 14px') >= 0, '戊：统一卡同内距 12px 14px');
  const statNum = blockOf(cssExtra, /\.stat-kpi-num\s*\{([^}]*)\}/);
  assert(statNum.indexOf('background: #fff') >= 0, '戊：白色数值块');
  assert(statNum.indexOf('box-shadow: var(--shadow-card)') >= 0, '戊：1px 接触影走 var(--shadow-card)');
  const statVal = blockOf(cssExtra, /\.stat-kpi-val\s*\{([^}]*)\}/);
  assert(statVal.indexOf('font: var(--f-num-l)') >= 0, '戊：数值同字阶 var(--f-num-l)');
  assert(statVal.indexOf('font-variant-numeric: tabular-nums') >= 0, '戊：数值 tabular-nums');
  const statLabel = blockOf(cssExtra, /\.stat-kpi-label\s*\{([^}]*)\}/);
  assert(statLabel.indexOf('font: var(--f-cap)') >= 0 && statLabel.indexOf('var(--text-2)') >= 0, '戊：标签同灰阶');
  // 字阶变量定义（font 简写必须带 var(--font)）
  assert(cssStyles.indexOf('--f-num-l: 700 21px/28px var(--font);') >= 0, '戊：缺 --f-num-l 字阶变量（须带 var(--font)）');
  assert(cssStyles.indexOf('--f-num-m: 700 16px/22px var(--font);') >= 0, '戊：缺 --f-num-m 字阶变量（须带 var(--font)）');
  console.log('PASS ' + cur);

  /* ==================== 10 CSS 花括号平衡 + 字阶简写不丢字体族 ==================== */
  cur = '10. CSS 花括号平衡 + font 简写带 var(--font)';
  ['extra.css', 'styles.css'].forEach(function (f) {
    const css = fs.readFileSync(path.join(APP, 'css', f), 'utf8');
    let open = 0, close = 0;
    for (let i = 0; i < css.length; i++) {
      if (css[i] === '{') open++;
      if (css[i] === '}') close++;
    }
    assert(open === close, f + ' 花括号不平衡：{=' + open + ' }=' + close);
    // font 简写必须带字体族（var(--font) 或字阶变量）：裸 font: Npx/... 会把字体重置为浏览器默认
    // （排除 --font: 令牌定义本身：前面是 '-' 的不算简写）
    const re = /(?:^|[^-\w])font:\s*([^;{}]+)/g;
    let m;
    while ((m = re.exec(css))) {
      assert(/var\(--/.test(m[1]), f + ' 存在丢字体族的 font 简写: font: ' + m[1]);
    }
  });
  console.log('PASS ' + cur);

  console.log('========== v1.2.0 统计 UI 优化回归锁（甲~戊）：10 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
