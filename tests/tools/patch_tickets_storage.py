# -*- coding: utf-8 -*-
"""storage.js 追加 tickets 域（票据：绑定/联动/落盘）——脚本文件避开 shell 引号问题"""
import io

P = 'app/js/storage.js'
s = io.open(P, encoding='utf-8').read()

if 'normTickets' in s:
    print('already patched')
    raise SystemExit

# 1) loadAll 加 tickets
s = s.replace(
    "      timeline: normTimeline(raw.timeline),",
    "      timeline: normTimeline(raw.timeline),\n      tickets: normTickets(raw.tickets),")

# 2) persist 加 tickets 分支
s = s.replace(
    "    // timeline 域（v1.2.01 时间日历）：时间段 + 记录类时间点 + 自定义类型 + 计时器\n"
    "    if (!scope || scope === 'timeline') {\n"
    "      const tl = db.timeline || {};\n"
    "      push('timeline', {\n"
    "        blocks: tl.blocks || [], points: tl.points || [],\n"
    "        types: tl.types || [], timer: tl.timer || null\n"
    "      });\n"
    "    }",
    "    // timeline 域（v1.2.01 时间日历）：时间段 + 记录类时间点 + 自定义类型 + 计时器\n"
    "    if (!scope || scope === 'timeline') {\n"
    "      const tl = db.timeline || {};\n"
    "      push('timeline', {\n"
    "        blocks: tl.blocks || [], points: tl.points || [],\n"
    "        types: tl.types || [], timer: tl.timer || null\n"
    "      });\n"
    "    }\n"
    "    // tickets 域（v1.2.5 我的票据）：票证 + 类型\n"
    "    if (!scope || scope === 'tickets') {\n"
    "      const tk = db.tickets || {};\n"
    "      push('tickets', { items: tk.items || [], types: tk.types || [] });\n"
    "    }")

BLOCK = r'''
  /* ===== 我的票据（tickets 域，v1.2.5）=====
     items：票证（车票/演唱会/电影…）；types：预设+自定义类型。
     账单双向绑定（对齐美食口径）：price>0 自动建支出账单（bill.ticketId）；票价改动账单金额跟随；
     删票→账单保留（解绑）。时间日历联动（拍板 Q1:A）：票生成时间段待办（todoId 双向），
     标已用=待办勾完成，待办勾完成反向标已用（幂等）。 */
  const TICKET_TYPES = [
    { id: 'train', name: '火车票', icon: 'train-front', cat: 'w_traffic' },
    { id: 'flight', name: '飞机票', icon: 'plane', cat: 'w_traffic' },
    { id: 'bus', name: '汽车票', icon: 'bus', cat: 'w_traffic' },
    { id: 'concert', name: '演唱会', icon: 'mic', cat: 'w_fun' },
    { id: 'movie', name: '电影', icon: 'film', cat: 'w_fun' },
    { id: 'exhibition', name: '展览', icon: 'palette', cat: 'w_fun' },
    { id: 'other', name: '其他', icon: 'ticket', cat: 'w_other_exp' }
  ];
  function normTickets(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      items: Array.isArray(r.items) ? r.items.filter(function (x) { return x && typeof x === 'object'; }).map(function (x) {
        return {
          id: String(x.id || U.uid()), type: String(x.type || 'other'), name: String(x.name || '未命名'),
          date: String(x.date || ''), time: String(x.time || ''), endTime: String(x.endTime || ''),
          location: String(x.location || ''), seat: String(x.seat || ''),
          price: Number(x.price) || 0, ticketNo: String(x.ticketNo || ''), note: String(x.note || ''),
          status: (x.status === 'used' || x.status === 'void') ? x.status : 'unused',
          images: Array.isArray(x.images) ? x.images.slice() : [],
          buyDate: String(x.buyDate || ''), billId: String(x.billId || ''), todoId: String(x.todoId || ''),
          ext: (x.ext && typeof x.ext === 'object') ? Object.assign({}, x.ext) : {},
          createdAt: x.createdAt || Date.now()
        };
      }) : [],
      types: Array.isArray(r.types) && r.types.length ? r.types.filter(function (x) { return x && typeof x === 'object'; }).map(function (x) {
        return { id: String(x.id || U.uid()), name: String(x.name || '未命名'), icon: String(x.icon || 'ticket'), cat: String(x.cat || 'w_other_exp') };
      }) : TICKET_TYPES.map(function (t) { return Object.assign({}, t); })
    };
  }
  function tickets() { db.tickets = db.tickets || normTickets(null); return db.tickets; }
  function ticketBillCat(typeId) {
    const t = (tickets().types || []).filter(function (x) { return x.id === typeId; })[0];
    return (t && t.cat) || 'w_other_exp';
  }
  /* 票 ↔ 时间段待办（Q1:A）：行程进时间日历/主页；双向状态同步 */
  function ticketSyncTodo(tk) {
    const due = tk.endTime || (function () {
      const m = /^(\d{1,2}):(\d{2})$/.exec(tk.time || '');
      if (!m) return '23:59';
      const mm = (Number(m[1]) * 60 + Number(m[2]) + 120) % (24 * 60);
      return String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0');
    })();
    const def = {
      id: tk.todoId || U.uid(), name: tk.name || '行程', date: tk.date || U.todayStr(),
      start: tk.time || '09:00', due: due,
      repeat: 'none', repeatOn: [], interval: 1, remindBefore: 30,
      linkHabitId: '', location: tk.location || '', priority: 'mid',
      repeatUntil: '', createdAt: Date.now(), archived: false, ticketId: tk.id
    };
    return saveTodoDef(def).then(function () {
      tk.todoId = def.id;
      const cur = todoStatus(def.id, def.date);
      if (tk.status === 'used' && cur !== 'done') return setTodoDone(def.id, def.date, 'done');
      if (tk.status !== 'used' && cur === 'done') return setTodoDone(def.id, def.date, '');
    });
  }
  function saveTicket(tk) {
    const t = tickets();
    tk = tk || {};
    const rec = {
      id: tk.id || U.uid(), type: String(tk.type || 'other'), name: String(tk.name || '未命名'),
      date: String(tk.date || ''), time: String(tk.time || ''), endTime: String(tk.endTime || ''),
      location: String(tk.location || ''), seat: String(tk.seat || ''),
      price: Number(tk.price) || 0, ticketNo: String(tk.ticketNo || ''), note: String(tk.note || ''),
      status: (tk.status === 'used' || tk.status === 'void') ? tk.status : 'unused',
      images: Array.isArray(tk.images) ? tk.images.slice() : [],
      buyDate: String(tk.buyDate || '') || U.todayStr(),
      billId: String(tk.billId || ''), todoId: String(tk.todoId || ''),
      ext: (tk.ext && typeof tk.ext === 'object') ? Object.assign({}, tk.ext) : {},
      createdAt: tk.createdAt || Date.now()
    };
    const i = t.items.findIndex(function (x) { return x.id === rec.id; });
    const prev = i >= 0 ? t.items[i] : null;
    if (i >= 0) t.items[i] = rec; else t.items.push(rec);
    const jobs = [];
    if (rec.date && rec.time) jobs.push(ticketSyncTodo(rec));
    jobs.push(ticketSyncBill(rec, prev));
    return Promise.all(jobs).then(function () {
      return persist('tickets');
    }).then(function () {
      return persist('todos').catch(function () {});
    }).then(function () { return rec; }).catch(function (e) {
      if (prev) t.items[t.items.indexOf(rec)] = prev;
      else t.items.splice(t.items.indexOf(rec), 1);
      throw e;
    });
  }
  /* 票→账单：无 billId 且 price>0 自动建；已绑则金额跟随（拍板 10/11） */
  function ticketSyncBill(rec) {
    if (rec.status === 'void' || !rec.price) return Promise.resolve();
    const bills = db.wallet.bills;
    if (rec.billId) {
      const bill = bills.filter(function (b) { return b.id === rec.billId; })[0];
      if (!bill) { rec.billId = ''; }
      else if (bill.amount !== Math.abs(rec.price)) {
        bill.amount = Math.abs(rec.price);
        return persist('wallet');
      } else return Promise.resolve();
    }
    const bill = {
      id: U.uid(), type: 'expense',
      amount: Math.abs(Number(rec.price) || 0),
      date: rec.buyDate || rec.date || U.todayStr(), time: '',
      catId: ticketBillCat(rec.type), subCatId: '',
      accountId: '', note: rec.name || '',
      tagIds: [], ticketId: rec.id, source: 'manual',
      createdAt: new Date().toISOString()
    };
    bills.push(bill);
    rec.billId = bill.id;
    return persist('wallet');
  }
  function removeTicket(id) {
    const t = tickets();
    const i = t.items.findIndex(function (x) { return x.id === id; });
    if (i < 0) return Promise.resolve();
    const rec = t.items[i];
    t.items.splice(i, 1);
    const jobs = [persist('tickets')];
    if (rec.billId) {
      const bill = (db.wallet.bills || []).filter(function (b) { return b.id === rec.billId; })[0];
      if (bill) { delete bill.ticketId; jobs.push(persist('wallet')); }
    }
    if (rec.todoId) jobs.push(removeTodoDef(rec.todoId).catch(function () {}));
    return Promise.all(jobs).catch(function (e) {
      t.items.splice(Math.min(i, t.items.length), 0, rec);
      throw e;
    });
  }
  /* 待办勾完成 → 票反向标已用（ticketId 关联，幂等） */
  function syncTicketFromTodo(defId, dateStr, done) {
    const t = db.tickets || { items: [] };
    const rec = (t.items || []).filter(function (x) { return x.todoId === defId && x.date === dateStr; })[0];
    if (!rec) return null;
    const want = done ? 'used' : 'unused';
    if (rec.status === want) return null;
    rec.status = want;
    return persist('tickets');
  }

'''
anchor = "  function setTimelineTimer(t) {"
assert anchor in s, 'anchor missing'
s = s.replace(anchor, BLOCK + anchor)

# 3) 导出
s = s.replace(
    "    saveTimelineType: saveTimelineType, removeTimelineType: removeTimelineType,",
    "    saveTimelineType: saveTimelineType, removeTimelineType: removeTimelineType,\n"
    "    /* 我的票据（tickets 域，v1.2.5） */\n"
    "    tickets: tickets, TICKET_TYPES: TICKET_TYPES, normTickets: normTickets,\n"
    "    saveTicket: saveTicket, removeTicket: removeTicket, syncTicketFromTodo: syncTicketFromTodo,\n"
    "    saveTickets: function () { return persist('tickets'); },")

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('storage patched')
