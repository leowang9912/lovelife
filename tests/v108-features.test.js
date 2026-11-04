/* v108-features.test.js — v1.0.8 新功能回归：列表排序 / 温度自定义 / 天气区间推荐（数据刷新时间可信） / 侧栏拖拽 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const APP = path.join(__dirname, '..', 'app');

function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const NOW = new Date();
const TODAY = fmt(NOW);
const TOMORROW = fmt(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1));

const calls = [];
let failWx = false;
let settings = {
  idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} },
  planSections: [
    { id: 'kpi', enabled: true, fixed: true },
    { id: 'composition', enabled: true, fixed: true, size: 'm' }
  ],
  rememberAccount: true,
  makeupLooks: [],
  outfitLooks: [{ id: 'lk1', name: '秋日通勤', itemIds: ['c1'], images: [], tempRanges: ['20~25℃'], seasons: ['秋'] }],
  customTags: []
};
const items = [
  { id: 'c1', kind: 'clothing', categoryId: 'top', name: 'T恤', purchaseDate: '2025-03-01', purchasePrice: 100, status: 'in_use', images: [], tags: [], wearCount: 3 },
  { id: 'c2', kind: 'clothing', categoryId: 'top', name: '西裤', purchaseDate: '2025-01-01', purchasePrice: 200, status: 'in_use', images: [], tags: [], wearCount: 0 },
  { id: 'l1', kind: 'life', categoryId: 'skin', name: '口红', purchaseDate: '2025-02-01', purchasePrice: 80, status: 'in_use', images: [], tags: [], remainLevel: '¼' },
  { id: 'l2', kind: 'life', categoryId: 'skin', name: '面霜', purchaseDate: '2025-01-01', purchasePrice: 150, status: 'in_use', images: [], tags: [], remainLevel: '满' }
];
const outfits = [
  { id: 'o1', date: '2026-10-20', tempMin: 20, tempMax: 24, occasion: '通勤', itemIds: ['c1'], cosmeticIds: [], images: [], note: '' },
  { id: 'o2', date: '2026-09-15', temperature: 21, occasion: '旧记录', itemIds: ['c2'], cosmeticIds: [], images: [], note: '' }
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
    const ok = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => (typeof b === 'string' ? b : JSON.stringify(b)), blob: async () => new Blob([1]), arrayBuffer: async () => new ArrayBuffer(4) });
    if (u.includes('api.open-meteo.com')) {
      if (failWx) return { ok: false, status: 500, json: async () => ({ error: true }) };
      return ok({
        daily: {
          time: [TODAY, TOMORROW],
          temperature_2m_min: [18, 12],
          temperature_2m_max: [25, 17],
          weather_code: [1, 2]
        }
      });
    }
    if (u.includes('/api/session')) return ok({ ok: true, accounts: [{ id: 'me', name: 'Me', icon: 'x' }], lastAccountId: 'me', dataRoot: 'm', schemaVersion: 3 });
    if (u.includes('/api/ping')) return ok({ ok: true });
    if (u.includes('/api/save') && body && body.target === 'settings') { settings = body.data.settings; return ok({ ok: true }); }
    if (u.includes('/api/db')) return ok({
      schemaVersion: 3, account: { id: 'me', name: 'Me', icon: 'x' },
      accounts: [{ id: 'me', name: 'Me', icon: 'x' }],
      items: JSON.parse(JSON.stringify(items)), outfits: JSON.parse(JSON.stringify(outfits)), food: [], events: [],
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
  for (const f of ['utils.js', 'models.js', 'storage.js', 'charts.js', 'cutout.js', 'ui.js', 'weather.js',
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
function firstCardName(doc) {
  const c = doc.querySelector('.item-card .item-name');
  return c ? c.textContent.trim() : '';
}
function firstCardInfo(doc) {
  const c = doc.querySelector('.item-card .item-cost');
  return c ? c.textContent.trim() : '';
}
function wxCalls() {
  return calls.filter(c => c.url.includes('api.open-meteo.com')).length;
}
function dataStamp(doc) {
  const t = doc.getElementById('weather-card').textContent;
  const m = t.match(/数据刷新：([^手尚]+?)(?:手动|自动|$)/);
  return m ? m[1].trim() : '';
}

async function main() {
  const w = makeWindow();
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;

  // 1 列表排序：字段 + 方向双向（默认时间新→旧；价格高→低/低→高；时间旧→新）
  w.App.go('clothing');
  await sleep(300);
  const sortSel = doc.getElementById('filter-sort');
  const dirBtn = doc.getElementById('sort-dir');
  if (!sortSel || !dirBtn) throw new Error('衣橱缺排序控件');
  if (firstCardName(doc) !== 'T恤') throw new Error('默认排序应时间新→旧（T恤），实为 ' + firstCardName(doc));
  if (firstCardInfo(doc).indexOf('购于 2025-03-01') < 0) throw new Error('按时间排序时卡片应显示购买时间: ' + firstCardInfo(doc));
  sortSel.value = 'price';
  sortSel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(250);
  if (firstCardName(doc) !== '西裤') throw new Error('价格高→低排序错，实为 ' + firstCardName(doc));
  if (firstCardInfo(doc).indexOf('200') < 0) throw new Error('按价格排序时卡片应显示价格: ' + firstCardInfo(doc));
  doc.getElementById('sort-dir').click();
  await sleep(250);
  if (firstCardName(doc) !== 'T恤') throw new Error('价格低→高排序错，实为 ' + firstCardName(doc));
  if (firstCardInfo(doc).indexOf('100') < 0) throw new Error('价格低→高时卡片应显示价格: ' + firstCardInfo(doc));
  const sortSel2 = doc.getElementById('filter-sort');
  sortSel2.value = 'date';
  sortSel2.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(250);
  if (firstCardName(doc) !== 'T恤') throw new Error('时间新→旧排序错，实为 ' + firstCardName(doc));
  doc.getElementById('sort-dir').click();
  await sleep(250);
  if (firstCardName(doc) !== '西裤') throw new Error('时间旧→新排序错，实为 ' + firstCardName(doc));
  console.log('OK  1 列表排序：时间/价格 大小新旧双向可调');

  // 2 生活页专属排序（剩余量少→多 / 多→少）
  w.App.go('life');
  await sleep(300);
  const lifeSort = doc.getElementById('life-sort');
  if (!lifeSort) throw new Error('生活页缺排序下拉');
  if (!Array.from(lifeSort.options).some(o => o.value === 'remain')) throw new Error('生活页缺剩余量排序');
  lifeSort.value = 'remain';
  lifeSort.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(250);
  if (firstCardName(doc) !== '口红') throw new Error('剩余量少→多排序错，实为 ' + firstCardName(doc));
  if (firstCardInfo(doc).indexOf('剩余') < 0) throw new Error('按剩余量排序时卡片应显示剩余量: ' + firstCardInfo(doc));
  doc.getElementById('life-sort-dir').click();
  await sleep(250);
  if (firstCardName(doc) !== '面霜') throw new Error('剩余量多→少排序错，实为 ' + firstCardName(doc));
  console.log('OK  2 生活页专属排序：剩余量双向可调');

  // 3 温度细化 + 自定义区间
  w.App.go('clothing');
  await sleep(300);
  doc.getElementById('btn-outfit-looks').click();
  await sleep(300);
  let modal = doc.querySelector('.modal');
  modal.querySelector('[data-x=n]').click();
  await sleep(300);
  modal = doc.querySelector('.modal');
  const minEl = modal.querySelector('#ctemp-min');
  const maxEl = modal.querySelector('#ctemp-max');
  if (!minEl || !maxEl || !modal.querySelector('#ctemp-add')) throw new Error('缺自定义温度区间输入');
  modal.querySelector('#combo-name').value = '测试组合';
  modal.querySelector('.pick-card').click();
  minEl.value = '18';
  maxEl.value = '26';
  modal.querySelector('#ctemp-add').click();
  await sleep(100);
  const customChip = Array.from(modal.querySelectorAll('input[name=ctemp]')).find(x => x.value === '18~26℃');
  if (!customChip || !customChip.checked) throw new Error('自定义温度区间未生成选中 chip');
  modal.querySelector('[data-x=s]').click();
  await sleep(400);
  const look = w.Storage.getDB().settings.outfitLooks.find(x => x.name === '测试组合');
  if (!look || (look.tempRanges || []).indexOf('18~26℃') < 0) throw new Error('自定义温度区间未保存: ' + JSON.stringify(look));
  const closeBtn = doc.querySelector('.modal [data-x=c]');
  if (closeBtn) closeBtn.click();
  await sleep(250);
  console.log('OK  3 温度细化档位 + 自定义区间保存');

  // 4 天气卡：区间 + 数据刷新时间可信（显示锁定时刻，而非当前时间）+ 推荐 + 不显示地点
  // 预置昨日锁定记录：面板必须显示它的原始时间，证明时间戳跟随数据而非墙钟
  w.localStorage.setItem('lovelife-geo', JSON.stringify({ lat: 30.52, lon: 114.61 }));
  w.localStorage.setItem('lovelife-wx-' + TODAY, JSON.stringify(
    { min: 18, max: 25, desc: '多云', icon: '⛅', source: 'auto', fetchedAt: '11-1 09:00' }));
  w.App.go('outfits');
  await sleep(800);
  const card = doc.getElementById('weather-card');
  if (!card) throw new Error('穿搭日历缺天气推荐卡');
  let t = card.textContent;
  if (t.indexOf('18~25℃') < 0) throw new Error('缺温度区间显示: ' + t.slice(0, 160));
  if (t.indexOf('今日天气 · ' + TODAY) < 0) throw new Error('缺今日天气日期标注: ' + t.slice(0, 160));
  if (t.indexOf('地点') >= 0) throw new Error('不应再显示地点: ' + t.slice(0, 200));
  if (t.indexOf('数据刷新：11-1 09:00') < 0) throw new Error('刷新时间未随数据走（应显示锁定时刻）: ' + t.slice(0, 200));
  if (t.indexOf('今日穿搭推荐') < 0) throw new Error('缺今日推荐标题');
  if (t.indexOf('20~24℃') < 0) throw new Error('区间型历史穿搭未按区间显示');
  if (t.indexOf('21℃') < 0) throw new Error('单值历史穿搭显示丢失');
  if (t.indexOf('通勤') < 0 || t.indexOf('旧记录') < 0) throw new Error('未推荐温度相近的历史穿搭');
  if (t.indexOf('秋日通勤') < 0) throw new Error('未推荐匹配的穿搭组合');
  const n1 = wxCalls();
  doc.getElementById('btn-today').click();
  await sleep(600);
  if (wxCalls() !== n1) throw new Error('当日已锁定仍重复拉取天气');
  console.log('OK  4 天气卡：区间+刷新时间随数据走+推荐+无地点');

  // 5 刷新真实性：成功才更新时间；失败保留上次数据与时间
  doc.getElementById('w-refresh').click();
  await sleep(700);
  t = doc.getElementById('weather-card').textContent;
  if (wxCalls() !== n1 + 1) throw new Error('手动刷新未重新拉取天气');
  if (t.indexOf('数据刷新：11-1 09:00') >= 0) throw new Error('刷新成功后时间未更新: ' + t.slice(0, 200));
  // 手动填入区间（仅当天）
  doc.getElementById('w-manual').click();
  await sleep(250);
  modal = doc.querySelector('.modal');
  modal.querySelector('#w-min').value = '10';
  modal.querySelector('#w-max').value = '15';
  modal.querySelector('[data-x=s]').click();
  await sleep(400);
  t = doc.getElementById('weather-card').textContent;
  if (t.indexOf('10~15℃') < 0 || t.indexOf('手动设定') < 0) throw new Error('手动温度区间未生效: ' + t.slice(0, 160));
  const stampBefore = dataStamp(doc);
  // 刷新失败：时间戳必须保持不变（不得假装刷新）
  failWx = true;
  doc.getElementById('w-refresh').click();
  await sleep(700);
  failWx = false;
  t = doc.getElementById('weather-card').textContent;
  if (t.indexOf('10~15℃') < 0) throw new Error('刷新失败后应保留上次数据: ' + t.slice(0, 160));
  if (dataStamp(doc) !== stampBefore) throw new Error('刷新失败但时间戳被更新（假装刷新）: ' + dataStamp(doc));
  console.log('OK  5 刷新真实性：成功才更新时间，失败保留原数据');

  // 6 穿搭打卡温度区间输入（建历史日期记录，不干扰当日状态）
  w.Views.openOutfitEditor('2026-01-15');
  await sleep(350);
  modal = doc.querySelector('.modal');
  const tmin = modal.querySelector('[name=tempMin]');
  const tmax = modal.querySelector('[name=tempMax]');
  if (!tmin || !tmax) throw new Error('打卡弹窗缺温度区间输入');
  if (modal.querySelector('[name=temperature]')) throw new Error('打卡弹窗仍是单值温度输入');
  tmin.value = '-5';
  tmax.value = '2';
  modal.querySelector('.pick-card').click();
  await sleep(100);
  modal.querySelector('[data-act=save]').click();
  await sleep(400);
  const recSaved = w.Storage.getDB().outfits.find(x => x.date === '2026-01-15');
  if (!recSaved) throw new Error('打卡未保存');
  if (recSaved.tempMin !== -5 || recSaved.tempMax !== 2) throw new Error('温度区间未保存: ' + JSON.stringify(recSaved));
  console.log('OK  6 穿搭打卡：温度按区间输入保存');

  // 7 当天已打卡 → 推荐次日（明确标注明日天气 + 次日预报区间）
  w.Storage.getDB().outfits.push({ id: 'o9', date: TODAY, tempMin: 18, tempMax: 22, occasion: '今日已打卡', itemIds: ['c1'], cosmeticIds: [], images: [] });
  w.App.go('outfits');
  await sleep(700);
  t = doc.getElementById('weather-card').textContent;
  if (t.indexOf('明日穿搭推荐') < 0) throw new Error('已打卡未切换次日推荐: ' + t.slice(0, 160));
  if (t.indexOf('明日天气 · ' + TOMORROW) < 0) throw new Error('未明确标注明日天气日期: ' + t.slice(0, 160));
  if (t.indexOf('12~17℃') < 0) throw new Error('未使用次日预报区间: ' + t.slice(0, 160));
  if (t.indexOf('＋明日') < 0) throw new Error('套用按钮未改为＋明日');
  console.log('OK  7 当天已打卡 → 明日推荐（明日天气日期明确标注）');

  // 8 侧栏拖拽调宽 + 双击恢复
  const handle = doc.getElementById('sidebar-resizer');
  if (!handle) throw new Error('缺侧栏拖拽手柄');
  handle.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 232 }));
  handle.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 300 }));
  handle.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: 300 }));
  await sleep(250);
  const varW = doc.documentElement.style.getPropertyValue('--sidebar-w');
  if (varW !== '300px') throw new Error('拖拽宽度未生效: ' + varW);
  const saveCalls = calls.filter(c => c.url.includes('/api/save') && c.body && c.body.target === 'settings');
  const lastSave = saveCalls[saveCalls.length - 1];
  if (!lastSave || lastSave.body.data.settings.sidebarWidth !== 300) throw new Error('侧栏宽度未持久化');
  handle.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
  await sleep(200);
  if (doc.documentElement.style.getPropertyValue('--sidebar-w') !== '232px') throw new Error('双击未恢复默认宽度');
  console.log('OK  8 侧栏拖拽调宽 + 双击恢复默认');

  console.log('========== v1.0.8 新功能全部通过 ==========');
}

main().catch(function (e) {
  console.error('FAIL', e && e.stack || e);
  process.exit(1);
});
