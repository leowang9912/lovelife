/* v117-sort-cat.test.js — v1.1.7 分类树序排序（sortKey='cat'）：
   按录入时的一级二级种类顺序（一级大类树序→二级子类树序），替代原 categoryId 字符串序。
   锁口径：
     ① 主序=一级大类数组序，次序=二级子类 children 数组序；
     ② 同大类内「无子类」物品在各子类之前（树深度优先）；再次=名称（localeCompare 'zh'）；
     ③ 分类归属与筛选同口径精确匹配（i.categoryId === catId || i.subCategoryId === catId）：
        categoryId 本身是二级 id 落该二级；categoryId 不在树但 subCategoryId 在树按兜底落位；
     ④ 跨域（两级 id 都不在树）恒排末尾，方向不影响；倒序=树序整体反转（跨域仍末位）；
     ⑤ 三页（数码/衣橱/生活）同一实现；其他排序键（价格等）与排序记忆（v108）不受影响。 */
'use strict';
const { makeWindow, waitFor, waitMain, assert } = require('./helpers/harness');

let cur = '';

function cardNames(doc) {
  return Array.prototype.map.call(doc.querySelectorAll('.item-card .item-name'), function (n) {
    return n.textContent.trim();
  });
}
function eqNames(got, expect, label) {
  assert(got.join(',') === expect.join(','),
    label + '：期望 [' + expect.join(',') + ']，实为 [' + got.join(',') + ']');
}

/* —— 分类树：数组序/children 序刻意与 id 字符串序相反，防旧实现蒙混过关 —— */
const CATS = {
  digital: [
    { id: 'z_host', name: '主机类', icon: 'laptop', children: [
      { id: 'z_tab', name: '平板' }, { id: 'z_phone', name: '手机' } ] },
    { id: 'a_game', name: '游戏类', icon: 'disc-3', children: [
      { id: 'a_ps', name: '主机游戏' } ] }
  ],
  clothing: [
    { id: 'z_top', name: '上装', icon: 'shirt', children: [
      { id: 'z_tee', name: 'T恤' }, { id: 'z_hoodie', name: '卫衣' } ] },
    { id: 'a_bottom', name: '下装', icon: 'pants', children: [
      { id: 'a_jeans', name: '牛仔裤' } ] }
  ],
  life: [
    { id: 'z_skin', name: '护肤', icon: 'heart', children: [
      { id: 'z_lip', name: '唇部' }, { id: 'z_cream', name: '面霜' } ] },
    { id: 'a_clean', name: '清洁', icon: 'sparkles', children: [] }
  ]
};

function item(id, kind, categoryId, subCategoryId, name, price) {
  return {
    id: id, kind: kind, categoryId: categoryId, subCategoryId: subCategoryId, name: name,
    purchaseDate: '2025-01-01', purchasePrice: price == null ? 100 : price,
    status: 'in_use', images: [], tags: []
  };
}

async function openPage(pageId, data) {
  const w = makeWindow({ data: Object.assign({ categories: CATS }, data) });
  if (!(await waitMain(w))) throw new Error('no main');
  w.App.go(pageId);
  return w;
}

async function setSort(w, doc, selId, key, dirBtnId) {
  const sel = await waitFor(function () { return doc.getElementById(selId); }, { label: selId + ' 未渲染' });
  sel.value = key;
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  if (dirBtnId) doc.getElementById(dirBtnId).click();
}

async function main() {
  // ============ 1 数码页：分类树序（device/game 混排、无子类在前、组内名称、跨域末位） ============
  cur = '1. 数码页分类树序：一级树序→二级树序→名称，无子类在前，跨域末位';
  {
    const w = await openPage('digital', {
      items: [
        item('d_tab2', 'device', 'z_host', 'z_tab', 'b-tab', 1),
        item('d_tab1', 'device', 'z_host', 'z_tab', 'a-tab', 2),
        item('d_phone', 'device', 'z_host', 'z_phone', 'a-phone', 3),
        item('d_nosub', 'device', 'z_host', null, 'a-nosub', 4),
        item('g_ps', 'game', 'a_game', 'a_ps', 'a-ps', 5),
        item('g_nosub', 'game', 'a_game', null, 'a-gamenosub', 6),
        item('d_ghost', 'device', 'gone', 'gone2', 'z-ghost', 7)
      ]
    });
    const doc = w.document;
    await setSort(w, doc, 'filter-sort', 'cat');
    await waitFor(function () {
      return cardNames(doc).length === 7 && cardNames(doc)[0] === 'a-nosub';
    }, { label: '数码页分类树序未生效' });
    eqNames(cardNames(doc),
      ['a-nosub', 'a-tab', 'b-tab', 'a-phone', 'a-gamenosub', 'a-ps', 'z-ghost'], '数码页正序');
  }
  console.log('PASS ' + cur);

  // ============ 2 倒序 = 树序整体反转；跨域仍恒末位 ============
  cur = '2. 倒序=树序整体反转，跨域仍恒末位';
  {
    const w = await openPage('digital', {
      items: [
        item('d_tab2', 'device', 'z_host', 'z_tab', 'b-tab', 1),
        item('d_tab1', 'device', 'z_host', 'z_tab', 'a-tab', 2),
        item('d_phone', 'device', 'z_host', 'z_phone', 'a-phone', 3),
        item('d_nosub', 'device', 'z_host', null, 'a-nosub', 4),
        item('g_ps', 'game', 'a_game', 'a_ps', 'a-ps', 5),
        item('g_nosub', 'game', 'a_game', null, 'a-gamenosub', 6),
        item('d_ghost', 'device', 'gone', 'gone2', 'z-ghost', 7)
      ]
    });
    const doc = w.document;
    await setSort(w, doc, 'filter-sort', 'cat', 'sort-dir'); // 选中后点一次方向 → 倒序
    await waitFor(function () {
      return cardNames(doc).length === 7 && cardNames(doc)[0] === 'a-ps';
    }, { label: '数码页倒序未生效' });
    eqNames(cardNames(doc),
      ['a-ps', 'a-gamenosub', 'a-phone', 'b-tab', 'a-tab', 'a-nosub', 'z-ghost'], '数码页倒序');
  }
  console.log('PASS ' + cur);

  // ============ 3 衣橱页：同规则 + 归属口径（categoryId 落二级 / subCategoryId 兜底） ============
  cur = '3. 衣橱页分类树序 + 精确归属口径（categoryId 落二级 / subCategoryId 兜底）';
  {
    const w = await openPage('clothing', {
      items: [
        item('c_teeA', 'clothing', 'z_top', 'z_tee', 'a-tee', 10),
        item('c_teeB', 'clothing', 'z_top', 'z_tee', 'b-tee', 20),
        item('c_catIsChild', 'clothing', 'z_tee', null, 'c-tee-moved', 70),   // categoryId 本身是二级 id
        item('c_hood', 'clothing', 'z_top', 'z_hoodie', 'd-hood', 30),
        item('c_subonly', 'clothing', 'junk', 'z_hoodie', 'e-hood-moved', 80), // subCategoryId 兜底
        item('c_nosub_z', 'clothing', 'z_top', null, 'f-nosub-top', 50),
        item('c_jeans', 'clothing', 'a_bottom', 'a_jeans', 'g-jeans', 40),
        item('c_nosub_a', 'clothing', 'a_bottom', null, 'h-nosub-bottom', 60),
        item('c_ghost', 'clothing', 'gone', 'gone2', 'i-ghost', 90)
      ]
    });
    const doc = w.document;
    await setSort(w, doc, 'filter-sort', 'cat');
    await waitFor(function () {
      return cardNames(doc).length === 9 && cardNames(doc)[0] === 'f-nosub-top';
    }, { label: '衣橱页分类树序未生效' });
    eqNames(cardNames(doc),
      ['f-nosub-top', 'a-tee', 'b-tee', 'c-tee-moved', 'd-hood', 'e-hood-moved', 'h-nosub-bottom', 'g-jeans', 'i-ghost'],
      '衣橱页正序');

    // 倒序（同窗再点方向键）
    doc.getElementById('sort-dir').click();
    await waitFor(function () { return cardNames(doc)[0] === 'g-jeans'; }, { label: '衣橱页倒序未生效' });
    eqNames(cardNames(doc),
      ['g-jeans', 'h-nosub-bottom', 'e-hood-moved', 'd-hood', 'c-tee-moved', 'b-tee', 'a-tee', 'f-nosub-top', 'i-ghost'],
      '衣橱页倒序');

    // 排序记忆（v108 口径）：选 cat 落盘 key/dir，切方向同步
    const saved = w.Storage.getDB().settings.listSort;
    assert(saved && saved.clothing && saved.clothing.key === 'cat' && saved.clothing.dir === -1,
      '排序记忆应为 cat/倒序，实为 ' + JSON.stringify(saved && saved.clothing));
  }
  console.log('PASS ' + cur);

  // ============ 4 生活页（LifeView 路径）同一实现生效 ============
  cur = '4. 生活页（LifeView 渲染路径）分类树序同样生效';
  {
    const w = await openPage('life', {
      items: [
        item('l_cream', 'life', 'z_skin', 'z_cream', 'b-cream', 1),
        item('l_lip', 'life', 'z_skin', 'z_lip', 'a-lip', 2),
        item('l_clean', 'life', 'a_clean', null, 'a-clean', 3),
        item('l_ghost', 'life', 'gone', null, 'z-ghost', 4)
      ]
    });
    const doc = w.document;
    await setSort(w, doc, 'life-sort', 'cat');
    await waitFor(function () {
      return cardNames(doc).length === 4 && cardNames(doc)[0] === 'a-lip';
    }, { label: '生活页分类树序未生效' });
    eqNames(cardNames(doc), ['a-lip', 'b-cream', 'a-clean', 'z-ghost'], '生活页正序');
  }
  console.log('PASS ' + cur);

  // ============ 5 筛选精确匹配（A11 口径）+ 分类树序组合 ============
  cur = '5. 筛选精确匹配（不列同父类）与分类树序组合';
  {
    const w = await openPage('clothing', {
      items: [
        item('c_teeA', 'clothing', 'z_top', 'z_tee', 'a-tee', 10),
        item('c_teeB', 'clothing', 'z_top', 'z_tee', 'b-tee', 20),
        item('c_catIsChild', 'clothing', 'z_tee', null, 'c-tee-moved', 70),
        item('c_hood', 'clothing', 'z_top', 'z_hoodie', 'd-hood', 30),
        item('c_subonly', 'clothing', 'junk', 'z_hoodie', 'e-hood-moved', 80),
        item('c_nosub_z', 'clothing', 'z_top', null, 'f-nosub-top', 50)
      ]
    });
    const doc = w.document;
    await setSort(w, doc, 'filter-sort', 'cat');
    await waitFor(function () { return cardNames(doc).length === 6; }, { label: '衣橱列表未渲染' });

    // 选二级 z_tee：只列 categoryId/subCategoryId 精确命中的（含 categoryId 落二级的录入错位项）
    const catSel = await waitFor(function () { return doc.getElementById('filter-cat'); }, { label: '筛选下拉未渲染' });
    catSel.value = 'z_tee';
    catSel.dispatchEvent(new w.Event('change', { bubbles: true }));
    await waitFor(function () { return cardNames(doc).length === 3; }, { label: '二级筛选结果数不符' });
    eqNames(cardNames(doc), ['a-tee', 'b-tee', 'c-tee-moved'], '二级筛选+树序');

    // 选一级 z_top：精确匹配不列「仅二级命中」的物品（A11 不按父类模糊）
    const catSel2 = doc.getElementById('filter-cat');
    catSel2.value = 'z_top';
    catSel2.dispatchEvent(new w.Event('change', { bubbles: true }));
    await waitFor(function () { return cardNames(doc).length === 4; }, { label: '一级筛选结果数不符' });
    eqNames(cardNames(doc), ['f-nosub-top', 'a-tee', 'b-tee', 'd-hood'], '一级筛选+树序');
  }
  console.log('PASS ' + cur);

  // ============ 6 其他排序键不受影响（价格口径不变） ============
  cur = '6. 其他排序键不变：价格高→低仍为数值序';
  {
    const w = await openPage('clothing', {
      items: [
        item('c_teeA', 'clothing', 'z_top', 'z_tee', 'a-tee', 10),
        item('c_jeans', 'clothing', 'a_bottom', 'a_jeans', 'g-jeans', 40),
        item('c_ghost', 'clothing', 'gone', 'gone2', 'i-ghost', 90)
      ]
    });
    const doc = w.document;
    await setSort(w, doc, 'filter-sort', 'price');
    await waitFor(function () { return cardNames(doc)[0] === 'i-ghost'; }, { label: '价格高→低未生效' });
    eqNames(cardNames(doc), ['i-ghost', 'g-jeans', 'a-tee'], '价格高→低');
    const saved = w.Storage.getDB().settings.listSort;
    assert(saved && saved.clothing && saved.clothing.key === 'price',
      '价格排序记忆应为 price，实为 ' + JSON.stringify(saved && saved.clothing));
  }
  console.log('PASS ' + cur);

  console.log('========== v1.1.7 分类树序排序（cat）：6 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
