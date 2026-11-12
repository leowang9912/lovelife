/* v116-stats-ux.test.js — v1.1.6 统计/设置线回归锁（甲12/13/14/15/17/19 + 丙1/2/3/5/6/7/8）：
   1) 甲12 分类预算按钱包分类树自动生成（10 大类全齐、名称随分类树）+ 保存键兼容 walletCats
   2) 甲13 成本模型校验：残值率 0~1 / 寿命 >0 红字拦截 + 每行「恢复默认」
   3) 甲14 设置页 refresh 后保留当前分标签；数据体检结果不被 refresh 抹掉
   4) 甲15 月度小结：环比同口径（与上月同期 1~N 日比）+「月初至今」+ 预算达成合并口径（itemId||foodId 扣重）
   5) 甲17 删账号两档（purge true/false）+ 清空数据确认提示「操作前将自动备份」并先自动备份
   6) 甲19 statRange 记忆进 settings / 切换恢复 scrollTop / 离开统计页退出 editMode
      （资产走势周期切换 v1.1.8 P0-4 时间轴统一反转：随 周|月|年）
   7) 丙1/2/3/5/6/7/8 CSS 定稿断言 + 空态卡统一结构 */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWindow, waitFor, sleep, waitMain, lastModal, assert, APP } = require('./helpers/harness');

let cur = '';

function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function blockOf(css, re) {
  const m = css.match(re);
  return m ? m[1] : '';
}
function blocksOf(css, re) {
  const out = [];
  const g = new RegExp(re.source, 'g');
  let m;
  while ((m = g.exec(css))) out.push(m[1]);
  return out.join('\n');
}

async function main() {
  const todayD = new Date();
  const today = fmt(todayD);
  const dayN = todayD.getDate();
  const prevFirst = new Date(todayD.getFullYear(), todayD.getMonth() - 1, 1);
  const prevDays = new Date(prevFirst.getFullYear(), prevFirst.getMonth() + 1, 0).getDate();
  const prevN = Math.min(dayN, prevDays);
  const curFirst = fmt(new Date(todayD.getFullYear(), todayD.getMonth(), 1));

  /* ==================== w1：设置页（甲12/13/14/17） ==================== */
  let accounts = [{ id: 'me', name: 'Me', icon: 'x' }, { id: 'b2', name: 'B2', icon: 'y' }, { id: 'b3', name: 'B3', icon: 'z' }];
  let settingsSnap = null;
  let catsSnap = null;
  const fetchLog = [];
  const tenCats = [
    { id: 'w_food', name: '食品餐饮', icon: 'tag', children: [] },
    { id: 'w_shop', name: '购物消费', icon: 'tag', children: [] },
    { id: 'w_traffic', name: '出行交通', icon: 'tag', children: [] },
    { id: 'w_home', name: '居家生活', icon: 'tag', children: [] },
    { id: 'w_fun', name: '休闲娱乐', icon: 'tag', children: [] },
    { id: 'w_edu', name: '文化教育', icon: 'tag', children: [] },
    { id: 'w_medical', name: '健康医疗', icon: 'tag', children: [] },
    { id: 'w_gift', name: '送礼人情', icon: 'tag', children: [] },
    { id: 'w_pet', name: '宠物', icon: 'tag', children: [] },
    { id: 'w_other_exp', name: '其他支出', icon: 'tag', children: [] }
  ];
  const w1 = makeWindow({
    data: {
      settings: { idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {}, walletCats: {} }, planSections: [], rememberAccount: true },
      categories: {
        digital: [{ id: 'host', name: 'Host', lifeYears: 5, residualRate: 0.1, children: [] }],
        clothing: [{ id: 'top', name: 'Top', children: [] }],
        life: [{ id: 'skin', name: 'Skin', children: [] }],
        foodCuisine: [], foodType: [], meal: [], foodTag: [], occasion: [], season: [],
        tagPresets: [], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
      },
      wallet: {
        cats: { expense: tenCats, income: [{ id: 'w_in_wages', name: '工资', icon: 'tag', children: [] }] },
        bills: [], accounts: [], balances: [], templates: [], imports: [], tags: [], syncMap: {}, catsVersion: 2
      }
    },
    routes: {
      'api/account': ({ body, ok }) => {
        if (body && body.action === 'delete') accounts = accounts.filter(function (a) { return a.id !== body.id; });
        return ok({ ok: true, accounts: accounts });
      },
      'api/save': ({ body, ok }) => {
        if (body && body.target === 'settings') {
          settingsSnap = JSON.parse(JSON.stringify(body.data.settings));
          catsSnap = JSON.parse(JSON.stringify(body.data.categories));
        }
        return ok({ ok: true });
      },
      'api/db': ({ ok }) => ok({
        schemaVersion: 3,
        account: accounts.find(function (a) { return a.id === 'me'; }) || accounts[0],
        accounts: accounts.slice(),
        items: [], outfits: [], food: [], events: [],
        settings: { idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {}, walletCats: {} }, planSections: [], rememberAccount: true },
        categories: {
          digital: [{ id: 'host', name: 'Host', lifeYears: 5, residualRate: 0.1, children: [] }],
          clothing: [{ id: 'top', name: 'Top', children: [] }],
          life: [{ id: 'skin', name: 'Skin', children: [] }],
          foodCuisine: [], foodType: [], meal: [], foodTag: [], occasion: [], season: [],
          tagPresets: [], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
        },
        wallet: {
          cats: { expense: tenCats, income: [{ id: 'w_in_wages', name: '工资', icon: 'tag', children: [] }] },
          bills: [], accounts: [], balances: [], templates: [], imports: [], tags: [], syncMap: {}, catsVersion: 2
        },
        dataRoot: 'm'
      })
    },
    onCall: function (url, body) { fetchLog.push({ url: String(url), body: body }); }
  });
  if (!(await waitMain(w1))) throw new Error('no main');
  const doc1 = w1.document;
  w1.App.go('settings');
  const root1 = await waitFor(function () {
    const mc = doc1.getElementById('main-content');
    return mc && mc.querySelector('#b-total') ? mc : null;
  }, { label: '设置页未渲染' });

  // ---- 1 甲12 分类预算自动生成 ----
  cur = '1. 甲12 分类预算按分类树生成（10 大类全齐、名称随分类树）';
  const budgetInputs = root1.querySelectorAll('[data-wcat-budget]');
  assert(budgetInputs.length === 10, '甲12：应按分类树生成 10 个大类预算输入，实为 ' + budgetInputs.length);
  const billHTML = root1.querySelector('[data-stab=bill]').innerHTML;
  for (const t of ['文化教育', '健康医疗', '宠物', '其他支出', '送礼人情']) {
    assert(billHTML.indexOf(t) >= 0, '甲12：缺大类「' + t + '」');
  }
  assert(billHTML.indexOf('人情往来') < 0, '甲12：名称应随分类树「送礼人情」，不得再写死「人情往来」');
  const eduInput = root1.querySelector('[data-wcat-budget=w_edu]');
  assert(!!eduInput, '甲12：缺文化教育（w_edu）预算输入');
  eduInput.value = '300';
  root1.querySelector('#btn-save-wcat-budget').click();
  await waitFor(function () {
    return settingsSnap && settingsSnap.budget && settingsSnap.budget.walletCats &&
      settingsSnap.budget.walletCats.w_edu === 300;
  }, { label: '甲12：分类预算未按 walletCats[大类id] 落库' });
  assert(settingsSnap.budget.walletCats.w_edu === 300, '甲12：保存键应为 budget.walletCats[w_edu]');
  assert(JSON.stringify(settingsSnap.budget.categories) === '{}',
    '甲12：分类预算保存不得覆盖物品分域预算 budget.categories: ' + JSON.stringify(settingsSnap.budget.categories));
  console.log('PASS ' + cur);

  // ---- 2 甲13 成本模型校验 + 恢复默认 ----
  cur = '2. 甲13 成本模型：残值率 0~1/寿命>0 红字拦 + 恢复默认';
  const hostRow = root1.querySelector('.cat-table tr[data-cid=host]');
  assert(!!hostRow, '前置失败：成本模型缺 Host 行');
  const resIn = hostRow.querySelector('[data-f=res]');
  const lifeIn = hostRow.querySelector('[data-f=life]');
  assert(String(resIn.placeholder).indexOf('0~1') >= 0, '甲13：残值率输入应标注「0~1，如 0.3」: ' + resIn.placeholder);
  resIn.value = '30';
  root1.querySelector('#btn-save-cats').click();
  await waitFor(function () {
    const el = root1.querySelector('#cost-err');
    return el && el.textContent.indexOf('0~1') >= 0 ? el : null;
  }, { label: '甲13：残值率 30 未红字拦截' });
  assert(resIn.classList.contains('input-err'), '甲13：越界输入应标红（input-err）');
  assert(w1.Storage.getDB().categories.digital[0].residualRate === 0.1,
    '甲13：拦截后不得写入残值率 30: ' + w1.Storage.getDB().categories.digital[0].residualRate);
  resIn.value = '0.3';
  lifeIn.value = '0';
  root1.querySelector('#btn-save-cats').click();
  await waitFor(function () {
    const el = root1.querySelector('#cost-err');
    return el && el.textContent.indexOf('寿命需大于 0') >= 0 ? el : null;
  }, { label: '甲13：寿命 0 未红字拦截' });
  assert(w1.Storage.getDB().categories.digital[0].lifeYears === 5,
    '甲13：寿命 0 不得静默忽略也不得写入（应拦截）');
  lifeIn.value = '6';
  root1.querySelector('#btn-save-cats').click();
  await waitFor(function () {
    return catsSnap && catsSnap.digital && catsSnap.digital[0].lifeYears === 6 &&
      Math.abs(catsSnap.digital[0].residualRate - 0.3) < 1e-9;
  }, { label: '甲13：合法值未保存' });
  await waitFor(function () {
    const el = root1.querySelector('#cost-err');
    return el && el.textContent === '' ? el : null;
  }, { label: '甲13：合法保存后红字应清除' });
  // 恢复默认：一键回默认寿命 5 年 / 残值率 0.1
  hostRow.querySelector('[data-cost-default]').click();
  await waitFor(function () {
    return catsSnap && catsSnap.digital && catsSnap.digital[0].lifeYears === 5 &&
      Math.abs(catsSnap.digital[0].residualRate - 0.1) < 1e-9;
  }, { label: '甲13：恢复默认未落库（默认 5 年 / 0.1）' });
  assert(root1.querySelector('.cat-table tr[data-cid=host] [data-f=life]').value === '5' &&
    root1.querySelector('.cat-table tr[data-cid=host] [data-f=res]').value === '0.1',
    '甲13：恢复默认后输入应回到 5 / 0.1');
  console.log('PASS ' + cur);

  // ---- 3 甲14 stab 持久 + 体检结果持久 ----
  cur = '3. 甲14 refresh 保留分标签 + 体检结果不被抹掉';
  root1.querySelector('[data-stab-btn=data]').click();
  await waitFor(function () {
    return doc1.querySelector('[data-stab-btn=data].on');
  }, { label: '甲14：切到数据备份标签未生效' });
  w1.App.refresh();
  await waitFor(function () {
    return doc1.querySelector('[data-stab-btn]');
  }, { label: '甲14：refresh 后设置页未渲染' });
  assert(doc1.querySelector('[data-stab-btn=data]').classList.contains('on'),
    '甲14：refresh 后应回到「数据备份」标签，而不是跳回「账号」');
  assert(!doc1.querySelector('[data-stab-btn=account]').classList.contains('on'),
    '甲14：refresh 后不得跳回「账号」标签');
  const root1b = doc1.getElementById('main-content');
  root1b.querySelector('#btn-repair').click();
  await waitFor(function () {
    const el = doc1.getElementById('repair-result');
    return el && el.textContent && el.textContent !== '体检中…' ? el : null;
  }, { label: '甲14：体检结果未出' });
  const repairText = doc1.getElementById('repair-result').textContent;
  assert(repairText.indexOf('数据健康') >= 0 || repairText.indexOf('已修复') >= 0,
    '甲14：体检结果文案异常: ' + repairText);
  w1.App.refresh(); // 结果必须活过 refresh（存模块态渲染）
  await waitFor(function () {
    const el = doc1.getElementById('repair-result');
    return el && el.textContent ? el : null;
  }, { label: '甲14：refresh 后体检结果丢失' });
  assert(doc1.getElementById('repair-result').textContent === repairText,
    '甲14：refresh 后体检结果应原样保留（存模块态），实为: ' + doc1.getElementById('repair-result').textContent);
  console.log('PASS ' + cur);

  // ---- 4 甲17 删账号两档 ----
  cur = '4. 甲17 删账号两档：彻底删除(purge=true)/仅移除(purge=false)';
  let root1c = doc1.getElementById('main-content');
  await waitFor(function () {
    return root1c.querySelector('[data-del-acc=b2]');
  }, { label: '设置页缺删除账号入口' });
  root1c.querySelector('[data-del-acc=b2]').click();
  let modal1 = await waitFor(function () {
    const m = lastModal(doc1);
    return m && m.querySelector('[data-act=yes]') ? m : null;
  }, { label: '删除账号弹窗未出现' });
  assert(modal1.textContent.indexOf('彻底删除（含数据）') >= 0, '甲17：缺「彻底删除（含数据）」档');
  assert(modal1.textContent.indexOf('仅移除账号（数据保留在磁盘）') >= 0, '甲17：缺「仅移除账号（数据保留在磁盘）」档');
  assert(modal1.textContent.indexOf('将删除当前登录账号') < 0, '甲17：删其他账号不得写「当前登录账号」');
  modal1.querySelector('[data-act=keep]').click();
  await waitFor(function () {
    return fetchLog.some(function (x) {
      return x.url.indexOf('/api/account') >= 0 && x.body && x.body.action === 'delete' && x.body.id === 'b2' && x.body.purge === false;
    });
  }, { label: '甲17：仅移除未以 purge=false 调用' });
  root1c = doc1.getElementById('main-content');
  await waitFor(function () {
    return root1c.querySelector('[data-del-acc=b3]');
  }, { label: '删除 b2 后列表未刷新' });
  root1c.querySelector('[data-del-acc=b3]').click();
  modal1 = await waitFor(function () {
    const m = lastModal(doc1);
    return m && m.querySelector('[data-act=yes]') ? m : null;
  }, { label: '删除账号弹窗未出现' });
  modal1.querySelector('[data-act=yes]').click();
  await waitFor(function () {
    return fetchLog.some(function (x) {
      return x.url.indexOf('/api/account') >= 0 && x.body && x.body.action === 'delete' && x.body.id === 'b3' && x.body.purge === true;
    });
  }, { label: '甲17：彻底删除未以 purge=true 调用' });
  console.log('PASS ' + cur);

  // ---- 5 甲17 清空数据：确认提示 + 先自动备份 ----
  cur = '5. 甲17 清空数据：确认框提示自动备份且先快照再清空';
  root1c = doc1.getElementById('main-content');
  await waitFor(function () {
    return root1c.querySelector('#btn-reset');
  }, { label: '危险操作未渲染' });
  root1c.querySelector('#btn-reset').click();
  modal1 = await waitFor(function () {
    const m = lastModal(doc1);
    return m && m.querySelector('[data-act=yes]') ? m : null;
  }, { label: '清空确认框未出现' });
  assert(modal1.textContent.indexOf('操作前将自动备份') >= 0,
    '甲17：清空确认框应提示「操作前将自动备份」: ' + modal1.textContent);
  const snapMark = fetchLog.length;
  modal1.querySelector('[data-act=yes]').click();
  await waitFor(function () {
    return fetchLog.slice(snapMark).some(function (x) {
      return x.url.indexOf('/api/save') >= 0 && x.body && x.body.target === 'items' && Array.isArray(x.body.data) && x.body.data.length === 0;
    });
  }, { label: '清空数据未生效' });
  const snapIdx = fetchLog.findIndex(function (x, i) { return i >= snapMark && x.url.indexOf('snapshot=1') >= 0; });
  const resetIdx = fetchLog.findIndex(function (x, i) {
    return i >= snapMark && x.url.indexOf('/api/save') >= 0 && x.body && x.body.target === 'items' && Array.isArray(x.body.data) && x.body.data.length === 0;
  });
  assert(snapIdx >= snapMark, '甲17：清空前未调用自动备份（/api/backup?snapshot=1）');
  assert(snapIdx < resetIdx, '甲17：必须先自动备份再清空（备份调用应在清空落盘之前）');
  console.log('PASS ' + cur);

  /* ==================== w2：甲15 月度小结口径 ==================== */
  cur = '6. 甲15 月度小结：环比同口径 + 月初至今 + 预算达成合并口径';
  const w2 = makeWindow({
    data: {
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
        bills: [
          { id: 'p1', type: 'expense', amount: 100, date: fmt(prevFirst), time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '上月同期午饭', tagIds: [], source: 'manual' },
          { id: 'c1', type: 'expense', amount: 200, date: curFirst, time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '本月午饭', tagIds: [], source: 'manual' }
        ]
      }
    }
  });
  if (!(await waitMain(w2))) throw new Error('no main');
  // 上月「同期之后」的大额账单：环比不得再把整月算进来（能构造时才加）
  if (dayN + 5 <= prevDays) {
    w2.Storage.getDB().wallet.bills.push({
      id: 'p-late', type: 'expense', amount: 1000,
      date: fmt(new Date(prevFirst.getFullYear(), prevFirst.getMonth(), dayN + 5)), time: '',
      catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '上月后段大额', tagIds: [], source: 'manual'
    });
  }
  const doc2 = w2.document;
  w2.App.go('plan');
  const wBalance = await waitFor(function () {
    const el = doc2.querySelector('[data-body=wBalance]');
    return el && el.innerHTML.length > 50 ? el : null;
  }, { label: '收支统计栏目未渲染' });
  const btext = wBalance.textContent;
  assert(btext.indexOf('月小结（月初至今）') >= 0, '甲15：小结应标注「月初至今」: ' + btext.slice(0, 200));
  assert(btext.indexOf('环比 ↑100%') >= 0, '甲15：环比应与上月同期 1~N 日比（100 vs 200 = ↑100%）: ' + btext.slice(0, 260));
  assert(btext.indexOf('与上月同期 1~') < 0, '甲15：口径备注已按拍板删除（环比数值断言锁语义）');
  assert(btext.indexOf('预算达成 75%') >= 0 || btext.indexOf('预算达成\n75%') >= 0 || /预算达成\s*75%/.test(btext),
    '甲15：预算达成应走合并口径（账单200+物品100 = 300/400 = 75%）: ' + btext.slice(0, 300));
  assert(/预算达成\s*50%/.test(btext) === false, '甲15：不得再用纯账单口径（50%）');
  console.log('PASS ' + cur);

  cur = '7. 甲15 预算达成扣重：已关联物品的账单不双算';
  const w2b = makeWindow({
    data: {
      settings: {
        idleWarnDays: 60,
        budget: { monthlyTotal: 400, categories: {}, walletCats: {} },
        planSections: [], rememberAccount: true
      },
      items: [
        { id: 'it2', kind: 'clothing', categoryId: 'top', subCategoryId: '', name: '鞋', purchaseDate: today, purchasePrice: 400, status: 'in_use', images: [], tags: [] }
      ],
      wallet: {
        accounts: [{ id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 1000, note: '' }],
        bills: [
          { id: 'lb', type: 'expense', amount: 400, date: today, time: '', catId: 'w_shop', subCatId: 'w_shop_clothing', accountId: '', note: '鞋（已关联词条）', tagIds: [], source: 'manual', itemId: 'it2' }
        ]
      }
    }
  });
  if (!(await waitMain(w2b))) throw new Error('no main');
  const doc2b = w2b.document;
  w2b.App.go('plan');
  const wBalanceB = await waitFor(function () {
    const el = doc2b.querySelector('[data-body=wBalance]');
    return el && el.innerHTML.length > 50 ? el : null;
  }, { label: '收支统计栏目未渲染' });
  const btextB = wBalanceB.textContent;
  assert(/预算达成\s*100%/.test(btextB),
    '甲15：关联账单 400 + 物品 400 − 关联扣重 400 = 400/400 = 100%，实为: ' + btextB.slice(0, 300));
  assert(/预算达成\s*200%/.test(btextB) === false, '甲15：已关联账单不得与物品购入双算（200% = 双算）');
  console.log('PASS ' + cur);

  /* ==================== w3：甲19 统计页交互 + 丙3 空态 ==================== */
  cur = '8. 甲19 资产走势隐藏周期切换；statRange 记忆 + 恢复 scrollTop';
  const w3 = makeWindow({
    data: {
      settings: { idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} }, planSections: [], rememberAccount: true },
      wallet: {
        accounts: [{ id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 1000, note: '' }],
        bills: [{ id: 'bl1', type: 'expense', amount: 12, date: today, time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: 'ac_cash', note: '午饭', tagIds: [], source: 'manual' }]
      }
    }
  });
  if (!(await waitMain(w3))) throw new Error('no main');
  const doc3 = w3.document;
  w3.App.go('plan');
  await waitFor(function () {
    return doc3.querySelector('[data-id=wBalance] .seg-toggle-head [data-sr]');
  }, { label: '统计页未渲染' });
  assert(doc3.querySelectorAll('[data-id=wBalance] .seg-toggle-head [data-sr]').length === 3, '收支统计应保留 周/月/年 切换器');
  // v1.1.8 P0-4 时间轴统一：资产走势随周期（周=7天/月=30天/年=365天），反转甲19①「固定 90 天」旧拍板
  assert(doc3.querySelectorAll('[data-id=wAssets] .seg-toggle-head [data-sr]').length === 3,
    '资产走势应随周期切换（v1.1.8 时间轴统一，弃固定 90 天）');
  assert(doc3.querySelectorAll('[data-id=wHeat] .seg-toggle-head [data-sr]').length === 3, '其余收支栏目保留周期切换器');
  // statRange 记忆进 db.settings（随账号）
  // v1.1.8 P0-4 后 monthly/wAssets 等也带切换器——裸 [data-sr] 会误点别的模块，一律限定 wBalance 内
  doc3.querySelector('[data-id=wBalance] [data-sr=year]').click();
  await waitFor(function () {
    return doc3.querySelector('[data-id=wBalance] [data-sr=year]') && doc3.querySelector('[data-id=wBalance] [data-sr=year]').classList.contains('on');
  }, { label: '切「年」未生效' });
  await waitFor(function () {
    return w3.Storage.getDB().settings.statRanges && w3.Storage.getDB().settings.statRanges.wBalance === 'year';
  }, { label: '甲19②：statRanges 未记忆进 db.settings（每模块独立）' });
  w3.App.refresh();
  await waitFor(function () {
    return doc3.querySelector('[data-id=wBalance] [data-sr=year]') && doc3.querySelector('[data-id=wBalance] [data-sr=year]').classList.contains('on');
  }, { label: '甲19②：refresh 后统计周期未恢复' });
  // 切周期恢复 scrollTop
  const main3 = doc3.querySelector('.main');
  main3.scrollTop = 123;
  doc3.querySelector('[data-id=wBalance] [data-sr=week]').click();
  await waitFor(function () {
    return doc3.querySelector('[data-id=wBalance] [data-sr=week]') && doc3.querySelector('[data-id=wBalance] [data-sr=week]').classList.contains('on');
  }, { label: '切「周」未生效' });
  const main3b = doc3.querySelector('.main');
  assert(main3b.scrollTop === 123,
    '甲19②：切换周期后应恢复滚动位置（期望 123，实为 ' + main3b.scrollTop + '）');
  console.log('PASS ' + cur);

  cur = '9. 甲19 离开统计页即退出 editMode';
  doc3.getElementById('btn-edit-sections').click();
  await waitFor(function () {
    return doc3.querySelector('.plan-sec[data-id=monthly][draggable]');
  }, { label: '栏目编辑模式未进入' });
  w3.App.go('wallet');
  await waitFor(function () {
    return doc3.getElementById('wallet-body');
  }, { label: '未切到流水页' });
  w3.App.go('plan');
  await waitFor(function () {
    return doc3.getElementById('btn-edit-sections');
  }, { label: '统计页未返回' });
  assert(doc3.getElementById('btn-edit-sections').textContent.indexOf('栏目设置') >= 0,
    '甲19③：离开统计页后应退出编辑模式（按钮应回到「栏目设置」），实为: ' +
    doc3.getElementById('btn-edit-sections').textContent);
  assert(!doc3.querySelector('.plan-sec[draggable]'), '甲19③：离开后回来不得残留编辑模式');
  console.log('PASS ' + cur);

  cur = '10. 丙3 空态卡：统一结构 + 块屏蔽/面板空态/设置空态';
  // 块屏蔽空态卡（编辑模式下显示，带恢复引导按钮 data-block-toggle；正常模式整块隐藏=plan-blocks 口径）
  doc3.getElementById('btn-edit-sections').click();
  await waitFor(function () {
    return doc3.querySelector('.plan-sec[draggable]');
  }, { label: '未进入编辑模式' });
  doc3.querySelector('[data-block-toggle=overall]').click();
  await waitFor(function () {
    return doc3.querySelector('.plan-block[data-block=overall] .empty-state.empty-card');
  }, { label: '块屏蔽空态未渲染' });
  const offCard = doc3.querySelector('.plan-block[data-block=overall] .empty-state.empty-card');
  assert(offCard.querySelector('.empty-icon') && offCard.querySelector('p') && offCard.querySelector('button.btn.btn-ghost'),
    '丙3：空态卡应为 图标 + 文案 + 引导按钮 统一结构');
  offCard.querySelector('button[data-block-toggle]').click();
  await waitFor(function () {
    return doc3.querySelector('.plan-block[data-block=overall] .plan-grid [data-id=kpi]');
  }, { label: '块屏蔽未恢复' });
  doc3.getElementById('btn-edit-sections').click(); // 退出编辑模式
  await waitFor(function () {
    return !doc3.querySelector('.plan-sec[draggable]');
  }, { label: '未退出编辑模式' });
  // 面板空态卡（无物品 → 数码排行空态）
  const dPriceCard = await waitFor(function () {
    const el = doc3.querySelector('[data-body=dPrice] .empty-state.empty-card');
    return el || null;
  }, { label: '面板空态未渲染' });
  assert(dPriceCard.querySelector('.empty-icon') && dPriceCard.querySelector('p') &&
    dPriceCard.querySelector('[data-eg-go=digital]'),
    '丙3：面板空态应为统一结构且带引导按钮');
  // 设置页空态卡（钱袋标签库为空）
  w3.App.go('settings');
  await waitFor(function () {
    return doc3.getElementById('wtag-list');
  }, { label: '设置页未渲染' });
  const wtagCard = doc3.querySelector('#wtag-list .empty-state.empty-card');
  assert(wtagCard && wtagCard.querySelector('.empty-icon') && wtagCard.querySelector('p') && wtagCard.querySelector('button.btn'),
    '丙3：设置页空态应为统一结构');
  console.log('PASS ' + cur);

  /* ==================== CSS 定稿断言（丙1/2/3/5/6/7/8） ==================== */
  cur = '11. 丙1/2/5/6/7/8 CSS 定稿';
  const cssExtra = fs.readFileSync(path.join(APP, 'css', 'extra.css'), 'utf8');
  const cssStyles = fs.readFileSync(path.join(APP, 'css', 'styles.css'), 'utf8');
  // 丙1 选中低调版：浅蓝底 + inset 1px 细描边 + accent 文字/图标；渐变/辉光删除
  const navActive = blockOf(cssExtra, /\.nav-item\.active\s*\{([^}]*)\}/);
  assert(navActive.indexOf('rgba(15, 118, 238, .10)') >= 0, '丙1：选中态应浅蓝底 rgba(15,118,238,.10)');
  assert(navActive.indexOf('inset 0 0 0 1px rgba(15, 118, 238, .28)') >= 0, '丙1：选中态应 inset 1px 细描边');
  assert(navActive.indexOf('linear-gradient') < 0 && navActive.indexOf('#0f76ee') < 0, '丙1：选中态不得再用渐变');
  assert(navActive.indexOf('#fff') < 0, '丙1：选中文字应走 var(--accent)，不得白字');
  assert(blockOf(cssExtra, /\.nav-item\.active \.nav-icon\s*\{([^}]*)\}/).indexOf('var(--accent)') >= 0,
    '丙1：选中图标应 var(--accent) 色');
  assert(cssExtra.indexOf('#3e93f7') < 0 && cssExtra.indexOf('0 3px 8px -2px rgba(15, 118, 238') < 0,
    '丙1：渐变/辉光规则应删除');
  // 丙2 统计面板内容顶部对齐（该选择器有多条规则，合并扫描）
  const planBody = blocksOf(cssExtra, /\.plan-sec \.panel-body\s*\{([^}]*)\}/);
  assert(planBody.indexOf('justify-content: flex-start') >= 0, '丙2：panel-body 应 flex-start 顶部对齐');
  assert(planBody.indexOf('justify-content: center') < 0, '丙2：不得再垂直居中');
  // 丙3 空态卡 CSS
  const emptyCard = blockOf(cssExtra, /\.empty-card\s*\{([^}]*)\}/);
  assert(emptyCard.indexOf('background: #f6f6f9') >= 0, '丙3：empty-card 应灰底 #f6f6f9');
  assert(emptyCard.indexOf('border-radius: 16px') >= 0, '丙3：empty-card 应 16px 圆角');
  assert(emptyCard.indexOf('box-shadow: var(--shadow-card)') >= 0, '丙3：empty-card 应 1px 接触影');
  assert(emptyCard.indexOf('padding: 32px') >= 0, '丙3：empty-card 内边距应 32px+');
  // 丙5 排行条列宽（v1.1.8 反转当年丙5：弹性宽度让条形起点随名称长度漂移，改回固定宽列）
  const rankLabel = blockOf(cssStyles, /\.rank-label\s*\{([^}]*)\}/);
  const rankValue = blockOf(cssStyles, /\.rank-value\s*\{([^}]*)\}/);
  assert(rankLabel.indexOf('flex: 0 0 96px') >= 0 && rankLabel.indexOf('width: 96px') >= 0,
    '丙5(v1.1.8)：rank-label 应固定 96px（条形同起点）');
  assert(rankLabel.indexOf('overflow: hidden') >= 0,
    '丙5(v1.1.8)：超长名称应截断（悬停自动滚动展示）');
  assert(rankValue.indexOf('flex: 0 1 auto') >= 0 && rankValue.indexOf('min-width: 96px') >= 0,
    '丙5：rank-value 应弹性且 min-width:96px');
  assert(rankValue.indexOf('width: 118px') < 0, '丙5：rank-value 固定宽应删除');
  // 丙6 超宽屏收窄
  assert(/\.main > #main-content\s*\{[^}]*max-width: 1440px[^}]*margin: 0 auto/.test(cssExtra),
    '丙6：主内容区应 max-width 1440px + 居中');
  // 丙7 键盘焦点三套合一
  assert(/:focus-visible\s*\{[^}]*outline: 2px solid var\(--accent\)[^}]*outline-offset: 2px/.test(cssExtra),
    '丙7：:focus-visible 应统一 2px accent 描边环');
  assert(cssExtra.indexOf('.stab-btn:focus-visible') < 0 && cssExtra.indexOf('box-shadow: var(--focus-ring)') < 0,
    '丙7：nav/seg/stab 旧 box-shadow 焦点环应删除');
  // 丙8 弹窗三档兜底
  assert(blockOf(cssExtra, /\.modal-sm\s*\{([^}]*)\}/).indexOf('min(92vw, 440px)') >= 0, '丙8：.modal-sm 应 440 档');
  assert(blockOf(cssExtra, /\.modal-lg\s*\{([^}]*)\}/).indexOf('min(92vw, 720px)') >= 0, '丙8：.modal-lg 应 720 档');
  assert(blockOf(cssExtra, /\.modal\s*\{([^}]*)\}/).indexOf('max-width: min(92vw, 560px)') >= 0,
    '丙8：.modal 默认档应 560 兜底收敛');
  console.log('PASS ' + cur);

  console.log('========== v1.1.6 统计/设置线回归锁：11 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
