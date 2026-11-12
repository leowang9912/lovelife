/* v108-features.test.js — v1.0.8 新功能回归：列表排序 / 温度自定义 / 天气区间推荐（数据刷新时间可信） / 侧栏拖拽 */
'use strict';
const { makeWindow, waitFor, sleep, waitMain } = require('./helpers/harness');

function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const NOW = new Date();
const TODAY = fmt(NOW);
const TOMORROW = fmt(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1));

const calls = [];   // /api/save 落盘记录（harness opts.onSave 收集）
let failWx = false; // 天气接口失败开关
let wxCount = 0;    // 天气接口调用计数
let cur = '';

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

function firstCardName(doc) {
  const c = doc.querySelector('.item-card .item-name');
  return c ? c.textContent.trim() : '';
}
function firstCardInfo(doc) {
  const c = doc.querySelector('.item-card .item-cost');
  return c ? c.textContent.trim() : '';
}
function wxCalls() {
  return wxCount;
}
function dataStamp(doc) {
  // v1.2.01：刷新时间收进 🔄 悬停提示（title=「数据刷新：xxx · 点击重新获取天气」）
  const box = doc.getElementById('home-weather');
  const b = box && box.querySelector('#w-refresh');
  const t = (b && b.getAttribute('title')) || '';
  const m = t.match(/数据刷新：(.+?)\s*·/);
  return m ? m[1].trim() : '';
}

async function main() {
  const w = makeWindow({
    data: {
      items: items, outfits: outfits, settings: settings,
      categories: {
        digital: [], clothing: [{ id: 'top', name: '上装' }], life: [{ id: 'skin', name: '护肤' }],
        tagPresets: ['贵重', '待清洗', '断舍离候选']
      }
    },
    routes: {
      'api.open-meteo.com': function (h) {
        wxCount++;
        if (failWx) return h.fail({ error: true }, 500);
        return h.ok({
          daily: {
            time: [TODAY, TOMORROW],
            temperature_2m_min: [18, 12],
            temperature_2m_max: [25, 17],
            weather_code: [1, 2]
          }
        });
      }
    },
    onSave: function (target, data) { calls.push({ target: target, data: data }); }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;

  // 1 列表排序：字段 + 方向双向（默认时间新→旧；价格高→低/低→高；时间旧→新）
  cur = '1. 列表排序：时间/价格 大小新旧双向可调';
  w.App.go('clothing');
  const sortSel = await waitFor(function () { return doc.getElementById('filter-sort'); }, { label: '衣橱列表渲染' });
  const dirBtn = doc.getElementById('sort-dir');
  if (!sortSel || !dirBtn) throw new Error('衣橱缺排序控件');
  if (firstCardName(doc) !== 'T恤') throw new Error('默认排序应时间新→旧（T恤），实为 ' + firstCardName(doc));
  if (firstCardInfo(doc).indexOf('购于 2025-03-01') < 0) throw new Error('按时间排序时卡片应显示购买时间: ' + firstCardInfo(doc));
  sortSel.value = 'price';
  sortSel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await waitFor(function () { return firstCardName(doc) === '西裤'; }, { label: '价格高→低排序渲染' });
  if (firstCardName(doc) !== '西裤') throw new Error('价格高→低排序错，实为 ' + firstCardName(doc));
  if (firstCardInfo(doc).indexOf('200') < 0) throw new Error('按价格排序时卡片应显示价格: ' + firstCardInfo(doc));
  doc.getElementById('sort-dir').click();
  await waitFor(function () { return firstCardName(doc) === 'T恤'; }, { label: '价格低→高排序渲染' });
  if (firstCardName(doc) !== 'T恤') throw new Error('价格低→高排序错，实为 ' + firstCardName(doc));
  if (firstCardInfo(doc).indexOf('100') < 0) throw new Error('价格低→高时卡片应显示价格: ' + firstCardInfo(doc));
  const sortSel2 = doc.getElementById('filter-sort');
  sortSel2.value = 'date';
  sortSel2.dispatchEvent(new w.Event('change', { bubbles: true }));
  await waitFor(function () { return firstCardName(doc) === 'T恤'; }, { label: '时间新→旧排序渲染' });
  if (firstCardName(doc) !== 'T恤') throw new Error('时间新→旧排序错，实为 ' + firstCardName(doc));
  doc.getElementById('sort-dir').click();
  await waitFor(function () { return firstCardName(doc) === '西裤'; }, { label: '时间旧→新排序渲染' });
  if (firstCardName(doc) !== '西裤') throw new Error('时间旧→新排序错，实为 ' + firstCardName(doc));
  console.log('PASS ' + cur);

  // 2 生活页专属排序（剩余量少→多 / 多→少）
  cur = '2. 生活页专属排序：剩余量双向可调';
  w.App.go('life');
  const lifeSort = await waitFor(function () { return doc.getElementById('life-sort'); }, { label: '生活页渲染' });
  if (!lifeSort) throw new Error('生活页缺排序下拉');
  if (!Array.from(lifeSort.options).some(o => o.value === 'remain')) throw new Error('生活页缺剩余量排序');
  lifeSort.value = 'remain';
  lifeSort.dispatchEvent(new w.Event('change', { bubbles: true }));
  await waitFor(function () { return firstCardName(doc) === '口红'; }, { label: '剩余量少→多排序渲染' });
  if (firstCardName(doc) !== '口红') throw new Error('剩余量少→多排序错，实为 ' + firstCardName(doc));
  if (firstCardInfo(doc).indexOf('剩余') < 0) throw new Error('按剩余量排序时卡片应显示剩余量: ' + firstCardInfo(doc));
  doc.getElementById('life-sort-dir').click();
  await waitFor(function () { return firstCardName(doc) === '面霜'; }, { label: '剩余量多→少排序渲染' });
  if (firstCardName(doc) !== '面霜') throw new Error('剩余量多→少排序错，实为 ' + firstCardName(doc));
  console.log('PASS ' + cur);

  // 3 温度细化 + 自定义区间
  cur = '3. 温度细化档位 + 自定义区间保存';
  w.App.go('clothing');
  await waitFor(function () { return doc.getElementById('btn-outfit-looks'); }, { label: '衣橱页渲染' });
  doc.getElementById('btn-outfit-looks').click();
  let modal = await waitFor(function () {
    const m = doc.querySelector('.modal');
    return m && m.querySelector('[data-x=n]') ? m : null;
  }, { label: '穿搭组合弹窗出现' });
  modal.querySelector('[data-x=n]').click();
  modal = await waitFor(function () {
    const m = doc.querySelector('.modal');
    return m && m.querySelector('#ctemp-min') && m.querySelector('#ctemp-max') && m.querySelector('#ctemp-add') ? m : null;
  }, { label: '组合编辑弹窗出现' });
  const minEl = modal.querySelector('#ctemp-min');
  const maxEl = modal.querySelector('#ctemp-max');
  if (!minEl || !maxEl || !modal.querySelector('#ctemp-add')) throw new Error('缺自定义温度区间输入');
  modal.querySelector('#combo-name').value = '测试组合';
  modal.querySelector('.pick-card').click();
  await waitFor(function () { return modal.querySelector('.pick-card.on'); }, { label: 'picker 选中物品' });
  minEl.value = '18';
  maxEl.value = '26';
  modal.querySelector('#ctemp-add').click();
  const customChip = await waitFor(function () {
    return Array.from(modal.querySelectorAll('input[name=ctemp]')).find(x => x.value === '18~26℃');
  }, { label: '自定义温度区间未生成选中 chip' });
  if (!customChip || !customChip.checked) throw new Error('自定义温度区间未生成选中 chip');
  modal.querySelector('[data-x=s]').click();
  const look = await waitFor(function () {
    return w.Storage.getDB().settings.outfitLooks.find(x => x.name === '测试组合');
  }, { label: '自定义温度区间未保存' });
  if (!look || (look.tempRanges || []).indexOf('18~26℃') < 0) throw new Error('自定义温度区间未保存: ' + JSON.stringify(look));
  // 等编辑器保存收尾自关，再关「穿搭组合」列表弹窗
  await waitFor(function () { return !doc.body.contains(modal); }, { label: '组合编辑弹窗关闭' });
  const closeBtn = doc.querySelector('.modal [data-x=c]');
  if (closeBtn) {
    closeBtn.click();
    await waitFor(function () { return !doc.querySelector('.modal'); }, { label: '弹窗关闭' });
  }
  console.log('PASS ' + cur);

  // 4 天气卡：区间 + 数据刷新时间可信（显示锁定时刻，而非当前时间）+ 推荐 + 不显示地点
  // 预置昨日锁定记录：面板必须显示它的原始时间，证明时间戳跟随数据而非墙钟
  cur = '4. 天气卡：区间+刷新时间随数据走+推荐+无地点';
  // v1.1.4 乙4：天气/定位缓存键带账号前缀（accKey(base) = accId + ':' + base）
  const wxKeyBase = w.Storage.accId() + ':';
  w.localStorage.setItem(wxKeyBase + 'lovelife-geo', JSON.stringify({ lat: 30.52, lon: 114.61 }));
  w.localStorage.setItem(wxKeyBase + 'lovelife-wx-' + TODAY, JSON.stringify(
    { min: 18, max: 25, desc: '多云', icon: '⛅', source: 'auto', fetchedAt: '11-1 09:00' }));
  w.App.go('home');
  // v1.2.01 形态：标题固定「穿搭推荐」（不再有「今日天气 · 日期」头），刷新时间收进 🔄 悬停提示
  const card = await waitFor(function () {
    const c = doc.getElementById('home-weather');
    return c && c.querySelector('.card-title') && c.querySelector('.wx-temp') ? c : null;
  }, { label: '主页天气推荐卡渲染' });
  if (!card) throw new Error('主页缺天气推荐卡');
  let t = card.textContent;
  if (t.indexOf('18~25℃') < 0) throw new Error('缺温度区间显示: ' + t.slice(0, 160));
  // 日期标注语义映射：目标日=今日时「今日」seg 选中（头不再带 YYYY-MM-DD，拍板删除）
  const segTodayOn = card.querySelector('[data-force-t="today"]');
  if (!segTodayOn || !segTodayOn.classList.contains('on')) throw new Error('今日态应选中「今日」切换: ' + t.slice(0, 160));
  if (t.indexOf('地点') >= 0) throw new Error('不应再显示地点: ' + t.slice(0, 200));
  // 刷新时间随数据走：显示在 🔄 按钮悬停提示（拍板：收进提示）
  const refreshBtn = card.querySelector('#w-refresh');
  if (!refreshBtn || (refreshBtn.getAttribute('title') || '').indexOf('数据刷新：11-1 09:00') < 0) {
    throw new Error('刷新时间未随数据走（应在刷新钮提示里显示锁定时刻）');
  }
  if (t.indexOf('穿搭推荐') < 0) throw new Error('缺「穿搭推荐」标题');
  const useBtn = card.querySelector('[data-use-outfit],[data-use-combo]');
  if (!useBtn || !/套用到今日/.test(useBtn.getAttribute('title') || '')) throw new Error('今日态应用按钮应为「套用到今日」');
  if (t.indexOf('20~24℃') < 0) throw new Error('区间型历史穿搭未按区间显示');
  if (t.indexOf('21℃') < 0) throw new Error('单值历史穿搭显示丢失');
  if (t.indexOf('通勤') < 0 || t.indexOf('旧记录') < 0) throw new Error('未推荐温度相近的历史穿搭');
  if (t.indexOf('秋日通勤') < 0) throw new Error('未推荐匹配的穿搭组合');
  const n1 = wxCalls();
  w.App.go('home');
  // 当日已锁定：重渲染完成（缓存数据上屏）后不应再有新请求
  await waitFor(function () {
    const rb = doc.getElementById('home-weather') && doc.getElementById('home-weather').querySelector('#w-refresh');
    return rb && (rb.getAttribute('title') || '').indexOf('数据刷新：11-1 09:00') >= 0;
  }, { label: '主页天气卡重渲染' });
  if (wxCalls() !== n1) throw new Error('当日已锁定仍重复拉取天气');
  console.log('PASS ' + cur);

  // 5 刷新真实性：成功才更新时间；失败保留上次数据与时间
  cur = '5. 刷新真实性：成功才更新时间，失败保留原数据';
  doc.getElementById('w-refresh').click();
  await waitFor(function () { return wxCalls() === n1 + 1; }, { label: '手动刷新未重新拉取天气' });
  await waitFor(function () {
    const stamp = dataStamp(doc);
    return stamp && stamp !== '11-1 09:00';
  }, { label: '刷新成功后时间未更新' });
  t = doc.getElementById('home-weather').textContent;
  if (wxCalls() !== n1 + 1) throw new Error('手动刷新未重新拉取天气');
  if (dataStamp(doc) === '11-1 09:00') throw new Error('刷新成功后时间未更新: ' + dataStamp(doc));
  // 手动填入区间（仅当天）
  doc.getElementById('w-manual').click();
  modal = await waitFor(function () {
    const m = doc.querySelector('.modal');
    return m && m.querySelector('#w-min') ? m : null;
  }, { label: '手动填入弹窗出现' });
  modal.querySelector('#w-min').value = '10';
  modal.querySelector('#w-max').value = '15';
  modal.querySelector('[data-x=s]').click();
  await waitFor(function () {
    const tt = doc.getElementById('home-weather').textContent;
    return tt.indexOf('10~15℃') >= 0 && tt.indexOf('手动设定') >= 0;
  }, { label: '手动温度区间未生效' });
  t = doc.getElementById('home-weather').textContent;
  if (t.indexOf('10~15℃') < 0 || t.indexOf('手动设定') < 0) throw new Error('手动温度区间未生效: ' + t.slice(0, 160));
  const stampBefore = dataStamp(doc);
  // 刷新失败：时间戳必须保持不变（不得假装刷新）
  failWx = true;
  doc.getElementById('w-refresh').click();
  await waitFor(function () { return wxCalls() === n1 + 2; }, { label: '失败刷新未发起请求' });
  await sleep(50); // 失败回落渲染收尾（无 DOM 信号）
  failWx = false;
  t = doc.getElementById('home-weather').textContent;
  if (t.indexOf('10~15℃') < 0) throw new Error('刷新失败后应保留上次数据: ' + t.slice(0, 160));
  if (dataStamp(doc) !== stampBefore) throw new Error('刷新失败但时间戳被更新（假装刷新）: ' + dataStamp(doc));
  console.log('PASS ' + cur);

  // 6 穿搭打卡温度区间输入（建历史日期记录，不干扰当日状态）
  cur = '6. 穿搭打卡：温度按区间输入保存';
  w.Views.openOutfitEditor('2026-01-15');
  modal = await waitFor(function () {
    const m = doc.querySelector('.modal');
    return m && m.querySelector('[name=tempMin]') && m.querySelector('[name=tempMax]') ? m : null;
  }, { label: '打卡弹窗出现' });
  const tmin = modal.querySelector('[name=tempMin]');
  const tmax = modal.querySelector('[name=tempMax]');
  if (!tmin || !tmax) throw new Error('打卡弹窗缺温度区间输入');
  if (modal.querySelector('[name=temperature]')) throw new Error('打卡弹窗仍是单值温度输入');
  tmin.value = '-5';
  tmax.value = '2';
  modal.querySelector('.pick-card').click();
  await waitFor(function () { return modal.querySelector('.pick-card.on'); }, { label: 'picker 选中物品' });
  modal.querySelector('[data-act=save]').click();
  const recSaved = await waitFor(function () {
    return w.Storage.getDB().outfits.find(x => x.date === '2026-01-15');
  }, { label: '打卡未保存' });
  if (!recSaved) throw new Error('打卡未保存');
  if (recSaved.tempMin !== -5 || recSaved.tempMax !== 2) throw new Error('温度区间未保存: ' + JSON.stringify(recSaved));
  console.log('PASS ' + cur);

  // 7 当天已打卡 → 推荐次日（seg 明日选中 + 次日预报区间；日期前缀已按拍板删除）
  cur = '7. 当天已打卡 → 明日推荐（明日选中态 + 次日预报区间）';
  w.Storage.getDB().outfits.push({ id: 'o9', date: TODAY, tempMin: 18, tempMax: 22, occasion: '今日已打卡', itemIds: ['c1'], cosmeticIds: [], images: [] });
  w.App.go('home');
  await waitFor(function () {
    const c = doc.getElementById('home-weather');
    const b = c && c.querySelector('[data-force-t="tomorrow"]');
    return b && b.classList.contains('on') ? true : null;
  }, { label: '已打卡未切换次日推荐' });
  t = doc.getElementById('home-weather').textContent;
  const segT = doc.getElementById('home-weather').querySelector('[data-force-t="tomorrow"]');
  const segD = doc.getElementById('home-weather').querySelector('[data-force-t="today"]');
  if (!segT.classList.contains('on') || segD.classList.contains('on')) throw new Error('已打卡应自动选中「明日」: ' + t.slice(0, 160));
  if (t.indexOf('穿搭推荐') < 0) throw new Error('缺「穿搭推荐」标题: ' + t.slice(0, 160));
  if (t.indexOf('12~17℃') < 0) throw new Error('未使用次日预报区间: ' + t.slice(0, 160));
  const useBtn7 = doc.getElementById('home-weather').querySelector('[data-use-outfit],[data-use-combo]');
  if (!useBtn7 || !/套用到明日/.test(useBtn7.getAttribute('title') || '')) throw new Error('套用按钮未改为「套用到明日」');
  console.log('PASS ' + cur);

  // 8 侧栏拖拽调宽 + 双击恢复
  cur = '8. 侧栏拖拽调宽 + 双击恢复默认';
  const handle = doc.getElementById('sidebar-resizer');
  if (!handle) throw new Error('缺侧栏拖拽手柄');
  handle.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 232 }));
  handle.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 300 }));
  handle.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: 300 }));
  await waitFor(function () {
    return doc.documentElement.style.getPropertyValue('--sidebar-w') === '300px';
  }, { label: '拖拽宽度未生效' });
  const varW = doc.documentElement.style.getPropertyValue('--sidebar-w');
  if (varW !== '300px') throw new Error('拖拽宽度未生效: ' + varW);
  await waitFor(function () {
    return calls.some(function (c) {
      return c.target === 'settings' && c.data && c.data.settings && c.data.settings.sidebarWidth === 300;
    });
  }, { label: '侧栏宽度未持久化' });
  const saveCalls = calls.filter(c => c.target === 'settings');
  const lastSave = saveCalls[saveCalls.length - 1];
  if (!lastSave || lastSave.data.settings.sidebarWidth !== 300) throw new Error('侧栏宽度未持久化');
  handle.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
  // v1.2.01 拍板：默认宽 175px（旧默认 200 已改）
  await waitFor(function () {
    return doc.documentElement.style.getPropertyValue('--sidebar-w') === '175px';
  }, { label: '双击未恢复默认宽度(175)' });
  if (doc.documentElement.style.getPropertyValue('--sidebar-w') !== '175px') throw new Error('双击未恢复默认宽度(175)');
  console.log('PASS ' + cur);

  console.log('========== v1.0.8 新功能回归：8 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
