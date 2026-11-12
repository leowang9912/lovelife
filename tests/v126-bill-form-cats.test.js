/* v126-bill-form-cats.test.js — v1.1.9 记一笔表单改造 + 分类屏蔽 回归锁：
   1) 类型切换（支出/收入/转账）在弹窗标题旁（modal-head 内 headExtra），不折行（seg-btn nowrap）
   2) 第二行=日期/时间/账户，左对齐（yw-top-right 不再右推）
   3) 分类屏蔽：设置里屏蔽 → 记账表单不显示该分类；恢复 → 重新显示
   4) 屏蔽不影响历史：已有账单的分类名照常展示（列表/详情不查 hiddenWcats）
   5) 屏蔽状态持久化 settings.hiddenWcats + 一览弱化标记 */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWindow, waitFor, waitMain, lastModal, waitNoModal, assert } = require('./helpers/harness');

let cur = '';

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const WCATS = {
  expense: [
    { id: 'w_food', name: '食品餐饮', icon: 'x', children: [{ id: 'w_food_lunch', name: '午餐', icon: 'x' }, { id: 'w_food_dinner', name: '晚餐', icon: 'x' }] },
    { id: 'w_shop', name: '购物消费', icon: 'x', children: [{ id: 'w_shop_digital', name: '手机数码', icon: 'x' }] }
  ],
  income: []
};

async function openBillForm(w) {
  const doc = w.document;
  const btn = doc.querySelector('#btn-add-bill');
  if (!btn) throw new Error('找不到记一笔按钮');
  btn.click();
  await waitFor(function () { return lastModal(doc) ? true : null; }, { label: '记一笔弹窗未打开' });
  return lastModal(doc);
}

async function main() {
  const today = ymd(new Date());

  /* 1)+2) 表单头布局 */
  cur = '1. 类型切换在标题旁 + 第二行左对齐';
  {
    const w = makeWindow({
      data: {
        wallet: { cats: WCATS, bills: [], accounts: [{ id: 'a1', name: '现金', balance: 100 }] },
        settings: {}
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    w.App.go('wallet');
    await waitFor(function () { return w.document.querySelector('#btn-add-bill') ? true : null; }, { label: '钱袋页未渲染' });
    const m = await openBillForm(w);
    const head = m.querySelector('.modal-head');
    assert(head.querySelector('.yw-type .seg-btn'), '类型切换应在标题旁（modal-head 内）');
    assert(head.querySelectorAll('[data-bft]').length === 3, '应有 支出/收入/转账 三档');
    const seg = head.querySelector('.yw-type');
    assert(seg, '标题旁应有 seg-toggle 容器');
    assert(m.querySelector('.yw-top-right'), '第二行应有日期/时间/账户容器');
    assert(!m.querySelector('.yw-top .yw-type'), '类型切换不应再占 body 独立行');
    // CSS：seg-btn 不折行 + 第二行左对齐 + 关闭钮恒最右
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'css', 'extra.css'), 'utf8');
    assert(/\.seg-btn\s*\{[^}]*white-space:\s*nowrap/.test(css), 'seg-btn 应 nowrap（防折行）');
    assert(!/\.yw-top-right\s*\{\s*margin-left:\s*auto/.test(css), 'yw-top-right 不应再右推（左对齐）');
    assert(/\.modal-close\s*\{\s*margin-left:\s*auto/.test(css), 'modal-close 应恒最右');
    console.log('PASS 1. ' + cur);
  }

  /* 3) 分类屏蔽 */
  cur = '2. 分类屏蔽：屏蔽后记账表单不显示，恢复后显示';
  {
    const w = makeWindow({
      data: {
        wallet: { cats: WCATS, bills: [], accounts: [{ id: 'a1', name: '现金', balance: 100 }] },
        settings: { hiddenWcats: ['w_food_dinner'] }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    w.App.go('wallet');
    await waitFor(function () { return w.document.querySelector('#btn-add-bill') ? true : null; }, { label: '钱袋页未渲染' });
    const m = await openBillForm(w);
    await waitFor(function () {
      return m.querySelector('.yw-cat-grid') ? true : null;
    }, { label: '分类区未渲染' });
    assert(!m.querySelector('[data-sub="w_food_dinner"]'), '被屏蔽子类不应出现在记账表单');
    assert(m.querySelector('[data-sub="w_food_lunch"]'), '未屏蔽子类应正常显示');
    // 一级屏蔽
    w.Storage.getDB().settings.hiddenWcats = ['w_shop'];
    const m2 = await (async function () {
      const btn = m.querySelector('.modal-close');
      if (btn) btn.click();
      await waitNoModal(w.document);
      return openBillForm(w);
    })();
    await waitFor(function () {
      return m2.querySelector('.yw-cat-tabs') ? true : null;
    }, { label: '分类区未渲染 2' });
    assert(!m2.querySelector('[data-parent="w_shop"]'), '被屏蔽一级不应出现在记账表单');
    assert(m2.querySelector('[data-parent="w_food"]'), '未屏蔽一级应正常显示');
    console.log('PASS 2. ' + cur);
  }

  /* 4) 历史不受影响 */
  cur = '3. 屏蔽不影响历史账单展示';
  {
    const w = makeWindow({
      data: {
        wallet: {
          cats: WCATS,
          bills: [{ id: 'b1', type: 'expense', amount: 30, date: today, catId: 'w_food', subCatId: 'w_food_dinner', accountId: '', note: '晚饭' }],
          accounts: []
        },
        settings: { hiddenWcats: ['w_food_dinner', 'w_food'] }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    w.App.go('wallet');
    await waitFor(function () {
      return w.document.querySelector('#wallet-body') ? true : null;
    }, { label: '钱袋页未渲染' });
    const html = w.document.getElementById('main-content').innerHTML;
    assert(html.indexOf('晚餐') >= 0 || html.indexOf('晚饭') >= 0, '已有账单的分类/备注应照常展示（屏蔽只影响新建表单）');
    console.log('PASS 3. ' + cur);
  }

  /* 5) 设置一览弱化+持久化 */
  cur = '4. 设置分类一览：屏蔽开关 + 弱化标记 + 持久化 hiddenWcats';
  {
    const w = makeWindow({
      data: {
        wallet: { cats: WCATS, bills: [], accounts: [] },
        settings: { hiddenWcats: ['w_food_dinner'] }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    w.App.go('settings');
    await waitFor(function () {
      return w.document.querySelector('[data-wcat-hide]') ? true : null;
    }, { label: '分类一览未渲染屏蔽开关' });
    const doc = w.document;
    const hideBtns = doc.querySelectorAll('[data-wcat-hide]');
    assert(hideBtns.length >= 4, '一级/子类都应有屏蔽开关，实为 ' + hideBtns.length);
    assert(doc.querySelector('.ycat-chip.wcat-hidden, .ycat-row.wcat-hidden'), '被屏蔽分类应弱化标记（v1.1.9 chip 流）');
    // 点屏蔽开关切换并落库
    const lunch = doc.querySelector('[data-wcat-hide="w_food_lunch"]');
    lunch.click();
    await waitFor(function () {
      return (w.Storage.getDB().settings.hiddenWcats || []).indexOf('w_food_lunch') >= 0 ? true : null;
    }, { label: '屏蔽未持久化' });
    console.log('PASS 4. ' + cur);
  }

  /* 6) 模板下拉清单（方案 A） */
  cur = '5. 模板下拉清单：套用模板 ▾ + 摘要 chip + 默认可读名';
  {
    const w = makeWindow({
      data: {
        wallet: {
          cats: WCATS,
          bills: [{ id: 'b1', type: 'expense', amount: 3000, date: today, catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '房租' }],
          accounts: [],
          templates: [{ id: 't1', name: '食品餐饮 · ¥3,000', type: 'expense', catId: 'w_food', subCatId: 'w_food_lunch', amount: 3000, note: '房租', accountId: '' }]
        },
        settings: {}
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    w.App.go('wallet');
    await waitFor(function () { return w.document.querySelector('#btn-add-bill') ? true : null; }, { label: '钱袋页未渲染' });
    const m = await openBillForm(w);
    await waitFor(function () {
      return m.querySelector('#yw-tpl-pick') && m.querySelector('#yw-tpl-pop') ? true : null;
    }, { label: '模板下拉未渲染' });
    const pop = m.querySelector('#yw-tpl-pop');
    assert(pop.hidden, '清单默认收起');
    const item = pop.querySelector('.yw-tpl-item');
    assert(item.textContent.indexOf('食品餐饮') >= 0 && item.textContent.indexOf('3,000') >= 0, '清单行应含分类与金额');
    m.querySelector('#yw-tpl-pick').click();
    assert(!pop.hidden, '点「套用模板 ▾」应展开清单');
    item.click();
    await waitFor(function () {
      return m.querySelector('.yw-tpl-on') ? true : null;
    }, { label: '套用后摘要 chip 未出现' });
    const chip = m.querySelector('.yw-tpl-on');
    assert(chip.textContent.indexOf('食品餐饮') >= 0 && chip.textContent.indexOf('3,000') >= 0, '摘要 chip 应含分类·金额');
    assert(m.querySelector('#yw-amt').value === '3000', '点行应填充金额');
    m.querySelector('#yw-tpl-clear').click();
    await waitFor(function () {
      return !m.querySelector('.yw-tpl-on') ? true : null;
    }, { label: '× 移除套用未生效' });
    console.log('PASS 5. ' + cur);
  }

  /* 7) hover 操作统一规格（v1.1.9 全站） */
  cur = '6. hover 操作规格：op-float 预留槽+右划入 + focus-within + 触屏常驻';
  {
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'css', 'extra.css'), 'utf8');
    const floatBlock = css.match(/\n\.op-float\s*\{[^}]+\}/);
    assert(floatBlock, '缺 .op-float 槽');
    assert(/opacity:\s*0/.test(floatBlock[0]) && /translateX\(6px\)/.test(floatBlock[0]), '槽应默认透明+右划入动效');
    assert(/flex:\s*none/.test(floatBlock[0]) && !/position:\s*absolute/.test(floatBlock[0]),
      '槽应占位对齐（flex:none，不得 absolute 盖内容）');
    assert(/\.op-host:hover\s*>\s*\.op-float/.test(css) && /:focus-within\s*>\s*\.op-float/.test(css), 'hover/focus-within 应触发划入');
    assert(/@media\s*\(hover:\s*none\)/.test(css), '触屏应常驻兜底');
    // 七处宿主已挂 op-host（账号/美食/穿搭/使用记录/组合/标签库×2/标签chip）
    const files = ['views-settings.js', 'views-food.js', 'views-main.js', 'ui.js'];
    let hosts = 0;
    files.forEach(function (f) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'js', f), 'utf8');
      hosts += (src.match(/op-host/g) || []).length;
    });
    assert(hosts >= 8, '八处宿主应挂 op-host，实为 ' + hosts);
    console.log('PASS 6. ' + cur);
  }

  console.log('========== v126-bill-form-cats：6 项全部通过 ==========');
}

main().catch(function (e) {
  console.log('FAIL ' + cur + ': ' + (e && e.message || e));
  process.exit(1);
});
