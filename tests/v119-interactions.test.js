/* v119-interactions.test.js — v1.1.9 交互细节 5 项回归锁（模拟测试拍板 10-14）：
   1 周期切换 no-op：点当前已选中档位（值未变）不重绘不落库；换档才重绘+落库
   2 toast 节流：同文案 2 秒内只弹一次（连点打卡不刷屏）；不同文案不受影响；2 秒后可再弹
   3 多图「本批全用原图」：多图批量裁切窗提供按钮，点击后本张+剩余全走「使用原图」压缩口径、
     不再逐张弹窗；单张无此按钮；未点批量按钮仍逐张弹窗（单张行为不变）
   4 无购买日期填年数提示：「购买日期必填」已关 + 填年数 + 无购买日期 → 保存成功但不推算限用日期，
     toast「未填购买日期，保质期年数已保存但未推算限用日期」；有购买日期正常推算；
     必填开启仍被校验拦截（不弹保存类提示）
   5 保存队列防并发竞态：同一时刻仅一个 /api/save 在途、按入队序落盘（磁盘不回退旧值）；
     失败不卡死队列（后续照常落盘） */
'use strict';
const { makeWindow, waitFor, sleep, waitMain, lastModal, waitNoModal, assert } = require('./helpers/harness');

let cur = '';

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
function mkFile(w, n) { return new w.File(['x'], n, { type: 'image/jpeg' }); }

async function main() {
  /* ==================== 1 周期切换 no-op ==================== */
  cur = '1. 周期切换 no-op：点当前档位不重绘不落库，换档才重绘+落库';
  {
    let settingsSaves = 0;
    const w = makeWindow({
      data: {
        settings: { idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} }, planSections: [], rememberAccount: true, navOrder: [] },
        wallet: {
          bills: [{ id: 'b1', type: 'expense', amount: 12, date: '2026-01-05', time: '', catId: 'w_food', subCatId: 'w_food_lunch', accountId: '', note: '午饭', tagIds: [], source: 'manual' }]
        }
      },
      onCall: function (u, body) {
        if (String(u).indexOf('/api/save') >= 0 && body && body.target === 'settings') settingsSaves++;
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('plan');
    const monthBtn = await waitFor(function () {
      return doc.querySelector('[data-id=wBalance] .seg-toggle-head [data-sr=month]');
    }, { label: '统计页未渲染' });
    const bodyEl = doc.querySelector('[data-body=wBalance]');
    // 重绘探针：renderSection 走 body.innerHTML 重建，标记被清=发生过重绘
    const mark = doc.createElement('i');
    mark.id = 'noop-marker';
    bodyEl.appendChild(mark);
    const base = settingsSaves;
    monthBtn.click(); // 当前已选中「月」（值未变）→ no-op
    await sleep(150);
    assert(bodyEl.querySelector('#noop-marker'), 'no-op：点当前档位不应重绘本模块');
    assert(settingsSaves === base, 'no-op：点当前档位不应落库，实为 ' + (settingsSaves - base) + ' 次');
    assert(!w.Storage.getDB().settings.statRanges, 'no-op：点当前档位不应写 statRanges');
    // 换档：才重绘 + 落库
    doc.querySelector('[data-id=wBalance] [data-sr=week]').click();
    await waitFor(function () {
      const s = w.Storage.getDB().settings;
      return s.statRanges && s.statRanges.wBalance === 'week' ? true : null;
    }, { label: '换档未落库' });
    assert(!bodyEl.querySelector('#noop-marker'), '换档应重绘本模块（标记被清）');
    assert(doc.querySelector('[data-id=wBalance] [data-sr=week]').classList.contains('on'), '换档后选中态应更新');
    // 回点「周」（当前档位）→ 再次 no-op
    const base2 = settingsSaves;
    doc.querySelector('[data-id=wBalance] [data-sr=week]').click();
    await sleep(150);
    assert(settingsSaves === base2, '回点当前档位也不应落库，实为 ' + (settingsSaves - base2) + ' 次');
    console.log('PASS ' + cur);
  }

  /* ==================== 2 toast 节流 ==================== */
  cur = '2. toast 节流：同文案 2 秒内只弹一次；不同文案不受影响；2 秒后可再弹';
  {
    const w = makeWindow({});
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    const count = function (txt) {
      return Array.prototype.filter.call(doc.querySelectorAll('.toast'), function (t) {
        return t.textContent === txt;
      }).length;
    };
    w.UI.toast('连点同文案', 'info');
    w.UI.toast('连点同文案', 'info'); // 连点打卡同一条：2 秒内不重复弹
    w.UI.toast('连点同文案', 'info');
    assert(count('连点同文案') === 1, '同文案 2 秒内应只弹 1 次，实为 ' + count('连点同文案'));
    w.UI.toast('另一条提示', 'info');
    assert(count('另一条提示') === 1, '不同文案不受节流影响，实为 ' + count('另一条提示'));
    // 2 秒后同文案可再弹（拨快时钟验证窗口，不真睡 2 秒）
    const realNow = w.Date.now;
    w.Date.now = function () { return realNow.call(w.Date) + 2500; };
    try {
      w.UI.toast('连点同文案', 'info');
    } finally {
      w.Date.now = realNow;
    }
    assert(count('连点同文案') === 2, '超过 2 秒后同文案应可再弹，实为 ' + count('连点同文案'));
    console.log('PASS ' + cur);
  }

  /* ==================== 3 多图「本批全用原图」 ==================== */
  cur = '3. 多图「本批全用原图」：点一次后本批全走原图压缩、不再弹窗；单张无此按钮';
  {
    const w = makeWindow({});
    if (!(await waitMain(w))) throw new Error('no main');
    stubImage(w, 'ok');
    const doc = w.document;
    let compressCalls = 0;
    const origCompress = w.Storage.compressImage;
    w.Storage.compressImage = async function (a, b, c) {
      compressCalls++; return origCompress.call(w.Storage, a, b, c);
    };

    // ① 3 图批量：首窗带「本批全用原图」，点击后 3 张全进待传列表（全走压缩），不再逐张弹窗
    const box = doc.createElement('div');
    doc.body.appendChild(box);
    w.UI.imageUploader(box, { ratio: '3:4' });
    const inp = box.querySelector('input[type=file]');
    Object.defineProperty(inp, 'files', {
      value: [mkFile(w, 'a.jpg'), mkFile(w, 'b.jpg'), mkFile(w, 'c.jpg')], configurable: true
    });
    inp.dispatchEvent(new w.Event('change'));
    const crop1 = await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('[data-act=origin-all]') ? m : null;
    }, { label: '多图裁切窗未出现或缺「本批全用原图」' });
    assert(crop1.querySelector('[data-act=origin]') && crop1.querySelector('[data-act=ok]'),
      '批量窗应保留「使用原图/确认裁切」单张操作');
    crop1.querySelector('[data-act=origin-all]').click();
    await waitFor(function () {
      return box.querySelectorAll('.img-thumb[data-pidx]').length === 3 ? true : null;
    }, { label: '本批 3 张未全部进入待传列表' });
    await waitFor(function () { return compressCalls >= 3 ? true : null; },
      { label: '剩余图片未走「使用原图」压缩口径' });
    await sleep(320); // 关窗动画 220ms 后确认无后续裁切窗
    assert(!doc.querySelector('#crop-canvas'), '「本批全用原图」后不应再逐张弹裁切窗');
    assert(compressCalls >= 3, '本批 3 张都应过压缩（使用原图同口径），实为 ' + compressCalls + ' 次');

    // ② 单张行为不变：无「本批全用原图」按钮
    const box2 = doc.createElement('div');
    doc.body.appendChild(box2);
    w.UI.imageUploader(box2, {});
    const inp2 = box2.querySelector('input[type=file]');
    Object.defineProperty(inp2, 'files', { value: [mkFile(w, 'solo.jpg')], configurable: true });
    inp2.dispatchEvent(new w.Event('change'));
    const cropSolo = await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('[data-act=origin]') ? m : null;
    }, { label: '单张裁切窗未出现' });
    assert(!cropSolo.querySelector('[data-act=origin-all]'), '单张裁切窗不应有「本批全用原图」');
    cropSolo.querySelector('[data-act=cancel]').click();
    await waitNoModal(doc);

    // ③ 未点批量按钮：普通「使用原图」只处理当前张，下一张仍逐张弹窗
    const box3 = doc.createElement('div');
    doc.body.appendChild(box3);
    w.UI.imageUploader(box3, {});
    const inp3 = box3.querySelector('input[type=file]');
    Object.defineProperty(inp3, 'files', { value: [mkFile(w, 'x1.jpg'), mkFile(w, 'x2.jpg')], configurable: true });
    inp3.dispatchEvent(new w.Event('change'));
    const cropX1 = await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('[data-act=origin-all]') ? m : null;
    }, { label: '批量首窗未出现' });
    cropX1.querySelector('[data-act=origin]').click(); // 只用原图当前张，不动批量开关
    const cropX2 = await waitFor(function () {
      const m = lastModal(doc);
      return m && m !== cropX1 && m.querySelector('[data-act=cancel]') ? m : null;
    }, { label: '第 2 张仍应逐张弹裁切窗（未点批量按钮）' });
    cropX2.querySelector('[data-act=cancel]').click();
    await waitFor(function () {
      return box3.querySelectorAll('.img-thumb[data-pidx]').length === 1 ? true : null;
    }, { label: '第 2 张取消后应只留 1 张' });
    w.Storage.compressImage = origCompress;
    console.log('PASS ' + cur);
  }

  /* ==================== 4 无购买日期填年数提示 ==================== */
  cur = '4. 无购买日期填年数：必填已关 → 保存成功但未推算 + toast 提示；有日期正常推算；必填开启仍拦截';
  {
    // ① 「购买日期必填」关闭：填年数无日期 → 存得上、不推算、toast 提示
    const w = makeWindow({
      data: {
        settings: {
          idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} }, planSections: [],
          rememberAccount: true, navOrder: [],
          requiredFields: { name: true, category: true, purchaseDate: false, purchasePrice: true }
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage, doc = w.document;
    w.Views.openItemEditor(null, 'life');
    let m = await waitFor(function () {
      const mm = lastModal(doc);
      return mm && mm.querySelector('[name=name]') ? mm : null;
    }, { label: '物品编辑弹窗未出现' });
    m.querySelector('[name=name]').value = '无日期霜';
    m.querySelector('[name=categoryId]').value = 'skin';
    m.querySelector('[name=purchaseDate]').value = ''; // 新建默认预填今天，须显式清掉
    m.querySelector('[name=purchasePrice]').value = '10';
    m.querySelector('[name=shelfYears]').value = '3';
    m.querySelector('[data-act=save]').click();
    await waitFor(function () {
      return S.getDB().items.some(function (i) { return i.name === '无日期霜'; });
    }, { label: '必填关闭时保存未成功' });
    await waitNoModal(doc);
    const it = S.getDB().items.find(function (i) { return i.name === '无日期霜'; });
    assert(toastTexts(doc).indexOf('未填购买日期，保质期年数已保存但未推算限用日期') >= 0,
      '必填关闭 + 无日期填年数应 toast 提示，实为: ' + toastTexts(doc));
    assert(it.shelfYears === 3, '年数应保存，实为 ' + it.shelfYears);
    assert(!it.expiryDate, '无购买日期不得推算限用日期，实为 ' + it.expiryDate);

    // ② 补上购买日期：正常推算
    w.Views.openItemEditor(it.id, 'life');
    m = await waitFor(function () {
      const mm = lastModal(doc);
      return mm && mm.querySelector('[name=name]') ? mm : null;
    }, { label: '编辑弹窗未出现' });
    m.querySelector('[name=purchaseDate]').value = '2024-01-15';
    m.querySelector('[data-act=save]').click();
    await waitFor(function () {
      return (S.getDB().items.find(function (i) { return i.id === it.id; }) || {}).expiryDate === '2027-01-15';
    }, { label: '有购买日期应推算限用日期 2027-01-15' });
    await waitNoModal(doc);
    console.log('PASS ' + cur);

    // ③ 「购买日期必填」开启：仍被校验拦截，不弹「已保存」类提示
    cur = '4b. 必填开启：无购买日期仍被拦截（不弹保质期保存提示）';
    const w2 = makeWindow({});
    if (!(await waitMain(w2))) throw new Error('no main');
    const doc2 = w2.document;
    w2.Views.openItemEditor(null, 'life');
    const m2 = await waitFor(function () {
      const mm = lastModal(doc2);
      return mm && mm.querySelector('[name=name]') ? mm : null;
    }, { label: '物品编辑弹窗未出现' });
    m2.querySelector('[name=name]').value = '拦截霜';
    m2.querySelector('[name=categoryId]').value = 'skin';
    m2.querySelector('[name=purchaseDate]').value = '';
    m2.querySelector('[name=purchasePrice]').value = '10';
    m2.querySelector('[name=shelfYears]').value = '3';
    m2.querySelector('[data-act=save]').click();
    await waitFor(function () {
      return toastTexts(doc2).indexOf('购买日期必填') >= 0 ? true : null;
    }, { label: '必填开启应被校验拦截' });
    await sleep(120);
    assert(!w2.Storage.getDB().items.some(function (i) { return i.name === '拦截霜'; }), '拦截后不得落库');
    assert(toastTexts(doc2).indexOf('已保存但未推算限用日期') < 0,
      '拦截场景不得弹「保质期年数已保存」提示，实为: ' + toastTexts(doc2));
    console.log('PASS ' + cur);
  }

  /* ==================== 5 保存队列防并发竞态 ==================== */
  cur = '5. 保存队列：同一时刻仅一个 /api/save 在途、按序落盘、失败不卡死队列';
  {
    const events = [];
    const disk = {};
    let active = 0, maxActive = 0, seq = 0, failNext = false;
    const w = makeWindow({
      routes: {
        'api/save': function (r) {
          const my = ++seq;
          active++; maxActive = Math.max(maxActive, active);
          events.push('start:' + r.body.target);
          return new Promise(function (res) {
            setTimeout(function () {
              active--;
              events.push('end:' + r.body.target);
              if (failNext) {
                failNext = false;
                res(r.fail({ ok: false, error: '磁盘罢工' }, 500));
                return;
              }
              disk[r.body.target] = JSON.parse(JSON.stringify(r.body.data));
              res(r.ok({ ok: true }));
            }, my === 1 ? 60 : 12); // 首单更慢：旧并行实现会后发先至、磁盘回退旧值
          });
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    await S.loadAll();
    await sleep(60); // 让启动期落盘归零后再计数
    events.length = 0; seq = 0; maxActive = 0;

    // ① 快速连点（并发 persist）：严格串行、磁盘不回退旧值
    S.getDB().items.push({ id: 'q1', name: 'v1' });
    const p1 = S.persist('items'); // 入队快照 v1
    S.getDB().items[0].name = 'v2';
    const p2 = S.persist('items'); // 入队快照 v2
    const p3 = S.persist('wallet');
    await Promise.all([p1, p2, p3]);
    assert(maxActive <= 1, '同一时刻只允许一个 /api/save 在途，实为 ' + maxActive);
    assert(events.join(',') === 'start:items,end:items,start:items,end:items,start:wallet,end:wallet',
      '落盘必须严格串行（start/end 交替、按入队序），实为 ' + events.join(','));
    assert(disk.items && disk.items[0].name === 'v2',
      '快速连点后磁盘应是最新快照（不得回退旧值），实为 ' + JSON.stringify(disk.items && disk.items[0]));
    assert(disk.wallet, '第 3 单（wallet）应照常落盘');

    // ② 失败不卡死队列：中间一单失败，后续照常落盘
    events.length = 0;
    failNext = true;
    S.getDB().items.push({ id: 'q2', name: 'v3' });
    const pA = S.persist('items'); // 这单会失败
    const pB = S.persist('wallet');
    const rA = await pA.then(function () { return 'ok'; }, function () { return 'fail'; });
    const rB = await pB.then(function () { return 'ok'; }, function () { return 'fail'; });
    assert(rA === 'fail', '失败单应向调用方拒绝（回滚语义由业务层处理）');
    assert(rB === 'ok', '失败不得卡死后队列（后续单应照常落盘），实为 ' + rB);
    assert(disk.wallet, '失败后的下一单应已落盘');
    // 队列未卡死：失败后继续存仍成功
    const pC = S.persist('settings');
    const rC = await pC.then(function () { return 'ok'; }, function () { return 'fail'; });
    assert(rC === 'ok' && disk.settings, '失败后队列应继续可用，实为 ' + rC);
    console.log('PASS ' + cur);
  }

  console.log('========== v1.1.9 交互细节 5 项 全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
