/* v134-tickets.test.js — 我的票据回归锁（v1.2.6 语义更新）：
   1) 入口 + 票券卡墙渲染（铁路式仿真票面）+ 落盘（tickets 域 onSave）+ 已用/未用移除
   2) 自动绑定账单（price>0 → bill.ticketId）+ 票价改动账单跟随
   3) 删票 → 账单保留（解绑）
   4) 状态移除：行程待办独立完成（无已用/未用双向）
   5) 时间日历联动：票生成时间段待办（todoId）+ 计划段类型映射 commute
   6) 类型自定义（预设 8 类含景点门票；删除归 other）
   7) 统计「票据花费」：自费计金额，报销排除
   8) 编辑器可用：类型选择/切类型保值/保存不丢未渲染字段
   9) 详情弹窗（专属字段行）+ 状态按钮移除 + 转报销入口
   10) 报销不记账：转报销回收账单 + status 字段废弃 + 转回自费重建
   11) 账单绑定：票价改 0 金额跟随 + 并发保存不重复建 + 0 元不建
   12) 票↔日历：改期清旧日完成态/物化块 + 清时刻删行程待办（todoId 不悬空）
   13) 计划段 ✕=跳过实例日（data-date）+ 时间输入 24:00 往返不被清空
   14) 计时读数常驻 H:MM:SS（重渲续走）+ stopTimer 失败整组回滚可重试
   15) 美食四合一分餐 + 物品徽章（在用不标注/其余分色，拍板 11） */
'use strict';
const { makeWindow, waitFor, waitMain, lastModal, assert } = require('./helpers/harness');

let cur = '';

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function addDay(ds, n) {
  const p = ds.split('-');
  return ymd(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
}

async function main() {
  const today = ymd(new Date());

  cur = '1. 票券卡渲染 + 落盘';
  {
    const saves = [];
    const w = makeWindow({
      data: {
        tickets: {
          items: [{
            id: 'k1', type: 'train', name: '北京→上海', date: today, time: '09:00', endTime: '13:00',
            location: '北京南', seat: '01车12A', price: 553, ticketNo: 'E123', note: '',
            status: 'unused', images: [], buyDate: today, billId: '', todoId: '',
            ext: { no: 'G1', from: '北京南', to: '上海虹桥' }, createdAt: Date.now()
          }],
          types: []
        }
      },
      onSave: function (t, d) { saves.push({ t: t, d: d }); }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('tickets');
    await waitFor(function () {
      return doc.querySelector('.tk-card') ? true : null;
    }, { label: '票券卡未渲染' });
    const card = doc.querySelector('.tk-card');
    // 站程票面=出发站→到达站大字（仿真车票），名称不单显
    assert(card.textContent.indexOf('北京南') >= 0 && card.textContent.indexOf('上海虹桥') >= 0, '站程票面应有起止站');
    assert(card.querySelector('.tk-rail-route'), '站程类应为 A→B 布局'); // v1.2.6 票面重构：.tk-route → .tk-rail-route（起终点同排语义不变）
    assert(card.textContent.indexOf('553') >= 0, '卡面应有票价');
    assert(card.querySelector('.tk-rail-head'), '仿真票面：铁路式票头（v1.2.6 票面重构，撕孔→各票种仿真形态）');
    // v1.2.6 拍板 5：已用/未用整体移除——无状态徽章、无状态类、无状态字样
    assert(!card.querySelector('.tk-stub-status') && card.textContent.indexOf('未用') < 0 && card.textContent.indexOf('已用') < 0, '已用/未用已移除（拍板 5）');
    assert(!/tk-(unused|used|void)/.test(card.className), '无状态类: ' + card.className);
    assert(!card.querySelector('.tk-barcode'), '条码已删');
    console.log('PASS 1. ' + cur);
  }

  cur = '2. 自动绑定账单 + 票价跟随';
  {
    const w = makeWindow({ data: { tickets: { items: [], types: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const rec = await S.saveTicket({ type: 'train', name: '行程A', date: today, time: '09:00', price: 100, buyDate: today, ext: {} });
    assert(rec.billId, '应自动绑定账单');
    const bill = w.Storage.getDB().wallet.bills.filter(function (b) { return b.id === rec.billId; })[0];
    assert(bill && bill.amount === 100 && bill.ticketId === rec.id, '账单金额/反向链接: ' + JSON.stringify(bill));
    // 票价改动 → 账单跟随
    await S.saveTicket(Object.assign({}, rec, { price: 150 }));
    const bill2 = w.Storage.getDB().wallet.bills.filter(function (b) { return b.id === rec.billId; })[0];
    assert(bill2.amount === 150, '票价改动账单应跟随: ' + bill2.amount);
    console.log('PASS 2. ' + cur);
  }

  cur = '3. 删票 → 账单保留（解绑）';
  {
    const w = makeWindow({ data: { tickets: { items: [], types: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const rec = await S.saveTicket({ type: 'movie', name: '电影B', date: today, price: 60, buyDate: today });
    const billId = rec.billId;
    await S.removeTicket(rec.id);
    assert(!S.tickets().items.length, '票应删');
    const bill = w.Storage.getDB().wallet.bills.filter(function (b) { return b.id === billId; })[0];
    assert(bill, '账单应保留');
    assert(!bill.ticketId, '账单应解绑');
    console.log('PASS 3. ' + cur);
  }

  cur = '4. 票行程=既成事实：生成即完成（默认完成口径）+ 撤销可回未决';
  {
    const w = makeWindow({ data: { tickets: { items: [], types: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const rec = await S.saveTicket({ type: 'concert', name: '演唱会C', date: today, time: '19:00', endTime: '22:00', price: 380, buyDate: today });
    assert(rec.todoId, '应生成行程待办');
    const def = S.todoDef(rec.todoId);
    assert(def && def.start === '19:00' && def.due === '22:00', '待办起止=行程: ' + JSON.stringify(def));
    assert(S.tickets().items[0].status === undefined, 'status 字段已移除不再保存');
    assert(S.todoStatus(rec.todoId, today) === 'done', '票行程应默认已完成（拍板）');
    // 撤销仍可回未决；待办操作不得反标票据
    await S.setTodoDone(rec.todoId, today, '');
    assert(S.todoStatus(rec.todoId, today) === '', '撤销恢复未决');
    assert(S.tickets().items[0].status === undefined && S.tickets().items[0].reimb === 'none', '待办操作不得改票据');
    console.log('PASS 4. ' + cur);
  }

  cur = '5. 时间日历联动：行程=事实段（生成即完成，类型映射 commute，拍板 2）';
  {
    const w = makeWindow({
      data: {
        tickets: { items: [], types: [] },
        timeline: {
          blocks: [], points: [], timer: null,
          types: [
            { id: 'commute', name: '通勤/交通', icon: 'car', color: '#34c759', kind: 'block', linkHabitId: '' },
            { id: 'other', name: '其他', icon: 'circle', color: '#aeaeb2', kind: 'block', linkHabitId: '' }
          ]
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await w.Storage.saveTicket({ type: 'flight', name: 'CA123 北京→东京', date: today, time: '08:00', endTime: '12:00', price: 1800, buyDate: today });
    w.App.go('timeline');
    await waitFor(function () {
      return doc.querySelector('[data-tl-block]') ? true : null;
    }, { label: '行程事实段未出现' });
    const blk = doc.querySelector('[data-tl-block]');
    assert(blk.textContent.indexOf('CA123') >= 0, '事实段应显示票名');
    assert((blk.getAttribute('style') || '').indexOf('#34c759') >= 0, '票行程块应按 commute 类型配色（拍板 2）: ' + blk.getAttribute('style'));
    assert(!doc.querySelector('[data-tl-plan]'), '默认完成口径：不得出现待完成计划段');
    console.log('PASS 5. ' + cur);
  }

  cur = '6. 类型自定义（删除归 other）';
  {
    const w = makeWindow({ data: { tickets: { items: [], types: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('tickets');
    await waitFor(function () { return doc.querySelector('#tk-types') ? true : null; }, { label: '卡头未渲染' });
    doc.querySelector('#tk-types').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#tt-list') ? m : null;
    }, { label: '类型管理未开' });
    const m = lastModal(doc);
    assert(m.querySelectorAll('[data-tt-id]').length === 8, '预设 8 类（v1.2.6 +景点门票）: ' + m.querySelectorAll('[data-tt-id]').length);
    m.querySelector('#tt-new-name').value = '船票';
    m.querySelector('[data-x=add]').click();
    await waitFor(function () {
      return w.Storage.tickets().types.some(function (t) { return t.name === '船票'; }) ? true : null;
    }, { label: '新类型未保存' });
    console.log('PASS 6. ' + cur);
  }

  cur = '7. 统计「票据花费」（自费计金额，报销排除，拍板 3/Q2）';
  {
    const w = makeWindow({
      data: {
        tickets: {
          items: [
            { id: 'a', type: 'train', name: 'A', date: today, price: 100, ext: {}, buyDate: today },
            { id: 'b', type: 'train', name: 'B', date: today, price: 200, ext: {}, buyDate: today },
            { id: 'c', type: 'movie', name: 'C', date: today, price: 50, ext: {}, buyDate: today },
            { id: 'd', type: 'train', name: 'R', date: today, price: 999, reimb: 'pending', ext: {}, buyDate: today }
          ],
          types: []
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('plan');
    await waitFor(function () {
      return doc.querySelector('[data-plan-stab=ticket]') ? true : null;
    }, { label: '统计分类未出现' });
    doc.querySelector('[data-plan-stab=ticket]').click();
    await waitFor(function () {
      const b = doc.querySelector('[data-body=ticketSpend]');
      return b && b.textContent.indexOf('火车票') >= 0 ? true : null;
    }, { label: '票据花费栏未渲染' });
    const t = doc.querySelector('[data-body=ticketSpend]').textContent;
    assert(t.indexOf('自费票据总花费 ¥350') >= 0, '自费 100+200+50=350 计入合计: ' + t.slice(0, 120));
    assert(t.indexOf('另有报销 1 张 ¥999 不计入统计') >= 0, '报销注脚应可见但不进合计: ' + t.slice(0, 160));
    console.log('PASS 7. ' + cur);
  }

  cur = '8. 编辑器可用：类型选择/切类型保值/保存不丢未渲染字段';
  {
    const w = makeWindow({
      data: {
        tickets: {
          items: [{
            id: 'm1', type: 'movie', name: '星际穿越', date: today, time: '14:00', endTime: '22:00',
            location: '万达影城', seat: '5排8座', price: 45, ticketNo: 'MV9', note: '',
            status: 'unused', images: [], buyDate: today, billId: '', todoId: '',
            ext: { cinema: '3号厅' }, createdAt: Date.now()
          }],
          types: []
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('tickets');
    await waitFor(function () { return doc.querySelector('.tk-card') ? true : null; }, { label: '票券卡未渲染' });
    doc.querySelector('.tk-card').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('[data-x=e]') ? m : null;
    }, { label: '详情未开（EXT_FIELDS 曾炸）' });
    lastModal(doc).querySelector('[data-x=e]').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#tk-type') ? m : null;
    }, { label: '编辑器未开（#tk-type 缺失曾炸）' });
    const m = lastModal(doc);
    assert(m.querySelector('#tk-type').value === 'movie', '类型应预选 movie');
    assert(m.querySelector('[data-fld=cinema]') && m.querySelector('[data-fld=cinema]').value === '3号厅', '专属字段应预填');
    assert(m.querySelector('[data-fld=name]').value === '星际穿越', '名称应预填');
    // 切类型：已填内容不丢（曾重绘回读原记录全丢）
    m.querySelector('[data-fld=name]').value = '星际穿越2';
    const sel = m.querySelector('#tk-type');
    sel.value = 'train';
    sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert(m.querySelector('[data-fld=no]') && m.querySelector('[data-fld=from]'), '切到 train 应出车次/出发站');
    sel.value = 'movie';
    sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert(m.querySelector('[data-fld=name]').value === '星际穿越2', '切类型回来已填内容不得丢: ' + m.querySelector('[data-fld=name]').value);
    // endTime 不在 movie 表单 → 保存不得抹掉（曾无条件写 endTime:''）
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return w.Storage.tickets().items[0].name === '星际穿越2' ? true : null;
    }, { label: '保存未生效' });
    const rec = w.Storage.tickets().items[0];
    assert(rec.endTime === '22:00', '未渲染字段 endTime 不得被清: ' + JSON.stringify(rec));
    assert(rec.location === '万达影城' && rec.seat === '5排8座', '已渲染字段应正常保存');
    assert(rec.ext && rec.ext.cinema === '3号厅', 'ext 不得丢');
    assert(rec.price === 45 && rec.ticketNo === 'MV9', '价格/票号应保留');
    console.log('PASS 8. ' + cur);
  }

  cur = '9. 详情弹窗（专属字段行）+ 作废终态（UI）';
  {
    const w = makeWindow({ data: { tickets: { items: [], types: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const doc = w.document;
    await S.saveTicket({
      type: 'train', name: '北京→上海', date: today, time: '09:00', endTime: '13:00',
      location: '北京南', seat: '01车12A', price: 553, ticketNo: 'E123', note: '备注X',
      buyDate: today, ext: { no: 'G1', from: '北京南', to: '上海虹桥', sub: '二等座' }
    });
    w.App.go('tickets');
    await waitFor(function () { return doc.querySelector('.tk-card') ? true : null; }, { label: '票券卡未渲染' });
    doc.querySelector('.tk-card').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('.tk-detail') ? m : null;
    }, { label: '详情弹窗未开' });
    const txt = lastModal(doc).textContent;
    assert(txt.indexOf('车次') >= 0 && txt.indexOf('G1') >= 0, '详情应有专属字段车次: ' + txt.slice(0, 120));
    assert(txt.indexOf('二等座') >= 0 && txt.indexOf('票号') >= 0 && txt.indexOf('E123') >= 0, '席别/票号应展示');
    assert(txt.indexOf('备注X') >= 0 && txt.indexOf('购买日期') >= 0, '备注/购买日期应展示');
    // 作废/已用/未用按钮全部移除（拍板 5）；报销切换按钮上线（拍板 3）
    assert(!lastModal(doc).querySelector('[data-x=void]'), '作废按钮已移除');
    assert(!lastModal(doc).querySelector('[data-x=unused]') && !lastModal(doc).querySelector('[data-x=use]'), '已用/未用按钮已移除');
    assert(lastModal(doc).querySelector('[data-x=to-reimb]'), '自费票应有「转为报销」');
    console.log('PASS 9. ' + cur);
  }

  cur = '10. 报销不记账：转报销回收账单 + status 字段废弃（拍板 3/Q2）';
  {
    const w = makeWindow({ data: { tickets: { items: [], types: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const rec = await S.saveTicket({ type: 'concert', name: '演唱会V', date: today, time: '19:00', endTime: '22:00', price: 380, buyDate: today, ext: {} });
    assert(rec.billId, '前提：自费已建账单');
    // 转报销：自动账单回收、billId 清空
    await S.saveTicket(Object.assign({}, S.tickets().items[0], { reimb: 'pending' }));
    const t0 = S.tickets().items[0];
    assert(t0.reimb === 'pending' && !t0.billId, '报销票应清账单绑定');
    assert(!w.Storage.getDB().wallet.bills.some(function (b) { return b.ticketId === rec.id; }), '自动账单应删除（报销不记账）');
    // 旧 status 字段写入被忽略（废弃）
    await S.saveTicket(Object.assign({}, t0, { status: 'used' }));
    assert(S.tickets().items[0].status === undefined, 'status 字段已废弃不再保存');
    // 已报销→转回自费：重建账单
    await S.saveTicket(Object.assign({}, S.tickets().items[0], { reimb: 'settled' }));
    await S.saveTicket(Object.assign({}, S.tickets().items[0], { reimb: 'none' }));
    assert(S.tickets().items[0].billId, '转回自费应重建账单');
    console.log('PASS 10. ' + cur);
  }

  cur = '11. 账单绑定：0 元跟随 + 并发不重复建 + 0 元不建';
  {
    const w = makeWindow({ data: { tickets: { items: [], types: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const bills = function () { return w.Storage.getDB().wallet.bills; };
    const rec = await S.saveTicket({ type: 'train', name: 'A', date: today, price: 100, buyDate: today, ext: {} });
    const billId = rec.billId;
    assert(billId, '前提：已建账单');
    // 票价改 0：金额跟随归 0（曾直接跳过留旧价 100），绑定不拆
    await S.saveTicket(Object.assign({}, S.tickets().items[0], { price: 0 }));
    const b0 = bills().filter(function (b) { return b.id === billId; })[0];
    assert(b0 && b0.amount === 0, '票价改 0 账单金额应跟随归 0: ' + JSON.stringify(b0));
    assert(S.tickets().items[0].billId === billId, '0 元仍保持绑定');
    await S.saveTicket(Object.assign({}, S.tickets().items[0], { price: 70 }));
    assert(bills().filter(function (b) { return b.id === billId; })[0].amount === 70, '改回 70 应跟随');
    // 并发重复保存同一票：只建一份账单
    const dup = { id: 'x1', type: 'movie', name: 'D', date: today, price: 60, buyDate: today, ext: {} };
    await Promise.all([S.saveTicket(Object.assign({}, dup)), S.saveTicket(Object.assign({}, dup))]);
    const dupBills = bills().filter(function (b) { return b.ticketId === 'x1'; });
    assert(dupBills.length === 1, '并发保存不得重复建账单: ' + dupBills.length);
    assert(S.tickets().items.filter(function (x) { return x.id === 'x1'; })[0].billId === dupBills[0].id, '票应绑到唯一账单');
    // 0 元新票不建账单
    const free = await S.saveTicket({ type: 'movie', name: 'E', date: today, price: 0, buyDate: today, ext: {} });
    assert(!free.billId && !bills().some(function (b) { return b.ticketId === free.id; }), '0 元票不应建账单');
    console.log('PASS 11. ' + cur);
  }

  cur = '12. 票↔日历：改期迁移物化块 + 清时刻删行程待办';
  {
    const w = makeWindow({ data: { tickets: { items: [], types: [] } } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const rec = await S.saveTicket({ type: 'concert', name: '演唱会M', date: today, time: '19:00', endTime: '22:00', price: 10, buyDate: today, ext: {} });
    const tid = rec.todoId;
    assert(tid, '前提：生成行程待办');
    assert(S.todoStatus(tid, today) === 'done' && S.timeline().blocks.length === 1, '前提：生成即完成并物化 1 块');
    // 改期：旧日完成态/物化块清掉，新日重建并按默认完成口径物化
    const tmr = addDay(today, 1);
    await S.saveTicket(Object.assign({}, S.tickets().items[0], { date: tmr }));
    assert(S.todoStatus(tid, today) === '', '旧日完成态应清掉');
    assert(S.todoStatus(tid, tmr) === 'done', '新日应重建为已完成（默认完成口径）');
    assert(S.timeline().blocks.length === 1 && S.timeline().blocks[0].date === tmr, '物化块应随改期落新日: ' +
      JSON.stringify(S.timeline().blocks.map(function (b) { return b.date; })));
    // 清掉时刻：行程待办删除不悬空
    await S.saveTicket(Object.assign({}, S.tickets().items[0], { time: '' }));
    assert(!S.tickets().items[0].todoId, '清时刻应解绑 todoId');
    assert(!S.todoDef(tid), '行程待办应删掉不悬空');
    console.log('PASS 12. ' + cur);
  }

  cur = '13. 计划段 ✕=跳过实例日 + 时间输入 24:00 往返';
  {
    // 目标日=本周三（若今天就是周三则用周四）：保证与今天不同且在当前周视图内
    const p = today.split('-');
    const dObj = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    const monday = ymd(new Date(dObj.getFullYear(), dObj.getMonth(), dObj.getDate() - ((dObj.getDay() + 6) % 7)));
    let target = addDay(monday, 2);
    if (target === today) target = addDay(monday, 3);
    const w = makeWindow({
      data: {
        todos: {
          defs: [{ id: 'p1', name: '异地计划段', date: target, start: '10:00', due: '11:00', repeat: 'none', remindBefore: 0, linkHabitId: '', archived: false }],
          done: {}
        },
        timeline: {
          blocks: [], points: [],
          types: [{ id: 'other', name: '其他', icon: 'circle', color: '#8e8e93', kind: 'block', linkHabitId: '' }],
          timer: null
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const doc = w.document;
    w.App.go('timeline');
    await waitFor(function () { return doc.querySelector('[data-tl-plan-del]') ? true : null; }, { label: '计划段未派生' });
    const delBtn = doc.querySelector('[data-tl-plan-del]');
    assert(delBtn.getAttribute('data-date') === target, '✕ 应带实例日 data-date: ' + delBtn.getAttribute('data-date'));
    delBtn.click();
    await waitFor(function () {
      return S.todoStatus('p1', target) === 'skipped' ? true : null;
    }, { label: '✕ 未跳过实例日' });
    assert(S.todoStatus('p1', today) === '', '✕ 不得误跳过今天（曾回退 today）');
    // 24:00 时间往返：type=time 会把 24:00 清成空，回退 text 保值
    await S.saveTimelineBlock({ date: today, start: '23:00', end: '24:00', typeId: 'other' });
    w.App.go('timeline');
    await waitFor(function () { return doc.querySelector('[data-tl-block]') ? true : null; }, { label: '时间段块未渲染' });
    doc.querySelector('[data-tl-block]').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#tl-end') ? m : null;
    }, { label: '块编辑器未开' });
    const m = lastModal(doc);
    assert(m.querySelector('#tl-end').value === '24:00', '24:00 结束时间不得被输入框清空: "' + m.querySelector('#tl-end').value + '"');
    m.querySelector('#tl-start').value = '22:30';
    m.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return S.timeline().blocks.some(function (b) { return b.start === '22:30' && b.end === '24:00'; }) ? true : null;
    }, { label: '24:00 改存未生效' });
    console.log('PASS 13. ' + cur);
  }

  cur = '14. 计时读数常驻 H:MM:SS + stopTimer 失败整组回滚';
  {
    const w = makeWindow({
      data: {
        timeline: {
          blocks: [], points: [], types: [],
          timer: { typeId: 'other', startedAt: Date.now() - 3661 * 1000, note: '' }
        }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('timeline');
    await waitFor(function () { return doc.getElementById('tl-timer-elapsed') ? true : null; }, { label: '计时读数未渲染' });
    const live = doc.getElementById('tl-timer-elapsed').textContent;
    assert(/^1:01:\d\d$/.test(live), '读数应为 H:MM:SS 且重渲即续走（不是 0:00）: ' + live);
    console.log('PASS 14a. 计时读数常驻（' + live + '）');
    // 失败回滚：跨天两段，第 2 段落盘失败 → 整组回滚、计时保留、重试不重复
    let failOn = true, tlSaveN = 0;
    const w2 = makeWindow({
      data: {
        timeline: {
          blocks: [], points: [], types: [],
          timer: { typeId: 'other', startedAt: Date.now() - 26 * 3600 * 1000, note: '' }
        }
      },
      routes: {
        '/api/save': function (o) {
          if (failOn && o.body && o.body.target === 'timeline') {
            tlSaveN++;
            if (tlSaveN === 2) return o.fail('disk full', 500);
          }
          return undefined;
        }
      }
    });
    if (!(await waitMain(w2))) throw new Error('no main');
    const S2 = w2.Storage;
    const doc2 = w2.document;
    w2.App.go('timeline');
    await waitFor(function () { return doc2.getElementById('tl-timer-stop') ? true : null; }, { label: '结束按钮未出现' });
    doc2.getElementById('tl-timer-stop').click();
    // 「生成失败」toast 在回滚完成后才弹——等它即保证 catch/undo 已收尾（防抢先断言）
    await waitFor(function () {
      const ts = doc2.querySelectorAll('.toast');
      for (let i = 0; i < ts.length; i++) {
        if ((ts[i].textContent || '').indexOf('生成失败') >= 0) return true;
      }
      return null;
    }, { label: '失败未提示' });
    assert(S2.timeline().blocks.length === 0, '失败应整组回滚不留半截段: ' + JSON.stringify(S2.timeline().blocks));
    assert(S2.timeline().timer, '失败应保留计时供重试');
    failOn = false;
    await waitFor(function () { return doc2.getElementById('tl-timer-stop') ? true : null; }, { label: '重试按钮未出现' });
    doc2.getElementById('tl-timer-stop').click();
    // 段数随真实时长/开计时时刻在 2~3 段间浮动（跨天拆分），只锁「完整生成、不重复、计时清掉」
    await waitFor(function () {
      return S2.timeline().blocks.length >= 2 && !S2.timeline().timer ? true : null;
    }, { label: '重试应完整生成各段' });
    assert(S2.timeline().blocks.every(function (b) { return b.source === 'timer'; }), '生成段应为 timer 来源');
    const tot = S2.timeline().blocks.reduce(function (s, b) {
      return s + (w2.TimelineView ? (w2.TimelineView.parseHM(b.end) - w2.TimelineView.parseHM(b.start)) : 0);
    }, 0);
    assert(tot >= 1500 && tot <= 1580, '重试生成的段总时长应≈计时时长（无重复/丢段）: ' + tot + ' 分');
    console.log('PASS 14b. stopTimer 失败回滚 + 重试不重复（' + S2.timeline().blocks.length + ' 段）');
  }

  cur = '15. 美食四合一（点格开编辑器预设该餐）+ 撤销 + 物品徽章并显';
  {
    const w = makeWindow({
      data: {
        food: [
          { id: 'f1', date: today, meal: '早餐', foodCuisine: '中餐', name: '包子', price: 8, tags: [], images: [] },
          { id: 'f2', date: today, meal: '晚餐', foodCuisine: '中餐', name: '火锅', price: 120, tags: [], images: [] }
        ],
        categories: { meal: ['早餐', '午餐', '晚餐', '加餐'], foodCuisine: ['中餐'], foodType: [], foodTag: [] }
      }
    });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const doc = w.document;
    w.App.go('home');
    await waitFor(function () {
      return doc.querySelector('.meal-slot[data-meal="早餐"]') ? true : null;
    }, { label: '分餐格未渲染' });
    // 拍板修正：点格=打开美食编辑器**添加该餐**（同美食日历语义），非直接记账
    doc.querySelector('.meal-slot[data-meal="早餐"]').click();
    await waitFor(function () {
      const m = lastModal(doc);
      return m && m.querySelector('#food-form') ? m : null;
    }, { label: '点格未打开美食编辑器' });
    const mealSel = lastModal(doc).querySelector('select[name=meal]');
    assert(mealSel && mealSel.value === '早餐', '编辑器应预设该餐: ' + (mealSel && mealSel.value));
    const modal15 = lastModal(doc);
    modal15.querySelector('input[name=price]').value = '12';
    modal15.querySelector('input[name=name]').value = '小笼包';
    modal15.querySelector('select[name=foodCuisine]').value = '中餐';
    modal15.querySelector('[data-x=s]').click();
    await waitFor(function () {
      return (S.getDB().food || []).filter(function (f) { return f.meal === '早餐'; }).length === 2 ? true : null;
    }, { label: '编辑器保存后未计顿' });
    await waitFor(function () {
      const el = doc.querySelector('.meal-slot[data-meal="早餐"]');
      return el && el.textContent.indexOf('2') >= 0 ? true : null;
    }, { label: '重复打卡应显次数' });
    // 撤销最近一条：只删本餐别最后一条（新记的「早餐」），包子/火锅不动
    doc.querySelector('.meal-del[data-meal-del="早餐"]').click();
    await waitFor(function () {
      const food = (S.getDB().food || []).filter(function (f) { return f.meal === '早餐'; });
      return food.length === 1 ? true : null;
    }, { label: '撤销未生效' });
    const rest = S.getDB().food;
    assert(rest.filter(function (f) { return f.meal === '早餐'; })[0].name === '包子', '应删最近一条、留下早先的包子: ' +
      JSON.stringify(rest.map(function (f) { return f.meal + ':' + f.name; })));
    assert(rest.filter(function (f) { return f.meal === '晚餐'; }).length === 1, '其他餐别不得误删');
    // 物品徽章（v1.2.6 拍板 11）：在用不标注，其余状态分色外显
    const card1 = w.UI.itemCard({ id: 'i1', kind: 'life', name: '洗面奶', status: 'idle', remainLevel: '空', useCount: 2, purchasePrice: 60, cost: {} }, {});
    assert(card1.indexOf('空瓶') >= 0 && card1.indexOf('st-idle') >= 0, '空瓶与闲置徽章应并显分色: ' + card1.slice(card1.indexOf('item-badges'), 240));
    const card2 = w.UI.itemCard({ id: 'i2', kind: 'life', name: '面霜', status: 'in_use', remainLevel: '满', useCount: 1, purchasePrice: 90, cost: {} }, {});
    assert(card2.indexOf('在用') < 0 && card2.indexOf('badge-status') < 0, '在用不标注（拍板 11）: ' + card2.slice(card2.indexOf('item-badges'), 220));
    const card3 = w.UI.itemCard({ id: 'i3', kind: 'life', name: '护手霜', status: 'borrowed', remainLevel: '满', useCount: 1, purchasePrice: 30, cost: {} }, {});
    assert(card3.indexOf('st-borrowed') >= 0 && card3.indexOf('借出') >= 0, '借出应分色标注');
    console.log('PASS 15. ' + cur);
  }

  console.log('========== v134-tickets：15 项全部通过 ==========');
}

main().catch(function (e) {
  console.log('FAIL ' + cur + ': ' + (e && e.message || e));
  process.exit(1);
});
