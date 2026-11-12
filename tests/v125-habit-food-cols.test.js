/* v125-habit-food-cols.test.js — v1.1.8 P2-11/12 习惯类/美食类加栏 + 导航挪位 回归锁：
   1) 习惯类新栏：习惯连续排行（当前/最长）+ 习惯完成率（本月 % 环比）
   2) 美食类新栏：美食消费曲线 / 菜品评分排行（Top8+其余合计）/ 热量趋势（周|月|年）
   3) 周期导航挪到 head 右上（.hh-head-nav 与视图切换器同排，body 无 hh-nav）
   4) 年视图无「列=周 · 行=周一至周日」结构备注
   5) head 月份 ‹ › 翻页联动 body 月历
   6) 五个新栏默认启用（DEFAULT_ON） */
'use strict';
const { makeWindow, waitFor, waitMain, assert } = require('./helpers/harness');

let cur = '';

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function tabTo(doc, id) {
  const b = doc.querySelector('[data-plan-stab="' + id + '"]');
  if (b) b.click();
}

async function openPlan(w) {
  const doc = w.document;
  if (!doc.querySelector('#plan-wrap')) {
    w.App.go('plan');
    await waitFor(function () { return !!doc.querySelector('#plan-wrap'); }, { label: '统计页加载' });
  }
  return doc;
}

async function main() {
  const now = new Date();
  const d1 = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const d2 = ymd(new Date(now.getFullYear(), now.getMonth(), 2));
  const DATA = {
    habits: {
      defs: [
        { id: 'h1', name: '运动', color: '#aecbfa', type: 'check', max: 5, showNum: true },
        { id: 'h2', name: '阅读', color: '#d7aefb', type: 'count', max: 5, showNum: true }
      ],
      log: { h1: { [d1]: true, [d2]: true }, h2: { [d1]: 3 } }
    },
    food: [
      { id: 'f1', date: d1, name: '鸡腿饭', price: 25, rating: 4.5, calories: 650, meal: '午餐' },
      { id: 'f2', date: d2, name: '沙拉', price: 32, rating: 5, calories: 320, meal: '晚餐' },
      { id: 'f3', date: d2, name: '面', price: 18, rating: 3, calories: 500, meal: '午餐' }
    ],
    items: [], categories: { digital: [], clothing: [], life: [], occasion: [] },
    wallet: { cats: { expense: [], income: [] }, bills: [], accounts: [] },
    settings: {}
  };

  /* 1) 习惯类新栏 */
  cur = '1. 习惯类新栏：连续排行 + 完成率';
  {
    const w = makeWindow({ data: JSON.parse(JSON.stringify(DATA)) });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    tabTo(doc, 'habit');
    const hb = doc.querySelector('.plan-block[data-block=habit]');
    await waitFor(function () {
      return hb.querySelector('[data-body=streakRank] .rank-row') && hb.querySelector('[data-body=habitRate] .rank-row') ? true : null;
    }, { label: '习惯新栏未渲染' });
    assert(hb.querySelector('[data-body=streakRank]').textContent.indexOf('最长') >= 0, '连续排行应带历史最长');
    const rate = hb.querySelector('[data-body=habitRate]');
    assert(rate.textContent.indexOf('%') >= 0, '完成率应为百分比');
    console.log('PASS 1. ' + cur);
  }

  /* 2) 美食类新栏 */
  cur = '2. 美食类新栏：消费曲线 / 评分排行（其余合计）/ 热量趋势（周|月|年）';
  {
    const w = makeWindow({ data: JSON.parse(JSON.stringify(DATA)) });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    tabTo(doc, 'food');
    const fb = doc.querySelector('.plan-block[data-block=food]');
    await waitFor(function () {
      return fb.querySelector('[data-body=foodTrend] svg') && fb.querySelector('[data-body=foodRating] .rank-row') &&
        fb.querySelector('[data-body=foodCal] svg') ? true : null;
    }, { label: '美食新栏未渲染' });
    assert(fb.querySelector('[data-sr-id=foodTrend]'), '美食消费曲线应有周期切换器');
    assert(fb.querySelector('[data-sr-id=foodCal]'), '热量趋势应有周期切换器');
    const rating = fb.querySelector('[data-body=foodRating]');
    assert(rating.textContent.indexOf('沙拉') >= 0, '评分榜首应为 5 分的沙拉');
    assert(rating.textContent.indexOf('分') >= 0, '评分榜应带分值');
    assert(fb.querySelector('[data-body=foodTrend] .stat-delta'), '消费曲线应带环比');
    console.log('PASS 2. ' + cur);
  }

  /* 3) 导航挪到 head 右上 */
  cur = '3. 周期导航在 head 右上（.hh-head-nav 与切换器同排，body 无 hh-nav）';
  {
    const w = makeWindow({ data: JSON.parse(JSON.stringify(DATA)) });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    tabTo(doc, 'habit');
    await waitFor(function () {
      return doc.querySelector('.hh-head-nav') ? true : null;
    }, { label: 'head 导航未渲染' });
    const sec = doc.querySelector('.plan-sec[data-id=habitHeat]');
    assert(sec.querySelector('.panel-head .hh-head-nav'), '导航应在 panel-head 内');
    assert(sec.querySelector('.panel-head .hh-toggle'), '视图切换器应在 panel-head 内');
    assert(!sec.querySelector('[data-body=habitHeat] .hh-nav'), 'body 不应再有 hh-nav（排布混乱根源）');
    console.log('PASS 3. ' + cur);
  }

  /* 4) 年视图无结构备注 */
  cur = '4. 年视图无「列=周 · 行=周一至周日」备注';
  {
    const w = makeWindow({ data: JSON.parse(JSON.stringify(DATA)) });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    tabTo(doc, 'habit');
    await waitFor(function () {
      return doc.querySelector('[data-body=habitHeat] svg[data-habit-grid]') ? true : null;
    }, { label: '年视图未渲染' });
    const sec = doc.querySelector('.plan-sec[data-id=habitHeat]');
    assert(sec.textContent.indexOf('列=周') < 0, '不应有「列=周」结构备注');
    assert(sec.textContent.indexOf('周一至周日') < 0, '不应有「周一至周日」结构备注');
    console.log('PASS 4. ' + cur);
  }

  /* 5) head 月份导航翻页联动 */
  cur = '5. head 月份 ‹ › 翻页联动 body 月历';
  {
    const w = makeWindow({ data: JSON.parse(JSON.stringify(DATA)) });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = await openPlan(w);
    tabTo(doc, 'habit');
    await waitFor(function () { return doc.querySelector('.hh-head-nav') ? true : null; }, { label: 'nav 未渲染' });
    doc.querySelector('.plan-sec[data-id=habitHeat] [data-hh-view="month"]').click();
    await waitFor(function () {
      return doc.querySelector('.hh-head-nav [data-hhm=prev]') && doc.querySelector('[data-body=habitHeat] .hh-cal-grid') ? true : null;
    }, { label: '月视图未渲染' });
    const label0 = doc.querySelector('.hh-head-nav strong').textContent;
    doc.querySelector('.hh-head-nav [data-hhm=prev]').click();
    await waitFor(function () {
      return doc.querySelector('.hh-head-nav strong').textContent !== label0 ? true : null;
    }, { label: '翻上月未生效' });
    console.log('PASS 5. ' + cur);
  }

  /* 6) 新栏默认启用 */
  cur = '6. 五个新栏默认启用（DEFAULT_ON）';
  {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'app', 'js', 'views-plan.js'), 'utf8');
    ['streakRank', 'habitRate', 'foodTrend', 'foodRating', 'foodCal'].forEach(function (id) {
      const m = src.match(/const DEFAULT_ON = \[[^\]]+\]/);
      assert(m && m[0].indexOf("'" + id + "'") >= 0, id + ' 应默认启用');
    });
    console.log('PASS 6. ' + cur);
  }

  console.log('========== v125-habit-food-cols：6 项全部通过 ==========');
}

main().catch(function (e) {
  console.log('FAIL ' + cur + ': ' + (e && e.message || e));
  process.exit(1);
});
