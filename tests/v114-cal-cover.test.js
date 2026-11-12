/* v114-cal-cover.test.js — v1.1.4：穿搭日历每日照片窗口固定 3:4 竖长条
   ① 格子窗口 aspect-ratio 9/16（窗口缩放比例恒定，不再"有时显示不完整"）
   ② 穿搭打卡照片按 3:4 裁切上传（裁切器 3:4 档 270×360 预览 / 768×1024 输出）
   ③ 旧照片兼容：object-fit: contain 白底完整显示（不裁切）
   ④ 其他上传（物品等）保持 1:1，不受影响；美食日历不受影响 */
const { makeWindow, waitMain, sleep, waitFor, waitNoModal, lastModal, assert } = require('./helpers/harness');
const fs = require('fs');
const path = require('path');

function stubImage(w) {
  w.Image = function () {
    const img = { width: 800, height: 600, onload: null, onerror: null, _src: '' };
    Object.defineProperty(img, 'src', {
      get: function () { return img._src; },
      set: function (v) {
        img._src = v;
        setTimeout(function () { if (img.onload) img.onload(); }, 0);
      }
    });
    return img;
  };
}

async function main() {
  /* 1 CSS 定稿：3:4 窗口 + contain 旧图兼容 */
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'css', 'extra.css'), 'utf8');
  const seg = css.split('.cal-grid-outfit').slice(1).join('.cal-grid-outfit') || '';
  assert(/aspect-ratio:\s*3\s*\/\s*4/.test(seg), 'CSS 缺 .cal-grid-outfit 的 3:4 窗口');
  assert(/object-fit:\s*contain/.test(seg), 'CSS 缺旧照片 contain 完整显示（兼容）');
  // 裁切框尺寸随画布（3:4 画布 270×360 不许被固定 320×320 框截掉下半截）
  const cropSeg = css.split('.crop-frame {')[1] || '';
  assert(/fit-content/.test(cropSeg) && !/width:\s*320px/.test(cropSeg), '.crop-frame 仍固定 320×320，竖图裁切预览会被截断');
  console.log('PASS 1. CSS：照片窗口固定 3:4 + 旧照片 contain 兼容 + 裁切框随画布');

  /* 2 穿搭日历带作用域类、美食日历不受影响 */
  const w = makeWindow({ data: { outfits: [], food: [] } });
  stubImage(w);
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;
  w.App.go('outfits');
  await sleep(400);
  const grid1 = doc.querySelector('.cal-grid');
  assert(grid1 && grid1.classList.contains('cal-grid-outfit'), '穿搭日历缺 cal-grid-outfit 作用域类');
  w.App.go('food');
  await sleep(400);
  const grid2 = doc.querySelector('.cal-grid');
  assert(grid2 && !grid2.classList.contains('cal-grid-outfit'), '美食日历不应带 3:4 作用域（不受影响）');
  console.log('PASS 2. 穿搭日历 3:4 作用域就位、美食日历不受影响');

  /* 3 裁切器 3:4 档：预览框 270×360 */
  const p1 = w.UI.cropImage(new w.File(['x'], 'a.jpg', { type: 'image/jpeg' }), { ratio: '3:4' });
  const m1 = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#crop-canvas') ? m : null;
  }, { label: '3:4 裁切弹窗' });
  const cv1 = m1.querySelector('#crop-canvas');
  assert(cv1.width === 270 && cv1.height === 360, '3:4 裁切框应为 270×360，实际 ' + cv1.width + '×' + cv1.height);
  m1.querySelector('[data-act=ok]').click();
  await p1;
  await waitNoModal(doc); // 弹窗 close 后 220ms 才移除，清场防串台
  console.log('PASS 3. 裁切器 3:4 档（270×360 预览框）');

  /* 4 默认 1:1 不受影响 */
  const p2 = w.UI.cropImage(new w.File(['x'], 'b.jpg', { type: 'image/jpeg' }), {});
  const m2 = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#crop-canvas') ? m : null;
  }, { label: '1:1 裁切弹窗' });
  const cv2 = m2.querySelector('#crop-canvas');
  assert(cv2.width === 320 && cv2.height === 320, '默认裁切框应保持 320×320，实际 ' + cv2.width + '×' + cv2.height);
  m2.querySelector('[data-act=cancel]').click();
  await p2;
  await waitNoModal(doc);
  console.log('PASS 4. 默认 1:1 裁切不受影响');

  /* 5 穿搭打卡上传链路透传 3:4（端到端：打卡弹窗选图 → 裁切框 270×360） */
  w.App.go('outfits');
  await sleep(350);
  doc.getElementById('btn-add-outfit').click();
  await sleep(450);
  const modal = lastModal(doc);
  assert(modal, '穿搭打卡弹窗未打开');
  const inp = modal.querySelector('#outfit-imgs input[type=file]');
  assert(inp, '穿搭打卡缺图片上传入口');
  Object.defineProperty(inp, 'files', {
    value: [new w.File(['x'], 'ootd.jpg', { type: 'image/jpeg' })], configurable: true
  });
  inp.dispatchEvent(new w.Event('change'));
  const m3 = await waitFor(function () {
    const m = lastModal(doc);
    return m && m.querySelector('#crop-canvas') ? m : null;
  }, { label: '打卡照片裁切弹窗' });
  const cv3 = m3.querySelector('#crop-canvas');
  assert(cv3.width === 270 && cv3.height === 360, '穿搭打卡照片应走 3:4 裁切，实际 ' + cv3.width + '×' + cv3.height);
  m3.querySelector('[data-act=cancel]').click();
  console.log('PASS 5. 穿搭打卡照片上传按 3:4 裁切');

  console.log('========== v1.1.4 穿搭日历 3:4 照片窗口 全部通过 ==========');
  process.exit(0);
}
main().catch(function (e) { console.error('FAIL:', e.message); process.exit(1); });
