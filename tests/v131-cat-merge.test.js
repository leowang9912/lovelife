/* v131-cat-merge.test.js — v1.2.01 分类聚类与排序（仅分类统计）回归锁：
   1) 齿轮弹窗 + 行内新建组（零嵌套弹窗）+ 下拉「＋ 新建组…」归入 + 保存 → 环图按组合并聚合
   2) 组上移/下移 → 环图按组顺序（不按金额）
   3) 口径切回「按分类」+ soloOrder 数据层兼容（旧配置仍生效）
   4) 恢复默认两段式清空（不弹 confirmDialog）*/
'use strict';
const { makeWindow, waitFor, waitMain, lastModal, waitNoModal, assert } = require('./helpers/harness');

let cur = '';

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function main() {
  const today = ymd(new Date());
  const BILLS = [
    { id: 'b1', type: 'expense', amount: 100, date: today, catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '手机' },
    { id: 'b2', type: 'expense', amount: 200, date: today, catId: 'w_shop', subCatId: 'w_shop_appliance', accountId: '', note: '电器' },
    { id: 'b3', type: 'expense', amount: 50, date: today, catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '午饭' },
    { id: 'b4', type: 'expense', amount: 30, date: today, catId: 'w_food', subCatId: 'w_food_fruit', accountId: '', note: '水果' }
  ];
  const CATS = {
    expense: [
      { id: 'w_shop', name: '购物消费', icon: 'x', children: [
        { id: 'w_shop_digital', name: '手机数码', icon: 'x' },
        { id: 'w_shop_appliance', name: '生活电器', icon: 'x' }
      ] },
      { id: 'w_food', name: '食品餐饮', icon: 'x', children: [
        { id: 'w_food_lunch', name: '午餐', icon: 'x' },
        { id: 'w_food_fruit', name: '水果', icon: 'x' }
      ] }
    ],
    income: []
  };

  /* 1) 弹窗 + 行内新建组 + 下拉归入 + 保存聚合 */
  cur = '1. 行内新建组（零嵌套）+ 下拉归组 + 合并聚合';
  {
    const w = makeWindow({
      data: {
        wallet: { cats: CATS, bills: BILLS.slice(), accounts: [] },
        settings: {}
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('plan');
    await waitFor(function () {
      return doc.querySelector('[data-cat-merge]') ? true : null;
    }, { label: '齿轮入口未渲染' });
    doc.querySelector('[data-cat-merge]').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#cmg-tree') ? m : null;
    }, { label: '聚类弹窗未打开' });
    const m = lastModal(doc);
    assert(m.querySelector('.cmg-left') && m.querySelector('.cmg-right'), '应为双栏布局');
    assert(m.querySelector('input[name=cmg-mode][value=group]'), '应有按合并组口径');
    assert(m.querySelector('.cmg-note'), '应有说明文案');
    assert(!m.querySelector('#cmg-solo'), '独立分类顺序区已按用户拍板移除');
    // 新建组：行内直接建卡（禁止再弹嵌套命名弹窗）
    const modalCountBefore = doc.querySelectorAll('.modal-mask').length;
    m.querySelector('#cmg-add').click();
    await waitFor(function () {
      return m.querySelector('.cmg-group') ? true : null;
    }, { label: '新建组未出现' });
    assert(doc.querySelectorAll('.modal-mask').length === modalCountBefore, '新建组不应再弹嵌套弹窗');
    const g1 = m.querySelector('.cmg-group');
    assert(g1.querySelector('.cmg-gname'), '组卡应带名称输入框（就地改名）');
    // 组名就地改
    const nameInp = g1.querySelector('.cmg-gname');
    nameInp.value = '电子';
    nameInp.dispatchEvent(new w.Event('input', { bubbles: true }));
    // 左栏两个分类归入该组（每步重查节点：renderTree 重建后旧 select 脱钩）
    ['w_shop_digital', 'w_shop_appliance'].forEach(function (cid) {
      const sel = m.querySelector('[data-cmg-assign="' + cid + '"]');
      sel.value = m.querySelector('.cmg-group').getAttribute('data-cmg-g');
      sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    });
    // DOM 成员 chip 必须真实渲染（v1.2.01 真机"归组后组卡不更新"炸点：跨文件 findWalletCat ReferenceError
    // 曾在 renderGroups 抛错中断重渲——内存态断言拦不住，必须断言 DOM 文本）
    await waitFor(function () {
      const mm = m.querySelector('.cmg-members');
      return mm && mm.textContent.indexOf('手机数码') >= 0 && mm.textContent.indexOf('生活电器') >= 0 ? true : null;
    }, { label: '组卡成员 chip 未渲染' });
    // 下拉「＋ 新建组…」：直接建组归入（零嵌套）
    const selFood = m.querySelector('[data-cmg-assign="w_food_lunch"]');
    selFood.value = '__new__';
    selFood.dispatchEvent(new w.Event('change', { bubbles: true }));
    await waitFor(function () {
      return m.querySelectorAll('.cmg-group').length === 2 ? true : null;
    }, { label: '下拉新建组未生效' });
    assert(doc.querySelectorAll('.modal-mask').length === modalCountBefore, '下拉新建组不应弹嵌套弹窗');
    // 切口径到按合并组+保存
    m.querySelector('input[name=cmg-mode][value=group]').checked = true;
    m.querySelector('input[name=cmg-mode][value=group]').dispatchEvent(new w.Event('change', { bubbles: true }));
    m.querySelector('[data-x=s]').click();
    // 保存应立即落内存（不 await 网络）
    assert(w.Storage.getDB().settings.catMerge && w.Storage.getDB().settings.catMerge.enabled, '保存应立即写内存 catMerge');
    await waitFor(function () {
      return w.Storage.getDB().settings.catMerge.groups.length === 2 ? true : null;
    }, { label: '合并组未保存' });
    const mg = w.Storage.getDB().settings.catMerge;
    assert(mg.groups.length === 2, '应两组: ' + JSON.stringify(mg.groups));
    assert(mg.groups[0].members.length === 2 && mg.groups[1].members.length === 1, '组成员数应为 2+1');
    // 环图按组聚合：分类统计含「电子」且两分类合一（金额 300）
    await waitFor(function () {
      const body = doc.querySelector('[data-body=wCatPie]');
      return body && body.textContent.indexOf('电子') >= 0 ? true : null;
    }, { label: '环图未按组合并' });
    const pie = doc.querySelector('[data-body=wCatPie]');
    assert(pie.textContent.indexOf('电子') >= 0, '环图应含合并组名');
    assert(pie.textContent.indexOf('300') >= 0, '组金额应为 300（100+200）');
    assert(pie.textContent.indexOf('手机数码') < 0, '合并后不单显子分类');
    console.log('PASS 1. ' + cur);
  }

  /* 2) 组排序：上移/下移 → 环图顺序 */
  cur = '2. 组排序 + 独立分类排序 → 环图自定义顺序';
  {
    const w = makeWindow({
      data: {
        wallet: { cats: CATS, bills: BILLS.slice(), accounts: [] },
        settings: {
          catMerge: {
            enabled: true,
            groups: [
              { id: 'g1', name: '电子', members: ['w_shop_digital', 'w_shop_appliance'] },
              { id: 'g2', name: '吃喝', members: ['w_food_lunch'] }
            ],
            soloOrder: []
          }
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('plan');
    // 初始：电子(300) 金额高于 吃喝(50)，但 groups 顺序=电子在前 → 环图顺序 电子→吃喝→水果
    await waitFor(function () {
      const body = doc.querySelector('[data-body=wCatPie]');
      return body && body.textContent.indexOf('电子') >= 0 ? true : null;
    }, { label: '环图未渲染' });
    let pie = doc.querySelector('[data-body=wCatPie]');
    let t = pie.textContent;
    assert(t.indexOf('电子') < t.indexOf('吃喝'), '默认组顺序应为 电子→吃喝');
    // 弹窗里把「吃喝」上移 → 顺序反转
    doc.querySelector('[data-cat-merge]').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#cmg-groups') ? m : null;
    }, { label: '弹窗未打开' });
    let m = lastModal(doc);
    const upBtn = m.querySelectorAll('[data-cmg-move="up"]')[1]; // 第二组的上移
    upBtn.click();
    const groupNames = Array.prototype.map.call(m.querySelectorAll('.cmg-gname'), function (x) { return x.value; });
    assert(groupNames[0] === '吃喝' && groupNames[1] === '电子', '上移后组顺序应为 吃喝→电子: ' + groupNames.join(','));
    // 保存 → 环图顺序 反转
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      const body = doc.querySelector('[data-body=wCatPie]');
      return body && body.textContent.indexOf('吃喝') < body.textContent.indexOf('电子') ? true : null;
    }, { label: '环图顺序未按排序更新' });
    pie = doc.querySelector('[data-body=wCatPie]');
    t = pie.textContent;
    assert(t.indexOf('吃喝') < t.indexOf('电子'), '排序后应为 吃喝→电子');
    console.log('PASS 2. ' + cur);
  }

  /* 2b) 独立分类排序（按分类口径）：金额排序 vs 自定义顺序 */
  cur = '3. soloOrder 数据层兼容（按分类口径）';
  {
    const w = makeWindow({
      data: {
        wallet: { cats: CATS, bills: BILLS.slice(), accounts: [] },
        settings: {
          catMerge: {
            enabled: false,
            groups: [],
            // 金额上 水果(50) > 其他独立？——手机数码100/生活电器200/午餐50/水果30：
            // soloOrder 强制 水果 在 最前（即便金额最小）
            soloOrder: ['w_food_fruit', 'w_shop_digital', 'w_shop_appliance', 'w_food_lunch']
          }
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('plan');
    await waitFor(function () {
      const body = doc.querySelector('[data-body=wCatPie]');
      return body && body.textContent.indexOf('水果') >= 0 ? true : null;
    }, { label: '环图未渲染' });
    const t = doc.querySelector('[data-body=wCatPie]').textContent;
    assert(t.indexOf('水果') < t.indexOf('手机数码'), 'soloOrder 应让水果排最前: ' + t.slice(0, 120));
    assert(t.indexOf('手机数码') < t.indexOf('生活电器'), '后续按 soloOrder: ' + t.slice(0, 120));
    console.log('PASS 3. ' + cur);
  }

  /* 4) 口径切回 + 恢复默认两段式 */
  cur = '4. 口径切回 + 恢复默认两段式清空';
  {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'app', 'js', 'views-wallet.js'), 'utf8');
    assert(src.indexOf('soloOrder: [] })') >= 0 || src.indexOf("soloOrder: [] }") >= 0, '恢复默认应清空 soloOrder');
    assert(src.indexOf('确认清空？') >= 0, '恢复默认应为两段式确认（不弹 confirmDialog）');
    assert(src.indexOf('openCatMergeDialog: openCatMergeDialog') >= 0, '应导出 openCatMergeDialog');
    // 行为锁：点一次变「确认清空？」，再点清空
    const w = makeWindow({
      data: {
        wallet: { cats: CATS, bills: BILLS.slice(), accounts: [] },
        settings: {
          catMerge: {
            enabled: true,
            groups: [{ id: 'g1', name: '电子', members: ['w_shop_digital'] }],
            soloOrder: ['w_food_fruit']
          }
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('plan');
    await waitFor(function () { return doc.querySelector('[data-cat-merge]') ? true : null; }, { label: '齿轮未渲染' });
    doc.querySelector('[data-cat-merge]').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('[data-x=restore]') ? m : null;
    }, { label: '弹窗未打开' });
    const m = lastModal(doc);
    const rb = m.querySelector('[data-x=restore]');
    const modalCount = doc.querySelectorAll('.modal-mask').length;
    rb.click();
    assert(rb.textContent.indexOf('确认清空') >= 0, '第一次点应变两段式确认');
    assert(doc.querySelectorAll('.modal-mask').length === modalCount, '不应弹 confirmDialog');
    rb.click();
    assert(!w.Storage.getDB().settings.catMerge.groups.length, '再点应清空合并组');
    assert(!w.Storage.getDB().settings.catMerge.soloOrder.length, '再点应清空 soloOrder');
    assert(w.Storage.getDB().settings.catMerge.enabled === false, '再点应关合并口径');
    console.log('PASS 4. ' + cur);
  }

  console.log('========== v131-cat-merge：4 项全部通过 ==========');
}

main().catch(function (e) {
  console.log('FAIL ' + cur + ': ' + (e && e.message || e));
  process.exit(1);
});
