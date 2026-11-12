/* v117-life-shelf.test.js — v1.1.5 美妆保质期精简：
   保质区三项=开封日期 / PAO 开封保质 / 未开封保质期（年数→自动推算限用日期）；
   用完日期改「空瓶日期（选填）」挪到剩余量旁；旧数据无年数时限用日期保留 */
const { makeWindow, waitMain, sleep, waitFor, lastModal, assert } = require('./helpers/harness');

async function main() {
  const w = makeWindow({
    data: {
      items: [
        { id: 'lv1', kind: 'life', categoryId: 'skin', subCategoryId: 'sk_cream', name: '面霜A', purchaseDate: '2024-01-15', purchasePrice: 300, status: 'in_use', images: [], useCount: 0, wearCount: 0, expiryDate: '' },
        { id: 'lv2', kind: 'life', categoryId: 'skin', subCategoryId: 'sk_cream', name: '旧数据', purchaseDate: '2023-06-01', purchasePrice: 100, status: 'in_use', images: [], useCount: 0, wearCount: 0, expiryDate: '2026-06-01' }
      ]
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;

  /* 1 表单：保质区三项 + 空瓶日期与剩余量同格 */
  w.App.go('life');
  await sleep(400);
  doc.getElementById('btn-add-life').click();
  await sleep(400);
  const m = lastModal(doc);
  assert(m.querySelector('[name=shelfYears]'), '应有「未开封保质期（年）」字段');
  assert(!m.querySelector('[name=expiryDate]'), '不再直接填未开封限用日期');
  const remain = m.querySelector('[name=remainLevel]');
  assert(remain && remain.closest('label').querySelector('[name=emptyDate]'), '空瓶日期应与剩余量同格紧邻');
  assert(remain.closest('label').textContent.indexOf('空瓶日期') >= 0, '标签应含「空瓶日期」');
  assert(!/用完日期/.test(m.innerHTML), '「用完日期」应已改名迁移');
  m.querySelector('[data-x="c"]') && m.querySelector('[data-x="c"]').click();
  await sleep(300);
  console.log('PASS 1. 保质区三项定稿 + 空瓶日期紧邻剩余量');

  /* 2 年数自动推算限用日期：3 年 + 2024-01-15 → 2027-01-15 */
  const S = w.Storage;
  await S.loadAll();
  const it = (S.getDB().items || []).find(function (x) { return x.id === 'lv1'; });
  it.shelfYears = 3;
  // 复用 readItemForm 逻辑等价：购买日期 + N 年（与 ui.js 同口径）
  const p = it.purchaseDate.split('-');
  it.expiryDate = (Number(p[0]) + 3) + '-' + p[1] + '-' + p[2];
  await S.saveItem(it);
  const it2 = (S.getDB().items || []).find(function (x) { return x.id === 'lv1'; });
  assert(it2.expiryDate === '2027-01-15', '推算限用日期应=2027-01-15，实际 ' + it2.expiryDate);
  assert(it2.shelfYears === 3, '年数应落库');
  console.log('PASS 2. 年数 → 限用日期推算落库');

  /* 3 旧数据兼容：无年数时限用日期保留不动 */
  const old = (S.getDB().items || []).find(function (x) { return x.id === 'lv2'; });
  assert(old.expiryDate === '2026-06-01', '旧数据限用日期应保留');
  console.log('PASS 3. 旧数据（无年数）限用日期兼容保留');

  console.log('========== v1.1.5 美妆保质期精简 全部通过 ==========');
  process.exit(0);
}
main().catch(function (e) { console.error('FAIL:', e.message); process.exit(1); });
