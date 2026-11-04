/* v107-features.test.js — v1.0.7 新功能回归：自定义标签 / 组合温季 / picker 出图 / KPI 驾驶舱 / 环图图例 / 标签筛选 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const APP = path.join(__dirname, '..', 'app');

const calls = [];
let settings = {
  idleWarnDays: 60, budget: { monthlyTotal: 1000, categories: {} },
  planSections: [
    { id: 'kpi', enabled: true, fixed: true },
    { id: 'composition', enabled: true, fixed: true, size: 'm' }
  ],
  rememberAccount: true,
  makeupLooks: [], outfitLooks: [], customTags: ['心头好']
};
const items = [
  { id: 'c1', kind: 'clothing', categoryId: 'top', name: 'T恤', purchaseDate: '2025-01-01', purchasePrice: 100, status: 'in_use', images: [], tags: ['贵重'] },
  { id: 'c2', kind: 'clothing', categoryId: 'top', name: '西裤', purchaseDate: '2025-01-01', purchasePrice: 200, status: 'in_use', images: ['p2.jpg'], tags: [] }
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
      settings: JSON.parse(JSON.stringify(settings)), categories: {
        digital: [], clothing: [{ id: 'top', name: '上装' }], life: [{ id: 'skin', name: '护肤' }],
        foodCuisine: [], foodType: [], meal: [], foodTag: [], occasion: [], season: [],
        tagPresets: ['贵重', '待清洗', '断舍离候选'], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const w = makeWindow();
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;

  // 1 标签：预设 3 个 + 自定义输入生成 chip + 保存入库
  w.App.go('clothing');
  await sleep(300);
  doc.getElementById('btn-add-item').click();
  await sleep(300);
  let modal = doc.querySelector('.modal');
  if (!modal) throw new Error('记衣服弹窗未出现');
  const allChips = Array.from(modal.querySelectorAll('#tag-chips input[name=tags]'));
  const presetVals = ['贵重', '待清洗', '断舍离候选'];
  const presetCount = allChips.filter(x => presetVals.indexOf(x.value) >= 0).length;
  if (presetCount !== 3) throw new Error('预设标签应为 3 个，实为 ' + presetCount);
  if (!allChips.some(x => x.value === '心头好')) throw new Error('个人标签库标签应出现在候选里');
  const tagNew = modal.querySelector('#tag-new');
  if (!tagNew) throw new Error('缺自定义标签输入框');
  tagNew.value = '旅行必备';
  tagNew.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(50);
  const fresh = Array.from(modal.querySelectorAll('#tag-chips input[name=tags]'))
    .find(x => x.value === '旅行必备');
  if (!fresh || !fresh.checked) throw new Error('自定义标签未生成为选中 chip');
  const form = modal.querySelector('#item-form');
  const data = w.UI.readItemForm(form, { id: '', images: [] }, 'clothing');
  if (data.tags.indexOf('旅行必备') < 0) throw new Error('自定义标签未进 item.tags');
  await sleep(150);
  const saveCalls = calls.filter(c => c.url.includes('/api/save') && c.body && c.body.target === 'settings');
  const lastSave = saveCalls[saveCalls.length - 1];
  const lib = (lastSave && lastSave.body.data.settings.customTags) || [];
  if (lib.indexOf('旅行必备') < 0) throw new Error('自定义标签未持久化到标签库: ' + JSON.stringify(lib));
  // × 删除标签：候选移除 + 从标签库删掉；预设标签不带删除按钮
  const presetDel = Array.from(modal.querySelectorAll('.chip-del'))
    .some(b => presetVals.indexOf(b.getAttribute('data-del-tag')) >= 0);
  if (presetDel) throw new Error('预设标签不应有删除按钮');
  const delBtn = Array.from(modal.querySelectorAll('.chip-del'))
    .find(b => b.getAttribute('data-del-tag') === '旅行必备');
  if (!delBtn) throw new Error('自定义标签缺删除按钮');
  delBtn.click();
  await sleep(150);
  const stillThere = Array.from(modal.querySelectorAll('#tag-chips input[name=tags]'))
    .some(x => x.value === '旅行必备');
  if (stillThere) throw new Error('删除后标签仍在候选');
  await sleep(150);
  // v1.0.9 语义修正：× 只从本物品移除，标签库不受影响（库管理在设置页）
  const lib2 = w.Storage.getDB().settings.customTags || [];
  if (lib2.indexOf('旅行必备') < 0) throw new Error('× 不应动标签库，但标签库丢失了: ' + JSON.stringify(lib2));
  modal.querySelector('[data-act=cancel]').click();
  await sleep(200);
  console.log('OK  1 标签：预设 3 个 + 自定义添加/×删除 + 标签库自主管理');

  // 2 picker 组件异步出图（组合编辑/打卡共用）
  const box = doc.createElement('div');
  doc.body.appendChild(box);
  w.UI.picker(box, [{ id: 'x1', name: '测试衣', images: ['p1.jpg'] }], [], {});
  await sleep(150);
  const pimg = box.querySelector('.pick-card img');
  if (!pimg) throw new Error('picker 未显示物品照片');
  if (pimg.getAttribute('src').indexOf('/api/images/') < 0) throw new Error('picker 图片地址不对: ' + pimg.getAttribute('src'));
  console.log('OK  2 picker：物品照片自动解析显示（组合编辑不再无图）');

  // 3 组合温度/季节 + 编辑器内物品照片（回归：调用方映射必须带 images）
  doc.getElementById('btn-outfit-looks').click();
  await sleep(300);
  modal = doc.querySelector('.modal');
  if (!modal) throw new Error('穿搭组合弹窗未出现');
  if (modal.textContent.indexOf('穿搭组合') < 0) throw new Error('打开的不是穿搭组合弹窗');
  modal.querySelector('[data-x=n]').click();
  await sleep(300);
  modal = doc.querySelector('.modal');
  if (!modal || !modal.querySelector('#combo-name')) throw new Error('未进入组合编辑弹窗');
  const comboImgs = modal.querySelectorAll('.pick-card img');
  if (!comboImgs.length) throw new Error('组合编辑器未显示物品照片（images 映射丢失）');
  if (comboImgs[0].getAttribute('src').indexOf('/api/images/') < 0) throw new Error('组合编辑器照片地址不对');
  const ctemps = modal.querySelectorAll('input[name=ctemp]');
  const cseasons = modal.querySelectorAll('input[name=cseason]');
  if (ctemps.length !== 9) throw new Error('温度档位应 9 个，实为 ' + ctemps.length);
  if (cseasons.length !== 4) throw new Error('季节应 4 个，实为 ' + cseasons.length);
  modal.querySelector('#combo-name').value = '夏日通勤';
  Array.from(cseasons).find(x => x.value === '夏').checked = true;
  Array.from(ctemps).find(x => x.value === '25~30℃').checked = true;
  const card = modal.querySelector('.pick-card');
  if (card) card.click();
  await sleep(100);
  modal.querySelector('[data-x=s]').click();
  await sleep(400);
  const look = w.Storage.getDB().settings.outfitLooks[0];
  if (!look) throw new Error('组合未保存');
  if ((look.seasons || []).indexOf('夏') < 0) throw new Error('季节未保存: ' + JSON.stringify(look));
  if ((look.tempRanges || []).indexOf('25~30℃') < 0) throw new Error('温度未保存');
  const badges = w.UI.comboBadges(look);
  if (badges.indexOf('夏') < 0 || badges.indexOf('30') < 0) throw new Error('组合徽标未输出');
  console.log('OK  3 组合：编辑器出图 + 温度/季节可设可存可展示');

  // 4 KPI 资产驾驶舱 + 固定栏目大小调节
  const modalClose = doc.querySelector('.modal [data-x=c]');
  if (modalClose) modalClose.click();
  await sleep(200);
  w.App.go('plan');
  await sleep(400);
  const planText = doc.getElementById('main-content').textContent;
  ['分域速览', '本月 vs 上月', '总投入', '在手估值', '本月花费', '预算剩余'].forEach(function (k) {
    if (planText.indexOf(k) < 0) throw new Error('KPI 驾驶舱缺 ' + k);
  });
  const kpiPanel = doc.querySelector('.plan-sec[data-id=kpi]');
  if (!kpiPanel) throw new Error('缺 KPI 栏目');
  doc.getElementById('btn-edit-sections').click();
  await sleep(300);
  const kpiEdit = doc.querySelector('.plan-sec[data-id=kpi]');
  const sizeBtns = kpiEdit.querySelectorAll('.sec-size-btn');
  if (sizeBtns.length !== 3) throw new Error('KPI 栏目缺大小调节按钮（' + sizeBtns.length + '/3）');
  const compPanel = doc.querySelector('.plan-sec[data-id=composition]');
  if (!compPanel || compPanel.querySelectorAll('.sec-size-btn').length !== 3) {
    throw new Error('投入构成栏目缺大小调节按钮');
  }
  kpiEdit.querySelector('[data-size-val=s]').click();
  await sleep(300);
  const kpi2 = doc.querySelector('.plan-sec[data-id=kpi]');
  if (kpi2.getAttribute('data-size') !== 's') throw new Error('大小调节未生效');
  console.log('OK  4 KPI 驾驶舱四区齐全 + KPI/投入构成可调大小');

  // 5 环图常驻图例（色点+名称+数值+占比）
  const html = w.Charts.donut([
    { label: '数码', value: 1, valueText: '¥1' },
    { label: '衣服', value: 3 }
  ]);
  if (html.indexOf('donut-legend') < 0) throw new Error('环图缺图例');
  ['数码', '衣服', '¥1', '25%', '75%'].forEach(function (k) {
    if (html.indexOf(k) < 0) throw new Error('图例缺 ' + k);
  });
  console.log('OK  5 环图：常驻图例（名称+数值+占比）');

  // 6 标签筛选（我的衣橱）
  doc.getElementById('btn-edit-sections').click(); // 退出编辑模式
  await sleep(200);
  w.App.go('clothing');
  await sleep(300);
  const tagSel = doc.getElementById('filter-tag');
  if (!tagSel) throw new Error('列表页缺标签筛选');
  const optVals = Array.from(tagSel.options).map(o => o.value);
  if (optVals.indexOf('贵重') < 0) throw new Error('标签筛选候选缺用过的标签: ' + optVals.join(','));
  tagSel.value = '贵重';
  tagSel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(300);
  const cards = doc.querySelectorAll('.item-card');
  if (cards.length !== 1) throw new Error('标签筛选结果应 1 件，实为 ' + cards.length);
  if (cards[0].textContent.indexOf('T恤') < 0) throw new Error('标签筛选选错物品');
  console.log('OK  6 标签筛选：候选来自实际使用，过滤正确');

  console.log('========== v1.0.7 新功能全部通过 ==========');
}

main().catch(function (e) {
  console.error('FAIL', e && e.stack || e);
  process.exit(1);
});
