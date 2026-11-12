/* v116-item-ux.test.js — 物品/图片线 UX 优化（甲/丙包）回归锁：
   1) 甲1  账单同步美食：预填菜系「其他」+ fromBill 免菜系必填 + 手动新建仍必填
   2) 甲2  图片链路四问题：①取消批量提示跳过张数 ②输出 ≥1024px ③「使用原图」也压缩 ④回退扩展名按 file.type
   3) 甲3  「生成购入账单」：validateItem + 图片落盘先保存物品，空名称/0 元不裸生成，文案写明
   4) 甲4  售出回血闭环：详情净成本/回血率 + 表单售出价/售出日期（默认今天、回填可见可改）
   5) 甲8  弹窗 Esc 统一关闭（isComposing 不拦）+ 带表单弹窗遮罩确认「放弃已填内容？」+ 打卡 Enter=保存
   6) 甲9  中文输入法：picker 组词期间不重绘不重建 input；列表搜索恢复光标 offset
   7) 甲10 美食范围校验：评分/饱腹感 0~5、热量/价格 ≥0，越界不过 + 输入 min/max
   8) 甲18 天气三件套：重新定位清缓存 / 手动值当日优先（覆盖前 confirm）/ 失败原因区分定位与网络
   9) 甲21 两处丢数据：删旧打卡只重绘 existing 区（新表单保留）；数码改游戏侧 kind/游戏字段跟随
  10) 甲23 杂项：详情图按选择顺序 / 允许纯拍照打卡 / 保存失败回滚 / 筛选各页独立记忆
  11) 丙4  保存按钮 loading（.is-loading + 「保存中…」）
  12) 丙3  空态卡化（.empty-state.empty-card + 引导按钮，筛选态保留清除筛选）
  13) 甲16 美食日期可改；fromBill 条目日期随账单（置灰+提示） */
'use strict';
const { makeWindow, waitFor, sleep, waitMain, lastModal, waitNoModal, assert } = require('./helpers/harness');

let cur = '';

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function toastTexts(doc) {
  return Array.prototype.map.call(doc.querySelectorAll('.toast'), function (t) { return t.textContent; }).join('|');
}

/* JSDOM 不解码图片：桩掉 Image，src 赋值后异步触发 onload/onerror，驱动裁切链路 */
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

async function main() {
  const today = ymd(new Date());
  const TOMORROW = ymd(new Date(Date.now() + 86400000));

  /* ==================== 1 甲1 美食菜系 ==================== */
  cur = '1. 甲1 账单同步美食预填「其他」+ fromBill 免菜系必填';
  const w1 = makeWindow({
    data: { categories: { foodCuisine: [], foodType: [], meal: ['早餐', '午餐', '晚餐', '加餐'] } }
  });
  if (!(await waitMain(w1))) throw new Error('no main');
  const S1 = w1.Storage, M1 = w1.Models;
  const doc1 = w1.document;
  await S1.loadAll();
  await S1.saveBill({
    id: 'b-f1', type: 'expense', amount: 30, date: today, time: '',
    catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '账单午饭', tagIds: [], source: 'manual'
  });
  let food1 = S1.getDB().food.find(function (f) { return f.name === '账单午饭'; });
  assert(food1, '前置失败：正餐账单应自动同步美食');
  assert(food1.foodCuisine === '其他', '甲1：自动生成美食应预填菜系「其他」，实为: ' + food1.foodCuisine);
  assert(!M1.validateFood({ foodCuisine: '', meal: '午餐', price: 10, fromBill: food1.id }).some(function (e) { return e.indexOf('菜系') >= 0; }),
    '甲1：fromBill 来源记录不得被菜系必填卡住');
  assert(M1.validateFood({ foodCuisine: '', meal: '午餐', price: 10 }).some(function (e) { return e.indexOf('菜系') >= 0; }),
    '甲1：手动新建美食仍必须填菜系');
  // 编辑器补评分：菜系「其他」（不在分类库）也要能选中保存——此前被菜系必填卡死
  w1.FoodView.openFoodEditor(today, food1);
  let modal1 = await waitFor(function () {
    const m = lastModal(doc1);
    return m && m.querySelector('[name=rating]') ? m : null;
  }, { label: '美食编辑弹窗未出现' });
  assert(modal1.querySelector('[name=foodCuisine]').value === '其他',
    '甲1：预填「其他」应出现在菜系下拉并选中，实为: ' + modal1.querySelector('[name=foodCuisine]').value);
  modal1.querySelector('[name=rating]').value = '4';
  modal1.querySelector('[data-x=s]').click();
  await waitFor(function () {
    const f = S1.getDB().food.find(function (x) { return x.id === food1.id; });
    return f && f.rating === 4 ? f : null;
  }, { label: '补评分保存未落库（被菜系必填卡住？）' });
  food1 = S1.getDB().food.find(function (x) { return x.id === food1.id; });
  assert(food1.foodCuisine === '其他', '保存后菜系「其他」不得丢失');
  console.log('PASS ' + cur);

  /* ==================== 2 甲2 图片链路四问题 ==================== */
  cur = '2. 甲2 图片链路：取消提示/1024 输出/原图压缩/回退扩展名';
  const uploadedNames = [];
  const w2 = makeWindow({
    routes: {
      'api/upload': function (h) {
        const fd = h.opts && h.opts.body;
        const f = fd && fd.get ? fd.get('file') : null;
        uploadedNames.push(f && f.name);
        return h.ok({ ok: true, path: 'p/' + (f && f.name) });
      }
    }
  });
  if (!(await waitMain(w2))) throw new Error('no main');
  const doc2 = w2.document;

  // ① 取消批量：两张都点「取消」→ toast「已跳过 2 张图片」
  stubImage(w2, 'ok');
  const box2a = doc2.createElement('div');
  doc2.body.appendChild(box2a);
  w2.UI.imageUploader(box2a, {});
  const inp2a = box2a.querySelector('input[type=file]');
  const mkFile = function (name, type) { return new w2.File(['x'], name, { type: type }); };
  Object.defineProperty(inp2a, 'files', {
    value: [mkFile('a.jpg', 'image/jpeg'), mkFile('b.jpg', 'image/jpeg')], configurable: true
  });
  inp2a.dispatchEvent(new w2.Event('change'));
  const crop1 = await waitFor(function () {
    const m = lastModal(doc2);
    return m && m.querySelector('[data-act=cancel]') ? m : null;
  }, { label: '第一张裁切弹窗未出现' });
  crop1.querySelector('[data-act=cancel]').click();
  const crop2 = await waitFor(function () {
    const m = lastModal(doc2);
    return m && m !== crop1 && m.querySelector('[data-act=cancel]') ? m : null;
  }, { label: '第二张裁切弹窗未出现' });
  crop2.querySelector('[data-act=cancel]').click();
  await waitFor(function () {
    return toastTexts(doc2).indexOf('已跳过 2 张图片') >= 0 ? true : null;
  }, { label: '取消未提示跳过张数' });
  assert(toastTexts(doc2).indexOf('已跳过 2 张图片') >= 0, '甲2-①：取消应提示「已跳过 2 张图片」，实为: ' + toastTexts(doc2));

  // ② 输出 ≥1024px（等比、白底补边逻辑不变）
  const created = [];
  const origCreate = doc2.createElement.bind(doc2);
  doc2.createElement = function (tag) {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === 'canvas') created.push(el);
    return el;
  };
  const box2b = doc2.createElement('div');
  doc2.body.appendChild(box2b);
  w2.UI.imageUploader(box2b, {});
  const inp2b = box2b.querySelector('input[type=file]');
  Object.defineProperty(inp2b, 'files', { value: [mkFile('c.jpg', 'image/jpeg')], configurable: true });
  inp2b.dispatchEvent(new w2.Event('change'));
  const crop3 = await waitFor(function () {
    const m = lastModal(doc2);
    return m && m.querySelector('[data-act=ok]') ? m : null;
  }, { label: '裁切弹窗未出现（②）' });
  crop3.querySelector('[data-act=ok]').click();
  await waitFor(function () {
    return created.some(function (c) { return c.width >= 1024 && c.height >= 1024; }) ? true : null;
  }, { label: '输出画布未到 ≥1024px' });
  assert(created.some(function (c) { return c.width >= 1024; }),
    '甲2-②：输出边长应 ≥1024px，实为: ' + created.map(function (c) { return c.width + 'x' + c.height; }).join(','));

  // ③ 「使用原图」也过 Storage.compressImage 统一压缩
  let compressCalls = 0;
  const origCompress = w2.Storage.compressImage;
  w2.Storage.compressImage = async function (f, a, b) {
    compressCalls++;
    return origCompress.call(w2.Storage, f, a, b);
  };
  const box2c = doc2.createElement('div');
  doc2.body.appendChild(box2c);
  w2.UI.imageUploader(box2c, {});
  const inp2c = box2c.querySelector('input[type=file]');
  Object.defineProperty(inp2c, 'files', { value: [mkFile('d.jpg', 'image/jpeg')], configurable: true });
  inp2c.dispatchEvent(new w2.Event('change'));
  const crop4 = await waitFor(function () {
    const m = lastModal(doc2);
    return m && m.querySelector('[data-act=origin]') ? m : null;
  }, { label: '裁切弹窗未出现（③）' });
  crop4.querySelector('[data-act=origin]').click();
  await waitFor(function () { return compressCalls >= 1 ? true : null; }, { label: '使用原图未走压缩' });
  assert(compressCalls >= 1, '甲2-③：「使用原图」也必须过 Storage.compressImage');
  w2.Storage.compressImage = origCompress;
  doc2.createElement = origCreate;

  // ④ 回退扩展名按 file.type 取（image/jpeg→.jpg 等，默认 .png）——不再硬编码 .webp
  stubImage(w2, 'error'); // 图片读取失败 → 走回退原图分支
  const box2d = doc2.createElement('div');
  doc2.body.appendChild(box2d);
  const up2d = w2.UI.imageUploader(box2d, {});
  const inp2d = box2d.querySelector('input[type=file]');
  Object.defineProperty(inp2d, 'files', {
    value: [mkFile('e.jpg', 'image/jpeg'), mkFile('f.tiff', 'image/tiff')], configurable: true
  });
  inp2d.dispatchEvent(new w2.Event('change'));
  await waitFor(function () {
    return box2d.querySelectorAll('.img-thumb[data-pidx]').length === 2 ? true : null;
  }, { label: '回退原图未进入待传列表' });
  const paths2d = await up2d.finalize();
  assert(paths2d.length === 2, '回退两张图都应可入库');
  assert(uploadedNames.indexOf('img.jpg') >= 0,
    '甲2-④：image/jpeg 回退扩展名应为 .jpg，上传名: ' + uploadedNames.join(','));
  assert(uploadedNames.indexOf('img.png') >= 0,
    '甲2-④：未知类型应回退 .png，上传名: ' + uploadedNames.join(','));
  assert(uploadedNames.indexOf('img.webp') < 0,
    '甲2-④：不得再硬编码 .webp，上传名: ' + uploadedNames.join(','));
  console.log('PASS ' + cur);

  /* ==================== 3 甲3 生成购入账单 ==================== */
  cur = '3. 甲3 生成购入账单：校验+先保存物品+文案写明';
  const w3 = makeWindow({
    data: {
      items: [{ id: 'it1', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '旧手机', purchaseDate: '2025-06-01', purchasePrice: 3000, status: 'in_use', images: [], tags: [] }]
    }
  });
  if (!(await waitMain(w3))) throw new Error('no main');
  const S3 = w3.Storage;
  const doc3 = w3.document;
  await S3.loadAll();
  w3.Views.openItemEditor('it1', 'device');
  const modal3 = await waitFor(function () {
    const m = lastModal(doc3);
    return m && m.querySelector('#btn-gen-bill') ? m : null;
  }, { label: '物品编辑弹窗缺生成购入账单' });
  assert(modal3.querySelector('#btn-gen-bill').textContent.indexOf('将先保存物品当前内容') >= 0,
    '甲3：按钮文案应写明「将先保存物品当前内容」');
  assert(modal3.textContent.indexOf('将先保存物品当前内容') >= 0, '甲3：提示文案也应写明先保存物品当前内容');
  // 空名称不裸生成
  modal3.querySelector('[name=name]').value = '';
  modal3.querySelector('#btn-gen-bill').click();
  await waitFor(function () {
    return toastTexts(doc3).indexOf('名称必填') >= 0 ? true : null;
  }, { label: '空名称应被 validateItem 拦住' });
  assert(!S3.getDB().wallet.bills.some(function (b) { return b.itemId === 'it1'; }),
    '甲3：空名称不得生成账单');
  // 有效内容：先保存物品（名称/价格改动落库）再生成账单
  modal3.querySelector('[name=name]').value = '旧手机Pro';
  modal3.querySelector('[name=purchasePrice]').value = '3500';
  modal3.querySelector('#btn-gen-bill').click();
  const gen3 = await waitFor(function () {
    return S3.getDB().wallet.bills.find(function (b) { return b.itemId === 'it1'; });
  }, { label: '账单未生成' });
  assert(Number(gen3.amount) === 3500 && gen3.date === '2025-06-01', '账单应取保存后的物品金额/日期: ' + JSON.stringify(gen3));
  const it3 = S3.getDB().items.find(function (i) { return i.id === 'it1'; });
  assert(it3.name === '旧手机Pro' && Number(it3.purchasePrice) === 3500,
    '甲3：生成账单前必须先保存物品当前内容: ' + JSON.stringify(it3));
  console.log('PASS ' + cur);

  /* ==================== 4 甲4 售出回血闭环 ==================== */
  cur = '4. 甲4 详情净成本/回血率 + 表单售出价/售出日期';
  const w4 = makeWindow({
    data: {
      items: [
        { id: 's1', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '已售手机', purchaseDate: '2025-01-01', purchasePrice: 3000, status: 'sold', soldPrice: 800, soldDate: '2026-01-01', images: [], tags: [] },
        { id: 'i1', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '在用手机', purchaseDate: '2025-01-01', purchasePrice: 3000, status: 'in_use', images: [], tags: [] },
        { id: 's2', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '回填机', purchaseDate: '2025-01-01', purchasePrice: 1000, status: 'sold', soldPrice: 150, soldDate: today, images: [], tags: [] }
      ]
    }
  });
  if (!(await waitMain(w4))) throw new Error('no main');
  const S4 = w4.Storage;
  const doc4 = w4.document;
  await S4.loadAll();
  w4.Views.openItemDetail('s1');
  const d4 = await waitFor(function () {
    const m = lastModal(doc4);
    return m && m.textContent.indexOf('净成本') >= 0 ? m : null;
  }, { label: '详情页未显示净成本' });
  assert(d4.textContent.indexOf('回血率') >= 0, '甲4：详情页应显示回血率');
  assert(d4.textContent.indexOf('¥2,200') >= 0, '甲4：净成本应为投入-售出价（3000-800=2200）: ' + d4.textContent.slice(0, 400));
  d4.querySelector('.modal-close').click();
  await waitNoModal(doc4);
  // 表单：状态=已售出 展开售出价/售出日期（默认今天）
  w4.Views.openItemEditor('i1', 'device');
  let m4 = await waitFor(function () {
    const m = lastModal(doc4);
    return m && m.querySelector('#f-sold-row') ? m : null;
  }, { label: '物品表单缺售出行' });
  assert(m4.querySelector('#f-sold-row').style.display === 'none', '在用状态不应显示售出行');
  const stSel = m4.querySelector('[name=status]');
  stSel.value = 'sold';
  stSel.dispatchEvent(new w4.Event('change'));
  assert(m4.querySelector('#f-sold-row').style.display !== 'none', '甲4：选「已售出」应展开售出价/售出日期');
  assert(m4.querySelector('[name=soldDate]').value === today, '甲4：售出日期默认今天，实为: ' + m4.querySelector('[name=soldDate]').value);
  m4.querySelector('[name=soldPrice]').value = '900';
  m4.querySelector('[data-act=save]').click();
  await waitFor(function () {
    const it = S4.getDB().items.find(function (x) { return x.id === 'i1'; });
    return it && Number(it.soldPrice) === 900 ? it : null;
  }, { label: '售出价未落库' });
  const i1b = S4.getDB().items.find(function (x) { return x.id === 'i1'; });
  assert(i1b.soldDate === today && i1b.status === 'sold', '甲4：售出日期/状态应一并落库: ' + JSON.stringify(i1b));
  await waitNoModal(doc4);
  // 二手回血自动回填兼容：已回填的值表单可见可改
  w4.Views.openItemEditor('s2', 'device');
  m4 = await waitFor(function () {
    const m = lastModal(doc4);
    return m && m.querySelector('[name=soldPrice]') ? m : null;
  }, { label: '回填物品表单未出现' });
  assert(m4.querySelector('#f-sold-row').style.display !== 'none', '已售出物品表单应直接显示售出行');
  assert(String(m4.querySelector('[name=soldPrice]').value) === '150',
    '甲4：二手回血回填的售出价表单可见，实为: ' + m4.querySelector('[name=soldPrice]').value);
  m4.querySelector('[name=soldPrice]').value = '180';
  m4.querySelector('[data-act=save]').click();
  await waitFor(function () {
    const it = S4.getDB().items.find(function (x) { return x.id === 's2'; });
    return it && Number(it.soldPrice) === 180 ? it : null;
  }, { label: '回填值改不动' });
  console.log('PASS ' + cur);

  /* ==================== 5 甲8 Esc / 遮罩 / Enter ==================== */
  cur = '5. 甲8 Esc 统一关闭 + 表单遮罩确认 + 打卡 Enter=保存';
  const w5 = makeWindow({
    data: {
      items: [{ id: 'c1', kind: 'clothing', categoryId: 'top', subCategoryId: 'top_tee', name: 'T恤', purchaseDate: '2025-03-01', purchasePrice: 100, status: 'in_use', images: [], tags: [] }],
      categories: { clothing: [{ id: 'top', name: '上装', children: [{ id: 'top_tee', name: 'T恤' }] }] }
    }
  });
  if (!(await waitMain(w5))) throw new Error('no main');
  const S5 = w5.Storage;
  const doc5 = w5.document;
  await S5.loadAll();
  // Esc 统一关闭
  w5.Views.openItemEditor(null, 'clothing');
  await waitFor(function () { return lastModal(doc5); }, { label: '物品弹窗未出现' });
  doc5.body.dispatchEvent(new w5.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await waitNoModal(doc5);
  // isComposing 的 Esc 不拦截
  w5.Views.openItemEditor(null, 'clothing');
  await waitFor(function () { return lastModal(doc5); }, { label: '物品弹窗未出现（2）' });
  const evEsc = new w5.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  Object.defineProperty(evEsc, 'isComposing', { value: true });
  doc5.body.dispatchEvent(evEsc);
  await sleep(150);
  assert(doc5.querySelector('.modal'), '甲8：IME 组词中的 Esc 不应关闭弹窗');
  doc5.body.dispatchEvent(new w5.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await waitNoModal(doc5);
  // 带表单弹窗点遮罩 → confirm「放弃已填内容？」
  w5.FoodView.openFoodEditor('2026-05-05', null);
  const mask5 = await waitFor(function () {
    const m = doc5.querySelector('.modal-mask');
    return m && m.querySelector('#food-form') ? m : null;
  }, { label: '美食弹窗未出现' });
  mask5.dispatchEvent(new w5.MouseEvent('click', { bubbles: true }));
  const conf5 = await waitFor(function () {
    const m = lastModal(doc5);
    return m && m.textContent.indexOf('放弃已填内容') >= 0 ? m : null;
  }, { label: '遮罩未弹放弃确认' });
  conf5.querySelector('[data-act=no]').click();
  await waitFor(function () {
    return doc5.querySelectorAll('.modal-mask').length === 1 ? true : null;
  }, { label: '取消后确认框未关闭' });
  assert(doc5.body.contains(mask5), '甲8：确认后不应关闭弹窗（用户选了继续填写）');
  mask5.dispatchEvent(new w5.MouseEvent('click', { bubbles: true }));
  const conf5b = await waitFor(function () {
    const m = lastModal(doc5);
    return m && m.textContent.indexOf('放弃已填内容') >= 0 ? m : null;
  }, { label: '遮罩未再弹放弃确认' });
  conf5b.querySelector('[data-act=yes]').click();
  await waitNoModal(doc5);
  // 穿搭打卡：Enter=保存 / isComposing Enter 不保存
  w5.Views.openOutfitEditor('2026-01-10');
  const o5 = await waitFor(function () {
    const m = lastModal(doc5);
    return m && m.querySelector('#cloth-picker .pick-card') ? m : null;
  }, { label: '打卡弹窗未出现' });
  o5.querySelector('#cloth-picker .pick-card').click();
  await waitFor(function () { return o5.querySelector('.pick-card.on'); }, { label: 'picker 选中未生效' });
  const evEnter = new w5.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  Object.defineProperty(evEnter, 'isComposing', { value: true });
  doc5.body.dispatchEvent(evEnter);
  await sleep(150);
  assert(!S5.getDB().outfits.some(function (x) { return x.date === '2026-01-10'; }),
    '甲8：IME 组词中的 Enter 不应触发保存');
  doc5.body.dispatchEvent(new w5.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(function () {
    return S5.getDB().outfits.some(function (x) { return x.date === '2026-01-10'; });
  }, { label: 'Enter 未触发保存打卡' });
  console.log('PASS ' + cur);

  /* ==================== 6 甲9 中文输入法 ==================== */
  cur = '6. 甲9 组词不重绘不重建 input + 搜索光标 offset';
  const w6 = makeWindow({
    data: {
      items: [
        { id: 'd1', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '苹果机', purchaseDate: '2025-01-01', purchasePrice: 100, status: 'in_use', images: [], tags: [] },
        { id: 'd2', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '香蕉机', purchaseDate: '2025-01-01', purchasePrice: 100, status: 'in_use', images: [], tags: [] }
      ]
    }
  });
  if (!(await waitMain(w6))) throw new Error('no main');
  const doc6 = w6.document;
  // picker：组词期间挂起重绘
  const box6 = doc6.createElement('div');
  doc6.body.appendChild(box6);
  w6.UI.picker(box6, [
    { id: 'p1', name: '苹果', images: [] }, { id: 'p2', name: '香蕉', images: [] }
  ], [], {});
  const search6 = box6.querySelector('#pk-search');
  search6.value = '苹';
  search6.dispatchEvent(new w6.Event('compositionstart'));
  search6.dispatchEvent(new w6.Event('input'));
  await sleep(320); // 撑过 debounce 250ms
  assert(box6.querySelector('#pk-search') === search6, '甲9：组词期间不得重建搜索 input');
  assert(box6.querySelectorAll('.pick-card').length === 2, '甲9：组词期间不得刷新结果（候选词被打断）');
  search6.dispatchEvent(new w6.Event('compositionend'));
  await waitFor(function () {
    return box6.querySelectorAll('.pick-card').length === 1 ? true : null;
  }, { label: '组词结束未刷新结果' });
  // 列表搜索：重绘后恢复光标 offset（不再跳末尾）
  w6.App.go('digital');
  const inp6 = await waitFor(function () { return doc6.getElementById('item-search'); }, { label: '数码页未渲染' });
  inp6.value = 'abc';
  inp6.setSelectionRange(1, 1);
  inp6.dispatchEvent(new w6.Event('input'));
  const inp6b = await waitFor(function () {
    const n = doc6.getElementById('item-search');
    return n && n !== inp6 ? n : null;
  }, { label: '搜索未重绘' });
  assert(inp6b.selectionStart === 1 && inp6b.selectionEnd === 1,
    '甲9：重绘后应恢复光标 offset=1，实为: ' + inp6b.selectionStart);
  console.log('PASS ' + cur);

  /* ==================== 7 甲10 美食范围校验 ==================== */
  cur = '7. 甲10 评分/饱腹感 0~5、热量/价格 ≥0 + 输入约束';
  const w7 = makeWindow({
    data: { categories: { foodCuisine: ['中餐'], meal: ['午餐'] } }
  });
  if (!(await waitMain(w7))) throw new Error('no main');
  const M7 = w7.Models;
  const doc7 = w7.document;
  function hasErr(rec, kw) {
    return M7.validateFood(rec).some(function (e) { return e.indexOf(kw) >= 0; });
  }
  assert(hasErr({ foodCuisine: '中餐', meal: '午餐', price: 10, rating: 7 }, '评分'), '评分 7 应报错');
  assert(hasErr({ foodCuisine: '中餐', meal: '午餐', price: 10, rating: -1 }, '评分'), '评分 -1 应报错');
  assert(hasErr({ foodCuisine: '中餐', meal: '午餐', price: 10, fullness: 6 }, '饱腹感'), '饱腹感 6 应报错');
  assert(hasErr({ foodCuisine: '中餐', meal: '午餐', price: -100 }, '价格'), '价格 -100 应报错');
  assert(hasErr({ foodCuisine: '中餐', meal: '午餐', price: 10, calories: -100 }, '热量'), '热量 -100 应报错');
  assert(M7.validateFood({ foodCuisine: '中餐', meal: '午餐', price: 10, rating: 5, fullness: 0, calories: 0 }).length === 0,
    '边界值 0/5 不应误报');
  // 编辑器：min/max 输入约束 + 越界不过
  w7.FoodView.openFoodEditor('2026-06-06', null);
  const m7 = await waitFor(function () {
    const m = lastModal(doc7);
    return m && m.querySelector('[name=rating]') ? m : null;
  }, { label: '美食弹窗未出现' });
  assert(m7.querySelector('[name=rating]').getAttribute('max') === '5' && m7.querySelector('[name=rating]').getAttribute('min') === '0',
    '甲10：评分输入应有 min=0/max=5');
  assert(m7.querySelector('[name=fullness]').getAttribute('max') === '5', '甲10：饱腹感应有 max=5');
  assert(m7.querySelector('[name=calories]').getAttribute('min') === '0', '甲10：热量应有 min=0');
  assert(m7.querySelector('[name=price]').getAttribute('min') === '0', '甲10：价格应有 min=0');
  m7.querySelector('[name=foodCuisine]').value = '中餐';
  m7.querySelector('[name=meal]').value = '午餐';
  m7.querySelector('[name=price]').value = '20';
  m7.querySelector('[name=rating]').value = '7';
  m7.querySelector('[data-x=s]').click();
  await waitFor(function () {
    return toastTexts(doc7).indexOf('评分') >= 0 ? true : null;
  }, { label: '越界评分未拦截' });
  assert(toastTexts(doc7).indexOf('0~5') >= 0, '甲10：越界应红字提示范围: ' + toastTexts(doc7));
  assert(w7.Storage.getDB().food.length === 0, '甲10：越界不得入库');
  console.log('PASS ' + cur);

  /* ==================== 8 甲18 天气三件套 ==================== */
  cur = '8. 甲18 重新定位/手动优先确认/失败原因区分';
  let wxOk = true;
  const w8 = makeWindow({
    routes: {
      'api.open-meteo.com': function (h) {
        if (!wxOk) return h.fail({ error: true }, 500);
        return h.ok({
          daily: {
            time: [today, TOMORROW],
            temperature_2m_min: [18, 12], temperature_2m_max: [25, 17], weather_code: [1, 2]
          }
        });
      }
    }
  });
  if (!(await waitMain(w8))) throw new Error('no main');
  const S8 = w8.Storage;
  const doc8 = w8.document;
  await S8.loadAll();
  const geoKey = S8.accId() + ':lovelife-geo';
  const card8 = doc8.createElement('div');
  doc8.body.appendChild(card8);
  card8.setAttribute('data-force-target', 'today');
  // ③ 定位失败透出（无定位权限/无地理接口）
  await w8.Views.renderOutfitRec(card8);
  assert(card8.textContent.indexOf('定位失败，请允许定位或手动填温度') >= 0,
    '甲18-③：定位失败应透出提示: ' + card8.textContent.slice(0, 200));
  assert(doc8.getElementById('w-relocate'), '甲18-①：天气卡应有「重新定位」按钮');
  // ① 重新定位：清定位缓存并重取
  w8.localStorage.setItem(geoKey, JSON.stringify({ lat: 30, lon: 120 }));
  doc8.getElementById('w-relocate').click();
  await waitFor(function () {
    return toastTexts(doc8).indexOf('定位失败，请允许定位或手动填温度') >= 0 ? true : null;
  }, { label: '重新定位失败未提示' });
  assert(!w8.localStorage.getItem(geoKey), '甲18-①：重新定位应清掉定位缓存');
  // ③ 网络失败区分提示
  w8.localStorage.setItem(geoKey, JSON.stringify({ lat: 30, lon: 120 }));
  wxOk = false;
  await w8.Views.renderOutfitRec(card8);
  doc8.getElementById('w-refresh').click();
  await waitFor(function () {
    return toastTexts(doc8).indexOf('网络失败，点刷新重试') >= 0 ? true : null;
  }, { label: '网络失败未按原因提示' });
  // ② 手动值当日优先：刷新先确认「将覆盖手动设定」
  wxOk = true;
  w8.Weather.setManual(today, 5, 8);
  await w8.Views.renderOutfitRec(card8);
  assert(card8.textContent.indexOf('5~8℃') >= 0 && card8.textContent.indexOf('手动设定') >= 0,
    '前置失败：手动温度未生效: ' + card8.textContent.slice(0, 200));
  card8.querySelector('#w-refresh').click();
  const conf8 = await waitFor(function () {
    const m = lastModal(doc8);
    return m && m.textContent.indexOf('将覆盖手动设定') >= 0 ? m : null;
  }, { label: '覆盖手动设定前未确认' });
  conf8.querySelector('[data-act=no]').click();
  await waitFor(function () {
    return !doc8.body.contains(conf8) ? true : null;
  }, { label: '确认框未关闭' });
  await waitFor(function () {
    return toastTexts(doc8).indexOf('已保留手动设定') >= 0 ? true : null;
  }, { label: '取消覆盖后无反馈' });
  await w8.Views.renderOutfitRec(card8);
  assert(card8.textContent.indexOf('5~8℃') >= 0, '甲18-②：取消后手动值不得被静默覆盖');
  assert(S8.getDB() && JSON.parse(w8.localStorage.getItem(geoKey) || 'null'), '定位缓存应还在（未重取定位）');
  const wxRec = JSON.parse(w8.localStorage.getItem(S8.accId() + ':lovelife-wx-' + today) || 'null');
  assert(wxRec && wxRec.source === 'manual', '甲18-②：取消后缓存里手动值仍优先: ' + JSON.stringify(wxRec));
  // 确认覆盖 → 自动数据生效
  card8.querySelector('#w-refresh').click();
  const conf8b = await waitFor(function () {
    const m = lastModal(doc8);
    return m && m !== conf8 && m.textContent.indexOf('将覆盖手动设定') >= 0 ? m : null;
  }, { label: '第二次覆盖确认未出现' });
  conf8b.querySelector('[data-act=yes]').click();
  await waitFor(function () {
    return card8.textContent.indexOf('18~25℃') >= 0 ? true : null;
  }, { label: '确认后自动天气未生效' });
  console.log('PASS ' + cur);

  /* ==================== 9 甲21 两处丢数据 ==================== */
  cur = '9. 甲21 删旧打卡保新表单 + 数码改游戏 kind/字段跟随';
  const w9 = makeWindow({
    data: {
      items: [{ id: 'd1', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '主机', purchaseDate: '2025-01-01', purchasePrice: 2000, status: 'in_use', images: [], tags: [] }],
      outfits: [{ id: 'o1', date: '2026-02-02', itemIds: ['d1'], cosmeticIds: [], images: [], note: '旧记录' }],
      categories: {
        digital: [
          { id: 'host', name: '主机类', icon: 'laptop', children: [{ id: 'host_phone', name: '手机' }] },
          { id: 'game', name: '游戏', icon: 'gamepad-2', children: [{ id: 'gm_ps', name: '主机游戏' }] }
        ]
      }
    }
  });
  if (!(await waitMain(w9))) throw new Error('no main');
  const S9 = w9.Storage;
  const doc9 = w9.document;
  await S9.loadAll();
  // ① 删除旧记录只重绘 existing 区
  w9.Views.openOutfitEditor('2026-02-02');
  const mask9 = await waitFor(function () {
    const m = doc9.querySelector('.modal-mask');
    return m && m.querySelector('[data-del-out]') ? m : null;
  }, { label: '打卡弹窗缺旧记录删除入口' });
  mask9.querySelector('[name=note]').value = '填了一半的新表单';
  mask9.querySelector('[data-del-out]').click();
  const conf9 = await waitFor(function () {
    const m = lastModal(doc9);
    return m && m.querySelector('[data-act=yes]') ? m : null;
  }, { label: '删除确认未出现' });
  conf9.querySelector('[data-act=yes]').click();
  await waitFor(function () {
    return !mask9.querySelector('[data-del-out]') ? true : null;
  }, { label: 'existing 区未重绘' });
  assert(doc9.body.contains(mask9), '甲21-①：删除旧记录不得关掉正在填的弹窗');
  assert(mask9.querySelector('[name=note]').value === '填了一半的新表单',
    '甲21-①：新表单已填内容必须保留: ' + mask9.querySelector('[name=note]').value);
  assert(!S9.getDB().outfits.some(function (o) { return o.date === '2026-02-02'; }), '旧记录应已删除');
  mask9.querySelector('.modal-close').click();
  await waitNoModal(doc9);
  // ② 分类改到游戏侧：kind 跟随 + 游戏字段正常保存
  w9.Views.openItemEditor('d1', 'device');
  const m9b = await waitFor(function () {
    const m = lastModal(doc9);
    return m && m.querySelector('[name=categoryId]') ? m : null;
  }, { label: '物品弹窗未出现' });
  const catSel = m9b.querySelector('[name=categoryId]');
  catSel.value = 'game';
  catSel.dispatchEvent(new w9.Event('change'));
  await waitFor(function () {
    const gs = m9b.querySelector('[name=gameStatus]');
    return gs && gs.closest('label').style.display !== 'none' ? gs : null;
  }, { label: '游戏字段未随分类显示' });
  m9b.querySelector('[name=gameStatus]').value = 'playing';
  m9b.querySelector('[name=playHours]').value = '20';
  m9b.querySelector('[data-act=save]').click();
  const it9 = await waitFor(function () {
    const it = S9.getDB().items.find(function (x) { return x.id === 'd1'; });
    return it && it.kind === 'game' ? it : null;
  }, { label: 'kind 未跟随分类变 game' });
  assert(it9.gameStatus === 'playing' && Number(it9.playHours) === 20,
    '甲21-②：游戏字段必须随 kind=game 保存: ' + JSON.stringify(it9));
  console.log('PASS ' + cur);

  /* ==================== 10 甲23 杂项四小项 ==================== */
  cur = '10. 甲23 图序/纯拍照/失败回滚/筛选独立记忆';
  // ① 详情图按选择顺序（异步完成顺序打乱也不乱序）
  const w10a = makeWindow({
    data: {
      items: [{ id: 'im1', kind: 'device', categoryId: 'host', subCategoryId: 'host_phone', name: '拍照机', purchaseDate: '2025-01-01', purchasePrice: 100, status: 'in_use', images: ['a.jpg', 'b.jpg', 'c.jpg'], tags: [] }]
    }
  });
  if (!(await waitMain(w10a))) throw new Error('no main');
  const doc10a = w10a.document;
  await w10a.Storage.loadAll();
  // a.jpg 最慢完成——按完成顺序插入会变成 b,c,a
  w10a.Storage.getImageURL = function (p) {
    return new Promise(function (res) {
      setTimeout(function () { res('/api/images/me/' + p); }, p === 'a.jpg' ? 150 : 20);
    });
  };
  w10a.Views.openItemDetail('im1');
  await waitFor(function () {
    const imgs = doc10a.querySelectorAll('#detail-imgs img');
    return imgs.length === 3 && Array.prototype.every.call(imgs, function (i) { return i.src; }) ? imgs : null;
  }, { label: '详情图未加载齐' });
  const order = Array.prototype.map.call(doc10a.querySelectorAll('#detail-imgs img'), function (i) { return i.src; });
  assert(order[0].indexOf('a.jpg') >= 0 && order[1].indexOf('b.jpg') >= 0 && order[2].indexOf('c.jpg') >= 0,
    '甲23-①：图片应按选择顺序排列，实为: ' + order.join(','));
  console.log('PASS ' + cur + '（①图序）');

  // ② 允许纯拍照打卡（衣服/妆品/照片至少一项）
  const w10b = makeWindow({
    routes: { 'api/upload': function (h) { return h.ok({ ok: true, path: 'p/photo' }); } }
  });
  if (!(await waitMain(w10b))) throw new Error('no main');
  const doc10b = w10b.document;
  await w10b.Storage.loadAll();
  stubImage(w10b, 'ok');
  w10b.Views.openOutfitEditor('2026-03-03');
  const m10b = await waitFor(function () {
    const m = lastModal(doc10b);
    return m && m.querySelector('#outfit-imgs') ? m : null;
  }, { label: '打卡弹窗未出现' });
  m10b.querySelector('[data-act=save]').click();
  await waitFor(function () {
    return toastTexts(doc10b).indexOf('至少勾选一件衣服/妆品，或添加一张照片') >= 0 ? true : null;
  }, { label: '空打卡未拦截' });
  assert(!w10b.Storage.getDB().outfits.some(function (o) { return o.date === '2026-03-03'; }), '空打卡不得保存');
  // 加一张照片后允许保存
  const inp10b = m10b.querySelector('#outfit-imgs input[type=file]');
  Object.defineProperty(inp10b, 'files', {
    value: [new w10b.File(['x'], 'ootd.jpg', { type: 'image/jpeg' })], configurable: true
  });
  inp10b.dispatchEvent(new w10b.Event('change'));
  const crop10 = await waitFor(function () {
    const m = lastModal(doc10b);
    return m && m.querySelector('[data-act=ok]') ? m : null;
  }, { label: '裁切弹窗未出现' });
  crop10.querySelector('[data-act=ok]').click();
  await waitFor(function () {
    return m10b.querySelectorAll('#outfit-imgs .img-thumb').length ? true : null;
  }, { label: '照片未进上传区' });
  m10b.querySelector('[data-act=save]').click();
  const outfit10 = await waitFor(function () {
    return w10b.Storage.getDB().outfits.find(function (o) { return o.date === '2026-03-03'; });
  }, { label: '纯拍照打卡未保存' });
  assert(outfit10 && (outfit10.images || []).length === 1,
    '甲23-②：纯拍照打卡应可保存且照片入库: ' + JSON.stringify(outfit10));
  console.log('PASS ' + cur + '（②纯拍照）');

  // ③ 保存失败回滚 + 提示
  const w10c = makeWindow({
    data: {
      items: [{ id: 'c1', kind: 'clothing', categoryId: 'top', name: 'T恤', purchaseDate: '2025-03-01', purchasePrice: 100, status: 'in_use', images: [], tags: [] }],
      categories: { clothing: [{ id: 'top', name: '上装' }] }
    },
    routes: {
      'api/save': function (h) { return h.fail({ ok: false, error: '磁盘写入失败' }, 500); }
    }
  });
  if (!(await waitMain(w10c))) throw new Error('no main');
  const doc10c = w10c.document;
  await w10c.Storage.loadAll();
  w10c.Views.openOutfitEditor('2026-04-04');
  const m10c = await waitFor(function () {
    const m = lastModal(doc10c);
    return m && m.querySelector('#cloth-picker .pick-card') ? m : null;
  }, { label: '打卡弹窗未出现' });
  m10c.querySelector('#cloth-picker .pick-card').click();
  await waitFor(function () { return m10c.querySelector('.pick-card.on'); }, { label: 'picker 选中未生效' });
  m10c.querySelector('[data-act=save]').click();
  await waitFor(function () {
    return toastTexts(doc10c).indexOf('保存失败') >= 0 ? true : null;
  }, { label: '保存失败未提示' });
  assert(toastTexts(doc10c).indexOf('磁盘写入失败') >= 0, '失败提示应带原因: ' + toastTexts(doc10c));
  assert(!w10c.Storage.getDB().outfits.some(function (o) { return o.date === '2026-04-04'; }),
    '甲23-③：保存失败必须回滚（内存不得留半成品）');
  assert(!m10c.querySelector('[data-act=save]').disabled, '甲23-③：失败后保存按钮应恢复可点');
  console.log('PASS ' + cur + '（③失败回滚）');

  // ④ 筛选记忆策略统一：各页独立记忆，切页不互清
  const w10d = makeWindow({
    data: {
      items: [
        { id: 'x1', kind: 'device', categoryId: 'host', name: '数码1', purchaseDate: '2025-01-01', purchasePrice: 1, status: 'in_use', images: [], tags: [] },
        { id: 'y1', kind: 'clothing', categoryId: 'top', name: '衣1', purchaseDate: '2025-01-01', purchasePrice: 1, status: 'in_use', images: [], tags: [] }
      ],
      categories: { clothing: [{ id: 'top', name: '上装' }] }
    }
  });
  if (!(await waitMain(w10d))) throw new Error('no main');
  const doc10d = w10d.document;
  w10d.App.go('digital');
  const fSel = await waitFor(function () { return doc10d.getElementById('filter-status'); }, { label: '数码页未渲染' });
  fSel.value = 'idle';
  fSel.dispatchEvent(new w10d.Event('change'));
  await waitFor(function () {
    const s = doc10d.getElementById('filter-status');
    return s && s.value === 'idle' ? s : null;
  }, { label: '数码筛选未生效' });
  w10d.App.go('clothing');
  const cSel = await waitFor(function () {
    const s = doc10d.getElementById('filter-status');
    return s && s.value === '' ? s : null;
  }, { label: '衣橱页筛选应为空（各自独立）' });
  assert(cSel.value === '', '甲23-④：衣橱不得继承数码筛选');
  assert(doc10d.querySelectorAll('.item-card').length === 1, '衣橱应显示自己的物品');
  w10d.App.go('digital');
  const dSel = await waitFor(function () {
    const s = doc10d.getElementById('filter-status');
    return s && s.value === 'idle' ? s : null;
  }, { label: '数码筛选未被记忆' });
  assert(dSel.value === 'idle', '甲23-④：切页回来数码筛选应各自保留');
  console.log('PASS ' + cur + '（④筛选记忆）');

  /* ==================== 11 丙4 保存按钮 loading ==================== */
  cur = '11. 丙4 保存按钮 .is-loading + 「保存中…」';
  const w11 = makeWindow({
    routes: {
      'api/save': function (h) { return sleep(220).then(function () { return h.ok({ ok: true }); }); }
    }
  });
  if (!(await waitMain(w11))) throw new Error('no main');
  const doc11 = w11.document;
  await w11.Storage.loadAll();
  w11.Views.openItemEditor(null, 'clothing');
  const m11 = await waitFor(function () {
    const m = lastModal(doc11);
    return m && m.querySelector('[data-act=save]') ? m : null;
  }, { label: '物品弹窗未出现' });
  m11.querySelector('[name=name]').value = '测试衣';
  m11.querySelector('[name=categoryId]').value = 'top';
  m11.querySelector('[name=purchasePrice]').value = '10';
  m11.querySelector('[data-act=save]').click();
  const btn11 = m11.querySelector('[data-act=save]');
  assert(btn11.classList.contains('is-loading'), '丙4：保存中应挂 .is-loading');
  assert(btn11.textContent.indexOf('保存中…') >= 0, '丙4：保存中文案应为「保存中…」，实为: ' + btn11.textContent);
  await waitFor(function () {
    return w11.Storage.getDB().items.some(function (i) { return i.name === '测试衣'; });
  }, { label: '物品未保存' });
  console.log('PASS ' + cur);

  /* ==================== 12 丙3 空态卡化 ==================== */
  cur = '12. 丙3 空态卡化（empty-card + 引导按钮）';
  const w12 = makeWindow({
    data: {
      items: [{ id: 'z1', kind: 'device', categoryId: 'host', name: '筛不到的', purchaseDate: '2025-01-01', purchasePrice: 1, status: 'in_use', images: [], tags: [] }],
      categories: { clothing: [{ id: 'top', name: '上装' }] }
    }
  });
  if (!(await waitMain(w12))) throw new Error('no main');
  const doc12 = w12.document;
  // 衣橱全空 → 空态卡 + 引导按钮
  w12.App.go('clothing');
  const empty12 = await waitFor(function () {
    return doc12.querySelector('.empty-state.empty-card');
  }, { label: '衣橱空态未卡化' });
  assert(empty12.querySelector('.empty-icon svg'), '丙3：空态卡应有 48px 图标');
  assert(empty12.querySelector('#btn-empty-add'), '丙3：空态卡应有引导按钮');
  assert(empty12.textContent.indexOf('还没有记录') >= 0, '丙3：空态文案保留');
  // 有筛选无结果 → 保留「清除筛选」
  w12.App.go('digital');
  const s12 = await waitFor(function () { return doc12.getElementById('filter-status'); }, { label: '数码页未渲染' });
  s12.value = 'sold';
  s12.dispatchEvent(new w12.Event('change'));
  const empty12b = await waitFor(function () {
    return doc12.querySelector('.empty-state.empty-card');
  }, { label: '筛选空态未卡化' });
  assert(empty12b.querySelector('#btn-clear-filter'), '丙3：筛选空态应保留清除筛选按钮');
  // 生活页空态
  w12.App.go('life');
  const empty12c = await waitFor(function () {
    return doc12.querySelector('.empty-state.empty-card #btn-empty-add');
  }, { label: '生活页空态未卡化' });
  assert(empty12c, '丙3：生活页空态应有引导按钮');
  // 美食日历月空态
  w12.App.go('food');
  const empty12d = await waitFor(function () {
    return doc12.querySelector('.empty-state.empty-card #btn-empty-food');
  }, { label: '美食月空态未卡化' });
  assert(empty12d, '丙3：美食日历月空态应有引导按钮');
  console.log('PASS ' + cur);

  /* ==================== 13 甲16 美食改日期 ==================== */
  cur = '13. 甲16 美食日期可改 + fromBill 日期随账单';
  const w13 = makeWindow({
    data: { categories: { foodCuisine: ['中餐'], foodType: [], meal: ['早餐', '午餐', '晚餐', '加餐'] } }
  });
  if (!(await waitMain(w13))) throw new Error('no main');
  const S13 = w13.Storage;
  const doc13 = w13.document;
  await S13.loadAll();
  const ym = today.slice(0, 7);
  const dayA = ym + '-01', dayB = ym + '-02';
  // ① 手动新建：日期可改，保存后归属日跟着变（日历同步）
  w13.FoodView.openFoodEditor(dayA, null);
  let m13 = await waitFor(function () {
    const m = lastModal(doc13);
    return m && m.querySelector('[name=date]') ? m : null;
  }, { label: '美食弹窗缺日期字段' });
  const dateInp = m13.querySelector('[name=date]');
  assert(dateInp.value === dayA, '日期默认=点开的日历格子: ' + dateInp.value);
  assert(!dateInp.disabled, '甲16：手动记录日期应可改');
  dateInp.value = dayB;
  m13.querySelector('[name=foodCuisine]').value = '中餐';
  m13.querySelector('[name=meal]').value = '午餐';
  m13.querySelector('[name=price]').value = '25';
  m13.querySelector('[name=name]').value = '改期午饭';
  m13.querySelector('[data-x=s]').click();
  const rec13 = await waitFor(function () {
    return S13.getDB().food.find(function (f) { return f.name === '改期午饭'; });
  }, { label: '美食未保存' });
  assert(rec13.date === dayB, '甲16：保存后日期应变到新日期，实为: ' + rec13.date);
  await waitNoModal(doc13);
  w13.App.go('food');
  await waitFor(function () {
    const cell = doc13.querySelector('.cal-cell[data-date="' + dayB + '"]');
    return cell && cell.classList.contains('cal-has') ? cell : null;
  }, { label: '日历归属日未跟随新日期' });
  const cellA = doc13.querySelector('.cal-cell[data-date="' + dayA + '"]');
  assert(!cellA.classList.contains('cal-has'), '甲16：旧日期格子不应再挂这条记录');
  // ② fromBill：日期随账单（置灰 + 提示），保存不改日期
  await S13.saveBill({
    id: 'b-f16', type: 'expense', amount: 40, date: dayA, time: '',
    catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '同步午饭', tagIds: [], source: 'manual'
  });
  const fb13 = S13.getDB().food.find(function (f) { return f.name === '同步午饭'; });
  assert(fb13 && fb13.date === dayA, '前置失败：账单同步美食');
  w13.FoodView.openFoodEditor(dayA, fb13);
  m13 = await waitFor(function () {
    const m = lastModal(doc13);
    return m && m.querySelector('[name=date]') ? m : null;
  }, { label: 'fromBill 美食弹窗未出现' });
  assert(m13.querySelector('[name=date]').disabled, '甲16：fromBill 条目日期输入应置灰');
  assert(m13.textContent.indexOf('日期随账单') >= 0, '甲16：应提示「日期随账单」');
  m13.querySelector('[data-x=s]').click();
  await waitFor(function () {
    const f = S13.getDB().food.find(function (x) { return x.id === fb13.id; });
    return f && f.date === dayA ? f : null;
  }, { label: 'fromBill 保存后日期被改动' });
  console.log('PASS ' + cur);

  console.log('========== v1.1.6 物品/图片线 UX 优化（甲/丙包）：13 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
