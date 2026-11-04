/* combo-detail.test.js — v1.0.4 穿搭/妆容组合（范例图+编辑）与详情页统一 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const APP = path.join(__dirname, '..', 'app');

const calls = [];
let settings = {
  idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} }, planSections: [], rememberAccount: true,
  makeupLooks: [{ id: 'lk1', name: '通勤妆', itemIds: ['l1'], images: [] }],
  outfitLooks: []
};
const items = [
  { id: 'c1', kind: 'clothing', categoryId: 'top', name: 'T恤', purchaseDate: '2025-01-01', purchasePrice: 100, status: 'in_use', images: [] },
  { id: 'c2', kind: 'clothing', categoryId: 'top', name: '西裤', purchaseDate: '2025-01-01', purchasePrice: 200, status: 'in_use', images: [] },
  { id: 'l1', kind: 'life', categoryId: 'skin', name: '口红', purchaseDate: '2025-01-01', purchasePrice: 80, status: 'in_use', images: [] }
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
    calls.push({ url: u, body });
    const ok = (b) => ({ ok: true, status: 200, json: async () => b, blob: async () => new Blob([1]), arrayBuffer: async () => new ArrayBuffer(4) });
    if (u.includes('/api/session')) return ok({ ok: true, accounts: [{ id: 'me', name: 'Me', icon: 'x' }], lastAccountId: 'me', dataRoot: 'm', schemaVersion: 3 });
    if (u.includes('/api/ping')) return ok({ ok: true });
    if (u.includes('/api/save') && body && body.target === 'settings') { settings = body.data.settings; return ok({ ok: true }); }
    if (u.includes('/api/db')) return ok({
      schemaVersion: 3, account: { id: 'me', name: 'Me', icon: 'x' },
      accounts: [{ id: 'me', name: 'Me', icon: 'x' }],
      items: JSON.parse(JSON.stringify(items)), outfits: [], food: [], events: [],
      settings, categories: {
        digital: [], clothing: [{ id: 'top', name: '上装' }], life: [{ id: 'skin', name: '护肤' }],
        foodCuisine: [], foodType: [], meal: [], foodTag: [], occasion: [], season: [],
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

  // 1 衣橱页有穿搭组合入口；两级弹窗：列表页 → 新建进编辑器（范例图+选择器）
  w.App.go('clothing');
  await new Promise(r => setTimeout(r, 300));
  const btn = doc.getElementById('btn-outfit-looks');
  if (!btn) throw new Error('衣橱页缺穿搭组合入口');
  btn.click();
  await new Promise(r => setTimeout(r, 300));
  let modal = doc.querySelector('.modal');
  if (!modal) throw new Error('穿搭组合弹窗未出现');
  if (modal.textContent.indexOf('穿搭组合') < 0) throw new Error('弹窗标题错');
  const newBtn = modal.querySelector('[data-x=n]');
  if (!newBtn) throw new Error('列表弹窗缺新建按钮');
  newBtn.click();
  await new Promise(r => setTimeout(r, 300));
  modal = doc.querySelector('.modal');
  if (!modal || modal.textContent.indexOf('范例图') < 0) throw new Error('编辑弹窗缺范例图上传区');
  if (!modal.querySelector('#combo-name') || !modal.querySelector('#combo-picker')) throw new Error('缺名称/选择器');
  console.log('OK  1 穿搭组合两级弹窗：列表 → 新建编辑器（范例图+选择器）');

  // 2 新建组合：名称 + 勾选两件衣服 + 保存 → 回列表并持久化
  modal.querySelector('#combo-name').value = '夏日通勤';
  modal.querySelectorAll('.pick-card').forEach(c => c.click());
  modal.querySelector('[data-x=s]').click();
  await new Promise(r => setTimeout(r, 400));
  if (!settings.outfitLooks || settings.outfitLooks.length !== 1) throw new Error('组合未持久化: ' + JSON.stringify(settings.outfitLooks));
  const combo = settings.outfitLooks[0];
  if (combo.name !== '夏日通勤' || combo.itemIds.length !== 2) throw new Error('组合内容错: ' + JSON.stringify(combo));
  if (!('images' in combo)) throw new Error('组合缺 images 字段');
  modal = doc.querySelector('.modal');
  if (!modal || modal.textContent.indexOf('夏日通勤') < 0) throw new Error('保存后未回列表显示新组合');
  console.log('OK  2 新建穿搭组合持久化（含 images 字段）');

  // 3 编辑组合：列表点「编辑」进编辑器，改名保存
  modal.querySelector('[data-edit-combo]').click();
  await new Promise(r => setTimeout(r, 300));
  modal = doc.querySelector('.modal');
  const nameEl = modal.querySelector('#combo-name');
  if (!nameEl || nameEl.value !== '夏日通勤') throw new Error('编辑态未预填');
  if (modal.textContent.indexOf('编辑组合') < 0) throw new Error('未进入编辑态');
  nameEl.value = '通勤改';
  modal.querySelector('[data-x=s]').click();
  await new Promise(r => setTimeout(r, 400));
  if (settings.outfitLooks[0].name !== '通勤改') throw new Error('编辑未保存');
  if (settings.outfitLooks[0].itemIds.length !== 2) throw new Error('编辑后成员丢失');
  modal = doc.querySelector('.modal');
  const closeBtn = modal.querySelector('[data-x=c]');
  if (closeBtn) closeBtn.click();
  await new Promise(r => setTimeout(r, 250));
  console.log('OK  3 编辑组合（预填 + 保存保留成员）');

  // 4 妆容组合入口仍可用且带范例图区（改用通用管理器后兼容旧数据）
  w.App.go('life');
  await new Promise(r => setTimeout(r, 300));
  doc.getElementById('btn-looks').click();
  await new Promise(r => setTimeout(r, 300));
  modal = doc.querySelector('.modal');
  if (!modal || modal.textContent.indexOf('通勤妆') < 0) throw new Error('旧妆容组合数据未显示');
  modal.querySelector('[data-edit-combo]').click();
  await new Promise(r => setTimeout(r, 300));
  modal = doc.querySelector('.modal');
  if (!modal || modal.textContent.indexOf('范例图') < 0) throw new Error('妆容组合缺范例图区');
  modal.querySelector('.modal-close').click();
  await new Promise(r => setTimeout(r, 250));
  // v1.0.9 交互：编辑器 × 会回到组合列表，需再关一次列表
  const listModal = doc.querySelector('.modal');
  if (listModal && listModal.querySelector('[data-x=c]')) listModal.querySelector('[data-x=c]').click();
  await new Promise(r => setTimeout(r, 250));
  console.log('OK  4 妆容组合兼容旧数据 + 范例图区');

  // 5 穿搭打卡弹窗：组合图文卡片（有图显图）+ 一键套用
  w.Storage.getDB().settings.outfitLooks[0].images = ['combo.jpg'];
  w.App.go('outfits');
  await new Promise(r => setTimeout(r, 300));
  doc.getElementById('btn-add-outfit').click();
  await new Promise(r => setTimeout(r, 350));
  modal = doc.querySelector('.modal');
  if (!modal) throw new Error('穿搭打卡弹窗未出现');
  const olookBtn = modal.querySelector('.look-card[data-olook]');
  if (!olookBtn) throw new Error('打卡弹窗缺组合图文卡片');
  const lookImg = olookBtn.querySelector('img[data-path="combo.jpg"]');
  if (!lookImg) throw new Error('组合卡片未显示范例图');
  olookBtn.click();
  await new Promise(r => setTimeout(r, 150));
  const checked = modal.querySelectorAll('.pick-card.on').length;
  if (checked !== 2) throw new Error('套用组合未勾选衣服, on=' + checked);
  if (!olookBtn.classList.contains('on')) throw new Error('套用后组合卡片无选中反馈');
  modal.querySelector('.modal-close').click();
  await new Promise(r => setTimeout(r, 250));
  console.log('OK  5 穿搭打卡：组合图文卡片 + 一键套用');

  // 6 详情页统一：字重一致 + 按钮统一排布
  w.App.go('clothing');
  await new Promise(r => setTimeout(r, 300));
  doc.querySelector('.item-card') && doc.querySelector('.item-card').click();
  await new Promise(r => setTimeout(r, 300));
  modal = doc.querySelector('.modal');
  if (!modal) throw new Error('详情弹窗未出现');
  // kv 值统一 strong
  const kvRows = modal.querySelectorAll('.detail-kv .kv-row');
  let kvBad = 0;
  kvRows.forEach(r => { if (!r.querySelector('strong')) kvBad++; });
  if (kvBad) throw new Error('详情值字重不统一 x' + kvBad);
  // 按钮统一：详情区按钮均为 .btn 且同高（detail-btn-row/detail-actions 容器）
  const btnRow = modal.querySelector('.detail-btn-row');
  const actions = modal.querySelector('.detail-actions');
  if (!btnRow || !actions) throw new Error('按钮排布容器缺失');
  if (!btnRow.querySelector('#btn-wear-plus')) throw new Error('左列按钮未入行');
  console.log('OK  6 详情页字重统一 + 按钮统一排布');

  console.log('========== combo-detail 全部通过 ==========');
  process.exit(0);
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
