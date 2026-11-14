/* v132-timeline.test.js — v1.2.01 时间日历回归锁：
   1) 入口 + 周视图结构（7 列/周一起/今天/时间刻度）
   2) 录入弹窗保存 → 条目渲染 + timeline 落盘（onSave 行为锁）
   3) 跨天自动拆分（23:00→01:00 = 两条）
   4) 重叠并排（两块重叠 cols=2）
   5) 待办时间点派生（todos 派生不双份）+ 点击勾完成
   6) 「待办」简化档隐藏时间段
   7) 类型自定义（新建/改名/删除归 other）
   8) 计时器开始→结束生成记录
   9) 习惯综合联动（保存 +1 / 删除回退）
   10) 记录类时间点保存/删除
   11) 统计「时间统计」卡片（类型排行 + 每日时长）*/
'use strict';
const { makeWindow, waitFor, waitMain, lastModal, waitNoModal, assert } = require('./helpers/harness');

let cur = '';

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function main() {
  const today = ymd(new Date());

  /* 1)+2) 入口 + 周视图 + 录入落盘 */
  cur = '1. 入口 + 周视图 + 录入保存落盘';
  {
    const saves = [];
    const w = makeWindow({
      data: {
        timeline: { blocks: [], points: [], types: [], timer: null },
        settings: {}
      },
      onSave: function (t, d) { saves.push({ t: t, d: d }); }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    // 侧栏入口
    assert(doc.querySelector('[data-nav=timeline]'), '侧栏缺时间日历入口');
    w.App.go('timeline');
    await waitFor(function () {
      return doc.getElementById('tl-card') && doc.querySelector('.tl-week') ? true : null;
    }, { label: '时间日历未渲染' });
    const cols = doc.querySelectorAll('.tl-col');
    assert(cols.length === 7, '周视图应 7 列，实为 ' + cols.length);
    assert(doc.querySelector('.tl-gutter .tl-hour'), '缺时间刻度');
    assert(doc.querySelector('.tl-day-head.on'), '今天列未高亮');
    // 默认类型已补全
    assert(w.Storage.timeline().types.length >= 10, '默认类型应自动补全');
    // 「+」录入
    doc.getElementById('tl-add-block').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#tl-date') ? m : null;
    }, { label: '录入弹窗未出现' });
    const m = lastModal(doc);
    m.querySelector('#tl-date').value = today;
    m.querySelector('#tl-start').value = '09:00';
    m.querySelector('#tl-end').value = '10:30';
    m.querySelector('#tl-type').value = 'work';
    m.querySelector('#tl-note').value = '晨会';
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return doc.querySelector('.tl-block') ? true : null;
    }, { label: '条目未渲染' });
    const blk = doc.querySelector('.tl-block');
    assert(blk.textContent.indexOf('专注工作') >= 0, '条目应显示类型名: ' + blk.textContent);
    assert(blk.textContent.indexOf('90分钟') >= 0 || blk.textContent.indexOf('1小时30分钟') >= 0, '应显示时长: ' + blk.textContent);
    // 落盘行为锁：timeline 真发请求
    await waitFor(function () {
      return saves.some(function (x) { return x.t === 'timeline' && x.d && x.d.blocks && x.d.blocks.length === 1; });
    }, { label: 'timeline 未落盘' });
    console.log('PASS 1. ' + cur);
  }

  /* 3) 跨天拆分 */
  cur = '2. 跨天自动拆分（23:00→01:00 = 两天各一条）';
  {
    const w = makeWindow({
      data: {
        timeline: { blocks: [], points: [], types: [{ id: 'sleep', name: '睡觉', icon: 'moon', color: '#8e8e93' }], timer: null }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('timeline');
    await waitFor(function () { return doc.getElementById('tl-week') ? true : null; }, { label: '周视图未渲染' });
    doc.getElementById('tl-add-block').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#tl-date') ? m : null;
    }, { label: '录入弹窗未出现' });
    const m = lastModal(doc);
    m.querySelector('#tl-date').value = today;
    m.querySelector('#tl-start').value = '23:00';
    m.querySelector('#tl-end').value = '01:00';
    m.querySelector('#tl-type').value = 'sleep';
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return w.Storage.timeline().blocks.length === 2 ? true : null;
    }, { label: '跨天未拆成两条' });
    const bs = w.Storage.timeline().blocks;
    const d1 = bs.filter(function (b) { return b.date === today; })[0];
    const d2 = bs.filter(function (b) { return b.date !== today; })[0];
    assert(d1 && d1.start === '23:00' && d1.end === '24:00', '当天段应 23:00-24:00: ' + JSON.stringify(d1));
    assert(d2 && d2.start === '00:00' && d2.end === '01:00', '次日段应 00:00-01:00: ' + JSON.stringify(d2));
    // end=24:00 是当日尽头，不得误拆跨天
    await w.Storage.saveTimelineBlock({ date: today, start: '23:30', end: '24:00', typeId: 'sleep' });
    assert(w.Storage.timeline().blocks.filter(function (b) { return b.start === '23:30'; }).length === 1,
      'end=24:00 应只存一条');
    assert(w.Storage.timeline().blocks.every(function (b) { return b.start !== '00:00' || b.date !== today; }),
      'end=24:00 不得生成当日 00:00 条目');
    console.log('PASS 2. ' + cur);
  }

  /* 4) 重叠并排 */
  cur = '3. 重叠并排（两块重叠 cols=2）';
  {
    const T = '2026-01-05'; // 固定周一
    const w = makeWindow({
      data: {
        timeline: {
          blocks: [
            { id: 'a', date: T, start: '10:00', end: '11:00', typeId: 'work', note: '', linkHabitId: '', habitSynced: false, source: 'manual' },
            { id: 'b', date: T, start: '10:30', end: '12:00', typeId: 'study', note: '', linkHabitId: '', habitSynced: false, source: 'manual' }
          ],
          points: [], types: [], timer: null
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    // 直接锁布局算法
    const lay = w.TimelineView.layoutBlocks(w.Storage.timeline().blocks);
    assert(lay.length === 2, '应两个条目');
    assert(lay[0].cols === 2 && lay[1].cols === 2, '重叠应并排两列: ' + JSON.stringify(lay.map(function (x) { return x.cols; })));
    assert(lay[0].col !== lay[1].col, '两块应在不同列');
    console.log('PASS 3. ' + cur);
  }

  /* 5)+6) 待办派生 + 简化档 */
  cur = '4. 待办时间点派生 + 「待办」简化档';
  {
    const w = makeWindow({
      data: {
        todos: {
          defs: [{ id: 't1', name: '喝水', date: today, due: '15:00', repeat: 'daily', remindBefore: 0, linkHabitId: '', priority: 'mid', archived: false }],
          done: {}
        },
        timeline: {
          blocks: [{ id: 'b1', date: today, start: '09:00', end: '10:00', typeId: 'work', note: '', linkHabitId: '', habitSynced: false, source: 'manual' }],
          points: [], types: [], timer: null
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('timeline');
    await waitFor(function () {
      return doc.querySelector('[data-tl-todo]') ? true : null;
    }, { label: '待办时间点未派生' });
    const td = doc.querySelector('[data-tl-todo]');
    assert(td.textContent.indexOf('喝水') >= 0, '待办点应显示名称');
    assert(doc.querySelector('.tl-block'), '时间段应渲染');
    // 勾完成（todos 同步，不双份存储）
    td.click();
    await waitFor(function () {
      return w.Storage.todoStatus('t1', today) ? true : null;
    }, { label: '勾完成未同步 todos' });
    assert(w.Storage.timeline().points.length === 0, '待办不应写入 timeline.points（不双份）');
    // 合并视图（v1.2.01）：时间段+时间点+待办同屏，两档切换胶囊已删
    assert(doc.querySelector('.tl-block'), '合并视图应显示时间段');
    assert(doc.querySelector('[data-tl-todo]'), '合并视图应显示待办点');
    assert(!doc.querySelector('[data-tl-mode]'), '两档切换胶囊已删');
    assert(doc.getElementById('tl-add-point') && doc.getElementById('tl-add-block'), '应有 +时间点 / +时间段 两按钮');
    // 「+时间点」开时间点弹窗（类型必选）
    doc.getElementById('tl-add-point').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#tp-type') ? m : null;
    }, { label: '「+时间点」应打开时间点弹窗' });
    assert(lastModal(doc).querySelector('#tp-type').options.length > 0, '时间点类型必选下拉应有选项');
    lastModal(doc).querySelector('[data-x=c]').click();
    console.log('PASS 4. ' + cur);
  }

  /* 7) 类型自定义 */
  cur = '5. 类型自定义（新建/删除归 other）';
  {
    const w = makeWindow({
      data: {
        timeline: {
          blocks: [{ id: 'b1', date: today, start: '09:00', end: '10:00', typeId: 'mytype', note: '', linkHabitId: '', habitSynced: false, source: 'manual' }],
          points: [], types: [{ id: 'mytype', name: '我的类型', icon: 'star', color: '#ff0000' }], timer: null
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('timeline');
    await waitFor(function () { return doc.getElementById('tl-types') ? true : null; }, { label: '卡头未渲染' });
    doc.getElementById('tl-types').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#tm-list') ? m : null;
    }, { label: '类型管理未打开' });
    const m = lastModal(doc);
    assert(m.querySelector('.tm-row .tm-name').value === '我的类型', '应列出已有类型');
    // 新建
    m.querySelector('#tm-new-name').value = '喝水';
    m.querySelector('[data-x=add]').click();
    await waitFor(function () {
      return w.Storage.timeline().types.some(function (t) { return t.name === '喝水'; }) ? true : null;
    }, { label: '新类型未保存' });
    // 删除「我的类型」→ block 归 other
    const rows = m.querySelectorAll('.tm-row');
    rows.forEach(function (r) {
      const inp = r.querySelector('.tm-name');
      if (inp && inp.value === '我的类型') r.querySelector('[data-tm-del]').click();
    });
    // 删除确认（拍板 12）
    await waitFor(function () {
      const cm = lastModal(doc);
      return cm && cm.querySelector('[data-act=yes]') ? cm : null;
    }, { label: '删除确认未弹' });
    lastModal(doc).querySelector('[data-act=yes]').click();
    await waitFor(function () {
      return !w.Storage.timeline().types.some(function (t) { return t.name === '我的类型'; }) ? true : null;
    }, { label: '类型未删除' });
    assert(w.Storage.timeline().blocks[0].typeId === 'other', '引用记录应归 other: ' + w.Storage.timeline().blocks[0].typeId);
    console.log('PASS 5. ' + cur);
  }

  /* 8) 计时器 */
  cur = '6. 计时器开始→结束生成记录';
  {
    const saves = [];
    const w = makeWindow({
      data: { timeline: { blocks: [], points: [], types: [], timer: null } },
      onSave: function (t, d) { saves.push({ t: t, d: d }); }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('timeline');
    await waitFor(function () { return doc.getElementById('tl-timer') ? true : null; }, { label: '计时按钮未渲染' });
    doc.getElementById('tl-timer').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#tm-type') ? m : null;
    }, { label: '计时弹窗未出现' });
    const m = lastModal(doc);
    m.querySelector('#tm-type').value = 'work';
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return w.Storage.timeline().timer ? true : null;
    }, { label: '计时未开始' });
    // 结束计时 → 生成 block
    await waitFor(function () {
      return doc.getElementById('tl-timer-stop') ? true : null;
    }, { label: '结束按钮未出现' });
    doc.getElementById('tl-timer-stop').click();
    await waitFor(function () {
      return w.Storage.timeline().blocks.length >= 1 && !w.Storage.timeline().timer ? true : null;
    }, { label: '计时未生成记录' });
    const b = w.Storage.timeline().blocks[0];
    assert(b.typeId === 'work' && b.source === 'timer', '生成记录应为 timer 来源: ' + JSON.stringify(b));
    assert(saves.some(function (x) { return x.t === 'timeline'; }), '计时生成应落盘 timeline');
    console.log('PASS 6. ' + cur);
  }

  /* 9) 习惯综合联动 */
  cur = '7. 习惯联动（保存 +1 / 删除回退）';
  {
    const w = makeWindow({
      data: {
        habits: { defs: [{ id: 'h1', name: '喝水', type: 'count', color: '#34c759' }], log: {} },
        timeline: { blocks: [], points: [], types: [], timer: null }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const rec = await S.saveTimelineBlock({ date: today, start: '08:00', end: '08:10', typeId: 'other', linkHabitId: 'h1' });
    assert(rec.habitSynced === true, '保存后应标记已联动');
    assert(S.habitCountOf('h1', today) === 1, '关联习惯应 +1: ' + S.habitCountOf('h1', today));
    await S.saveTimelineBlock({ id: rec.id, date: today, start: '08:00', end: '08:10', typeId: 'other', linkHabitId: 'h1', habitSynced: true });
    assert(S.habitCountOf('h1', today) === 1, '重复保存不得重复计: ' + S.habitCountOf('h1', today));
    await S.removeTimelineBlock(rec.id);
    assert(S.habitCountOf('h1', today) === 0, '删除应回退计次: ' + S.habitCountOf('h1', today));
    console.log('PASS 7. ' + cur);
  }

  /* 10) 记录类时间点 */
  cur = '8. 记录类时间点保存/删除';
  {
    const w = makeWindow({ data: { timeline: { blocks: [], points: [], types: [], timer: null } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const p = await S.saveTimelinePoint({ date: today, time: '14:30', name: '喝水', linkHabitId: '' });
    assert(S.timeline().points.length === 1, '时间点未保存');
    await S.removeTimelinePoint(p.id);
    assert(S.timeline().points.length === 0, '时间点未删除');
    console.log('PASS 8. ' + cur);
  }

  /* 11) 统计卡片 */
  cur = '9. 我的统计 → 时间统计（排行 + 每日时长）';
  {
    const w = makeWindow({
      data: {
        timeline: {
          blocks: [{ id: 'b1', date: today, start: '09:00', end: '11:00', typeId: 'work', note: '', linkHabitId: '', habitSynced: false, source: 'manual' }],
          points: [], types: [{ id: 'work', name: '专注工作', icon: 'x', color: '#f00' }], timer: null
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('plan');
    await waitFor(function () {
      return doc.querySelector('[data-plan-stab=time]') ? true : null;
    }, { label: '时间统计分类未出现' });
    doc.querySelector('[data-plan-stab=time]').click();
    await waitFor(function () {
      const body = doc.querySelector('[data-body=timeDist]');
      return body && body.textContent.indexOf('专注工作') >= 0 ? true : null;
    }, { label: '时间分配排行未渲染' });
    const t1 = doc.querySelector('[data-body=timeDist]').textContent;
    assert(t1.indexOf('专注工作') >= 0, '排行应含类型名');
    assert(t1.indexOf('2') >= 0, '应含 2 小时时长: ' + t1.slice(0, 120));
    await waitFor(function () {
      const body = doc.querySelector('[data-body=timeTrend]');
      return body && body.innerHTML.length > 20 ? true : null;
    }, { label: '每日记录时长未渲染' });
    console.log('PASS 9. ' + cur);
  }

  console.log('========== v132-timeline：9 项全部通过 ==========');
}

main().catch(function (e) {
  console.log('FAIL ' + cur + ': ' + (e && e.message || e));
  process.exit(1);
});
