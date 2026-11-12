/* v118-cost-sync-sim.test.js — v1.1.5 新功能真实用户动线模拟（找 bug + 回归锁）：
   1) 成本构成明细：899 主机 + 4399 挂靠配件（表单选「所属主机」）→ 详情
      「总投入 ¥5,298（购入 ¥899 + 配件 ¥4,399）」+配件明细行；解除挂靠回落 899；
      维修流水累计显示；3 处口径修复验证（服饰 wearCount=0 显"尚未穿着"、
      分类残值率显式 0 不被吞、寿命 0 不算负折旧）
   2) 「所属主机」语义：方向正确（挂后主机总投入增加）、不能选自己、
      循环挂靠（A↔B）被下拉过滤 + readItemForm 兜底丢弃 + 模型层不重复计价（v118 修复）；
      删除主机后配件 parentItemId 清理
   3) 双向同步全链路：改词条→账单跟随（名称/金额/日期+调账）；改账单→词条跟随；
      N:1 金额不回写防膨胀；priceManual 单向保护；二手回血收入账单不回写；
      解除关联(keepRec)后互不干扰；防环（交替编辑收敛不漂移）；
      改账单不拆手动词条（v118 P1 修复：曾解除关联并复活重复词条）；
      改账单日期 → fromBill 美食日期跟随（v118 修复：「日期随账单」承诺落地）
   4) 美妆保质期：年数推算限用日期（3 年/闰年 2-29/年末 12-31/0.5 年=v118 修复）；
      编辑改年数重算；年数清空保留旧限用日期；空瓶日期与剩余量同格保存；
      临期提醒用推算后的日期（详情可复核）；「发饰」子类可选可存；
      旧数据分类/子类不在分类树时编辑保存不丢（v118 修复）
   5) 边界：无购买日期填年数被校验拦截；年数 0/负不推算不产坏值；金额 0/负/超大；
      名称空/特殊字符（XSS 转义）；快速重复保存幂等；保存失败回滚（mock 500） */
'use strict';
const { makeWindow, waitFor, waitMain, lastModal, waitNoModal, assert, sleep } = require('./helpers/harness');

let cur = '';

const CATS = {
  digital: [
    { id: 'host', name: '主机类', icon: 'laptop', lifeYears: 5, residualRate: 0.1, children: [{ id: 'host_phone', name: '手机' }, { id: 'host_other', name: '其他主机' }] },
    { id: 'acc', name: '配件', icon: 'x', children: [{ id: 'acc_other', name: '其他配件' }] },
    { id: 'game', name: '游戏', icon: 'x', children: [] }
  ],
  clothing: [{ id: 'top', name: '上装', icon: 'shirt', lifeYears: 3, children: [{ id: 'top_tee', name: 'T恤' }] }],
  life: [
    { id: 'skin', name: '护肤', icon: 'heart', lifeYears: 2, residualRate: 0, children: [{ id: 'sk_cream', name: '面霜' }] },
    { id: 'tool', name: '工具', icon: 'x', children: [{ id: 'tl_hairacc', name: '发饰' }] }
  ],
  remainLevel: ['满', '半', '少', '空']
};

async function openEditor(w, id, kind) {
  w.Views.openItemEditor(id, kind);
  return waitFor(function () {
    const m = lastModal(w.document);
    return m && m.querySelector('[name=name]') ? m : null;
  }, { label: '物品编辑弹窗未出现' });
}

async function openDetail(w, id) {
  w.Views.openItemDetail(id);
  return waitFor(function () {
    const m = lastModal(w.document);
    return m && m.querySelector('.detail-kv') ? m : null;
  }, { label: '物品详情弹窗未出现' });
}

async function closeTop(w) {
  const m = lastModal(w.document);
  if (m) {
    const btn = m.querySelector('.modal-close');
    if (btn) btn.click();
  }
  await waitNoModal(w.document).catch(function () {});
}

function val(m, name) {
  const el = m.querySelector('[name=' + name + ']');
  return el ? el.value : null;
}

function setVal(w, m, name, v) {
  const el = m.querySelector('[name=' + name + ']');
  assert(el, '表单缺字段 ' + name);
  el.value = v;
}

async function main() {
  /* ============================================================
     1) 成本构成明细（真实动线：表单挂靠 → 详情复核 → 解除回落）
     ============================================================ */
  cur = '1. 成本明细：899+4399 挂靠 → 详情「总投入 ¥5,298（购入 ¥899 + 配件 ¥4,399）」';
  {
    const w = makeWindow({
      data: {
        categories: CATS,
        items: [
          { id: 'it-host', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '测试', purchaseDate: '2021-03-23', purchasePrice: 899, status: 'in_use', images: [], tags: [] },
          { id: 'it-acc4399', kind: 'device', categoryId: 'acc', subCategoryId: 'acc_other', name: '挂靠设备', purchaseDate: '2021-03-23', purchasePrice: 4399, status: 'in_use', images: [], tags: [] },
          { id: 'it-rephost', kind: 'device', categoryId: 'host', subCategoryId: 'host_other', name: '维修机', purchaseDate: '2021-03-23', purchasePrice: 899, status: 'in_use', images: [], tags: [] },
          { id: 'it-clo', kind: 'clothing', categoryId: 'top', subCategoryId: 'top_tee', name: '未穿T恤', purchaseDate: '2026-01-01', purchasePrice: 500, status: 'in_use', images: [], tags: [], manualWearCount: 0, useCount: 5 },
          { id: 'it-life0', kind: 'life', categoryId: 'skin', subCategoryId: 'sk_cream', name: '零残值面霜', purchaseDate: '', purchasePrice: 1000, status: 'in_use', images: [], tags: [] },
          { id: 'it-lifez', kind: 'device', categoryId: 'host', subCategoryId: 'host_other', name: '零寿命机', purchaseDate: '', purchasePrice: 1000, status: 'in_use', images: [], tags: [], estimatedLifeYears: 0 }
        ],
        events: [{ id: 'ev-r1', itemId: 'it-rephost', type: 'repair', cost: 300, date: '2023-05-01', note: '换屏' }]
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage, doc = w.document, U = w.Utils;
    await S.loadAll();
    // 固定「已用 365 天」基线（详情折旧断言要可复核）
    const p1y = U.todayStr(U.daysAgo(365));
    ['it-life0', 'it-lifez'].forEach(function (id) {
      const it = S.getDB().items.find(function (x) { return x.id === id; });
      it.purchaseDate = p1y;
    });

    // 动线：配件表单里选「所属主机」挂到测试名下
    let m = await openEditor(w, 'it-acc4399', 'device');
    assert(val(m, 'parentItemId') === '', '未挂靠前应为（无）');
    setVal(w, m, 'parentItemId', 'it-host');
    m.querySelector('[data-act=save]').click();
    await waitFor(function () {
      return S.getDB().items.find(function (x) { return x.id === 'it-acc4399'; }).parentItemId === 'it-host';
    }, { label: '所属主机未保存' });
    await waitNoModal(doc);

    // 详情复核总投入构成 + 配件明细行
    let d = await openDetail(w, 'it-host');
    let txt = d.textContent;
    assert(txt.indexOf('¥5,298（购入 ¥899 + 配件 ¥4,399）') >= 0,
      '详情应显示「总投入 ¥5,298（购入 ¥899 + 配件 ¥4,399）」，实际: ' + txt.slice(0, 500));
    assert(txt.indexOf('挂靠配件「挂靠设备」') >= 0, '应有配件明细行');
    assert(txt.indexOf('¥4,399') >= 0, '配件明细行应带金额');
    await closeTop(w);

    // 维修流水累计显示
    d = await openDetail(w, 'it-rephost');
    txt = d.textContent;
    assert(txt.indexOf('¥1,199（购入 ¥899 + 维修 ¥300）') >= 0,
      '维修应累计进总投入构成，实际: ' + txt.slice(0, 500));
    await closeTop(w);

    // 3 处口径修复验证（详情侧）
    d = await openDetail(w, 'it-clo');
    assert(/每次穿着成本[^]{0,40}尚未穿着/.test(d.textContent.replace(/\s+/g, ' ')),
      '服饰 wearCount=0 次均应显「尚未穿着」');
    await closeTop(w);
    d = await openDetail(w, 'it-life0'); // 分类残值率显式 0（skin）：1000×(0+1×0.5)=500
    assert(d.textContent.indexOf('¥500') >= 0, '分类残值率显式 0 不得被 0.1 吞（现值应 ¥500），实际: ' + d.textContent.slice(0, 400));
    assert(d.textContent.indexOf('¥600') < 0, '若被 0.1 吞会显示 ¥600');
    await closeTop(w);
    d = await openDetail(w, 'it-lifez'); // 寿命 0 落默认 5 年：1000×(0.1+0.9×0.8)=820，不出现负现值
    assert(d.textContent.indexOf('¥820') >= 0, '寿命 0 应落默认 5 年折旧（现值 ¥820），实际: ' + d.textContent.slice(0, 400));
    await closeTop(w);

    // 解除挂靠后回落 899
    m = await openEditor(w, 'it-acc4399', 'device');
    assert(val(m, 'parentItemId') === 'it-host', '再编辑应回显所属主机');
    setVal(w, m, 'parentItemId', '');
    m.querySelector('[data-act=save]').click();
    await waitFor(function () {
      return !S.getDB().items.find(function (x) { return x.id === 'it-acc4399'; }).parentItemId;
    }, { label: '解除挂靠未保存' });
    await waitNoModal(doc);
    d = await openDetail(w, 'it-host');
    assert(d.textContent.indexOf('（购入') < 0 && d.textContent.indexOf('挂靠配件') < 0,
      '解除挂靠后不应再有构成括号/配件行');
    assert(d.textContent.indexOf('¥899') >= 0, '解除挂靠后回落 ¥899');
    assert(d.textContent.indexOf('¥5,298') < 0, '解除挂靠后不得再显示 5298');
    await closeTop(w);
    console.log('PASS ' + cur);
  }

  /* ============================================================
     2) 「所属主机」语义（方向/防自选/防环/删主机清理）
     ============================================================ */
  cur = '2. 所属主机：方向正确 + 不能选自己 + 循环挂靠被拦（v118 修复）+ 删主机清理';
  {
    const w = makeWindow({
      data: {
        categories: CATS,
        items: [
          { id: 'it-a', kind: 'device', categoryId: 'host', subCategoryId: 'host_other', name: '主机A', purchaseDate: '2025-01-01', purchasePrice: 1000, status: 'in_use', images: [], tags: [] },
          { id: 'it-b', kind: 'device', categoryId: 'host', subCategoryId: 'host_other', name: '主机B', purchaseDate: '2025-01-01', purchasePrice: 2000, status: 'in_use', images: [], tags: [] },
          { id: 'it-h', kind: 'device', categoryId: 'host', subCategoryId: 'host_other', name: '待删主机', purchaseDate: '2025-01-01', purchasePrice: 500, status: 'in_use', images: [], tags: [] },
          { id: 'it-c', kind: 'device', categoryId: 'acc', subCategoryId: 'acc_other', name: '配件C', purchaseDate: '2025-01-01', purchasePrice: 300, status: 'in_use', images: [], tags: [], parentItemId: 'it-h' }
        ]
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage, doc = w.document, M = w.Models;
    await S.loadAll();

    // 方向正确：B 挂 A → A 总投入 3000
    let m = await openEditor(w, 'it-b', 'device');
    setVal(w, m, 'parentItemId', 'it-a');
    m.querySelector('[data-act=save]').click();
    await waitFor(function () {
      return S.getDB().items.find(function (x) { return x.id === 'it-b'; }).parentItemId === 'it-a';
    }, { label: 'B 挂 A 未保存' });
    await waitNoModal(doc);
    assert(M.totalInvested(S.getDB(), S.getDB().items.find(function (x) { return x.id === 'it-a'; })) === 3000,
      '挂后主机总投入应增加到 3000（方向正确）');

    // 不能选自己；B 已挂 A → A 的下拉不得再出现 B（循环）
    m = await openEditor(w, 'it-a', 'device');
    const sel = m.querySelector('[name=parentItemId]');
    const optVals = Array.prototype.map.call(sel.options, function (o) { return o.value; });
    assert(optVals.indexOf('it-a') < 0, '主机自身不能出现在「所属主机」下拉');
    assert(optVals.indexOf('it-b') < 0, '循环挂靠候选（B 已挂 A）不得出现在下拉（v118 修复）');
    // 伪造提交（表单被篡改塞回 B）也要被 readItemForm 丢弃
    const forged = doc.createElement('option');
    forged.value = 'it-b'; forged.textContent = '主机B';
    sel.appendChild(forged);
    sel.value = 'it-b';
    m.querySelector('[data-act=save]').click();
    await waitFor(function () { return !lastModal(doc); }, { label: '保存未收尾' });
    const a2 = S.getDB().items.find(function (x) { return x.id === 'it-a'; });
    assert(!a2.parentItemId, '循环挂靠（A↔B）即便被伪造提交也应丢弃（v118 修复）');

    // 模型层防环：脏数据互挂不得互相重复计价（也不得死循环）
    a2.parentItemId = 'it-b';
    S.getDB().items.find(function (x) { return x.id === 'it-b'; }).parentItemId = 'it-a';
    const db2 = S.getDB();
    assert(M.totalInvested(db2, a2) === 1000, '循环挂靠不得把父机价格计入自身总投入，实为 ' + M.totalInvested(db2, a2));
    assert(M.totalInvested(db2, db2.items.find(function (x) { return x.id === 'it-b'; })) === 2000,
      '对向亦然，实为 ' + M.totalInvested(db2, db2.items.find(function (x) { return x.id === 'it-b'; })));

    // 删除主机 → 配件 parentItemId 清理
    await S.removeItem('it-h');
    const c2 = S.getDB().items.find(function (x) { return x.id === 'it-c'; });
    assert(c2 && !c2.parentItemId, '删除主机后配件 parentItemId 应清理');
    console.log('PASS ' + cur);
  }

  /* ============================================================
     3a) 双向同步：1:1 全跟 + N:1 防膨胀 + priceManual + 回血保护 + keepRec + 防环
     ============================================================ */
  cur = '3a. 双向同步：1:1/N:1/priceManual/回血/keepRec/防环/调账';
  {
    const w = makeWindow({
      data: {
        categories: CATS,
        items: [
          { id: 'it1', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '旧手机', purchaseDate: '2025-06-01', purchasePrice: 3000, status: 'in_use', images: [], tags: [], linkedBillIds: ['bl-1'], fromBill: 'bl-1' },
          { id: 'it2', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '分期机', purchaseDate: '2025-06-01', purchasePrice: 100, status: 'in_use', images: [], tags: [], linkedBillIds: ['bl-a', 'bl-b'], fromBill: 'bl-a' },
          { id: 'it-res', kind: 'device', categoryId: 'host', subCategoryId: 'host_other', name: '旧耳机', purchaseDate: '2025-01-01', purchasePrice: 800, status: 'sold', soldPrice: 300, soldDate: '2026-01-01', images: [], tags: [], linkedBillIds: ['bl-buy', 'bl-sell'], fromBill: 'bl-buy' },
          { id: 'it7', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '收敛机', purchaseDate: '2025-06-01', purchasePrice: 3000, status: 'in_use', images: [], tags: [], linkedBillIds: ['bl-7'], fromBill: 'bl-7' }
        ],
        food: [
          { id: 'fd1', date: '2026-01-02', meal: '午餐', foodCuisine: '其他', name: '午饭', price: 50, priceManual: true, note: '', tags: [], images: [], linkedBillIds: ['fl-1'], fromBill: 'fl-1' }
        ],
        wallet: {
          accounts: [{ id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 1000, note: '' }],
          bills: [
            { id: 'bl-1', type: 'expense', amount: 3000, date: '2025-06-01', time: '', catId: 'w_shop', subCatId: 'w_shop_digital', accountId: 'ac_cash', note: '旧手机', tagIds: [], itemId: 'it1', source: 'manual' },
            { id: 'bl-a', type: 'expense', amount: 30, date: '2025-06-01', time: '', catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '分期机', tagIds: [], itemId: 'it2', source: 'manual' },
            { id: 'bl-b', type: 'expense', amount: 70, date: '2025-06-05', time: '', catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '分期机', tagIds: [], itemId: 'it2', source: 'manual' },
            { id: 'bl-buy', type: 'expense', amount: 800, date: '2025-01-01', time: '', catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '旧耳机', tagIds: [], itemId: 'it-res', source: 'manual' },
            { id: 'bl-sell', type: 'income', amount: 300, date: '2026-01-01', time: '', catId: 'w_in_resale', subCatId: 'w_in_resale', accountId: '', note: '旧耳机', tagIds: [], itemId: 'it-res', source: 'manual' },
            { id: 'bl-7', type: 'expense', amount: 3000, date: '2025-06-01', time: '', catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '收敛机', tagIds: [], itemId: 'it7', source: 'manual' },
            { id: 'fl-1', type: 'expense', amount: 50, date: '2026-01-02', time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: 'ac_cash', note: '午饭', tagIds: [], foodId: 'fd1', source: 'manual' }
          ]
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    await S.loadAll();
    let db = S.getDB();

    // (a) 改词条名称/金额/日期 → 账单跟随 + 调账（1:1）
    const it1 = JSON.parse(JSON.stringify(db.items.find(function (i) { return i.id === 'it1'; })));
    it1.name = '新手机Pro'; it1.purchasePrice = 3500; it1.purchaseDate = '2025-06-02';
    await S.saveItem(it1);
    db = S.getDB();
    const b1 = db.wallet.bills.find(function (b) { return b.id === 'bl-1'; });
    assert(b1.note === '新手机Pro' && Number(b1.amount) === 3500 && b1.date === '2025-06-02', '1:1 词条改 → 账单应全跟');
    assert(Math.round(db.wallet.accounts[0].balance) === 500, '改金额应同步调账（1000+3000-3500=500）: ' + db.wallet.accounts[0].balance);

    // (b) N:1：改词条金额/日期 → 账单不回写（防膨胀）；改账单 → 词条按合计重算
    const it2 = JSON.parse(JSON.stringify(db.items.find(function (i) { return i.id === 'it2'; })));
    it2.purchasePrice = 999; it2.purchaseDate = '2025-06-09';
    await S.saveItem(it2);
    db = S.getDB();
    const ba = db.wallet.bills.find(function (b) { return b.id === 'bl-a'; });
    const bb = db.wallet.bills.find(function (b) { return b.id === 'bl-b'; });
    assert(Number(ba.amount) === 30 && Number(bb.amount) === 70, 'N:1 金额不得回写（防膨胀）');
    assert(ba.date === '2025-06-01' && bb.date === '2025-06-05', 'N:1 日期不得回写（保留分期真实日期）');
    const baRec = JSON.parse(JSON.stringify(ba)); delete baRec.itemId; baRec.amount = 40;
    await S.saveBill(baRec);
    db = S.getDB();
    assert(Number(db.items.find(function (i) { return i.id === 'it2'; }).purchasePrice) === 110,
      'fromBill 合并词条金额=账单合计（40+70=110），实为 ' + db.items.find(function (i) { return i.id === 'it2'; }).purchasePrice);

    // (c) priceManual：美食手改价回写账单；账单再编辑不改回（A7）
    const fd1 = JSON.parse(JSON.stringify(db.food.find(function (f) { return f.id === 'fd1'; })));
    fd1.price = 66; fd1.priceManual = true; fd1.name = '商务午餐';
    await S.saveFood(fd1);
    db = S.getDB();
    assert(Number(db.wallet.bills.find(function (b) { return b.id === 'fl-1'; }).amount) === 66, 'priceManual 手改价应回写账单');
    const flRec = JSON.parse(JSON.stringify(db.wallet.bills.find(function (b) { return b.id === 'fl-1'; })));
    delete flRec.foodId; flRec.amount = 120;
    await S.saveBill(flRec);
    db = S.getDB();
    assert(Number(db.food.find(function (f) { return f.id === 'fd1'; }).price) === 66,
      '账单再编辑不得改回 priceManual 美食价');
    assert(Number(db.wallet.bills.find(function (b) { return b.id === 'fl-1'; }).amount) === 120, '账单编辑应落库');

    // (d) 二手回血收入账单不回写
    const itRes = JSON.parse(JSON.stringify(db.items.find(function (i) { return i.id === 'it-res'; })));
    itRes.name = '旧耳机改'; itRes.purchasePrice = 900;
    await S.saveItem(itRes);
    db = S.getDB();
    const sell = db.wallet.bills.find(function (b) { return b.id === 'bl-sell'; });
    assert(sell.note === '旧耳机' && Number(sell.amount) === 300, '二手回血收入账单不得被购入字段污染');
    assert(Number(db.wallet.bills.find(function (b) { return b.id === 'bl-buy'; }).amount) === 900, '购入支出账单应跟随');

    // (e) 防环：账单↔词条交替编辑收敛、重复保存幂等不漂移
    for (const amt of [3100, 3200, 3300, 3400]) {
      const rec = JSON.parse(JSON.stringify(S.getDB().wallet.bills.find(function (b) { return b.id === 'bl-7'; })));
      delete rec.itemId; rec.amount = amt;
      await S.saveBill(rec);
      const it = JSON.parse(JSON.stringify(S.getDB().items.find(function (i) { return i.id === 'it7'; })));
      it.purchasePrice = amt + 100;
      await S.saveItem(it);
    }
    await S.saveItem(JSON.parse(JSON.stringify(S.getDB().items.find(function (i) { return i.id === 'it7'; }))));
    db = S.getDB();
    const fin = db.wallet.bills.find(function (b) { return b.id === 'bl-7'; });
    const finIt = db.items.find(function (i) { return i.id === 'it7'; });
    assert(Number(fin.amount) === 3500 && Number(finIt.purchasePrice) === 3500,
      '交替编辑应收敛一致不漂移: bill=' + fin.amount + ' item=' + finIt.purchasePrice);
    assert(db.items.filter(function (i) { return i.name === '收敛机'; }).length === 1, '防环：不得派生重复词条');

    // (f) keepRec 解除后互不干扰
    await S.saveBill({ id: 'bl-e', type: 'expense', amount: 66, date: '2026-03-01', time: '', catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '解绑机', tagIds: [], source: 'manual' });
    db = S.getDB();
    const autoE = db.items.find(function (i) { return i.name === '解绑机'; });
    assert(autoE, '前置：应自动生成词条');
    await S.unlinkBillSync('bl-e', true);
    const eClone = JSON.parse(JSON.stringify(S.getDB().items.find(function (i) { return i.id === autoE.id; })));
    eClone.name = '解绑机改'; eClone.purchasePrice = 88;
    await S.saveItem(eClone);
    db = S.getDB();
    assert(Number(db.wallet.bills.find(function (b) { return b.id === 'bl-e'; }).amount) === 66 &&
      db.wallet.bills.find(function (b) { return b.id === 'bl-e'; }).note === '解绑机',
      'keepRec 解除后账单不得再被词条回写');
    const eRec = JSON.parse(JSON.stringify(db.wallet.bills.find(function (b) { return b.id === 'bl-e'; })));
    delete eRec.itemId; eRec.amount = 99; eRec.note = '解绑机再改';
    await S.saveBill(eRec);
    db = S.getDB();
    assert(db.items.find(function (i) { return i.id === autoE.id; }).name === '解绑机改',
      'keepRec 解除后词条不得被账单回写');
    assert(db.items.filter(function (i) { return i.name === '解绑机再改'; }).length === 0, '解除后不得复活重复词条');
    console.log('PASS ' + cur);
  }

  /* ============================================================
     3b) 改账单 → 词条跟随（手动词条不拆条）+ 美食日期随账单（v118 修复）
     ============================================================ */
  cur = '3b. 改账单不拆手动词条（v118 P1）+ fromBill 美食日期随账单（v118）';
  {
    const w = makeWindow({
      data: {
        categories: CATS,
        items: [
          { id: 'it-man', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '测试机', purchaseDate: '2025-06-01', purchasePrice: 899, status: 'in_use', images: [], tags: [] },
          { id: 'it-auto', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '自动机', purchaseDate: '2025-06-01', purchasePrice: 3000, status: 'in_use', images: [], tags: [], linkedBillIds: ['bl-auto'], fromBill: 'bl-auto' }
        ],
        food: [
          { id: 'fd-auto', date: '2026-03-01', meal: '午餐', foodCuisine: '其他', name: '午饭', price: 50, note: '', tags: [], images: [], linkedBillIds: ['fl-auto'], fromBill: 'fl-auto' },
          { id: 'fd-man', date: '2026-03-02', meal: '晚餐', foodCuisine: '其他', name: '晚饭', price: 40, note: '', tags: [], images: [] }
        ],
        wallet: {
          accounts: [],
          bills: [
            { id: 'bl-auto', type: 'expense', amount: 3000, date: '2025-06-01', time: '', catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '自动机', tagIds: [], itemId: 'it-auto', source: 'manual' },
            { id: 'fl-auto', type: 'expense', amount: 50, date: '2026-03-01', time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '午饭', tagIds: [], foodId: 'fd-auto', source: 'manual' }
          ]
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    await S.loadAll();

    // (a) 手动物品 + 一键生成购入账单 → 编辑账单（改备注+金额）不得拆条/复活重复词条
    const man = JSON.parse(JSON.stringify(S.getDB().items.find(function (i) { return i.id === 'it-man'; })));
    const genBill = await S.addBillFromItem(man);
    let db = S.getDB();
    assert(db.wallet.bills.some(function (b) { return b.id === genBill.id && b.itemId === 'it-man'; }), '前置：生成的购入账单应挂到手动物品');
    const rec = JSON.parse(JSON.stringify(db.wallet.bills.find(function (b) { return b.id === genBill.id; })));
    delete rec.itemId;
    rec.note = '测试机改'; rec.amount = 999;
    await S.saveBill(rec);
    db = S.getDB();
    assert(db.items.filter(function (i) { return i.kind !== 'life'; }).length === 2,
      'P1：改账单备注不得派生重复词条/拆条，实为 ' + db.items.length + ' 条: ' + db.items.map(function (i) { return i.name; }).join(','));
    const man2 = db.items.find(function (i) { return i.id === 'it-man'; });
    assert(man2.name === '测试机改', '改账单 → 手动词条名称应跟随（就地改名）: ' + man2.name);
    assert(Number(man2.purchasePrice) === 899, '手动词条金额只补空不覆盖（既定口径）: ' + man2.purchasePrice);
    assert(db.wallet.bills.find(function (b) { return b.id === genBill.id; }).itemId === 'it-man', '关联不得被解除');
    assert((man2.linkedBillIds || []).indexOf(genBill.id) >= 0, 'linkedBillIds 应保留');
    // 反向再改名 → 账单跟随（1:1）
    const man3 = JSON.parse(JSON.stringify(man2));
    man3.name = '测试机三改';
    await S.saveItem(man3);
    db = S.getDB();
    assert(db.wallet.bills.find(function (b) { return b.id === genBill.id; }).note === '测试机三改', '词条改名账单应回跟');

    // (b) fromBill 美食：改账单日期 → 美食日期跟随（「日期随账单」承诺）
    const flRec = JSON.parse(JSON.stringify(S.getDB().wallet.bills.find(function (b) { return b.id === 'fl-auto'; })));
    delete flRec.foodId;
    flRec.date = '2026-03-05';
    await S.saveBill(flRec);
    db = S.getDB();
    assert(db.food.find(function (f) { return f.id === 'fd-auto'; }).date === '2026-03-05',
      'P1：改账单日期 → fromBill 美食日期应跟随（v118 修复），实为 ' + db.food.find(function (f) { return f.id === 'fd-auto'; }).date);
    assert(db.food.filter(function (f) { return f.name === '午饭'; }).length === 1, '日期跟随不得拆条');

    // (c) 手动美食与正餐账单合并后改账单备注 → 不拆条、就地改名、价格不动
    await S.saveBill({ id: 'fl-man', type: 'expense', amount: 40, date: '2026-03-02', time: '', catId: 'w_food', subCatId: 'w_food_dinner', accountId: '', note: '晚饭', tagIds: [], source: 'manual' });
    db = S.getDB();
    assert(db.wallet.bills.find(function (b) { return b.id === 'fl-man'; }).foodId === 'fd-man', '前置：同日同名应合并进手动美食');
    const fmRec = JSON.parse(JSON.stringify(db.wallet.bills.find(function (b) { return b.id === 'fl-man'; })));
    delete fmRec.foodId;
    fmRec.note = '晚饭改';
    await S.saveBill(fmRec);
    db = S.getDB();
    assert(db.food.length === 2, 'P1：改账单备注不得拆出手动美食重复条目，实为 ' + db.food.length);
    const fm = db.food.find(function (f) { return f.id === 'fd-man'; });
    assert(fm.name === '晚饭改', '手动美食名称应就地跟随备注: ' + fm.name);
    assert(Number(fm.price) === 40, '手动美食价格只补空不覆盖: ' + fm.price);
    assert(db.wallet.bills.find(function (b) { return b.id === 'fl-man'; }).foodId === 'fd-man', '美食关联不得被解除');
    console.log('PASS ' + cur);
  }

  /* ============================================================
     4) 美妆保质期：年数推算/重算/清空保留/空瓶/临期/发饰/旧数据兜底
     ============================================================ */
  cur = '4. 美妆保质期：年数推算（含 0.5 年/闰年/年末）+ 空瓶同格 + 发饰 + 旧分类兜底';
  {
    const w = makeWindow({ data: { categories: CATS } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage, doc = w.document;
    await S.loadAll();

    async function addLife(name, date, price, years) {
      const m = await openEditor(w, null, 'life');
      setVal(w, m, 'name', name);
      setVal(w, m, 'categoryId', 'skin');
      setVal(w, m, 'purchaseDate', date);
      setVal(w, m, 'purchasePrice', price);
      setVal(w, m, 'shelfYears', years);
      m.querySelector('[data-act=save]').click();
      await waitFor(function () {
        return S.getDB().items.some(function (i) { return i.name === name; });
      }, { label: name + ' 未保存' });
      await waitNoModal(doc);
      return S.getDB().items.find(function (i) { return i.name === name; });
    }

    // 年数 3 + 2024-01-15 → 2027-01-15（表单真实保存路径）
    let it = await addLife('面霜A', '2024-01-15', '300', '3');
    assert(it.expiryDate === '2027-01-15' && it.shelfYears === 3, '推算限用日期应 2027-01-15，实为 ' + it.expiryDate);
    // 闰年 2-29 + 1 年 → 2-28（不出月）
    it = await addLife('闰年霜', '2024-02-29', '100', '1');
    assert(it.expiryDate === '2025-02-28', '闰年 2-29+N 年应回退到 2-28，实为 ' + it.expiryDate);
    // 年末 12-31 + 2 年 → 12-31
    it = await addLife('年末霜', '2023-12-31', '100', '2');
    assert(it.expiryDate === '2025-12-31', '年末 12-31+N 年应保持 12-31，实为 ' + it.expiryDate);
    // 0.5 年 = 6 个月（v118 修复：曾被小数年截断成 0 天偏移=当天到期）
    it = await addLife('半年霜', '2024-08-31', '100', '0.5');
    assert(it.expiryDate === '2025-02-28', '0.5 年应=+6 个月（8-31→次年 2 月末），实为 ' + it.expiryDate);

    // 编辑改年数重算；年数清空保留旧限用日期（旧数据兼容）
    let m = await openEditor(w, S.getDB().items.find(function (i) { return i.name === '面霜A'; }).id, 'life');
    setVal(w, m, 'shelfYears', '2');
    m.querySelector('[data-act=save]').click();
    await waitFor(function () {
      return S.getDB().items.find(function (i) { return i.name === '面霜A'; }).expiryDate === '2026-01-15';
    }, { label: '改年数未重算' });
    await waitNoModal(doc);
    m = await openEditor(w, S.getDB().items.find(function (i) { return i.name === '面霜A'; }).id, 'life');
    setVal(w, m, 'shelfYears', '');
    // 空瓶日期与剩余量同格保存
    setVal(w, m, 'remainLevel', '空');
    setVal(w, m, 'emptyDate', '2026-05-01');
    m.querySelector('[data-act=save]').click();
    await waitFor(function () {
      return S.getDB().items.find(function (i) { return i.name === '面霜A'; }).emptyDate === '2026-05-01';
    }, { label: '空瓶日期未保存' });
    await waitNoModal(doc);
    const a2 = S.getDB().items.find(function (i) { return i.name === '面霜A'; });
    assert(a2.expiryDate === '2026-01-15', '年数清空应保留旧限用日期，实为 ' + a2.expiryDate);
    assert(a2.shelfYears === null && a2.remainLevel === '空' && a2.emptyDate === '2026-05-01', '年数清空/空瓶同格应各自落库');

    // 临期提醒用推算后的日期：详情可复核（限用日期=推算值 + 剩余天数状态）
    const leapId = S.getDB().items.find(function (i) { return i.name === '闰年霜'; }).id;
    let d = await openDetail(w, leapId);
    let txt = d.textContent;
    assert(/限用日期\s*2025-02-28/.test(txt), '详情应显示推算的限用日期，实际: ' + txt.slice(0, 400));
    assert(txt.indexOf('已过期') >= 0, '过期的限用日期应带状态提示');
    assert(/未开封保质期\s*1 年/.test(txt), '详情应显示未开封保质期年数');
    await closeTop(w);
    const aId = S.getDB().items.find(function (i) { return i.name === '面霜A'; }).id;
    d = await openDetail(w, aId);
    assert(/空瓶日期\s*2026-05-01/.test(d.textContent), '详情空瓶日期行应展示同格保存的空瓶日期');
    assert(/限用日期\s*2026-01-15/.test(d.textContent), '详情限用日期应保留年数清空前的旧值');
    await closeTop(w);

    // 「发饰」子类可选可存
    m = await openEditor(w, null, 'life');
    setVal(w, m, 'name', '蝴蝶结');
    setVal(w, m, 'categoryId', 'tool');
    m.querySelector('[name=categoryId]').dispatchEvent(new w.Event('change'));
    setVal(w, m, 'subCategoryId', 'tl_hairacc');
    setVal(w, m, 'purchaseDate', '2026-01-01');
    setVal(w, m, 'purchasePrice', '20');
    m.querySelector('[data-act=save]').click();
    await waitFor(function () {
      return S.getDB().items.some(function (i) { return i.name === '蝴蝶结'; });
    }, { label: '发饰未保存' });
    await waitNoModal(doc);
    const hair = S.getDB().items.find(function (i) { return i.name === '蝴蝶结'; });
    assert(hair.subCategoryId === 'tl_hairacc', '「发饰」子类应可存，实为 ' + hair.subCategoryId);

    // 旧数据分类/子类不在分类树：编辑保存不得丢（v118 修复）
    S.getDB().items.push({
      id: 'it-old', kind: 'life', categoryId: 'skin', subCategoryId: 'sk_gone', name: '旧分类霜',
      purchaseDate: '2025-01-01', purchasePrice: 60, status: 'in_use', images: [], tags: []
    });
    await S.saveItem(S.getDB().items.find(function (i) { return i.id === 'it-old'; }));
    m = await openEditor(w, 'it-old', 'life');
    const subSel = m.querySelector('[name=subCategoryId]');
    assert(subSel.value === 'sk_gone', '不在分类树的子类应回显占位（v118 修复），实为 ' + subSel.value);
    m.querySelector('[data-act=save]').click();
    await waitFor(function () { return !lastModal(doc); }, { label: '旧分类保存未收尾' });
    assert(S.getDB().items.find(function (i) { return i.id === 'it-old'; }).subCategoryId === 'sk_gone',
      '旧数据子类不得被静默清空（v118 修复）');
    console.log('PASS ' + cur);
  }

  /* ============================================================
     5) 边界：校验拦截/年数 0 负/金额边界/特殊字符/快速重复保存/失败回滚
     ============================================================ */
  cur = '5. 边界：无日期填年数拦截 / 年数 0 负 / 金额 0 负超大 / XSS / 幂等 / 失败回滚';
  {
    const w = makeWindow({ data: { categories: CATS } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage, doc = w.document, M = w.Models;
    await S.loadAll();

    // 无购买日期填年数 → 校验拦截（不会存出"年数生效但无推算源"的半截数据）
    let m = await openEditor(w, null, 'life');
    setVal(w, m, 'name', '无日期霜');
    setVal(w, m, 'categoryId', 'skin');
    setVal(w, m, 'purchaseDate', ''); // 新建表单默认预填今天，须显式清掉
    setVal(w, m, 'purchasePrice', '10');
    setVal(w, m, 'shelfYears', '3');
    m.querySelector('[data-act=save]').click();
    await sleep(300);
    const toast1 = doc.getElementById('toast-box');
    assert(toast1 && toast1.textContent.indexOf('购买日期必填') >= 0, '无购买日期应被校验拦截: ' + (toast1 ? toast1.textContent : ''));
    assert(!S.getDB().items.some(function (i) { return i.name === '无日期霜'; }), '拦截后不得落库');
    // 年数 0/负：清空该字段再存（0/负=不推算、不产坏值）
    setVal(w, m, 'purchaseDate', '2026-01-01');
    setVal(w, m, 'shelfYears', '0');
    m.querySelector('[data-act=save]').click();
    await waitFor(function () {
      return S.getDB().items.some(function (i) { return i.name === '无日期霜'; });
    }, { label: '0 年数保存失败' });
    await waitNoModal(doc);
    let it = S.getDB().items.find(function (i) { return i.name === '无日期霜'; });
    assert(!it.expiryDate, '年数 0 不应推算限用日期');
    m = await openEditor(w, it.id, 'life');
    setVal(w, m, 'shelfYears', '-3');
    m.querySelector('[data-act=save]').click();
    await waitFor(function () { return !lastModal(doc); }, { label: '负年数保存未收尾' });
    it = S.getDB().items.find(function (i) { return i.name === '无日期霜'; });
    assert(it.shelfYears === 0 && !it.expiryDate, '负年数应钳到 0 且不推算，实为 ' + JSON.stringify(it.shelfYears) + '/' + it.expiryDate);

    // 名称空 → 拦截；特殊字符 → 落库 + 详情转义（XSS 防护）
    m = await openEditor(w, null, 'device');
    setVal(w, m, 'categoryId', 'host');
    setVal(w, m, 'purchaseDate', '2026-01-01');
    setVal(w, m, 'purchasePrice', '10');
    m.querySelector('[data-act=save]').click();
    await sleep(300);
    assert(doc.getElementById('toast-box').textContent.indexOf('名称必填') >= 0, '空名称应被拦截');
    const evil = '<img src=x onerror=alert(1)>"&';
    setVal(w, m, 'name', evil);
    m.querySelector('[data-act=save]').click();
    await waitFor(function () {
      return S.getDB().items.some(function (i) { return i.name === evil; });
    }, { label: '特殊字符名称未保存' });
    await waitNoModal(doc);
    const evilId = S.getDB().items.find(function (i) { return i.name === evil; }).id;
    const d = await openDetail(w, evilId);
    assert(d.querySelector('h3').textContent === evil, '特殊字符名称应原样显示（转义渲染）');
    assert(!d.querySelector('h3 img'), '名称不得作为 HTML 注入（XSS）');
    await closeTop(w);

    // 金额 0/负/超大：负价按 0 兜底（日均不为负）、超大可算
    const neg = { id: 'it-neg', kind: 'device', categoryId: 'host', subCategoryId: 'host_other', name: '负价机', purchaseDate: '2021-03-23', purchasePrice: -899, status: 'in_use', images: [], tags: [] };
    const big = { id: 'it-big', kind: 'device', categoryId: 'host', subCategoryId: 'host_other', name: '超大机', purchaseDate: '2021-03-23', purchasePrice: 999999999999, status: 'in_use', images: [], tags: [] };
    await S.saveItem(neg); await S.saveItem(big);
    const cn = M.calcItemCost(S.getDB(), neg);
    assert(cn.invested === 0 && cn.dailyCost === 0, '负购入价按 0 兜底');
    const cb = M.calcItemCost(S.getDB(), big);
    assert(cb.invested === 999999999999 && isFinite(cb.dailyCost) && cb.dailyCost > 0, '超大金额可算且日均为有限正数');

    // 快速重复保存：幂等、不拆条、金额不漂（新建默认勾选「同时记账」已挂 1 笔购入账单）
    const linked = S.getDB().items.find(function (i) { return i.id === evilId; });
    assert(S.billsOfItem(evilId).length === 1, '新建默认同时记账应已生成购入账单');
    assert(Number(S.billsOfItem(evilId)[0].amount) === 10, '购入账单金额应=购入价 10');
    const before = S.getDB().wallet.bills.length;
    await S.saveItem(JSON.parse(JSON.stringify(S.getDB().items.find(function (i) { return i.id === evilId; }))));
    await S.saveItem(JSON.parse(JSON.stringify(S.getDB().items.find(function (i) { return i.id === evilId; }))));
    await S.saveItem(JSON.parse(JSON.stringify(S.getDB().items.find(function (i) { return i.id === evilId; }))));
    const db5 = S.getDB();
    assert(db5.wallet.bills.length === before, '快速重复保存不得增生账单');
    assert(db5.items.filter(function (i) { return i.name === evil; }).length === 1, '快速重复保存不得拆条');
    assert((db5.items.find(function (i) { return i.id === evilId; }).linkedBillIds || []).length === 1,
      'linkedBillIds 不得膨胀: ' + JSON.stringify(db5.items.find(function (i) { return i.id === evilId; }).linkedBillIds));
    assert(Number(S.billsOfItem(evilId)[0].amount) === 10, '重复保存金额不漂');
    console.log('PASS ' + cur);
  }

  /* ---------- 5b 保存失败回滚（mock 500，独立窗口） ---------- */
  cur = '5b. 保存失败回滚：mock 500 → 内存与磁盘旧态一致';
  {
    let failSave = true;
    const w = makeWindow({
      data: {
        categories: CATS,
        items: [{ id: 'it-f', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '原名机', purchaseDate: '2025-01-01', purchasePrice: 100, status: 'in_use', images: [], tags: [] }]
      },
      routes: {
        'api/save': function (h) {
          if (failSave) return h.fail({ error: '磁盘写入失败' }, 500);
          return undefined; // 未接管时走默认路由
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage, doc = w.document;
    await S.loadAll();
    const m = await openEditor(w, 'it-f', 'device');
    setVal(w, m, 'name', '改名失败机');
    m.querySelector('[data-act=save]').click();
    await waitFor(function () {
      const t = doc.getElementById('toast-box');
      return t && t.textContent.indexOf('保存失败') >= 0;
    }, { label: '失败提示未出现' });
    failSave = false;
    await waitFor(function () {
      return S.getDB().items.find(function (i) { return i.id === 'it-f'; }).name === '原名机';
    }, { label: '保存失败后应整体重载回滚' });
    assert(S.getDB().items.find(function (i) { return i.id === 'it-f'; }).name === '原名机',
      '保存失败回滚：内存应与磁盘旧态一致');
    console.log('PASS ' + cur);
  }

  console.log('========== v118 成本/同步/保质期模拟动线：全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
