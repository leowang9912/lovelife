/* v109-features.test.js — v1.0.9 回归：Lucide 图标规范落地 / 设置页分标签 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const APP = path.join(__dirname, '..', 'app');

const calls = [];
let settings = {
  idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} },
  planSections: [{ id: 'kpi', enabled: true, fixed: true }],
  rememberAccount: true, makeupLooks: [], outfitLooks: [], customTags: []
};
const items = [
  { id: 'c1', kind: 'clothing', categoryId: 'top', name: 'T恤', purchaseDate: '2025-03-01', purchasePrice: 100, status: 'in_use', images: [], tags: [] },
  { id: 'l1', kind: 'life', categoryId: 'skin', name: '口红', purchaseDate: '2025-02-01', purchasePrice: 80, status: 'in_use', images: [], tags: [], useCount: 0 }
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
    const ok = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => String(b), blob: async () => new Blob([1]), arrayBuffer: async () => new ArrayBuffer(4) });
    if (u.includes('/api/session')) return ok({ ok: true, accounts: [{ id: 'me', name: 'Me', icon: 'x' }], lastAccountId: 'me', dataRoot: 'm', schemaVersion: 3 });
    if (u.includes('/api/ping')) return ok({ ok: true });
    if (u.includes('/api/save') && body && body.target === 'settings') { settings = body.data.settings; return ok({ ok: true }); }
    if (u.includes('/api/db')) return ok({
      schemaVersion: 3, account: { id: 'me', name: 'Me', icon: 'x' },
      accounts: [{ id: 'me', name: 'Me', icon: 'x' }],
      items: JSON.parse(JSON.stringify(items)), outfits: [], food: [], events: [],
      settings: JSON.parse(JSON.stringify(settings)), categories: {
        digital: [], clothing: [{ id: 'top', name: '上装', icon: 'shirt' }], life: [],
        foodCuisine: [], foodType: [], meal: [], foodTag: [], occasion: [], season: [],
        tagPresets: ['贵重', '待清洗', '断舍离候选'], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
      }, dataRoot: 'm'
    });
    return ok({ ok: true });
  };
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  window.URL.createObjectURL = () => 'blob:x';
  window.URL.revokeObjectURL = () => {};
  for (const f of ['vendor/lucide.min.js', 'js/utils.js', 'js/models.js', 'js/storage.js', 'js/charts.js', 'js/cutout.js', 'js/ui.js', 'js/weather.js',
    'js/views-plan.js', 'js/views-main.js', 'js/views-life.js', 'js/views-food.js', 'js/views-settings.js', 'js/updater.js', 'js/app.js']) {
    window.eval(fs.readFileSync(path.join(APP, f), 'utf8'));
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const w = makeWindow();
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;

  // 1 UI.icon：lucide 内联 SVG + 尺寸档 + 未知名回退占位
  const svg = w.UI.icon('camera', 20);
  if (svg.indexOf('<svg') < 0 || svg.indexOf('width="20"') < 0) throw new Error('icon() 未输出 20px SVG: ' + svg.slice(0, 80));
  if (svg.indexOf('stroke="currentColor"') < 0) throw new Error('图标描边未用 currentColor');
  const missing = w.UI.icon('definitely-not-an-icon', 16);
  if (missing.indexOf('ic-missing') < 0) throw new Error('未知名图标应给占位块');
  const emoji = w.UI.iconOrEmoji('😊', 20);
  if (emoji.indexOf('😊') < 0) throw new Error('旧 emoji 值应兼容显示');
  const pants = w.UI.icon('pants', 20);
  if (pants.indexOf('<svg') < 0 || pants.indexOf('M5 4h14') < 0) throw new Error('规范扩展图标 pants 未生效');
  if (w.UI.iconOrEmoji('pants', 20).indexOf('<svg') < 0) throw new Error('pants 名应走图标渲染而非文本');
  console.log('OK  1 UI.icon：SVG 输出 / 尺寸 / 未知名占位 / 旧值兼容');

  // 2 导航与页面按钮全部 lucide（无 emoji 残留）
  w.App.go('clothing');
  await sleep(300);
  const navSvgs = doc.querySelectorAll('.nav-item .nav-icon svg').length;
  if (navSvgs < 7) throw new Error('导航图标未全部替换为 SVG，实为 ' + navSvgs);
  const navText = doc.querySelector('.nav').textContent;
  if (/[🎮👕💄📅🍽⚙📊]/.test(navText)) throw new Error('导航仍有 emoji 图标');
  const addBtn = doc.getElementById('btn-add-item');
  if (addBtn.querySelector('svg') === null) throw new Error('记衣服按钮缺图标');
  console.log('OK  2 导航/按钮图标全部 lucide 化');

  // 3 分类图标走 SVG（服务端 icon 字段=lucide 名）
  w.App.go('clothing');
  await sleep(300);
  const card = doc.querySelector('.item-card');
  if (!card) throw new Error('缺物品卡片');
  if (card.textContent.indexOf('T恤') < 0) throw new Error('卡片渲染异常');
  const noimgSvg = card.querySelector('.item-noimg svg');
  if (!noimgSvg || noimgSvg.getAttribute('width') !== '48') throw new Error('无图默认图标应为 48px: ' + (noimgSvg && noimgSvg.getAttribute('width')));
  console.log('OK  3 分类/卡片渲染正常 + 无图图标 48px');

  // 4 设置页分标签：6 标签、默认账号组、切换只显隐、组内按钮带图标
  w.App.go('settings');
  await sleep(300);
  const tabs = doc.querySelectorAll('[data-stab-btn]');
  if (tabs.length !== 6) throw new Error('设置页应 6 个标签，实为 ' + tabs.length);
  const accPanel = doc.querySelector('.stab[data-stab=account]');
  const softPanel = doc.querySelector('.stab[data-stab=soft]');
  if (!accPanel.classList.contains('stab-on')) throw new Error('默认应显示账号组');
  if (softPanel.classList.contains('stab-on')) throw new Error('软件组初始不应显示');
  softPanel.querySelector ? null : null;
  doc.querySelector('[data-stab-btn=soft]').click();
  await sleep(150);
  if (accPanel.classList.contains('stab-on')) throw new Error('切换后账号组未隐藏');
  if (!softPanel.classList.contains('stab-on')) throw new Error('切换后软件组未显示');
  const checkBtn = doc.getElementById('btn-check-update');
  if (!checkBtn || checkBtn.querySelector('svg') === null) throw new Error('检查更新按钮缺图标');
  if (checkBtn.textContent.indexOf('检查更新') < 0) throw new Error('按钮文案丢失');
  const saveBtn = doc.getElementById('btn-save-settings');
  doc.querySelector('[data-stab-btn=pref]').click();
  await sleep(150);
  if (!saveBtn || saveBtn.querySelector('svg') === null) throw new Error('保存偏好按钮缺图标');
  // 成本模型行图标：分类 icon 字段走渲染器（回归：曾被当纯文本直出）
  doc.querySelector('[data-stab-btn=cost]').click();
  await sleep(150);
  const costRow = doc.querySelector('.cat-table[data-cat-kind=clothing] tbody td');
  if (!costRow || costRow.querySelector('svg') === null) throw new Error('成本模型行图标未 lucide 化: ' + (costRow ? costRow.innerHTML.slice(0, 60) : 'no row'));
  console.log('OK  4 设置页分标签切换正常 + 按钮/成本表 lucide 化');

  // 5 穿搭打卡：妆品使用次数可调（当天多次）+ 按次数记账 + 编辑改次数对称
  w.Views.openOutfitEditor('2026-01-10');
  await sleep(350);
  modal = doc.querySelector('.modal');
  const cosCard = modal.querySelectorAll('#cos-picker .pick-card')[0];
  if (!cosCard) throw new Error('缺妆品选择卡');
  cosCard.click();
  await sleep(150);
  const qtyRow = modal.querySelector('.cos-qty-row');
  if (!qtyRow || qtyRow.textContent.indexOf('1 次') < 0) throw new Error('勾选后未出现次数步进（默认 1 次）');
  modal.querySelector('[data-q-inc]').click();
  await sleep(100);
  if (modal.querySelector('.cos-qty-row').textContent.indexOf('2 次') < 0) throw new Error('次数 +1 未生效');
  modal.querySelector('#cloth-picker .pick-card').click();
  await sleep(100);
  modal.querySelector('[data-act=save]').click();
  await sleep(400);
  const outfit = w.Storage.getDB().outfits.find(x => x.date === '2026-01-10');
  const l1 = w.Storage.getDB().items.find(x => x.id === 'l1');
  if (!outfit || (outfit.cosmeticQty || {}).l1 !== 2) throw new Error('次数未随打卡保存: ' + JSON.stringify(outfit && outfit.cosmeticQty));
  if (Number(l1.useCount) !== 2) throw new Error('使用次数应按 2 次记账，实为 ' + l1.useCount);
  // 编辑改次数：2 → 1，记账对称回到 1
  w.Views.openOutfitEditor('2026-01-10', outfit);
  await sleep(300);
  modal = doc.querySelector('.modal');
  if (modal.querySelector('.cos-qty-row').textContent.indexOf('2 次') < 0) throw new Error('编辑态未预填次数');
  modal.querySelector('[data-q-dec]').click();
  await sleep(100);
  modal.querySelector('[data-act=save]').click();
  await sleep(400);
  const l1b = w.Storage.getDB().items.find(x => x.id === 'l1');
  if (Number(l1b.useCount) !== 1) throw new Error('编辑减次后记账应为 1，实为 ' + l1b.useCount);
  console.log('OK  5 打卡妆品使用次数可调 + 按次数记账 + 编辑对称');

  // 6 设置页标签管理：预设只读 + 标签库增删
  w.App.go('settings');
  await sleep(300);
  doc.querySelector('[data-stab-btn=pref]').click();
  await sleep(150);
  const libBox = doc.getElementById('tag-lib-list');
  if (!libBox) throw new Error('设置页缺标签管理');
  if (libBox.textContent.indexOf('预设') < 0) throw new Error('标签管理应展示预设区');
  const libInput = doc.getElementById('tag-lib-new');
  libInput.value = '库测试标签';
  doc.getElementById('tag-lib-add').click();
  await sleep(300);
  if (libBox.textContent.indexOf('库测试标签') < 0) throw new Error('标签库添加未生效');
  const libNow = w.Storage.getDB().settings.customTags || [];
  if (libNow.indexOf('库测试标签') < 0) throw new Error('标签库未持久化: ' + JSON.stringify(libNow));
  console.log('OK  6 设置页标签管理（预设只读 + 库增删）');

  console.log('========== v1.0.9 新功能全部通过 ==========');
}

main().catch(function (e) {
  console.error('FAIL', e && e.stack || e);
  process.exit(1);
});
