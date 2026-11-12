/* calendar-open.test.js — v1.0.4 日历交互：点已有=编辑、多条=先选后编辑、小＋=新增
   （已迁移到 tests/helpers/harness.js） */
'use strict';
const { makeWindow, waitFor, waitMain } = require('./helpers/harness');

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

let curN = 0, curName = '';
function begin(n, name) { curN = n; curName = name; }

async function main() {
  const w = makeWindow({
    data: {
      items: items, outfits: outfits, food: food,
      settings: { idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} }, planSections: [], rememberAccount: true },
      categories: {
        digital: [], clothing: [], life: [],
        foodCuisine: ['川菜'], foodType: [], meal: ['午餐', '晚餐'], foodTag: [], occasion: ['通勤', '约会'], season: [],
        tagPresets: [], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
      }
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;

  // ===== 穿搭日历：两条记录 → 点格子弹选择器，点小＋弹新增，选条目进编辑 =====
  begin(1, '穿搭日历：多条→选择器→编辑（预填+删除）');
  w.App.go('outfits');
  let cell = await waitFor(function () {
    return doc.querySelector('.cal-cell[data-date="' + dateStr + '"]');
  }, { label: '找不到当日格子' });
  if (!cell) throw new Error('找不到当日格子');
  if (!cell.querySelector('.cal-add-mini')) throw new Error('缺少年日期旁小＋按钮');

  cell.click();
  await waitFor(function () { return doc.querySelector('.modal'); }, { label: '多条记录未弹选择器' });
  let modal = doc.querySelector('.modal');
  if (!modal) throw new Error('多条记录未弹选择器');
  const rows = modal.querySelectorAll('.pick-rec-row');
  if (rows.length !== 2) throw new Error('选择器条目数错误: ' + rows.length);
  if (modal.textContent.indexOf('新增一条') < 0) throw new Error('选择器缺少新增入口');
  rows[0].click();
  await waitFor(function () {
    const mm = doc.querySelector('.modal');
    return mm && mm.textContent.indexOf('编辑穿搭') >= 0;
  }, { label: '点条目未进编辑/未进入编辑态' });
  modal = doc.querySelector('.modal');
  if (!modal) throw new Error('点条目未进编辑');
  if (modal.textContent.indexOf('编辑穿搭') < 0) throw new Error('未进入编辑态: ' + modal.textContent.slice(0, 80));
  if (modal.querySelector('#outfit-form [name=note]').value !== '第一套') throw new Error('编辑态未预填备注');
  if (modal.textContent.indexOf('删除') < 0) throw new Error('编辑态缺少删除按钮');
  modal.querySelector('.modal-close').click();
  await waitFor(function () { return !doc.querySelector('.modal'); }, { label: '穿搭编辑弹窗未关闭' });
  console.log('PASS 1. 穿搭日历：多条→选择器→编辑（预填+删除）');

  // 小＋ = 新增
  begin(2, '穿搭日历：小＋ = 新增');
  cell.querySelector('.cal-add-mini').click();
  await waitFor(function () {
    const mm = doc.querySelector('.modal');
    return mm && mm.textContent.indexOf('穿搭打卡') >= 0;
  }, { label: '小＋未打开新增态' });
  modal = doc.querySelector('.modal');
  if (!modal || modal.textContent.indexOf('穿搭打卡') < 0) throw new Error('小＋未打开新增态');
  if (modal.querySelector('#outfit-form [name=note]').value !== '') throw new Error('新增态不应预填');
  modal.querySelector('.modal-close').click();
  await waitFor(function () { return !doc.querySelector('.modal'); }, { label: '穿搭新增弹窗未关闭' });
  console.log('PASS 2. 穿搭日历：小＋ = 新增');

  // ===== 美食日历：单条记录 → 直接进编辑 =====
  begin(3, '美食日历：单条→直接编辑（预填+删除）');
  w.App.go('food');
  cell = await waitFor(function () {
    return doc.querySelector('.cal-cell[data-date="' + dateStr + '"]');
  }, { label: '美食找不到当日格子' });
  if (!cell) throw new Error('美食找不到当日格子');
  cell.click();
  await waitFor(function () {
    const mm = doc.querySelector('.modal');
    return mm && mm.textContent.indexOf('编辑美食') >= 0;
  }, { label: '单条美食未直开/美食未进编辑态' });
  modal = doc.querySelector('.modal');
  if (!modal) throw new Error('单条美食未直开');
  if (modal.textContent.indexOf('编辑美食') < 0) throw new Error('美食未进编辑态: ' + modal.textContent.slice(0, 60));
  const nameInput = modal.querySelector('#food-form [name=name]');
  if (nameInput.value !== '麻婆豆腐') throw new Error('美食编辑态未预填');
  if (modal.textContent.indexOf('删除') < 0) throw new Error('美食编辑态缺少删除');
  modal.querySelector('.modal-close').click();
  await waitFor(function () { return !doc.querySelector('.modal'); }, { label: '美食编辑弹窗未关闭' });
  console.log('PASS 3. 美食日历：单条→直接编辑（预填+删除）');

  // ===== 列表页按钮命名统一 =====
  begin(4, '列表页按钮命名统一（记数码/记衣服/记美妆）');
  w.App.go('digital');
  await waitFor(function () {
    const mc = doc.getElementById('main-content');
    return mc && mc.innerHTML.indexOf('记数码') >= 0;
  }, { label: '数码页按钮命名未统一' });
  if (doc.getElementById('main-content').innerHTML.indexOf('记数码') < 0) throw new Error('数码页按钮命名未统一');
  w.App.go('clothing');
  await waitFor(function () {
    const mc = doc.getElementById('main-content');
    return mc && mc.innerHTML.indexOf('记衣服') >= 0;
  }, { label: '衣橱页按钮命名未统一' });
  if (doc.getElementById('main-content').innerHTML.indexOf('记衣服') < 0) throw new Error('衣橱页按钮命名未统一');
  w.App.go('life');
  await waitFor(function () {
    const mc = doc.getElementById('main-content');
    return mc && mc.innerHTML.indexOf('记美妆') >= 0;
  }, { label: '生活页按钮命名未统一' });
  if (doc.getElementById('main-content').innerHTML.indexOf('记美妆') < 0) throw new Error('生活页按钮命名未统一');
  console.log('PASS 4. 列表页按钮命名统一（记数码/记衣服/记美妆）');

  console.log('========== calendar-open：4 项全部通过 ==========');
  process.exit(0);
}

main().catch(e => { console.error('FAIL ' + curN + '. ' + curName + ': ' + e.message); process.exit(1); });
