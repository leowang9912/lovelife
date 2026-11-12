/* v110-wallet.test.js — v1.1.0 钱袋 v2：记账 / 自动词条同步 / 分类体系 / 统计合并 */
'use strict';
const { makeWindow, waitFor, sleep, waitMain, lastModal } = require('./helpers/harness');

let cur = '';

const items = [];
let settings = { idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} }, planSections: [], rememberAccount: true };

async function main() {
  const w = makeWindow({
    data: {
      items: items,
      settings: settings,
      categories: {
        digital: [
          { id: 'host', name: '主机类', icon: 'laptop', children: [{ id: 'host_phone', name: '手机' }, { id: 'host_other', name: '其他主机' }] },
          { id: 'camera', name: '影像类', icon: 'camera', children: [{ id: 'cam_other', name: '其他' }] }
        ],
        clothing: [{ id: 'top', name: '上装', icon: 'shirt', children: [{ id: 'top_tee', name: 'T恤' }] }],
        life: [{ id: 'skin', name: '护肤', icon: 'heart', children: [{ id: 'skin_other', name: '其他' }] }],
        tagPresets: []
      },
      wallet: {
        accounts: [
          { id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 1000, note: '' },
          { id: 'ac_bank', name: '银行卡', icon: 'credit-card', type: 'bank', balance: 5000, note: '' }
        ],
        cats: {
          expense: [
            { id: 'w_food', name: '食品餐饮', icon: 'color_ic_parent_restaurant', children: [
              { id: 'w_food_breakfast', name: '早餐', icon: 'color_ic_restaurant_breakfast' },
              { id: 'w_food_lunch', name: '午餐', icon: 'color_ic_restaurant_lunch' }
            ] },
            { id: 'w_shop', name: '购物消费', icon: 'color_ic_parent_shopping', children: [
              { id: 'w_shop_digital', name: '手机数码', icon: 'color_ic_shopping_phone' },
              { id: 'w_shop_clothing', name: '服饰运动', icon: 'color_ic_shopping_motion' },
              { id: 'w_shop_beauty', name: '个护美妆', icon: 'color_ic_shopping_makeup' }
            ] }
          ],
          income: [
            { id: 'w_in_wages', name: '工资', icon: 'color_ic_income_wages', children: [] },
            { id: 'w_in_resale', name: '二手闲置', icon: 'color_ic_income_second_hand', children: [] }
          ]
        },
        syncMap: { w_shop_digital: 'digital', w_shop_clothing: 'clothing', w_shop_beauty: 'life' }
      }
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;

  // 1 钱袋页：设置页同款顶部标签
  cur = '1. 顶部标签栏';
  w.App.go('wallet');
  await waitFor(function () { return doc.getElementById('btn-add-bill'); }, { label: '钱袋页渲染' });
  const tabs = Array.from(doc.querySelectorAll('#wallet-tabs .stab-btn')).map(b => b.textContent.trim());
  if (!tabs.length) throw new Error('缺顶部标签栏');
  if (!doc.getElementById('btn-add-bill')) throw new Error('缺记一笔按钮');
  // v1.1.3：旧备注已删、页面头部与其他页面一致
  if (doc.body.textContent.indexOf('词条自动同步到') >= 0) throw new Error('旧备注未删除');
  if (!doc.querySelector('.page-head > h2')) throw new Error('页面标题结构与其他页面不一致');
  // 分类一览归属设置页（导入导出与分类管理在设置页）
  w.App.go('settings');
  await waitFor(function () { return doc.body.textContent.indexOf('分类一览') >= 0; }, { label: '设置页分类一览' });
  if (doc.body.textContent.indexOf('分类一览') < 0) throw new Error('设置页缺分类一览');
  w.App.go('wallet');
  await waitFor(function () { return doc.getElementById('btn-add-bill'); }, { label: '钱袋页渲染' });
  console.log('PASS ' + cur + '：' + tabs.join(' / '));

  // 2 分类复刻：记账弹窗图标网格用内置彩色图标；设置页有紧凑分类一览
  cur = '2. 主流记账分类 PNG + 设置页分类一览/账单导入导出';
  doc.getElementById('btn-add-bill').click();
  let m0 = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#yw-amt') ? m : null;
  }, { label: '记账弹窗出现' });
  const pngs = Array.from(m0.querySelectorAll('img[src*=cat-icons]'));
  if (pngs.length < 3) throw new Error('分类图标未用内置彩色图标: ' + pngs.length);
  if (pngs[0].src.indexOf('color_ic_') < 0) throw new Error('图标命名不合规');
  m0.querySelector('[data-x=c]').click();
  await waitFor(function () { return !doc.body.contains(m0); }, { label: '记账弹窗关闭' });
  w.App.go('settings');
  await waitFor(function () {
    const t = doc.body.textContent;
    return t.indexOf('食品餐饮') >= 0 && t.indexOf('导出账单') >= 0;
  }, { label: '设置页分类一览渲染' });
  const stext = doc.body.textContent;
  ['食品餐饮', '购物消费', '手机数码', '个护美妆', '工资'].forEach(function (name) {
    if (stext.indexOf(name) < 0) throw new Error('设置页分类一览缺 ' + name);
  });
  if (stext.indexOf('账单导入') < 0) throw new Error('设置页缺账单导入导出');
  if (stext.indexOf('导出账单') < 0) throw new Error('设置页缺导出账单');
  w.App.go('wallet');
  await waitFor(function () { return doc.getElementById('btn-add-bill'); }, { label: '钱袋页渲染' });
  console.log('PASS ' + cur);

  // 3 记一笔：图标网格选分类 + 数字键盘输入 + 保存
  cur = '3. 记一笔（图标网格 + 数字键盘 + 大写金额）';
  doc.getElementById('btn-add-bill').click();
  let modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#yw-amt') ? m : null;
  }, { label: '记账弹窗出现' });
  if (!modal.querySelector('#yw-amt')) throw new Error('缺金额输入框');
  if (!modal.querySelector('.yw-cat-grid')) throw new Error('缺分类图标网格');
  if (modal.querySelector('#bf-cat')) throw new Error('不应再有下拉框分类');
  // 点一级「购物消费」→ 二级「手机数码」
  modal.querySelector('[data-parent="w_shop"]').click();
  modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('[data-sub="w_shop_digital"]') ? m : null;
  }, { label: '二级分类渲染' });
  modal.querySelector('[data-sub="w_shop_digital"]').click();
  // 金额输入框 + 人民币大写实时转换
  const amt1 = lastModal(doc).querySelector('#yw-amt');
  amt1.value = '4999';
  amt1.dispatchEvent(new w.Event('input'));
  if (lastModal(doc).querySelector('#yw-amt-cn').textContent.indexOf('肆仟玖佰玖拾玖') < 0) throw new Error('缺人民币大写');
  lastModal(doc).querySelector('#yw-note').value = 'iPhone 17 Pro';
  lastModal(doc).querySelector('#yw-acc').value = 'ac_cash'; // 显式选账户（默认不区分见 12）
  lastModal(doc).querySelector('[data-x="s"]').click();
  await waitFor(function () { return w.Storage.getDB().wallet.bills.length === 1; }, { label: '账单未保存' });
  let db = w.Storage.getDB();
  if (db.wallet.bills.length !== 1) throw new Error('账单未保存');
  const b1 = db.wallet.bills[0];
  if (b1.subCatId !== 'w_shop_digital' || Number(b1.amount) !== 4999) throw new Error('账单内容错: ' + JSON.stringify(b1));
  const cash = db.wallet.accounts.find(a => a.id === 'ac_cash');
  if (Math.abs(cash.balance - (1000 - 4999)) > 0.001) throw new Error('余额错: ' + cash.balance);
  console.log('PASS ' + cur);

  // 4 自动词条同步：手机数码账单 → 自动出现「我的数码」词条（无任何手动操作）
  cur = '4. 自动词条同步（生成数码词条 + 子类映射到主机类）';
  const auto = await waitFor(function () {
    return w.Storage.getDB().items.find(i => i.name === 'iPhone 17 Pro');
  }, { label: '自动生成词条失败' });
  db = w.Storage.getDB();
  if (!auto) throw new Error('自动生成词条失败');
  if (auto.kind !== 'device') throw new Error('词条 kind 应为 device（数码页只认 device/game）: ' + auto.kind);
  if (Number(auto.purchasePrice) !== 4999) throw new Error('词条金额未同步');
  if (auto.fromBill !== b1.id) throw new Error('缺 fromBill 来源标记');
  if (b1.itemId !== auto.id) throw new Error('账单未指向词条');
  if (auto.categoryId !== 'host') throw new Error('词条子类映射错: ' + auto.categoryId); // iPhone→主机类
  console.log('PASS ' + cur);

  // 5 同名词条合并（不重复建档）
  cur = '5. 同名词条自动合并（金额以账单为准更新）';
  doc.getElementById('btn-add-bill').click();
  modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('[data-parent="w_shop"]') ? m : null;
  }, { label: '记账弹窗出现' });
  modal.querySelector('[data-parent="w_shop"]').click();
  await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('[data-sub="w_shop_digital"]') ? m : null;
  }, { label: '二级分类渲染' });
  lastModal(doc).querySelector('[data-sub="w_shop_digital"]').click();
  const amt2 = lastModal(doc).querySelector('#yw-amt');
  amt2.value = '100';
  amt2.dispatchEvent(new w.Event('input'));
  lastModal(doc).querySelector('#yw-note').value = 'iPhone 17 Pro';
  lastModal(doc).querySelector('#yw-acc').value = 'ac_cash'; // 显式选账户（默认不区分见 12）
  lastModal(doc).querySelector('[data-x="s"]').click();
  await waitFor(function () { return w.Storage.getDB().wallet.bills.length === 2; }, { label: '账单未保存' });
  db = w.Storage.getDB();
  const same = db.items.filter(i => i.name === 'iPhone 17 Pro');
  if (same.length !== 1) throw new Error('同名词条未合并: ' + same.length);
  if (Number(same[0].purchasePrice) !== 5099) throw new Error('合并后金额应为关联账单合计（4999+100）: ' + same[0].purchasePrice);
  if (same[0].linkedBillIds.length !== 2) throw new Error('合并词条应挂两笔账单');
  console.log('PASS ' + cur);

  // 6 删除账单：自动生成的词条随账单清理
  cur = '6. 删除账单 → 自动生成词条随账单清理';
  const delBill = db.wallet.bills.find(b => Number(b.amount) === 100);
  await w.Storage.removeBill(delBill.id);
  db = w.Storage.getDB();
  if (db.items.find(i => i.name === 'iPhone 17 Pro' && i.id !== b1.itemId)) throw new Error('清理逻辑错');
  // 另一笔账单还在，词条保留
  if (!db.items.find(i => i.name === 'iPhone 17 Pro')) throw new Error('仍有账单时词条不应删');
  await w.Storage.removeBill(b1.id);
  db = w.Storage.getDB();
  if (db.items.find(i => i.name === 'iPhone 17 Pro')) throw new Error('最后账单删除后词条应清掉');
  console.log('PASS ' + cur);

  // 7 转账不计收支、双边移动
  cur = '7. 账户转账（双边余额移动）';
  doc.querySelector('[data-wt="accounts"]').click();
  await waitFor(function () { return doc.getElementById('btn-transfer'); }, { label: '账户页渲染' });
  doc.getElementById('btn-transfer').click();
  modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#tf-from') ? m : null;
  }, { label: '转账弹窗出现' });
  modal.querySelector('#tf-from').value = 'ac_cash';
  modal.querySelector('#tf-to').value = 'ac_bank';
  modal.querySelector('#tf-amount').value = '200';
  modal.querySelector('[data-x="s"]').click();
  await waitFor(function () {
    const b = w.Storage.getDB().wallet.accounts.find(a => a.id === 'ac_bank');
    return b && Math.abs(b.balance - 5200) < 0.001;
  }, { label: '转账落账' });
  db = w.Storage.getDB();
  const c2 = db.wallet.accounts.find(a => a.id === 'ac_cash');
  const b2 = db.wallet.accounts.find(a => a.id === 'ac_bank');
  if (Math.abs(c2.balance - (1000 - 200)) > 0.001) throw new Error('转出错: ' + c2.balance);
  if (Math.abs(b2.balance - 5200) > 0.001) throw new Error('转入错: ' + b2.balance);
  console.log('PASS ' + cur);

  // 8 我的统计：统一风格的统计模块（周期切换 + 收支统计/走势/分类统计/日均/热力）
  cur = '8. 我的统计统一风格的模块（周期切换 + 5 统计栏）';
  w.App.go('plan');
  await waitFor(function () {
    return doc.body.textContent.indexOf('收支热力') >= 0 && doc.querySelectorAll('[data-sr]').length >= 3;
  }, { label: '我的统计渲染' });
  const ptext = doc.body.textContent;
  ['收支统计', '收支走势', '分类统计', '日均', '收支热力'].forEach(function (name) {
    if (ptext.indexOf(name) < 0) throw new Error('我的统计缺「' + name + '」');
  });
  const rangeBtns = Array.from(doc.querySelectorAll('[data-sr]'));
  if (rangeBtns.length < 3) throw new Error('缺周/月/年周期切换');
  if (ptext.indexOf('结余') < 0) throw new Error('收支统计缺结余');
  console.log('PASS ' + cur);

  // 9 周期切换生效
  cur = '9. 周/月/年切换生效';
  const yearBtn = rangeBtns.find(b => b.getAttribute('data-sr') === 'year');
  yearBtn.click();
  await waitFor(function () {
    const b = doc.querySelector('[data-sr="year"]');
    return b && b.classList.contains('on');
  }, { label: '周期切换未生效' });
  if (!Array.from(doc.querySelectorAll('[data-sr]')).find(b => b.getAttribute('data-sr') === 'year').classList.contains('on')) {
    throw new Error('周期切换未生效');
  }
  console.log('PASS ' + cur);

  // 10 物品非在用：使用周期截止，日均成本/吃灰冻结为固定值
  cur = '10. 非在用使用周期截止（日均成本冻结/恢复计时）';
  const it = {
    id: 'it-frozen', kind: 'device', categoryId: 'host', name: '冻结测试机',
    purchaseDate: '2026-01-01', purchasePrice: 3650, status: 'in_use', images: [], useCount: 0
  };
  w.Storage.getDB().items.push(it);
  await w.Storage.saveItem(it);
  const M = w.Models;
  const costBefore = M.calcItemCost(w.Storage.getDB(), it);
  // 切到非在用 → 记截止日
  it.status = 'idle';
  await w.Storage.saveItem(it);
  if (!it.retiredAt) throw new Error('非在用未记使用周期截止日');
  const end = M.useEndDate(it);
  if (U_todayStr(end) !== it.retiredAt) throw new Error('截止日取值错');
  const costAfter = M.calcItemCost(w.Storage.getDB(), it);
  if (costAfter.heldDays !== costBefore.heldDays) throw new Error('日均成本天数未冻结: ' + costAfter.heldDays);
  if (Math.abs(costAfter.dailyCost - costBefore.dailyCost) > 1e-9) throw new Error('日均成本未冻结');
  // 切回在用 → 恢复计时
  it.status = 'in_use';
  await w.Storage.saveItem(it);
  if (it.retiredAt) throw new Error('回到在用应清除截止日');
  console.log('PASS ' + cur);

  function U_todayStr(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }

  // 11 无备注也同步：用分类名建档（此前静默跳过是联动失败主因）
  cur = '11. 无备注按分类名建档（联动不静默跳过）';
  w.App.go('wallet');
  await waitFor(function () { return doc.getElementById('btn-add-bill'); }, { label: '钱袋页渲染' });
  doc.getElementById('btn-add-bill').click();
  modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('[data-parent="w_shop"]') ? m : null;
  }, { label: '记账弹窗出现' });
  modal.querySelector('[data-parent="w_shop"]').click();
  await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('[data-sub="w_shop_beauty"]') ? m : null;
  }, { label: '二级分类渲染' });
  lastModal(doc).querySelector('[data-sub="w_shop_beauty"]').click();
  const amt3 = lastModal(doc).querySelector('#yw-amt');
  amt3.value = '88';
  amt3.dispatchEvent(new w.Event('input'));
  // 不写备注直接保存
  lastModal(doc).querySelector('[data-x="s"]').click();
  const byCatName = await waitFor(function () {
    return w.Storage.getDB().items.find(i => i.name === '个护美妆');
  }, { label: '无备注未按分类名建档' });
  db = w.Storage.getDB();
  if (!byCatName) throw new Error('无备注未按分类名建档: ' + JSON.stringify(db.items.map(i => i.name)));
  if (byCatName.kind !== 'life') throw new Error('个护美妆应同步到生活域: ' + byCatName.kind);
  console.log('PASS ' + cur);

  // 12 默认「不区分账户」：账单入账但不动任何账户余额
  cur = '12. 默认不区分账户（不入任何账户余额）';
  const cashNow = db.wallet.accounts.find(a => a.id === 'ac_cash').balance;
  const bNoAcc = db.wallet.bills.find(b => Number(b.amount) === 88);
  if (!bNoAcc) throw new Error('账单未保存');
  if (bNoAcc.accountId) throw new Error('默认应为不区分账户: ' + bNoAcc.accountId);
  const cashAfter = w.Storage.getDB().wallet.accounts.find(a => a.id === 'ac_cash').balance;
  if (Math.abs(cashAfter - cashNow) > 0.001) throw new Error('不区分账户不应动余额: ' + cashAfter);
  console.log('PASS ' + cur);

  // 13 正餐账单 → 美食日历自动同步（零食等不进）
  cur = '13. 正餐账单→美食日历（餐别映射）+ 零食不进';
  doc.getElementById('btn-add-bill').click();
  modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('[data-sub="w_food_breakfast"]') ? m : null;
  }, { label: '记账弹窗出现' });
  // 默认一级=食品餐饮，选二级「早餐」
  modal.querySelector('[data-sub="w_food_breakfast"]').click();
  const amt4 = lastModal(doc).querySelector('#yw-amt');
  amt4.value = '12';
  amt4.dispatchEvent(new w.Event('input'));
  lastModal(doc).querySelector('#yw-note').value = '豆浆油条';
  lastModal(doc).querySelector('[data-x="s"]').click();
  const food1 = await waitFor(function () {
    return w.Storage.getDB().food.find(f => f.name === '豆浆油条');
  }, { label: '正餐账单未同步美食日历' });
  db = w.Storage.getDB();
  if (!food1) throw new Error('正餐账单未同步美食日历: ' + JSON.stringify(db.food));
  if (food1.meal !== '早餐') throw new Error('餐别映射错: ' + food1.meal);
  if (Number(food1.price) !== 12) throw new Error('美食价格未同步');
  // 零食不进美食日历
  doc.getElementById('btn-add-bill').click();
  modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#yw-amt') ? m : null;
  }, { label: '记账弹窗出现' });
  modal.querySelector('[data-sub="w_food_snack"]') && modal.querySelector('[data-sub="w_food_snack"]').click();
  const amt5 = lastModal(doc).querySelector('#yw-amt');
  amt5.value = '9';
  amt5.dispatchEvent(new w.Event('input'));
  lastModal(doc).querySelector('[data-x="s"]').click();
  await waitFor(function () {
    return w.Storage.getDB().wallet.bills.some(b => Number(b.amount) === 9);
  }, { label: '账单未保存' });
  db = w.Storage.getDB();
  if (db.food.length !== 1) throw new Error('零食不应进美食日历: ' + db.food.length);
  console.log('PASS ' + cur);

  // 14 余额记录 + 资产走势统计
  cur = '14. 余额记录 + 资产走势（走势/构成/变动）';
  w.App.go('wallet');
  await waitFor(function () { return doc.getElementById('btn-add-bill'); }, { label: '钱袋页渲染' });
  doc.querySelector('[data-wt="accounts"]').click();
  await waitFor(function () { return doc.getElementById('btn-add-balance'); }, { label: '账户页渲染' });
  if (doc.body.textContent.indexOf('余额记录') < 0) throw new Error('账户页缺余额记录');
  if (doc.body.textContent.indexOf('月度预算') >= 0) throw new Error('账户页预算板块应移除');
  doc.getElementById('btn-add-balance').click();
  modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('[data-bal-acc]') ? m : null;
  }, { label: '记余额弹窗出现' });
  modal.querySelector('[data-bal-acc]').value = '8888';
  modal.querySelector('[data-x="s"]').click();
  await waitFor(function () {
    return (w.Storage.getDB().wallet.balances || []).length >= 1;
  }, { label: '余额记录未保存' });
  db = w.Storage.getDB();
  if (!(db.wallet.balances || []).length) throw new Error('余额记录未保存');
  w.App.go('plan');
  await waitFor(function () {
    return doc.body.textContent.indexOf('本月净变动') >= 0;
  }, { label: '资产走势渲染' });
  if (doc.body.textContent.indexOf('资产走势') < 0) throw new Error('我的统计缺资产走势');
  if (doc.body.textContent.indexOf('当前总资产') < 0) throw new Error('资产走势缺总资产');
  if (doc.body.textContent.indexOf('本月净变动') < 0) throw new Error('资产走势缺变动');
  console.log('PASS ' + cur);

  // 15 P0回归：编辑账单不销毁词条用户数据（图片/使用记录保留、id 不变）
  cur = '15. P0回归：编辑账单就地更新词条（数据不丢）';
  w.App.go('wallet');
  await waitFor(function () { return doc.getElementById('btn-add-bill'); }, { label: '钱袋页渲染' });
  doc.getElementById('btn-add-bill').click();
  modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('[data-parent="w_shop"]') ? m : null;
  }, { label: '记账弹窗出现' });
  modal.querySelector('[data-parent="w_shop"]').click();
  await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('[data-sub="w_shop_digital"]') ? m : null;
  }, { label: '二级分类渲染' });
  lastModal(doc).querySelector('[data-sub="w_shop_digital"]').click();
  const amt6 = lastModal(doc).querySelector('#yw-amt');
  amt6.value = '200';
  amt6.dispatchEvent(new w.Event('input'));
  lastModal(doc).querySelector('#yw-note').value = '测试耳机';
  lastModal(doc).querySelector('[data-x="s"]').click();
  const hp = await waitFor(function () {
    return w.Storage.getDB().items.find(i => i.name === '测试耳机');
  }, { label: '前置：词条未建' });
  db = w.Storage.getDB();
  if (!hp) throw new Error('前置：词条未建');
  // 用户补充数据
  hp.images = ['a.webp']; hp.notes = '好用'; hp.useCount = 3;
  const hpId = hp.id;
  const hpBill = db.wallet.bills.find(b => b.note === '测试耳机');
  // 编辑账单金额 200→260（仅改金额）
  w.WalletView.openBillForm(hpBill);
  modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#yw-amt') ? m : null;
  }, { label: '编辑账单弹窗出现' });
  const amt7 = modal.querySelector('#yw-amt');
  amt7.value = '260';
  amt7.dispatchEvent(new w.Event('input'));
  modal.querySelector('[data-x="s"]').click();
  await waitFor(function () {
    const b = w.Storage.getDB().wallet.bills.find(x => x.note === '测试耳机');
    return b && Number(b.amount) === 260;
  }, { label: '账单编辑保存' });
  db = w.Storage.getDB();
  const hp2 = db.items.find(i => i.id === hpId);
  if (!hp2) throw new Error('P0：编辑账单后词条被删除重建（用户数据会丢）');
  if (!hp2.images || hp2.images.length !== 1 || hp2.notes !== '好用' || hp2.useCount !== 3) {
    throw new Error('P0：编辑账单后词条用户数据丢失: ' + JSON.stringify(hp2));
  }
  if (Number(hp2.purchasePrice) !== 260) throw new Error('编辑后词条金额应跟随账单: ' + hp2.purchasePrice);
  console.log('PASS ' + cur);

  // 16 P0回归：合并口径不双计正餐（账单+美食只算一次）
  cur = '16. P0回归：合并口径已扣重正餐账单（不双计）';
  const ws = w.Models.walletStats(w.Storage.getDB());
  // 早餐 12 + 午饭类若干 正餐账单都带 foodId → monthLinkedExpense 应覆盖它们
  const mealBills = w.Storage.getDB().wallet.bills.filter(b => b.foodId && b.date && b.date.slice(0, 7) === new Date().toISOString().slice(0, 7));
  let mealSum = 0;
  mealBills.forEach(b => { mealSum += Math.abs(Number(b.amount) || 0); });
  if (mealSum > 0 && ws.monthLinkedExpense < mealSum - 0.001) {
    throw new Error('P0：正餐账单未全额扣重（会双计）: linked=' + ws.monthLinkedExpense + ' mealSum=' + mealSum);
  }
  console.log('PASS ' + cur);

  // 17 人民币大写边界（0.47→肆角柒分、2.01→贰元零壹分）
  cur = '17. 人民币大写边界正确（0.47/2.01）';
  doc.getElementById('btn-add-bill').click();
  modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#yw-amt') ? m : null;
  }, { label: '记账弹窗出现' });
  const amt8 = modal.querySelector('#yw-amt');
  amt8.value = '0.47';
  amt8.dispatchEvent(new w.Event('input'));
  if (modal.querySelector('#yw-amt-cn').textContent.indexOf('肆角柒分') < 0) {
    throw new Error('大写 0.47 错: ' + modal.querySelector('#yw-amt-cn').textContent);
  }
  amt8.value = '2.01';
  amt8.dispatchEvent(new w.Event('input'));
  if (modal.querySelector('#yw-amt-cn').textContent.indexOf('贰元零壹分') < 0) {
    throw new Error('大写 2.01 错: ' + modal.querySelector('#yw-amt-cn').textContent);
  }
  modal.querySelector('[data-x="c"]').click();
  await waitFor(function () { return !doc.body.contains(modal); }, { label: '记账弹窗关闭' });
  console.log('PASS ' + cur);

  // 18 二手回血：收入·二手闲置按名称合品并回填售出价
  cur = '18. 二手回血（收入·二手闲置 → 合品售出价）';
  doc.getElementById('btn-add-bill').click();
  modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('[data-bft="income"]') ? m : null;
  }, { label: '记账弹窗出现' });
  modal.querySelector('[data-bft="income"]').click();
  await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('[data-parent="w_in_resale"]') ? m : null;
  }, { label: '收入分类渲染' });
  modal = lastModal(doc);
  modal.querySelector('[data-parent="w_in_resale"]').click();
  await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('[data-sub="w_in_resale"]') ? m : null;
  }, { label: '收入二级分类渲染' });
  modal = lastModal(doc);
  modal.querySelector('[data-sub="w_in_resale"]').click();
  const amt9 = lastModal(doc).querySelector('#yw-amt');
  amt9.value = '150';
  amt9.dispatchEvent(new w.Event('input'));
  lastModal(doc).querySelector('#yw-note').value = '测试耳机';
  lastModal(doc).querySelector('[data-x="s"]').click();
  const resold = await waitFor(function () {
    const i = w.Storage.getDB().items.find(x => x.id === hpId);
    return i && i.status === 'sold' ? i : null;
  }, { label: '二手回血：合品未标记已售出' });
  db = w.Storage.getDB();
  if (!resold || resold.status !== 'sold') throw new Error('二手回血：合品未标记已售出');
  if (Number(resold.soldPrice) !== 150) throw new Error('二手回血：售出价未回填: ' + resold.soldPrice);
  console.log('PASS ' + cur);

  console.log('========== v1.1.0 钱袋 v2：18 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
