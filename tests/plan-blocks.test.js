/* plan-blocks.test.js — 我的统计 4 板块分组 + 块级屏蔽 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const APP = path.join(__dirname, '..', 'app');

let settings = {
  idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} },
  planSections: [], planBlocks: {}, rememberAccount: true
};

function makeWindow() {
  const dom = new JSDOM(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), {
    url: 'http://127.0.0.1:8765/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  window.fetch = async (url, opts) => {
    const u = String(url);
    let body = null;
    if (opts && opts.body) { try { body = JSON.parse(opts.body); } catch (e) {} }
    const ok = (b) => ({ ok: true, status: 200, json: async () => b, blob: async () => new Blob([1]), arrayBuffer: async () => new ArrayBuffer(4) });
    if (u.includes('/api/session')) return ok({ ok: true, accounts: [{ id: 'me', name: 'Me', icon: 'x' }], lastAccountId: 'me', dataRoot: 'm', schemaVersion: 3 });
    if (u.includes('/api/ping')) return ok({ ok: true });
    if (u.includes('/api/save') && body && body.target === 'settings') { settings = body.data.settings; return ok({ ok: true }); }
    if (u.includes('/api/db')) return ok({
      schemaVersion: 3, account: { id: 'me', name: 'Me', icon: 'x' },
      accounts: [{ id: 'me', name: 'Me', icon: 'x' }],
      items: [], outfits: [], food: [], events: [],
      settings, categories: {
        digital: [], clothing: [], life: [],
        foodCuisine: [], foodType: [], meal: [], foodTag: [], occasion: [], season: [],
        tagPresets: [], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
      }, dataRoot: 'm'
    });
    return ok({ ok: true });
  };
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  window.URL.createObjectURL = () => 'blob:x';
  window.URL.revokeObjectURL = () => {};
  for (const f of ['utils.js', 'models.js', 'storage.js', 'charts.js', 'cutout.js', 'ui.js',
    'views-plan.js', 'views-main.js', 'views-life.js', 'views-food.js', 'views-settings.js', 'updater.js', 'app.js']) {
    window.eval(fs.readFileSync(path.join(APP, 'js', f), 'utf8'));
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return window;
}

async function waitMain(w) {
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 250));
    const acc = w.document.querySelector('[data-acc]');
    if (acc) { acc.click(); continue; }
    if (w.document.getElementById('main-content')) return true;
  }
  return false;
}

async function main() {
  const w = makeWindow();
  if (!(await waitMain(w))) throw new Error('no main');

  // 1) 4 板块渲染 + 归属正确
  w.App.go('plan');
  await new Promise(r => setTimeout(r, 250));
  let html = w.document.getElementById('main-content').innerHTML;
  for (const t of ['总体统计', '我的数码', '我的衣橱', '我的生活']) {
    if (html.indexOf(t) < 0) throw new Error('缺少板块: ' + t);
  }
  const blocks = w.document.querySelectorAll('.plan-block');
  if (blocks.length !== 4) throw new Error('板块数 ' + blocks.length);
  // 栏目归属抽查：KPI 在总体块、cpw 在衣橱块、foodStats 在生活块
  const overallHTML = w.document.querySelector('.plan-block[data-block=overall]').innerHTML;
  const clothHTML = w.document.querySelector('.plan-block[data-block=clothing]').innerHTML;
  const lifeHTML = w.document.querySelector('.plan-block[data-block=life]').innerHTML;
  const digHTML = w.document.querySelector('.plan-block[data-block=digital]').innerHTML;
  if (overallHTML.indexOf('KPI 总览') < 0) throw new Error('KPI 未在总体块');
  if (clothHTML.indexOf('单次穿着成本排行') < 0) throw new Error('cpw 未在衣橱块');
  if (lifeHTML.indexOf('美食统计') < 0) throw new Error('美食统计未在生活块');
  if (digHTML.indexOf('游戏通关') < 0) throw new Error('游戏未在数码块');
  if (clothHTML.indexOf('单次穿着成本排行') >= 0 && digHTML.indexOf('单次穿着成本排行') >= 0) throw new Error('cpw 跨块重复');
  // v1.0.3 新栏目归属抽查
  if (clothHTML.indexOf('穿搭搭配次数排行') < 0) throw new Error('衣橱搭配排行缺失');
  if (clothHTML.indexOf('未穿着清单') < 0) throw new Error('衣橱未穿着清单缺失');
  if (lifeHTML.indexOf('开封新鲜度排行') < 0) throw new Error('生活新鲜度缺失');
  if (lifeHTML.indexOf('妆品搭配次数排行') < 0) throw new Error('生活搭配排行缺失');
  // v1.0.4 数码新栏目
  for (const t of ['数码价格排行', '单日使用成本排行', '已购买时长排行', '购机月度曲线', '数码分类构成']) {
    if (digHTML.indexOf(t) < 0) throw new Error('数码新栏目缺失: ' + t);
  }
  console.log('OK  1 四板块渲染 + 栏目归属');

  // 1b 快捷按钮：记美妆 + 穿搭打卡/饮食打卡直开弹窗（不跳转）
  const headHTML = w.document.getElementById('main-content').innerHTML;
  for (const t of ['记美妆', '穿搭打卡', '美食打卡']) {
    if (headHTML.indexOf(t) < 0) throw new Error('缺少快捷按钮: ' + t);
  }
  // 点穿搭打卡应直接弹出录入弹窗（而非跳转到日历页）
  w.document.querySelector('[data-act=outfit]').click();
  await new Promise(r => setTimeout(r, 300));
  const modal1 = w.document.querySelector('.modal');
  if (!modal1 || modal1.textContent.indexOf('穿搭') < 0) throw new Error('穿搭打卡未直开弹窗');
  modal1.querySelector('.modal-close') && modal1.querySelector('.modal-close').click();
  await new Promise(r => setTimeout(r, 250));
  w.document.querySelector('[data-act=food]').click();
  await new Promise(r => setTimeout(r, 300));
  const modal2 = w.document.querySelector('.modal');
  if (!modal2 || modal2.textContent.indexOf('美食打卡') < 0) throw new Error('美食打卡未直开弹窗');
  modal2.querySelector('.modal-close') && modal2.querySelector('.modal-close').click();
  await new Promise(r => setTimeout(r, 250));
  console.log('OK  1b 快捷按钮齐全且打卡直开弹窗');

  // 2) 块级屏蔽（就地 👁）：正常模式下整块隐藏
  w.document.querySelector('[data-block-toggle=clothing]').click();
  await new Promise(r => setTimeout(r, 500));
  html = w.document.getElementById('main-content').innerHTML;
  if (html.indexOf('单次穿着成本排行') >= 0) throw new Error('屏蔽后衣橱栏目仍在渲染');
  if (w.document.querySelector('.plan-block[data-block=clothing]')) throw new Error('屏蔽后块仍显示（应整块隐藏）');
  if (!settings.planBlocks || settings.planBlocks.clothing !== false) throw new Error('屏蔽状态未持久化');
  console.log('OK  2 块级屏蔽（整块隐藏 + 持久化）');

  // 3) 设置页板块开关同步
  w.App.go('settings');
  await new Promise(r => setTimeout(r, 250));
  const cb = w.document.querySelector('[data-block-pref=clothing]');
  if (!cb) throw new Error('设置页缺少板块开关');
  if (cb.checked) throw new Error('设置页开关未同步屏蔽状态');
  cb.checked = true;
  cb.dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 350));
  if (settings.planBlocks.clothing !== true) throw new Error('设置页恢复板块失败');
  console.log('OK  3 设置页板块管理同步');

  // 4) 恢复后衣橱块重新显示
  w.App.go('plan');
  await new Promise(r => setTimeout(r, 250));
  html = w.document.getElementById('main-content').innerHTML;
  if (html.indexOf('单次穿着成本排行') < 0) throw new Error('恢复后衣橱块未显示');
  console.log('OK  4 屏蔽恢复');

  console.log('========== plan-blocks 全部通过 ==========');
  process.exit(0);
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
