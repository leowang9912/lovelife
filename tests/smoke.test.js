/* smoke.test.js — v3 端到端烟测：账号、我的生活、美食日历、我的筹算、搜索 */
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const APP = path.join(__dirname, '..', 'app');

function makeMemAPI() {
  const store = {
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

  function ok(body) {
    return { ok: true, status: 200, json: async () => body, blob: async () => new Blob([1]), arrayBuffer: async () => new ArrayBuffer(4) };
  }
  function err(code) {
    return { ok: false, status: code, json: async () => ({ error: 'err' }), blob: async () => new Blob(), arrayBuffer: async () => new ArrayBuffer(0) };
  }

  async function handler(url, opts) {
    opts = opts || {};
    const method = (opts.method || 'GET').toUpperCase();
    const u = url.replace(/^https?:\/\/[^/]+/, '');
    const pathOnly = u.split('?')[0];
    const acc = (u.match(/acc=([^&]+)/) || [])[1] || store.lastAccountId || 'me';
    const d = store.perAcc[acc] || store.perAcc.me;

    if (pathOnly === '/api/ping') return ok({ ok: true });
    if (pathOnly === '/api/session') {
      return ok({ ok: true, accounts: store.accounts, lastAccountId: store.lastAccountId, dataRoot: store.dataRoot, schemaVersion: 3 });
    }
    if (pathOnly === '/api/db') {
      return ok({
        schemaVersion: 3,
        account: store.accounts.find(function (a) { return a.id === acc; }) || store.accounts[0],
        accounts: store.accounts,
        items: d.items, outfits: d.outfits, food: d.food, events: d.events,
        settings: d.settings, categories: d.categories, dataRoot: store.dataRoot
      });
    }
    if (pathOnly === '/api/save' && method === 'POST') {
      const p = JSON.parse(opts.body);
      const target = store.perAcc[p.acc] || d;
      if (p.target === 'items') target.items = p.data;
      if (p.target === 'outfits') target.outfits = p.data;
      if (p.target === 'food') target.food = p.data;
      if (p.target === 'events') target.events = p.data;
      if (p.target === 'settings') { target.settings = p.data.settings; target.categories = p.data.categories; }
      return ok({ ok: true });
    }
    if (pathOnly === '/api/upload' && method === 'POST') {
      const n = 'img-mock-' + Date.now() + '.webp';
      return ok({ ok: true, path: 'images/' + n });
    }
    if (pathOnly === '/api/account' && method === 'POST') {
      const p = JSON.parse(opts.body);
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
    if (pathOnly === '/api/backup') return ok(new Uint8Array([1]));
    return err(404);
  }
  return { handler, store };
}

async function main() {
  const api = makeMemAPI();
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8765/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;

  window.fetch = api.handler;
  window.createImageBitmap = async () => ({ width: 80, height: 80, close() {} });
  window.HTMLCanvasElement.prototype.getContext = function () { return { drawImage() {}, getImageData: function () { return { data: new Uint8ClampedArray(4) }; }, putImageData() {}, createImageData: function (w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; }, fillRect() {}, clearRect() {} }; };
  window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new window.Blob([new Uint8Array([1])])); };
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};

  const scripts = ['utils.js', 'models.js', 'storage.js', 'charts.js', 'cutout.js', 'ui.js',
    'views-plan.js', 'views-main.js', 'views-life.js', 'views-food.js', 'views-settings.js', 'app.js'];
  for (const s of scripts) {
    try { window.eval(fs.readFileSync(path.join(APP, 'js', s), 'utf8')); }
    catch (e) { console.error('✗ 脚本加载失败:', s, e.message); process.exit(1); }
  }
  console.log('✓ ' + scripts.length + ' 个脚本加载完成');

  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  // 等启动动画结束（700ms）+ 渲染
  await new Promise(r => setTimeout(r, 1000));

  // 1) 启动动画/账号
  const app = window.document.getElementById('app');
  if (!app.innerHTML.includes('人生管家')) throw new Error('启动界面异常');
  console.log('✓ 启动界面显示');

  // 若显示账号选择，点击进入
  const accCard = window.document.querySelector('[data-acc]');
  if (accCard) {
    accCard.click();
    await new Promise(r => setTimeout(r, 200));
  }
  if (!window.document.querySelector('[data-nav=plan]')) {
    console.error('当前 DOM 片段:', app.innerHTML.slice(0, 400));
    throw new Error('未进入主界面');
  }
  console.log('✓ 账号进入主界面，导航含我的筹算/我的生活/美食日历');
  const nav = window.document.querySelector('.nav').innerHTML;
  ['我的统计', '我的数码', '我的衣橱', '我的生活', '穿搭日历', '美食日历', '设置'].forEach(function (n) {
    if (nav.indexOf(n) < 0) throw new Error('缺少导航: ' + n);
  });

  // 2) 录入数据
  const S = window.Storage;
  const M = window.Models;
  await S.loadAll();
  await S.saveItem({ id: 'cloth1', kind: 'clothing', categoryId: 'top', subCategoryId: 'top_tee', name: '卫衣', purchaseDate: '2025-01-01', purchasePrice: 299, status: 'in_use', manualWearCount: 2, tags: ['贵重'], storageLocation: '衣柜' });
  await S.saveItem({ id: 'life1', kind: 'life', categoryId: 'skin', subCategoryId: 'sk_cream', name: '面霜', purchaseDate: '2025-02-01', purchasePrice: 500, openedDate: '2025-03-01', paoMonths: 6, useCount: 10, status: 'in_use' });
  await S.saveOutfit({ id: 'o1', date: '2025-03-10', itemIds: ['cloth1'], cosmeticIds: ['life1'], images: [], occasion: '通勤' });
  await S.saveFood({ id: 'f1', date: '2025-03-10', meal: '午餐', foodCuisine: '中餐', foodType: '主食', name: '牛肉面', price: 28, rating: 5, tags: ['外卖'], images: [] });
  console.log('✓ 录入 衣服+妆品+打卡+美食');
  const c1 = S.getDB().items.find(i => i.id === 'cloth1');
  if (c1.subCategoryId !== 'top_tee' || c1.storageLocation !== '衣柜' || c1.tags[0] !== '贵重') {
    throw new Error('新字段保存失败');
  }
  console.log('✓ 新分类/存放位置/标签字段');

  // 3) 使用次数自动叠加（打卡 +1）
  let db = S.getDB();
  let life1 = db.items.find(i => i.id === 'life1');
  if (Number(life1.useCount) !== 11) throw new Error('妆品打卡未自动+1: ' + life1.useCount);
  const wear = M.totalWearCount(db, db.items.find(i => i.id === 'cloth1'));
  if (wear !== 3) throw new Error('穿着叠加错误: ' + wear + ' (应=手动2+自动1)');
  console.log('✓ 使用次数自动叠加 (妆品11次, 衣服3次=手动2+自动1)');

  // 4) 美食校验
  const ferrs = M.validateFood({ foodCuisine: '', meal: '', price: '' });
  if (ferrs.length !== 3) throw new Error('美食校验错误');
  if (M.validateFood({ foodCuisine: '中餐', meal: '午餐', price: 20 }).length !== 0) throw new Error('美食校验误报');
  console.log('✓ 美食必填校验（菜系/餐别/价格）');

  // 4b) 使用流水：+1 记流水、删流水回减
  const lifeB = S.getDB().items.find(i => i.id === 'life1');
  const before = Number(lifeB.useCount);
  M.appendUsageLog(lifeB, 2, 'manual', '手动补记');
  if (Number(lifeB.useCount) !== before + 2) throw new Error('流水+1 未同步总数');
  const logId = lifeB.usageLog[lifeB.usageLog.length - 1].id;
  M.removeUsageLogEntry(lifeB, logId);
  if (Number(lifeB.useCount) !== before) throw new Error('删流水未回减总数');
  await S.saveItem(lifeB);
  console.log('✓ 使用流水增删与总数联动');

  // 5) PAO 临期
  const s = M.lifeStatus(life1, new Date('2025-08-20'));
  if (s.paoState !== 'near') throw new Error('PAO 临期判断错误: ' + JSON.stringify(s));
  console.log('✓ PAO 临期判断');

  // 6) 全部页面渲染
  for (const page of ['plan', 'digital', 'clothing', 'life', 'outfits', 'food', 'settings']) {
    window.App.go(page);
    await new Promise(r => setTimeout(r, 40));
    const main = window.document.getElementById('main-content') || window.document.getElementById('main');
    if (!main || main.innerHTML.length < 50) throw new Error('页面为空: ' + page);
  }
  console.log('✓ 7 个页面全部渲染成功');

  // 7) 我的统计栏目
  window.App.go('plan');
  await new Promise(r => setTimeout(r, 40));
  const plan = window.document.getElementById('main-content').innerHTML;
  if (plan.indexOf('KPI 总览') < 0) throw new Error('统计缺 KPI');
  if (plan.indexOf('预算进度') < 0) throw new Error('统计缺预算');
  if (plan.indexOf('我的统计') < 0) throw new Error('未改名我的统计');
  if (plan.indexOf('data-size=') < 0) throw new Error('面板档位缺失');
  if (plan.indexOf('KPI 总览') >= 0 && plan.indexOf('data-size="l"') < 0) throw new Error('KPI 大档位缺失');
  if (plan.indexOf('data-size="xl"') >= 0) throw new Error('仍存在 xl 档位');
  console.log('✓ 我的统计含 KPI/预算 + 三档位(s/m/l)');

  // 8) 全局搜索
  const gs = window.document.getElementById('global-search');
  gs.value = '牛肉面';
  gs.dispatchEvent(new window.Event('input'));
  await new Promise(r => setTimeout(r, 350));
  const results = window.document.getElementById('search-results');
  if (!results.classList.contains('show') || results.innerHTML.indexOf('牛肉面') < 0) {
    throw new Error('全局搜索未返回美食结果');
  }
  console.log('✓ 全局搜索命中美食');

  // 9) 穿搭日历大图
  window.App.go('outfits');
  await new Promise(r => setTimeout(r, 40));
  if (!window.document.querySelector('#jump-year')) throw new Error('缺少年份跳转');
  console.log('✓ 穿搭日历含年月快速跳转');

  // 10) 美食日历
  window.App.go('food');
  await new Promise(r => setTimeout(r, 40));
  const foodPage = window.document.getElementById('main-content').innerHTML;
  if (foodPage.indexOf('美食日历') < 0) throw new Error('美食日历缺失');
  console.log('✓ 美食日历渲染');

  // 11) 账号创建
  const acc2 = await S.createAccount('测试号', '🐱');
  await S.selectAccount(acc2.id);
  const db2 = S.getDB();
  if (db2.items.length !== 0) throw new Error('新账号数据应为空');
  await S.saveItem({ id: 'x1', kind: 'life', categoryId: 'makeup', subCategoryId: 'mk_lip', name: '口红', purchaseDate: '2025-01-01', purchasePrice: 200, status: 'in_use', remainLevel: '满' });
  if (S.getDB().items.length !== 1) throw new Error('新账号保存失败');
  console.log('✓ 账号数据隔离（新账号独立空数据）');

  console.log('\n========== v3 全部烟测通过 ==========');
  process.exit(0);
}

main().catch(e => {
  console.error('\n✗ 烟测失败:', e.message);
  console.error(e.stack);
  process.exit(1);
});
