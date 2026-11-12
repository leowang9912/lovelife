/* v130-sidebar.test.js — v1.2.01 侧栏导航改造回归锁：
   1) 设置「侧栏导航」：排序+屏蔽任意模块（settings 不可屏蔽）；无用备注已删
   2) 屏蔽实时起效：屏蔽后侧栏该项消失，恢复后回来（navHidden 持久）
   3) 图标模式：拖拽低于阈值吸到 64px 纯图标（side-icon-only），双击恢复
   4) 图标模式 CSS：文字隐藏+图标居中+title 提示齐备 */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWindow, waitFor, waitMain, assert } = require('./helpers/harness');

let cur = '';

async function main() {
  /* 1) 设置侧栏导航 */
  cur = '1. 设置「侧栏导航」：排序+屏蔽（settings 固定）+备注已删';
  {
    const w = makeWindow({ data: { settings: {} } });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('settings');
    await waitFor(function () {
      return doc.querySelector('#nav-order-list [data-nav-hide]') ? true : null;
    }, { label: '侧栏导航区未渲染' });
    const rows = doc.querySelectorAll('#nav-order-list .mini-row');
    assert(rows.length >= 6, '应含各导航项，实为 ' + rows.length);
    // settings 行无屏蔽按钮（常驻），其余有
    const html = doc.getElementById('nav-order-list').innerHTML;
    assert(html.indexOf('data-nav-hide') >= 0, '应有屏蔽开关');
    assert(!/data-nav-hide="settings"/.test(html), 'settings 不可屏蔽');
    // 备注已删
    const page = doc.getElementById('main-content').innerHTML;
    assert(page.indexOf('调整左侧各栏目的显示顺序') < 0, '无用备注应已删');
    assert(page.indexOf('屏蔽后该板块整体从「我的统计」隐藏') < 0, '板块备注应已删');
    console.log('PASS 1. ' + cur);
  }

  /* 2) 屏蔽实时起效 */
  cur = '2. 屏蔽实时起效（侧栏即时消失/恢复）';
  {
    const w = makeWindow({ data: { settings: {} } });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('settings');
    await waitFor(function () {
      return doc.querySelector('#nav-order-list [data-nav-hide]') ? true : null;
    }, { label: '侧栏导航区未渲染' });
    // 侧栏当前含「我的统计」
    assert(doc.querySelector('.sidebar [data-nav=plan]'), '侧栏应有我的统计');
    doc.querySelector('#nav-order-list [data-nav-hide="plan"]').click();
    await waitFor(function () {
      return !doc.querySelector('.sidebar [data-nav=plan]') ? true : null;
    }, { label: '屏蔽后侧栏未实时隐藏' });
    assert(w.Storage.getDB().settings.navHidden.indexOf('plan') >= 0, 'navHidden 应持久');
    // 恢复
    const box = doc.getElementById('nav-order-list');
    const unhide = Array.prototype.filter.call(box.querySelectorAll('[data-nav-hide]'), function (b) {
      return b.getAttribute('data-nav-hide') === 'plan';
    })[0];
    unhide.click();
    await waitFor(function () {
      return doc.querySelector('.sidebar [data-nav=plan]') ? true : null;
    }, { label: '恢复后侧栏未实时回来' });
    console.log('PASS 2. ' + cur);
  }

  /* 3) 图标模式 */
  cur = '3. 拖拽阈值吸图标模式（64px）+ 双击恢复';
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'app.js'), 'utf8');
    assert(/const ICON_W = 64, TOGGLE_AT = 165, MAX = 300, DEF = 175/.test(src), '应有图标模式阈值（165→64，默认宽 175）');
    assert(/if \(w < TOGGLE_AT\) w = ICON_W;/.test(src), '低于阈值应吸到 64px');
    assert(/classList\.toggle\('side-icon-only', w === ICON_W\)/.test(src), '拖拽应切换 side-icon-only');
    assert(/classList\.remove\('side-icon-only'\)/.test(src), '双击恢复应清图标模式');
    assert(/classList\.toggle\('side-icon-only', savedW < 165\)/.test(src), '重载应恢复图标模式');
    console.log('PASS 3. ' + cur);
  }

  /* 4) 图标模式 CSS */
  cur = '4. 图标模式 CSS（文字隐藏/图标居中/title 提示）';
  {
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'css', 'extra.css'), 'utf8');
    assert(/\.side-icon-only \.sidebar\s*\{\s*width:\s*64px/.test(css), '图标模式宽 64px');
    assert(/\.side-icon-only \.nav-item > span:not\(\.nav-icon\)\s*\{\s*display:\s*none/.test(css), '文字应隐藏');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'app.js'), 'utf8');
    assert(/data-nav="' \+ n\.id \+ '" title=/.test(src), 'nav 项应带 title（图标模式悬停提示）');
    console.log('PASS 4. ' + cur);
  }

  cur = '5. 新模块按 NAV 原位置插入（不垫底，设置列表=侧栏同源）';
  {
    const w = makeWindow({
      data: {
        settings: {
          // 历史自定义序（无 timeline）：时间日历应插到「我的统计」之后而非垫底
          navOrder: ['home', 'plan', 'digital', 'clothing', 'life', 'wallet', 'outfits', 'food', 'settings']
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const ids = w.App.navOrdered(w.Storage.getDB()).map(function (n) { return n.id; });
    assert(ids.indexOf('timeline') === ids.indexOf('plan') + 1, '时间日历应紧随我的统计: ' + ids.join(','));
    assert(ids[ids.length - 1] === 'settings', '设置应在尾部');
    console.log('PASS 5. ' + cur);
  }

  console.log('========== v130-sidebar：5 项全部通过 ==========');
}

main().catch(function (e) {
  console.log('FAIL ' + cur + ': ' + (e && e.message || e));
  process.exit(1);
});
