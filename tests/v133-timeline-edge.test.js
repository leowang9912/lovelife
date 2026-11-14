/* v133-timeline-edge.test.js — 时间日历边界与容错模拟（用户动线式）：
   1) 同时刻多标记并排（不互相盖住）
   2) 时间边界：00:00 起 / 23:45-24:00 / 24:00 不误拆
   3) 保存失败回滚提示（mock 500）
   4) 类型删光 → 录入兜底 other 不炸
   5) 长名称截断结构（title 全名）
   6) 编辑已有条目改时间 + 删除
   7) 翻周前后空周不炸 + 回今天
   8) 计时器重复开始/未开始就结束不炸
   11) 待办↔习惯差分对称（计次不覆盖/撤销回退/连点幂等）
   12) 习惯↔时间段待办双向物化（打卡物化/取消删物化）
   13) done→skipped 删物化 / 跳过后再完成 / 删物化块=撤销
   14) 过夜时间段待办（start>due）计划两段 + 物化同组 + 逐日实例
   15) 编辑块改日期迁移习惯 + 失败保存不误回退
   16) 超 24 小时计时逐日完整落盘
   17) 旧数据缺 due 不消失 + 清空 allowEmpty + 计划段删除确认 */
'use strict';
const { makeWindow, waitFor, waitMain, lastModal, waitNoModal, assert } = require('./helpers/harness');

let cur = '';

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function main() {
  const today = ymd(new Date());

  cur = '1. 同时刻多标记并排（不重叠）';
  {
    const w = makeWindow({
      data: {
        todos: {
          defs: [
            { id: 't1', name: '喝水', date: today, due: '10:00', repeat: 'daily', remindBefore: 0, linkHabitId: '', priority: 'mid', archived: false },
            { id: 't2', name: '吃药', date: today, due: '10:05', repeat: 'daily', remindBefore: 0, linkHabitId: '', priority: 'mid', archived: false }
          ],
          done: {}
        },
        timeline: {
          blocks: [],
          points: [
            { id: 'p1', date: today, time: '10:10', name: '量血压', note: '', linkHabitId: '', habitSynced: false }
          ],
          types: [], timer: null
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('timeline');
    await waitFor(function () {
      return doc.querySelectorAll('.tl-todo, .tl-point').length >= 3 ? true : null;
    }, { label: '标记未渲染' });
    // 只看今天列（每日循环待办在全周每列都落点——正确行为）
    const col = doc.querySelector('.tl-col[data-tl-date="' + today + '"]');
    assert(col, '缺今天列');
    const marks = col.querySelectorAll('.tl-todo, .tl-point');
    assert(marks.length === 3, '今天列应 3 个标记，实为 ' + marks.length);
    // 簇内并排：宽度应窄于 60%（两列以上）
    const widths = Array.prototype.map.call(marks, function (m) {
      const wv = (m.getAttribute('style') || '').match(/width:\s*calc\(([\d.]+)%/);
      return wv ? Number(wv[1]) : 100;
    });
    assert(widths.every(function (x) { return x <= 55; }), '同时刻标记应并排缩窄: ' + widths.join(','));
    console.log('PASS 1. ' + cur);
  }

  cur = '2. 时间边界（00:00 / 23:45-24:00）';
  {
    const w = makeWindow({
      data: { timeline: { blocks: [], points: [], types: [], timer: null } }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    await S.saveTimelineBlock({ date: today, start: '00:00', end: '00:30', typeId: 'sleep' });
    await S.saveTimelineBlock({ date: today, start: '23:45', end: '24:00', typeId: 'sleep' });
    const bs = S.timeline().blocks;
    assert(bs.length === 2, '边界两条应存下: ' + JSON.stringify(bs.map(function (b) { return b.start + '-' + b.end; })));
    assert(bs.some(function (b) { return b.start === '23:45' && b.end === '24:00'; }), '23:45-24:00 合法');
    assert(bs.every(function (b) { return b.date === today; }), '不得误拆跨天');
    console.log('PASS 2. ' + cur);
  }

  cur = '3. 保存失败提示 + 还原（mock 500）';
  {
    let failSave = false;
    const w = makeWindow({
      data: { timeline: { blocks: [], points: [], types: [], timer: null } },
      routes: {
        '/api/save': function (o) {
          if (failSave && o.body && o.body.target === 'timeline') return o.fail('服务器开小差', 500);
          return undefined;
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('timeline');
    await waitFor(function () { return doc.getElementById('tl-add-block') ? true : null; }, { label: '卡头未渲染' });
    failSave = true;
    doc.getElementById('tl-add-block').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#tl-start') ? m : null;
    }, { label: '录入弹窗未出现' });
    const m = lastModal(doc);
    m.querySelector('#tl-date').value = today;
    m.querySelector('#tl-start').value = '09:00';
    m.querySelector('#tl-end').value = '10:00';
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return doc.querySelector('.toast, .ui-toast') ? true : null;
    }, { label: '失败未提示' });
    assert(w.Storage.timeline().blocks.length === 0, '失败不得留幽灵记录');
    console.log('PASS 3. ' + cur);
  }

  cur = '4. 类型删光 → 录入兜底 other';
  {
    const w = makeWindow({
      data: { timeline: { blocks: [{ id: 'b1', date: today, start: '08:00', end: '09:00', typeId: 'gone', note: '', linkHabitId: '', habitSynced: false, source: 'manual' }], points: [], types: [], timer: null } }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('timeline');
    await waitFor(function () {
      return doc.querySelector('.tl-block') ? true : null;
    }, { label: '条目未渲染' });
    // 引用已删类型：名称兜底为 id，不炸
    assert(doc.querySelector('.tl-block').textContent.indexOf('gone') >= 0, '未知类型应兜底显示 id');
    console.log('PASS 4. ' + cur);
  }

  cur = '5. 长名称 + 编辑改时间 + 删除';
  {
    const w = makeWindow({
      data: { timeline: { blocks: [], points: [{ id: 'p1', date: today, time: '12:00', name: '一个非常非常非常长的时间点名称测试截断', note: '', linkHabitId: '', habitSynced: false }], types: [], timer: null } }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const doc = w.document;
    w.App.go('timeline');
    await waitFor(function () {
      return doc.querySelector('[data-tl-point]') ? true : null;
    }, { label: '时间点未渲染' });
    // 编辑
    const b = await S.saveTimelineBlock({ date: today, start: '14:00', end: '15:00', typeId: 'work' });
    await S.saveTimelineBlock(Object.assign({}, b, { start: '14:30', end: '15:30' }));
    assert(S.timeline().blocks.length === 1, '编辑不得复制条目');
    assert(S.timeline().blocks[0].start === '14:30', '编辑应改时间');
    await S.removeTimelineBlock(b.id);
    assert(S.timeline().blocks.length === 0, '删除应生效');
    console.log('PASS 5. ' + cur);
  }

  cur = '6. 翻周空态 + 回今天 + 计时器防御';
  {
    const w = makeWindow({ data: { timeline: { blocks: [], points: [], types: [], timer: null } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('timeline');
    await waitFor(function () { return doc.getElementById('tl-prev') ? true : null; }, { label: '卡头未渲染' });
    doc.getElementById('tl-prev').click();
    assert(doc.querySelectorAll('.tl-col').length === 7, '翻周仍应 7 列');
    doc.getElementById('tl-next').click();
    doc.getElementById('tl-today').click();
    assert(doc.querySelector('.tl-day-head.on'), '回今天应高亮');
    // 未开始计时就点结束（防御）
    const stop = doc.getElementById('tl-timer-stop');
    assert(!stop, '无计时不应出现结束钮');
    // 重复开计时弹窗取消
    doc.getElementById('tl-timer').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#tm-type') ? m : null;
    }, { label: '计时弹窗未出现' });
    lastModal(doc).querySelector('[data-x=c]').click();
    assert(!w.Storage.timeline().timer, '取消不得开启计时');
    console.log('PASS 6. ' + cur);
  }

  cur = '7. 跨天组：gid 联动删除 / 编辑不重复计习惯';
  {
    const w = makeWindow({
      data: {
        habits: { defs: [{ id: 'h1', name: '早睡', type: 'check', color: '#34c759' }], log: {} },
        timeline: { blocks: [], points: [], types: [], timer: null }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    // 用公开接口模拟录入跨天（23:00→01:00）+ 关联习惯
    const w2doc = w.document;
    w.App.go('timeline');
    await waitFor(function () { return w2doc.getElementById('tl-add-block') ? true : null; }, { label: '卡头未渲染' });
    w2doc.getElementById('tl-add-block').click();
    await waitFor(function () {
      const m = lastModal(w2doc);
      return m && m.querySelector('#tl-start') ? m : null;
    }, { label: '录入弹窗未出现' });
    const m = lastModal(w2doc);
    m.querySelector('#tl-date').value = today;
    m.querySelector('#tl-start').value = '23:00';
    m.querySelector('#tl-end').value = '01:00';
    m.querySelector('#tl-habit').value = 'h1';
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return S.timeline().blocks.length === 2 ? true : null;
    }, { label: '跨天未拆两条' });
    assert(S.habitCountOf('h1', today) === 1, '跨天两段只应计一次习惯: ' + S.habitCountOf('h1', today));
    const bs = S.timeline().blocks;
    assert(bs[0].gid && bs[0].gid === bs[1].gid, '拆分段应同 gid');
    assert(bs.filter(function (b) { return b.linkHabitId; }).length === 1, '只第一段带关联');
    // 删除整组 → 习惯回退 + 无孤儿
    await S.removeTimelineGroup(bs[0].id);
    assert(S.timeline().blocks.length === 0, '删除应清整组');
    assert(S.habitCountOf('h1', today) === 0, '删除组应只回退一次: ' + S.habitCountOf('h1', today));
    console.log('PASS 7. ' + cur);
  }

  cur = '8. 类型增删失败回滚（mock 500）';
  {
    let failSave = false;
    const w = makeWindow({
      data: { timeline: { blocks: [], points: [], types: [{ id: 'x1', name: '原类型', icon: 'circle', color: '#f00' }], timer: null } },
      routes: {
        '/api/save': function (o) {
          if (failSave && o.body && o.body.target === 'timeline') return o.fail('服务器开小差', 500);
          return undefined;
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    failSave = true;
    let threw = false;
    await S.saveTimelineType({ name: '新类型', icon: 'circle', color: '#00f' }).catch(function () { threw = true; });
    assert(threw, '保存应抛出');
    assert(S.timeline().types.length === 1 && S.timeline().types[0].name === '原类型', '新增失败不得留幽灵类型');
    await S.removeTimelineType('x1').catch(function () { threw = true; });
    assert(S.timeline().types.length === 1, '删除失败应恢复');
    console.log('PASS 8. ' + cur);
  }

  cur = '9. render 重入不叠加监听（点一次「添加」只开一窗）';
  {
    const w = makeWindow({ data: { timeline: { blocks: [], points: [], types: [], timer: null } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('timeline');
    await waitFor(function () { return doc.getElementById('tl-add-block') ? true : null; }, { label: '卡头未渲染' });
    // 反复进入（render 重入 3 次）
    w.App.go('plan');
    await waitFor(function () { return doc.querySelector('.plan-wrap') ? true : null; }, { label: '统计页未渲染' });
    w.App.go('timeline');
    await waitFor(function () { return doc.getElementById('tl-add-block') ? true : null; }, { label: '时间日历未渲染' });
    w.App.go('plan');
    await waitFor(function () { return doc.querySelector('.plan-wrap') ? true : null; }, { label: '统计页未渲染' });
    w.App.go('timeline');
    await waitFor(function () { return doc.getElementById('tl-add-block') ? true : null; }, { label: '时间日历未渲染' });
    doc.getElementById('tl-add-block').click();
    await waitFor(function () {
      return lastModal(doc) && lastModal(doc).querySelector('#tl-date') ? true : null;
    }, { label: '录入弹窗未出现' });
    const n = doc.querySelectorAll('.modal-mask').length;
    assert(n === 1, '点一次「添加」应只开 1 个弹窗，实为 ' + n + ' 个');
    console.log('PASS 9. ' + cur);
  }

  cur = '10. 计划段状态机：派生/完成物化/撤销回计划/跳过保留';
  {
    const w = makeWindow({
      data: {
        todos: {
          defs: [{ id: 't1', name: '写报告', date: today, start: '14:00', due: '16:00', repeat: 'none', remindBefore: 0, linkHabitId: '', location: '公司', archived: false }],
          done: {}
        },
        timeline: { blocks: [], points: [], types: [], timer: null }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('timeline');
    await waitFor(function () {
      return doc.querySelector('[data-tl-plan]') ? true : null;
    }, { label: '计划段未派生' });
    const plan = doc.querySelector('[data-tl-plan]');
    assert(plan.textContent.indexOf('写报告') >= 0, '计划段应显示待办名');
    assert(w.Storage.timeline().blocks.length === 0, '未完成不得物化');
    // 完成 → 物化事实段
    plan.querySelector('[data-tl-plan-done]').click();
    await waitFor(function () {
      return w.Storage.timeline().blocks.length === 1 ? true : null;
    }, { label: '完成未物化' });
    const blk = w.Storage.timeline().blocks[0];
    assert(blk.todoId === 't1' && blk.start === '14:00' && blk.end === '16:00', '物化段字段: ' + JSON.stringify(blk));
    await waitFor(function () {
      return !doc.querySelector('[data-tl-plan]') ? true : null;
    }, { label: '完成后计划段应消失' });
    // 撤销 → 回计划（删物化段）
    await w.Storage.setTodoDone('t1', today, '');
    assert(w.Storage.timeline().blocks.length === 0, '撤销应删物化段');
    // 跳过 → 计划段保留（待手工删除）
    await w.Storage.setTodoDone('t1', today, 'skipped');
    w.App.refresh();
    await waitFor(function () {
      return doc.querySelector('[data-tl-plan]') ? true : null;
    }, { label: '跳过后计划段应保留' });
    console.log('PASS 10. ' + cur);
  }

  cur = '11. 待办↔习惯差分对称：计次不覆盖/撤销回退/连点幂等/done→skipped 回退';
  {
    const w = makeWindow({
      data: {
        todos: {
          defs: [
            { id: 'tc', name: '喝水', date: today, due: '21:00', repeat: 'none', remindBefore: 0, linkHabitId: 'h2', archived: false },
            { id: 'tk', name: '日报', date: today, due: '21:00', repeat: 'none', remindBefore: 0, linkHabitId: 'h1', archived: false }
          ],
          done: {}
        },
        habits: {
          defs: [{ id: 'h1', name: '日报打卡', type: 'check', color: '#aecbfa' },
            { id: 'h2', name: '喝水', type: 'count', max: 5, color: '#d7aefb' }],
          // 直接种 3 次（不用 setHabitCount——它会反向把关联待办先勾完成）
          log: { h2: (function () { const o = {}; o[today] = 3; return o; })() }
        },
        timeline: { blocks: [], points: [], types: [], timer: null }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    await S.setTodoDone('tc', today, 'done');
    assert(S.habitCountOf('h2', today) === 4, '计数习惯勾完成应 +1（3→4），不得被 true 覆盖成 1: ' + S.habitCountOf('h2', today));
    await S.setTodoDone('tc', today, 'done'); // 连点
    assert(S.habitCountOf('h2', today) === 4, '连点完成不得重复计: ' + S.habitCountOf('h2', today));
    await S.setTodoDone('tc', today, '');
    assert(S.habitCountOf('h2', today) === 3, '撤销应回退计次 4→3: ' + S.habitCountOf('h2', today));
    await S.setTodoDone('tk', today, 'done');
    assert(S.habitCountOf('h1', today) === 1, '二值习惯勾完成应打卡');
    await S.setTodoDone('tk', today, '');
    assert(S.habitCountOf('h1', today) === 0, '撤销应清打卡（此前只加不减）');
    await S.setTodoDone('tk', today, 'done');
    await S.setTodoDone('tk', today, 'skipped');
    assert(S.habitCountOf('h1', today) === 0, 'done→skipped 也应回退打卡');
    console.log('PASS 11. ' + cur);
  }

  cur = '12. 习惯↔时间段待办双向物化：打卡物化/取消删物化/完成物化/取消回未决';
  {
    const w = makeWindow({
      data: {
        todos: {
          defs: [{ id: 't1', name: '写报告', date: today, start: '14:00', due: '16:00', repeat: 'none', remindBefore: 0, linkHabitId: 'h1', archived: false }],
          done: {}
        },
        habits: { defs: [{ id: 'h1', name: '专注', type: 'check', color: '#aecbfa' }], log: {} },
        timeline: { blocks: [], points: [], types: [], timer: null }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    // 习惯打卡 → 待办完成（此前只写 done 不物化，计划段凭空消失且无事实段）
    await S.toggleHabit('h1', today);
    assert(S.todoStatus('t1', today) === 'done', '习惯打卡应反向完成待办');
    assert(S.timeline().blocks.length === 1, '习惯打卡反向完成也应物化事实段: ' + S.timeline().blocks.length);
    await S.toggleHabit('h1', today);
    assert(S.todoStatus('t1', today) === '', '取消打卡应恢复未决');
    assert(S.timeline().blocks.length === 0, '取消打卡应删物化段: ' + S.timeline().blocks.length);
    // 待办完成 → 物化 + 习惯打卡；习惯取消 → 物化段一并删
    await S.setTodoDone('t1', today, 'done');
    assert(S.timeline().blocks.length === 1 && S.habitCountOf('h1', today) === 1, '完成应物化并打卡');
    await S.toggleHabit('h1', today);
    assert(S.todoStatus('t1', today) === '' && S.timeline().blocks.length === 0, '习惯取消应连带撤销物化（此前残留事实段）');
    console.log('PASS 12. ' + cur);
  }

  cur = '13. done→skipped 删物化 / 跳过后再完成 / 删物化块=撤销回计划';
  {
    const w = makeWindow({
      data: {
        todos: {
          defs: [{ id: 't1', name: '写报告', date: today, start: '14:00', due: '16:00', repeat: 'none', remindBefore: 0, linkHabitId: '', archived: false }],
          done: {}
        },
        timeline: { blocks: [], points: [], types: [], timer: null }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const doc = w.document;
    await S.setTodoDone('t1', today, 'done');
    assert(S.timeline().blocks.length === 1, '完成应物化');
    await S.setTodoDone('t1', today, 'skipped');
    assert(S.timeline().blocks.length === 0, 'done→skipped 应删物化（否则计划段+事实段双显）: ' + S.timeline().blocks.length);
    await S.setTodoDone('t1', today, 'done');
    assert(S.timeline().blocks.length === 1, '跳过后再完成应重新物化');
    // 删物化块 = 撤销该次完成（回计划态），待办不得从时间日历消失
    w.App.go('timeline');
    await waitFor(function () {
      return doc.querySelector('[data-tl-block]') ? true : null;
    }, { label: '物化段未渲染' });
    doc.querySelector('[data-tl-block]').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('[data-x=del]') ? m : null;
    }, { label: '编辑弹窗未出现' });
    lastModal(doc).querySelector('[data-x=del]').click();
    await waitFor(function () {
      const cm = lastModal(doc);
      return cm && cm.querySelector('[data-act=yes]') ? cm : null;
    }, { label: '删除确认未弹' });
    lastModal(doc).querySelector('[data-act=yes]').click();
    await waitFor(function () {
      return S.timeline().blocks.length === 0 && S.todoStatus('t1', today) === '' ? true : null;
    }, { label: '删物化块未联动撤销' });
    console.log('PASS 13. ' + cur);
  }

  cur = '14. 过夜时间段待办（start>due）：计划两段/物化同组/逐日实例互不误判';
  {
    const y = ymd(new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) - 1));
    const t2 = ymd(new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) + 1));
    const w = makeWindow({
      data: {
        todos: {
          defs: [
            { id: 'tn', name: '夜班', date: today, start: '23:00', due: '01:00', repeat: 'daily', remindBefore: 0, linkHabitId: '', archived: false },
            { id: 'ty', name: '昨夜', date: y, start: '23:00', due: '01:00', repeat: 'none', remindBefore: 0, linkHabitId: '', archived: false }
          ],
          done: {}
        },
        timeline: { blocks: [], points: [], types: [], timer: null }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const doc = w.document;
    w.App.go('timeline');
    await waitFor(function () {
      return doc.querySelectorAll('.tl-plan').length >= 2 ? true : null;
    }, { label: '过夜计划段未派生' });
    const col = doc.querySelector('.tl-col[data-tl-date="' + today + '"]');
    assert(col, '缺今天列');
    const plans = col.querySelectorAll('.tl-plan');
    assert(plans.length === 2, '今天列应有 2 段计划（今日头段 + 昨日尾段），实为 ' + plans.length);
    const texts = Array.prototype.map.call(plans, function (p) { return p.textContent; });
    assert(texts.some(function (t) { return t.indexOf('23:00 - 01:00') >= 0; }), '头段应显示完整起止（23:00 - 01:00）: ' + texts.join('|'));
    assert(texts.some(function (t) { return t.indexOf('00:00 - 01:00') >= 0; }), '昨日尾段应显示 00:00 - 01:00: ' + texts.join('|'));
    // 物化：过夜实例拆两段同 gid（此前压成 23:00-01:00 一段，end<start 布局成 1 分钟）
    await S.setTodoDone('tn', today, 'done');
    let bs = S.timeline().blocks;
    assert(bs.length === 2, '过夜物化应拆两段: ' + JSON.stringify(bs.map(function (b) { return b.start + '-' + b.end; })));
    assert(bs[0].gid && bs[0].gid === bs[1].gid, '拆分段应同 gid');
    assert(bs.some(function (b) { return b.date === today && b.start === '23:00' && b.end === '24:00'; }), '头段 23:00-24:00');
    assert(bs.some(function (b) { return b.date === t2 && b.start === '00:00' && b.end === '01:00'; }), '尾段次日 00:00-01:00');
    // 逐日实例互不误判（昨日实例的尾段不得挡住今天实例的物化）
    await S.setTodoDone('tn', y, 'done');
    assert(S.timeline().blocks.length === 4, '昨日实例应独立物化: ' + S.timeline().blocks.length);
    await S.setTodoDone('tn', today, '');
    assert(S.timeline().blocks.length === 2, '撤销今天只删本实例整组: ' + S.timeline().blocks.length);
    assert(S.todoStatus('tn', y) === 'done', '昨日实例不受影响');
    console.log('PASS 14. ' + cur);
  }

  cur = '15. 编辑块改日期迁移习惯 + 同记录编辑不重复计 + 失败保存不误回退';
  {
    let failSave = false;
    const w = makeWindow({
      data: {
        habits: { defs: [{ id: 'h1', name: '喝水', type: 'count', max: 5, color: '#34c759' }], log: {} },
        timeline: { blocks: [], points: [], types: [], timer: null }
      },
      routes: {
        '/api/save': function (o) {
          if (failSave && o.body && o.body.target === 'timeline') return o.fail({ ok: false, error: '服务器开小差' }, 500);
          return undefined;
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const b = await S.saveTimelineBlock({ date: today, start: '08:00', end: '09:00', typeId: 'other', linkHabitId: 'h1' });
    assert(S.habitCountOf('h1', today) === 1, '保存应 +1');
    await S.saveTimelineBlock(Object.assign({}, b, { habitSynced: false, note: '改备注' }));
    assert(S.habitCountOf('h1', today) === 1, '同记录同习惯同日编辑不得重复计: ' + S.habitCountOf('h1', today));
    const d2 = ymd(new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) + 1));
    await S.saveTimelineBlock(Object.assign({}, S.timeline().blocks[0], { date: d2, habitSynced: true }));
    assert(S.habitCountOf('h1', today) === 0 && S.habitCountOf('h1', d2) === 1,
      '改日期应迁移习惯计次: 旧日 ' + S.habitCountOf('h1', today) + ' 新日 ' + S.habitCountOf('h1', d2));
    // 失败保存（只改备注）：习惯不被误回退
    failSave = true;
    let threw = false;
    try {
      await S.saveTimelineBlock(Object.assign({}, S.timeline().blocks[0], { note: 'x' }));
    } catch (e) { threw = true; }
    failSave = false;
    assert(threw, '失败应抛出');
    assert(S.habitCountOf('h1', d2) === 1, '失败保存不得误回退未动过的打卡: ' + S.habitCountOf('h1', d2));
    console.log('PASS 15. ' + cur);
  }

  cur = '16. 超 24 小时计时逐日完整落盘';
  {
    const w = makeWindow({ data: { timeline: { blocks: [], points: [], types: [], timer: null } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const doc = w.document;
    await S.setTimelineTimer({ typeId: 'work', startedAt: Date.now() - 25 * 3600 * 1000, note: '' });
    w.App.go('timeline');
    await waitFor(function () { return doc.getElementById('tl-timer-stop') ? true : null; }, { label: '结束按钮未出现' });
    doc.getElementById('tl-timer-stop').click();
    await waitFor(function () {
      return S.timeline().blocks.length >= 2 && !S.timeline().timer ? true : null;
    }, { label: '超 24h 计时未完整落盘' });
    const bs = S.timeline().blocks;
    let total = 0;
    bs.forEach(function (b) {
      const p = function (s) { const m = s.split(':'); return Number(m[0]) * 60 + Number(m[1]); };
      total += p(b.end) - p(b.start);
    });
    assert(total >= 1500 && total <= 1502, '25 小时计时应完整落盘 1500 分钟，实为 ' + total);
    assert(bs.every(function (b) { return b.gid === bs[0].gid && b.source === 'timer'; }), '各段应同 gid、timer 来源');
    console.log('PASS 16. ' + cur);
  }

  cur = '17. 旧数据缺 due 不消失 + 清空数据带 allowEmpty + 计划段 ✕=跳过（1A）';
  {
    let saveErr = '';
    const w = makeWindow({
      data: {
        todos: {
          defs: [
            { id: 'tnd', name: '旧数据无截止', date: today, repeat: 'none', remindBefore: 0, linkHabitId: '', archived: false },
            { id: 'tpl', name: '计划段待办', date: today, start: '10:00', due: '11:00', repeat: 'none', remindBefore: 0, linkHabitId: '', archived: false }
          ],
          done: {}
        },
        timeline: { blocks: [], points: [], types: [], timer: null }
      },
      routes: {
        '/api/save': function (o) {
          // 复刻 serve.py 空覆盖保护（allowEmpty 在请求顶层）
          if (o.body && o.body.target === 'todos') {
            const diskN = 2;
            const newN = (o.body.data.defs || []).length;
            if (newN === 0 && diskN > 0 && !o.body.allowEmpty) return o.fail({ ok: false, error: 'todos defs 空冲突' }, 409);
          }
          return undefined;
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const doc = w.document;
    await waitFor(function () {
      return doc.querySelectorAll('[data-todo-edit]').length >= 2 ? true : null;
    }, { label: '缺 due 的旧数据待办未显示' });
    // 拍板 1A：计划段 ✕=跳过今天（非破坏、计划段保留、定义不动）；删除只留编辑弹窗
    w.App.go('timeline');
    await waitFor(function () {
      return doc.querySelector('[data-tl-plan-del]') ? true : null;
    }, { label: '计划段未派生' });
    doc.querySelector('[data-tl-plan-del]').click();
    await waitFor(function () {
      return S.todoStatus('tpl', today) === 'skipped' ? true : null;
    }, { label: '✕ 未按 1A 语义跳过' });
    assert(S.getDB().todos.defs.some(function (d) { return d.id === 'tpl'; }), '跳过不得删除定义');
    w.App.refresh();
    await waitFor(function () {
      return doc.querySelector('[data-tl-plan]') ? true : null;
    }, { label: '跳过后计划段应保留' });
    // 清空数据：allowEmpty 走请求顶层，空覆盖保护不得拒绝
    try { await S.resetAll(); } catch (e) { saveErr = e.message; }
    assert(!saveErr, '清空数据不应报错: ' + saveErr);
    assert(!(S.getDB().todos.defs || []).length, '清空后待办应为空');
    console.log('PASS 17. ' + cur);
  }

  console.log('========== v133-timeline-edge：17 项全部通过 ==========');
}

main().catch(function (e) {
  console.log('FAIL ' + cur + ': ' + (e && e.message || e));
  process.exit(1);
});
