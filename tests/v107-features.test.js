/* v107-features.test.js — v1.0.7 新功能回归：自定义标签 / 组合温季 / picker 出图 / KPI 驾驶舱 / 环图图例 / 标签筛选 */
'use strict';
const { makeWindow, waitFor, sleep, waitMain } = require('./helpers/harness');

const calls = []; // /api/save 落盘记录（harness opts.onSave 收集，用于断言持久化）
let cur = '';

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

async function main() {
  const w = makeWindow({
    data: {
      items: items,
      settings: settings,
      categories: {
        digital: [], clothing: [{ id: 'top', name: '上装' }], life: [{ id: 'skin', name: '护肤' }],
        tagPresets: ['贵重', '待清洗', '断舍离候选']
      }
    },
    onSave: function (target, data) { calls.push({ target: target, data: data }); }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;

  // 1 标签：预设 3 个 + 自定义输入生成 chip + 保存入库
  cur = '1. 标签：预设 3 个 + 自定义添加/×删除 + 标签库自主管理';
  w.App.go('clothing');
  await waitFor(function () { return doc.getElementById('btn-add-item'); }, { label: '衣橱页渲染' });
  doc.getElementById('btn-add-item').click();
  let modal = await waitFor(function () { return doc.querySelector('.modal'); }, { label: '记衣服弹窗出现' });
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
  const fresh = await waitFor(function () {
    return Array.from(modal.querySelectorAll('#tag-chips input[name=tags]')).find(x => x.value === '旅行必备');
  }, { label: '自定义标签 chip 生成' });
  if (!fresh || !fresh.checked) throw new Error('自定义标签未生成为选中 chip');
  const form = modal.querySelector('#item-form');
  const data = w.UI.readItemForm(form, { id: '', images: [] }, 'clothing');
  if (data.tags.indexOf('旅行必备') < 0) throw new Error('自定义标签未进 item.tags');
  await waitFor(function () {
    return calls.some(function (c) {
      return c.target === 'settings' && c.data && c.data.settings &&
        (c.data.settings.customTags || []).indexOf('旅行必备') >= 0;
    });
  }, { label: '自定义标签未持久化到标签库' });
  const saveCalls = calls.filter(c => c.target === 'settings');
  const lastSave = saveCalls[saveCalls.length - 1];
  const lib = (lastSave && lastSave.data.settings.customTags) || [];
  if (lib.indexOf('旅行必备') < 0) throw new Error('自定义标签未持久化到标签库: ' + JSON.stringify(lib));
  // × 删除标签：候选移除 + 从标签库删掉；预设标签不带删除按钮
  const presetDel = Array.from(modal.querySelectorAll('.chip-del'))
    .some(b => presetVals.indexOf(b.getAttribute('data-del-tag')) >= 0);
  if (presetDel) throw new Error('预设标签不应有删除按钮');
  const delBtn = Array.from(modal.querySelectorAll('.chip-del'))
    .find(b => b.getAttribute('data-del-tag') === '旅行必备');
  if (!delBtn) throw new Error('自定义标签缺删除按钮');
  delBtn.click();
  await waitFor(function () {
    return !Array.from(modal.querySelectorAll('#tag-chips input[name=tags]')).some(x => x.value === '旅行必备');
  }, { label: '删除后标签仍在候选' });
  const stillThere = Array.from(modal.querySelectorAll('#tag-chips input[name=tags]'))
    .some(x => x.value === '旅行必备');
  if (stillThere) throw new Error('删除后标签仍在候选');
  await sleep(50); // 等事件队列 flush（无 DOM 信号）：防延迟移除标签库
  // v1.0.9 语义修正：× 只从本物品移除，标签库不受影响（库管理在设置页）
  const lib2 = w.Storage.getDB().settings.customTags || [];
  if (lib2.indexOf('旅行必备') < 0) throw new Error('× 不应动标签库，但标签库丢失了: ' + JSON.stringify(lib2));
  modal.querySelector('[data-act=cancel]').click();
  await waitFor(function () { return !doc.body.contains(modal); }, { label: '记衣服弹窗关闭' });
  console.log('PASS ' + cur);

  // 2 picker 组件异步出图（组合编辑/打卡共用）
  cur = '2. picker：物品照片自动解析显示（组合编辑不再无图）';
  const box = doc.createElement('div');
  doc.body.appendChild(box);
  w.UI.picker(box, [{ id: 'x1', name: '测试衣', images: ['p1.jpg'] }], [], {});
  const pimg = await waitFor(function () { return box.querySelector('.pick-card img'); }, { label: 'picker 出图' });
  if (!pimg) throw new Error('picker 未显示物品照片');
  if (pimg.getAttribute('src').indexOf('/api/images/') < 0) throw new Error('picker 图片地址不对: ' + pimg.getAttribute('src'));
  console.log('PASS ' + cur);

  // 3 组合温度/季节 + 编辑器内物品照片（回归：调用方映射必须带 images）
  cur = '3. 组合：编辑器出图 + 温度/季节可设可存可展示';
  doc.getElementById('btn-outfit-looks').click();
  modal = await waitFor(function () { return doc.querySelector('.modal'); }, { label: '穿搭组合弹窗出现' });
  if (!modal) throw new Error('穿搭组合弹窗未出现');
  if (modal.textContent.indexOf('穿搭组合') < 0) throw new Error('打开的不是穿搭组合弹窗');
  modal.querySelector('[data-x=n]').click();
  modal = await waitFor(function () {
    const m = doc.querySelector('.modal');
    return m && m.querySelector('#combo-name') && m.querySelector('.pick-card img') ? m : null;
  }, { label: '进入组合编辑弹窗（出图）' });
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
  if (card) {
    card.click();
    // picker 选中会整格重绘，需重新查询选中态节点
    await waitFor(function () { return modal.querySelector('.pick-card.on'); }, { label: 'picker 选中物品' });
  }
  modal.querySelector('[data-x=s]').click();
  const look = await waitFor(function () {
    return w.Storage.getDB().settings.outfitLooks[0];
  }, { label: '组合保存' });
  if (!look) throw new Error('组合未保存');
  if ((look.seasons || []).indexOf('夏') < 0) throw new Error('季节未保存: ' + JSON.stringify(look));
  if ((look.tempRanges || []).indexOf('25~30℃') < 0) throw new Error('温度未保存');
  const badges = w.UI.comboBadges(look);
  if (badges.indexOf('夏') < 0 || badges.indexOf('30') < 0) throw new Error('组合徽标未输出');
  console.log('PASS ' + cur);

  // 4 KPI 资产驾驶舱 + 固定栏目大小调节
  cur = '4. KPI 驾驶舱四区齐全 + KPI/投入构成可调大小';
  // 等编辑器保存流程收尾自关，再关「穿搭组合」列表弹窗（点错弹窗会留残）
  await waitFor(function () { return !doc.body.contains(modal); }, { label: '组合编辑弹窗关闭' });
  const modalClose = doc.querySelector('.modal [data-x=c]');
  if (modalClose) {
    modalClose.click();
    await waitFor(function () { return !doc.querySelector('.modal'); }, { label: '弹窗关闭' });
  }
  w.App.go('plan');
  await waitFor(function () {
    const el = doc.getElementById('main-content');
    return el && el.textContent.indexOf('分域速览') >= 0 ? el : null;
  }, { label: '计划页渲染' });
  const planText = doc.getElementById('main-content').textContent;
  ['分域速览', '本月 vs 上月', '总投入', '在手估值', '本月花费', '预算剩余'].forEach(function (k) {
    if (planText.indexOf(k) < 0) throw new Error('KPI 驾驶舱缺 ' + k);
  });
  const kpiPanel = doc.querySelector('.plan-sec[data-id=kpi]');
  if (!kpiPanel) throw new Error('缺 KPI 栏目');
  doc.getElementById('btn-edit-sections').click();
  const kpiEdit = await waitFor(function () {
    const k = doc.querySelector('.plan-sec[data-id=kpi]');
    return k && k.querySelectorAll('.sec-size-btn').length ? k : null;
  }, { label: '栏目编辑模式' });
  const sizeBtns = kpiEdit.querySelectorAll('.sec-size-btn');
  if (sizeBtns.length !== 3) throw new Error('KPI 栏目缺大小调节按钮（' + sizeBtns.length + '/3）');
  const compPanel = doc.querySelector('.plan-sec[data-id=composition]');
  if (!compPanel || compPanel.querySelectorAll('.sec-size-btn').length !== 3) {
    throw new Error('投入构成栏目缺大小调节按钮');
  }
  kpiEdit.querySelector('[data-size-val=s]').click();
  await waitFor(function () {
    const k = doc.querySelector('.plan-sec[data-id=kpi]');
    return k && k.getAttribute('data-size') === 's' ? k : null;
  }, { label: '大小调节未生效' });
  const kpi2 = doc.querySelector('.plan-sec[data-id=kpi]');
  if (kpi2.getAttribute('data-size') !== 's') throw new Error('大小调节未生效');
  console.log('PASS ' + cur);

  // 5 环图常驻图例（色点+名称+数值+占比）
  cur = '5. 环图：常驻图例（名称+数值+占比）';
  const html = w.Charts.donut([
    { label: '数码', value: 1, valueText: '¥1' },
    { label: '衣服', value: 3 }
  ]);
  if (html.indexOf('donut-legend') < 0) throw new Error('环图缺图例');
  ['数码', '衣服', '¥1', '25%', '75%'].forEach(function (k) {
    if (html.indexOf(k) < 0) throw new Error('图例缺 ' + k);
  });
  console.log('PASS ' + cur);

  // 6 标签筛选（我的衣橱）
  cur = '6. 标签筛选：候选来自实际使用，过滤正确';
  doc.getElementById('btn-edit-sections').click(); // 退出编辑模式
  await waitFor(function () { return !doc.querySelector('.plan-sec .sec-size-btn'); }, { label: '退出栏目编辑模式' });
  w.App.go('clothing');
  const tagSel = await waitFor(function () { return doc.getElementById('filter-tag'); }, { label: '列表页渲染' });
  if (!tagSel) throw new Error('列表页缺标签筛选');
  const optVals = Array.from(tagSel.options).map(o => o.value);
  if (optVals.indexOf('贵重') < 0) throw new Error('标签筛选候选缺用过的标签: ' + optVals.join(','));
  tagSel.value = '贵重';
  tagSel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await waitFor(function () { return doc.querySelectorAll('.item-card').length === 1; }, { label: '标签筛选结果应 1 件' });
  const cards = doc.querySelectorAll('.item-card');
  if (cards.length !== 1) throw new Error('标签筛选结果应 1 件，实为 ' + cards.length);
  if (cards[0].textContent.indexOf('T恤') < 0) throw new Error('标签筛选选错物品');
  console.log('PASS ' + cur);

  console.log('========== v1.0.7 新功能回归：6 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
