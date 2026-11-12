/* v127-food-meal-quick.test.js — v1.1.9 美食日历餐别快捷框（早/中/晚/加）回归锁：
   1) 每格日期右侧四框（cal-day-row）：未录灰框、已录绿框（文字恒为早/中/晚/加）
   2) 点灰框 → 录入弹窗预填该日期+该餐别
   3) 点绿框 → 当顿清单（词条/价格/账标）；行点击编辑、底部「+ 添加」预填同餐别
   4) 「加」口径：加餐/夜宵/无餐别都归入「加」框
   5) 显示模式：默认常驻；设置 hover → cal-grid.quick-hover（占位不推挤）
   6) 格子默认交互不受影响（点空白开当天录入） */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWindow, waitFor, waitMain, lastModal, waitNoModal, assert } = require('./helpers/harness');

let cur = '';

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const CATS = {
  foodCuisine: ['中餐'], foodType: [], meal: ['早餐', '午餐', '晚餐', '加餐', '夜宵'], foodTag: []
};

function dayCell(doc, dateStr) {
  return doc.querySelector('.cal-cell[data-date="' + dateStr + '"]');
}

async function main() {
  const now = new Date();
  const d2 = ymd(new Date(now.getFullYear(), now.getMonth(), 2));
  const FOOD = [
    { id: 'f1', date: d2, meal: '早餐', foodCuisine: '中餐', name: '包子', price: 8, tags: [], images: [] },
    { id: 'f2', date: d2, meal: '晚餐', foodCuisine: '中餐', name: '火锅', price: 120, tags: [], images: [], linkedBillIds: ['b1'] },
    { id: 'f3', date: d2, meal: '夜宵', foodCuisine: '中餐', name: '烧烤', price: 60, tags: [], images: [] }
  ];

  /* 1) 四框渲染 + 状态 */
  cur = '1. 日期右侧四框：早/中/晚/加 + 灰/绿态';
  {
    const w = makeWindow({ data: { categories: CATS, food: JSON.parse(JSON.stringify(FOOD)) } });
    if (!(await waitMain(w))) throw new Error('no main');
    w.App.go('food');
    await waitFor(function () {
      return dayCell(w.document, d2) && dayCell(w.document, d2).querySelector('.cal-meal') ? true : null;
    }, { label: '餐别快捷框未渲染' });
    const cell = dayCell(w.document, d2);
    const row = cell.querySelector('.cal-day-row');
    assert(row && row.querySelector('.cal-day'), '日期数字应在 day-row 内');
    const meals = cell.querySelectorAll('.cal-meal');
    assert(meals.length === 4, '应有 4 个餐别框，实为 ' + meals.length);
    const texts = Array.prototype.map.call(meals, function (b) { return b.textContent.trim(); }).join('');
    assert(texts === '早中晚加', '框文字应为 早/中/晚/加，实为 ' + texts);
    assert(meals[0].classList.contains('meal-on'), '早餐已录应绿框');
    assert(meals[1].classList.contains('meal-on') === false, '午餐未录应灰框');
    assert(meals[2].classList.contains('meal-on'), '晚餐已录应绿框');
    assert(meals[3].classList.contains('meal-on'), '夜宵归「加」且已录应绿框');
    console.log('PASS 1. ' + cur);
  }

  /* 2) 点灰框=筛选（高亮+内容区无该餐）；点空白=录入预填 */
  cur = '2. 点灰框筛选 + 点空白录入预填';
  {
    const w = makeWindow({ data: { categories: CATS, food: JSON.parse(JSON.stringify(FOOD)) } });
    if (!(await waitMain(w))) throw new Error('no main');
    w.App.go('food');
    await waitFor(function () {
      return dayCell(w.document, d2) && dayCell(w.document, d2).querySelector('.cal-meal') ? true : null;
    }, { label: '快捷框未渲染' });
    dayCell(w.document, d2).querySelector('.cal-meal[data-meal-slot=中]').click();
    await waitFor(function () {
      return dayCell(w.document, d2).querySelector('.cal-meal[data-meal-slot=中].filter-on') ? true : null;
    }, { label: '筛选高亮未生效' });
    const cell = dayCell(w.document, d2);
    assert(cell.querySelector('.cal-meal[data-meal-slot=中]').classList.contains('filter-on'), '点框应高亮筛选');
    assert(cell.textContent.indexOf('包子') < 0 && cell.textContent.indexOf('火锅') < 0, '筛选午餐应隐藏其他餐词条');
    // 点空白 → 该餐录入预填
    cell.click();
    await waitFor(function () { return lastModal(w.document) ? true : null; }, { label: '录入弹窗未打开' });
    const m = lastModal(w.document);
    assert(m.querySelector('[name=meal]').value === '午餐', '餐别应预填「午餐」，实为 ' + m.querySelector('[name=meal]').value);
    assert(m.querySelector('[name=date]').value === d2, '日期应预填当日');
    console.log('PASS 2. ' + cur);
  }

  /* 3) 点绿框=筛选显示该顿（词条/账标）；再点=取消筛选 */
  cur = '3. 点绿框筛选该顿 + 再点取消';
  {
    const w = makeWindow({ data: { categories: CATS, food: JSON.parse(JSON.stringify(FOOD)) } });
    if (!(await waitMain(w))) throw new Error('no main');
    w.App.go('food');
    await waitFor(function () {
      return dayCell(w.document, d2) && dayCell(w.document, d2).querySelector('.cal-meal') ? true : null;
    }, { label: '快捷框未渲染' });
    dayCell(w.document, d2).querySelector('.cal-meal[data-meal-slot=晚]').click();
    await waitFor(function () {
      const cell = dayCell(w.document, d2);
      return cell && cell.querySelector('.cal-meal[data-meal-slot=晚].filter-on') && cell.textContent.indexOf('火锅') >= 0 ? true : null;
    }, { label: '筛选未显示该顿' });
    const cell = dayCell(w.document, d2);
    assert(cell.textContent.indexOf('火锅') >= 0, '筛选晚餐应显示火锅词条');
    assert(cell.textContent.indexOf('包子') < 0 && cell.textContent.indexOf('烧烤') < 0, '应隐藏其他餐');
    assert(cell.querySelector('.tag'), '词条应带「账」标');
    // 点词条 = 编辑
    cell.querySelector('[data-open-rec]').click();
    await waitFor(function () {
      const m = lastModal(w.document);
      return m && m.querySelector('#food-form') ? m : null;
    }, { label: '点词条未打开编辑' });
    const x = lastModal(w.document).querySelector('.modal-close');
    if (x) x.click();
    await waitNoModal(w.document);
    // 再点同钮 = 取消筛选（恢复全部）
    dayCell(w.document, d2).querySelector('.cal-meal[data-meal-slot=晚]').click();
    await waitFor(function () {
      const c = dayCell(w.document, d2);
      return c && !c.querySelector('.filter-on') && c.textContent.indexOf('包子') >= 0 ? true : null;
    }, { label: '再点未取消筛选' });
    console.log('PASS 3. ' + cur);
  }

  /* 4) 「加」口径 */
  cur = '4. 「加」口径：加餐/夜宵/无餐别都归「加」框';
  {
    const w = makeWindow({
      data: {
        categories: CATS,
        food: [
          { id: 'g1', date: d2, meal: '加餐', foodCuisine: '中餐', name: '奶茶', price: 18, tags: [], images: [] },
          { id: 'g2', date: d2, meal: '', foodCuisine: '中餐', name: '随便吃', price: 10, tags: [], images: [] }
        ]
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    w.App.go('food');
    await waitFor(function () {
      return dayCell(w.document, d2) && dayCell(w.document, d2).querySelector('.cal-meal') ? true : null;
    }, { label: '快捷框未渲染' });
    const cell = dayCell(w.document, d2);
    assert(cell.querySelector('.cal-meal[data-meal-slot=加]').classList.contains('meal-on'), '加餐/无餐别应点亮「加」框');
    cell.querySelector('.cal-meal[data-meal-slot=加]').click();
    await waitFor(function () {
      const c = dayCell(w.document, d2);
      return c && c.textContent.indexOf('奶茶') >= 0 && c.textContent.indexOf('随便吃') >= 0 ? true : null;
    }, { label: '「加」筛选未含全部口径' });
    console.log('PASS 4. ' + cur);
  }

  /* 5) 显示模式 */
  cur = '5. 显示模式：默认常驻；设置 hover → quick-hover 类';
  {
    const w1 = makeWindow({ data: { categories: CATS, food: [] } });
    if (!(await waitMain(w1))) throw new Error('no main');
    w1.App.go('food');
    await waitFor(function () {
      return w1.document.querySelector('.cal-grid') ? true : null;
    }, { label: '日历未渲染' });
    assert(!w1.document.querySelector('.cal-grid.quick-hover'), '默认应常驻（无 quick-hover 类）');
    const w2 = makeWindow({ data: { categories: CATS, food: [], settings: { foodMealQuick: 'hover' } } });
    if (!(await waitMain(w2))) throw new Error('no main');
    w2.App.go('food');
    await waitFor(function () {
      return w2.document.querySelector('.cal-grid') ? true : null;
    }, { label: '日历未渲染 2' });
    assert(w2.document.querySelector('.cal-grid.quick-hover'), '设置 hover 应带 quick-hover 类');
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'css', 'extra.css'), 'utf8');
    assert(/\.cal-grid\.quick-hover\s*\.cal-meals\s*\{\s*opacity:\s*0/.test(css), 'hover 模式应默认隐藏（占位不推挤）');
    assert(/\.cal-meal\.meal-on/.test(css) && /#34c759/.test(css), '绿框配方应为全站完成态绿色');
    console.log('PASS 5. ' + cur);
  }

  /* 6) 格子默认交互不受影响 */
  cur = '6. 格子默认交互不受影响（点空白开当天录入）';
  {
    const w = makeWindow({ data: { categories: CATS, food: [] } });
    if (!(await waitMain(w))) throw new Error('no main');
    w.App.go('food');
    await waitFor(function () {
      return dayCell(w.document, d2) ? true : null;
    }, { label: '日历未渲染' });
    dayCell(w.document, d2).click();
    await waitFor(function () {
      const m = lastModal(w.document);
      return m && m.querySelector('#food-form') ? m : null;
    }, { label: '点格子未开录入' });
    assert(lastModal(w.document).querySelector('[name=date]').value === d2, '点格子应开当天录入');
    console.log('PASS 6. ' + cur);
  }

  console.log('========== v127-food-meal-quick：6 项全部通过 ==========');
}

main().catch(function (e) {
  console.log('FAIL ' + cur + ': ' + (e && e.message || e));
  process.exit(1);
});
