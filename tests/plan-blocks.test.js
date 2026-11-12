/* plan-blocks.test.js — 我的统计 4 板块分组 + 块级屏蔽
   （已迁移到 tests/helpers/harness.js；settings 持久化经 opts.routes 接回 /api/db） */
'use strict';
const { makeWindow, waitFor, waitMain } = require('./helpers/harness');

let settings = {
  idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} },
  planSections: [], planBlocks: {}, rememberAccount: true
};

let curN = 0, curName = '';
function begin(n, name) { curN = n; curName = name; }

async function main() {
  const w = makeWindow({
    routes: {
      // settings 落盘后回写内存变量（/api/db 每次返回最新 settings，同旧 mock 语义）
      'api/save': ({ body, ok }) => {
        if (body && body.target === 'settings') settings = body.data.settings;
        return ok({ ok: true });
      },
      'api/db': ({ ok }) => ok({
        schemaVersion: 3, account: { id: 'me', name: 'Me', icon: 'x' },
        accounts: [{ id: 'me', name: 'Me', icon: 'x' }],
        items: [], outfits: [], food: [], events: [],
        settings, categories: {
          digital: [], clothing: [], life: [],
          foodCuisine: [], foodType: [], meal: [], foodTag: [], occasion: [], season: [],
          tagPresets: [], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
        }, dataRoot: 'm'
      })
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;

  // 1) 6 板块渲染 + 归属正确（v1.1.8：习惯打卡/我的美食 独立成类）
  begin(1, '七板块渲染 + 栏目归属');
  w.App.go('plan');
  await waitFor(function () {
    const mc = doc.getElementById('main-content');
    return mc && mc.innerHTML.indexOf('总体统计') >= 0;
  }, { label: '缺少板块: 总体统计' });
  let html = doc.getElementById('main-content').innerHTML;
  for (const t of ['总体统计', '我的数码', '我的衣橱', '我的生活', '习惯打卡', '时间统计', '我的美食']) {
    if (html.indexOf(t) < 0) throw new Error('缺少板块: ' + t);
  }
  const blocks = doc.querySelectorAll('.plan-block');
  if (blocks.length !== 7) throw new Error('板块数 ' + blocks.length);
  // 栏目归属抽查：KPI 在总体块、cpw 在衣橱块、foodStats 在美食块（v1.1.8 独立）、habitHeat 在习惯块、时间栏在 time 块
  const overallHTML = doc.querySelector('.plan-block[data-block=overall]').innerHTML;
  const clothHTML = doc.querySelector('.plan-block[data-block=clothing]').innerHTML;
  const lifeHTML = doc.querySelector('.plan-block[data-block=life]').innerHTML;
  const digHTML = doc.querySelector('.plan-block[data-block=digital]').innerHTML;
  const foodHTML = doc.querySelector('.plan-block[data-block=food]').innerHTML;
  const habitHTML = doc.querySelector('.plan-block[data-block=habit]').innerHTML;
  const timeHTML = doc.querySelector('.plan-block[data-block=time]').innerHTML;
  if (timeHTML.indexOf('时间分配排行') < 0) throw new Error('时间分配排行未在时间块');
  if (overallHTML.indexOf('data-id="timeDist"') >= 0) throw new Error('时间栏不应仍在总体块');
  if (overallHTML.indexOf('KPI 总览') < 0) throw new Error('KPI 未在总体块');
  if (clothHTML.indexOf('单次穿着成本（划算优先）') < 0) throw new Error('cpw 未在衣橱块');
  if (foodHTML.indexOf('美食统计') < 0) throw new Error('美食统计未在美食块');
  if (lifeHTML.indexOf('美食统计') >= 0) throw new Error('美食统计不应仍在生活块（v1.1.8 独立）');
  if (habitHTML.indexOf('习惯打卡') < 0) throw new Error('习惯打卡栏目未在习惯块');
  if (overallHTML.indexOf('data-id="habitHeat"') >= 0) throw new Error('习惯打卡不应仍在总体块');
  if (digHTML.indexOf('游戏通关') < 0) throw new Error('游戏未在数码块');
  if (clothHTML.indexOf('单次穿着成本（划算优先）') >= 0 && digHTML.indexOf('单次穿着成本（划算优先）') >= 0) throw new Error('cpw 跨块重复');
  // v1.0.3 新栏目归属抽查
  if (clothHTML.indexOf('穿搭搭配次数排行') < 0) throw new Error('衣橱搭配排行缺失');
  if (clothHTML.indexOf('未穿着清单') < 0) throw new Error('衣橱未穿着清单缺失');
  if (lifeHTML.indexOf('开封新鲜度排行') < 0) throw new Error('生活新鲜度缺失');
  if (lifeHTML.indexOf('妆品搭配次数排行') < 0) throw new Error('生活搭配排行缺失');
  // v1.0.4 数码新栏目
  for (const t of ['数码价格排行', '单日使用成本（费钱优先）', '已购买时长排行', '购机月度曲线', '数码分类构成']) {
    if (digHTML.indexOf(t) < 0) throw new Error('数码新栏目缺失: ' + t);
  }
  console.log("PASS 1. 七板块渲染 + 栏目归属");

  // 1b 快捷按钮已移至「我的主页」（v1.1.2）：统计页不再重复放置
  begin(2, '快捷按钮已移至主页（统计页不再重复）');
  const headHTML = doc.getElementById('main-content').innerHTML;
  if (doc.querySelector('[data-act]')) throw new Error('统计页快捷按钮应已移除');
  for (const t of ['记美妆', '记数码', '记衣服']) {
    if (headHTML.indexOf(t) >= 0) throw new Error('统计页快捷按钮应已移除: ' + t);
  }
  console.log('PASS 2. 快捷按钮已移至主页（统计页不再重复）');

  // 2) 块级屏蔽（就地 👁）：栏目停渲、块内出空态卡（v1.1.8 分类 tab 常驻入口，点进不能空白）
  begin(3, '块级屏蔽（栏目停渲 + 空态卡 + 持久化）');
  doc.querySelector('[data-block-toggle=clothing]').click();
  await waitFor(function () {
    const mc = doc.getElementById('main-content');
    const blk = doc.querySelector('.plan-block[data-block=clothing]');
    return mc && mc.innerHTML.indexOf('单次穿着成本（划算优先）') < 0 &&
      blk && blk.classList.contains('block-off') && !!blk.querySelector('[data-block-toggle]') &&
      settings.planBlocks && settings.planBlocks.clothing === false;
  }, { label: '屏蔽后衣橱栏目仍在渲染/屏蔽状态未持久化' });
  html = doc.getElementById('main-content').innerHTML;
  if (html.indexOf('单次穿着成本（划算优先）') >= 0) throw new Error('屏蔽后衣橱栏目仍在渲染');
  const blk3 = doc.querySelector('.plan-block[data-block=clothing]');
  if (!blk3 || !blk3.classList.contains('block-off')) throw new Error('屏蔽块应带 block-off');
  if (!blk3.querySelector('[data-block-toggle]')) throw new Error('屏蔽块应有空态卡恢复按钮');
  if (!settings.planBlocks || settings.planBlocks.clothing !== false) throw new Error('屏蔽状态未持久化');
  console.log('PASS 3. 块级屏蔽（栏目停渲 + 空态卡 + 持久化）');

  // 3) 设置页板块开关同步
  begin(4, '设置页板块管理同步');
  w.App.go('settings');
  const cb = await waitFor(function () { return doc.querySelector('[data-block-pref=clothing]'); }, { label: '设置页缺少板块开关' });
  if (!cb) throw new Error('设置页缺少板块开关');
  if (cb.checked) throw new Error('设置页开关未同步屏蔽状态');
  cb.checked = true;
  cb.dispatchEvent(new w.Event('change'));
  await waitFor(function () {
    return settings.planBlocks && settings.planBlocks.clothing === true;
  }, { label: '设置页恢复板块失败' });
  if (settings.planBlocks.clothing !== true) throw new Error('设置页恢复板块失败');
  console.log('PASS 4. 设置页板块管理同步');

  // 4) 恢复后衣橱块重新显示
  begin(5, '屏蔽恢复');
  w.App.go('plan');
  await waitFor(function () {
    const mc = doc.getElementById('main-content');
    return mc && mc.innerHTML.indexOf('单次穿着成本（划算优先）') >= 0;
  }, { label: '恢复后衣橱块未显示' });
  html = doc.getElementById('main-content').innerHTML;
  if (html.indexOf('单次穿着成本（划算优先）') < 0) throw new Error('恢复后衣橱块未显示');
  console.log('PASS 5. 屏蔽恢复');

  console.log('========== plan-blocks：5 项全部通过 ==========');
  process.exit(0);
}

main().catch(e => { console.error('FAIL ' + curN + '. ' + curName + ': ' + e.message); process.exit(1); });
