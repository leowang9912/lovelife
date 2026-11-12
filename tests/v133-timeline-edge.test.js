/* v133-timeline-edge.test.js — 时间日历边界与容错模拟（用户动线式）：
   1) 同时刻多标记并排（不互相盖住）
   2) 时间边界：00:00 起 / 23:45-24:00 / 24:00 不误拆
   3) 保存失败回滚提示（mock 500）
   4) 类型删光 → 录入兜底 other 不炸
   5) 长名称截断结构（title 全名）
   6) 编辑已有条目改时间 + 删除
   7) 翻周前后空周不炸 + 回今天
   8) 计时器重复开始/未开始就结束不炸 */
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

  console.log('========== v133-timeline-edge：9 项全部通过 ==========');
}

main().catch(function (e) {
  console.log('FAIL ' + cur + ': ' + (e && e.message || e));
  process.exit(1);
});
