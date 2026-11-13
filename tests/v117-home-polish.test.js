/* v117-home-polish.test.js — v1.1.5 测试反馈三修：
   ① 倒计时支持每年循环（生日/纪念日按下一周年算）
   ② 热力打卡交互：乐观更新+toast、不整页刷新（延迟消除）
   ③ 窄窗排布：天气卡内推荐区保底宽度换行（天气上/推荐下），不压竖条 */
const { makeWindow, waitMain, sleep, waitFor, assert } = require('./helpers/harness');
const fs = require('fs');
const path = require('path');

function pad(n) { return String(n).padStart(2, '0'); }
const TODAY = (function () { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); })();

/* 颜色归一（hex/rgb 互认）+ 格子底色读取（与 v118-habit-sim 同款） */
function normColor(s) {
  s = String(s || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [m[1][0] + m[1][0], m[1][1] + m[1][1], m[1][2] + m[1][2]].map(function (x) { return parseInt(x, 16); }).join(',');
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)].join(',');
  m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(s);
  if (m) return m[1] + ',' + m[2] + ',' + m[3];
  return s;
}
function bgOf(el) {
  let s = (el.style && el.style.background) || '';
  if (!s) {
    const m = /(?:^|;)\s*background\s*:([^;"]+)/i.exec(el.getAttribute('style') || '');
    s = m ? m[1] : '';
  }
  return normColor(s);
}

async function main() {
  /* 1 CSS：推荐卡保底不被压扁（窄窗横滚而非压竖条）——v1.2.01 形态映射：
     旧 .weather-recs 两栏布局已改 panel-head + rec-strip 横滚，语义=卡片尺寸保底 */
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'css', 'extra.css'), 'utf8');
  const rseg = css.split('.rec-strip')[1] || '';
  assert(/overflow-x:\s*auto/.test(rseg), 'rec-strip 缺横向滚动（窄窗应横滚不裁切）');
  const rcard = css.split('.rec-card')[1] || '';
  assert(/flex-shrink:\s*0/.test(rcard), 'rec-card 缺 flex-shrink:0 保底（窄窗会压成竖条）');
  assert(/width:\s*\d+px/.test(rcard), 'rec-card 缺固定宽度保底');
  console.log('PASS 1. 窄窗排布：推荐卡保底宽度横滚不变形');

  /* 2 周期倒计时：每年重复按下一周年计算剩余 */
  const w = makeWindow({
    data: {
      settings: {
        countdowns: [
          { id: 'c1', name: '生日', date: '2000-12-25', repeat: 'year' },   // 今年未过→12-25
          { id: 'c2', name: '考试', date: '2026-12-01', repeat: '' }         // 一次性
        ]
      }
    }
  });
  if (!(await waitMain(w))) throw new Error('no main');
  const doc = w.document;
  w.App.go('home');
  await sleep(400);
  const cards = Array.from(doc.querySelectorAll('.cd-card'));
  assert(cards.length === 2, '倒计时卡应 2 张，实际 ' + cards.length);
  const yearlyCard = cards.find(function (c) { return c.textContent.indexOf('生日') >= 0; });
  assert(yearlyCard && yearlyCard.textContent.indexOf('每年') >= 0, '周期倒计时应带「每年」标签');
  assert(yearlyCard.textContent.indexOf('2000') < 0, '周期卡不应显示原始年份');
  // hero 简报取最近一个（考试 12-01 近于生日 12-25）
  const brief = doc.querySelector('.home-cd-brief');
  assert(brief && brief.textContent.indexOf('考试') >= 0, '日期行应显示最近的倒计时（考试），实际 ' + (brief && brief.textContent));
  console.log('PASS 2. 周期倒计时（每年标签/按周年算/日期行取最近）');

  /* 3 热力打卡乐观更新：今日格点击即时变色（习惯色填充）+不整页刷新 */
  const hb = doc.querySelector('#home-habits');
  assert(hb, '热力打卡卡未渲染');
  const cell = hb.querySelector('.hb-cell[data-date="' + TODAY + '"]');
  assert(cell, '缺今日格');
  const card = cell.closest('[data-hb-card]');
  const hc = ((/--hc:\s*([^;"]+)/.exec(card.getAttribute('style') || '')) || [])[1] || '#aecbfa';
  const before = doc.body.innerHTML.length;
  cell.click();
  await sleep(150); // 远小于整页刷新耗时：验证 DOM 局部变化
  assert(cell.classList.contains('on'), '点击后今日格应即时变已打态');
  assert(bgOf(cell) === normColor(hc), '点击后今日格应即时变习惯色（今日已打=习惯色填充）');
  assert(w.Storage.habitCountOf(card.getAttribute('data-hb-card'), TODAY) === 1, '数据行应同步本月打卡（周视图无统计行，数据锁）');
  await sleep(400);
  assert(doc.body.innerHTML.length >= before - 200, '不应整页重绘（DOM 主体应保持）');
  console.log('PASS 3. 热力打卡乐观更新（今日格即时变习惯色、无整页刷新延迟）');

  /* 4 选衣 picker 按种类排序：一级树序 → 二级树序 → 名称（v1.1.5） */
  const w2 = makeWindow({
    data: {
      items: [
        { id: 'c1', kind: 'clothing', categoryId: 'shoes', subCategoryId: '', name: '跑鞋', images: [], status: 'in_use', purchaseDate: '2025-01-01', purchasePrice: 300, useCount: 0, wearCount: 0 },
        { id: 'c2', kind: 'clothing', categoryId: 'top', subCategoryId: 'top_tee', name: 'Z黑T', images: [], status: 'in_use', purchaseDate: '2025-01-01', purchasePrice: 100, useCount: 0, wearCount: 0 },
        { id: 'c3', kind: 'clothing', categoryId: 'top', subCategoryId: 'top_tee', name: 'A白T', images: [], status: 'in_use', purchaseDate: '2025-01-01', purchasePrice: 100, useCount: 0, wearCount: 0 }
      ],
      categories: {
        clothing: [
          { id: 'top', name: '上装', icon: 'shirt', children: [{ id: 'top_tee', name: 'T恤' }] },
          { id: 'shoes', name: '鞋靴', icon: 'footprints', children: [] }
        ]
      }
    }
  });
  if (!(await waitMain(w2))) throw new Error('no main 2');
  const doc4 = w2.document;
  w2.App.go('home');
  await sleep(350);
  doc4.getElementById('hc-outfit').click();
  await sleep(450);
  const m4 = Array.from(doc4.querySelectorAll('.modal')).pop();
  const names = Array.from(m4.querySelectorAll('#cloth-picker .pick-name')).map(function (e) { return e.textContent.trim(); });
  assert(names.join(',') === 'A白T,Z黑T,跑鞋', '「全部」应按种类排序（一级→二级→名称），实际 ' + names.join(','));
  console.log('PASS 4. 选衣 picker 按种类排序（一级→二级→名称）');

  console.log('========== v1.1.5 测试反馈四修 回归锁 全部通过 ==========');
  process.exit(0);
}
main().catch(function (e) { console.error('FAIL:', e.message); process.exit(1); });
