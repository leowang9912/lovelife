/* v109-features.test.js — v1.0.9 回归：Lucide 图标规范落地 / 设置页分标签 */
'use strict';
const { makeWindow, waitFor, sleep, waitMain } = require('./helpers/harness');

let cur = '';

let settings = {
  idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} },
  planSections: [{ id: 'kpi', enabled: true, fixed: true }],
  rememberAccount: true, makeupLooks: [], outfitLooks: [], customTags: []
};
const items = [
  { id: 'c1', kind: 'clothing', categoryId: 'top', name: 'T恤', purchaseDate: '2025-03-01', purchasePrice: 100, status: 'in_use', images: [], tags: [] },
  { id: 'l1', kind: 'life', categoryId: 'skin', name: '口红', purchaseDate: '2025-02-01', purchasePrice: 80, status: 'in_use', images: [], tags: [], useCount: 0 }
];

async function main() {
  const w = makeWindow({
    data: {
      items: items, settings: settings,
      categories: {
        digital: [], clothing: [{ id: 'top', name: '上装', icon: 'shirt' }], life: [],
        tagPresets: ['贵重', '待清洗', '断舍离候选']
      }
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;

  // 1 UI.icon：lucide 内联 SVG + 尺寸档 + 未知名回退占位
  cur = '1. UI.icon：SVG 输出 / 尺寸 / 未知名占位 / 旧值兼容';
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
  console.log('PASS ' + cur);

  // 2 导航与页面按钮全部 lucide（无 emoji 残留）
  cur = '2. 导航/按钮图标全部 lucide 化';
  w.App.go('clothing');
  await waitFor(function () { return doc.getElementById('btn-add-item'); }, { label: '衣橱页渲染' });
  const navSvgs = doc.querySelectorAll('.nav-item .nav-icon svg').length;
  if (navSvgs < 7) throw new Error('导航图标未全部替换为 SVG，实为 ' + navSvgs);
  const navText = doc.querySelector('.nav').textContent;
  if (/[🎮👕💄📅🍽⚙📊]/.test(navText)) throw new Error('导航仍有 emoji 图标');
  const addBtn = doc.getElementById('btn-add-item');
  if (addBtn.querySelector('svg') === null) throw new Error('记衣服按钮缺图标');
  console.log('PASS ' + cur);

  // 3 分类图标走 SVG（服务端 icon 字段=lucide 名）
  cur = '3. 分类/卡片渲染正常 + 无图图标 48px';
  w.App.go('clothing');
  const card = await waitFor(function () { return doc.querySelector('.item-card'); }, { label: '物品卡片渲染' });
  if (!card) throw new Error('缺物品卡片');
  if (card.textContent.indexOf('T恤') < 0) throw new Error('卡片渲染异常');
  const noimgSvg = card.querySelector('.item-noimg svg');
  if (!noimgSvg || noimgSvg.getAttribute('width') !== '48') throw new Error('无图默认图标应为 48px: ' + (noimgSvg && noimgSvg.getAttribute('width')));
  console.log('PASS ' + cur);

  // 4 设置页分标签：7 标签（六分组 + 危险操作）、默认账号组、切换只显隐、组内按钮带图标
  cur = '4. 设置页分标签切换正常 + 按钮/成本表 lucide 化';
  w.App.go('settings');
  const tabs = await waitFor(function () {
    const t = doc.querySelectorAll('[data-stab-btn]');
    return t.length ? t : null;
  }, { label: '设置页渲染' });
  if (tabs.length !== 7) throw new Error('设置页应 7 个标签，实为 ' + tabs.length);
  const accPanel = doc.querySelector('.stab[data-stab=account]');
  const softPanel = doc.querySelector('.stab[data-stab=soft]');
  if (!accPanel.classList.contains('stab-on')) throw new Error('默认应显示账号组');
  if (softPanel.classList.contains('stab-on')) throw new Error('软件组初始不应显示');
  softPanel.querySelector ? null : null;
  doc.querySelector('[data-stab-btn=soft]').click();
  await waitFor(function () {
    return !accPanel.classList.contains('stab-on') && softPanel.classList.contains('stab-on');
  }, { label: '标签切换显隐' });
  if (accPanel.classList.contains('stab-on')) throw new Error('切换后账号组未隐藏');
  if (!softPanel.classList.contains('stab-on')) throw new Error('切换后软件组未显示');
  const checkBtn = doc.getElementById('btn-check-update');
  if (!checkBtn || checkBtn.querySelector('svg') === null) throw new Error('检查更新按钮缺图标');
  if (checkBtn.textContent.indexOf('检查更新') < 0) throw new Error('按钮文案丢失');
  // v1.1.9：保存偏好按钮已改「变更即存」（对齐板块勾选）——锁偏好控件仍在 pref 组
  doc.querySelector('[data-stab-btn=pref]').click();
  await waitFor(function () { return doc.querySelector('.stab[data-stab=pref]').classList.contains('stab-on'); }, { label: '偏好组显示' });
  if (!doc.getElementById('set-idle') || !doc.getElementById('set-meal-quick')) throw new Error('偏好控件缺失（吃灰预警/餐别快捷）');
  // 成本模型行图标：分类 icon 字段走渲染器（回归：曾被当纯文本直出）
  doc.querySelector('[data-stab-btn=cost]').click();
  await waitFor(function () {
    return doc.querySelector('.cat-table[data-cat-kind=clothing] tbody td');
  }, { label: '成本模型表渲染' });
  const costRow = doc.querySelector('.cat-table[data-cat-kind=clothing] tbody td');
  if (!costRow || costRow.querySelector('svg') === null) throw new Error('成本模型行图标未 lucide 化: ' + (costRow ? costRow.innerHTML.slice(0, 60) : 'no row'));
  console.log('PASS ' + cur);

  // 5 穿搭打卡：妆品使用次数可调（当天多次）+ 按次数记账 + 编辑改次数对称
  cur = '5. 打卡妆品使用次数可调 + 按次数记账 + 编辑对称';
  w.Views.openOutfitEditor('2026-01-10');
  let modal = await waitFor(function () {
    const m = doc.querySelector('.modal');
    return m && m.querySelectorAll('#cos-picker .pick-card').length ? m : null;
  }, { label: '打卡弹窗出现' });
  const cosCard = modal.querySelectorAll('#cos-picker .pick-card')[0];
  if (!cosCard) throw new Error('缺妆品选择卡');
  cosCard.click();
  const qtyRow = await waitFor(function () { return modal.querySelector('.cos-qty-row'); }, { label: '次数步进出现' });
  if (!qtyRow || qtyRow.textContent.indexOf('1 次') < 0) throw new Error('勾选后未出现次数步进（默认 1 次）');
  modal.querySelector('[data-q-inc]').click();
  await waitFor(function () {
    const q = modal.querySelector('.cos-qty-row');
    return q && q.textContent.indexOf('2 次') >= 0;
  }, { label: '次数 +1 未生效' });
  if (modal.querySelector('.cos-qty-row').textContent.indexOf('2 次') < 0) throw new Error('次数 +1 未生效');
  modal.querySelector('#cloth-picker .pick-card').click();
  await waitFor(function () { return modal.querySelector('#cloth-picker .pick-card.on'); }, { label: 'picker 选中衣物' });
  modal.querySelector('[data-act=save]').click();
  const outfit = await waitFor(function () {
    return w.Storage.getDB().outfits.find(x => x.date === '2026-01-10');
  }, { label: '打卡未保存' });
  const l1 = w.Storage.getDB().items.find(x => x.id === 'l1');
  if (!outfit || (outfit.cosmeticQty || {}).l1 !== 2) throw new Error('次数未随打卡保存: ' + JSON.stringify(outfit && outfit.cosmeticQty));
  if (Number(l1.useCount) !== 2) throw new Error('使用次数应按 2 次记账，实为 ' + l1.useCount);
  // 等上一个打卡弹窗保存收尾自关，再进编辑态（防弹窗叠层串台）
  await waitFor(function () { return !doc.body.contains(modal); }, { label: '打卡弹窗关闭' });
  // 编辑改次数：2 → 1，记账对称回到 1
  w.Views.openOutfitEditor('2026-01-10', outfit);
  modal = await waitFor(function () {
    const m = doc.querySelector('.modal');
    return m && m.querySelector('.cos-qty-row') && m.querySelector('.cos-qty-row').textContent.indexOf('2 次') >= 0 ? m : null;
  }, { label: '编辑态未预填次数' });
  if (modal.querySelector('.cos-qty-row').textContent.indexOf('2 次') < 0) throw new Error('编辑态未预填次数');
  modal.querySelector('[data-q-dec]').click();
  await waitFor(function () {
    const q = modal.querySelector('.cos-qty-row');
    return q && q.textContent.indexOf('1 次') >= 0;
  }, { label: '次数 -1 未生效' });
  modal.querySelector('[data-act=save]').click();
  await waitFor(function () {
    const it = w.Storage.getDB().items.find(x => x.id === 'l1');
    return it && Number(it.useCount) === 1;
  }, { label: '编辑减次后记账应为 1' });
  const l1b = w.Storage.getDB().items.find(x => x.id === 'l1');
  if (Number(l1b.useCount) !== 1) throw new Error('编辑减次后记账应为 1，实为 ' + l1b.useCount);
  console.log('PASS ' + cur);

  // 6 设置页标签管理：预设只读 + 标签库增删
  cur = '6. 设置页标签管理（预设只读 + 库增删）';
  w.App.go('settings');
  await waitFor(function () { return doc.querySelector('[data-stab-btn=pref]'); }, { label: '设置页渲染' });
  doc.querySelector('[data-stab-btn=pref]').click();
  const libBox = await waitFor(function () { return doc.getElementById('tag-lib-list'); }, { label: '标签管理渲染' });
  if (!libBox) throw new Error('设置页缺标签管理');
  if (libBox.textContent.indexOf('预设') < 0) throw new Error('标签管理应展示预设区');
  const libInput = doc.getElementById('tag-lib-new');
  libInput.value = '库测试标签';
  doc.getElementById('tag-lib-add').click();
  await waitFor(function () {
    return (w.Storage.getDB().settings.customTags || []).indexOf('库测试标签') >= 0 &&
      libBox.textContent.indexOf('库测试标签') >= 0;
  }, { label: '标签库添加未生效' });
  if (libBox.textContent.indexOf('库测试标签') < 0) throw new Error('标签库添加未生效');
  const libNow = w.Storage.getDB().settings.customTags || [];
  if (libNow.indexOf('库测试标签') < 0) throw new Error('标签库未持久化: ' + JSON.stringify(libNow));
  console.log('PASS ' + cur);

  console.log('========== v1.0.9 新功能回归：6 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
