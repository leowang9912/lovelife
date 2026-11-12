/* v114-ux.test.js — UX 走查 A 级修复回归锁：
   1) A6 解除关联只解绑不删词条（keepRec）：词条保留/防复活/默认语义兼容 + UI 入口
   2) A7 美食价格默认=关联账单合计、用户改过（priceManual）保留；账单备注变更名称跟随
   3) A8 化妆品使用次数 0 档：显示「0 次 · 不计」，0 → +1 到 1（不跳 2），落库一致
   4) A12 统计拖动：未移动不弹「顺序已保存」；排除拖拽本体后向下拖生效
   5) A11 「我的生活」子分类精确筛选（不列同父类全部）
   6) A9 天气推荐手动切「今日」标题/按钮不得变「明日」
   7) A13 分类统计下钻带周期（周=本周区间）+ 来源条可关闭/清除
   8) A14 资产走势「本月净变动」只计区分账户账单（与曲线同源）
   9) A3 账号切换重置筛选/搜索/统计周期
   10) A1 删除当前账号停会话回启动页、确认文案标明「当前登录账号」 */
'use strict';
const { makeWindow, waitFor, sleep, waitMain, lastModal, assert } = require('./helpers/harness');

let cur = '';

async function main() {
  /* ==================== 1-2+UI 入口：A6 / A7（数据 + 美食编辑器） ==================== */
  const w1 = makeWindow({
    data: {
      categories: {
        foodCuisine: ['中餐'], foodType: [], meal: ['早餐', '午餐', '晚餐', '加餐']
      }
    }
  });
  if (!(await waitMain(w1))) throw new Error('no main');
  const S = w1.Storage;
  const doc1 = w1.document;
  const today = w1.Utils.todayStr();
  await S.loadAll();

  // ---- 1 A6 美食侧：解除关联（keepRec）只解绑不删词条 ----
  cur = '1. A6 解除关联保留美食词条（keepRec）';
  await S.saveBill({
    id: 'b-food-1', type: 'expense', amount: 50, date: today, time: '',
    catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '午饭', tagIds: [], source: 'manual'
  });
  let db = S.getDB();
  assert(db.food.length === 1, '前置失败：正餐账单应自动同步 1 条美食');
  await S.unlinkBillSync('b-food-1', true);
  db = S.getDB();
  assert(db.food.length === 1, 'P1：解除关联（keepRec）不得删除词条——文案承诺「词条将保留」');
  const food1 = db.food[0];
  assert(!food1.fromBill, '解除后 fromBill 应摘除（转手动维护，不再触发删除）');
  assert(!food1.linkedBillIds || food1.linkedBillIds.indexOf('b-food-1') < 0, '解除后 linkedBillIds 应摘除该账单');
  const billF = db.wallet.bills.find(function (b) { return b.id === 'b-food-1'; });
  assert(!billF.foodId, '解除后账单不得再挂 foodId');
  // 解除后编辑账单：syncOff 防复活，且不得动到保留下来的词条
  await S.saveBill({
    id: 'b-food-1', type: 'expense', amount: 80, date: today, time: '',
    catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '午饭', tagIds: [], source: 'manual'
  });
  db = S.getDB();
  assert(db.food.length === 1, '解除后编辑账单不得复活/重建美食记录');
  assert(!db.food[0].fromBill && !db.wallet.bills.find(function (b) { return b.id === 'b-food-1'; }).foodId,
    '解除后编辑账单不得重新挂回同步');
  assert(Math.round(Number(db.food[0].price)) === 50, '保留的词条不得被账单改价: ' + db.food[0].price);
  console.log('PASS ' + cur);

  // ---- 1b A6 词条侧 + 默认语义（无 keepRec）兼容 ----
  cur = '2. A6 词条侧 keepRec + 默认删除语义兼容';
  await S.saveBill({
    id: 'b-item-1', type: 'expense', amount: 999, date: today, time: '',
    catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '蓝牙音箱', tagIds: [], source: 'manual'
  });
  db = S.getDB();
  const autoItem = db.items.find(function (i) { return i.name === '蓝牙音箱'; });
  assert(autoItem, '前置失败：手机数码账单应自动同步词条');
  await S.unlinkBillSync('b-item-1', true);
  db = S.getDB();
  assert(db.items.some(function (i) { return i.name === '蓝牙音箱'; }), 'P1：解除关联（keepRec）不得删除物品词条');
  const it1 = db.items.find(function (i) { return i.name === '蓝牙音箱'; });
  assert(!it1.fromBill, '解除后物品 fromBill 应摘除');
  await S.saveBill({
    id: 'b-item-1', type: 'expense', amount: 1099, date: today, time: '',
    catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '蓝牙音箱', tagIds: [], source: 'manual'
  });
  db = S.getDB();
  assert(db.items.filter(function (i) { return i.name === '蓝牙音箱'; }).length === 1, '解除后编辑账单不得复活/重建词条');
  assert(!db.wallet.bills.find(function (b) { return b.id === 'b-item-1'; }).itemId, '解除后编辑账单不得重新挂回关联');
  // 默认（无 keepRec）= 既有语义：自动生成且无其他关联的词条随同步删除（v113 口径不破坏）
  await S.saveBill({
    id: 'b-item-2', type: 'expense', amount: 66, date: today, time: '',
    catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '有线耳机', tagIds: [], source: 'manual'
  });
  db = S.getDB();
  assert(db.items.some(function (i) { return i.name === '有线耳机'; }), '前置失败：应自动生成词条');
  await S.unlinkBillSync('b-item-2');
  db = S.getDB();
  assert(!db.items.some(function (i) { return i.name === '有线耳机'; }), '默认 unlinkBillSync 语义（删自动生成词条）不得改变');
  console.log('PASS ' + cur);

  // ---- 1c A6 UI 入口（账单弹窗「解除关联」）也走 keepRec ----
  cur = '3. A6 账单弹窗解除关联入口保留词条';
  await S.saveBill({
    id: 'b-food-ui', type: 'expense', amount: 30, date: today, time: '',
    catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '工作餐', tagIds: [], source: 'manual'
  });
  db = S.getDB();
  const billUI = db.wallet.bills.find(function (b) { return b.id === 'b-food-ui'; });
  w1.WalletView.openBillForm(billUI);
  let modal = await waitFor(function () {
    const m = lastModal(doc1);
    return m && m.querySelector('#yw-unlink') ? m : null;
  }, { label: '账单弹窗未出现' });
  modal.querySelector('#yw-unlink').click();
  modal = await waitFor(function () {
    const m = lastModal(doc1);
    return m && m.querySelector('[data-act=yes]') ? m : null;
  }, { label: '解除关联确认框未出现' });
  assert(modal.textContent.indexOf('解除后词条将保留，不再与账单同步') >= 0,
    '解除关联确认文案应为「解除后词条将保留，不再与账单同步」: ' + modal.textContent);
  modal.querySelector('[data-act=yes]').click();
  await waitFor(function () {
    const d = S.getDB();
    return !d.wallet.bills.find(function (b) { return b.id === 'b-food-ui'; }).foodId;
  }, { label: '解除关联未生效' });
  db = S.getDB();
  assert(db.food.some(function (f) { return f.name === '工作餐'; }),
    'P1：UI 解除关联入口删掉了词条（文案承诺保留）');
  console.log('PASS ' + cur);

  // ---- 2 A7 美食价格/名称口径 ----
  cur = '4. A7 美食价默认跟随账单、priceManual 保留、名称跟随备注';
  await S.saveBill({
    id: 'b-food-3', type: 'expense', amount: 50, date: today, time: '',
    catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '晚饭', tagIds: [], source: 'manual'
  });
  db = S.getDB();
  let food3 = db.food.find(function (f) { return f.name === '晚饭'; });
  assert(food3 && Math.round(Number(food3.price)) === 50, '前置：自动生成美食价格=账单金额');
  // 编辑账单（金额变）→ 价格默认跟随合计
  await S.saveBill({
    id: 'b-food-3', type: 'expense', amount: 80, date: today, time: '',
    catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '晚饭', tagIds: [], source: 'manual'
  });
  db = S.getDB();
  food3 = db.food.find(function (f) { return f.id === food3.id; });
  assert(Math.round(Number(food3.price)) === 80, 'A7：默认价格应=关联账单合计: ' + food3.price);
  // 编辑账单（备注变）→ 名称跟随（与物品侧同口径）
  await S.saveBill({
    id: 'b-food-3', type: 'expense', amount: 90, date: today, time: '',
    catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '公司晚饭', tagIds: [], source: 'manual'
  });
  db = S.getDB();
  food3 = db.food.find(function (f) { return f.id === food3.id; });
  assert(food3.name === '公司晚饭', 'A7：账单备注变更美食名称应跟随: ' + food3.name);
  assert(Math.round(Number(food3.price)) === 90, 'A7：名称跟随后价格仍应跟随合计: ' + food3.price);
  // 用户在美食编辑器改价格 → priceManual，此后账单不得静默改写
  w1.FoodView.openFoodEditor(today, food3);
  modal = await waitFor(function () {
    const m = lastModal(doc1);
    return m && m.querySelector('[name=price]') ? m : null;
  }, { label: '美食编辑弹窗未出现' });
  modal.querySelector('[name=foodCuisine]').value = '中餐';
  modal.querySelector('[name=price]').value = '33';
  modal.querySelector('[data-x=s]').click();
  await waitFor(function () {
    const f = S.getDB().food.find(function (x) { return x.id === food3.id; });
    return f && f.priceManual ? f : null;
  }, { label: '用户改价后 priceManual 未落库' });
  db = S.getDB();
  food3 = db.food.find(function (f) { return f.id === food3.id; });
  assert(Number(food3.price) === 33, '编辑器改价应落库: ' + food3.price);
  await S.saveBill({
    id: 'b-food-3', type: 'expense', amount: 100, date: today, time: '',
    catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '公司晚饭', tagIds: [], source: 'manual'
  });
  db = S.getDB();
  food3 = db.food.find(function (f) { return f.id === food3.id; });
  assert(Number(food3.price) === 33, 'A7：priceManual 后账单不得静默改写价格: ' + food3.price);
  assert(food3.name === '公司晚饭', 'A7：名称仍应跟随账单备注');
  console.log('PASS ' + cur);

  /* ==================== 3 A8 化妆品使用次数 0 档 ==================== */
  cur = '5. A8 妆品次数 0 档：显示/步进/落库一致';
  const w2 = makeWindow({
    data: {
      items: [
        { id: 'l1', kind: 'life', categoryId: 'skin', subCategoryId: 'skin_other', name: '口红', purchaseDate: '2025-02-01', purchasePrice: 80, status: 'in_use', images: [], tags: [], useCount: 0 },
        { id: 'c1', kind: 'clothing', categoryId: 'top', subCategoryId: 'top_tee', name: 'T恤', purchaseDate: '2025-03-01', purchasePrice: 100, status: 'in_use', images: [], tags: [] }
      ]
    }
  });
  if (!(await waitMain(w2))) throw new Error('no main');
  const doc2 = w2.document;
  w2.Views.openOutfitEditor('2026-01-10');
  let modal2 = await waitFor(function () {
    const m = doc2.querySelector('.modal');
    return m && m.querySelectorAll('#cos-picker .pick-card').length ? m : null;
  }, { label: '打卡弹窗未出现' });
  modal2.querySelectorAll('#cos-picker .pick-card')[0].click();
  let qtyRow = await waitFor(function () {
    return modal2.querySelector('.cos-qty-row');
  }, { label: '次数步进未出现' });
  assert(qtyRow.textContent.indexOf('1 次') >= 0, '勾选后默认应显示 1 次');
  modal2.querySelector('[data-q-dec]').click();
  qtyRow = await waitFor(function () {
    const r = modal2.querySelector('.cos-qty-row');
    return r && r.textContent.indexOf('0 次') >= 0 ? r : null;
  }, { label: '减到 0 未生效（0 档被钳回 1）' });
  assert(qtyRow.textContent.indexOf('不计') >= 0, '0 档应显示「不计」文案');
  modal2.querySelector('[data-q-inc]').click();
  qtyRow = await waitFor(function () {
    const r = modal2.querySelector('.cos-qty-row');
    return r && r.textContent.indexOf('1 次') >= 0 ? r : null;
  }, { label: '0 → +1 应到 1' });
  assert(qtyRow.textContent.indexOf('2 次') < 0, 'A8：0 → +1 不得跳到 2');
  modal2.querySelector('[data-q-dec]').click();
  qtyRow = await waitFor(function () {
    const r = modal2.querySelector('.cos-qty-row');
    return r && r.textContent.indexOf('0 次') >= 0 ? r : null;
  }, { label: '再次减到 0 未生效' });
  modal2.querySelector('[data-act=save]').click();
  const outfit2 = await waitFor(function () {
    return w2.Storage.getDB().outfits.find(function (x) { return x.date === '2026-01-10'; });
  }, { label: '打卡未保存' });
  assert((outfit2.cosmeticQty || {}).l1 === 0,
    'A8：显示 0 档时落库也应为 0: ' + JSON.stringify(outfit2.cosmeticQty));
  assert(Number(w2.Storage.getDB().items.find(function (i) { return i.id === 'l1'; }).useCount || 0) === 0,
    '0 档不得记使用次数');
  await waitFor(function () { return !doc2.body.contains(modal2); }, { label: '打卡弹窗未关闭' });
  w2.Views.openOutfitEditor('2026-01-10', outfit2);
  modal2 = await waitFor(function () {
    const m = doc2.querySelector('.modal');
    return m && m.querySelector('.cos-qty-row') && m.querySelector('.cos-qty-row').textContent.indexOf('0 次') >= 0 ? m : null;
  }, { label: '编辑态应显示 0 档' });
  assert(modal2.querySelector('.cos-qty-row').textContent.indexOf('不计') >= 0, '编辑态 0 档应显示「不计」');
  console.log('PASS ' + cur);

  /* ==================== 4 A12 统计拖动排序 ==================== */
  cur = '6. A12 拖动排序：未移动不弹保存、向下拖生效';
  let settingsSnap = null;
  let settingsSaveCount = 0;
  const w5 = makeWindow({
    routes: {
      'api/save': ({ body, ok }) => {
        if (body && body.target === 'settings') {
          settingsSnap = JSON.parse(JSON.stringify(body.data.settings));
          settingsSaveCount++;
        }
        return ok({ ok: true });
      }
    }
  });
  if (!(await waitMain(w5))) throw new Error('no main');
  const doc5 = w5.document;
  w5.App.go('plan');
  await waitFor(function () { return doc5.getElementById('btn-edit-sections'); }, { label: '统计页未渲染' });
  doc5.getElementById('btn-edit-sections').click();
  await waitFor(function () {
    return doc5.querySelector('.plan-sec[data-id=monthly][draggable]');
  }, { label: '编辑模式未渲染可拖动栏目' });
  const monthly = doc5.querySelector('.plan-sec[data-id=monthly]');
  const catRank = doc5.querySelector('.plan-sec[data-id=catRank]');
  assert(monthly && catRank, '前置失败：monthly/catRank 栏目不存在');
  const head = monthly.querySelector('.panel-head');

  function fire(el, type, opts) {
    const e = new w5.MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: 10, clientY: 0 }, opts || {}));
    el.dispatchEvent(e);
  }
  // （a）按下→原地抬起：顺序未变 → 不保存、不弹「顺序已保存」
  fire(head, 'pointerdown');
  fire(monthly, 'pointerup');
  await sleep(60);
  assert(settingsSaveCount === 0, 'A12：未移动不得保存顺序');
  const toasts = Array.prototype.map.call(doc5.querySelectorAll('.toast'), function (t) { return t.textContent; }).join('|');
  assert(toasts.indexOf('顺序已保存') < 0, 'A12：未移动不得弹「顺序已保存」假反馈');
  // （b）向下拖（占位落到 catRank 之后）→ 保存且顺序真实变化
  doc5.elementFromPoint = function () { return catRank; };
  fire(head, 'pointerdown');
  fire(monthly, 'pointermove', { clientY: 10 });
  fire(monthly, 'pointerup');
  await waitFor(function () {
    return settingsSnap && settingsSaveCount > 0;
  }, { label: '拖动后未保存顺序' });
  await waitFor(function () {
    return Array.prototype.some.call(doc5.querySelectorAll('.toast'), function (t) {
      return t.textContent.indexOf('顺序已保存') >= 0;
    });
  }, { label: '真实移动后应提示顺序已保存' });
  const order = settingsSnap.planSections.filter(function (s) {
    return s.id === 'monthly' || s.id === 'catRank';
  }).map(function (s) { return s.id; });
  assert(order.join(',') === 'catRank,monthly',
    'A12：向下拖无效——顺序未变化: ' + order.join(','));
  console.log('PASS ' + cur);

  /* ==================== 5 A11 生活子分类精确筛选 ==================== */
  cur = '7. A11 子分类筛选精确匹配（不列同父类全部）';
  const w4 = makeWindow({
    data: {
      items: [
        { id: 'i1', kind: 'life', categoryId: 'skin', subCategoryId: 'skin_a', name: '面霜A', purchaseDate: '2025-01-01', purchasePrice: 10, status: 'in_use', images: [], tags: [] },
        { id: 'i2', kind: 'life', categoryId: 'skin', subCategoryId: 'skin_b', name: '面霜B', purchaseDate: '2025-01-01', purchasePrice: 20, status: 'in_use', images: [], tags: [] }
      ],
      categories: {
        life: [{ id: 'skin', name: '护肤', icon: 'heart', children: [{ id: 'skin_a', name: '面霜' }, { id: 'skin_b', name: '其他' }] }]
      }
    }
  });
  if (!(await waitMain(w4))) throw new Error('no main');
  const doc4 = w4.document;
  w4.App.go('life');
  await waitFor(function () { return doc4.getElementById('life-cat'); }, { label: '生活页未渲染' });
  assert(doc4.querySelectorAll('.item-card').length === 2, '前置失败：应有 2 件生活物品');
  const sel4 = doc4.getElementById('life-cat');
  sel4.value = 'skin_a';
  sel4.dispatchEvent(new w4.Event('change'));
  await waitFor(function () {
    return doc4.querySelectorAll('.item-card').length === 1;
  }, { label: '子分类筛选结果数不对（同父类全列出）' });
  const cards4 = doc4.querySelectorAll('.item-card');
  assert(cards4.length === 1, 'A11：选子分类不得列出同父类全部物品');
  assert(cards4[0].getAttribute('data-id') === 'i1', 'A11：应只显示命中的子分类物品');
  console.log('PASS ' + cur);

  /* ==================== 6 A9 天气推荐文案 ==================== */
  cur = '8. A9 手动切「今日」标题/按钮不得变「明日」';
  const w3 = makeWindow({
    data: {
      outfits: [{ id: 'of-today', date: (function () { const d = new Date(); return w3Date(d); })(), itemIds: [], cosmeticIds: [], images: [] }]
    }
  });
  function w3Date(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  if (!(await waitMain(w3))) throw new Error('no main');
  w3.Weather.dayRange = async function () { return { min: 10, max: 20, desc: '晴', icon: 'sun', source: 'manual', fetchedAt: 'x' }; };
  w3.Weather.recommend = function () {
    return { outfits: [{ id: 'of-today', date: w3.Utils.todayStr(), occasion: '通勤', itemIds: [], images: [] }], combos: [], season: '秋' };
  };
  const card = w3.document.createElement('div');
  w3.document.body.appendChild(card);
  // 当天已打卡（auto.doneToday=true）→ 手动强制「今日」仍须显示今日
  // v1.2.01 形态映射：标题固定「穿搭推荐」（拍板删日期前缀），今日/明日语义走 seg 选中态+应用按钮
  card.setAttribute('data-force-target', 'today');
  await w3.Views.renderOutfitRec(card);
  let text = card.textContent;
  const titleEl = card.querySelector('.card-title');
  assert(titleEl && titleEl.textContent === '穿搭推荐', 'A9：标题应为「穿搭推荐」: ' + (titleEl ? titleEl.textContent : '(无)'));
  const segToday = card.querySelector('[data-force-t="today"]');
  const segTmr = card.querySelector('[data-force-t="tomorrow"]');
  assert(segToday && segToday.classList.contains('on'), 'A9：强制今日应选中「今日」');
  assert(segTmr && !segTmr.classList.contains('on'), 'A9：强制今日不得选中「明日」');
  // 应用按钮语义映射（图标钮形态）：title「套用到今日」/「套用到明日」
  const useTodayTip = card.querySelector('[data-use-outfit],[data-use-combo]');
  assert(useTodayTip && /套用到今日/.test(useTodayTip.getAttribute('title') || ''), 'A9：应用按钮应为套用到今日');
  assert(!/套用到明日/.test(card.textContent) && !Array.from(card.querySelectorAll('[data-use-outfit],[data-use-combo]')).some(function (b) {
    return /套用到明日/.test(b.getAttribute('title') || '');
  }), 'A9：强制今日不得出现套用到明日');
  card.setAttribute('data-force-target', 'tomorrow');
  await w3.Views.renderOutfitRec(card);
  text = card.textContent;
  assert(card.querySelector('[data-force-t="tomorrow"]').classList.contains('on'), 'A9：强制明日应选中「明日」');
  assert(!card.querySelector('[data-force-t="today"]').classList.contains('on'), 'A9：强制明日不得选中「今日」');
  const useTmrTip = card.querySelector('[data-use-outfit],[data-use-combo]');
  assert(useTmrTip && /套用到明日/.test(useTmrTip.getAttribute('title') || ''), 'A9：强制明日应用按钮应为套用到明日');
  console.log('PASS ' + cur);

  /* ==================== 7-8 A13 / A14 下钻周期 + 资产净变动 ==================== */
  cur = '9. A13 下钻带周期（周）+ 来源条可关闭/清除';
  const dateOld = (function () {
    const d = new Date(); d.setDate(d.getDate() - 40);
    return w3Date(d);
  })();
  const w6 = makeWindow({
    data: {
      wallet: {
        accounts: [{ id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 1000, note: '' }],
        bills: [
          { id: 'bl-today', type: 'expense', amount: 23.5, date: w3Date(new Date()), time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '午饭', tagIds: [], source: 'manual' },
          { id: 'bl-old', type: 'expense', amount: 66, date: dateOld, time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '旧午饭', tagIds: [], source: 'manual' },
          { id: 'bl-inc', type: 'income', amount: 100, date: w3Date(new Date()), time: '', catId: 'w_in_wages', subCatId: '', accountId: 'ac_cash', note: '工资', tagIds: [], source: 'manual' }
        ]
      }
    }
  });
  if (!(await waitMain(w6))) throw new Error('no main');
  const doc6 = w6.document;
  w6.WalletView.jumpTo({ catId: 'w_food_lunch', range: 'week' });
  await waitFor(function () {
    return doc6.getElementById('wallet-body') && doc6.querySelector('.drill-src');
  }, { label: '下钻来源条未出现' });
  let body6 = doc6.getElementById('wallet-body');
  assert(body6.textContent.indexOf('来自统计：本周') >= 0, 'A13：来源条应显示「来自统计：本周」: ' + body6.textContent.slice(0, 120));
  assert(body6.textContent.indexOf('食品餐饮 · 午餐') >= 0, 'A13：来源条应带分类名');
  assert(body6.textContent.indexOf('本周支出') >= 0, 'A13：周下钻后汇总标签应为「本周」，周期丢失');
  let rows6 = body6.querySelectorAll('[data-bill]');
  assert(rows6.length === 1 && body6.textContent.indexOf('旧午饭') < 0,
    'A13：周下钻应只显示本周账单，实为 ' + rows6.length + ' 行');
  doc6.querySelector('#f-close-drill').click();
  await waitFor(function () { return !doc6.querySelector('.drill-src'); }, { label: '来源条未关闭' });
  // 重新下钻后点「清除筛选」→ 来源条与下钻筛选一起清掉
  w6.WalletView.jumpTo({ catId: 'w_food_lunch', range: 'week' });
  await waitFor(function () { return doc6.querySelector('.drill-src'); }, { label: '来源条未再出现' });
  doc6.querySelector('#f-clear-drill').click();
  await waitFor(function () { return !doc6.querySelector('.drill-src'); }, { label: '清除筛选后来源条未消失' });
  body6 = doc6.getElementById('wallet-body');
  assert(body6.textContent.indexOf('来自统计') < 0, 'A13：清除筛选后来源条应消失');
  assert(body6.textContent.indexOf('工资') >= 0, 'A13：清除筛选后应恢复默认范围显示');
  console.log('PASS ' + cur);

  cur = '10. A14 本月净变动只计区分账户账单';
  w6.App.go('plan');
  const wAssets = await waitFor(function () {
    const el = doc6.querySelector('[data-body=wAssets]');
    return el && el.innerHTML.length > 50 ? el : null;
  }, { label: '资产走势栏目未渲染' });
  const atext = wAssets.textContent;
  assert(atext.indexOf('仅统计区分账户账单') < 0, 'A14：口径备注已按拍板删除（数值断言锁语义）');
  assert(atext.indexOf('+¥100') >= 0, 'A14：净变动应只计区分账户账单（+¥100）: ' + atext.slice(0, 200));
  assert(atext.indexOf('+¥76.5') < 0, 'A14：不区分账户账单不得计入净变动');
  console.log('PASS ' + cur);

  /* ==================== 9 A3 账号切换重置模块状态 ==================== */
  cur = '11. A3 账号切换重置筛选/搜索/统计周期';
  let accounts = [{ id: 'me', name: 'Me', icon: 'x' }, { id: 'b2', name: 'Other', icon: 'y' }, { id: 'b3', name: 'Third', icon: 'z' }];
  const w7 = makeWindow({
    data: {
      items: [
        { id: 'i1', kind: 'life', categoryId: 'skin', subCategoryId: 'skin_a', name: '面霜A', purchaseDate: '2025-01-01', purchasePrice: 10, status: 'in_use', images: [], tags: [] }
      ],
      categories: {
        life: [{ id: 'skin', name: '护肤', icon: 'heart', children: [{ id: 'skin_a', name: '面霜' }, { id: 'skin_b', name: '其他' }] }]
      },
      wallet: {
        accounts: [{ id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 100, note: '' }],
        bills: [{ id: 'bl-1', type: 'expense', amount: 12, date: w3Date(new Date()), time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '午饭', tagIds: [], source: 'manual' }]
      }
    },
    routes: {
      'api/session': ({ ok }) => ok({ ok: true, accounts: accounts, lastAccountId: 'me', dataRoot: 'm', schemaVersion: 3 }),
      'api/account': ({ body, ok }) => {
        if (body && body.action === 'delete') accounts = accounts.filter(function (a) { return a.id !== body.id; });
        return ok({ ok: true, accounts: accounts });
      },
      'api/db': ({ ok }) => ok({
        schemaVersion: 3,
        account: accounts.find(function (a) { return a.id === 'me'; }) || accounts[0],
        accounts: accounts.slice(),
        items: [
          { id: 'i1', kind: 'life', categoryId: 'skin', subCategoryId: 'skin_a', name: '面霜A', purchaseDate: '2025-01-01', purchasePrice: 10, status: 'in_use', images: [], tags: [] }
        ],
        outfits: [], food: [], events: [],
        settings: { idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} }, planSections: [], rememberAccount: true },
        categories: {
          digital: [], clothing: [], life: [{ id: 'skin', name: '护肤', icon: 'heart', children: [{ id: 'skin_a', name: '面霜' }, { id: 'skin_b', name: '其他' }] }],
          foodCuisine: [], foodType: [], meal: [], foodTag: [], occasion: [], season: [],
          tagPresets: [], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
        },
        wallet: {
          bills: [{ id: 'bl-1', type: 'expense', amount: 12, date: w3Date(new Date()), time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '午饭', tagIds: [], source: 'manual' }],
          accounts: [{ id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 100, note: '' }],
          cats: {
            expense: [{ id: 'w_food', name: '食品餐饮', icon: 'x', children: [{ id: 'w_food_lunch', name: '午餐', icon: 'x' }] }],
            income: []
          },
          catsVersion: 2, tags: [], imports: [], balances: [], templates: [],
          syncMap: {}
        },
        dataRoot: 'm'
      })
    }
  });
  if (!(await waitMain(w7))) throw new Error('no main');
  const doc7 = w7.document;
  // 制造残留状态：钱包搜索 + 生活子分类筛选 + 统计周期=年
  w7.App.go('wallet');
  await waitFor(function () { return doc7.getElementById('f-q'); }, { label: '流水页未渲染' });
  const qInput = doc7.getElementById('f-q');
  qInput.value = '午饭';
  qInput.dispatchEvent(new w7.Event('input'));
  await waitFor(function () {
    const el = doc7.getElementById('f-q');
    return el && el !== qInput && el.value === '午饭' ? el : null;
  }, { label: '搜索词未生效（防抖重渲染后）' });
  w7.App.go('life');
  await waitFor(function () { return doc7.getElementById('life-cat'); }, { label: '生活页未渲染' });
  const lifeSel = doc7.getElementById('life-cat');
  lifeSel.value = 'skin_a';
  lifeSel.dispatchEvent(new w7.Event('change'));
  await waitFor(function () {
    const el = doc7.getElementById('life-cat');
    return el && el !== lifeSel && el.value === 'skin_a' ? el : null;
  }, { label: '生活筛选未生效' });
  w7.App.go('plan');
  await waitFor(function () { return doc7.querySelector('[data-sr=year]'); }, { label: '统计页未渲染' });
  doc7.querySelector('[data-sr=year]').click();
  await waitFor(function () {
    return doc7.querySelector('[data-sr=year]') && doc7.querySelector('[data-sr=year]').classList.contains('on');
  }, { label: '统计周期切年未生效' });
  // 切账号 → 统一重置
  await w7.Storage.selectAccount('me');
  w7.App.go('wallet');
  await waitFor(function () { return doc7.getElementById('f-q'); }, { label: '切换后流水页未渲染' });
  assert(doc7.getElementById('f-q').value === '', 'A3：账号切换后搜索词应清空');
  w7.App.go('life');
  await waitFor(function () { return doc7.getElementById('life-cat'); }, { label: '切换后生活页未渲染' });
  assert(doc7.getElementById('life-cat').value === '', 'A3：账号切换后子分类筛选应清空');
  w7.App.go('plan');
  await waitFor(function () { return doc7.querySelector('[data-sr=month]'); }, { label: '切换后统计页未渲染' });
  assert(doc7.querySelector('[data-sr=month]').classList.contains('on') &&
    !doc7.querySelector('[data-sr=year]').classList.contains('on'),
    'A3：账号切换后统计周期应回默认「月」');
  console.log('PASS ' + cur);

  /* ==================== 10 A1 删除当前账号停会话 ==================== */
  cur = '12. A1 删除当前账号：文案标明+停会话回启动页';
  w7.App.go('settings');
  let root7 = await waitFor(function () {
    const mc = doc7.getElementById('main-content');
    return mc && mc.querySelector('[data-del-acc="b2"]') ? mc : null;
  }, { label: '设置页未渲染' });
  // 先删其他账号：确认文案不提「当前登录账号」，删完留在主界面
  root7.querySelector('[data-del-acc="b2"]').click();
  let modal7 = await waitFor(function () {
    const m = lastModal(doc7);
    return m && m.querySelector('[data-act=yes]') ? m : null;
  }, { label: '删除其他账号确认框未出现' });
  assert(modal7.textContent.indexOf('将删除当前登录账号') < 0,
    'A1：删除其他账号不应显示「当前登录账号」文案: ' + modal7.textContent);
  modal7.querySelector('[data-act=yes]').click();
  await waitFor(function () {
    return doc7.getElementById('main-content') && !doc7.querySelector('.acc-card') &&
      doc7.getElementById('main-content').querySelector('[data-del-acc="me"]');
  }, { label: '删除其他账号后应留在主界面' });
  // 再删当前登录账号：文案写明「将删除当前登录账号」，删完停会话回启动页
  root7 = doc7.getElementById('main-content');
  root7.querySelector('[data-del-acc="me"]').click();
  modal7 = await waitFor(function () {
    const m = lastModal(doc7);
    return m && m.querySelector('[data-act=yes]') ? m : null;
  }, { label: '删除账号确认框未出现' });
  assert(modal7.textContent.indexOf('将删除当前登录账号') >= 0,
    'A1：删除当前账号的确认文案须写明「将删除当前登录账号」: ' + modal7.textContent);
  modal7.querySelector('[data-act=yes]').click();
  await waitFor(function () {
    return doc7.querySelector('.acc-card') && !w7.Storage.getDB();
  }, { label: '删除当前账号后应回到账号选择屏并停止会话' });
  assert(w7.Storage.getDB() === null, 'A1：删除当前账号后内存 db 必须清空（停止会话，防已删目录复活）');
  assert(doc7.querySelector('[data-acc]'), 'A1：应回到账号选择屏');
  console.log('PASS ' + cur);

  console.log('========== v1.1.4 UX A 级修复回归锁：12 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
