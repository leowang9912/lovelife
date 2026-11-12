/* v124-stat-upgrade.test.js — v1.1.8 统计口径统一 + 交互补全（P0×5 + P1×6/7/8）回归锁：
   1) P0-1 在手口径：已卖/赠送不进次数类排行（与价格榜一致）
   2) P0-2 成本排行方向标注：单次=划算优先（升序）、单日=费钱优先（降序）
   3) P0-3 预算/分类排行同屏自洽：分域+「记账其他」差额 = 总花费（合并口径）
   4) P0-4 时间轴统一：monthly/dBuyTrend/cBuyTrend/outfitStats/wAssets 挂周|月|年切换器
   5) P0-5 投入构成四扇区同口径（累计花销含已售 + 口径副行）
   6) P1-6 下钻：排行条物品名 data-item-id；分类环图/排行 data-items-* → 物品清单
   7) P1-7 Top N 截断补「其余 N 项」尾行（金额类附合计）
   8) P1-8 环比：monthly/foodStats/budget/catRank 尾部/行内带 stat-delta */
'use strict';
const { makeWindow, waitFor, waitMain, lastModal, assert } = require('./helpers/harness');

let cur = '';

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function openPlan(w) {
  const doc = w.document;
  if (!doc.querySelector('#plan-wrap')) {
    w.App.go('plan');
    await waitFor(function () { return !!doc.querySelector('#plan-wrap'); }, { label: '统计页加载' });
  }
  return doc;
}

async function main() {
  const today = new Date();
  const soldDate = ymd(new Date(today.getFullYear(), today.getMonth(), 1));
  const ITEMS = [
    { id: 'it-a', name: '在手耳机', kind: 'device', status: 'in_use', purchasePrice: 1000, purchaseDate: soldDate, useCount: 10, wearCount: 0, autoWear: 0, estimatedResalePrice: 600, cost: { dailyCost: 2, heldDays: 50, currentValue: 800, costPerUse: 100 }, categoryId: 'c-d1' },
    { id: 'it-b', name: '已卖手机', kind: 'device', status: 'sold', purchasePrice: 3000, purchaseDate: soldDate, useCount: 99, wearCount: 0, autoWear: 0, estimatedResalePrice: 0, cost: { dailyCost: 5, heldDays: 100, currentValue: 0, costPerUse: 30 }, categoryId: 'c-d1' },
    { id: 'it-c', name: '在手外套', kind: 'clothing', status: 'in_use', purchasePrice: 500, purchaseDate: soldDate, useCount: 0, wearCount: 8, autoWear: 3, estimatedResalePrice: 0, cost: { dailyCost: 1, heldDays: 30, currentValue: 400, costPerUse: 62 }, categoryId: 'c-c1' },
    { id: 'it-d', name: '在手面霜', kind: 'life', status: 'in_use', purchasePrice: 200, purchaseDate: soldDate, useCount: 5, wearCount: 0, autoWear: 1, estimatedResalePrice: 0, cost: { dailyCost: 1, heldDays: 20, currentValue: 150, costPerUse: 40 }, categoryId: 'c-l1' },
    { id: 'it-e', name: '在手键盘', kind: 'device', status: 'in_use', purchasePrice: 800, purchaseDate: soldDate, useCount: 20, wearCount: 0, autoWear: 0, estimatedResalePrice: 500, cost: { dailyCost: 3, heldDays: 60, currentValue: 600, costPerUse: 40 }, categoryId: 'c-d1' }
  ];
  // 9 件衣物挤爆 Top 8（测 rest 尾行）
  for (let i = 0; i < 9; i++) {
    ITEMS.push({
      id: 'it-w' + i, name: '衣物' + i, kind: 'clothing', status: 'in_use',
      purchasePrice: 100 + i, purchaseDate: soldDate, useCount: 0, wearCount: 1, autoWear: 0,
      estimatedResalePrice: 0, cost: { dailyCost: 0.5, heldDays: 10, currentValue: 80, costPerUse: 100 }, categoryId: 'c-c1'
    });
  }
  const DATA = {
    items: ITEMS,
    categories: {
      digital: [{ id: 'c-d1', name: '手机数码' }],
      clothing: [{ id: 'c-c1', name: '外套' }],
      life: [{ id: 'c-l1', name: '护肤' }],
      occasion: []
    },
    food: [{ id: 'fd1', date: soldDate, meal: '午餐', name: '饭', price: 30, tags: [], images: [] }],
    outfits: [],
    wallet: {
      cats: { expense: [], income: [] },
      accounts: [{ id: 'acc1', name: '卡', balance: 10000 }],
      balances: [],
      // 记账支出 500（未关联）→ 四域合计（1000+800+500+200+30=2530 物品+餐费）之外的差额
      bills: [{ id: 'b1', type: 'expense', amount: 500, date: soldDate, catId: 'w_other', subCatId: '', accountId: 'acc1', note: '杂项' }]
    },
    settings: {
      budget: { monthlyTotal: 5000, categories: { digital: 2000, clothing: 800, life: 300, food: 500 } },
      // 显式启用非默认栏目（dUseRank/outfitStats/resale 不在 DEFAULT_ON）
      planSections: [
        { id: 'dUseRank', enabled: true }, { id: 'outfitStats', enabled: true }, { id: 'resale', enabled: true },
        { id: 'catRank', enabled: true }
      ]
    }
  };

  /* 1) P0-1 在手口径 */
  cur = '1. P0-1 在手口径：已卖物品不进次数类排行';
  {
    const w = makeWindow({ data: JSON.parse(JSON.stringify(DATA)) });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    tabTo(doc, 'digital');
    const dig = doc.querySelector('.plan-block[data-block=digital]');
    await waitFor(function () { return dig.innerHTML.indexOf('次使用') >= 0 ? true : null; }, { label: '使用排行未渲染' });
    assert(dig.innerHTML.indexOf('已卖手机') < 0, '已卖物品不得进次数排行');
    assert(dig.innerHTML.indexOf('在手耳机') >= 0, '在手物品应进次数排行');
    console.log('PASS 1. ' + cur);
  }

  /* 2) P0-2 成本排行方向标注 */
  cur = '2. P0-2 成本排行命名带方向（划算优先/费钱优先）';
  {
    const w = makeWindow({ data: JSON.parse(JSON.stringify(DATA)) });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    tabTo(doc, 'digital');
    assert(doc.querySelector('.plan-block[data-block=digital]').innerHTML.indexOf('费钱优先') >= 0, '单日成本应标注费钱优先');
    tabTo(doc, 'clothing');
    assert(doc.querySelector('.plan-block[data-block=clothing]').innerHTML.indexOf('划算优先') >= 0, '单次成本应标注划算优先');
    console.log('PASS 2. ' + cur);
  }

  /* 3) P0-3 预算/分类排行同屏自洽 */
  cur = '3. P0-3 记账其他差额行 + 环比（分域+其他=总花费）';
  {
    const w = makeWindow({ data: JSON.parse(JSON.stringify(DATA)) });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    tabTo(doc, 'overall');
    const ov = doc.querySelector('.plan-block[data-block=overall]');
    await waitFor(function () { return ov.innerHTML.indexOf('本月总花费') >= 0 ? true : null; }, { label: '预算进度未渲染' });
    assert(ov.innerHTML.indexOf('记账其他') >= 0, '账单未归域部分应有「记账其他」差额行');
    assert(ov.innerHTML.indexOf('分类消费排行') >= 0 && ov.innerHTML.indexOf('环比') >= 0, '分类排行应带环比语境');
    console.log('PASS 3. ' + cur);
  }

  /* 4) P0-4 时间轴统一 */
  cur = '4. P0-4 趋势栏挂周|月|年切换器（购机/购衣/穿搭/月度曲线/资产）';
  {
    const w = makeWindow({ data: JSON.parse(JSON.stringify(DATA)) });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    tabTo(doc, 'digital');
    const dig = doc.querySelector('.plan-block[data-block=digital]');
    await waitFor(function () { return dig.querySelector('[data-sr-id=dBuyTrend]') ? true : null; }, { label: '购机曲线无周期切换器' });
    tabTo(doc, 'clothing');
    const cl = doc.querySelector('.plan-block[data-block=clothing]');
    assert(cl.querySelector('[data-sr-id=cBuyTrend]'), '购衣曲线应有周期切换器');
    assert(cl.querySelector('[data-sr-id=outfitStats]'), '穿搭统计应有周期切换器');
    tabTo(doc, 'overall');
    const ov = doc.querySelector('.plan-block[data-block=overall]');
    assert(ov.querySelector('[data-sr-id=monthly]'), '月度消费曲线应有周期切换器');
    assert(ov.querySelector('[data-sr-id=wAssets]'), '资产走势应有周期切换器（弃固定 90 天）');
    // 切「周」后购机曲线重绘（7 点）
    tabTo(doc, 'digital');
    const dig2 = doc.querySelector('.plan-block[data-block=digital]');
    dig2.querySelector('[data-sr-id=dBuyTrend][data-sr=week]').click();
    await waitFor(function () {
      return dig2.querySelector('[data-body=dBuyTrend] svg') ? true : null;
    }, { label: '切周后购机曲线未重绘' });
    console.log('PASS 4. ' + cur);
  }

  /* 5) P0-5 composition 口径 */
  cur = '5. P0-5 投入构成四扇区同口径（累计花销含已售）';
  {
    const w = makeWindow({ data: JSON.parse(JSON.stringify(DATA)) });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    tabTo(doc, 'overall');
    const ov = doc.querySelector('.plan-block[data-block=overall]');
    await waitFor(function () { return ov.innerHTML.indexOf('累计花销') >= 0 ? true : null; }, { label: '投入构成未渲染' });
    // 已卖手机 3000 计入数码扇区（累计口径）：中心合计 1000+800+3000+500+200+30=5530
    const body = ov.querySelector('[data-body=composition]');
    assert(body.textContent.indexOf('累计花销') >= 0, '应标注累计花销口径');
    // 已卖手机 3000 计入数码扇区：中心合计 = 数码4800（含已售3000）+衣橱1436+生活200+美食30 = 6466（口径备注已删，数值锁语义）
    assert(body.textContent.indexOf('6,466') >= 0 || body.textContent.indexOf('6466') >= 0,
      '中心合计应含已售（6466）: ' + body.textContent.slice(0, 200));
    assert(body.textContent.indexOf('含已售') < 0, '口径副行已按拍板删除');
    console.log('PASS 5. ' + cur);
  }

  /* 6) P1-6 下钻 */
  cur = '6. P1-6 排行条物品名可点（data-item-id）+ 分类下钻（data-items-*）';
  {
    const w = makeWindow({ data: JSON.parse(JSON.stringify(DATA)) });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    tabTo(doc, 'digital');
    const dig = doc.querySelector('.plan-block[data-block=digital]');
    await waitFor(function () { return dig.querySelector('.rank-label[data-item-id]') ? true : null; }, { label: '排行条物品名未带下钻属性' });
    assert(dig.querySelector('[data-items-kind=digital]'), '分类排行/环图应带 data-items-kind 下钻');
    // 点物品名 → openItemDetail（dispatchEvent：JSDOM 里 SVG 元素无 .click()）
    let opened = '';
    w.Views.openItemDetail = function (id) { opened = id; };
    dig.querySelector('.rank-label[data-item-id]').dispatchEvent(new w.Event('click', { bubbles: true }));
    assert(opened, '点物品名应触发 openItemDetail');
    // 点分类 → 物品清单弹窗（title=分类 · 域物品）
    dig.querySelector('[data-items-kind=digital]').dispatchEvent(new w.Event('click', { bubbles: true }));
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.textContent.indexOf('数码物品') >= 0 ? true : null;
    }, { label: '点分类未弹物品清单' });
    console.log('PASS 6. ' + cur);
  }

  /* 7) P1-7 其余合计尾行 */
  cur = '7. P1-7 Top 8 截断补「其余 N 项」尾行（金额类附合计）';
  {
    const w = makeWindow({ data: JSON.parse(JSON.stringify(DATA)) });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    tabTo(doc, 'clothing');
    const cl = doc.querySelector('.plan-block[data-block=clothing]');
    await waitFor(function () { return cl.querySelector('.rank-rest') ? true : null; }, { label: '无其余合计尾行' });
    const rest = cl.querySelector('.rank-rest');
    assert(rest.textContent.indexOf('其余') >= 0 && rest.textContent.indexOf('项') >= 0, '尾行应写其余 N 项');
    console.log('PASS 7. ' + cur);
  }

  /* 8) P1-8 环比 */
  cur = '8. P1-8 monthly/foodStats/budget/catRank 带环比（stat-delta）';
  {
    const w = makeWindow({ data: JSON.parse(JSON.stringify(DATA)) });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    tabTo(doc, 'overall');
    const ov = doc.querySelector('.plan-block[data-block=overall]');
    await waitFor(function () { return ov.querySelector('[data-body=monthly] .stat-delta') ? true : null; }, { label: '月度曲线无环比' });
    assert(ov.querySelector('[data-body=catRank] .stat-delta'), '分类排行应带环比');
    assert(ov.querySelector('[data-body=budget] .stat-delta'), '预算进度应带环比');
    tabTo(doc, 'food');
    const fd = doc.querySelector('.plan-block[data-block=food]');
    await waitFor(function () { return fd.querySelector('[data-body=foodStats] .stat-delta') ? true : null; }, { label: '美食统计无环比' });
    console.log('PASS 8. ' + cur);
  }

  console.log('========== v124-stat-upgrade：8 项全部通过 ==========');
}

function tabTo(doc, id) {
  const b = doc.querySelector('[data-plan-stab="' + id + '"]');
  if (b) b.click();
}

main().catch(function (e) {
  console.log('FAIL ' + cur + ': ' + (e && e.message || e));
  process.exit(1);
});
