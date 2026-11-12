/* v113-regress.test.js — v1.1.3 回归锁（审查+数据）：
   审查（1-5）：
   1) 模板账单跨"重载→再保存"不丢（前端兜底 templates 字段）
   2) syncOff 防自动复活：解除关联后的正餐账单再编辑不重建美食
   3) 直接删除自动生成的美食/词条后，编辑账单不复活（syncOff 记忆）
   4) 新建物品"同时记账"的账单默认不区分账户（不动账户余额，与生成购入账单同口径）
   5) 词条侧同样防复活：解除关联后再编辑手机数码账单，不重建词条
   数据（6-13）：
   6) P0-4 转账单边账户：applyBillToBalance 两侧都不动（不造钱/不吞钱）；双侧等额移动
   7) P1-1/1-6 保存失败整体重载回滚；导入批次失败也记全量 billIds（可撤销）
   8) P0-4 导入链路：转账双侧账户都匹配才导入，否则整条跳过并标注原因
   9) P1-1/1-6 导入失败也记全量 billIds（可整批撤销），账单不残留
   10) P1-3a/3b/3c repairData 先清引用再判孤儿；旧余额快照（无 accountId）不删
   11) P2-9 二手回血收入账单不挡购入账单补记；P2-10 同名多词条跳过售出回填
   12) P2-11 删除分类/账户时模板引用置空（模板保留）
   13) P1-3c removeItem 级联：组合成员/父引用清理 */
'use strict';
const { makeWindow, waitFor, sleep, waitMain, lastModal, assert } = require('./helpers/harness');

let cur = '';

// ---- 数据套件（6-13）可控服务端 mock：磁盘态 disk + 失败计数 failSaveCount ----
let disk = null;
let failSaveCount = 0;
let parseResult = null; // /api/import/parse 的返回
function resetDisk() {
  disk = {
    items: [], outfits: [], food: [], events: [],
    settings: {},
    wallet: {
      bills: [], imports: [], tags: [], balances: [], templates: [], catsVersion: 2,
      accounts: [
        { id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 1000, note: '' },
        { id: 'ac_bank', name: '银行卡', icon: 'credit-card', type: 'bank', balance: 5000, note: '' }
      ],
      cats: {
        expense: [
          { id: 'w_food', name: '食品餐饮', icon: 'x', children: [
            { id: 'w_food_lunch', name: '午餐', icon: 'x' }, { id: 'w_food_dinner', name: '晚餐', icon: 'x' }
          ] },
          { id: 'w_shop', name: '购物消费', icon: 'x', children: [
            { id: 'w_shop_digital', name: '手机数码', icon: 'x' }, { id: 'w_shop_clothing', name: '服饰运动', icon: 'x' },
            { id: 'w_shop_beauty', name: '个护美妆', icon: 'x' }
          ] }
        ],
        income: [{ id: 'w_in_resale', name: '二手闲置', icon: 'x', children: [] }]
      },
      syncMap: { w_shop_digital: 'digital', w_shop_clothing: 'clothing', w_shop_beauty: 'life' }
    }
  };
}
resetDisk();

/* 审查套件（1-5）的 /api/db：固定数据，且故意不下发 wallet.templates（也不下发 balances），
   验证前端兜底；persist 不得把 [] 写回洗数据之外的语义 */
function reviewDb(h) {
  return h.ok({
    schemaVersion: 3, account: { id: 'me', name: 'Me', icon: 'x' },
    accounts: [{ id: 'me', name: 'Me', icon: 'x' }],
    items: [], outfits: [], food: [], events: [],
    settings: { idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} }, planSections: [], rememberAccount: true },
    categories: {
      digital: [
        { id: 'host', name: '主机类', icon: 'laptop', children: [{ id: 'host_phone', name: '手机' }, { id: 'host_other', name: '其他主机' }] }
      ],
      clothing: [{ id: 'top', name: '上装', icon: 'shirt', children: [{ id: 'top_tee', name: 'T恤' }] }],
      life: [{ id: 'skin', name: '护肤', icon: 'heart', children: [{ id: 'skin_other', name: '其他' }] }],
      foodCuisine: [], foodType: [], meal: ['早餐', '午餐', '晚餐', '加餐'], foodTag: [], occasion: [], season: [],
      tagPresets: [], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
    },
    wallet: {
      bills: [], imports: [], tags: [], catsVersion: 2,
      // 注意：故意不下发 templates —— 兜底应给 []，且 persist 不得把 [] 写回洗数据之外的语义
      accounts: [
        { id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 1000, note: '' },
        { id: 'ac_bank', name: '银行卡', icon: 'credit-card', type: 'bank', balance: 5000, note: '' }
      ],
      cats: {
        expense: [
          { id: 'w_food', name: '食品餐饮', icon: 'color_ic_parent_restaurant', children: [
            { id: 'w_food_breakfast', name: '早餐', icon: 'x' }, { id: 'w_food_lunch', name: '午餐', icon: 'x' },
            { id: 'w_food_dinner', name: '晚餐', icon: 'x' }
          ] },
          { id: 'w_shop', name: '购物消费', icon: 'color_ic_parent_shopping', children: [
            { id: 'w_shop_digital', name: '手机数码', icon: 'x' }, { id: 'w_shop_clothing', name: '服饰运动', icon: 'x' },
            { id: 'w_shop_beauty', name: '个护美妆', icon: 'x' }
          ] }
        ],
        income: [
          { id: 'w_in_wages', name: '工资', icon: 'x', children: [] },
          { id: 'w_in_resale', name: '二手闲置', icon: 'x', children: [] }
        ]
      },
      syncMap: { w_shop_digital: 'digital', w_shop_clothing: 'clothing', w_shop_beauty: 'life' }
    },
    dataRoot: 'm'
  });
}

/* 数据套件（6-13）的 /api/save /api/db /api/import/parse：磁盘态 + 可控失败 */
const dataRoutes = {
  'api/save': function (h) {
    if (!h.body) return undefined;
    if (failSaveCount > 0) { failSaveCount--; return h.fail({ error: '磁盘写入失败' }, 500); }
    disk[h.body.target] = JSON.parse(JSON.stringify(h.body.data));
    return h.ok({ ok: true });
  },
  'api/import/parse': function (h) {
    return h.ok(parseResult || { ok: true, format: 'pasted_text', bills: [], skipped: [], warnings: [] });
  },
  'api/db': function (h) {
    // 深拷贝：内存直接改对象不许污染"磁盘"，否则回滚断言失真
    const snap = JSON.parse(JSON.stringify(disk));
    return h.ok({
      schemaVersion: 3, account: { id: 'me', name: 'Me', icon: 'x' },
      accounts: [{ id: 'me', name: 'Me', icon: 'x' }],
      items: snap.items, outfits: snap.outfits, food: snap.food, events: snap.events,
      settings: snap.settings,
      categories: {
        digital: [{ id: 'host', name: '主机类', icon: 'laptop', children: [{ id: 'host_phone', name: '手机' }, { id: 'host_other', name: '其他主机' }] }],
        clothing: [{ id: 'top', name: '上装', icon: 'shirt', children: [{ id: 'top_tee', name: 'T恤' }] }],
        life: [{ id: 'skin', name: '护肤', icon: 'heart', children: [{ id: 'skin_other', name: '其他' }] }],
        foodCuisine: [], foodType: [], meal: ['早餐', '午餐', '晚餐', '加餐'], foodTag: [], occasion: [], season: [],
        tagPresets: [], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
      },
      wallet: snap.wallet, dataRoot: 'm'
    });
  }
};

async function main() {
  /* ==================== 审查回归（1-5） ==================== */
  const w = makeWindow({ routes: { 'api/db': reviewDb } });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;
  const today = w.Utils.todayStr();

  // ---- 1 模板账单字段兜底：服务端未下发 templates 时应为 []（而非 undefined），persist 契约含 templates ----
  cur = '1. templates 字段前端兜底为数组';
  const db0 = w.Storage.getDB();
  if (!Array.isArray(db0.wallet.templates)) {
    throw new Error('P1：db.wallet.templates 缺失兜底（旧 exe 不下发时会把模板洗成 undefined→[]）');
  }
  console.log('PASS ' + cur);

  // ---- 2 syncOff 防复活（美食侧）：解除关联后再编辑正餐账单，不得重建美食记录 ----
  cur = '2. syncOff 后编辑账单不再复活美食同步';
  await w.Storage.saveBill({
    id: 'b-meal-1', type: 'expense', amount: 50, date: today, time: '',
    catId: 'w_food', subCatId: 'w_food_dinner', accountId: '', note: '晚饭', tagIds: [], source: 'manual'
  });
  let db = w.Storage.getDB();
  if (db.food.length !== 1) throw new Error('前置失败：正餐账单应自动同步 1 条美食，实际 ' + db.food.length);
  await w.Storage.unlinkBillSync('b-meal-1');
  db = w.Storage.getDB();
  if (db.food.length !== 0) throw new Error('前置失败：解除关联应清掉自动生成的美食');
  // 再编辑该账单（改金额）——按表单路径构造 rec：**不带** syncOff/foodId 字段
  const bill1 = db.wallet.bills.find(b => b.id === 'b-meal-1');
  await w.Storage.saveBill({
    id: 'b-meal-1', type: 'expense', amount: 80, date: bill1.date, time: '',
    catId: 'w_food', subCatId: 'w_food_dinner', accountId: '', note: '晚饭', tagIds: [], source: 'manual'
  });
  db = w.Storage.getDB();
  const bill1b = db.wallet.bills.find(b => b.id === 'b-meal-1');
  if (bill1b.foodId) throw new Error('P1：syncOff 后编辑账单又挂回 foodId（自动复活）');
  if (db.food.length !== 0) throw new Error('P1：syncOff 防自动复活失效——美食记录被重建');
  console.log('PASS ' + cur);

  // ---- 3 直接删除自动生成的美食后，编辑账单不复活（删除=用户不要这条同步） ----
  cur = '3. 删除自动生成美食后不复活';
  await w.Storage.saveBill({
    id: 'b-meal-2', type: 'expense', amount: 30, date: today, time: '',
    catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '午饭', tagIds: [], source: 'manual'
  });
  db = w.Storage.getDB();
  if (db.food.length !== 1) throw new Error('前置失败：午饭账单应同步 1 条美食');
  await w.Storage.removeFood(db.food[0].id);
  db = w.Storage.getDB();
  const bill2 = db.wallet.bills.find(b => b.id === 'b-meal-2');
  await w.Storage.saveBill({
    id: 'b-meal-2', type: 'expense', amount: 35, date: bill2.date, time: '',
    catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '午饭', tagIds: [], source: 'manual'
  });
  db = w.Storage.getDB();
  if (db.food.length !== 0) throw new Error('P1：用户删除的美食记录被编辑账单复活');
  console.log('PASS ' + cur);

  // ---- 4 新建物品"同时记账"：账单默认不区分账户，不动任何账户余额 ----
  cur = '4. 同时记账默认不区分账户、不动余额';
  w.App.go('digital');
  await waitFor(function () { return doc.getElementById('btn-add-item'); }, { label: '数码页渲染' });
  doc.getElementById('btn-add-item').click();
  let modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('[name=name]') ? m : null;
  }, { label: '记物品弹窗出现' });
  modal.querySelector('[name=name]').value = '测试手机X';
  modal.querySelector('[name=categoryId]').value = 'host';
  modal.querySelector('[name=categoryId]').dispatchEvent(new w.Event('change'));
  modal.querySelector('[name=purchaseDate]').value = today;
  modal.querySelector('[name=purchasePrice]').value = '2000';
  const syncBox = modal.querySelector('#item-sync-bill');
  if (!syncBox || !syncBox.checked) throw new Error('前置失败：新建物品应默认勾选同时记账');
  const balBefore = w.Storage.getDB().wallet.accounts.map(a => Number(a.balance) || 0).join(',');
  modal.querySelector('[data-act="save"]').click();
  const newBill = await waitFor(function () {
    return w.Storage.getDB().wallet.bills.find(b => b.note === '测试手机X');
  }, { label: '前置失败：未生成购入账单' });
  db = w.Storage.getDB();
  if (!newBill) throw new Error('前置失败：未生成购入账单');
  if (newBill.accountId) {
    throw new Error('P2：同时记账的账单被塞进账户 ' + newBill.accountId + '（应默认不区分账户，与生成购入账单同口径）');
  }
  const balAfter = db.wallet.accounts.map(a => Number(a.balance) || 0).join(',');
  if (balBefore !== balAfter) throw new Error('P2：同时记账改动了账户余额（默认账单不应动余额）');
  console.log('PASS ' + cur);

  // ---- 5 词条侧同样防复活：解除关联后再编辑手机数码账单，不重建词条 ----
  cur = '5. syncOff 后编辑账单不再复活物品词条';
  await w.Storage.saveBill({
    id: 'b-item-1', type: 'expense', amount: 999, date: today, time: '',
    catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '蓝牙音箱', tagIds: [], source: 'manual'
  });
  db = w.Storage.getDB();
  const autoItem = db.items.find(i => i.name === '蓝牙音箱');
  if (!autoItem) throw new Error('前置失败：手机数码账单应自动同步词条');
  await w.Storage.unlinkBillSync('b-item-1');
  db = w.Storage.getDB();
  if (db.items.some(i => i.name === '蓝牙音箱')) throw new Error('前置失败：解除关联应清掉自动生成词条');
  await w.Storage.saveBill({
    id: 'b-item-1', type: 'expense', amount: 1099, date: today, time: '',
    catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '蓝牙音箱', tagIds: [], source: 'manual'
  });
  db = w.Storage.getDB();
  if (db.items.some(i => i.name === '蓝牙音箱')) throw new Error('P1：syncOff 后编辑账单复活了物品词条');
  console.log('PASS ' + cur);

  /* ==================== 数据层回归（6-13） ==================== */
  resetDisk();
  const w2 = makeWindow({ routes: dataRoutes });
  if (!(await waitMain(w2))) throw new Error('no main');
  const S = w2.Storage;
  await S.loadAll();
  db = S.getDB();
  const doc2 = w2.document;

  // ---- 6 P0-4 转账单边账户：两侧余额都不动；双侧等额移动 ----
  cur = '6. 转账单边不动余额，双边等额移动';
  await S.saveBill({
    id: 'tr-1', type: 'transfer', amount: 300, date: w2.Utils.todayStr(), time: '',
    catId: '', subCatId: '', accountId: 'ac_cash', toAccountId: '', // 单边（转入缺失）
    note: '单边转账', tagIds: [], source: 'manual'
  });
  db = S.getDB();
  const cash = db.wallet.accounts.find(a => a.id === 'ac_cash');
  const bank = db.wallet.accounts.find(a => a.id === 'ac_bank');
  assert(Math.round(cash.balance) === 1000 && Math.round(bank.balance) === 5000,
    'P0-4 单边转账不得动余额：cash=' + cash.balance + ' bank=' + bank.balance);
  await S.saveBill({
    id: 'tr-2', type: 'transfer', amount: 300, date: w2.Utils.todayStr(), time: '',
    catId: '', subCatId: '', accountId: 'ac_cash', toAccountId: 'ac_bank',
    note: '双边转账', tagIds: [], source: 'manual'
  });
  db = S.getDB();
  assert(Math.round(db.wallet.accounts.find(a => a.id === 'ac_cash').balance) === 700,
    'P0-4 转出侧应减 300');
  assert(Math.round(db.wallet.accounts.find(a => a.id === 'ac_bank').balance) === 5300,
    'P0-4 转入侧应加 300');
  console.log('PASS ' + cur);

  // ---- 7 P1-1/1-6 保存失败 → 整体重载回滚（词条/美食/余额/账单全撤） ----
  cur = '7. 保存失败整体重载回滚，不残留脏状态';
  const balBefore2 = S.getDB().wallet.accounts.map(a => Math.round(a.balance)).join(',');
  failSaveCount = 3; // saveBills 的 3 个 persist 全失败
  let saveFailed = false;
  await S.saveBills([{
    id: 'fail-1', type: 'expense', amount: 2333, date: w2.Utils.todayStr(), time: '',
    catId: 'w_shop', subCatId: 'w_shop_digital', accountId: 'ac_cash', note: '失败手机',
    tagIds: [], source: 'manual'
  }]).catch(() => { saveFailed = true; });
  failSaveCount = 0;
  assert(saveFailed, '前置：saveBills 应失败');
  db = S.getDB();
  assert(db.wallet.bills.filter(b => b.id === 'fail-1').length === 0, 'P1-1 失败账单不得残留内存');
  assert(db.items.filter(i => i.name === '失败手机').length === 0, 'P1-1 失败同步词条不得残留');
  assert(db.wallet.accounts.map(a => Math.round(a.balance)).join(',') === balBefore2,
    'P1-1 失败后余额不得残留脏状态');
  // 失败后仍能正常保存（内存与磁盘一致）
  await S.saveBill({
    id: 'ok-1', type: 'expense', amount: 10, date: w2.Utils.todayStr(), time: '',
    catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '午饭', tagIds: [], source: 'manual'
  });
  assert(S.getDB().wallet.bills.some(b => b.id === 'ok-1'), '失败回滚后正常保存应可用');
  console.log('PASS ' + cur);

  // ---- 8 P0-4① 导入链路：转账双侧账户都匹配才导入 ----
  cur = '8. 导入链路转账双侧校验，单边整条跳过';
  const box = doc2.createElement('div');
  doc2.body.appendChild(box);
  w2.WalletView.mountImportUI(box);
  parseResult = {
    ok: true, format: 'pasted_text', skipped: [], warnings: [],
    bills: [
      { date: '2026-11-01', type: 'transfer', amount: 300, accountName: '现金', toAccountName: '银行卡', note: '转账A' },
      { date: '2026-11-02', type: 'transfer', amount: 400, accountName: '现金', toAccountName: '不存在银行', note: '转账B缺转入' },
      { date: '2026-11-03', type: 'transfer', amount: 500, accountName: '幽灵账户', toAccountName: '银行卡', note: '转账C缺转出' },
      { date: '2026-11-04', type: 'expense', amount: 23.5, accountName: '没匹配的账户', note: '不区分账户支出' }
    ]
  };
  box.querySelector('#paste-bills').value = 'x';
  box.querySelector('#btn-paste-parse').click();
  const preview = await waitFor(function () {
    const p = box.querySelector('#import-preview');
    return p && p.innerHTML.indexOf('转入账户缺失或未匹配') >= 0 && p.innerHTML.indexOf('转出账户缺失或未匹配') >= 0 ? p : null;
  }, { label: '预览应标注转账账户未匹配原因' });
  assert(preview && preview.innerHTML.indexOf('转入账户缺失或未匹配') >= 0, '预览应标注转入账户未匹配原因');
  assert(preview.innerHTML.indexOf('转出账户缺失或未匹配') >= 0, '预览应标注转出账户缺失或未匹配原因');
  preview.querySelector('#imp-commit').click();
  // 导入收尾 = 账单落库 + 批次记录写入（批次比账单晚落地）
  await waitFor(function () {
    const d = w2.Storage.getDB();
    const b = d.wallet.imports[d.wallet.imports.length - 1];
    return d.wallet.bills.find(x => x.note === '转账A') && b && b.billIds && b.billIds.length === 2;
  }, { label: '双侧匹配的转账应导入且双侧落位' });
  db = S.getDB();
  const trA = db.wallet.bills.find(b => b.note === '转账A');
  const trB = db.wallet.bills.find(b => b.note === '转账B缺转入');
  const trC = db.wallet.bills.find(b => b.note === '转账C缺转出');
  const expFree = db.wallet.bills.find(b => b.note === '不区分账户支出');
  assert(trA && trA.accountId === 'ac_cash' && trA.toAccountId === 'ac_bank', '双侧匹配的转账应导入且双侧落位');
  assert(!trB && !trC, 'P0-4 单边转账不得导入：' + JSON.stringify([trB, trC]));
  assert(expFree && expFree.accountId === '', '非转账账户匹配不上 = 不区分账户（口径不变）');
  const cash2 = db.wallet.accounts.find(a => a.id === 'ac_cash').balance;
  const bank2 = db.wallet.accounts.find(a => a.id === 'ac_bank').balance;
  assert(Math.round(cash2) === 400 && Math.round(bank2) === 5600,
    '导入的转账应双侧等额移动且单边不入账：cash=' + cash2 + ' bank=' + bank2);
  const batch = db.wallet.imports[db.wallet.imports.length - 1];
  assert(batch && batch.billIds.length === 2, '批次应记 2 笔（跳过的不记）: ' + JSON.stringify(batch));
  console.log('PASS ' + cur);

  // ---- 9 P1-1/1-6 导入失败也记全量 billIds（可整批撤销），账单不残留 ----
  cur = '9. 导入失败记全量批次可撤销，revertImport 容错';
  parseResult = {
    ok: true, format: 'pasted_text', skipped: [], warnings: [],
    bills: [{ date: '2026-11-05', type: 'expense', amount: 66, note: '失败导入' }]
  };
  box.querySelector('#import-preview').innerHTML = '';
  box.querySelector('#paste-bills').value = 'x';
  box.querySelector('#btn-paste-parse').click();
  await waitFor(function () {
    const p = box.querySelector('#import-preview');
    return p && p.querySelector('#imp-commit') ? p : null;
  }, { label: '导入预览渲染' });
  failSaveCount = 3; // saveBills 的持久化失败（后续批次记录仍可写）
  box.querySelector('#import-preview').querySelector('#imp-commit').click();
  // 批次记录落全量 billIds 且失败账单已回滚，才算这条链路收尾
  await waitFor(function () {
    const b = S.getDB().wallet.imports[S.getDB().wallet.imports.length - 1];
    return b && b.billIds && b.billIds.length === 1 && !S.getDB().wallet.bills.some(x => x.note === '失败导入');
  }, { label: 'P1-6 失败批次也必须记全量 billIds（可追溯/可撤销）' });
  failSaveCount = 0;
  db = S.getDB();
  const lastBatch = db.wallet.imports[db.wallet.imports.length - 1];
  assert(lastBatch && lastBatch.billIds.length === 1,
    'P1-6 失败批次也必须记全量 billIds（可追溯/可撤销）: ' + JSON.stringify(lastBatch));
  assert(!db.wallet.bills.some(b => b.note === '失败导入'), 'P1-1 失败导入的账单不得残留');
  // 撤销不存在的 billId 容错跳过，不抛错
  await S.revertImport(lastBatch.id);
  assert(!S.getDB().wallet.imports.some(x => x.id === lastBatch.id), '撤销应移除批次');
  console.log('PASS ' + cur);

  // ---- 10 P1-3a/3b/3c repairData：先清引用再判孤儿；旧余额快照不删 ----
  cur = '10. repairData 先清引用再判孤儿，旧余额快照不删';
  db = S.getDB();
  // 构造脏数据
  db.items.push({ id: 'it-auto', name: '自动词条', fromBill: 'gone-bill', linkedBillIds: [], kind: 'device' });
  db.items.push({ id: 'it-keep', name: '保留词条', fromBill: 'gone-bill2', linkedBillIds: ['ok-1'], kind: 'device' });
  db.items.push({ id: 'it-parent', name: '子物品', parentItemId: 'no-such-item', kind: 'device' });
  db.outfits.push({ id: 'of-1', date: '2026-11-01', itemIds: ['it-keep', 'ghost-item'], cosmeticIds: ['ghost-cos'], cosmeticQty: { 'ghost-cos': 2, 'it-keep': 1 } });
  db.events.push({ id: 'ev-1', itemId: 'ghost-item', date: '2026-11-01' });
  db.settings.makeupLooks = [{ id: 'mk-1', name: '妆容', itemIds: ['it-keep', 'ghost-item'] }];
  db.settings.outfitLooks = [{ id: 'ol-1', name: '穿搭', itemIds: ['ghost-item'] }];
  db.wallet.imports.push({ id: 'im-old', billIds: ['ok-1', 'ghost-bill'] });
  db.wallet.bills.push({ id: 'bl-old', type: 'expense', amount: 1, date: '2026-11-01', accountId: 'deleted-acc', toAccountId: 'deleted-acc2', note: '旧账单' });
  db.wallet.balances.push({ id: 'bal-legacy', date: '2026-11-01', balance: 123, note: 'v1.1.2 前旧快照' }); // 无 accountId
  db.wallet.balances.push({ id: 'bal-ok', date: '2026-11-02', accountId: 'ac_cash', balance: 1 });
  db.wallet.balances.push({ id: 'bal-orphan', date: '2026-11-03', accountId: 'deleted-acc', balance: 2 });
  const r = await S.repairData();
  db = S.getDB();
  assert(!db.items.some(i => i.id === 'it-auto'), '真孤儿自动词条应清理');
  assert(db.items.some(i => i.id === 'it-keep'), 'fromBill 悬空但有其他关联的词条不得删');
  assert(db.items.some(i => i.id === 'it-parent'), '子物品本体不得删');
  assert(!db.items.find(i => i.id === 'it-parent').parentItemId, 'parentItemId 悬空应置空');
  const of1 = db.outfits.find(o => o.id === 'of-1');
  assert(of1.itemIds.join(',') === 'it-keep', 'outfits.itemIds 悬空应摘除: ' + JSON.stringify(of1.itemIds));
  assert(of1.cosmeticIds.length === 0, 'outfits.cosmeticIds 悬空应摘除');
  assert(!of1.cosmeticQty['ghost-cos'] && of1.cosmeticQty['it-keep'] === 1, 'cosmeticQty 悬空键应清理');
  const ev1 = db.events.find(e => e.id === 'ev-1');
  assert(ev1 && !ev1.itemId, 'events.itemId 悬空应置空（事件本体保留）');
  assert(db.settings.makeupLooks[0].itemIds.join(',') === 'it-keep', '妆容组合悬空成员应摘除');
  assert(db.settings.outfitLooks[0].itemIds.length === 0, '穿搭组合悬空成员应摘除');
  const imOld = db.wallet.imports.find(x => x.id === 'im-old');
  assert(imOld.billIds.join(',') === 'ok-1', 'imports.billIds 悬空应摘除: ' + JSON.stringify(imOld.billIds));
  const blOld = db.wallet.bills.find(b => b.id === 'bl-old');
  assert(blOld && blOld.accountId === '' && blOld.toAccountId === '', '账单指向已删账户应置空（不删账单）');
  assert(db.wallet.balances.some(b => b.id === 'bal-legacy'), 'P1-3a 无 accountId 的旧余额快照不得删');
  assert(!db.wallet.balances.some(b => b.id === 'bal-orphan'), '指向已删账户的孤儿快照才删');
  assert(db.wallet.balances.some(b => b.id === 'bal-ok'), '有效快照保留');
  assert((r.warnings || []).some(x => x.indexOf('未关联账户') >= 0), '多账户下旧快照应计 warnings: ' + JSON.stringify(r.warnings));
  // 单账户时旧快照回填该账户
  db.wallet.accounts = [db.wallet.accounts.find(a => a.id === 'ac_cash')];
  const r2 = await S.repairData();
  db = S.getDB();
  const legacy = db.wallet.balances.find(b => b.id === 'bal-legacy');
  assert(legacy && legacy.accountId === 'ac_cash', '单账户时旧快照应回填该账户: ' + JSON.stringify(legacy));
  assert((r2.warnings || []).length === 0, '回填后不应再有 warnings');
  console.log('PASS ' + cur);

  // ---- 11 P2-9/P2-10 二手回血：不挡购入补记；同名多词条跳过回填 ----
  cur = '11. 二手回血不挡补记，同名多词条跳过回填';
  db = S.getDB();
  db.wallet.accounts.push({ id: 'ac_cash2', name: '现金2', icon: 'banknote', type: 'cash', balance: 0, note: '' });
  db.items.push({ id: 'earphone', kind: 'device', categoryId: 'host', subCategoryId: 'aud_headphone', name: '旧耳机', status: 'in_use', images: [], tags: [] });
  await S.saveBill({
    id: 'resale-1', type: 'income', amount: 800, date: w2.Utils.todayStr(), time: '',
    catId: 'w_in_resale', subCatId: 'w_in_resale', accountId: '', note: '旧耳机', tagIds: [], source: 'manual'
  });
  db = S.getDB();
  const soldAuto = db.items.find(i => i.name === '旧耳机');
  assert(soldAuto, '前置：二手回血应命中同名词条');
  assert(Math.round(soldAuto.soldPrice) === 800 && soldAuto.status === 'sold', '唯一命中应回填售出价/状态');
  // 已有回血收入账单后仍可补购入账单（P2-9）
  const bill = await S.addBillFromItem(soldAuto);
  assert(bill && bill.type === 'expense', 'P2-9 二手回血收入不得挡购入账单补记');
  // 同名多词条：跳过回填（P2-10）
  const mk = (id, name) => ({ id: id, kind: 'device', categoryId: 'host', subCategoryId: 'host_other', name: name, status: 'in_use', images: [], tags: [] });
  db.items.push(mk('dup-1', '同名物品'), mk('dup-2', '同名物品'));
  await S.saveBill({
    id: 'resale-2', type: 'income', amount: 100, date: w2.Utils.todayStr(), time: '',
    catId: 'w_in_resale', subCatId: 'w_in_resale', accountId: '', note: '同名物品', tagIds: [], source: 'manual'
  });
  db = S.getDB();
  const dups = db.items.filter(i => i.name === '同名物品');
  assert(dups.length === 2 && dups.every(i => i.status === 'in_use' && i.soldPrice == null),
    'P2-10 同名多个词条时必须跳过售出回填: ' + JSON.stringify(dups));
  console.log('PASS ' + cur);

  // ---- 12 P2-11 删除分类/账户时模板引用置空（模板保留） ----
  cur = '12. 模板引用置空，模板本体保留';
  db = S.getDB();
  // 用自定义分类（无账单引用，可删）挂模板
  await S.saveWalletCat({ id: 'cat-custom', name: '自定义分类', icon: 'x', children: [] }, 'expense');
  db = S.getDB();
  db.wallet.templates.push({ id: 'tpl-1', name: '模板A', type: 'expense', catId: 'cat-custom', subCatId: '', amount: 1, note: '', accountId: 'ac_cash2' });
  await S.removeWalletCat('cat-custom', 'expense');
  db = S.getDB();
  let tpl = db.wallet.templates.find(t => t.id === 'tpl-1');
  assert(tpl && tpl.catId === '' && tpl.subCatId === '', 'P2-11 分类删除应置空模板分类引用（模板保留）: ' + JSON.stringify(tpl));
  await S.removeWalletAccount('ac_cash2');
  db = S.getDB();
  tpl = db.wallet.templates.find(t => t.id === 'tpl-1');
  assert(tpl && tpl.accountId === '', 'P2-11 账户删除应置空模板 accountId（模板保留）');
  console.log('PASS ' + cur);

  // ---- 13 P1-3c removeItem 级联：组合成员/父引用清理 ----
  cur = '13. removeItem 级联清组合/父引用';
  db = S.getDB();
  db.settings.makeupLooks.push({ id: 'mk-2', name: '妆容2', itemIds: ['it-keep', 'it-parent'] });
  db.items.find(i => i.id === 'it-parent').parentItemId = 'it-keep';
  await S.removeItem('it-keep');
  db = S.getDB();
  assert(!db.items.some(i => i.id === 'it-keep'), 'removeItem 应删除本体');
  assert(db.settings.makeupLooks.every(c => c.itemIds.indexOf('it-keep') < 0),
    'removeItem 应清组合成员: ' + JSON.stringify(db.settings.makeupLooks));
  assert(!db.items.find(i => i.id === 'it-parent').parentItemId, 'removeItem 应清子物品父引用');
  console.log('PASS ' + cur);

  console.log('========== v1.1.3 回归锁（审查+数据）：13 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
