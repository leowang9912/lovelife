/* calendar-open.test.js — v1.0.4 日历交互：点已有=编辑、多条=先选后编辑、小＋=新增 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const APP = path.join(__dirname, '..', 'app');

const today = new Date();
const y = today.getFullYear();
const m = today.getMonth();
const day = String(today.getDate()).padStart(2, '0');
const dateStr = y + '-' + String(m + 1).padStart(2, '0') + '-' + day;

const outfits = [
  { id: 'o1', date: dateStr, occasion: '通勤', weather: '晴', temperature: 20, note: '第一套', itemIds: ['c1'], cosmeticIds: [], images: [] },
  { id: 'o2', date: dateStr, occasion: '约会', weather: '晴', temperature: 20, note: '第二套', itemIds: ['c2'], cosmeticIds: [], images: [] }
];
const food = [
  { id: 'f1', date: dateStr, meal: '午餐', foodCuisine: '川菜', foodType: '', name: '麻婆豆腐', price: 25, tags: [], rating: 5, location: '', note: '', calories: '', fullness: '', images: [] }
];
const items = [
  { id: 'c1', kind: 'clothing', categoryId: 'top', name: 'T恤', purchaseDate: '2025-01-01', purchasePrice: 100, status: 'in_use', images: [] },
  { id: 'c2', kind: 'clothing', categoryId: 'top', name: '衬衫', purchaseDate: '2025-01-01', purchasePrice: 200, status: 'in_use', images: [] }
];

function makeWindow() {
  const dom = new JSDOM(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), {
    url: 'http://127.0.0.1:8765/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  window.fetch = async (url, opts) => {
    const u = String(url);
    let body = null;
    if (opts && opts.body) { try { body = JSON.parse(opts.body); } catch (e) {} }
    const ok = (b) => ({ ok: true, status: 200, json: async () => b, blob: async () => new Blob([1]), arrayBuffer: async () => new ArrayBuffer(4) });
    if (u.includes('/api/session')) return ok({ ok: true, accounts: [{ id: 'me', name: 'Me', icon: 'x' }], lastAccountId: 'me', dataRoot: 'm', schemaVersion: 3 });
    if (u.includes('/api/ping')) return ok({ ok: true });
    if (u.includes('/api/db')) return ok({
      schemaVersion: 3, account: { id: 'me', name: 'Me', icon: 'x' },
      accounts: [{ id: 'me', name: 'Me', icon: 'x' }],
      items: JSON.parse(JSON.stringify(items)), outfits: JSON.parse(JSON.stringify(outfits)),
      food: JSON.parse(JSON.stringify(food)), events: [],
      settings: { idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} }, planSections: [], rememberAccount: true },
      categories: {
        digital: [], clothing: [], life: [],
        foodCuisine: ['川菜'], foodType: [], meal: ['午餐', '晚餐'], foodTag: [], occasion: ['通勤', '约会'], season: [],
        tagPresets: [], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
      }, dataRoot: 'm'
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
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;

  // ===== 穿搭日历：两条记录 → 点格子弹选择器，点小＋弹新增，选条目进编辑 =====
  w.App.go('outfits');
  await new Promise(r => setTimeout(r, 300));
  let cell = doc.querySelector('.cal-cell[data-date="' + dateStr + '"]');
  if (!cell) throw new Error('找不到当日格子');
  if (!cell.querySelector('.cal-add-mini')) throw new Error('缺少年日期旁小＋按钮');

  cell.click();
  await new Promise(r => setTimeout(r, 250));
  let modal = doc.querySelector('.modal');
  if (!modal) throw new Error('多条记录未弹选择器');
  const rows = modal.querySelectorAll('.pick-rec-row');
  if (rows.length !== 2) throw new Error('选择器条目数错误: ' + rows.length);
  if (modal.textContent.indexOf('新增一条') < 0) throw new Error('选择器缺少新增入口');
  rows[0].click();
  await new Promise(r => setTimeout(r, 300));
  modal = doc.querySelector('.modal');
  if (!modal) throw new Error('点条目未进编辑');
  if (modal.textContent.indexOf('编辑穿搭') < 0) throw new Error('未进入编辑态: ' + modal.textContent.slice(0, 80));
  if (modal.querySelector('#outfit-form [name=note]').value !== '第一套') throw new Error('编辑态未预填备注');
  if (modal.textContent.indexOf('删除') < 0) throw new Error('编辑态缺少删除按钮');
  modal.querySelector('.modal-close').click();
  await new Promise(r => setTimeout(r, 250));
  console.log('OK  1 穿搭日历：多条→选择器→编辑（预填+删除）');

  // 小＋ = 新增
  cell.querySelector('.cal-add-mini').click();
  await new Promise(r => setTimeout(r, 300));
  modal = doc.querySelector('.modal');
  if (!modal || modal.textContent.indexOf('穿搭打卡') < 0) throw new Error('小＋未打开新增态');
  if (modal.querySelector('#outfit-form [name=note]').value !== '') throw new Error('新增态不应预填');
  modal.querySelector('.modal-close').click();
  await new Promise(r => setTimeout(r, 250));
  console.log('OK  2 穿搭日历：小＋ = 新增');

  // ===== 美食日历：单条记录 → 直接进编辑 =====
  w.App.go('food');
  await new Promise(r => setTimeout(r, 300));
  cell = doc.querySelector('.cal-cell[data-date="' + dateStr + '"]');
  if (!cell) throw new Error('美食找不到当日格子');
  cell.click();
  await new Promise(r => setTimeout(r, 300));
  modal = doc.querySelector('.modal');
  if (!modal) throw new Error('单条美食未直开');
  if (modal.textContent.indexOf('编辑饮食') < 0) throw new Error('美食未进编辑态: ' + modal.textContent.slice(0, 60));
  const nameInput = modal.querySelector('#food-form [name=name]');
  if (nameInput.value !== '麻婆豆腐') throw new Error('美食编辑态未预填');
  if (modal.textContent.indexOf('删除') < 0) throw new Error('美食编辑态缺少删除');
  modal.querySelector('.modal-close').click();
  await new Promise(r => setTimeout(r, 250));
  console.log('OK  3 美食日历：单条→直接编辑（预填+删除）');

  // ===== 列表页按钮命名统一 =====
  w.App.go('digital');
  await new Promise(r => setTimeout(r, 250));
  if (doc.getElementById('main-content').innerHTML.indexOf('记数码') < 0) throw new Error('数码页按钮命名未统一');
  w.App.go('clothing');
  await new Promise(r => setTimeout(r, 250));
  if (doc.getElementById('main-content').innerHTML.indexOf('记衣服') < 0) throw new Error('衣橱页按钮命名未统一');
  w.App.go('life');
  await new Promise(r => setTimeout(r, 250));
  if (doc.getElementById('main-content').innerHTML.indexOf('记美妆') < 0) throw new Error('生活页按钮命名未统一');
  console.log('OK  4 列表页按钮命名统一（记数码/记衣服/记美妆）');

  console.log('========== calendar-open 全部通过 ==========');
  process.exit(0);
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
