/* v114-uxpolish.test.js — v1.1.4 UX 细节包（乙包 C 级精选）回归锁：
   1) 数码卡片快捷 +1 toast=「使用 +1」（衣橱保留「穿着 +1」）
   2) 命名统一：编辑弹窗「编辑数码/编辑衣服/记美妆」+ 详情页标签「我的数码/我的衣橱/我的生活」
   3) confirmDialog：Enter=确认 / Esc=取消 / IME 组词（isComposing）不拦截
   4) toast 时长：error 5s / success 2.6s
   5) 「N 件临期」排除已售出/转赠/报废（与 models.js expiryList 同口径）
   6) 最近使用分类 localStorage 键带账号前缀（读写都不跨账号共享）
   7) 天气缓存键带账号前缀（setManual/dayRange 走账号键）
   8) 热力格 tooltip 金额 toFixed(2)（无浮点噪声）+ 年视图未来月份格不可点
   9) KPI「预算剩余 —」未设预算不用红色 bad（超支才标红）
  10) 全局搜索账单：分类名可命中
  11) 主页 feed/提醒死段已清（无 data-feed 空转监听）
  12) CSV 导入恢复词条/美食关联（不认识的 id 忽略不报错）
   注：乙2 CSV 往返字段完整性锁在 tests/bill-import.test.py / bill-export.test.py */
'use strict';
const { makeWindow, waitFor, sleep, waitMain, lastModal, waitNoModal, assert } = require('./helpers/harness');

let cur = '';

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return ymd(d);
}

async function main() {
  const today = ymd(new Date());
  const todayMonth = today.slice(0, 7);

  /* ==================== w1：文案/键盘/toast/临期/最近分类/天气 ==================== */
  const w1 = makeWindow({
    data: {
      items: [
        { id: 'dev1', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '测试手机', purchaseDate: '2025-06-01', purchasePrice: 3000, status: 'in_use', images: [], tags: [] },
        { id: 'cloth1', kind: 'clothing', categoryId: 'top', subCategoryId: 'top_tee', name: '测试T恤', purchaseDate: '2025-03-01', purchasePrice: 100, status: 'in_use', images: [], tags: [] },
        { id: 'life1', kind: 'life', categoryId: 'skin', subCategoryId: 'skin_other', name: '面霜', purchaseDate: '2025-02-01', purchasePrice: 500, status: 'in_use', images: [], tags: [] },
        { id: 'life-near', kind: 'life', categoryId: 'skin', subCategoryId: 'skin_other', name: '临期精华', purchaseDate: '2024-01-01', purchasePrice: 80, status: 'in_use', openedDate: monthsAgo(12), paoMonths: 6, images: [], tags: [] },
        { id: 'life-sold', kind: 'life', categoryId: 'skin', subCategoryId: 'skin_other', name: '已售出口红', purchaseDate: '2024-01-01', purchasePrice: 60, status: 'sold', openedDate: monthsAgo(12), paoMonths: 6, images: [], tags: [] },
        { id: 'life-gifted', kind: 'life', categoryId: 'skin', subCategoryId: 'skin_other', name: '转赠眼影', purchaseDate: '2024-01-01', purchasePrice: 40, status: 'gifted', openedDate: monthsAgo(12), paoMonths: 6, images: [], tags: [] },
        { id: 'life-broken', kind: 'life', categoryId: 'skin', subCategoryId: 'skin_other', name: '报废粉底', purchaseDate: '2024-01-01', purchasePrice: 30, status: 'broken', openedDate: monthsAgo(12), paoMonths: 6, images: [], tags: [] }
      ],
      wallet: {
        accounts: [{ id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 1000, note: '' }],
        bills: [
          { id: 'b-lunch', type: 'expense', amount: 23.5, date: today, time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '午饭', tagIds: [], source: 'manual' }
        ],
        cats: {
          expense: [
            { id: 'w_food', name: '食品餐饮', icon: 'color_ic_parent_restaurant', children: [{ id: 'w_food_lunch', name: '午餐', icon: 'x' }, { id: 'w_food_dinner', name: '晚餐', icon: 'x' }] },
            { id: 'w_shop', name: '购物消费', icon: 'color_ic_parent_shopping', children: [{ id: 'w_shop_digital', name: '手机数码', icon: 'x' }] }
          ],
          income: [{ id: 'w_in_wages', name: '工资', icon: 'x', children: [] }]
        }
      }
    }
  });
  if (!(await waitMain(w1))) throw new Error('no main');
  const doc1 = w1.document;

  // ---- 1 快捷 +1 toast：数码=使用 +1，衣橱=穿着 +1 ----
  cur = '1. 快捷 +1 toast：数码「使用 +1」/衣橱「穿着 +1」';
  w1.App.go('digital');
  let quick = await waitFor(function () {
    return doc1.querySelector('.item-card [data-quick]');
  }, { label: '数码页卡片未渲染' });
  quick.click();
  await waitFor(function () {
    return Array.prototype.some.call(doc1.querySelectorAll('.toast'), function (t) { return t.textContent === '使用 +1'; });
  }, { label: '数码快捷 +1 toast 文案错' });
  w1.App.go('clothing');
  quick = await waitFor(function () {
    return doc1.querySelector('.item-card [data-quick]');
  }, { label: '衣橱页卡片未渲染' });
  quick.click();
  await waitFor(function () {
    return Array.prototype.some.call(doc1.querySelectorAll('.toast'), function (t) { return t.textContent === '穿着 +1'; });
  }, { label: '衣橱快捷 +1 toast 文案错' });
  console.log('PASS ' + cur);

  // ---- 2 命名统一：弹窗标题 + 详情页标签 ----
  cur = '2. 命名统一：编辑数码/编辑衣服/记美妆 + 详情标签我的X';
  function modalTitle() {
    const m = lastModal(doc1);
    return m ? m.querySelector('.modal-head h3').textContent : '';
  }
  w1.Views.openItemEditor('dev1', 'device');
  await waitFor(function () { return lastModal(doc1) && modalTitle(); }, { label: '编辑弹窗未出现' });
  assert(modalTitle() === '编辑数码', '编辑 device 应叫「编辑数码」（不再是编辑设备）: ' + modalTitle());
  doc1.querySelector('.modal .modal-close').click();
  await waitNoModal(doc1);
  w1.Views.openItemEditor('cloth1', 'clothing');
  await waitFor(function () { return lastModal(doc1) && modalTitle(); }, { label: '编辑弹窗未出现' });
  assert(modalTitle() === '编辑衣服', '编辑 clothing 标题应叫「编辑衣服」: ' + modalTitle());
  doc1.querySelector('.modal .modal-close').click();
  await waitNoModal(doc1);
  w1.Views.openItemEditor(null, 'life');
  await waitFor(function () { return lastModal(doc1) && modalTitle(); }, { label: '记美妆弹窗未出现' });
  assert(modalTitle() === '记美妆', '新建美妆标题应叫「记美妆」: ' + modalTitle());
  doc1.querySelector('.modal .modal-close').click();
  await waitNoModal(doc1);
  async function detailTagOf(id) {
    w1.Views.openItemDetail(id);
    const m = await waitFor(function () {
      const mm = lastModal(doc1);
      return mm && mm.querySelector('.detail-tags .tag') ? mm : null;
    }, { label: '详情页未出现' });
    const tag = m.querySelector('.detail-tags .tag').textContent;
    m.querySelector('.modal-close').click();
    await waitNoModal(doc1);
    return tag;
  }
  assert((await detailTagOf('dev1')) === '我的数码', 'device 详情标签应为「我的数码」');
  assert((await detailTagOf('cloth1')) === '我的衣橱', 'clothing 详情标签应为「我的衣橱」');
  assert((await detailTagOf('life1')) === '我的生活', 'life 详情标签应为「我的生活」');
  console.log('PASS ' + cur);

  // ---- 3 confirmDialog 键盘：Enter=确认 / Esc=取消 / isComposing 不拦截 ----
  cur = '3. confirmDialog Enter 确认 / Esc 取消 / 组词不拦截';
  const p1 = w1.UI.confirmDialog('键盘测试', '按 Enter 应确认');
  await waitFor(function () { return lastModal(doc1); }, { label: '确认框未出现' });
  doc1.body.dispatchEvent(new w1.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const r1 = await Promise.race([p1, sleep(800).then(function () { return 'timeout'; })]);
  assert(r1 === true, 'Enter 应确认，得到: ' + r1);
  await waitNoModal(doc1);
  const p2 = w1.UI.confirmDialog('键盘测试', '按 Esc 应取消');
  await waitFor(function () { return lastModal(doc1); }, { label: '确认框未出现' });
  doc1.body.dispatchEvent(new w1.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const r2 = await Promise.race([p2, sleep(800).then(function () { return 'timeout'; })]);
  assert(r2 === false, 'Esc 应取消，得到: ' + r2);
  await waitNoModal(doc1);
  const p3 = w1.UI.confirmDialog('键盘测试', '组词中 Enter 不应确认');
  await waitFor(function () { return lastModal(doc1); }, { label: '确认框未出现' });
  const ev = new w1.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'isComposing', { value: true });
  doc1.body.dispatchEvent(ev);
  const r3 = await Promise.race([p3, sleep(150).then(function () { return 'timeout'; })]);
  assert(r3 === 'timeout', 'IME 组词中的 Enter 不应拦截确认');
  doc1.body.dispatchEvent(new w1.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert((await p3) === false, '收尾 Esc 应取消');
  await waitNoModal(doc1);
  console.log('PASS ' + cur);

  // ---- 4 toast 时长：error 5s / success 2.6s ----
  cur = '4. toast 时长：error 5000ms / success 2600ms';
  const origSetTimeout = w1.setTimeout;
  const delays = [];
  w1.setTimeout = function (fn, ms) { delays.push(ms); return origSetTimeout(fn, ms); };
  try {
    w1.UI.toast('错误提示', 'error');
    w1.UI.toast('成功提示', 'success');
  } finally {
    w1.setTimeout = origSetTimeout;
  }
  assert(delays.indexOf(5000) >= 0, 'error toast 应 5000ms 后消失，实际定时: ' + delays.join(','));
  assert(delays.indexOf(2600) >= 0, 'success toast 应保持 2600ms，实际定时: ' + delays.join(','));
  console.log('PASS ' + cur);

  // ---- 5 临期徽标排除已售出/转赠/报废 ----
  cur = '5. 「N 件临期」排除已售出/转赠/报废';
  w1.App.go('life');
  const badge5 = await waitFor(function () {
    const b = doc1.querySelector('.page-head .tag-warn');
    return b && b.textContent.indexOf('件临期') >= 0 ? b : null;
  }, { label: '生活页临期徽标未渲染' });
  assert(badge5.textContent === '1 件临期', '4 件已离开物品不得计临期，实际: ' + badge5.textContent);
  console.log('PASS ' + cur);

  // ---- 6 最近使用分类：键带账号前缀（读写均不跨账号） ----
  cur = '6. 最近分类 localStorage 键带账号前缀';
  const accCatKey = w1.Storage.accId() + ':ll-recent-cats';
  w1.localStorage.setItem('ll-recent-cats', JSON.stringify(['w_food_lunch']));
  w1.localStorage.setItem(accCatKey, JSON.stringify(['w_food_dinner']));
  w1.WalletView.openBillForm(null);
  const modal6 = await waitFor(function () {
    const m = lastModal(doc1);
    return m && m.querySelector('#yw-cats') && m.querySelector('.yw-cat-cell[data-sub]') ? m : null;
  }, { label: '记账弹窗分类格未渲染' });
  const cellOrder = Array.prototype.map.call(modal6.querySelectorAll('.yw-cat-cell[data-sub]'), function (c) {
    return c.getAttribute('data-sub');
  });
  assert(cellOrder[0] === 'w_food_dinner',
    '最近分类应读账号键（晚餐置顶），实际顺序: ' + cellOrder.join(','));
  modal6.querySelector('.yw-cat-cell[data-sub=w_food_lunch]').click();
  modal6.querySelector('#yw-amt').value = '10';
  modal6.querySelector('[data-x=s]').click();
  await waitFor(function () {
    return w1.Storage.getDB().wallet.bills.some(function (b) { return Number(b.amount) === 10; });
  }, { label: '账单未保存' });
  await waitFor(function () {
    const cur = JSON.parse(w1.localStorage.getItem(accCatKey) || '[]');
    return cur[0] === 'w_food_lunch';
  }, { label: '最近分类未写入账号键' });
  assert(JSON.parse(w1.localStorage.getItem(accCatKey))[0] === 'w_food_lunch',
    '最近分类应写入账号键: ' + w1.localStorage.getItem(accCatKey));
  assert(w1.localStorage.getItem('ll-recent-cats') === '["w_food_lunch"]',
    '裸键不应被写（跨账号共享源）: ' + w1.localStorage.getItem('ll-recent-cats'));
  console.log('PASS ' + cur);

  // ---- 7 天气缓存键带账号前缀 ----
  cur = '7. 天气缓存键带账号前缀';
  const wxKey = w1.Storage.accId() + ':lovelife-wx-' + today;
  w1.Weather.setManual(today, 1, 2);
  assert(w1.localStorage.getItem(wxKey), '天气缓存应写入账号键 ' + wxKey);
  assert(!w1.localStorage.getItem('lovelife-wx-' + today), '裸天气键不应再写');
  const rec7 = await w1.Weather.dayRange(today);
  assert(rec7 && rec7.source === 'manual' && rec7.min === 1 && rec7.max === 2,
    'dayRange 应从账号键读回手动记录: ' + JSON.stringify(rec7));
  console.log('PASS ' + cur);

  // ---- 11 主页 feed/提醒死段已清 ----
  cur = '11. 主页 feed/提醒死亡段已清';
  w1.App.go('home');
  await waitFor(function () { return doc1.getElementById('hq-bill'); }, { label: '主页未渲染' });
  const homeText = doc1.getElementById('main-content').textContent;
  assert(homeText.indexOf('今日概览') >= 0, '今日概览应保留');
  assert(homeText.indexOf('最近动态') < 0, '「最近动态」段应已删除');
  assert(homeText.indexOf('提醒') < 0, '「提醒」段应已删除');
  assert(doc1.querySelectorAll('[data-feed]').length === 0, 'data-feed 空转监听应已清');
  console.log('PASS ' + cur);

  /* ==================== w2：热力 tooltip/未来月份 + KPI 预算中性 ==================== */
  const w2 = makeWindow({
    data: {
      wallet: {
        bills: [
          { id: 'hb1', type: 'expense', amount: 0.1, date: today, time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: 'h1', tagIds: [], source: 'manual' },
          { id: 'hb2', type: 'expense', amount: 0.2, date: today, time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: 'h2', tagIds: [], source: 'manual' }
        ]
      }
    }
  });
  if (!(await waitMain(w2))) throw new Error('no main');
  const doc2 = w2.document;

  // ---- 8 热力格 tooltip toFixed(2) + 年视图未来月份不可点 ----
  cur = '8. 热力 tooltip 无浮点噪声 + 年视图未来月份不可点';
  w2.App.go('plan');
  await waitFor(function () { return doc2.querySelector('[data-body=wHeat]'); }, { label: '热力栏目未渲染' });
  const yearBtn = await waitFor(function () { return doc2.querySelector('[data-id=wHeat] .seg-toggle-head [data-sr=year]'); }, { label: '统计周期切换未渲染' });
  yearBtn.click();
  const heat = await waitFor(function () {
    const h = doc2.querySelector('[data-body=wHeat]');
    return h && h.querySelector('[data-drill-month]') ? h : null;
  }, { label: '年视图热力未渲染' });
  assert(heat.innerHTML.indexOf('0000000') < 0, 'tooltip 不应出现浮点噪声: ' + heat.innerHTML.slice(0, 300));
  const cell8 = heat.querySelector('[data-drill-month="' + todayMonth + '"]');
  assert(cell8 && cell8.getAttribute('title').indexOf('0.30') >= 0,
    '当月 tooltip 金额应过 toFixed(2)（0.1+0.2=0.30）: ' + (cell8 && cell8.getAttribute('title')));
  const nowM = new Date().getMonth() + 1;
  assert(heat.querySelectorAll('.yw-heat-cell').length === 12, '年视图应 12 格');
  assert(heat.querySelectorAll('[data-drill-month]').length === nowM,
    '只有已到月份可点，可点数应=' + nowM + '，实际 ' + heat.querySelectorAll('[data-drill-month]').length);
  if (nowM < 12) {
    const futureCell = heat.querySelector('.yw-heat-cell[title*="未来月份"]');
    assert(futureCell && !futureCell.hasAttribute('data-drill-month'), '未来月份格不得有点击行为');
    assert((futureCell.getAttribute('style') || '').indexOf('opacity') >= 0, '未来月份格应置灰');
  }
  console.log('PASS ' + cur);

  // ---- 9 KPI「预算剩余 —」未设预算不用红色 bad ----
  cur = '9. KPI 预算剩余「—」未设预算中性色（超支才 bad）';
  const hero9 = await waitFor(function () {
    return Array.prototype.find.call(doc2.querySelectorAll('.kpi-hero'), function (h) {
      return h.textContent.indexOf('预算剩余') >= 0;
    }) || null;
  }, { label: 'KPI 预算剩余卡未渲染' });
  const val9 = hero9.querySelector('.kpi-hero-value');
  assert(val9.textContent.trim() === '—', '未设预算应显示「—」: ' + val9.textContent);
  assert(val9.className.indexOf('bad') < 0, '未设预算不得用红色 bad 样式: ' + val9.className);
  w2.Storage.getDB().settings.budget = { monthlyTotal: 0.1, categories: {} };
  w2.App.go('plan');
  const hero9b = await waitFor(function () {
    return Array.prototype.find.call(doc2.querySelectorAll('.kpi-hero'), function (h) {
      return h.textContent.indexOf('预算剩余') >= 0 && h.querySelector('.kpi-hero-value').textContent.trim() !== '—';
    }) || null;
  }, { label: '设置预算后 KPI 未重渲染' });
  assert(hero9b.querySelector('.kpi-hero-value').className.indexOf('bad') >= 0,
    '超支应保留红色 bad 样式: ' + hero9b.querySelector('.kpi-hero-value').className);
  console.log('PASS ' + cur);

  /* ==================== w3：全局搜索账单分类名 ==================== */
  const w3 = makeWindow({
    data: {
      wallet: {
        bills: [
          { id: 'sb1', type: 'expense', amount: 23, date: today, time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '午饭', tagIds: [], source: 'manual' }
        ]
      }
    }
  });
  if (!(await waitMain(w3))) throw new Error('no main');
  const doc3 = w3.document;

  // ---- 10 全局搜索账单分类名可命中 ----
  cur = '10. 全局搜索账单：分类名可命中';
  const gs = doc3.getElementById('global-search');
  gs.value = '午餐';
  gs.dispatchEvent(new w3.Event('input'));
  const res10 = await waitFor(function () {
    const r = doc3.getElementById('search-results');
    return r && r.classList.contains('show') && r.innerHTML.indexOf('午饭') >= 0 ? r : null;
  }, { label: '分类名「午餐」未命中账单' });
  assert(res10.innerHTML.indexOf('账单') >= 0, '命中结果应为账单行: ' + res10.innerHTML.slice(0, 200));
  gs.value = '不存在的词zzz';
  gs.dispatchEvent(new w3.Event('input'));
  await waitFor(function () {
    const r = doc3.getElementById('search-results');
    return r && r.innerHTML.indexOf('没有找到相关内容') >= 0 ? r : null;
  }, { label: '负向用例误命中' });
  console.log('PASS ' + cur);

  /* ==================== w4：导入恢复词条/美食关联 ==================== */
  const w4 = makeWindow({
    data: {
      items: [
        { id: 'it-exist', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '已有手机', purchaseDate: '2025-01-01', purchasePrice: 100, status: 'in_use', images: [], tags: [] }
      ],
      food: [
        { id: 'fd-exist', name: '公司午饭', date: today, meal: '午餐', price: 30, images: [], tags: [], linkedBillIds: [] }
      ],
      wallet: {
        cats: {
          expense: [
            { id: 'w_food', name: '食品餐饮', icon: 'x', children: [{ id: 'w_food_lunch', name: '午餐', icon: 'x' }, { id: 'w_food_dinner', name: '晚餐', icon: 'x' }] },
            { id: 'w_shop', name: '购物消费', icon: 'x', children: [{ id: 'w_shop_digital', name: '手机数码', icon: 'x' }] }
          ],
          income: [{ id: 'w_in_wages', name: '工资', icon: 'x', children: [] }]
        }
      }
    },
    routes: {
      'api/import/parse': function (h) {
        return h.ok({
          ok: true, format: 'generic_csv', skipped: [], warnings: [],
          bills: [
            { date: today, time: '12:30', type: 'expense', amount: 50, note: '配件A', catName: '购物消费', subCatName: '手机数码', itemId: 'it-exist' },
            { date: today, time: '', type: 'expense', amount: 5, note: '幽灵', catName: '购物消费', subCatName: '手机数码', itemId: 'ghost-id' },
            { date: today, time: '', type: 'expense', amount: 30, note: '公司午饭', catName: '食品餐饮', subCatName: '午餐', foodId: 'fd-exist' }
          ]
        });
      }
    }
  });
  if (!(await waitMain(w4))) throw new Error('no main');
  const doc4 = w4.document;

  // ---- 12 导入恢复词条/美食关联（不认识的 id 忽略不报错） ----
  cur = '12. 导入恢复词条/美食关联，不认识的 id 忽略';
  const box4 = doc4.createElement('div');
  doc4.body.appendChild(box4);
  w4.WalletView.mountImportUI(box4);
  box4.querySelector('#paste-bills').value = 'x';
  box4.querySelector('#btn-paste-parse').click();
  await waitFor(function () {
    const p = box4.querySelector('#import-preview');
    return p && p.querySelector('#imp-commit') ? p : null;
  }, { label: '导入预览未渲染' });
  box4.querySelector('#imp-commit').click();
  await waitFor(function () {
    const d = w4.Storage.getDB();
    return d.wallet.bills.some(function (b) { return b.note === '配件A'; }) &&
      d.wallet.bills.some(function (b) { return b.note === '幽灵'; });
  }, { label: '导入账单未落库' });
  const db4 = w4.Storage.getDB();
  const ib1 = db4.wallet.bills.find(function (b) { return b.note === '配件A'; });
  const ib2 = db4.wallet.bills.find(function (b) { return b.note === '幽灵'; });
  const ib3 = db4.wallet.bills.find(function (b) { return b.note === '公司午饭'; });
  assert(ib1 && ib1.itemId === 'it-exist', '导出关联的词条 id 应恢复: ' + JSON.stringify(ib1));
  assert(ib1.time === '12:30', '导入应保留时间列: ' + JSON.stringify(ib1));
  assert(!db4.items.some(function (i) { return i.name === '配件A'; }), '已显式关联词条不得再被自动建档');
  const it4 = db4.items.find(function (i) { return i.id === 'it-exist'; });
  assert(it4 && (it4.linkedBillIds || []).indexOf(ib1.id) >= 0, '词条 linkedBillIds 应补上导入账单');
  assert(ib2 && ib2.itemId && ib2.itemId !== 'ghost-id', '不认识的 id 应忽略（不挂悬空链接、不报错）: ' + JSON.stringify(ib2));
  assert(db4.items.some(function (i) { return i.name === '幽灵'; }), '不认识 id 后仍应走既有自动词条同步');
  assert(ib3 && ib3.foodId === 'fd-exist', '美食关联应恢复: ' + JSON.stringify(ib3));
  const food4 = db4.food.find(function (f) { return f.id === 'fd-exist'; });
  assert(food4 && (food4.linkedBillIds || []).indexOf(ib3.id) >= 0, '美食 linkedBillIds 应补上导入账单');
  console.log('PASS ' + cur);

  console.log('========== v1.1.4 UX 细节包（乙包）：12 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
