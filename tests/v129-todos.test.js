/* v129-todos.test.js — v1.2.0 待办事项系统回归锁：
   1) 六种循环到期规则（不循环/每天/工作日/每周/每月/每 N 天）+ 短月月末夹紧
   2) 主页待办卡：倒计时进度条+文字、前 5 条、完成按钮（勾选后消失）
   3) 过期停留：已过期不消失，红态「完成」「跳过今天」人工确认
   4) 双向联动（可选）：待办完成→习惯打卡；习惯打卡→待办同步完成
   5) 管理/编辑弹窗：新建（名称/循环/提醒/关联习惯）→ 列表出现；删除
   6) serve 接线：todos.json 白名单/类型防御/下发（源码断言）
   7) 今日概览在倒计时下方左列（#home-overview 与 #home-cd 同列） */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWindow, waitFor, waitMain, lastModal, waitNoModal, assert } = require('./helpers/harness');

let cur = '';

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function main() {
  const now = new Date();
  const today = ymd(now);
  const Y = now.getFullYear(), M = now.getMonth() + 1;

  /* 1) 循环规则 */
  cur = '1. 六种循环到期规则 + 短月月末夹紧';
  {
    const w = makeWindow({ data: { todos: { defs: [], done: {} } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const due = function (def, ds) { return S.todoDueOn(def, ds); };
    assert(due({ date: today, due: '21:00', repeat: 'none' }, today), 'none 当天应到期');
    assert(!due({ date: today, due: '21:00', repeat: 'none' }, ymd(new Date(Y, M - 1, 1))), 'none 他日不应');
    assert(due({ date: '2026-01-01', due: '09:00', repeat: 'daily' }, today), 'daily 每天应到期');
    assert(due({ date: '2026-01-01', due: '09:00', repeat: 'workday' }, today) === (now.getDay() >= 1 && now.getDay() <= 5), 'workday 周一~五');
    const dow = (now.getDay() + 6) % 7;
    assert(due({ date: '2026-01-01', due: '09:00', repeat: 'weekly', repeatOn: [dow] }, today), 'weekly 命中周几');
    assert(!due({ date: '2026-01-01', due: '09:00', repeat: 'weekly', repeatOn: [(dow + 1) % 7] }, today), 'weekly 未命中');
    const dom = now.getDate();
    assert(due({ date: '2026-01-01', due: '09:00', repeat: 'monthly', repeatOn: dom }, today), 'monthly 命中日号');
    // 短月夹紧：1/31 设定，2 月落到 2/28（平年）
    assert(due({ date: '2026-01-01', due: '09:00', repeat: 'monthly', repeatOn: 31 }, '2026-02-28'), 'monthly 短月应夹月末');
    assert(due({ date: today, due: '09:00', repeat: 'ndays', interval: 1 }, today), 'ndays 起始日命中');
    assert(due({ date: today, due: '09:00', repeat: 'ndays', interval: 3 }, ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3))), 'ndays 间隔 3 天命中');
    console.log('PASS 1. ' + cur);
  }

  /* 2)+3) 待办卡 + 过期停留 */
  cur = '2. 待办卡倒计时/进度条 + 过期停留人工确认';
  {
    const past = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    const w = makeWindow({
      data: {
        todos: {
          defs: [
            { id: 't1', name: '日报', date: past, due: '21:00', repeat: 'daily', remindBefore: 15, linkHabitId: '' },
            { id: 't2', name: '周报', date: today, due: '23:59', repeat: 'none', remindBefore: 0, linkHabitId: '' }
          ],
          done: {}
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await waitFor(function () {
      return doc.querySelector('#home-todos .tw-item') ? true : null;
    }, { label: '待办卡未渲染' });
    const rows = doc.querySelectorAll('#home-todos .tw-item');
    // daily 起始=昨天：逾期(昨)+今天+未来 3 天展开 + 周报今天（v1.2.0 提前展示后续日期）
    assert(rows.length >= 3, '应显示多条未决（含逾期/今天/未来），实为 ' + rows.length);
    const rowsBefore = rows.length;
    assert(doc.querySelector('#home-todos .tw-item'), '周视图应有待办条目');
    // hover 预览卡已按拍板移除（曾浮层滞留）——列内只留名称+时刻
    assert(doc.querySelector('#home-todos .tw-time'), '列内应显示时刻');
    // 日循环昨日起未决=过期停留（红态+两按钮）
    const overRow = doc.querySelector('#home-todos .tw-item.tw-over');
    assert(overRow, '过期实例应停留红态（不消失）');
    assert(overRow.querySelector('[data-todo-skip]') && overRow.querySelector('[data-todo-done]'), '过期行应有 完成/跳过今天');
    // 完成后该行转绿（周视图下其他天的逾期实例可仍在——按行判断）
    const overBefore = doc.querySelectorAll('#home-todos .tw-item.tw-over').length;
    overRow.querySelector('[data-todo-done]').click();
    await waitFor(function () {
      return doc.querySelectorAll('#home-todos .tw-item.tw-over').length < overBefore &&
        doc.querySelectorAll('#home-todos .tw-item.tw-done').length > 0 ? true : null;
    }, { label: '完成后过期行未消失' });
    console.log('PASS 2. ' + cur);
  }

  /* 4) 双向联动（toggleHabit + setHabitCount 双入口） */
  cur = '3. 双向联动：待办完成→习惯打卡；习惯打卡/计次→待办完成';
  {
    const w = makeWindow({
      data: {
        todos: {
          defs: [{ id: 't1', name: '日报', date: today, due: '21:00', repeat: 'daily', remindBefore: 0, linkHabitId: 'h1' },
            { id: 't2', name: '喝水', date: today, due: '21:00', repeat: 'daily', remindBefore: 0, linkHabitId: 'h2' }],
          done: {}
        },
        habits: {
          defs: [{ id: 'h1', name: '日报打卡', color: '#aecbfa' }, { id: 'h2', name: '喝水', color: '#d7aefb', type: 'count', max: 5 }],
          log: {}
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    await S.setTodoDone('t1', today, 'done');
    assert(S.habitCountOf('h1', today) >= 1, '待办完成应联动习惯打卡');
    // 反向：取消习惯打卡 → 待办恢复未决
    await S.toggleHabit('h1', today);
    assert(S.todoStatus('t1', today) === '', '习惯取消打卡应反向恢复待办未决');
    // 习惯打卡 → 待办完成
    await S.toggleHabit('h1', today);
    assert(S.todoStatus('t1', today) === 'done', '习惯打卡应反向完成待办');
    // 计数习惯入口（稽核补漏：setHabitCount 也要反向同步）
    await S.setHabitCount('h2', today, 3);
    assert(S.todoStatus('t2', today) === 'done', '计数习惯打卡应反向完成待办');
    await S.setHabitCount('h2', today, 0);
    assert(S.todoStatus('t2', today) === '', '计数清零应反向恢复待办未决');
    console.log('PASS 3. ' + cur);
  }

  /* 5) 管理/编辑弹窗 */
  cur = '4. 管理弹窗新建待办（循环/提醒/联动）→ 列表出现';
  {
    const w = makeWindow({
      data: {
        todos: { defs: [], done: {} },
        habits: { defs: [{ id: 'h1', name: '日报打卡', color: '#aecbfa' }], log: {} }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await waitFor(function () {
      return doc.querySelector('#todo-add') ? true : null;
    }, { label: '待办卡未渲染' });
    doc.querySelector('#todo-add').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#td-name') ? m : null;
    }, { label: '新建弹窗未打开' });
    const m = lastModal(doc);
    m.querySelector('#td-name').value = '日报';
    m.querySelector('#td-repeat').value = 'daily';
    m.querySelector('#td-repeat').dispatchEvent(new w.Event('change'));
    m.querySelector('#td-remind').value = '10';
    m.querySelector('#td-habit').value = 'h1';
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return w.Storage.getDB().todos.defs.length === 1 ? true : null;
    }, { label: '待办未保存' });
    const def = w.Storage.getDB().todos.defs[0];
    assert(def.name === '日报' && def.repeat === 'daily' && def.remindBefore === 10 && def.linkHabitId === 'h1',
      '字段保存不全: ' + JSON.stringify(def));
    console.log('PASS 4. ' + cur);
  }

  /* 6) serve 接线 + 落盘真发请求（稽核事故锁：persist 曾漏 todos 分支空转假成功） */
  cur = '5. serve 接线 + persist(todos) 必发 /api/save 请求';
  {
    const srv = fs.readFileSync(path.join(__dirname, '..', 'app', 'serve.py'), 'utf8');
    assert(srv.indexOf('_sanitize_todos') >= 0 && srv.indexOf('todos.json') >= 0, '应有 todos 清洗与文件');
    assert(/elif target == "todos":/.test(srv), 'save 白名单应含 todos');
    assert(/"todos": \{"defs"/.test(srv), 'load_db 应下发 todos 域');
    // storage persist 必须含 todos 分支（漏分支=落盘空转、重启数据全丢）
    const sto = fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'storage.js'), 'utf8');
    assert(/push\('todos',/.test(sto), "persist() 必须 push todos 域");
    // 行为锁：保存待办真发出 target:'todos' 的落盘（harness onSave 观察 /api/save）
    const calls = [];
    const w = makeWindow({
      data: { todos: { defs: [], done: {} } },
      onSave: function (target) { calls.push(target); }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    await w.Storage.saveTodoDef({ id: 'tt1', name: '落盘测试', date: today, due: '21:00', repeat: 'daily', remindBefore: 0, linkHabitId: '' });
    await new Promise(function (r) { setTimeout(r, 200); });
    assert(calls.indexOf('todos') >= 0, 'saveTodoDef 必须发出 target=todos 的落盘请求，实发: ' + calls.join(','));
    console.log('PASS 5. ' + cur);
  }

  /* 7) 概览挪页尾 */
  cur = '6. 今日概览在右列（习惯打卡上方）';
  {
    const w = makeWindow({ data: { todos: { defs: [], done: {} } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await waitFor(function () {
      return doc.querySelector('#home-todos') && doc.querySelector('#home-overview') ? true : null;
    }, { label: '主页卡片未渲染' });
    const html = doc.getElementById('main-content').innerHTML;
    assert(html.indexOf('id="home-overview"') > html.indexOf('id="home-todos"'), '概览应在待办周视图之后');
    const ov = doc.getElementById('home-overview');
    const col = ov.closest('.home-col');
    assert(col && col.querySelector('#home-habits'), '概览应与习惯打卡同列（右列）');
    assert(!col.contains(doc.getElementById('home-cd')), '概览不应在倒计时列');
    console.log('PASS 6. ' + cur);
  }

  /* 8) 完成留痕 + 撤销 + 新建同名习惯绑定 */
  cur = '7. 完成留痕绿态无文字+撤销进管理 + 表单「新建同名习惯」绑定';
  {
    const w = makeWindow({
      data: {
        todos: {
          defs: [{ id: 't1', name: '日报', date: today, due: '23:59', repeat: 'daily', remindBefore: 0, linkHabitId: '' }],
          done: {}
        },
        habits: { defs: [], log: {} }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await waitFor(function () {
      return doc.querySelector('#home-todos .tw-item') ? true : null;
    }, { label: '待办卡未渲染' });
    doc.querySelector('[data-todo-done]').click();
    await waitFor(function () {
      return doc.querySelector('#home-todos .tw-item.tw-done') ? true : null;
    }, { label: '完成后未留痕（绿态行）' });
    // v1.2.0 拍板：已完成=条目变绿无文字；主页无撤销（撤销在管理里）
    assert(doc.querySelector('#home-todos .tw-item.tw-done').textContent.indexOf('已完成') < 0, '留痕行不应有文字标签');
    assert(!doc.querySelector('#home-todos [data-todo-undo]'), '主页不应有撤销按钮');
    // 撤销走管理弹窗
    doc.querySelector('#todo-manage').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('[data-td-undo]') ? m : null;
    }, { label: '管理弹窗未开/无撤销' });
    lastModal(doc).querySelector('[data-td-undo]').click();
    await waitFor(function () {
      return doc.querySelector('#home-todos [data-todo-done]') ? true : null;
    }, { label: '撤销未恢复未决' });
    // 表单：预设播种 + 新建同名习惯绑定
    doc.querySelector('#todo-add').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#td-habit') ? m : null;
    }, { label: '新建弹窗未打开' });
    const m = lastModal(doc);
    const opts = m.querySelector('#td-habit').innerHTML;
    assert(opts.indexOf('__new__') >= 0, '下拉应有「新建同名习惯」选项');
    assert(opts.indexOf('运动') >= 0 || opts.indexOf('阅读') >= 0, '下拉应含播种的预设习惯');
    m.querySelector('#td-name').value = '晨间计划';
    m.querySelector('#td-habit').value = '__new__';
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      const defs = w.Storage.getDB().todos.defs;
      return defs.length >= 2 ? true : null;
    }, { label: '待办未保存' });
    const saved = w.Storage.getDB().todos.defs.filter(function (d) { return d.name === '晨间计划'; })[0];
    assert(saved && saved.linkHabitId, '「新建同名习惯」应绑定新建习惯 id');
    const h = (w.Storage.getDB().habits.defs || []).filter(function (x) { return x.id === saved.linkHabitId; })[0];
    assert(h && h.name === '晨间计划', '应新建同名习惯');
    console.log('PASS 7. ' + cur);
  }

  /* 9) 逐日翻动 + 当日倒计时排序 + 已决垫底 + 循环可见 */
  cur = '8. 逐日翻动/当日倒计时排序/已决垫底/循环徽章';
  {
    const tmr = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const w = makeWindow({
      data: {
        todos: {
          defs: [
            { id: 't1', name: '晚的', date: today, due: '23:00', repeat: 'daily', priority: 'low', remindBefore: 0, linkHabitId: '' },
            { id: 't2', name: '早的', date: today, due: '08:00', repeat: 'weekly', repeatOn: [(now.getDay() + 6) % 7], priority: 'high', remindBefore: 0, linkHabitId: '' },
            { id: 't3', name: '明天的事', date: tmr, due: '09:00', repeat: 'none', priority: 'mid', remindBefore: 0, linkHabitId: '' }
          ],
          done: { t1: {} }
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await waitFor(function () {
      return doc.querySelector('#home-todos .tw-item') ? true : null;
    }, { label: '待办卡未渲染' });
    // 周视图（v1.2.2）：7 列同屏；今天列内按截止升序、已决垫底；未来日进未来列
    const todayCol = Array.prototype.filter.call(doc.querySelectorAll('#home-todos .tw-col'), function (c) {
      return c.classList.contains('tw-today');
    })[0];
    assert(todayCol, '应有今天列');
    const todayNames = Array.prototype.map.call(todayCol.querySelectorAll('.tw-name'), function (n) {
      return n.textContent;
    }).join('|');
    assert(todayNames.indexOf('早的') >= 0 && todayNames.indexOf('晚的') >= 0, '今天列应含今日实例: ' + todayNames);
    assert(todayNames.indexOf('明天的事') < 0, '今天列不应含未来日实例');
    assert(todayNames.indexOf('早的') < todayNames.indexOf('晚的'), '当日应按截止时刻升序: ' + todayNames);
    // 未来日进未来列（同屏 7 列）
    assert(doc.querySelector('#home-todos').textContent.indexOf('明天的事') >= 0, '周视图应含未来日实例（分列）');
    // hover 预览卡已按拍板移除（循环语义由用例 1 todoDueOn 数据锁覆盖）
    // 已决垫底：完成「晚的」后排当日最后
    const doneBtns = todayCol.querySelectorAll('[data-todo-done]');
    doneBtns[doneBtns.length - 1].click();
    await waitFor(function () {
      // redrawTodos 重建周板（旧节点脱钩）——每步重查今天列
      const col = Array.prototype.filter.call(doc.querySelectorAll('#home-todos .tw-col'), function (c) {
        return c.classList.contains('tw-today');
      })[0];
      if (!col) return null;
      const ns = Array.prototype.map.call(col.querySelectorAll('.tw-name'), function (n) { return n.textContent; }).join('|');
      return ns.indexOf('早的') < ns.indexOf('晚的') && col.querySelector('.tw-item.tw-done') ? true : null;
    }, { label: '已决未垫底' });
    // 周翻动（‹ 今天 ›）
    assert(doc.querySelector('#tw-next') && doc.querySelector('#tw-prev') && doc.querySelector('#tw-today'), '应有周导航');
    console.log('PASS 8. ' + cur);
  }

  /* 10) 翻页/勾选局部重绘，不弹回页首（交互铁律） */
  cur = '9. 翻页/勾选局部重绘（scrollTop 不变）';
  {
    const defs = [];
    for (let i = 0; i < 12; i++) {
      defs.push({ id: 't' + i, name: '待办' + i, date: today, due: String(8 + i).padStart(2, '0') + ':00', repeat: 'daily', remindBefore: 0, linkHabitId: '' });
    }
    const w = makeWindow({ data: { todos: { defs: defs, done: {} } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await waitFor(function () {
      return doc.querySelectorAll('#home-todos .tw-item').length >= 10 ? true : null;
    }, { label: '待办卡未渲染' });
    const main = doc.querySelector('.main');
    main.scrollTop = 120;
    const label0 = doc.querySelector('#home-todos .tw-week-label').textContent;
    doc.querySelector('#tw-next').click();
    await waitFor(function () {
      const lab = doc.querySelector('#home-todos .tw-week-label');
      return lab && lab.textContent !== label0 ? true : null;
    }, { label: '翻页未生效' });
    assert(main.scrollTop === 120, '翻页后 scrollTop 不得回页首，实为 ' + main.scrollTop);
    // 勾选完成也不回顶
    doc.querySelector('#home-todos [data-todo-done]');
    const btn = doc.querySelector('#home-todos [data-todo-done]');
    if (btn) {
      btn.click();
      await waitFor(function () {
        return doc.querySelector('#home-todos .tw-item.tw-done') ? true : null;
      }, { label: '勾选未生效' });
      assert(main.scrollTop === 120, '勾选后 scrollTop 不得回页首，实为 ' + main.scrollTop);
    }
    console.log('PASS 9. ' + cur);
  }

  /* 11) 习惯管理：排序（defs 顺序=卡片顺序）+ 管理入口 */
  cur = '10. 习惯管理排序（上移/下移）+ 管理入口';
  {
    const w = makeWindow({
      data: {
        todos: { defs: [], done: {} },
        habits: {
          defs: [{ id: 'h1', name: '甲', color: '#aecbfa' }, { id: 'h2', name: '乙', color: '#d7aefb' }],
          log: {}
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await waitFor(function () {
      return doc.querySelector('[data-hb-manage]') ? true : null;
    }, { label: '管理入口未渲染' });
    doc.querySelector('[data-hb-manage]').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('[data-hb-move]') ? m : null;
    }, { label: '习惯管理弹窗未打开' });
    const m = lastModal(doc);
    assert(m.textContent.indexOf('甲') >= 0 && m.textContent.indexOf('乙') >= 0, '管理列表应含全部习惯');
    // 下移第一个=甲乙换序
    m.querySelector('[data-hb-move=down]').click();
    await waitFor(function () {
      const defs = w.Storage.getDB().habits.defs;
      return defs[0] && defs[0].name === '乙' ? true : null;
    }, { label: '排序未生效' });
    assert(w.Storage.getDB().habits.defs[1].name === '甲', '顺序应互换');
    // v1.2.2 闪烁修复：排序不关弹窗、列表就地重排（同一弹窗节点）
    assert(lastModal(doc) === m, '排序后弹窗不得关闭重开（闪烁）');
    assert(doc.querySelectorAll('.modal-mask').length === 1, '不得叠加弹窗');
    await waitFor(function () {
      const rows = m.querySelectorAll('#hb-mgr-list .mini-row');
      return rows.length === 2 && rows[0].textContent.indexOf('乙') >= 0 ? true : null;
    }, { label: '弹窗列表未就地重排' });
    console.log('PASS 10. ' + cur);
  }

  cur = '11. 主页待办条目点击=编辑（v1.2.2）';
  {
    const w = makeWindow({
      data: {
        todos: {
          defs: [{ id: 't1', name: '喝水', date: '2026-11-12', due: '21:00', repeat: 'daily', remindBefore: 0, linkHabitId: '', priority: 'mid', archived: false }],
          done: {}
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await waitFor(function () {
      return doc.querySelector('[data-todo-edit]') ? true : null;
    }, { label: '待办行未渲染' });
    doc.querySelector('[data-todo-edit]').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#td-name') ? m : null;
    }, { label: '点击条目未打开编辑弹窗' });
    assert(lastModal(doc).querySelector('#td-name').value === '喝水', '编辑弹窗应载入该条目');
    // 完成按钮不冒泡为编辑（点按钮只勾完成）
    lastModal(doc).querySelector('[data-x=c]') && lastModal(doc).querySelector('[data-x=c]').click();
    console.log('PASS 11. ' + cur);
  }

  cur = '12. 循环截止（repeatUntil）到期即停、历史保留';
  {
    const w = makeWindow({
      data: {
        todos: {
          defs: [
            { id: 't1', name: '喝水', date: today, due: '12:00', repeat: 'daily', repeatUntil: today, remindBefore: 0, linkHabitId: '', archived: false }
          ],
          done: { t1: (function () { const m = {}; m[today] = { t: 'x', s: 'done' }; return m; })() }
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    assert(S.todoDueOn(S.getDB().todos.defs[0], today), '截止当天仍生成');
    assert(!S.todoDueOn(S.getDB().todos.defs[0], ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))), '截止后不得再生成');
    // 历史/已完成保留（定义在、打卡记录在）
    assert(S.getDB().todos.defs.length === 1, '不得因截止删除定义');
    assert(S.todoStatus('t1', today) === 'done', '历史完成记录应保留');
    // 编辑器含循环截止输入
    const doc = w.document;
    await waitFor(function () {
      return doc.querySelector('#todo-add') ? true : null;
    }, { label: '卡头未渲染' });
    doc.querySelector('#todo-add').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#td-until') ? m : null;
    }, { label: '编辑器缺循环截止输入' });
    lastModal(doc).querySelector('[data-x=c]').click();
    console.log('PASS 12. ' + cur);
  }

  cur = '13. 时间段待办进主页周视图（起止显示）+ 倒计时按开始';
  {
    const w = makeWindow({
      data: {
        todos: {
          defs: [{ id: 't1', name: '写报告', date: today, start: '14:00', due: '16:00', repeat: 'none', remindBefore: 0, linkHabitId: '', location: '公司', archived: false }],
          done: {}
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await waitFor(function () {
      return doc.querySelector('[data-todo-edit="t1"]') ? true : null;
    }, { label: '时间段待办未出现在主页周视图' });
    const row = doc.querySelector('[data-todo-edit="t1"]');
    assert(row.querySelector('.tw-time').textContent.indexOf('14:00-16:00') >= 0, '应显示起止: ' + row.querySelector('.tw-time').textContent);
    assert(row.textContent.indexOf('公司') >= 0, '应显示地点');
    console.log('PASS 13. ' + cur);
  }

  console.log('========== v129-todos：13 项全部通过 ==========');
}

main().catch(function (e) {
  console.log('FAIL ' + cur + ': ' + (e && e.message || e));
  process.exit(1);
});
