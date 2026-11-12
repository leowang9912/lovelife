/* v122-plan-tabs.test.js — v1.1.8 统计页分类切换（对齐设置页 stab 格式）回归锁：
   1) 分类 tab 栏结构：settings-tabs + 4 个 stab-btn（图标+块名），默认 overall 选中
   2) 板块显隐：仅当前分类 plan-block 带 stab-on（CSS 专属规则隐藏其余）
   3) 点击切换：块显隐 + 按钮 on 同步；只换显隐不重渲染（panel-body 同元素引用）
   4) 会话记忆：切走再回统计页仍停在上次分类（对齐设置页 curStab 行为）
   5) 屏蔽块兼容：tab 仍在，块内空态卡 + 恢复按钮
   6) 编辑模式（栏目设置）下分类切换照常工作
   7) CSS 防特异度打架：显隐走 .plan-block[data-stab]:not(.stab-on) 专属规则（勿用 .stab 通用类） */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWindow, waitFor, waitMain, assert } = require('./helpers/harness');

let cur = '';

async function openPlan(w) {
  const doc = w.document;
  if (!doc.querySelector('#plan-wrap')) {
    w.App.go('plan');
    await waitFor(function () { return !!doc.querySelector('#plan-wrap'); }, { label: '统计页加载' });
  }
  return doc;
}

function tabBtns(doc) {
  return Array.prototype.slice.call(doc.querySelectorAll('[data-plan-stab]'));
}
function blockOf(doc, id) {
  return doc.querySelector('.plan-block[data-stab="' + id + '"]');
}

async function main() {
  /* 1) tab 结构 */
  cur = '1. 分类 tab 栏：settings-tabs + 4 个 stab-btn（图标+块名），默认 overall';
  {
    const w = makeWindow({ data: { items: [], wallet: { cats: { expense: [], income: [] }, bills: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    const tabs = doc.querySelector('.settings-tabs.plan-tabs');
    assert(tabs, '应有分类 tab 栏（settings-tabs plan-tabs，与设置页同款）');
    const btns = tabBtns(doc);
    assert(btns.length === 7, '7 个分类 tab（总体/数码/衣橱/生活/习惯/时间/美食）: ' + btns.length);
    const ids = btns.map(function (b) { return b.getAttribute('data-plan-stab'); });
    assert(ids.join(',') === 'overall,digital,clothing,life,habit,time,food', 'tab 顺序/标识: ' + ids);
    ['总体统计', '我的数码', '我的衣橱', '我的生活', '习惯打卡', '时间统计', '我的美食'].forEach(function (name, i) {
      assert(btns[i].textContent.indexOf(name) >= 0, 'tab 文字缺 ' + name);
      assert(btns[i].querySelector('svg'), 'tab 应带图标: ' + name);
    });
    assert(btns[0].classList.contains('on'), '默认 overall 选中');
    console.log('PASS 1. ' + cur);
  }

  /* 2) 板块显隐 */
  cur = '2. 板块显隐：仅当前分类 plan-block 带 stab-on';
  {
    const w = makeWindow({ data: { items: [], wallet: { cats: { expense: [], income: [] }, bills: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    ['overall', 'digital', 'clothing', 'life', 'habit', 'food'].forEach(function (id) {
      const el = blockOf(doc, id);
      assert(el, '缺板块 ' + id);
      if (id === 'overall') {
        assert(el.classList.contains('stab-on'), '当前分类 overall 应带 stab-on');
      } else {
        assert(!el.classList.contains('stab-on'), '非当前分类 ' + id + ' 不应带 stab-on');
      }
    });
    console.log('PASS 2. ' + cur);
  }

  /* 3) 点击切换：显隐 + on 同步 + 不重渲染 */
  cur = '3. 点击切换：块显隐/按钮 on 同步，只换显隐不重渲染';
  {
    const w = makeWindow({ data: { items: [], wallet: { cats: { expense: [], income: [] }, bills: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    const kpiBefore = blockOf(doc, 'overall').querySelector('[data-body]');
    tabBtns(doc)[1].click(); // 我的数码
    assert(blockOf(doc, 'digital').classList.contains('stab-on'), '点后 digital 应显示');
    assert(!blockOf(doc, 'overall').classList.contains('stab-on'), '点后 overall 应隐藏');
    assert(tabBtns(doc)[1].classList.contains('on') && !tabBtns(doc)[0].classList.contains('on'), '按钮 on 同步');
    const kpiAfter = blockOf(doc, 'overall').querySelector('[data-body]');
    assert(kpiBefore === kpiAfter, '切换只换显隐，panel-body 不得重渲染（同元素引用）');
    console.log('PASS 3. ' + cur);
  }

  /* 4) 会话记忆 */
  cur = '4. 会话记忆：切走再回统计页仍停在上次分类';
  {
    const w = makeWindow({ data: { items: [], wallet: { cats: { expense: [], income: [] }, bills: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    tabBtns(doc)[3].click(); // 我的生活
    w.App.go('home');
    await waitFor(function () { return !doc.querySelector('#plan-wrap'); }, { label: '离开统计页' });
    await openPlan(w);
    assert(blockOf(doc, 'life').classList.contains('stab-on'), '回访应停在「我的生活」');
    assert(tabBtns(doc)[3].classList.contains('on'), 'tab on 跟随记忆');
    console.log('PASS 4. ' + cur);
  }

  /* 5) 屏蔽块兼容 */
  cur = '5. 屏蔽块兼容：tab 仍在，块内空态卡 + 恢复按钮';
  {
    const w = makeWindow({
      data: {
        items: [], wallet: { cats: { expense: [], income: [] }, bills: [] },
        settings: { planBlocks: { clothing: false } }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    const btns = tabBtns(doc);
    const ci = btns.map(function (b) { return b.getAttribute('data-plan-stab'); }).indexOf('clothing');
    assert(ci >= 0, '屏蔽块 tab 不得消失');
    btns[ci].click();
    const el = blockOf(doc, 'clothing');
    assert(el.classList.contains('block-off'), '屏蔽块应带 block-off');
    assert(el.querySelector('[data-block-toggle]'), '空态卡应带恢复按钮');
    console.log('PASS 5. ' + cur);
  }

  /* 6) 编辑模式兼容 */
  cur = '6. 编辑模式（栏目设置）下分类切换照常';
  {
    const w = makeWindow({ data: { items: [], wallet: { cats: { expense: [], income: [] }, bills: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    doc.querySelector('#btn-edit-sections').click();
    await waitFor(function () { return !!doc.querySelector('.sec-ctrl'); }, { label: '进入编辑模式' });
    assert(doc.querySelector('.settings-tabs.plan-tabs'), '编辑模式下 tab 栏仍在');
    tabBtns(doc)[1].click();
    assert(blockOf(doc, 'digital').classList.contains('stab-on'), '编辑模式下切换生效');
    assert(!blockOf(doc, 'overall').classList.contains('stab-on'), '编辑模式下旧分类隐藏');
    console.log('PASS 6. ' + cur);
  }

  /* 7) CSS 专属规则（防特异度打架） */
  cur = '7. CSS 显隐走专属规则 .plan-block[data-stab]:not(.stab-on)';
  {
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'css', 'extra.css'), 'utf8');
    assert(/\.plan-block\[data-stab\]:not\(\.stab-on\)\s*\{\s*display:\s*none;/.test(css),
      '缺专属显隐规则（用 .stab 通用类会踩特异度打架）');
    console.log('PASS 7. ' + cur);
  }

  console.log('========== v122-plan-tabs：7 项全部通过 ==========');
}

main().catch(function (e) {
  console.log('FAIL ' + cur + ': ' + (e && e.message || e));
  process.exit(1);
});
