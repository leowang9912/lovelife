/* smoke.test.js — v3 端到端烟测：账号、我的生活、美食日历、我的筹算、搜索
   （已迁移到 tests/helpers/harness.js：JSDOM + fetch mock + 等待工具统一走共享基建，
     内存多账号库经 opts.routes 接入） */
'use strict';
const { makeWindow, waitFor, sleep, waitMain } = require('./helpers/harness');

/* 内存账号库（多账号隔离），原 makeMemAPI 的 store 语义原样保留 */
function makeMemStore() {
  return {
    accounts: [{ id: 'me', name: '我', icon: '😊' }],
    lastAccountId: 'me',
    dataRoot: 'mem://data',
    perAcc: {
      me: {
        items: [], outfits: [], food: [], events: [],
        settings: {
          idleWarnDays: 60,
          budget: { monthlyTotal: 3000, categories: { digital: 1000, clothing: 800, life: 600, food: 600 } },
          planSections: [
            { id: 'kpi', enabled: true, fixed: true },
            { id: 'composition', enabled: true, fixed: true },
            { id: 'monthly', enabled: true },
            { id: 'budget', enabled: true },
            { id: 'expiry', enabled: true }
          ],
          makeupLooks: []
        },
        categories: {
          digital: [
            { id: 'host', name: '主机类', lifeYears: 5, residualRate: 0.1, costModel: 'daily_dep', children: [{ id: 'host_phone', name: '手机' }, { id: 'host_handheld', name: '掌机' }] },
            { id: 'game', name: '游戏', costModel: 'per_title', children: [{ id: 'gm_cartridge', name: '卡带' }, { id: 'gm_digital', name: '数字版' }] }
          ],
          clothing: [{ id: 'top', name: '上装', children: [{ id: 'top_tee', name: 'T恤' }] }],
          life: [
            { id: 'skin', name: '护肤', icon: '🧴', children: [{ id: 'sk_cream', name: '面霜' }] },
            { id: 'makeup', name: '彩妆', icon: '💄', children: [{ id: 'mk_lip', name: '口红' }] }
          ],
          tagPresets: ['送人', '贵重'], condition: ['全新', '9成新'], remainLevel: ['满', '½', '空'],
          sizeSystem: ['中国码', '均码'], skinType: ['干皮', '通用'], usageFreq: ['偶尔用'], washMethod: ['机洗'],
          foodCuisine: ['中餐', '日料', '西餐', '火锅'], foodType: ['主食', '肉菜', '甜品'], meal: ['早餐', '午餐', '晚餐'],
          foodTag: ['自制', '外卖'], occasion: ['通勤'], season: ['春']
        }
      }
    }
  };
}

let curN = 0, curName = '';
function begin(n, name) { curN = n; curName = name; }

async function main() {
  const store = makeMemStore();

  const w = makeWindow({
    routes: {
      'api/session': ({ ok }) => ok({ ok: true, accounts: store.accounts, lastAccountId: store.lastAccountId, dataRoot: store.dataRoot, schemaVersion: 3 }),
      'api/db': ({ url, ok }) => {
        const acc = (String(url).match(/acc=([^&]+)/) || [])[1] || store.lastAccountId || 'me';
        const d = store.perAcc[acc] || store.perAcc.me;
        return ok({
          schemaVersion: 3,
          account: store.accounts.find(function (a) { return a.id === acc; }) || store.accounts[0],
          accounts: store.accounts,
          items: d.items, outfits: d.outfits, food: d.food, events: d.events,
          settings: d.settings, categories: d.categories, dataRoot: store.dataRoot
        });
      },
      'api/save': ({ url, body, ok }) => {
        const p = body || {};
        const acc = (String(url).match(/acc=([^&]+)/) || [])[1] || store.lastAccountId || 'me';
        const d = store.perAcc[acc] || store.perAcc.me;
        const target = store.perAcc[p.acc] || d;
        if (p.target === 'items') target.items = p.data;
        if (p.target === 'outfits') target.outfits = p.data;
        if (p.target === 'food') target.food = p.data;
        if (p.target === 'events') target.events = p.data;
        if (p.target === 'settings') { target.settings = p.data.settings; target.categories = p.data.categories; }
        return ok({ ok: true });
      },
      'api/upload': ({ ok }) => ok({ ok: true, path: 'images/img-mock-' + Date.now() + '.webp' }),
      'api/account': ({ body, ok }) => {
        const p = body || {};
        if (p.action === 'create') {
          const a = { id: 'acc-' + Date.now(), name: p.name, icon: p.icon || '😊' };
          store.accounts.push(a);
          store.perAcc[a.id] = JSON.parse(JSON.stringify(store.perAcc.me));
          store.perAcc[a.id].items = []; store.perAcc[a.id].outfits = []; store.perAcc[a.id].food = [];
          return ok({ ok: true, account: a, accounts: store.accounts });
        }
        if (p.action === 'select') { store.lastAccountId = p.id || store.lastAccountId; return ok({ ok: true }); }
        return ok({ ok: true, accounts: store.accounts });
      }
    }
  });

  // 图片流程 mock（cutout/上传用）
  w.createImageBitmap = async () => ({ width: 80, height: 80, close() {} });
  w.HTMLCanvasElement.prototype.getContext = function () { return { drawImage() {}, getImageData: function () { return { data: new Uint8ClampedArray(4) }; }, putImageData() {}, createImageData: function (cw, ch) { return { data: new Uint8ClampedArray(cw * ch * 4) }; }, fillRect() {}, clearRect() {} }; };
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob([new Uint8Array([1])])); };

  const doc = w.document;

  // 1) 启动动画/账号（等启动动画结束，账号选择屏显示产品名）
  begin(1, '启动界面显示');
  await waitFor(function () {
    return doc.querySelector('[data-acc]') || doc.getElementById('main-content');
  }, { label: '启动界面异常' });
  if (!doc.getElementById('app').innerHTML.includes('人生管家')) throw new Error('启动界面异常');
  console.log('PASS 1. 启动界面显示');

  // 2) 账号进入主界面 + 导航
  begin(2, '账号进入主界面，导航含我的筹算/我的生活/美食日历');
  await waitMain(w);
  if (!doc.querySelector('[data-nav=plan]')) {
    console.error('当前 DOM 片段:', doc.getElementById('app').innerHTML.slice(0, 400));
    throw new Error('未进入主界面');
  }
  const nav = doc.querySelector('.sidebar').innerHTML;
  ['我的统计', '我的数码', '我的衣橱', '我的生活', '穿搭日历', '美食日历', '设置'].forEach(function (n) {
    if (nav.indexOf(n) < 0) throw new Error('缺少导航: ' + n);
  });
  console.log('PASS 2. 账号进入主界面，导航含我的筹算/我的生活/美食日历');

  // 3) 录入数据
  begin(3, '录入 衣服+妆品+打卡+美食');
  const S = w.Storage;
  const M = w.Models;
  await S.loadAll();
  await S.saveItem({ id: 'cloth1', kind: 'clothing', categoryId: 'top', subCategoryId: 'top_tee', name: '卫衣', purchaseDate: '2025-01-01', purchasePrice: 299, status: 'in_use', manualWearCount: 2, tags: ['贵重'], storageLocation: '衣柜' });
  await S.saveItem({ id: 'life1', kind: 'life', categoryId: 'skin', subCategoryId: 'sk_cream', name: '面霜', purchaseDate: '2025-02-01', purchasePrice: 500, openedDate: '2025-03-01', paoMonths: 6, useCount: 10, status: 'in_use' });
  await S.saveOutfit({ id: 'o1', date: '2025-03-10', itemIds: ['cloth1'], cosmeticIds: ['life1'], images: [], occasion: '通勤' });
  await S.saveFood({ id: 'f1', date: '2025-03-10', meal: '午餐', foodCuisine: '中餐', foodType: '主食', name: '牛肉面', price: 28, rating: 5, tags: ['外卖'], images: [] });
  console.log('PASS 3. 录入 衣服+妆品+打卡+美食');

  // 4) 新字段保存
  begin(4, '新分类/存放位置/标签字段');
  const c1 = S.getDB().items.find(i => i.id === 'cloth1');
  if (c1.subCategoryId !== 'top_tee' || c1.storageLocation !== '衣柜' || c1.tags[0] !== '贵重') {
    throw new Error('新字段保存失败');
  }
  console.log('PASS 4. 新分类/存放位置/标签字段');

  // 5) 使用次数自动叠加（打卡 +1）
  begin(5, '使用次数自动叠加 (妆品11次, 衣服3次=手动2+自动1)');
  let db = S.getDB();
  let life1 = db.items.find(i => i.id === 'life1');
  if (Number(life1.useCount) !== 11) throw new Error('妆品打卡未自动+1: ' + life1.useCount);
  const wear = M.totalWearCount(db, db.items.find(i => i.id === 'cloth1'));
  if (wear !== 3) throw new Error('穿着叠加错误: ' + wear + ' (应=手动2+自动1)');
  console.log('PASS 5. 使用次数自动叠加 (妆品11次, 衣服3次=手动2+自动1)');

  // 6) 美食校验
  begin(6, '美食必填校验（菜系/餐别/价格）');
  const ferrs = M.validateFood({ foodCuisine: '', meal: '', price: '' });
  if (ferrs.length !== 3) throw new Error('美食校验错误');
  if (M.validateFood({ foodCuisine: '中餐', meal: '午餐', price: 20 }).length !== 0) throw new Error('美食校验误报');
  console.log('PASS 6. 美食必填校验（菜系/餐别/价格）');

  // 6b) 使用流水：+1 记流水、删流水回减
  begin(7, '使用流水增删与总数联动');
  const lifeB = S.getDB().items.find(i => i.id === 'life1');
  const before = Number(lifeB.useCount);
  M.appendUsageLog(lifeB, 2, 'manual', '手动补记');
  if (Number(lifeB.useCount) !== before + 2) throw new Error('流水+1 未同步总数');
  const logId = lifeB.usageLog[lifeB.usageLog.length - 1].id;
  M.removeUsageLogEntry(lifeB, logId);
  if (Number(lifeB.useCount) !== before) throw new Error('删流水未回减总数');
  await S.saveItem(lifeB);
  console.log('PASS 7. 使用流水增删与总数联动');

  // 7) PAO 临期
  begin(8, 'PAO 临期判断');
  const s = M.lifeStatus(life1, new Date('2025-08-20'));
  if (s.paoState !== 'near') throw new Error('PAO 临期判断错误: ' + JSON.stringify(s));
  console.log('PASS 8. PAO 临期判断');

  // 8) 全部页面渲染
  begin(9, '7 个页面全部渲染成功');
  for (const page of ['plan', 'digital', 'clothing', 'life', 'outfits', 'food', 'settings']) {
    w.App.go(page);
    await waitFor(function () {
      const main = doc.getElementById('main-content') || doc.getElementById('main');
      return main && main.innerHTML.length >= 50;
    }, { label: '页面为空: ' + page });
  }
  console.log('PASS 9. 7 个页面全部渲染成功');

  // 9) 我的统计栏目
  begin(10, '我的统计含 KPI/预算 + 三档位(s/m/l)');
  w.App.go('plan');
  await waitFor(function () {
    const main = doc.getElementById('main-content');
    return main && main.innerHTML.indexOf('KPI 总览') >= 0;
  }, { label: '统计缺 KPI' });
  const plan = doc.getElementById('main-content').innerHTML;
  if (plan.indexOf('KPI 总览') < 0) throw new Error('统计缺 KPI');
  if (plan.indexOf('预算进度') < 0) throw new Error('统计缺预算');
  if (plan.indexOf('我的统计') < 0) throw new Error('未改名我的统计');
  if (plan.indexOf('data-size=') < 0) throw new Error('面板档位缺失');
  if (plan.indexOf('KPI 总览') >= 0 && plan.indexOf('data-size="l"') < 0) throw new Error('KPI 大档位缺失');
  if (plan.indexOf('data-size="xl"') >= 0) throw new Error('仍存在 xl 档位');
  console.log('PASS 10. 我的统计含 KPI/预算 + 三档位(s/m/l)');

  // 10) 全局搜索
  begin(11, '全局搜索命中美食');
  const gs = doc.getElementById('global-search');
  gs.value = '牛肉面';
  gs.dispatchEvent(new w.Event('input'));
  await waitFor(function () {
    const results = doc.getElementById('search-results');
    return results && results.classList.contains('show') && results.innerHTML.indexOf('牛肉面') >= 0;
  }, { label: '全局搜索未返回美食结果' });
  const results = doc.getElementById('search-results');
  if (!results.classList.contains('show') || results.innerHTML.indexOf('牛肉面') < 0) {
    throw new Error('全局搜索未返回美食结果');
  }
  console.log('PASS 11. 全局搜索命中美食');

  // 11) 穿搭日历大图
  begin(12, '穿搭日历含年月快速跳转');
  w.App.go('outfits');
  await waitFor(function () { return doc.querySelector('#jump-year'); }, { label: '缺少年份跳转' });
  if (!doc.querySelector('#jump-year')) throw new Error('缺少年份跳转');
  console.log('PASS 12. 穿搭日历含年月快速跳转');

  // 12) 美食日历
  begin(13, '美食日历渲染');
  w.App.go('food');
  await waitFor(function () {
    const main = doc.getElementById('main-content');
    return main && main.innerHTML.indexOf('美食日历') >= 0;
  }, { label: '美食日历缺失' });
  const foodPage = doc.getElementById('main-content').innerHTML;
  if (foodPage.indexOf('美食日历') < 0) throw new Error('美食日历缺失');
  console.log('PASS 13. 美食日历渲染');

  // 13) 账号创建
  begin(14, '账号数据隔离（新账号独立空数据）');
  const acc2 = await S.createAccount('测试号', '🐱');
  await S.selectAccount(acc2.id);
  const db2 = S.getDB();
  if (db2.items.length !== 0) throw new Error('新账号数据应为空');
  await S.saveItem({ id: 'x1', kind: 'life', categoryId: 'makeup', subCategoryId: 'mk_lip', name: '口红', purchaseDate: '2025-01-01', purchasePrice: 200, status: 'in_use', remainLevel: '满' });
  if (S.getDB().items.length !== 1) throw new Error('新账号保存失败');
  console.log('PASS 14. 账号数据隔离（新账号独立空数据）');

  console.log('========== smoke：14 项全部通过 ==========');
  process.exit(0);
}

main().catch(e => {
  console.error('FAIL ' + curN + '. ' + curName + ': ' + e.message);
  process.exit(1);
});
