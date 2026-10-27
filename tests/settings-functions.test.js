/* settings-functions.test.js — 设置页各功能逐项验证 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const APP = path.join(__dirname, '..', 'app');

const calls = [];   // 记录 API 调用
let settings = {
  idleWarnDays: 60,
  budget: { monthlyTotal: 0, categories: { digital: 0, clothing: 0, life: 0, food: 0 } },
  planSections: [], rememberAccount: true
};
let categories = {
  digital: [{ id: 'host', name: 'Host', lifeYears: 5, residualRate: 0.1, children: [] }],
  clothing: [], life: [],
  foodCuisine: [], foodType: [], meal: [], foodTag: [], occasion: [], season: [],
  tagPresets: [], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
};
let accounts = [{ id: 'me', name: 'Me', icon: 'x' }, { id: 'b', name: 'Other', icon: 'y' }];
let items = [{ id: 'i1', kind: 'clothing', categoryId: 'top', name: 'T', purchaseDate: '2025-01-01', purchasePrice: 100, status: 'in_use' }];

function makeWindow() {
  const dom = new JSDOM(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), {
    url: 'http://127.0.0.1:8765/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  window.fetch = async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    let body = null;
    if (opts && opts.body) { try { body = JSON.parse(opts.body); } catch (e) { body = {}; } }
    calls.push({ url: u, method, body });
    const ok = (b) => ({ ok: true, status: 200, json: async () => b, blob: async () => new Blob([1]), arrayBuffer: async () => new ArrayBuffer(4) });
    if (u.includes('/api/session')) return ok({ ok: true, accounts, lastAccountId: 'me', dataRoot: 'D:\\x\\data', schemaVersion: 3 });
    if (u.includes('/api/ping')) return ok({ ok: true });
    if (u.includes('/api/update/check')) return ok({ ok: true, localVersion: '1.0.1', remoteVersion: '1.0.1', hasUpdate: false, changelog: [] });
    if (u.includes('/api/version')) return ok({ version: '1.0.1', minSchema: 3, changelog: ['a'] });
    if (u.includes('/api/backup')) return ok(new Uint8Array([1]));
    if (u.includes('/api/account')) {
      if (body && body.action === 'rename') {
        const a = accounts.find(x => x.id === body.id); if (a) { a.name = body.name; a.icon = body.icon; }
      }
      if (body && body.action === 'delete') accounts = accounts.filter(x => x.id !== body.id);
      return ok({ ok: true, accounts });
    }
    if (u.includes('/api/data-root')) return ok({ ok: true, dataRoot: body.path });
    if (u.includes('/api/save')) {
      if (body.target === 'settings') { settings = body.data.settings; categories = body.data.categories; }
      return ok({ ok: true });
    }
    if (u.includes('/api/db')) return ok({
      schemaVersion: 3,
      account: accounts.find(a => a.id === 'me'), accounts,
      items: items.slice(), outfits: [], food: [], events: [],
      settings, categories, dataRoot: 'D:\\x\\data'
    });
    return ok({ ok: true });
  };
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  window.URL.createObjectURL = () => 'blob:x';
  window.URL.revokeObjectURL = () => {};
  for (const f of ['utils.js', 'models.js', 'storage.js', 'charts.js', 'cutout.js', 'ui.js',
    'views-plan.js', 'views-main.js', 'views-life.js', 'views-food.js', 'views-settings.js', 'updater.js', 'app.js']) {
    window.eval(fs.readFileSync(path.join(APP, 'js', f), 'utf8'));
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return window;
}

async function waitMain(w) {
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 250));
    const acc = w.document.querySelector('[data-acc]');
    if (acc) { acc.click(); continue; }
    if (w.document.getElementById('main-content')) return true;
  }
  return false;
}

async function main() {
  const w = makeWindow();
  if (!(await waitMain(w))) throw new Error('未能进入主界面');
  w.App.go('settings');
  await new Promise(r => setTimeout(r, 250));
  const root = w.document.getElementById('main-content');

  // 1 预算保存
  root.querySelector('#b-total').value = '3000';
  root.querySelector('#b-digital').value = '1000';
  root.querySelector('#btn-save-budget').click();
  await new Promise(r => setTimeout(r, 200));
  if (settings.budget.monthlyTotal !== 3000 || settings.budget.categories.digital !== 1000) throw new Error('预算保存失败: ' + JSON.stringify(settings.budget));
  console.log('OK  1 月度预算保存');

  // 2 通用（吃灰预警）保存
  root.querySelector('#set-idle').value = '45';
  root.querySelector('#btn-save-settings').click();
  await new Promise(r => setTimeout(r, 200));
  if (settings.idleWarnDays !== 45) throw new Error('吃灰预警保存失败: ' + settings.idleWarnDays);
  console.log('OK  2 通用设置保存');

  // 3 成本模型保存
  const lifeInput = root.querySelector('.cat-table input[data-f=life]');
  lifeInput.value = '6';
  root.querySelector('#btn-save-cats').click();
  await new Promise(r => setTimeout(r, 200));
  if (categories.digital[0].lifeYears !== 6) throw new Error('成本模型保存失败: ' + categories.digital[0].lifeYears);
  console.log('OK  3 成本模型保存');

  // 4 账号重命名
  root.querySelector('[data-rename="b"]').click();
  await new Promise(r => setTimeout(r, 200));
  let modal = w.document.querySelector('.modal');
  if (!modal) throw new Error('重命名弹窗未出现');
  modal.querySelector('#acc-name').value = 'Renamed';
  modal.querySelector('[data-x=s]').click();
  await new Promise(r => setTimeout(r, 250));
  if (accounts.find(a => a.id === 'b').name !== 'Renamed') throw new Error('账号重命名失败');
  console.log('OK  4 账号重命名');

  // 5 账号切换
  root.querySelector('[data-switch="b"]') && root.querySelector('[data-switch="b"]').click();
  await new Promise(r => setTimeout(r, 300));
  const selCalls = calls.filter(c => c.url.includes('/api/account') && c.body && c.body.action === 'select' && c.body.id === 'b');
  if (!selCalls.length) throw new Error('账号切换未调用 select');
  console.log('OK  5 账号切换');

  // 6 导出备份
  root.querySelector('#btn-export').click();
  await new Promise(r => setTimeout(r, 300));
  if (!calls.some(c => c.url.includes('/api/backup'))) throw new Error('导出备份未调用');
  console.log('OK  6 导出备份包');

  // 7 数据路径迁移
  root.querySelector('#new-root').value = 'E:\\newdata';
  root.querySelector('#btn-move-root').click();
  await new Promise(r => setTimeout(r, 150));
  modal = w.document.querySelector('.modal');
  if (modal) { modal.querySelector('[data-act=yes]').click(); await new Promise(r => setTimeout(r, 250)); }
  const moveCall = calls.find(c => c.url.includes('/api/data-root'));
  if (!moveCall || moveCall.body.path !== 'E:\\newdata') throw new Error('数据路径迁移未调用或参数错');
  console.log('OK  7 数据路径迁移');

  // 重新进入设置页（避免此前刷新导致旧 DOM 引用失效）
  w.App.go('settings');
  await new Promise(r => setTimeout(r, 250));
  const root2 = w.document.getElementById('main-content');

  // 8 查看更新日志
  root2.querySelector('#btn-view-log').click();
  await new Promise(r => setTimeout(r, 250));
  modal = w.document.querySelector('.modal');
  if (!modal || modal.textContent.indexOf('更新日志') < 0) throw new Error('更新日志弹窗未出现');
  modal.querySelector('.modal-close').click();
  await new Promise(r => setTimeout(r, 250));
  console.log('OK  8 查看更新日志');

  // 9 检查更新三态（已是最新）
  root2.querySelector('#btn-check-update').click();
  await new Promise(r => setTimeout(r, 350));
  const infoHTML = w.document.getElementById('update-info').innerHTML;
  if (infoHTML.indexOf('已是最新版本') < 0) throw new Error('检查更新结果异常: ' + infoHTML);
  console.log('OK  9 检查更新（已是最新态）');

  // 10 清空数据（走确认弹窗）
  items = [{ id: 'i1', kind: 'clothing', categoryId: 'top', name: 'T', purchaseDate: '2025-01-01', purchasePrice: 100, status: 'in_use' }];
  root2.querySelector('#btn-reset').click();
  await new Promise(r => setTimeout(r, 150));
  modal = w.document.querySelector('.modal');
  if (!modal) throw new Error('清空确认弹窗未出现');
  modal.querySelector('[data-act=yes]').click();
  await new Promise(r => setTimeout(r, 350));
  const saveAfterReset = calls.filter(c => c.url.includes('/api/save') && c.body.target === 'items');
  const last = saveAfterReset[saveAfterReset.length - 1];
  if (!last || last.body.data.length !== 0) throw new Error('清空数据未生效');
  console.log('OK  10 清空当前账号数据');

  console.log('========== 设置页 10 项功能全部可用 ==========');
  process.exit(0);
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
