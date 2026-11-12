/* v118-photo-sim.test.js — v1.1.5 新功能「模拟真实使用」深度回归锁：
   甲 3:4 照片链路：打卡上传 3:4（框 270×360 / 输出 768×1024）/「使用原图」压缩 /
      取消提示跳过数 / 多图顺序 / 1:1 物品图不受影响 / 抠图不压扁 / 旧图 contain + 日历格 3:4 恒定
   乙 选衣排序：「全部」一级→二级→名称（乱序跟 categoryId、跨域/无分类末尾），
      与列表页「按分类顺序」同口径；分类 tab 内同序；衣橱/妆品两 picker 都对
   丙 周期切换独立：每模块独立（切 A 不动 B）/ 只重绘本模块 / head 选中态 /
      各自记忆（落库恢复/旧单值迁移/随账号）/ 快速连点不堆积 / 下钻带周期 / 资产走势随周期（v1.1.8）
   丁 月块热力图：12 独立月块 + 月标签对位 / 今天描边 / 未来不画
   戊 更新重启：apply 失败 / 下载中失败 / 重启期后段失败仍报「更新失败」/ 超时提示手动启动
   己 边界：图片 0 字节/非图片/超大不入库；裁切缩放 33%/300% 边界 */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWindow, waitFor, sleep, waitMain, lastModal, waitNoModal, assert } = require('./helpers/harness');

let cur = '';

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function toastTexts(doc) {
  return Array.prototype.map.call(doc.querySelectorAll('.toast'), function (t) { return t.textContent; }).join('|');
}
/* JSDOM 不解码图片：桩掉 Image，src 赋值后异步触发 onload/onerror（800×600 横图） */
function stubImage(w, mode) {
  w.Image = function () {
    const img = { width: 800, height: 600, onload: null, onerror: null, _src: '' };
    Object.defineProperty(img, 'src', {
      get: function () { return img._src; },
      set: function (v) {
        img._src = v;
        setTimeout(function () {
          if (mode === 'error') { if (img.onerror) img.onerror(); }
          else if (img.onload) img.onload();
        }, 0);
      }
    });
    return img;
  };
}
/* 跟踪 createElement('canvas')，断言裁切输出画布尺寸 */
function trackCanvases(w) {
  const created = [];
  const origCreate = w.document.createElement.bind(w.document);
  w.document.createElement = function (tag) {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === 'canvas') created.push(el);
    return el;
  };
  return created;
}
function pickNames(doc, rootSel) {
  return Array.prototype.map.call(doc.querySelectorAll(rootSel + ' .pick-name'), function (n) {
    return n.textContent.trim();
  });
}
function eqArr(got, expect, label) {
  assert(got.join(',') === expect.join(','),
    label + '：期望 [' + expect.join(',') + ']，实为 [' + got.join(',') + ']');
}
function mkSettings(extra) {
  return Object.assign({
    idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} }, planSections: [],
    rememberAccount: true, navOrder: []
  }, extra || {});
}
/* CSS 规则块截取：sel 之后第一个 { … } */
function ruleAfter(css, sel, occurrence) {
  let idx = -1;
  for (let i = 0; i <= (occurrence || 0); i++) {
    idx = css.indexOf(sel, idx + 1);
    if (idx < 0) return '';
  }
  const brace = css.indexOf('{', idx);
  return css.slice(brace, css.indexOf('}', brace) + 1);
}

/* ============================ 甲 3:4 照片链路 ============================ */
async function case1() {
  cur = '1. 3:4 端到端：打卡上传 → 裁切框 270×360 → 输出画布 768×1024（含 ratio 透传）';
  const w = makeWindow({ data: { outfits: [], items: [] } });
  if (!(await waitMain(w))) throw new Error('no main');
  stubImage(w, 'ok');
  const doc = w.document;
  // 透传断言：打卡弹窗图片区必须走 3:4 档
  const origUploader = w.UI.imageUploader;
  let seenOpts = null;
  w.UI.imageUploader = function (el, o) { seenOpts = o; return origUploader(el, o); };
  w.App.go('outfits');
  await waitFor(function () { return doc.getElementById('btn-add-outfit'); }, { label: '穿搭日历未渲染' });
  doc.getElementById('btn-add-outfit').click();
  const modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#outfit-imgs input[type=file]') ? m : null;
  }, { label: '穿搭打卡弹窗未打开' });
  assert(seenOpts && seenOpts.ratio === '3:4', '打卡图片区必须传 ratio:3:4，实为 ' + JSON.stringify(seenOpts));
  const created = trackCanvases(w);
  const inp = modal.querySelector('#outfit-imgs input[type=file]');
  Object.defineProperty(inp, 'files', {
    value: [new w.File(['x'], 'ootd.jpg', { type: 'image/jpeg' })], configurable: true
  });
  inp.dispatchEvent(new w.Event('change'));
  const crop = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#crop-canvas') ? m : null;
  }, { label: '裁切弹窗未出现' });
  const cv = crop.querySelector('#crop-canvas');
  assert(cv.width === 270 && cv.height === 360,
    '3:4 裁切框应 270×360，实为 ' + cv.width + '×' + cv.height);
  crop.querySelector('[data-act=ok]').click();
  await waitFor(function () {
    return created.some(function (c) { return c.width === 768 && c.height === 1024; }) ? true : null;
  }, { label: '输出画布未到 768×1024' });
  assert(created.some(function (c) { return c.width === 768 && c.height === 1024; }),
    '3:4 输出应 768×1024，实为 ' + created.map(function (c) { return c.width + '×' + c.height; }).join(','));
  await waitFor(function () {
    return modal.querySelectorAll('#outfit-imgs .img-thumb[data-pidx]').length === 1 ? true : null;
  }, { label: '裁切结果未进入待传列表' });
  console.log('PASS ' + cur);
}

async function case2() {
  cur = '2. 「使用原图」压缩入库 + 取消裁切整批提示跳过张数';
  const w = makeWindow({});
  if (!(await waitMain(w))) throw new Error('no main');
  stubImage(w, 'ok');
  const doc = w.document;
  let compressCalls = 0;
  const origCompress = w.Storage.compressImage;
  w.Storage.compressImage = async function (a, b, c) { compressCalls++; return origCompress.call(w.Storage, a, b, c); };
  const box = doc.createElement('div');
  doc.body.appendChild(box);
  w.UI.imageUploader(box, { ratio: '3:4' });
  const mk = function (n) { return new w.File(['x'], n, { type: 'image/jpeg' }); };
  const inp = box.querySelector('input[type=file]');
  Object.defineProperty(inp, 'files', { value: [mk('a.jpg'), mk('b.jpg')], configurable: true });
  inp.dispatchEvent(new w.Event('change'));
  // 第一张点「使用原图」，第二张点「取消」
  const crop1 = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('[data-act=origin]') ? m : null;
  }, { label: '第一张裁切弹窗未出现' });
  crop1.querySelector('[data-act=origin]').click();
  await waitFor(function () { return compressCalls >= 1 ? true : null; }, { label: '使用原图未走压缩' });
  const crop2 = await waitFor(function () {
    const m = lastModal(doc);
    return m && m !== crop1 && m.querySelector('[data-act=cancel]') ? m : null;
  }, { label: '第二张裁切弹窗未出现' });
  crop2.querySelector('[data-act=cancel]').click();
  await waitFor(function () {
    return toastTexts(doc).indexOf('已跳过 1 张图片') >= 0 ? true : null;
  }, { label: '取消未提示跳过张数' });
  assert(compressCalls >= 1, '「使用原图」必须过 Storage.compressImage');
  assert(box.querySelectorAll('.img-thumb[data-pidx]').length === 1,
    '原图保留 1 张、取消的不进列表，实为 ' + box.querySelectorAll('.img-thumb[data-pidx]').length);
  w.Storage.compressImage = origCompress;
  // 图片读取失败：回退原图（甲2-④）且 objectURL 必须回收（防泄漏）
  stubImage(w, 'error');
  let revoked = 0;
  const origRevoke = w.URL.revokeObjectURL;
  w.URL.revokeObjectURL = function (u) { revoked++; return origRevoke(u); };
  const box2 = doc.createElement('div');
  doc.body.appendChild(box2);
  w.UI.imageUploader(box2, {});
  const inp2 = box2.querySelector('input[type=file]');
  Object.defineProperty(inp2, 'files', { value: [mk('c.jpg')], configurable: true });
  inp2.dispatchEvent(new w.Event('change'));
  await waitFor(function () {
    return box2.querySelectorAll('.img-thumb[data-pidx]').length === 1 ? true : null;
  }, { label: '回退原图未进待传列表' });
  assert(revoked >= 1, '图片读取失败也必须回收 objectURL（防泄漏），实为 ' + revoked + ' 次');
  console.log('PASS ' + cur);
}

async function case3() {
  cur = '3. 多图顺序保持：确认/取消/确认 → 顺序不乱、跳过不拖累整批';
  const w = makeWindow({
    routes: {
      'api/upload': function (h) {
        const fd = h.opts && h.opts.body;
        w.__uploaded = w.__uploaded || [];
        w.__uploaded.push(fd && fd.get ? fd.get('file') : null);
        return h.ok({ ok: true, path: 'p/' + w.__uploaded.length });
      }
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  stubImage(w, 'ok');
  const doc = w.document;
  // toBlob 顺序编号：验证上传顺序=选择顺序
  let seq = 0;
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob([String(++seq)])); };
  const box = doc.createElement('div');
  doc.body.appendChild(box);
  const up = w.UI.imageUploader(box, {});
  const mk = function (n, s) { return new w.File([s], n, { type: 'image/jpeg' }); };
  const inp = box.querySelector('input[type=file]');
  Object.defineProperty(inp, 'files', {
    value: [mk('f1.jpg', 'A'), mk('f2.jpg', 'B'), mk('f3.jpg', 'C')], configurable: true
  });
  inp.dispatchEvent(new w.Event('change'));
  const crop1 = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('[data-act=ok]') ? m : null;
  }, { label: '第 1 张裁切弹窗未出现' });
  crop1.querySelector('[data-act=ok]').click();
  // 多图逐张串行弹裁切窗：关窗动画 220ms 内下一张已开，按“新弹窗”接力，不做无窗等待
  const crop2 = await waitFor(function () {
    const m = lastModal(doc);
    return m && m !== crop1 && m.querySelector('[data-act=cancel]') ? m : null;
  }, { label: '第 2 张裁切弹窗未出现' });
  crop2.querySelector('[data-act=cancel]').click();
  const crop3 = await waitFor(function () {
    const m = lastModal(doc);
    return m && m !== crop2 && m.querySelector('[data-act=ok]') ? m : null;
  }, { label: '第 3 张裁切弹窗未出现' });
  crop3.querySelector('[data-act=ok]').click();
  await waitFor(function () {
    return box.querySelectorAll('.img-thumb[data-pidx]').length === 2 ? true : null;
  }, { label: '2 张图未进入待传列表' });
  const paths = await up.finalize();
  assert(paths.length === 2, '应上传 2 张（取消 1 张），实为 ' + paths.length);
  const texts = [];
  for (const b of (w.__uploaded || [])) texts.push(b ? await b.text() : '');
  eqArr(texts, ['1', '2'], '多图顺序保持（第 1、3 张按选择顺序上传）');
  console.log('PASS ' + cur);
}

async function case4() {
  cur = '4. 1:1 物品图裁切不受影响（框 320×320 / 输出 1024×1024）';
  const w = makeWindow({});
  if (!(await waitMain(w))) throw new Error('no main');
  stubImage(w, 'ok');
  const doc = w.document;
  const created = trackCanvases(w);
  const box = doc.createElement('div');
  doc.body.appendChild(box);
  w.UI.imageUploader(box, {}); // 物品表单同款：不传 ratio
  const inp = box.querySelector('input[type=file]');
  Object.defineProperty(inp, 'files', {
    value: [new w.File(['x'], 'item.jpg', { type: 'image/jpeg' })], configurable: true
  });
  inp.dispatchEvent(new w.Event('change'));
  const crop = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#crop-canvas') ? m : null;
  }, { label: '裁切弹窗未出现' });
  const cv = crop.querySelector('#crop-canvas');
  assert(cv.width === 320 && cv.height === 320,
    '默认裁切框应 320×320，实为 ' + cv.width + '×' + cv.height);
  crop.querySelector('[data-act=ok]').click();
  await waitFor(function () {
    return created.some(function (c) { return c.width === 1024 && c.height === 1024; }) ? true : null;
  }, { label: '1:1 输出画布未到 1024×1024' });
  console.log('PASS ' + cur);
}

async function case5() {
  cur = '5. 一键抠图不变形：抠图输入=原图尺寸，画回按原图比例';
  const w = makeWindow({});
  if (!(await waitMain(w))) throw new Error('no main');
  stubImage(w, 'ok'); // 800×600
  const doc = w.document;
  const draws = [];
  w.HTMLCanvasElement.prototype.getContext = function () {
    return {
      drawImage: function () { draws.push({ src: arguments[0], args: Array.prototype.slice.call(arguments) }); },
      getImageData: function () { return { data: new Uint8ClampedArray(4) }; },
      putImageData: function () {}, fillRect: function () {}, clearRect: function () {}
    };
  };
  let cutIn = null;
  w.Cutout = {
    cutout: async function (src) { cutIn = { w: src.width, h: src.height }; return src; },
    isModelReady: function () { return false; }
  };
  const p = w.UI.cropImage(new w.File(['x'], 'a.jpg', { type: 'image/jpeg' }), {});
  const crop = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#crop-cutout') ? m : null;
  }, { label: '裁切弹窗未出现' });
  crop.querySelector('#crop-cutout').click();
  await waitFor(function () {
    return cutIn ? true : null;
  }, { label: '抠图未执行' });
  assert(cutIn.w === 800 && cutIn.h === 600,
    '抠图输入画布必须与原图同尺寸（800×600），否则画回会被压扁，实为 ' + cutIn.w + '×' + cutIn.h);
  // 抠图结果画回：源=800×600、目标框保持 4:3 比例（不压成方形）
  const hit = draws.filter(function (d) {
    return d.src && d.src.width === 800 && d.src.height === 600 && d.args.length === 5;
  }).pop();
  assert(hit, '抠图结果应以原图尺寸为源画回');
  assert(Math.abs(hit.args[3] / hit.args[4] - 800 / 600) < 0.01,
    '画回目标框应保持原图比例 4:3，实为 ' + hit.args[3] + '×' + hit.args[4]);
  crop.querySelector('[data-act=ok]').click();
  await p;
  console.log('PASS ' + cur);
}

async function case6() {
  cur = '6. CSS：日历格 3:4 恒定 + 旧照片 contain 白底 + 推荐卡 3:4/contain';
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'css', 'extra.css'), 'utf8');
  // 日历格 3:4 恒定（cover/outfits/hint 三态同比例）
  const multiIdx = css.indexOf('.cal-grid-outfit .cal-cover,');
  assert(multiIdx >= 0, '缺 .cal-grid-outfit 3:4 恒定规则组');
  const multiHead = css.slice(multiIdx, css.indexOf('{', multiIdx));
  assert(/\.cal-grid-outfit \.cal-outfits/.test(multiHead) && /\.cal-grid-outfit \.cal-hint/.test(multiHead),
    '3:4 恒定规则须覆盖 cal-cover/cal-outfits/cal-hint 三态');
  const multiBlock = ruleAfter(css, '.cal-grid-outfit .cal-cover,', 0);
  assert(/aspect-ratio:\s*3\s*\/\s*4/.test(multiBlock), '日历格应固定 aspect-ratio: 3/4');
  // 旧照片 contain 白底（日历格）
  const coverImg = ruleAfter(css, '.cal-grid-outfit .cal-cover img', 0);
  assert(/object-fit:\s*contain/.test(coverImg), '日历格旧照片必须 contain 完整显示');
  assert(/background:\s*#fff/.test(coverImg), '日历格旧照片必须白底补边');
  // 推荐卡 3:4 + 旧照片 contain 白底（与日历格同口径，不能 cover 裁掉）
  const recImg = ruleAfter(css, '.rec-card img', 0);
  assert(/aspect-ratio:\s*3\s*\/\s*4/.test(recImg), '推荐卡照片应 3:4');
  assert(/object-fit:\s*contain/.test(recImg), '推荐卡旧照片必须 contain 完整显示（不裁切）');
  assert(/background:\s*#fff/.test(recImg), '推荐卡旧照片必须白底');
  const recNo = ruleAfter(css, '.rec-noimg', 0);
  assert(/aspect-ratio:\s*3\s*\/\s*4/.test(recNo), '推荐卡无图占位应同比例 3:4');
  console.log('PASS ' + cur);
}

/* ============================ 乙 选衣排序 ============================ */
const SORT_CATS = {
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
function sortItem(id, kind, categoryId, subCategoryId, name) {
  return {
    id: id, kind: kind, categoryId: categoryId, subCategoryId: subCategoryId, name: name,
    purchaseDate: '2025-01-01', purchasePrice: 100, status: 'in_use', images: [], tags: []
  };
}
const SORT_ITEMS = [
  // 故意乱序数据：子类挂在别的大类 / 跨域 / 无分类
  sortItem('i_hat', 'clothing', 'z_top', '', 'A帽'),
  sortItem('i_yao', 'clothing', 'z_top', 'a_jeans', 'Y乱'),   // 乱序：子类在别的大类
  sortItem('i_btee', 'clothing', 'z_top', 'z_tee', 'B恤'),
  sortItem('i_zhood', 'clothing', 'z_top', 'z_hoodie', 'Z衫'),
  sortItem('i_pants', 'clothing', 'a_bottom', 'a_jeans', 'C裤'),
  sortItem('i_ghost', 'clothing', 'zzz', 'qqq', 'W跨'),        // 跨域
  sortItem('i_nocat', 'clothing', '', '', 'X无'),              // 无分类
  sortItem('l_lip', 'life', 'z_skin', 'z_lip', '唇膏B'),
  sortItem('l_cream', 'life', 'z_skin', 'z_cream', '面霜A'),
  sortItem('l_clean', 'life', 'a_clean', '', '洁面C')
];
const CLOTH_ORDER = ['A帽', 'Y乱', 'B恤', 'Z衫', 'C裤', 'W跨', 'X无'];
const COS_ORDER = ['唇膏B', '面霜A', '洁面C'];

async function case7() {
  cur = '7. 选衣「全部」一级→二级→名称（乱序跟 categoryId、跨域/无分类末尾）=列表页口径';
  const w = makeWindow({
    data: { categories: SORT_CATS, items: SORT_ITEMS.slice(), outfits: [] }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;
  w.Views.openOutfitEditor('2026-11-10');
  const modal = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#cloth-picker .pick-name') ? m : null;
  }, { label: '打卡弹窗选衣区未渲染' });
  eqArr(pickNames(doc, '#cloth-picker'), CLOTH_ORDER, '选衣「全部」排序');
  // 与列表页「按分类顺序」逐一对齐（同一实现、同一口径）
  modal.querySelector('[data-act=cancel]').click();
  await waitNoModal(doc);
  w.App.go('clothing');
  const sel = await waitFor(function () { return doc.getElementById('filter-sort'); }, { label: '衣橱页未渲染' });
  sel.value = 'cat';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await waitFor(function () {
    return doc.querySelectorAll('.item-card').length >= 7 ? true : null;
  }, { label: '衣橱列表未渲染' });
  const listNames = Array.prototype.map.call(doc.querySelectorAll('.item-card .item-name'), function (n) {
    return n.textContent.trim();
  }).filter(function (n) { return CLOTH_ORDER.indexOf(n) >= 0; });
  eqArr(listNames, CLOTH_ORDER, '与列表页「按分类顺序」口径一致');
  console.log('PASS ' + cur);
}

async function case8() {
  cur = '8. 分类 tab 内同序 + 妆品 picker 同规则';
  const w = makeWindow({
    data: { categories: SORT_CATS, items: SORT_ITEMS.slice(), outfits: [] }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;
  w.Views.openOutfitEditor('2026-11-10');
  await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#cos-picker .pick-name') ? m : null;
  }, { label: '打卡弹窗妆品区未渲染' });
  // 妆品 picker：一级→二级→名称
  eqArr(pickNames(doc, '#cos-picker'), COS_ORDER, '妆品「全部」排序');
  // 分类 tab 内与「全部」相对顺序一致
  const tab = Array.prototype.slice.call(doc.querySelectorAll('#cloth-picker .ptab')).find(function (b) {
    return b.getAttribute('data-cat') === '上装';
  });
  assert(tab, '缺「上装」分类 tab');
  tab.click();
  await waitFor(function () {
    return pickNames(doc, '#cloth-picker').length === 4 ? true : null;
  }, { label: 'tab 筛选未生效' });
  eqArr(pickNames(doc, '#cloth-picker'), ['A帽', 'Y乱', 'B恤', 'Z衫'], '「上装」tab 内同序');
  // 无分类物品归「其他」tab 且排末尾
  const tabAll = Array.prototype.slice.call(doc.querySelectorAll('#cloth-picker .ptab')).find(function (b) {
    return b.getAttribute('data-cat') === '其他';
  });
  assert(tabAll, '跨域/无分类物品应有「其他」tab');
  tabAll.click();
  await waitFor(function () {
    return pickNames(doc, '#cloth-picker').length === 2 ? true : null;
  }, { label: '其他 tab 筛选未生效' });
  eqArr(pickNames(doc, '#cloth-picker'), ['W跨', 'X无'], '「其他」tab 内同序');
  console.log('PASS ' + cur);
}

/* ============================ 丙 周期切换独立 ============================ */
function weekBills(todayStr) {
  return [
    { id: 'b1', type: 'expense', amount: 100, date: todayStr, catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '', tagIds: [], source: 'manual' },
    { id: 'b2', type: 'expense', amount: 50, date: ymd(new Date(Date.now() - 14 * 86400000)), catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '', tagIds: [], source: 'manual' }
  ];
}

async function case9() {
  cur = '9. 周期切换独立：切 A 不影响 B、只重绘本模块、head 选中态正确';
  const w = makeWindow({
    data: { wallet: { bills: weekBills(ymd(new Date())) }, settings: mkSettings() }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;
  w.App.go('plan');
  const balBtn = await waitFor(function () {
    return doc.querySelector('[data-id=wBalance] .seg-toggle-head [data-sr=week]');
  }, { label: '统计页未渲染' });
  const balBody = doc.querySelector('[data-body=wBalance]');
  const trendBody = doc.querySelector('[data-body=wTrend]');
  const trendHTML = trendBody.innerHTML;
  assert(balBody.innerHTML.indexOf('月小结') >= 0, '前置失败：默认「月」应有月小结');
  balBtn.click();
  await waitFor(function () {
    return doc.querySelector('[data-body=wBalance]').innerHTML.indexOf('月小结') < 0 ? true : null;
  }, { label: 'wBalance 切周未生效' });
  // 只重绘本模块：wTrend 节点与内容都不动
  assert(doc.querySelector('[data-body=wTrend]') === trendBody, 'wTrend body 节点不应被重建');
  assert(doc.querySelector('[data-body=wTrend]').innerHTML === trendHTML, '切换 wBalance 周期不应改写 wTrend 内容');
  // head 选中态：本模块切到「周」，其余模块不受影响
  assert(doc.querySelector('[data-id=wBalance] [data-sr=week]').classList.contains('on'), 'wBalance「周」应选中');
  assert(!doc.querySelector('[data-id=wBalance] [data-sr=month]').classList.contains('on'), 'wBalance「月」应取消选中');
  assert(doc.querySelector('[data-id=wTrend] [data-sr=month]').classList.contains('on'), 'wTrend 选中态不应被连带改动');
  // 切 B 不回写 A：wTrend 切「年」后 wBalance 仍是「周」
  doc.querySelector('[data-id=wTrend] [data-sr=year]').click();
  await waitFor(function () {
    return doc.querySelector('[data-id=wTrend] [data-sr=year]').classList.contains('on') ? true : null;
  }, { label: 'wTrend 切年未生效' });
  assert(doc.querySelector('[data-id=wBalance] [data-sr=week]').classList.contains('on'), 'wTrend 切换不得回写 wBalance');
  console.log('PASS ' + cur);
}

async function case10() {
  cur = '10. 周期各自记忆：落库恢复 + 旧单值迁移 + 随账号独立';
  // A：statRanges 落库后新窗口恢复
  const wA = makeWindow({
    data: { wallet: { bills: weekBills(ymd(new Date())) }, settings: mkSettings() }
  });
  if (!(await waitMain(wA))) throw new Error('no main');
  const docA = wA.document;
  wA.App.go('plan');
  await waitFor(function () {
    return docA.querySelector('[data-id=wBalance] [data-sr=week]');
  }, { label: '统计页未渲染(A)' });
  docA.querySelector('[data-id=wBalance] [data-sr=week]').click();
  await waitFor(function () {
    const s = wA.Storage.getDB().settings;
    return s.statRanges && s.statRanges.wBalance === 'week' ? true : null;
  }, { label: 'statRanges 未落库' });
  // 新窗口（模拟刷新/重启）按 statRanges 恢复，且各模块独立
  const wB = makeWindow({
    data: {
      wallet: { bills: weekBills(ymd(new Date())) },
      settings: mkSettings({ statRanges: { wBalance: 'week', wCatPie: 'year' } })
    }
  });
  if (!(await waitMain(wB))) throw new Error('no main');
  const docB = wB.document;
  wB.App.go('plan');
  await waitFor(function () {
    return docB.querySelector('[data-id=wBalance] [data-sr=week]');
  }, { label: '统计页未渲染(B)' });
  assert(docB.querySelector('[data-id=wBalance] [data-sr=week]').classList.contains('on'), '重启后 wBalance 应恢复「周」');
  assert(docB.querySelector('[data-id=wCatPie] [data-sr=year]').classList.contains('on'), '重启后 wCatPie 应恢复「年」');
  assert(docB.querySelector('[data-id=wTrend] [data-sr=month]').classList.contains('on'), '未设置的模块默认「月」');
  // 旧单值 statRange（v1.1.4 前）→ 5 个收支模块全部迁移
  const wC = makeWindow({
    data: {
      wallet: { bills: weekBills(ymd(new Date())) },
      settings: mkSettings({ statRange: 'year' })
    }
  });
  if (!(await waitMain(wC))) throw new Error('no main');
  const docC = wC.document;
  wC.App.go('plan');
  await waitFor(function () {
    return docC.querySelector('[data-id=wHeat] [data-sr=year]');
  }, { label: '统计页未渲染(C)' });
  ['wBalance', 'wTrend', 'wCatPie', 'wDaily', 'wHeat'].forEach(function (id) {
    assert(docC.querySelector('[data-id=' + id + '] [data-sr=year]').classList.contains('on'),
      '旧单值 statRange=year 应迁移到 ' + id);
  });
  // 随账号独立：另一账号 settings 只带自己的记忆
  const wD = makeWindow({
    data: {
      wallet: { bills: weekBills(ymd(new Date())) },
      settings: mkSettings({ statRanges: { wBalance: 'year' } })
    }
  });
  if (!(await waitMain(wD))) throw new Error('no main');
  const docD = wD.document;
  wD.App.go('plan');
  await waitFor(function () {
    return docD.querySelector('[data-id=wBalance] [data-sr=year]');
  }, { label: '统计页未渲染(D)' });
  assert(docD.querySelector('[data-id=wBalance] [data-sr=year]').classList.contains('on'), '账号 D 记忆应独立为「年」');
  assert(docD.querySelector('[data-id=wTrend] [data-sr=month]').classList.contains('on'), '账号 D 不得借用别的账号记忆');
  console.log('PASS ' + cur);
}

async function case11() {
  cur = '11. 切换器快速连点：同档 no-op 不落库 / 换档每次点击只重绘一次（监听不堆积）';
  let settingsSaves = 0;
  const w = makeWindow({
    data: { wallet: { bills: weekBills(ymd(new Date())) }, settings: mkSettings() },
    onCall: function (u, body) {
      if (u.indexOf('/api/save') >= 0 && body && body.target === 'settings') settingsSaves++;
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;
  w.App.go('plan');
  const btn = await waitFor(function () {
    return doc.querySelector('[data-id=wBalance] .seg-toggle-head [data-sr=week]');
  }, { label: '统计页未渲染' });
  // 同档连点（值未变）：no-op，仅第 1 次切换生效落库（v1.1.9 拍板）
  const base = settingsSaves;
  for (let i = 0; i < 3; i++) { btn.click(); await sleep(30); }
  await sleep(80);
  assert(settingsSaves - base === 1,
    '同档连点 3 次应仅第 1 次落库（值未变不落库），实为 ' + (settingsSaves - base));
  // 换档连点：每次点击恰好 1 次落库（监听不堆积，堆积会让渲染/落库次数翻倍）
  const btnY = doc.querySelector('[data-id=wBalance] .seg-toggle-head [data-sr=year]');
  const btnM = doc.querySelector('[data-id=wBalance] .seg-toggle-head [data-sr=month]');
  const base2 = settingsSaves;
  btnY.click(); await sleep(30); btnM.click(); await sleep(30); btn.click(); await sleep(30);
  await sleep(80);
  assert(settingsSaves - base2 === 3,
    '换档连点 3 次应恰好 3 次落库（每次点击 1 个处理器），实为 ' + (settingsSaves - base2) +
    '（监听堆积会让渲染/落库次数翻倍）');
  // 连点后仍正常：切「年」立即生效
  doc.querySelector('[data-id=wBalance] [data-sr=year]').click();
  await waitFor(function () {
    return doc.querySelector('[data-id=wBalance] [data-sr=year]').classList.contains('on') ? true : null;
  }, { label: '连点后切换失效' });
  console.log('PASS ' + cur);
}

async function case12() {
  cur = '12. 下钻带周期（week 不丢）+ 资产走势随周期（v1.1.8 时间轴统一）';
  const today = ymd(new Date());
  const w = makeWindow({
    data: {
      wallet: { bills: weekBills(today) },
      settings: mkSettings({ statRanges: { wTrend: 'week' } })
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;
  w.App.go('plan');
  await waitFor(function () {
    return doc.querySelector('[data-id=wTrend] svg rect[data-drill-date]');
  }, { label: 'wTrend 柱未带下钻属性' });
  assert(doc.querySelector('[data-id=wTrend] [data-sr=week]').classList.contains('on'), 'wTrend 应记忆「周」');
  // v1.1.8 P0-4 时间轴统一：资产走势随周期（弃固定 90 天）
  assert(doc.querySelector('[data-id=wAssets] [data-sr]'), '资产走势应有周期切换器（时间轴统一）');
  // 下钻：先让别的模块渲染过（_curSec 被覆盖），再点 wTrend 的柱——周期必须仍是 week
  if (doc.querySelector('[data-id=wCatPie] [data-sr=year]')) {
    doc.querySelector('[data-id=wCatPie] [data-sr=year]').click();
    await sleep(60);
  }
  let captured = null;
  w.WalletView.jumpTo = function (f) { captured = f; };
  const rect = doc.querySelector('[data-id=wTrend] svg rect[data-drill-date]');
  rect.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await waitFor(function () { return captured ? true : null; }, { label: '下钻未触发 jumpTo' });
  assert(captured.range === 'week', '下钻必须带上本栏目周期（week），实为 ' + JSON.stringify(captured));
  assert(captured.date, '下钻应带日期');
  console.log('PASS ' + cur);
}

/* ============================ 丁 月块热力图 ============================ */
async function case13() {
  cur = '13. 月块热力图：12 个独立月块 + 月标签对位';
  const w = makeWindow({
    data: {
      settings: mkSettings(),
      habits: { defs: [{ id: 'h1', name: '运动', type: 'check' }], log: { h1: {} } }
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;
  w.App.go('plan');
  const grid = await waitFor(function () {
    return doc.querySelector('[data-body=habitHeat] svg[data-habit-grid]');
  }, { label: 'habitHeat 年热力格未渲染' });
  assert(grid.getAttribute('data-months') === '12', '应为 12 个独立月块');
  const labels = Array.prototype.slice.call(grid.querySelectorAll('text'));
  assert(labels.length === 12, '应有 12 个月标签，实为 ' + labels.length);
  // 月标签对位：第 m 块起点 x = 20 + m*(7*13+18)（格 11+间隙 2、块间隙 18）
  labels.forEach(function (t, m) {
    assert(t.textContent === (m + 1) + '月', '月标签顺序错：' + t.textContent);
    assert(Number(t.getAttribute('x')) === 20 + m * 109,
      (m + 1) + '月标签应落在块起点 x=' + (20 + m * 109) + '，实为 ' + t.getAttribute('x'));
  });
  // 12 块独立：各月格子 x 落在各自块内 [20+109m, 20+109m+91)，块间不共享列
  const rects = Array.prototype.slice.call(grid.querySelectorAll('rect'));
  const byMonth = {};
  rects.forEach(function (r) {
    const key = (r.getAttribute('data-hdate') || '').slice(0, 7);
    (byMonth[key] = byMonth[key] || []).push(Number(r.getAttribute('x')));
  });
  assert(Object.keys(byMonth).length >= 1, '应有当年打卡/日期格');
  Object.keys(byMonth).forEach(function (mk) {
    const m = Number(mk.slice(5, 7)) - 1;
    const bx = 20 + m * 109;
    byMonth[mk].forEach(function (x) {
      assert(x >= bx && x < bx + 91, mk + ' 的格子越出本月块 x 范围：' + x);
    });
    const cols = {};
    byMonth[mk].forEach(function (x) { cols[x] = 1; });
    assert(Object.keys(cols).length <= 7, mk + ' 块列数应 ≤7（周一~周日），实为 ' + Object.keys(cols).length);
  });
  console.log('PASS ' + cur);
}

async function case14() {
  cur = '14. 月块热力图：今天描边 + 未来不画';
  const today = ymd(new Date());
  const y = today.slice(0, 4), mo = today.slice(5, 7);
  const daysInMonth = new Date(Number(y), Number(mo), 0).getDate();
  const w = makeWindow({
    data: {
      settings: mkSettings(),
      habits: {
        defs: [{ id: 'h1', name: '运动', type: 'check' }],
        log: { h1: (function () {
          const o = {};
          o[today] = true;
          return o;
        })() }
      }
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;
  w.App.go('plan');
  const grid = await waitFor(function () {
    return doc.querySelector('[data-body=habitHeat] svg[data-habit-grid]');
  }, { label: 'habitHeat 年热力格未渲染' });
  const rects = Array.prototype.slice.call(grid.querySelectorAll('rect'));
  // 未来不画：所有格子 ≤ 今天，且当月格子数 = 今天几号
  rects.forEach(function (r) {
    const d = r.getAttribute('data-hdate');
    assert(d <= today, '未来日不应作画：' + d);
  });
  const monthRects = rects.filter(function (r) {
    return (r.getAttribute('data-hdate') || '').indexOf(y + '-' + mo + '-') === 0;
  });
  assert(monthRects.length === Number(today.slice(8, 10)),
    '当月应只画到今天（' + today.slice(8, 10) + ' 号），实为 ' + monthRects.length);
  assert(rects.length === (function () {
    // 全年已过天数
    return Math.floor((new Date(today) - new Date(y + '-01-01')) / 86400000) + 1;
  })(), '整年应只画已过天数，实为 ' + rects.length);
  // 今天描边
  const t = rects.filter(function (r) { return r.getAttribute('data-hdate') === today; })[0];
  assert(t, '缺今天（' + today + '）的格子');
  assert(t.getAttribute('stroke') === '#0071e3', '今天应描边高亮（#0071e3）');
  assert(daysInMonth > 0, 'sanity');
  // 打过卡的今天 data-on=1
  assert(t.getAttribute('data-on') === '1', '今天已打卡应 data-on=1');
  console.log('PASS ' + cur);
}

/* ============================ 戊 更新重启（状态机 mock） ============================ */
function openUpdateDialog(w, doc) {
  w.App.go('settings');
  return waitFor(function () {
    return doc.getElementById('btn-check-update');
  }, { label: '设置页未渲染' }).then(function () {
    doc.getElementById('btn-check-update').click();
    return waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('[data-x=u]') ? m : null;
    }, { label: '更新弹窗未出现' });
  });
}

async function case15() {
  cur = '15. 更新 apply 启动失败：明确提示原因 + 重试入口';
  const w = makeWindow({
    routes: {
      'api/update/check': function (h) {
        return h.ok({ ok: true, localVersion: '1.0.0', remoteVersion: '1.0.1', hasUpdate: true,
          changelog: ['x'], assets: { win64: 'https://github.com/x/y/releases/download/v1.0.1/z.zip' } });
      },
      'api/update/apply': function (h) { return h.fail({ ok: false, error: '下载源不可用' }); },
      'api/version': function (h) { return h.ok({ ok: true }); }
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;
  const modal = await openUpdateDialog(w, doc);
  modal.querySelector('[data-x=u]').click();
  await waitFor(function () {
    const t = modal.querySelector('#update-progress');
    return t && t.textContent.indexOf('启动更新失败') >= 0 ? true : null;
  }, { label: '启动失败未提示' });
  assert(modal.querySelector('#update-progress').textContent.indexOf('下载源不可用') >= 0, '应透出失败原因');
  assert(modal.querySelector('#btn-retry-update'), '启动失败必须给重试入口');
  console.log('PASS ' + cur);
}

async function case16() {
  cur = '16. 更新下载中失败：「更新失败」+ 重试（状态机 failed 路径）';
  let idx = 0;
  const seq = [
    { state: 'downloading', downloaded: 1, total: 2, percent: 50, source: '', phase: 'downloading', error: '' },
    { state: 'failed', error: '校验失败' }
  ];
  const w = makeWindow({
    routes: {
      'api/update/check': function (h) {
        return h.ok({ ok: true, localVersion: '1.0.0', remoteVersion: '1.0.1', hasUpdate: true,
          changelog: ['x'], assets: { win64: 'https://github.com/x/y/releases/download/v1.0.1/z.zip' } });
      },
      'api/update/apply': function (h) { return h.ok({ ok: true, state: 'downloading' }); },
      'api/update/status': function (h) { return h.ok(seq[Math.min(idx++, seq.length - 1)]); },
      'api/version': function (h) { return h.ok({ ok: true }); }
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;
  const modal = await openUpdateDialog(w, doc);
  modal.querySelector('[data-x=u]').click();
  await waitFor(function () {
    const t = modal.querySelector('#update-progress');
    return t && t.textContent.indexOf('更新失败') >= 0 ? true : null;
  }, { label: '下载失败未提示', timeout: 8000 });
  assert(modal.querySelector('#update-progress').textContent.indexOf('校验失败') >= 0, '应透出失败原因');
  assert(modal.querySelector('#btn-retry-update'), '失败必须给重试入口');
  console.log('PASS ' + cur);
}

async function case17() {
  cur = '17. 重启期后段失败仍报「更新失败」（不误报服务未自动重启）';
  // 序列：下载→installing（进入重启守护）→ 12 次中性 → 才失败（>10 次轮询，旧实现会漏报）
  const neutral = { state: 'downloading', downloaded: 1, total: 2, percent: 50, source: '', phase: 'downloading', error: '' };
  const seq = [
    { state: 'downloading', downloaded: 1, total: 2, percent: 50, source: '', phase: 'downloading', error: '' },
    { state: 'installing', phase: 'installing', error: '' }
  ].concat(new Array(12).fill(neutral)).concat([{ state: 'failed', error: 'bad package layout' }]);
  let idx = 0;
  const w = makeWindow({
    routes: {
      'api/update/check': function (h) {
        return h.ok({ ok: true, localVersion: '1.0.0', remoteVersion: '9.9.9', hasUpdate: true,
          changelog: ['x'], assets: { win64: 'https://github.com/x/y/releases/download/v9.9.9/z.zip' } });
      },
      'api/update/apply': function (h) { return h.ok({ ok: true, state: 'downloading' }); },
      'api/update/status': function (h) { return h.ok(seq[Math.min(idx++, seq.length - 1)]); },
      'api/version': function (h) { return h.ok({ ok: true }); } // 永不匹配版本 → 停在守护
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;
  // 加速轮询（1500/1200 → 25ms），否则要等 20s+
  const origSI = w.setInterval;
  w.setInterval = function (fn, ms) { return origSI(fn, (ms === 1500 || ms === 1200) ? 25 : ms); };
  const modal = await openUpdateDialog(w, doc);
  modal.querySelector('[data-x=u]').click();
  await waitFor(function () {
    const t = modal.querySelector('#update-progress');
    return t && t.textContent.indexOf('更新失败：bad package layout') >= 0 ? true : null;
  }, { label: '后段失败未报「更新失败」', timeout: 10000 });
  assert(modal.querySelector('#update-progress').textContent.indexOf('服务未自动重启') < 0,
    '后段失败不得误报「服务未自动重启」');
  console.log('PASS ' + cur);
}

async function case18() {
  cur = '18. 重启超时明确提示手动启动（waitRestart 超时提示）';
  const neutral = { state: 'downloading', downloaded: 1, total: 2, percent: 50, source: '', phase: 'downloading', error: '' };
  const seq = [
    { state: 'downloading', downloaded: 1, total: 2, percent: 50, source: '', phase: 'downloading', error: '' },
    { state: 'installing', phase: 'installing', error: '' }
  ].concat(new Array(90).fill(neutral));
  let idx = 0;
  const w = makeWindow({
    routes: {
      'api/update/check': function (h) {
        return h.ok({ ok: true, localVersion: '1.0.0', remoteVersion: '9.9.9', hasUpdate: true,
          changelog: ['x'], assets: { win64: 'https://github.com/x/y/releases/download/v9.9.9/z.zip' } });
      },
      'api/update/apply': function (h) { return h.ok({ ok: true, state: 'downloading' }); },
      'api/update/status': function (h) { return h.ok(seq[Math.min(idx++, seq.length - 1)]); },
      'api/version': function (h) { return h.ok({ ok: true }); }
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;
  const origSI = w.setInterval;
  w.setInterval = function (fn, ms) { return origSI(fn, (ms === 1500 || ms === 1200) ? 25 : ms); };
  const modal = await openUpdateDialog(w, doc);
  modal.querySelector('[data-x=u]').click();
  await waitFor(function () {
    const t = modal.querySelector('#update-progress');
    return t && t.textContent.indexOf('手动双击 lovelife.bat') >= 0 ? true : null;
  }, { label: '超时未提示手动启动', timeout: 10000 });
  assert(toastTexts(doc).indexOf('手动双击 lovelife.bat') >= 0, '超时应同时 toast 提示');
  console.log('PASS ' + cur);
}

/* ============================ 己 边界 ============================ */
async function case19() {
  cur = '19. 图片边界：0 字节 / 非图片 / 超大 全部跳过不入库';
  const w = makeWindow({
    routes: {
      'api/upload': function (h) {
        w.__upCount = (w.__upCount || 0) + 1;
        return h.ok({ ok: true, path: 'p/' + w.__upCount });
      }
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  stubImage(w, 'ok'); // 若误入裁切链路会弹窗，用“无弹窗”反证
  const doc = w.document;
  const box = doc.createElement('div');
  doc.body.appendChild(box);
  const up = w.UI.imageUploader(box, {});
  const zero = new w.File([], 'z.jpg', { type: 'image/jpeg' });
  const doc2 = new w.File(['x'], 'd.pdf', { type: 'application/pdf' });
  const big = new w.File(['x'], 'big.jpg', { type: 'image/jpeg' });
  Object.defineProperty(big, 'size', { value: 40 * 1024 * 1024 });
  const inp = box.querySelector('input[type=file]');
  Object.defineProperty(inp, 'files', { value: [zero, doc2, big], configurable: true });
  inp.dispatchEvent(new w.Event('change'));
  await waitFor(function () {
    return toastTexts(doc).indexOf('已跳过 3 张无法处理') >= 0 ? true : null;
  }, { label: '坏文件未提示跳过' });
  await sleep(120);
  assert(!doc.querySelector('.crop-frame'), '坏文件不应进入裁切链路');
  assert(box.querySelectorAll('.img-thumb').length === 0, '坏文件不得进入待传列表');
  const paths = await up.finalize();
  assert(paths.length === 0, '坏文件不得入库，实为 ' + paths.length);
  assert(!w.__upCount, '坏文件不得发起上传');
  console.log('PASS ' + cur);
}

async function case20() {
  cur = '20. 裁切缩放 33%/300% 边界不炸，输出仍 768×1024';
  const w = makeWindow({});
  if (!(await waitMain(w))) throw new Error('no main');
  stubImage(w, 'ok');
  const doc = w.document;
  const created = trackCanvases(w);
  const p = w.UI.cropImage(new w.File(['x'], 'a.jpg', { type: 'image/jpeg' }), { ratio: '3:4' });
  const crop = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#crop-zoom') ? m : null;
  }, { label: '裁切弹窗未出现' });
  const z = crop.querySelector('#crop-zoom');
  assert(z.min === '33' && z.max === '300', '缩放边界应 33~300，实为 ' + z.min + '~' + z.max);
  z.value = '33';
  z.dispatchEvent(new w.Event('input'));
  z.value = '300';
  z.dispatchEvent(new w.Event('input'));
  z.value = '33';
  z.dispatchEvent(new w.Event('input'));
  crop.querySelector('[data-act=ok]').click();
  const out = await p;
  assert(out && out.blob, '边界缩放下应正常输出');
  assert(created.some(function (c) { return c.width === 768 && c.height === 1024; }),
    '边界缩放下输出仍应 768×1024');
  console.log('PASS ' + cur);
}

async function main() {
  await case1();
  await case2();
  await case3();
  await case4();
  await case5();
  await case6();
  await case7();
  await case8();
  await case9();
  await case10();
  await case11();
  await case12();
  await case13();
  await case14();
  await case15();
  await case16();
  await case17();
  await case18();
  await case19();
  await case20();
  console.log('========== v1.1.5 新功能模拟使用（3:4/选衣/周期/热力/更新/边界）：20 项全部通过 ==========');
  process.exit(0);
}
main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + (e && e.message || e));
  process.exit(1);
});
