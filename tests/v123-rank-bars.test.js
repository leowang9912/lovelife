/* v123-rank-bars.test.js — v1.1.8 排行条同起点对齐 回归锁：
   1) C.rankBars 输出：名称包 .rank-label-text + title 全名（固定宽列 + 悬停滚动挂钩点）
   2) CSS：.rank-label 固定宽 96px（flex 0 0 96px）、s 档收窄 72px、.rank-label-text 展示块
   3) budget 预算进度行（views-plan 内联自绘）与 rankBars 同结构（rank-label 内包 span）
   4) 悬停自动滚动绑定存在（UI.bindRankMarquee：测量溢出后 Web Animations 平移） */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWindow, waitFor, waitMain, assert } = require('./helpers/harness');

let cur = '';

async function main() {
  /* 1) rankBars 输出结构 */
  cur = '1. rankBars 输出：.rank-label-text + title 全名';
  {
    const w = makeWindow({ data: { items: [], wallet: { cats: { expense: [], income: [] }, bills: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const C = w.Charts || w.charts;
    assert(C && C.rankBars, 'Charts.rankBars 未暴露');
    const html = C.rankBars([
      { label: '王柯淳的超长美妆名称示例', value: 70, valueText: '¥70' },
      { label: '1', value: 50, valueText: '¥50' }
    ]);
    const doc = w.document.createElement('div');
    doc.innerHTML = html;
    const labels = doc.querySelectorAll('.rank-label');
    assert(labels.length === 2, '2 行 rank-label: ' + labels.length);
    labels.forEach(function (lab) {
      assert(lab.querySelector('.rank-label-text'), '名称必须包 .rank-label-text');
      assert(lab.getAttribute('title') !== null, '名称列必须带 title 全名');
    });
    assert(labels[0].querySelector('.rank-label-text').textContent.indexOf('王柯淳') >= 0, '名称内容保留');
    console.log('PASS 1. ' + cur);
  }

  /* 2) CSS 固定宽 */
  cur = '2. CSS：.rank-label 固定宽 96px + s 档 72px + .rank-label-text';
  {
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'css', 'styles.css'), 'utf8');
    const lab = css.match(/\.rank-label\s*\{[^}]+\}/);
    assert(lab, '缺 .rank-label 规则');
    assert(/flex:\s*0 0 96px/.test(lab[0]) && /width:\s*96px/.test(lab[0]), '名称列必须固定 96px（条形同起点）: ' + lab[0]);
    assert(/\.plan-sec\[data-size="s"\]\s*\.rank-label\s*\{[^}]*72px/.test(css), 's 档名称列应收窄 72px');
    assert(/\.rank-label-text\s*\{\s*display:\s*inline-block/.test(css), '缺 .rank-label-text 展示规则');
    console.log('PASS 2. ' + cur);
  }

  /* 3) budget 内联行同结构 */
  cur = '3. budget 预算进度行与 rankBars 同结构（rank-label 内包 span）';
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'views-plan.js'), 'utf8');
    const seg = src.split("if (id === 'budget')")[1] || '';
    const rows = seg.split("if (id === 'game')")[0] || '';
    assert(rows.indexOf('rank-label') >= 0, 'budget 行应有 rank-label');
    assert((rows.match(/rank-label-text/g) || []).length >= 2, 'budget 两分支（有/无预算）都必须包 rank-label-text');
    assert(rows.indexOf('title=') >= 0, 'budget 名称列应带 title 全名');
    console.log('PASS 3. ' + cur);
  }

  /* 4) 悬停自动滚动绑定 */
  cur = '4. UI.bindRankMarquee：测量溢出后驱动滚动（全局委托挂载）';
  {
    const ui = fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'ui.js'), 'utf8');
    assert(ui.indexOf('function bindRankMarquee') >= 0, '缺 bindRankMarquee');
    assert(/bindRankMarquee:\s*bindRankMarquee/.test(ui), 'bindRankMarquee 未导出');
    assert(ui.indexOf('t.animate') >= 0, '滚动应走 Web Animations（测量溢出量平移）');
    const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'app.js'), 'utf8');
    assert(app.indexOf('UI.bindRankMarquee(document)') >= 0, 'app.js 必须全局挂载 bindRankMarquee');
    console.log('PASS 4. ' + cur);
  }

  console.log('========== v123-rank-bars：4 项全部通过 ==========');
}

main().catch(function (e) {
  console.log('FAIL ' + cur + ': ' + (e && e.message || e));
  process.exit(1);
});
