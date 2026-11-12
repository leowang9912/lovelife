/* v121-food-sync.test.js — 美食打卡「账单同步」链路对齐物品侧（回归锁）：
   1) addBillFromFood：字段口径（expense/金额/日期/名称/accountId:''/foodId/source:'manual'）
      + 双向关联 + 餐别→分类映射（复用 MEAL_BY_CAT 反向：早餐/午餐/晚餐/加餐；无餐别/夜宵→w_food_other）
   2) 防重复：已有 expense 且非 syncOff 的关联账单则返回既有账单，不重复生成
   3) 新建勾选「同时记一笔账」（默认勾选）→ 钱袋有账单 + 今日概览今日支出/记账笔数计入
   4) 新建不勾选 → 无账单；空价格/金额 0 不显示勾选
   5) 编辑已有：无关联「生成消费账单」（先保存再生成）；已有关联「已关联账单」+「解除关联」
      （unlinkBillSync keepRec：美食保留、账单 syncOff、foodId 解绑）
   6) 合并口径不双计：美食价格 + 账单 − 关联扣重（bill.foodId）= 单计
   7) 既定口径不破坏：正餐账单→美食自动同步、已关联美食编辑→账单跟（syncFoodToBills） */
'use strict';
const { makeWindow, waitFor, waitMain, lastModal, waitNoModal, assert } = require('./helpers/harness');

let cur = '';

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function toastTexts(doc) {
  return Array.prototype.map.call(doc.querySelectorAll('.toast'), function (t) { return t.textContent; }).join('|');
}

const CATS = {
  foodCuisine: ['中餐'], foodType: [], meal: ['早餐', '午餐', '晚餐', '加餐'], foodTag: []
};
const WCATS = {
  expense: [{
    id: 'w_food', name: '食品餐饮', icon: 'color_ic_parent_restaurant', children: [
      { id: 'w_food_breakfast', name: '早餐', icon: 'x' }, { id: 'w_food_lunch', name: '午餐', icon: 'x' },
      { id: 'w_food_dinner', name: '晚餐', icon: 'x' }, { id: 'w_food_treat', name: '请客吃饭', icon: 'x' },
      { id: 'w_food_other', name: '其他', icon: 'x' }
    ]
  }],
  income: []
};

function fillFoodForm(w, m, fields) {
  if (fields.foodCuisine !== undefined) m.querySelector('[name=foodCuisine]').value = fields.foodCuisine;
  if (fields.meal !== undefined) m.querySelector('[name=meal]').value = fields.meal;
  if (fields.name !== undefined) m.querySelector('[name=name]').value = fields.name;
  if (fields.date !== undefined) m.querySelector('[name=date]').value = fields.date;
  if (fields.price !== undefined) {
    const el = m.querySelector('[name=price]');
    el.value = fields.price;
    el.dispatchEvent(new w.Event('input')); // 驱动「同时记一笔账」勾选显隐
  }
}

function homeMiniVal(doc, label) {
  const nodes = Array.prototype.slice.call(doc.querySelectorAll('.home-mini'));
  for (let i = 0; i < nodes.length; i++) {
    const lab = nodes[i].querySelector('.yw-bal-label');
    if (lab && lab.textContent.trim() === label) {
      const v = nodes[i].querySelector('.home-mini-val');
      return v ? v.textContent.trim() : '';
    }
  }
  return null;
}

/* 关掉最上层弹窗（×按钮不走 formGuard），等它真正离开 DOM */
async function closeTop(doc) {
  const t = lastModal(doc);
  if (!t) return;
  const x = t.querySelector('.modal-close');
  if (x) x.click();
  await waitFor(function () { return !doc.body.contains(t); }, { label: '弹窗关闭' });
}

async function main() {
  const today = ymd(new Date());

  /* ============================================================
     1) addBillFromFood 字段口径 + 餐别→分类映射 + 双向关联
     ============================================================ */
  cur = '1. addBillFromFood：字段口径 + 餐别映射 + 双向关联';
  {
    const w = makeWindow({
      data: {
        categories: CATS,
        food: [
          { id: 'fd-lunch', date: today, meal: '午餐', foodCuisine: '中餐', name: '鸡腿饭', price: 25, note: '', tags: [], images: [] },
          { id: 'fd-treat', date: today, meal: '加餐', foodCuisine: '中餐', name: '下午茶', price: 18, note: '', tags: [], images: [] },
          { id: 'fd-night', date: today, meal: '夜宵', foodCuisine: '中餐', name: '烧烤', price: 60, note: '', tags: [], images: [] },
          { id: 'fd-nomeal', date: today, meal: '', foodCuisine: '中餐', name: '随便吃', price: 10, note: '', tags: [], images: [] }
        ],
        wallet: { cats: WCATS, bills: [] }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    await S.loadAll();

    const f1 = JSON.parse(JSON.stringify(S.getDB().food.find(function (f) { return f.id === 'fd-lunch'; })));
    const b1 = await S.addBillFromFood(f1);
    let db = S.getDB();
    assert(b1.type === 'expense', '应生成消费账单: ' + b1.type);
    assert(Math.abs(Number(b1.amount)) === 25, '金额=美食价格: ' + b1.amount);
    assert(b1.date === today, '日期=美食日期: ' + b1.date);
    assert(b1.note === '鸡腿饭', '备注=菜名: ' + b1.note);
    assert(b1.accountId === '', '不区分账户（accountId 空、不动余额）: ' + b1.accountId);
    assert(b1.foodId === 'fd-lunch', 'foodId 双向关联: ' + b1.foodId);
    assert(b1.source === 'manual', 'source=manual: ' + b1.source);
    assert(b1.catId === 'w_food', '一级分类=食品餐饮: ' + b1.catId);
    assert(b1.subCatId === 'w_food_lunch', '午餐→w_food_lunch: ' + b1.subCatId);
    const rec1 = db.food.find(function (f) { return f.id === 'fd-lunch'; });
    assert((rec1.linkedBillIds || []).indexOf(b1.id) >= 0, '美食 linkedBillIds 应挂账单');
    assert(!rec1.fromBill, '手动美食不得被套上 fromBill 逻辑');
    assert(Number(rec1.price) === 25, '手动美食价格不被覆盖: ' + rec1.price);

    // 餐别映射（复用 MEAL_BY_CAT 反向）：加餐→w_food_treat（与 autoSyncFoodFromBill 同源往返一致）
    const b2 = await S.addBillFromFood(JSON.parse(JSON.stringify(S.getDB().food.find(function (f) { return f.id === 'fd-treat'; }))));
    assert(b2.subCatId === 'w_food_treat', '加餐→w_food_treat（复用 MEAL_BY_CAT 反向映射）: ' + b2.subCatId);
    const b3 = await S.addBillFromFood(JSON.parse(JSON.stringify(S.getDB().food.find(function (f) { return f.id === 'fd-night'; }))));
    assert(b3.subCatId === 'w_food_other', '夜宵（未映射餐别）→w_food_other: ' + b3.subCatId);
    const b4 = await S.addBillFromFood(JSON.parse(JSON.stringify(S.getDB().food.find(function (f) { return f.id === 'fd-nomeal'; }))));
    assert(b4.subCatId === 'w_food_other', '无餐别→w_food_other: ' + b4.subCatId);
    console.log('PASS ' + cur);
  }

  /* ============================================================
     2) 防重复：已有关联消费账单则返回既有
     ============================================================ */
  cur = '2. 防重复：已有 expense 关联账单返回既有，不重复生成';
  {
    const w = makeWindow({
      data: {
        categories: CATS,
        food: [{ id: 'fd-1', date: today, meal: '晚餐', foodCuisine: '中餐', name: '火锅', price: 120, note: '', tags: [], images: [] }],
        wallet: { cats: WCATS, bills: [] }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    await S.loadAll();
    const f = JSON.parse(JSON.stringify(S.getDB().food.find(function (x) { return x.id === 'fd-1'; })));
    const b1 = await S.addBillFromFood(f);
    const b2 = await S.addBillFromFood(f);
    assert(b1.id === b2.id, '第二次应返回既有账单: ' + b1.id + ' vs ' + b2.id);
    const bills = S.getDB().wallet.bills.filter(function (b) { return b.foodId === 'fd-1' && b.type === 'expense'; });
    assert(bills.length === 1, '不得重复生成，实为 ' + bills.length + ' 笔');
    // syncOff（解除过关联）不挡补记：可重新生成新账单
    await S.unlinkBillSync(b1.id, true);
    const b3 = await S.addBillFromFood(JSON.parse(JSON.stringify(S.getDB().food.find(function (x) { return x.id === 'fd-1'; }))));
    assert(b3.id !== b1.id, '解除关联后可重新生成新账单');
    assert(S.getDB().wallet.bills.filter(function (b) { return b.foodId === 'fd-1' && !b.syncOff && b.type === 'expense'; }).length === 1,
      '解除后重新生成应只有一笔有效关联账单');
    console.log('PASS ' + cur);
  }

  /* ============================================================
     3) 新建勾选 → 钱袋账单 + 今日概览计入
     ============================================================ */
  cur = '3. 新建勾选「同时记一笔账」→ 钱袋账单 + 今日概览支出/笔数计入';
  {
    const w = makeWindow({ data: { categories: CATS, wallet: { cats: WCATS, bills: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage, doc = w.document;
    await S.loadAll();
    w.FoodView.openFoodEditor(today, null);
    const m = await waitFor(function () {
      const mm = lastModal(doc);
      return mm && mm.querySelector('[name=price]') ? mm : null;
    }, { label: '美食打卡弹窗未出现' });
    fillFoodForm(w, m, { foodCuisine: '中餐', meal: '午餐', name: '盖浇饭', price: '25' });
    const syncBox = await waitFor(function () {
      return m.querySelector('#food-sync-bill') ? m.querySelector('#food-sync-bill') : null;
    }, { label: '填写价格后应出现「同时记一笔账」勾选' });
    assert(syncBox.checked, '勾选应默认勾上（对齐物品侧）');
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return S.getDB().food.some(function (f) { return f.name === '盖浇饭'; });
    }, { label: '美食未保存' });
    await waitNoModal(doc);
    assert(toastTexts(doc).indexOf('已记入钱袋（可在钱袋查看/修改）') >= 0,
      '勾选保存应提示已记入钱袋，实为: ' + toastTexts(doc));
    let db = S.getDB();
    const rec = db.food.find(function (f) { return f.name === '盖浇饭'; });
    const bill = db.wallet.bills.find(function (b) { return b.foodId === rec.id; });
    assert(bill, '勾选保存应生成关联账单');
    assert(Math.abs(Number(bill.amount)) === 25 && bill.date === today && bill.note === '盖浇饭',
      '账单金额/日期/名称互通: ' + JSON.stringify({ a: bill.amount, d: bill.date, n: bill.note }));
    assert((rec.linkedBillIds || []).indexOf(bill.id) >= 0, '美食 linkedBillIds 应挂账单');

    // 今日概览：todayBills 口径自动计入（生成账单后首页今日支出/记账笔数 +1）
    w.App.go('home');
    await waitFor(function () { return homeMiniVal(doc, '今日记账') !== null; }, { label: '今日概览未渲染' });
    assert(homeMiniVal(doc, '今日记账') === '1 笔', '今日概览记账笔数应为 1 笔，实为: ' + homeMiniVal(doc, '今日记账'));
    assert(homeMiniVal(doc, '今日支出') === '¥25', '今日概览支出应为 ¥25，实为: ' + homeMiniVal(doc, '今日支出'));
    console.log('PASS ' + cur);
  }

  /* ============================================================
     4) 不勾选 → 无账单；空价格/金额 0 不显示勾选
     ============================================================ */
  cur = '4. 不勾选→无账单；空价格/金额 0 不显示勾选';
  {
    const w = makeWindow({ data: { categories: CATS, wallet: { cats: WCATS, bills: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage, doc = w.document;
    await S.loadAll();
    w.FoodView.openFoodEditor(today, null);
    const m = await waitFor(function () {
      const mm = lastModal(doc);
      return mm && mm.querySelector('[name=price]') ? mm : null;
    }, { label: '美食打卡弹窗未出现' });
    // 空价格：不显示勾选
    assert(!m.querySelector('#food-sync-bill'), '空价格不应显示「同时记一笔账」勾选');
    fillFoodForm(w, m, { foodCuisine: '中餐', meal: '午餐', name: '白米饭', price: '0' });
    assert(!m.querySelector('#food-sync-bill'), '金额 0 不应显示「同时记一笔账」勾选');
    fillFoodForm(w, m, { price: '15' });
    await waitFor(function () { return m.querySelector('#food-sync-bill'); }, { label: '填正数价格应出现勾选' });
    m.querySelector('#food-sync-bill').checked = false; // 不勾选
    fillFoodForm(w, m, { name: '不记账午饭' });
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return S.getDB().food.some(function (f) { return f.name === '不记账午饭'; });
    }, { label: '美食未保存' });
    await waitNoModal(doc);
    assert(!S.getDB().wallet.bills.some(function (b) { return b.note === '不记账午饭'; }),
      '不勾选不得生成账单');
    assert(S.getDB().wallet.bills.length === 0, '不勾选账单数应为 0，实为 ' + S.getDB().wallet.bills.length);
    console.log('PASS ' + cur);
  }

  /* ============================================================
     5) 编辑已有：生成消费账单 / 已关联 + 解除关联（keepRec）
     ============================================================ */
  cur = '5. 编辑已有：生成消费账单（先保存）+ 已关联账单标签 + 解除关联 keepRec';
  {
    const w = makeWindow({
      data: {
        categories: CATS,
        food: [{ id: 'fd-edit', date: today, meal: '晚餐', foodCuisine: '中餐', name: '寿司', price: 88, note: '', tags: [], images: [] }],
        wallet: { cats: WCATS, bills: [] }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage, doc = w.document;
    await S.loadAll();
    const rec = JSON.parse(JSON.stringify(S.getDB().food.find(function (f) { return f.id === 'fd-edit'; })));
    w.FoodView.openFoodEditor(today, rec);
    let m = await waitFor(function () {
      const mm = lastModal(doc);
      return mm && mm.querySelector('#food-bill-sync') ? mm : null;
    }, { label: '美食编辑弹窗未出现' });
    // 无关联：应有「生成消费账单」按钮，且不显示新建勾选
    assert(!m.querySelector('#food-sync-bill'), '编辑已有不应显示新建「同时记一笔账」勾选');
    const genBtn = await waitFor(function () {
      return m.querySelector('#btn-gen-food-bill') ? m.querySelector('#btn-gen-food-bill') : null;
    }, { label: '无关联应显示「生成消费账单」按钮' });
    assert(m.textContent.indexOf('先保存美食当前内容') >= 0, '生成按钮应写明先保存当前内容');
    // 改名后再生成 → 先保存后生成（名称互通）
    m.querySelector('[name=name]').value = '三文鱼寿司';
    genBtn.click();
    await waitFor(function () {
      return S.getDB().wallet.bills.some(function (b) { return b.note === '三文鱼寿司'; });
    }, { label: '生成消费账单未落地' });
    assert(toastTexts(doc).indexOf('已记入钱袋（可在钱袋查看/修改）') >= 0,
      '生成后应提示已记入钱袋，实为: ' + toastTexts(doc));
    let db = S.getDB();
    const rec2 = db.food.find(function (f) { return f.id === 'fd-edit'; });
    assert(rec2.name === '三文鱼寿司', '生成前应先保存美食当前内容: ' + rec2.name);
    const bill = db.wallet.bills.find(function (b) { return b.foodId === 'fd-edit'; });
    assert(bill && bill.note === '三文鱼寿司' && Math.abs(Number(bill.amount)) === 88,
      '生成的账单应与美食互通: ' + JSON.stringify(bill && { n: bill.note, a: bill.amount }));

    // 已关联：「已关联账单」标签 + 「解除关联」
    m = await waitFor(function () {
      const mm = lastModal(doc);
      return mm && mm.querySelector('[data-bill-open]') ? mm : null;
    }, { label: '已关联后应显示「已关联账单」标签' });
    assert(m.querySelector('[data-bill-open]').textContent.indexOf('已关联账单') >= 0, '标签文案应为「已关联账单」');
    assert(m.querySelector('#btn-unlink-food-bill'), '应有「解除关联」按钮');
    // 点标签 → 跳钱袋流水（对齐 data-item-open 跳转写法）：定位流水 + 打开账单表单
    m.querySelector('[data-bill-open]').click();
    await waitFor(function () {
      const nav = doc.querySelector('[data-nav].active');
      return nav && nav.getAttribute('data-nav') === 'wallet' ? true : null;
    }, { label: '点已关联账单标签应跳转钱袋' });
    await waitFor(function () {
      const mm = lastModal(doc);
      return mm && mm.querySelector('#yw-amt') ? mm : null;
    }, { label: '点已关联账单标签应打开账单表单（查看/修改）' });
    // 收起账单表单与旧美食弹窗，重开已关联态做解除
    await closeTop(doc); // 账单表单
    await closeTop(doc); // 美食编辑弹窗

    // 解除关联 keepRec：美食保留、账单 syncOff、foodId 解绑
    w.FoodView.openFoodEditor(today, JSON.parse(JSON.stringify(S.getDB().food.find(function (f) { return f.id === 'fd-edit'; }))));
    m = await waitFor(function () {
      const mm = lastModal(doc);
      return mm && mm.querySelector('#btn-unlink-food-bill') ? mm : null;
    }, { label: '重开编辑弹窗（已关联态）' });
    m.querySelector('#btn-unlink-food-bill').click();
    const okBtn = await waitFor(function () {
      const dlg = lastModal(doc);
      return dlg && dlg.querySelector('[data-act=yes]') ? dlg.querySelector('[data-act=yes]') : null;
    }, { label: '解除关联确认框未出现' });
    okBtn.click();
    await waitFor(function () {
      return toastTexts(doc).indexOf('已解除关联') >= 0 ? true : null;
    }, { label: '解除关联未提示' });
    db = S.getDB();
    const rec3 = db.food.find(function (f) { return f.id === 'fd-edit'; });
    assert(rec3, 'keepRec 解除后美食应保留');
    assert((rec3.linkedBillIds || []).indexOf(bill.id) < 0, '解除后 linkedBillIds 应摘除账单');
    const billAfter = db.wallet.bills.find(function (b) { return b.id === bill.id; });
    assert(billAfter && billAfter.syncOff === true, '解除后账单应记 syncOff');
    assert(!billAfter.foodId, '解除后账单 foodId 应解绑');
    // 解除后编辑器应回到「生成消费账单」态
    await waitFor(function () {
      const mm = lastModal(doc);
      return mm && mm.querySelector('#btn-gen-food-bill') ? mm : null;
    }, { label: '解除后应回到生成按钮态' });
    console.log('PASS ' + cur);
  }

  /* ============================================================
     6) 合并口径不双计（美食价格+账单−关联扣重）
     ============================================================ */
  cur = '6. 合并口径不双计：bill.foodId 扣重后=单计';
  {
    const w = makeWindow({
      data: {
        categories: CATS,
        food: [{ id: 'fd-merge', date: today, meal: '午餐', foodCuisine: '中餐', name: '麻辣烫', price: 50, note: '', tags: [], images: [] }],
        wallet: { cats: WCATS, bills: [] }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage, M = w.Models;
    await S.loadAll();
    await S.addBillFromFood(JSON.parse(JSON.stringify(S.getDB().food.find(function (f) { return f.id === 'fd-merge'; }))));
    const sum = M.summary(S.getDB());
    const combined = sum.combinedMonthSpend;
    assert(Math.abs(combined - 50) < 0.001,
      '合并口径应扣重不双计（50+50−关联50=50），实为 ' + combined);
    assert(sum.wallet.monthLinkedExpense >= 50, '关联账单应进扣重口径: ' + sum.wallet.monthLinkedExpense);
    console.log('PASS ' + cur);
  }

  /* ============================================================
     7) 既定口径不破坏：正餐账单→美食自动同步 + 美食编辑→账单跟
     ============================================================ */
  cur = '7. 既定口径不破坏：autoSyncFoodFromBill / syncFoodToBills 照常';
  {
    const w = makeWindow({
      data: {
        categories: CATS,
        food: [{ id: 'fd-bi', date: today, meal: '午餐', foodCuisine: '中餐', name: '牛肉面', price: 30, note: '', tags: [], images: [] }],
        wallet: { cats: WCATS, bills: [] }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    await S.loadAll();
    // (a) 正餐账单 → 美食自动同步（不受 addBillFromFood 影响）
    await S.saveBill({
      id: 'bl-auto', type: 'expense', amount: 40, date: today, time: '',
      catId: 'w_food', subCatId: 'w_food_dinner', accountId: '', note: '自动生成晚饭', tagIds: [], source: 'manual'
    });
    let db = S.getDB();
    assert(db.food.some(function (f) { return f.name === '自动生成晚饭' && f.fromBill === 'bl-auto'; }),
      '正餐账单应仍自动同步美食');
    // (b) 美食打卡生成账单后，改美食价格/名称 → 账单跟随（syncFoodToBills）
    await S.addBillFromFood(JSON.parse(JSON.stringify(db.food.find(function (f) { return f.id === 'fd-bi'; }))));
    db = S.getDB();
    const genId = (db.wallet.bills.find(function (b) { return b.foodId === 'fd-bi'; }) || {}).id;
    assert(genId, '前置：fd-bi 应已生成账单');
    const edit = JSON.parse(JSON.stringify(db.food.find(function (f) { return f.id === 'fd-bi'; })));
    edit.name = '牛肉面改'; edit.price = 35;
    await S.saveFood(edit);
    db = S.getDB();
    const g = db.wallet.bills.find(function (b) { return b.id === genId; });
    assert(g.note === '牛肉面改', '已关联美食改名 → 账单应跟随: ' + g.note);
    assert(Math.abs(Number(g.amount)) === 35, '已关联美食改价（1:1）→ 账单应跟随: ' + g.amount);
    // (c) 改账单 → 美食跟随（不拆条）
    const g2 = JSON.parse(JSON.stringify(db.wallet.bills.find(function (b) { return b.id === genId; })));
    delete g2.foodId;
    g2.note = '牛肉面再改'; g2.amount = 36;
    await S.saveBill(g2);
    db = S.getDB();
    const f2 = db.food.find(function (f) { return f.id === 'fd-bi'; });
    assert(f2.name === '牛肉面再改', '改账单 → 美食应就地跟随: ' + f2.name);
    assert(db.food.filter(function (f) { return f.name === '牛肉面再改'; }).length === 1,
      '改账单不得拆出手动美食重复条目');
    console.log('PASS ' + cur);
  }

  console.log('========== v121 美食打卡账单同步（对齐物品侧）：7 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
