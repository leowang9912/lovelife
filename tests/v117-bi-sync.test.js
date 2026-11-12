/* v117-bi-sync.test.js — 词条 ↔ 账单 双向同步（v1.1.7）回归锁：
   反向同步（词条 → 账单）：
   1) 物品 1:1：名称/购入金额/购入日期全跟 → 账单备注/金额/日期；改金额同步调账（账户余额）
   2) 物品 N:1 合并词条：名称跟全部账单；金额/日期不回写（合计=账单合计、日期=最早，防破坏合并口径）
   3) 美食 1:1：名称/价格（priceManual 手改价也回写）/日期全跟 + 调账
   4) 美食 N:1：名称/日期跟全部（同日合并语义）；金额不回写（合计口径）
   5) 二手回血收入账单不被购入字段污染（只回写支出账单）
   6) unlinkBillSync（keepRec/默认）与 syncOff 后不再回写（删除/解除既有行为不动）
   7) 双向收敛/防环：账单改→词条跟→词条改→账单跟；重复保存幂等不累积（合计不膨胀）
   8) UI 链路：物品编辑器改名/改价保存 → 关联账单同步（用户报告场景复现）
   9) priceManual 单向保护兼容（A7）：账单编辑不改手改价；词条无关字段保存不反向覆盖账单金额 */
'use strict';
const { makeWindow, waitFor, waitMain, lastModal, assert } = require('./helpers/harness');

let cur = '';

async function main() {
  /* ==================== 1-2 物品 → 账单 ==================== */
  const w1 = makeWindow({
    data: {
      items: [
        { id: 'it1', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '旧手机',
          purchaseDate: '2025-06-01', purchasePrice: 3000, status: 'in_use', images: [], tags: [],
          linkedBillIds: ['bl-1'], fromBill: 'bl-1' },
        { id: 'it2', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '分期机',
          purchaseDate: '2025-06-01', purchasePrice: 100, status: 'in_use', images: [], tags: [],
          linkedBillIds: ['bl-a', 'bl-b'], fromBill: 'bl-a' }
      ],
      wallet: {
        accounts: [{ id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 1000, note: '' }],
        bills: [
          { id: 'bl-1', type: 'expense', amount: 3000, date: '2025-06-01', time: '',
            catId: 'w_shop', subCatId: 'w_shop_digital', accountId: 'ac_cash', note: '旧手机',
            tagIds: [], itemId: 'it1', source: 'manual' },
          { id: 'bl-a', type: 'expense', amount: 30, date: '2025-06-01', time: '',
            catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '分期机',
            tagIds: [], itemId: 'it2', source: 'manual' },
          { id: 'bl-b', type: 'expense', amount: 70, date: '2025-06-05', time: '',
            catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '分期机',
            tagIds: [], itemId: 'it2', source: 'manual' }
        ]
      }
    }
  });
  if (!(await waitMain(w1))) throw new Error('no main');
  const S1 = w1.Storage;
  await S1.loadAll();

  // ---- 1 物品 1:1：名称/金额/日期全跟 + 改金额同步调账 ----
  cur = '1. 物品→账单 1:1 名称/金额/日期全跟 + 调账';
  let db = S1.getDB();
  const it1 = JSON.parse(JSON.stringify(db.items.find(function (i) { return i.id === 'it1'; })));
  it1.name = '新手机Pro'; it1.purchasePrice = 3500; it1.purchaseDate = '2025-06-02';
  await S1.saveItem(it1);
  db = S1.getDB();
  let b1 = db.wallet.bills.find(function (b) { return b.id === 'bl-1'; });
  assert(b1.note === '新手机Pro', 'P1：物品改名账单备注应跟随: ' + b1.note);
  assert(Number(b1.amount) === 3500, 'P1：物品改购入金额账单金额应跟随: ' + b1.amount);
  assert(b1.date === '2025-06-02', 'P1：物品改购入日期账单日期应跟随: ' + b1.date);
  // 调账：1000 + 3000（回滚旧值）- 3500（套新值）= 500
  const bal1 = db.wallet.accounts.find(function (a) { return a.id === 'ac_cash'; });
  assert(Math.round(bal1.balance) === 500, 'P1：改金额应同步调账（回滚旧值套新值）: ' + bal1.balance);
  // 只改名称：金额/日期/余额不动
  const balBefore = bal1.balance;
  const it1b = JSON.parse(JSON.stringify(db.items.find(function (i) { return i.id === 'it1'; })));
  it1b.name = '再改名机';
  await S1.saveItem(it1b);
  db = S1.getDB();
  b1 = db.wallet.bills.find(function (b) { return b.id === 'bl-1'; });
  assert(b1.note === '再改名机' && Number(b1.amount) === 3500 && b1.date === '2025-06-02',
    'P1：只改名不得动金额/日期: ' + JSON.stringify(b1));
  assert(bal1.balance === balBefore, 'P1：只改名不得动余额');
  console.log('PASS ' + cur);

  // ---- 2 物品 N:1 合并：名称跟全部；金额/日期不回写（防破坏合计/最早口径）----
  cur = '2. 物品 N:1 名称全跟、金额/日期不回写';
  const it2 = JSON.parse(JSON.stringify(db.items.find(function (i) { return i.id === 'it2'; })));
  it2.name = '分期机改'; it2.purchasePrice = 150; it2.purchaseDate = '2025-06-03';
  await S1.saveItem(it2);
  db = S1.getDB();
  const ba = db.wallet.bills.find(function (b) { return b.id === 'bl-a'; });
  const bb = db.wallet.bills.find(function (b) { return b.id === 'bl-b'; });
  assert(ba.note === '分期机改' && bb.note === '分期机改', 'P1：合并词条改名应跟到全部关联账单: ' + ba.note + '/' + bb.note);
  assert(Number(ba.amount) === 30 && Number(bb.amount) === 70,
    'P1：N:1 金额不得回写（词条金额=账单合计，回写会把合计摊回每笔越滚越大）: ' + ba.amount + '/' + bb.amount);
  assert(ba.date === '2025-06-01' && bb.date === '2025-06-05',
    'P1：N:1 日期不得回写（合并词条日期=最早账单，不得压平分期真实日期）: ' + ba.date + '/' + bb.date);
  assert(Math.round(Number(db.items.find(function (i) { return i.id === 'it2'; }).purchasePrice)) === 150,
    '词条自身金额应保留用户改值');
  console.log('PASS ' + cur);

  /* ==================== 3-4 美食 → 账单 ==================== */
  const w2 = makeWindow({
    data: {
      food: [
        { id: 'fd1', date: '2026-01-02', meal: '午餐', foodCuisine: '其他', name: '午饭', price: 50,
          priceManual: true, note: '', tags: [], images: [], linkedBillIds: ['fl-1'], fromBill: 'fl-1' },
        { id: 'fd2', date: '2026-01-05', meal: '晚餐', foodCuisine: '其他', name: '聚餐', price: 50,
          note: '', tags: [], images: [], linkedBillIds: ['fl-a', 'fl-b'], fromBill: 'fl-a' }
      ],
      wallet: {
        accounts: [{ id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 1000, note: '' }],
        bills: [
          { id: 'fl-1', type: 'expense', amount: 50, date: '2026-01-02', time: '',
            catId: 'w_food', subCatId: 'w_food_lunch', accountId: 'ac_cash', note: '午饭',
            tagIds: [], foodId: 'fd1', source: 'manual' },
          { id: 'fl-a', type: 'expense', amount: 30, date: '2026-01-05', time: '',
            catId: 'w_food', subCatId: 'w_food_dinner', accountId: '', note: '聚餐',
            tagIds: [], foodId: 'fd2', source: 'manual' },
          { id: 'fl-b', type: 'expense', amount: 20, date: '2026-01-05', time: '',
            catId: 'w_food', subCatId: 'w_food_dinner', accountId: '', note: '聚餐',
            tagIds: [], foodId: 'fd2', source: 'manual' }
        ]
      }
    }
  });
  if (!(await waitMain(w2))) throw new Error('no main');
  const S2 = w2.Storage;
  await S2.loadAll();

  // ---- 3 美食 1:1：名称/价格（priceManual 手改价）/日期全跟 + 调账 ----
  cur = '3. 美食→账单 1:1 全跟（priceManual 手改价回写）+ 调账';
  db = S2.getDB();
  const fd1 = JSON.parse(JSON.stringify(db.food.find(function (f) { return f.id === 'fd1'; })));
  fd1.name = '商务午餐'; fd1.price = 66; fd1.date = '2026-01-03'; fd1.priceManual = true;
  await S2.saveFood(fd1);
  db = S2.getDB();
  let f1 = db.wallet.bills.find(function (b) { return b.id === 'fl-1'; });
  assert(f1.note === '商务午餐', 'P1：美食改名账单备注应跟随: ' + f1.note);
  assert(Number(f1.amount) === 66, 'P1：priceManual 手改价应按拍板回写账单金额: ' + f1.amount);
  assert(f1.date === '2026-01-03', 'P1：美食改期账单日期应跟随: ' + f1.date);
  // 调账：1000 + 50 - 66 = 984
  const bal2 = db.wallet.accounts.find(function (a) { return a.id === 'ac_cash'; });
  assert(Math.round(bal2.balance) === 984, 'P1：美食改价应同步调账: ' + bal2.balance);
  assert(Number(db.food.find(function (f) { return f.id === 'fd1'; }).price) === 66, '美食自身价格保留');
  console.log('PASS ' + cur);

  // ---- 4 美食 N:1：名称/日期跟全部；金额不回写 ----
  cur = '4. 美食 N:1 名称/日期全跟、金额不回写';
  const fd2 = JSON.parse(JSON.stringify(db.food.find(function (f) { return f.id === 'fd2'; })));
  fd2.name = '聚餐改'; fd2.price = 88; fd2.date = '2026-01-06';
  await S2.saveFood(fd2);
  db = S2.getDB();
  const fa = db.wallet.bills.find(function (b) { return b.id === 'fl-a'; });
  const fb = db.wallet.bills.find(function (b) { return b.id === 'fl-b'; });
  assert(fa.note === '聚餐改' && fb.note === '聚餐改', 'P1：合并美食改名应跟到全部账单');
  assert(Number(fa.amount) === 30 && Number(fb.amount) === 20,
    'P1：美食 N:1 金额不得回写（价格=账单合计口径）: ' + fa.amount + '/' + fb.amount);
  assert(fa.date === '2026-01-06' && fb.date === '2026-01-06',
    'P1：美食日期=这一顿的日期，改期整组账单跟随（同日合并语义）: ' + fa.date + '/' + fb.date);
  console.log('PASS ' + cur);

  /* ==================== 5 收入账单保护 ==================== */
  cur = '5. 二手回血收入账单不被购入字段污染';
  const w3 = makeWindow({
    data: {
      items: [
        { id: 'it3', kind: 'device', categoryId: 'host', subCategoryId: 'aud_headphone', name: '旧耳机',
          purchaseDate: '2025-01-01', purchasePrice: 800, status: 'sold', soldPrice: 300, soldDate: '2026-01-01',
          images: [], tags: [], linkedBillIds: ['bl-buy', 'bl-sell'], fromBill: 'bl-buy' }
      ],
      wallet: {
        accounts: [],
        bills: [
          { id: 'bl-buy', type: 'expense', amount: 800, date: '2025-01-01', time: '',
            catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '旧耳机',
            tagIds: [], itemId: 'it3', source: 'manual' },
          { id: 'bl-sell', type: 'income', amount: 300, date: '2026-01-01', time: '',
            catId: 'w_in_resale', subCatId: 'w_in_resale', accountId: '', note: '旧耳机',
            tagIds: [], itemId: 'it3', source: 'manual' }
        ]
      }
    }
  });
  if (!(await waitMain(w3))) throw new Error('no main');
  const S3 = w3.Storage;
  await S3.loadAll();
  db = S3.getDB();
  const it3 = JSON.parse(JSON.stringify(db.items.find(function (i) { return i.id === 'it3'; })));
  it3.name = '旧耳机改'; it3.purchasePrice = 900;
  await S3.saveItem(it3);
  db = S3.getDB();
  const buy = db.wallet.bills.find(function (b) { return b.id === 'bl-buy'; });
  const sell = db.wallet.bills.find(function (b) { return b.id === 'bl-sell'; });
  assert(buy.note === '旧耳机改' && Number(buy.amount) === 900, '购入支出账单应跟随词条: ' + JSON.stringify(buy));
  assert(sell.note === '旧耳机' && Number(sell.amount) === 300,
    'P1：二手回血收入账单金额=售出价，不得被购入价/名称污染: ' + JSON.stringify(sell));
  console.log('PASS ' + cur);

  /* ==================== 6 解除关联/删除后不回写 ==================== */
  cur = '6. unlinkBillSync/syncOff 后不再回写（解除/删除既有行为不动）';
  const w4 = makeWindow({
    data: {
      items: [
        { id: 'it4', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '解绑机',
          purchaseDate: '2025-06-01', purchasePrice: 100, status: 'in_use', images: [], tags: [],
          linkedBillIds: ['bl-4'], fromBill: 'bl-4' },
        { id: 'it5', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '半解机',
          purchaseDate: '2025-06-01', purchasePrice: 200, status: 'in_use', images: [], tags: [],
          linkedBillIds: ['bl-5'], fromBill: 'bl-5' }
      ],
      wallet: {
        accounts: [],
        bills: [
          { id: 'bl-4', type: 'expense', amount: 100, date: '2025-06-01', time: '',
            catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '解绑机',
            tagIds: [], itemId: 'it4', source: 'manual' },
          { id: 'bl-5', type: 'expense', amount: 200, date: '2025-06-01', time: '',
            catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '半解机',
            tagIds: [], itemId: 'it5', source: 'manual' }
        ]
      }
    }
  });
  if (!(await waitMain(w4))) throw new Error('no main');
  const S4 = w4.Storage;
  await S4.loadAll();
  // keepRec 解除：词条保留转手动维护，此后保存不得回写账单
  await S4.unlinkBillSync('bl-4', true);
  db = S4.getDB();
  assert(db.items.some(function (i) { return i.id === 'it4'; }), '前置：keepRec 解除应保留词条');
  const it4 = JSON.parse(JSON.stringify(db.items.find(function (i) { return i.id === 'it4'; })));
  it4.name = '解绑机改'; it4.purchasePrice = 123;
  await S4.saveItem(it4);
  db = S4.getDB();
  const b4 = db.wallet.bills.find(function (b) { return b.id === 'bl-4'; });
  assert(b4.note === '解绑机' && Number(b4.amount) === 100,
    'P1：解除关联后的账单不得再被词条回写: ' + JSON.stringify(b4));
  // syncOff 记忆：syncOff 账单即使残留关联也不回写
  const b5 = db.wallet.bills.find(function (b) { return b.id === 'bl-5'; });
  b5.syncOff = true;
  const it5 = JSON.parse(JSON.stringify(db.items.find(function (i) { return i.id === 'it5'; })));
  it5.name = '半解机改'; it5.purchasePrice = 321;
  await S4.saveItem(it5);
  db = S4.getDB();
  const b5b = db.wallet.bills.find(function (b) { return b.id === 'bl-5'; });
  assert(b5b.note === '半解机' && Number(b5b.amount) === 200,
    'P1：syncOff 的账单不得回写（防复活口径）: ' + JSON.stringify(b5b));
  console.log('PASS ' + cur);

  /* ==================== 7 双向收敛/防环 ==================== */
  cur = '7. 双向收敛：账单改→词条跟→词条改→账单跟，幂等不累积';
  const w5 = makeWindow({
    data: {
      items: [
        { id: 'it7', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '收敛机',
          purchaseDate: '2025-06-01', purchasePrice: 3000, status: 'in_use', images: [], tags: [],
          linkedBillIds: ['bl-7'], fromBill: 'bl-7' }
      ],
      wallet: {
        accounts: [{ id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 1000, note: '' }],
        bills: [
          { id: 'bl-7', type: 'expense', amount: 3000, date: '2025-06-01', time: '',
            catId: 'w_shop', subCatId: 'w_shop_digital', accountId: 'ac_cash', note: '收敛机',
            tagIds: [], itemId: 'it7', source: 'manual' }
        ]
      }
    }
  });
  if (!(await waitMain(w5))) throw new Error('no main');
  const S5 = w5.Storage;
  await S5.loadAll();
  // (a) 账单改金额（表单路径构造 rec）→ 词条金额跟随（正向既有口径）
  const billRec = JSON.parse(JSON.stringify(S5.getDB().wallet.bills[0]));
  delete billRec.itemId; // 表单重建不带关联字段（v113 同型）
  billRec.amount = 3100;
  await S5.saveBill(billRec);
  db = S5.getDB();
  assert(Number(db.items.find(function (i) { return i.id === 'it7'; }).purchasePrice) === 3100,
    '前置：账单改→词条金额应跟随（正向）');
  // 调账基线：账单编辑回滚旧值(3000)套新值(3100) → 1000+3000-3100=900
  const balAfterBill = db.wallet.accounts[0].balance;
  assert(Math.round(balAfterBill) === 900, '前置：账单编辑调账应一致: ' + balAfterBill);
  // (b) 无关字段保存（不改名称/金额/日期）→ 不得反向回写/不累积
  const it7a = JSON.parse(JSON.stringify(db.items.find(function (i) { return i.id === 'it7'; })));
  it7a.notes = '补充备注';
  await S5.saveItem(it7a);
  db = S5.getDB();
  assert(Number(db.wallet.bills[0].amount) === 3100,
    'P1：无关字段保存不得回写金额（幂等）: ' + db.wallet.bills[0].amount);
  assert(db.wallet.accounts[0].balance === balAfterBill,
    '幂等保存不得二次调账: ' + db.wallet.accounts[0].balance);
  // (c) 词条改金额 → 账单跟；再同值保存幂等不累积
  const it7b = JSON.parse(JSON.stringify(db.items.find(function (i) { return i.id === 'it7'; })));
  it7b.purchasePrice = 3200;
  await S5.saveItem(it7b);
  await S5.saveItem(JSON.parse(JSON.stringify(S5.getDB().items.find(function (i) { return i.id === 'it7'; }))));
  db = S5.getDB();
  assert(Number(db.wallet.bills[0].amount) === 3200,
    'P1：词条改金额账单应跟随且重复保存不累积（防环）: ' + db.wallet.bills[0].amount);
  assert(Math.round(db.wallet.accounts[0].balance) === 900 - 100,
    '防环：调账只走一层: ' + db.wallet.accounts[0].balance);
  console.log('PASS ' + cur);

  /* ==================== 8 UI 链路（用户报告场景复现） ==================== */
  cur = '8. UI 物品编辑器保存 → 关联账单实时同步';
  const w6 = makeWindow({
    data: {
      items: [
        { id: 'it8', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: 'UI改名前',
          purchaseDate: '2025-06-01', purchasePrice: 3000, status: 'in_use', images: [], tags: [],
          linkedBillIds: ['bl-8'], fromBill: 'bl-8' }
      ],
      wallet: {
        accounts: [],
        bills: [
          { id: 'bl-8', type: 'expense', amount: 3000, date: '2025-06-01', time: '',
            catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: 'UI改名前',
            tagIds: [], itemId: 'it8', source: 'manual' }
        ]
      }
    }
  });
  if (!(await waitMain(w6))) throw new Error('no main');
  const S6 = w6.Storage;
  const doc6 = w6.document;
  await S6.loadAll();
  w6.Views.openItemEditor('it8', 'device');
  const modal6 = await waitFor(function () {
    const m = lastModal(doc6);
    return m && m.querySelector('[name=name]') ? m : null;
  }, { label: '物品编辑弹窗未出现' });
  modal6.querySelector('[name=name]').value = 'UI改名后';
  modal6.querySelector('[name=purchasePrice]').value = '3600';
  modal6.querySelector('[data-act="save"]').click();
  const b8 = await waitFor(function () {
    const b = S6.getDB().wallet.bills.find(function (x) { return x.id === 'bl-8'; });
    return b && b.note === 'UI改名后' && Number(b.amount) === 3600 ? b : null;
  }, { label: '词条编辑未同步到关联账单（用户报告问题）' });
  assert(b8.date === '2025-06-01', 'UI 链路未改日期时账单日期不动: ' + b8.date);
  console.log('PASS ' + cur);

  /* ==================== 9 priceManual 单向保护兼容（A7 锁） ==================== */
  cur = '9. priceManual 单向保护：账单编辑不改手改价、无关保存不反向覆盖账单金额';
  const w7 = makeWindow({
    data: {
      food: [
        { id: 'fd9', date: '2026-02-01', meal: '午餐', foodCuisine: '其他', name: '手改价午饭', price: 33,
          priceManual: true, note: '', tags: [], images: [], linkedBillIds: ['fl-9'], fromBill: 'fl-9' }
      ],
      wallet: {
        accounts: [],
        bills: [
          { id: 'fl-9', type: 'expense', amount: 33, date: '2026-02-01', time: '',
            catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '手改价午饭',
            tagIds: [], foodId: 'fd9', source: 'manual' }
        ]
      }
    }
  });
  if (!(await waitMain(w7))) throw new Error('no main');
  const S7 = w7.Storage;
  await S7.loadAll();
  // (a) 账单编辑改金额 → 手改价不被改写（既有 A7 正向锁，勿破坏）
  const bill9 = JSON.parse(JSON.stringify(S7.getDB().wallet.bills[0]));
  delete bill9.foodId;
  bill9.amount = 120;
  await S7.saveBill(bill9);
  db = S7.getDB();
  assert(Number(db.food.find(function (f) { return f.id === 'fd9'; }).price) === 33,
    'A7 锁：priceManual 后账单不得静默改写价格');
  assert(Number(db.wallet.bills[0].amount) === 120, '账单编辑应落库');
  // (b) 词条只改名（价格没变）→ 不得把账单金额反向覆盖回 33（diff 触发口径）
  const fd9 = JSON.parse(JSON.stringify(db.food.find(function (f) { return f.id === 'fd9'; })));
  fd9.name = '手改价午饭改';
  await S7.saveFood(fd9);
  db = S7.getDB();
  assert(db.wallet.bills[0].note === '手改价午饭改', '改名应跟随');
  assert(Number(db.wallet.bills[0].amount) === 120,
    'P1：价格未变的保存不得反向覆盖账单金额（单向保护）: ' + db.wallet.bills[0].amount);
  // (c) 用户显式改价 → 两边都该是它（拍板）
  const fd9b = JSON.parse(JSON.stringify(db.food.find(function (f) { return f.id === 'fd9'; })));
  fd9b.price = 40; fd9b.priceManual = true;
  await S7.saveFood(fd9b);
  db = S7.getDB();
  assert(Number(db.wallet.bills[0].amount) === 40 && Number(db.food.find(function (f) { return f.id === 'fd9'; }).price) === 40,
    '拍板：用户显式改价两边都该是它: ' + db.wallet.bills[0].amount);
  console.log('PASS ' + cur);

  console.log('========== v1.1.7 词条↔账单双向同步：9 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
