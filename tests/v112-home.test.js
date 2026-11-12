/* v112-home.test.js — v1.1.2：我的主页 / 词条→账单同步 / 多账户余额快照 */
'use strict';
const { makeWindow, waitFor, waitMain, lastModal } = require('./helpers/harness');

let cur = '';

let settings = { idleWarnDays: 60, budget: { monthlyTotal: 3000, categories: {} }, planSections: [], rememberAccount: true, navOrder: [] };
const items = [
  { id: 'it1', kind: 'device', categoryId: 'host', name: '旧手机', purchaseDate: '2025-06-01', purchasePrice: 3000, status: 'in_use', images: [], useCount: 0, wearCount: 0 }
];

async function main() {
  const w = makeWindow({
    data: {
      items: items,
      settings: settings,
      wallet: {
        bills: [
          { id: 'b1', type: 'expense', amount: 23, date: new Date().toISOString().slice(0, 10), catId: 'w_food', subCatId: 'w_food_lunch', note: '午饭', tagIds: [], accountId: '' }
        ],
        accounts: [
          { id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 1000, note: '' },
          { id: 'ac_bank', name: '银行卡', icon: 'credit-card', type: 'bank', balance: 5000, note: '' }
        ],
        cats: {
          expense: [
            { id: 'w_food', name: '食品餐饮', icon: 'color_ic_parent_restaurant', children: [{ id: 'w_food_lunch', name: '午餐', icon: 'x' }] },
            { id: 'w_shop', name: '购物消费', icon: 'color_ic_parent_shopping', children: [{ id: 'w_shop_digital', name: '手机数码', icon: 'x' }] }
          ],
          income: [{ id: 'w_in_wages', name: '工资', icon: 'x', children: [] }]
        },
        syncMap: { w_shop_digital: 'digital', w_shop_clothing: 'clothing', w_shop_beauty: 'life' }
      }
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;

  // 1 主页为默认首屏，导航第一个
  cur = '1. 主页默认首屏 + 导航第一个';
  await waitFor(function () { return doc.querySelector('[data-nav]'); }, { label: '主导航渲染' });
  const navIds = Array.from(doc.querySelectorAll('[data-nav]')).map(n => n.getAttribute('data-nav'));
  if (navIds[0] !== 'home') throw new Error('我的主页应为导航第一个: ' + navIds[0]);
  if (doc.body.textContent.indexOf('记一笔账') < 0) throw new Error('主页未渲染（缺记一笔账按钮）');
  console.log('PASS ' + cur);

  // 2 四大快捷按钮齐全（各颜色大按钮）
  cur = '2. 四大快捷按钮（记数码/记衣服/记美妆/记一笔账）';
  await waitFor(function () { return doc.getElementById('hq-bill'); }, { label: '快捷按钮渲染' });
  ['hq-digital', 'hq-clothing', 'hq-life', 'hq-bill'].forEach(function (id) {
    const el = doc.getElementById(id);
    if (!el) throw new Error('缺快捷按钮 ' + id);
    if (!el.style.getPropertyValue('--hq')) throw new Error('快捷按钮缺颜色 ' + id);
  });
  console.log('PASS ' + cur);

  // 3 打卡按钮：无记录=去打卡，点击弹表单
  cur = '3. 打卡按钮（去打卡态 → 弹打卡表单）';
  const hc = doc.getElementById('hc-outfit');
  if (!hc) throw new Error('缺穿搭打卡按钮');
  if (hc.textContent.indexOf('去打卡') < 0) throw new Error('未打卡态文案错');
  hc.click();
  let modal = await waitFor(function () { return lastModal(doc); }, { label: '穿搭打卡弹窗未出现' });
  if (!modal) throw new Error('穿搭打卡弹窗未出现');
  modal.querySelector('.modal-close').click();
  await waitFor(function () { return !doc.body.contains(modal); }, { label: '打卡弹窗关闭' });
  console.log('PASS ' + cur);

  // 4 今日概览保留；本月速览/提醒/动态按用户要求删除
  cur = '4. 今日概览保留 + 多余区块已删';
  const text = doc.body.textContent;
  if (text.indexOf('今日概览') < 0) throw new Error('主页缺「今日概览」');
  if (text.indexOf('今日记账') < 0) throw new Error('今日概览缺记账数');
  ['本月速览', '最近动态'].forEach(function (name) {
    if (text.indexOf(name) >= 0) throw new Error('「' + name + '」应已删除');
  });
  console.log('PASS ' + cur);

  // 5 快捷按钮→记账弹窗
  cur = '5. 快捷按钮打开记账弹窗';
  doc.getElementById('hq-bill').click();
  modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#yw-amt') ? m : null;
  }, { label: '记一笔账按钮未打开记账弹窗' });
  if (!modal || !modal.querySelector('#yw-amt')) throw new Error('记一笔账按钮未打开记账弹窗');
  modal.querySelector('.modal-close').click();
  await waitFor(function () { return !doc.body.contains(modal); }, { label: '记账弹窗关闭' });
  console.log('PASS ' + cur);

  // 6 词条→账单同步：编辑已有物品，底部有账单同步区，可生成购入账单
  cur = '6. 词条→账单（生成购入账单，金额/日期/分类自动）';
  w.Views.openItemEditor('it1', 'digital');
  modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.textContent.indexOf('账单同步') >= 0 ? m : null;
  }, { label: '编辑物品缺账单同步区' });
  if (modal.textContent.indexOf('账单同步') < 0) throw new Error('编辑物品缺账单同步区');
  const genBtn = modal.querySelector('#btn-gen-bill');
  if (!genBtn) throw new Error('缺生成购入账单按钮');
  genBtn.click();
  const gen = await waitFor(function () {
    return w.Storage.getDB().wallet.bills.find(b => b.itemId === 'it1');
  }, { label: '词条未同步到账单' });
  const db = w.Storage.getDB();
  if (!gen) throw new Error('词条未同步到账单');
  if (Number(gen.amount) !== 3000 || gen.date !== '2025-06-01') throw new Error('账单未取物品价格/日期: ' + JSON.stringify(gen));
  if (gen.subCatId !== 'w_shop_digital') throw new Error('账单分类映射错: ' + gen.subCatId);
  console.log('PASS ' + cur);

  // 7 多账户余额快照：一次记录多个账户
  cur = '7. 多账户余额快照（一次记录多账户）';
  w.App.go('wallet');
  await waitFor(function () { return doc.querySelector('[data-wt="accounts"]'); }, { label: '钱袋页渲染' });
  doc.querySelector('[data-wt="accounts"]').click();
  await waitFor(function () { return doc.getElementById('btn-add-balance'); }, { label: '账户页渲染' });
  doc.getElementById('btn-add-balance').click();
  modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelectorAll('[data-bal-acc]').length >= 2 ? m : null;
  }, { label: '记余额弹窗未列出多账户输入' });
  const inputs = modal.querySelectorAll('[data-bal-acc]');
  if (inputs.length < 2) throw new Error('记余额未列出多账户输入');
  inputs[0].value = '1234';
  inputs[1].value = '5678';
  modal.querySelector('[data-x="s"]').click();
  await waitFor(function () {
    return (w.Storage.getDB().wallet.balances || []).length === 2;
  }, { label: '多账户快照未保存' });
  const db2 = w.Storage.getDB();
  const bals = db2.wallet.balances || [];
  if (bals.length !== 2) throw new Error('多账户快照未保存: ' + bals.length);
  if (!bals[0].batchId || bals[0].batchId !== bals[1].batchId) throw new Error('同批快照缺 batchId');
  console.log('PASS ' + cur);

  // 8 统计兼容：资产走势读取多账户快照
  cur = '8. 统计兼容多账户快照';
  w.App.go('plan');
  await waitFor(function () {
    return doc.body.textContent.indexOf('本月净变动') >= 0;
  }, { label: '资产走势渲染' });
  if (doc.body.textContent.indexOf('资产走势') < 0) throw new Error('统计缺资产走势');
  if (doc.body.textContent.indexOf('快照') < 0) throw new Error('资产走势未展示快照');
  console.log('PASS ' + cur);

  // 9 v1.1.3：余额记录与账户关联（账户卡记余额入口 + 历史 + 按账户分组）
  cur = '9. 余额记录与账户关联（入口/历史/分组/单账户弹窗）';
  w.App.go('wallet');
  await waitFor(function () { return doc.querySelector('[data-wt="accounts"]'); }, { label: '钱袋页渲染' });
  doc.querySelector('[data-wt="accounts"]').click();
  await waitFor(function () {
    return doc.querySelectorAll('[data-bal-add]').length > 0;
  }, { label: '账户卡缺记余额入口' });
  const balAddBtns = doc.querySelectorAll('[data-bal-add]');
  if (!balAddBtns.length) throw new Error('账户卡缺记余额入口');
  if (!doc.querySelector('.acc-bal-hist .acc-bal-line')) throw new Error('账户卡缺余额历史展示');
  // 余额记录面板按账户分组（组头=账户名）
  const balBody = Array.from(doc.querySelectorAll('.panel')).find(p => p.textContent.indexOf('余额记录') >= 0);
  if (!balBody) throw new Error('缺余额记录面板');
  const accNames = (w.Storage.getDB().wallet.accounts || []).map(a => a.name);
  if (!accNames.some(n => balBody.textContent.indexOf(n) >= 0)) throw new Error('余额记录未按账户分组展示');
  // 账户卡「记余额」→ 单账户弹窗
  balAddBtns[0].click();
  modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.textContent.indexOf('记余额 · ') >= 0 ? m : null;
  }, { label: '单账户记余额弹窗标题错' });
  if (modal.textContent.indexOf('记余额 · ') < 0) throw new Error('单账户记余额弹窗标题错');
  if (modal.querySelectorAll('[data-bal-acc]').length !== 1) throw new Error('单账户弹窗应只列该账户');
  modal.querySelector('[data-x="c"]') && modal.querySelector('[data-x="c"]').click();
  console.log('PASS ' + cur);

  console.log('========== v1.1.2 主页/同步/余额：9 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
