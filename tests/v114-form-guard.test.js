/* v114-form-guard.test.js — v1.1.4 P0 修复锁：表单内按钮不得触发原生提交
   （症状：首页→穿搭打卡→点衣服分类筛选 → 表单提交整页导航，用户看到"软件重启"）
   根因：picker 分类 tab 是无 type 的 <button>（表单内默认 submit）；
   修复：①modal 内所有 form 拦截 submit ②交互按钮 type="button"
   JSDOM 不实现表单导航，故直接断言 type 与 submit 事件 defaultPrevented。 */
const { makeWindow, waitMain, sleep, assert } = require('./helpers/harness');

async function main() {
  const w = makeWindow({
    data: {
      items: [
        { id: 'c1', kind: 'clothing', categoryId: 'top', subCategoryId: 'top_tee', name: '白T', images: [], status: 'in_use', purchaseDate: '2025-06-01', purchasePrice: 100, useCount: 0, wearCount: 0 },
        { id: 'c2', kind: 'clothing', categoryId: 'shoes', subCategoryId: '', name: '跑鞋', images: [], status: 'in_use', purchaseDate: '2025-06-01', purchasePrice: 300, useCount: 0, wearCount: 0 },
        { id: 'l1', kind: 'life', categoryId: 'skin', subCategoryId: 'skin_other', name: '面霜', images: [], status: 'in_use', purchaseDate: '2025-06-01', purchasePrice: 80, useCount: 0, wearCount: 0 }
      ],
      categories: {
        clothing: [
          { id: 'top', name: '上装', icon: 'shirt', children: [{ id: 'top_tee', name: 'T恤' }] },
          { id: 'shoes', name: '鞋靴', icon: 'footprints', children: [] }
        ],
        life: [{ id: 'skin', name: '护肤', icon: 'heart', children: [{ id: 'skin_other', name: '其他' }] }]
      }
    }
  });
  let windowErr = null;
  w.addEventListener('error', function (e) { windowErr = e.message; });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;

  // 1 首页 → 穿搭打卡弹窗
  w.App.go('home');
  await sleep(400);
  doc.getElementById('hc-outfit').click();
  await sleep(500);
  const modal = Array.from(doc.querySelectorAll('.modal')).pop();
  assert(modal, '穿搭打卡弹窗未打开');
  console.log('PASS 1. 首页穿搭打卡弹窗打开');

  // 2 picker 分类 tab 全部是 type="button"（表单内不许默认 submit）
  const tabs = modal.querySelectorAll('.ptab');
  assert(tabs.length >= 2, 'picker 分类 tab 缺失');
  tabs.forEach(function (t) {
    assert(String(t.getAttribute('type')).toLowerCase() === 'button',
      'ptab 缺 type=button: ' + t.outerHTML.slice(0, 80));
  });
  console.log('PASS 2. picker 分类 tab 均为 type=button（' + tabs.length + ' 个）');

  // 3 弹窗内 form 的 submit 被拦截（defaultPrevented），点击分类 tab 不触发原生提交
  const form = modal.querySelector('form');
  assert(form, '穿搭弹窗缺 form');
  const submitEv = new w.Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(submitEv);
  assert(submitEv.defaultPrevented, 'form submit 未被拦截（会整页导航=用户看到软件重启）');
  console.log('PASS 3. form submit 被拦截（defaultPrevented）');

  // 4 点分类筛选与勾选物品全程无异常、结果正确
  for (const t of tabs) {
    t.click();
    await sleep(80);
  }
  const card = modal.querySelector('.pick-card');
  if (card) { card.click(); await sleep(80); }
  assert(!windowErr, '点击筛选/勾选过程抛异常: ' + windowErr);
  console.log('PASS 4. 分类筛选/勾选全程无异常');

  // 5 服装 tab 筛选结果正确（上装 1 件）
  const clothTabs = modal.querySelectorAll('#cloth-picker .ptab');
  clothTabs.forEach(function (t) { if (t.textContent.trim() === '上装') t.click(); });
  await sleep(80);
  const n = modal.querySelectorAll('#cloth-picker .pick-card').length;
  assert(n === 1, '上装筛选应剩 1 件，实际 ' + n);
  console.log('PASS 5. 分类筛选结果正确');

  console.log('========== v1.1.4 表单误提交修复锁 全部通过 ==========');
  process.exit(0);
}
main().catch(function (e) { console.error('FAIL:', e.message); process.exit(1); });
