/* v128-audit-fixes.test.js — v1.1.9 稽核 bug 修复回归锁（7 项）：
   1) 美食新建弹窗的「同日已有记录」列表不再恒空（isEdit 判定）
   2) 记一笔模板清单 outside-close 监听 onClose 移除（防 document 监听器泄漏）
   3) FoodView/HomeView 导出 resetState 且 app.js 账号切换调用（跨账号状态不残留）
   4) 编辑已屏蔽分类的账单：该分类仍显示并保持选中（不误显第一个分类）
   5) 环图二级分类归一级组；「其他」桶下钻只列无有效分类物品（不列全域）
   6) pickRecord「新增一条」带 presetMeal（与点空白路径一致）
   7) 习惯卡锚日跨天跟随（用户未翻页时） */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWindow, waitFor, waitMain, lastModal, assert } = require('./helpers/harness');

let cur = '';
const JS = function (f) { return fs.readFileSync(path.join(__dirname, '..', 'app', 'js', f), 'utf8'); };

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const CATS = { foodCuisine: ['中餐'], foodType: [], meal: ['早餐', '午餐', '晚餐', '加餐', '夜宵'], foodTag: [] };

async function main() {
  const now = new Date();
  const today = ymd(now);

  /* 1) 同日已有记录列表 */
  cur = '1. 美食新建弹窗「同日已有记录」列表不恒空';
  {
    const w = makeWindow({
      data: {
        categories: CATS,
        food: [{ id: 'f1', date: today, meal: '午餐', foodCuisine: '中餐', name: '面', price: 18, tags: [], images: [] }]
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    w.App.go('food');
    await waitFor(function () {
      return w.document.querySelector('#btn-add-food') ? true : null;
    }, { label: '美食页未渲染' });
    // 走「美食打卡」新建入口（点格子 1 条=开编辑，编辑态本就不显列表）
    w.document.querySelector('#btn-add-food').click();
    await waitFor(function () {
      const m = lastModal(w.document);
      return m && m.querySelector('#food-existing') ? m : null;
    }, { label: '录入弹窗未打开' });
    await waitFor(function () {
      const m = lastModal(w.document);
      return m && m.querySelector('#food-existing').textContent.indexOf('面') >= 0 ? true : null;
    }, { label: '同日已有记录列表为空（恒空回归）' });
    console.log('PASS 1. ' + cur);
  }

  /* 2) 模板清单监听泄漏 */
  cur = '2. 记一笔模板清单 outside-close 随弹窗 onClose 移除';
  {
    const src = JS('views-wallet.js');
    assert(src.indexOf('tplOutsideFn') >= 0 && /onClose:\s*function \(\)\s*\{[^}]*removeEventListener\('click',\s*tplOutsideFn\)/.test(src),
      '应 onClose 移除 tplOutsideFn');
    console.log('PASS 2. ' + cur);
  }

  /* 3) resetState 导出与调用 */
  cur = '3. FoodView/HomeView.resetState 导出 + app.js 账号切换调用';
  {
    const food = JS('views-food.js'), home = JS('views-home.js'), app = JS('app.js');
    assert(/resetState:\s*function \(\)/.test(food) && /resetState:\s*function \(\)/.test(home), '两视图应导出 resetState');
    assert(app.indexOf('FoodView.resetState') >= 0 && app.indexOf('HomeView.resetState') >= 0, 'app.js 账号切换应调用两者');
    assert(/mealFilterOf = \{\}/.test(food), 'resetState 应清餐别筛选');
    console.log('PASS 3. ' + cur);
  }

  /* 4) 已屏蔽分类选中保持 */
  cur = '4. 编辑已屏蔽分类账单：分类仍显示并保持选中';
  {
    const w = makeWindow({
      data: {
        categories: { foodCuisine: [], foodType: [], meal: [], foodTag: [] },
        wallet: {
          cats: {
            expense: [
              { id: 'w_food', name: '食品餐饮', icon: 'x', children: [{ id: 'w_food_lunch', name: '午餐', icon: 'x' }] },
              { id: 'w_shop', name: '购物消费', icon: 'x', children: [] }
            ],
            income: []
          },
          bills: [{ id: 'b1', type: 'expense', amount: 30, date: today, catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '午饭' }],
          accounts: []
        },
        settings: { hiddenWcats: ['w_food', 'w_food_lunch'] }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    w.App.go('wallet');
    await waitFor(function () {
      return w.document.querySelector('#wallet-body') ? true : null;
    }, { label: '钱袋页未渲染' });
    // 打开编辑（点行）
    const row = w.document.querySelector('.yw-bill-row');
    assert(row, '应有账单行');
    row.click();
    await waitFor(function () {
      const m = lastModal(w.document);
      return m && m.querySelector('#yw-cats .yw-cat-tab') ? m : null;
    }, { label: '编辑弹窗未打开' });
    const m = lastModal(w.document);
    const onTab = m.querySelector('.yw-cat-tab.on');
    assert(onTab && onTab.getAttribute('data-parent') === 'w_food', '已屏蔽的原分类应保持选中，实为 ' + (onTab && onTab.getAttribute('data-parent')));
    console.log('PASS 4. ' + cur);
  }

  /* 5) 环图归组与下钻 */
  cur = '5. 环图二级归一级组 + 「其他」桶下钻不列全域';
  {
    const src = JS('views-plan.js');
    assert(src.indexOf('function topCatOf(') >= 0, '应有 topCatOf 归组 helper');
    assert((src.match(/topCatOf\(db, '(digital|clothing|life)'/g) || []).length >= 3, '三处环图应走 topCatOf');
    assert(src.indexOf('!topCatOf(db, kind, i.categoryId)') >= 0, '「其他」桶下钻应只列无有效分类物品');
    console.log('PASS 5. ' + cur);
  }

  /* 6) pickRecord 新增带预填 */
  cur = '6. pickRecord「新增一条」带 presetMeal';
  {
    const src = JS('views-food.js');
    assert(/if \(rid === null\) openEditor\(dateStr, null, presetMeal\)/.test(src), '新增路径应传 presetMeal');
    console.log('PASS 6. ' + cur);
  }

  /* 7) 锚日跨天跟随 */
  cur = '7. 习惯卡锚日跨天跟随（未翻页时）';
  {
    const src = JS('views-home.js');
    assert(src.indexOf('habLastToday') >= 0, '应有跨天跟随锚');
    assert(/if \(habAnchor === habLastToday\) habAnchor = t;/.test(src), '未翻页时锚应随今天走');
    console.log('PASS 7. ' + cur);
  }

  console.log('========== v128-audit-fixes：7 项全部通过 ==========');
}

main().catch(function (e) {
  console.log('FAIL ' + cur + ': ' + (e && e.message || e));
  process.exit(1);
});
