/* views-tickets.js — 我的票据（v1.2.6 完全重构）
   票面各票种独立仿真形态（拍板 7）：铁路式（火车/汽车）· 登机牌（飞机）· 票根式（演唱会/电影/展览）
   · 景点门票 · 简洁卡（其他/自定义）——卡片尺寸统一，形态/配色各异。
   · 已用/未用移除（拍板 5）；费用性质 自费/待报销/已报销（拍板 3/Q2）：报销票不记账不进任何金额统计
   · 跨天（拍板 9）：到达日期 arriveDate——票面 +N天 标记，行程待办按真实起止逐日拆段
   · 账单绑定：自费票 price>0 自动建账单、金额跟随、删票解绑保留；报销票回收/不建
   · 时间日历联动：票生成时间段待办（todoId，类型映射 commute/fun，拍板 2） */
'use strict';
window.TicketsView = (function () {
  const S = window.Storage, U = window.Utils, UI = window.UI;

  function esc(t) { return U.escapeHtml(t == null ? '' : t); }
  function resetState() { /* 无会话态 */ }

  /* ---------- 类型 ---------- */
  function types() { return (S.tickets() || {}).types || []; }
  function typeOf(id) {
    const t = types().filter(function (x) { return x.id === id; })[0];
    return t || { id: id, name: id, icon: 'ticket', cat: 'w_other_exp' };
  }
  /* 表单字段（v1.2.6 二次定稿）：基础信息=购买日期/价格/费用性质（仅 3 项）；
     日期时间全在专属信息（交通类=出发对→到达对四件套；演出/游览类=领域词）。
     数组顺序=表单顺序；[key, 标签, 占位, 必填, 'full'=占整行]。key 属 TOP_FIELDS=顶层，否则 ext。
     共性排布：标识字段打头 → 日期|时间成对同排（日期在左）→ 席位/分区 → 票号/备注垫底 */
  const TOP_FIELDS = ['name', 'location', 'date', 'arriveDate', 'time', 'endTime', 'seat', 'ticketNo', 'note'];
  const TYPE_FORM = {
    train: [
      ['no', '车次', '如：G1', 1, 'full'],
      ['from', '出发站', '如：上海虹桥', 1], ['to', '到达站', '如：北京南', 1],
      ['date', '出发日期', '', 1], ['time', '开车时间', '', 1],
      ['arriveDate', '到达日期', '', 0], ['endTime', '到达时间', '', 1],
      ['gate', '检票口', '如：5B', 0], ['sub', '席别', '如：二等座', 0],
      ['seat', '座位', '如：01车12A', 0], ['ticketNo', '票号', '', 0],
      ['note', '备注', '', 0, 'full']
    ],
    flight: [
      ['no', '航班号', '如：CA123', 1, 'full'],
      ['from', '出发机场', '如：萧山T3', 1], ['to', '到达机场', '如：首都T3', 1],
      ['date', '出发日期', '', 1], ['time', '登机时间', '', 1],
      ['arriveDate', '到达日期', '', 0], ['endTime', '到达时间', '', 0],
      ['gate', '登机口', '如：A12', 0], ['sub', '舱位', '如：经济舱', 0],
      ['seat', '座位', '', 0], ['ticketNo', '票号', '', 0],
      ['note', '备注', '', 0, 'full']
    ],
    bus: [
      ['no', '班次', '', 0, 'full'],
      ['from', '出发站', '', 1], ['to', '到达站', '', 1],
      ['date', '出发日期', '', 1], ['time', '出发时间', '', 1],
      ['arriveDate', '到达日期', '', 0], ['endTime', '到达时间', '', 0],
      ['seat', '座位', '', 0], ['ticketNo', '票号', '', 0],
      ['note', '备注', '', 0, 'full']
    ],
    concert: [
      ['name', '艺人 / 场次', '如：周杰伦·嘉年华', 1, 'full'],
      ['location', '场馆', '如：国家体育场', 1, 'full'],
      ['date', '开演日期', '', 1], ['time', '开演时间', '', 1],
      ['arriveDate', '散场日期', '', 0], ['endTime', '散场时间', '', 0],
      ['sub', '区域', '如：看台 C 区', 0], ['seat', '座位', '如：12排34号', 0],
      ['ticketNo', '票号', '', 0], ['note', '备注', '', 0]
    ],
    movie: [
      ['name', '影片', '', 1, 'full'],
      ['location', '影院', '', 1], ['cinema', '影厅', '如：3号厅', 1],
      ['date', '场次日期', '', 1], ['time', '场次时间', '', 1],
      ['seat', '座位', '', 0], ['ticketNo', '票号', '', 0],
      ['note', '备注', '', 0, 'full']
    ],
    exhibition: [
      ['name', '展览名称', '', 1, 'full'],
      ['location', '场馆', '', 1, 'full'],
      ['date', '参观日期', '', 1], ['time', '参观时间', '', 0],
      ['ticketNo', '票号', '', 0], ['note', '备注', '', 0]
    ],
    attraction: [
      ['name', '景点名称', '如：拙政园', 1, 'full'],
      ['location', '地点', '如：苏州市姑苏区', 1, 'full'],
      ['date', '游览日期', '', 1], ['time', '入场时间', '', 0],
      ['ticketNo', '票号', '', 0], ['note', '备注', '', 0]
    ],
    other: [
      ['name', '名称', '', 1, 'full'],
      ['location', '地点', '', 0, 'full'],
      ['date', '日期', '', 0], ['time', '时间', '', 0],
      ['seat', '座位', '', 0], ['ticketNo', '票号', '', 0],
      ['note', '备注', '', 0, 'full']
    ]
  };
  function formFieldsOf(typeId) { return TYPE_FORM[typeId] || TYPE_FORM.other; }

  /* ---------- 票面（各票种独立形态，卡片尺寸统一） ---------- */
  function fmtDateCn(ds) {
    return ds ? (Number(ds.slice(0, 4)) + '/' + ds.slice(5, 7) + '/' + ds.slice(8, 10)) : '';
  }
  function dayDelta(a, b) {
    if (!a || !b || b <= a) return 0;
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }
  function plusDays(t) {
    const n = dayDelta(t.date, t.arriveDate);
    return n > 0 ? '<span class="tk-plusday">+' + n + '天</span>' : '';
  }
  function priceText(t) { return '¥' + (Number(t.price) || 0).toFixed(1); }

  /* ---------- 票面 OCR（v1.2.6 拍板 Q3）：本地识别 → 启发式提取 → 预填空字段人工核对 ---------- */
  function blobToPNGDataURL(blob) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = function () {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        try { resolve(c.toDataURL('image/png')); } catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }
  function extractTicketFields(text) {
    const out = {};
    const t = String(text || '').replace(/\s+/g, ' ');
    let m = /\b([GDKCZ]\d{1,4})\b/.exec(t); // 车次
    if (m) out.no = m[1];
    else {
      m = /\b([A-Z]{2}\d{3,4})\b/.exec(t); // 航班号
      if (m) out.no = m[1];
    }
    m = /(20\d{2})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/.exec(t); // 日期
    if (m) out.date = m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    const times = t.match(/\d{1,2}:\d{2}/g) || []; // 时间对
    if (times[0]) out.time = times[0].length === 4 ? '0' + times[0] : times[0];
    if (times[1] && times[1] !== times[0]) out.endTime = times[1].length === 4 ? '0' + times[1] : times[1];
    m = /¥\s*(\d+(?:\.\d{1,2})?)/.exec(t) || /票价?\s*[：:]?\s*(\d+(?:\.\d{1,2})?)/.exec(t); // 票价
    if (m) out.price = m[1];
    const stations = (t.match(/[一-龥]{2,7}(?:站|机场)/g) || []).filter(function (s, i, a) {
      return a.indexOf(s) === i;
    }); // 出发/到达（去重保序）
    if (stations.length >= 2) { out.from = stations[0]; out.to = stations[stations.length - 1]; }
    m = /(\d{1,2}车\d{1,3}[A-F]?)/.exec(t); // 座位
    if (m) out.seat = m[1];
    m = /\b(E?\d{14})\b/.exec(t); // 票号（14 位）
    if (m) out.ticketNo = m[1];
    return out;
  }

  /* 铁路式（火车=蓝头 / 汽车=绿头）：票号顶行 → 起点 —车次→ 终点（同排）→ 日期开到 → 座位席别 → 价格 */
  function railFaceHTML(t, headTitle) {
    const no = (t.ext && t.ext.no) ? esc(t.ext.no) : '';
    return '<div class="tk-rail-head"><span>' + headTitle + '</span>' +
      (t.ticketNo ? '<span class="tk-rail-no">No.' + esc(t.ticketNo) + '</span>' : '') + '</div>' +
      '<div class="tk-rail-body">' +
      '<div class="tk-rail-route">' +
      '<div class="tk-station">' + esc((t.ext && t.ext.from) || '') + '</div>' +
      '<div class="tk-arrowwrap"><span class="tk-trainno">' + no + '</span><span class="tk-arrowline"></span></div>' +
      '<div class="tk-station">' + esc((t.ext && t.ext.to) || '') + '</div>' +
      '</div>' +
      '<div class="tk-rail-row"><span>' + esc(fmtDateCn(t.date)) + ' ' + esc(t.time || '') + '开' +
      (t.endTime ? ' → ' + esc(t.endTime) + '到' : '') + plusDays(t) + '</span>' +
      '<span>' + esc([t.seat, t.ext && t.ext.sub].filter(Boolean).join(' · ')) + '</span></div>' +
      '<div class="tk-rail-row"><span class="tk-muted">' + (t.ext && t.ext.gate ? '检票口 ' + esc(t.ext.gate) : '') + '</span>' +
      '<span class="tk-price">' + priceText(t) + '</span></div>' +
      '</div>';
  }
  /* 登机牌：左红竖条 + FROM ✈ 航班 TO + 右存根（座位大字） */
  function flightFaceHTML(t) {
    return '<div class="tk-board">' +
      '<div class="tk-board-main">' +
      '<div class="tk-board-h">登机牌' + (t.ticketNo ? '<span class="tk-rail-no">No.' + esc(t.ticketNo) + '</span>' : '') + '</div>' +
      '<div class="tk-rail-route">' +
      '<div class="tk-station">' + esc((t.ext && t.ext.from) || '') + '</div>' +
      '<div class="tk-arrowwrap"><span class="tk-trainno">' + esc((t.ext && t.ext.no) || '') + '</span>' +
      '<span class="tk-airline">✈</span></div>' +
      '<div class="tk-station">' + esc((t.ext && t.ext.to) || '') + '</div>' +
      '</div>' +
      '<div class="tk-board-rows">' +
      '<div class="tk-rail-row"><span>' + esc(fmtDateCn(t.date)) + ' 登机 ' + esc(t.time || '') +
      (t.endTime ? ' · 到达 ' + esc(t.endTime) : '') + plusDays(t) + '</span></div>' +
      '<div class="tk-rail-row"><span>' +
      esc([t.ext && t.ext.gate ? '登机口 ' + t.ext.gate : '', t.ext && t.ext.sub, t.seat].filter(Boolean).join(' · ')) +
      '</span><span class="tk-price">' + priceText(t) + '</span></div>' +
      '</div></div>' +
      '<div class="tk-board-stub"><div class="tk-stub-k">座位</div>' +
      '<div class="tk-stub-seat">' + esc(t.seat || '—') + '</div>' +
      '<div class="tk-muted">' + esc((t.ext && t.ext.sub) || '') + '</div></div>' +
      '</div>';
  }
  /* 票根式（演唱会/电影/展览）：主券（标题+字段行+价格）+ 打孔线 + 右副券 */
  const EV_LABEL = {
    concert: { location: '场馆', sub: '区域', head: '演唱会' },
    movie: { location: '影院', cinema: '影厅', head: '电影票' },
    exhibition: { location: '场馆', sub: '展区', head: '展览' }
  };
  function eventFaceHTML(t) {
    const lab = EV_LABEL[t.type] || EV_LABEL.concert;
    const rows = [];
    if (t.location) rows.push([lab.location, esc(t.location)]);
    if (t.ext && t.ext.cinema) rows.push([lab.cinema || '影厅', esc(t.ext.cinema)]);
    if (t.time) rows.push(['时间', esc(t.time) + (t.endTime ? ' - ' + esc(t.endTime) : '') + plusDays(t)]);
    if (t.ext && t.ext.sub) rows.push([lab.sub || '区域', esc(t.ext.sub)]);
    if (t.seat) rows.push(['座位', esc(t.seat)]);
    return '<div class="tk-ev-main">' +
      '<div class="tk-ev-tag">' + lab.head + '</div>' +
      '<div class="tk-name">' + esc(t.name) + '</div>' +
      '<div class="tk-ev-rows">' +
      rows.map(function (r) { return '<div class="tk-where"><span class="tk-k">' + r[0] + '：</span>' + r[1] + '</div>'; }).join('') +
      '</div>' +
      '<div class="tk-price">' + priceText(t) + '</div>' +
      '</div>' +
      '<div class="tk-ev-sub"><div class="tk-sub-h">副券</div>' +
      '<div class="tk-sub-d">' + esc(fmtDateCn(t.date)) + '</div>' +
      (t.seat ? '<div class="tk-sub-d">' + esc(t.seat) + '</div>' : '') +
      (t.ext && t.ext.sub ? '<div class="tk-sub-d">' + esc(t.ext.sub) + '</div>' : '') +
      (t.ticketNo ? '<div class="tk-sub-no">TK ' + esc(t.ticketNo) + '</div>' : '') +
      '</div>';
  }
  /* 景点门票：大标题景点名 + 日期/价格 + 齿孔副券 */
  function attractionFaceHTML(t) {
    return '<div class="tk-att-head">景区门票' + (t.ticketNo ? '<span class="tk-rail-no">No.' + esc(t.ticketNo) + '</span>' : '') + '</div>' +
      '<div class="tk-att-main">' +
      '<div class="tk-name">' + esc(t.name) + '</div>' +
      (t.location ? '<div class="tk-muted">' + esc(t.location) + '</div>' : '') +
      '<div class="tk-rail-row"><span>' + esc(fmtDateCn(t.date)) +
      (t.time ? ' · ' + esc(t.time) + ' 入场' : '') + plusDays(t) + '</span>' +
      '<span class="tk-price">' + priceText(t) + '</span></div>' +
      '</div>' +
      '<div class="tk-att-sub"><div class="tk-sub-h">副券</div>' +
      '<div class="tk-sub-d">' + esc(fmtDateCn(t.date)) + '</div>' +
      (t.seat ? '<div class="tk-sub-d">' + esc(t.seat) + '</div>' : '') +
      '</div>';
  }
  /* 简洁卡（其他/自定义类型） */
  function otherFaceHTML(t) {
    const rows = [];
    if (t.location) rows.push(['地点', esc(t.location)]);
    if (t.time) rows.push(['时间', esc(t.time) + (t.endTime ? ' - ' + esc(t.endTime) : '') + plusDays(t)]);
    if (t.seat) rows.push(['座位', esc(t.seat)]);
    return '<div class="tk-ev-main tk-simple">' +
      '<div class="tk-ev-tag">' + esc(typeOf(t.type).name) + '</div>' +
      '<div class="tk-name">' + esc(t.name) + '</div>' +
      '<div class="tk-ev-rows">' +
      rows.map(function (r) { return '<div class="tk-where"><span class="tk-k">' + r[0] + '：</span>' + r[1] + '</div>'; }).join('') +
      '</div>' +
      '<div class="tk-price">' + priceText(t) + '</div>' +
      '</div>';
  }
  function faceHTML(t) {
    if (t.type === 'train') return railFaceHTML(t, '中国铁路 · 电子客票');
    if (t.type === 'bus') return railFaceHTML(t, '长途汽车票');
    if (t.type === 'flight') return flightFaceHTML(t);
    if (t.type === 'concert' || t.type === 'movie' || t.type === 'exhibition') return eventFaceHTML(t);
    if (t.type === 'attraction') return attractionFaceHTML(t);
    return otherFaceHTML(t);
  }
  function reimbFlagHTML(t) {
    if (!t.reimb || t.reimb === 'none') return '';
    return '<div class="tk-reimb-flag' + (t.reimb === 'settled' ? ' is-settled' : '') + '">' +
      (t.reimb === 'settled' ? '已报销' : '待报销') + '</div>';
  }
  function ticketCardHTML(t) {
    return '<div class="tk-card tk-face-' + esc(t.type) + '" data-tk="' + esc(t.id) + '" title="点击看详情">' +
      faceHTML(t) + reimbFlagHTML(t) +
      '</div>';
  }

  /* ---------- 主渲染 ---------- */
  function render(main) {
    const db = S.getDB();
    const items = ((db.tickets || {}).items || []).slice().sort(function (a, b) {
      return (b.date || '') < (a.date || '') ? -1 : 1; // 使用日期倒序
    });
    main.innerHTML =
      '<div class="page-head"><h2>我的票据</h2><div class="page-actions">' +
      '<button type="button" class="btn btn-primary btn-sm" id="tk-add">' + UI.icon('plus', 13) + ' 添加</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="tk-types" title="类型管理">' + UI.icon('settings', 13) + '</button>' +
      '</div></div>' +
      (items.length
        ? '<div class="tk-wall">' + items.map(ticketCardHTML).join('') + '</div>'
        : '<div class="empty-state empty-card"><div class="empty-icon">' + UI.icon('ticket', 48) + '</div>' +
        '<p>还没有票据——车票、演唱会门票都能记</p>' +
        '<button type="button" class="btn btn-primary" id="tk-add-empty">＋ 添加票据</button></div>');
    bind(main);
  }

  /* ---------- 详情（大票面 + 操作） ---------- */
  function openDetail(id) {
    const t = (S.tickets().items || []).filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    const ty = typeOf(t.type);
    const ext = formFieldsOf(t.type).filter(function (f) { return TOP_FIELDS.indexOf(f[0]) < 0; });
    const extHTML = ext.map(function (f) {
      return t.ext && t.ext[f[0]] ? '<div class="kv-row"><span>' + f[1] + '</span><strong>' + esc(t.ext[f[0]]) + '</strong></div>' : '';
    }).join('');
    UI.modal({
      title: ty.name, width: 560,
      bodyHTML: '<div class="tk-detail">' +
        '<div class="tk-card tk-face-' + esc(t.type) + ' tk-big">' + faceHTML(t) + reimbFlagHTML(t) + '</div>' +
        '<div class="detail-kv">' + extHTML +
        (t.ticketNo ? '<div class="kv-row"><span>票号</span><strong>' + esc(t.ticketNo) + '</strong></div>' : '') +
        '<div class="kv-row"><span>购买日期</span><strong>' + esc(t.buyDate || '—') + '</strong></div>' +
        '<div class="kv-row"><span>使用日期</span><strong>' + esc(t.date || '—') +
        (t.arriveDate && t.arriveDate !== t.date ? ' → 到达 ' + esc(t.arriveDate) : '') + '</strong></div>' +
        '<div class="kv-row"><span>费用性质</span><strong>' + esc((S.REIMB_OPTS || {})[t.reimb] || '自费') + '</strong></div>' +
        (t.note ? '<div class="kv-row"><span>备注</span><strong>' + esc(t.note) + '</strong></div>' : '') +
        '<div class="kv-row"><span>账单</span><strong>' +
        (t.reimb && t.reimb !== 'none' ? '报销票不记账' : (t.billId ? '已绑定（金额由票价维护）' : '未绑定')) +
        '</strong></div>' +
        '</div>' +
        (t.images && t.images.length ? '<div class="detail-imgs">' + t.images.map(function (p) {
          return '<img data-path="' + esc(p) + '" alt=""/>';
        }).join('') + '</div>' : '') +
        '</div>',
      footerHTML:
        // 报销状态切换（拍板 3/Q2）：转报销=回收自动账单（confirm）；已报销一键标记
        (t.reimb === 'none' ? '<button type="button" class="btn btn-ghost" data-x="to-reimb">转为报销</button>' : '') +
        (t.reimb === 'pending' ? '<button type="button" class="btn btn-primary" data-x="settle">标记已报销</button>' +
          '<button type="button" class="btn btn-ghost" data-x="to-self">转回自费</button>' : '') +
        (t.reimb === 'settled' ? '<button type="button" class="btn btn-ghost" data-x="to-self">转回自费</button>' : '') +
        '<div class="flex1"></div>' +
        '<button type="button" class="btn btn-danger" data-x="del">删除</button>' +
        '<button type="button" class="btn btn-ghost" data-x="c">关闭</button>' +
        '<button type="button" class="btn btn-primary" data-x="e">编辑</button>',
      onMount: function (w, close) {
        w.querySelectorAll('img[data-path]').forEach(async function (img) {
          const url = await S.getImageURL(img.getAttribute('data-path'));
          if (url) img.src = url;
        });
        w.querySelector('[data-x=c]').addEventListener('click', close);
        w.querySelector('[data-x=e]').addEventListener('click', function () { close(); openEditor(t); });
        function saveReimb(reimb, msg) {
          S.saveTicket(Object.assign({}, t, { reimb: reimb })).then(function () {
            close(); UI.toast(msg, 'success');
            setTimeout(function () { render(document.getElementById('main-content')); }, 60);
          }).catch(function (e) { UI.toast('操作失败：' + ((e && e.message) || e), 'error'); });
        }
        const tr = w.querySelector('[data-x=to-reimb]');
        if (tr) tr.addEventListener('click', function () {
          UI.confirmDialog('转为报销', t.billId
            ? '报销票不记账——自动建的账单将删除，票价不再计入任何统计。继续？'
            : '报销票不记账，票价仅在票据展示、不计入任何统计。继续？').then(function (ok) {
            if (ok) saveReimb('pending', '已转为待报销');
          });
        });
        const se = w.querySelector('[data-x=settle]');
        if (se) se.addEventListener('click', function () { saveReimb('settled', '已标记为已报销'); });
        const ts = w.querySelector('[data-x=to-self]');
        if (ts) ts.addEventListener('click', function () {
          UI.confirmDialog('转回自费', '将按票价自动生成/绑定支出账单并计入统计。继续？').then(function (ok) {
            if (ok) saveReimb('none', '已转回自费（账单已同步）');
          });
        });
        w.querySelector('[data-x=del]').addEventListener('click', function () {
          UI.confirmDialog('删除票据', '删除这张票据？（绑定的账单保留）').then(function (ok) {
            if (!ok) return;
            S.removeTicket(t.id).then(function () {
              close(); UI.toast('已删除（账单保留）', 'success');
              setTimeout(function () { render(document.getElementById('main-content')); }, 60);
            }).catch(function (e) { UI.toast('删除失败：' + ((e && e.message) || e), 'error'); });
          });
        });
      }
    });
  }

  /* ---------- 编辑（基础 + 类型专属 + 图片） ---------- */
  function openEditor(t) {
    const isNew = !t;
    t = t || {
      id: U.uid(), type: 'train', name: '', date: U.todayStr(), arriveDate: '', time: '09:00', endTime: '',
      location: '', seat: '', price: 0, ticketNo: '', note: '',
      reimb: 'none', images: [], buyDate: U.todayStr(), ext: {}
    };
    const typeOpts = types().map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (t.type === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>';
    }).join('');
    const reimbOpts = Object.keys(S.REIMB_OPTS || { none: '自费', pending: '待报销', settled: '已报销' }).map(function (k) {
      return '<option value="' + k + '"' + ((t.reimb || 'none') === k ? ' selected' : '') + '>' + S.REIMB_OPTS[k] + '</option>';
    }).join('');
    UI.modal({
      title: isNew ? '添加票据' : '编辑票据', width: 560, formGuard: true,
      bodyHTML:
        '<div class="form-grid"><label class="f-full"><span class="f-label">类型 <span class="req-star">*</span></span>' +
        '<select id="tk-type">' + typeOpts + '</select></label></div>' +
        '<h4 class="detail-sub">基础信息</h4>' +
        '<div class="form-grid">' +
        '<label><span class="f-label">购买日期</span><input type="date" id="tk-buy" value="' + esc(t.buyDate || t.date || U.todayStr()) + '"></label>' +
        '<label><span class="f-label">价格（元） <span class="req-star">*</span></span><input type="number" id="tk-price" step="0.01" min="0" value="' + (Number(t.price) || 0) + '"></label>' +
        '<label><span class="f-label">费用性质</span><select id="tk-reimb">' + reimbOpts + '</select></label>' +
        '</div>' +
        '<h4 class="detail-sub">专属信息</h4>' +
        '<div class="form-grid" id="tk-ext"></div>' +
        '<div class="form-grid"><div class="f-full">' +
        '<div class="tk-img-head"><span class="f-label">票面照片</span>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="tk-ocr" title="本地识别票面文字，预填表单供核对">' + UI.icon('scan-text', 13) + ' 识别填充</button></div>' +
        '<div id="tk-imgs"></div></div></div>',
      footerHTML: '<div class="flex1"></div>' +
        '<button type="button" class="btn btn-ghost" data-x="c">取消</button>' +
        (isNew ? '<button type="button" class="btn btn-ghost" data-x="again" title="保存后接着录下一张">保存并再录</button>' : '') +
        '<button type="button" class="btn btn-primary" data-x="s">保存</button>',
      onMount: function (w, close) {
        // 专属字段区（按类型）。typed=用户已输入值：重绘/切类型前先收割，
        // 防「切一下类型已填内容全丢」（valOf 不再只回读原始记录）
        const typed = {};
        function harvest() {
          w.querySelectorAll('[data-fld]').forEach(function (inp) {
            typed[inp.getAttribute('data-fld')] = inp.value.trim();
          });
        }
        function valOf(key) {
          if (Object.prototype.hasOwnProperty.call(typed, key)) return typed[key];
          return TOP_FIELDS.indexOf(key) >= 0 ? (t[key] || '') : ((t.ext || {})[key] || '');
        }
        function paintFields() {
          const fields = formFieldsOf(w.querySelector('#tk-type').value);
          w.querySelector('#tk-ext').innerHTML = fields.map(function (f) {
            const val = valOf(f[0]);
            // type=time 只认 00:00-23:59：24:00/老数据 9:00 等回退 text，防值被输入框清洗成空
            const isTime = (f[0] === 'time' || f[0] === 'endTime') && (!val || /^([01]\d|2[0-3]):[0-5]\d$/.test(val));
            // date/arriveDate 走日期三段式控件（bindDatePickers 自动接管）
            const isDate = f[0] === 'date' || f[0] === 'arriveDate';
            const type = isDate ? 'date' : (isTime ? 'time' : 'text');
            return '<label' + (f[4] === 'full' ? ' class="f-full"' : '') + '><span class="f-label">' + f[1] + (f[3] ? ' <span class="req-star">*</span>' : '') + '</span>' +
              '<input data-fld="' + f[0] + '" data-req="' + (f[3] ? '1' : '') + '" type="' + type + '"' +
              ' value="' + esc(val) + '"' + (isDate ? '' : ' placeholder="' + esc(f[2] || '') + '"') + '></label>';
          }).join('');
          UI.bindDatePickers(w.querySelector('#tk-ext'));
          bindDateFollow();
        }
        // 到达日期默认跟随出发日期，手动改过就不再跟随（拍板 9/用户确认）
        function bindDateFollow() {
          const dateInp = w.querySelector('[data-fld="date"]');
          const arriveInp = w.querySelector('[data-fld="arriveDate"]');
          if (!dateInp || !arriveInp) return;
          dateInp.addEventListener('change', function () {
            if (!arriveInp.value || arriveInp.dataset.follow !== '0') {
              arriveInp.value = dateInp.value;
            }
          });
          arriveInp.addEventListener('input', function () {
            arriveInp.dataset.follow = arriveInp.value && arriveInp.value !== dateInp.value ? '0' : '1';
          });
        }
        paintFields();
        w.querySelector('#tk-type').addEventListener('change', function () {
          harvest(); // 切类型先存下已填内容（同名字段跨类型延续）
          paintFields();
        });
        const uploader = UI.imageUploader(w.querySelector('#tk-imgs'), { paths: (t.images || []).slice(), ticketMode: true });
        // 识别填充（拍板 Q3）：本地 OCR 预填**空字段**，不覆盖已填内容，人工核对后保存
        w.querySelector('#tk-ocr').addEventListener('click', async function () {
          const btn = w.querySelector('#tk-ocr');
          if (btn.disabled) return;
          UI.loadingBtn(btn, true);
          try {
            const blob = await uploader.getFirstBlob();
            if (!blob) { UI.toast('请先添加票面照片', 'info'); return; }
            const dataURL = await blobToPNGDataURL(blob);
            const r = await S.ocrImage(dataURL);
            if (!r || !r.ok) throw new Error((r && r.error) || '识别失败');
            const got = extractTicketFields(r.text);
            if (got.price && !w.querySelector('#tk-price').value) w.querySelector('#tk-price').value = got.price;
            ['date', 'no', 'from', 'to', 'time', 'endTime', 'seat', 'ticketNo'].forEach(function (k) {
              if (!got[k]) return;
              const inp = w.querySelector('[data-fld="' + k + '"]');
              if (inp && !inp.value.trim()) inp.value = got[k];
            });
            const n = Object.keys(got).length;
            UI.toast(n ? '已识别 ' + n + ' 项并预填，请核对' : '未识别出可用字段，请手动填写', n ? 'success' : 'info');
          } catch (e) {
            UI.toast('识别失败：' + ((e && e.message) || e), 'error');
          } finally {
            UI.loadingBtn(btn, false);
          }
        });
        w.querySelector('[data-x=c]').addEventListener('click', close);
        const againBtn = w.querySelector('[data-x=again]');
        if (againBtn) againBtn.addEventListener('click', function () {
          const doSave = function () {
            return new Promise(function (resolve) {
              const orig = w.querySelector('[data-x=s]');
              orig.click();
              // 保存是异步的：轮询 db 出现新票即完成（简化：延时后重开）
              setTimeout(resolve, 450);
            });
          };
          doSave().then(function () {
            const items = (S.tickets().items || []);
            const last = items[items.length - 1];
            close();
            openEditor({ type: w.querySelector('#tk-type') ? w.querySelector('#tk-type').value : 'train', buyDate: last ? last.buyDate : U.todayStr() });
          });
        });
        const sBtn = w.querySelector('[data-x=s]');
        sBtn.addEventListener('click', async function () {
          if (sBtn.disabled) return; // 防连点重复建账单/行程
          UI.loadingBtn(sBtn, true);
          const priceRaw = w.querySelector('#tk-price').value.trim();
          if (priceRaw === '' || isNaN(Number(priceRaw)) || Number(priceRaw) < 0) {
            UI.toast('请填写价格', 'error'); UI.loadingBtn(sBtn, false); return;
          }
          const typeId = w.querySelector('#tk-type').value;
          const fields = formFieldsOf(typeId);
          const ext = Object.assign({}, t.ext || {});
          const top = {};
          let miss = '';
          // 只覆盖当前类型**渲染了的**字段；未渲染字段保留原值（切类型/字段裁剪不丢数据——
          // 曾无条件写 time/endTime/location/seat，movie 改一次就清掉 endTime、火车票清掉 location）
          fields.forEach(function (f) {
            const key = f[0];
            const inp = w.querySelector('[data-fld="' + key + '"]');
            const v = inp ? String(inp.value == null ? '' : inp.value).trim() : '';
            if (!v && f[3]) miss = miss || f[1];
            if (TOP_FIELDS.indexOf(key) >= 0) top[key] = v;
            else if (v) ext[key] = v; else delete ext[key];
          });
          if (miss) { UI.toast('请填写' + miss, 'error'); UI.loadingBtn(sBtn, false); return; }
          if (!top.date) { UI.toast('请填写日期', 'error'); UI.loadingBtn(sBtn, false); return; }
          let images, imgErr = false;
          try { images = await uploader.finalize(); } catch (e) {
            // 失败保留已存图（含用户本次删掉的不复活），新增图明确提示、不静默丢
            images = uploader.getPaths(); imgErr = true;
          }
          const rname = top.name || ((ext.from && ext.to) ? (ext.from + '→' + ext.to) : (ext.no || '票据'));
          const rec = Object.assign({}, t, {
            type: typeId,
            name: rname,
            price: Math.abs(Number(w.querySelector('#tk-price').value) || 0),
            buyDate: w.querySelector('#tk-buy').value || top.date,
            reimb: w.querySelector('#tk-reimb').value || 'none',
            ext: ext,
            images: images
          });
          Object.keys(top).forEach(function (k) { rec[k] = top[k]; });
          if (!rec.arriveDate) rec.arriveDate = rec.date; // 到达日期缺省=出发日期
          S.saveTicket(rec).then(function () {
            close();
            UI.toast(isNew ? '已添加（账单/行程已同步）' : '已保存', 'success');
            if (rec.reimb !== 'none' && !isNew) UI.toast('报销票不记账：自动账单已回收', 'info');
            if (imgErr) UI.toast('图片上传失败，新增图片未保存', 'error');
            setTimeout(function () { render(document.getElementById('main-content')); }, 60);
          }).catch(function (e) {
            UI.toast('保存失败：' + ((e && e.message) || e) + '，请重试', 'error');
            UI.loadingBtn(sBtn, false);
          });
        });
      }
    });
  }

  /* ---------- 类型管理（自定义增删） ---------- */
  function openTypeManager() {
    UI.modal({
      title: '票据类型管理', width: 520,
      bodyHTML: '<div id="tt-list"></div>' +
        '<div class="tm-new-row"><input id="tt-new-name" placeholder="新类型名" style="flex:1">' +
        '<button type="button" class="btn btn-primary btn-sm" data-x="add">添加</button></div>' +
        '<p class="muted small">自定义类型只有通用字段（无专属区）；账单分类默认「其他支出」。</p>',
      footerHTML: '<div class="flex1"></div><button type="button" class="btn btn-primary" data-x="c">完成</button>',
      onMount: function (w, close) {
        const list = w.querySelector('#tt-list');
        function paint() {
          list.innerHTML = types().map(function (t) {
            return '<div class="tm-row" data-tt-id="' + esc(t.id) + '">' +
              '<span class="hb-dot" style="background:#0071e3"></span>' +
              '<input class="tm-name" value="' + esc(t.name) + '">' +
              '<button type="button" class="btn-icon" data-tt-del="' + esc(t.id) + '" title="删除">' + UI.icon('trash-2', 14) + '</button></div>';
          }).join('');
        }
        paint();
        list.addEventListener('click', function (e) {
          const del = e.target.closest ? e.target.closest('[data-tt-del]') : null;
          if (!del) return;
          UI.confirmDialog('删除类型', '删除该类型？使用它的票据归入「其他」').then(function (ok) {
            if (!ok) return;
            const id = del.getAttribute('data-tt-del');
            const tk = S.tickets();
            tk.types = tk.types.filter(function (x) { return x.id !== id; });
            tk.items.forEach(function (x) { if (x.type === id) x.type = 'other'; });
            S.saveTickets().then(function () {
              paint();
              UI.toast('已删除', 'success');
            });
          });
        });
        list.addEventListener('change', function (e) {
          const row = e.target.closest ? e.target.closest('[data-tt-id]') : null;
          if (!row) return;
          const tk = S.tickets();
          const t = (tk.types || []).filter(function (x) { return x.id === row.getAttribute('data-tt-id'); })[0];
          if (!t) return;
          t.name = row.querySelector('.tm-name').value.trim() || t.name;
          S.saveTickets();
        });
        w.querySelector('[data-x=add]').addEventListener('click', function () {
          const name = w.querySelector('#tt-new-name').value.trim();
          if (!name) { UI.toast('请填写类型名', 'error'); return; }
          const tk = S.tickets();
          tk.types.push({ id: U.uid(), name: name, icon: 'ticket', cat: 'w_other_exp' });
          S.saveTickets().then(function () {
            w.querySelector('#tt-new-name').value = '';
            paint();
          });
        });
        w.querySelector('[data-x=c]').addEventListener('click', function () {
          close();
          setTimeout(function () { render(document.getElementById('main-content')); }, 60);
        });
      }
    });
  }

  /* ---------- 事件绑定 ---------- */
  function bind(root) {
    // 页头与空态卡两个按钮都要绑（曾 || 短路漏绑空态大按钮=点了没反应）
    root.querySelectorAll('#tk-add, #tk-add-empty').forEach(function (btn) {
      btn.addEventListener('click', function () { openEditor(null); });
    });
    const tm = root.querySelector('#tk-types');
    if (tm) tm.addEventListener('click', openTypeManager);
    root.querySelectorAll('[data-tk]').forEach(function (card) {
      card.addEventListener('click', function () {
        openDetail(card.getAttribute('data-tk'));
      });
    });
  }

  return {
    render: render,
    resetState: resetState,
    openEditor: openEditor,
    openDetail: openDetail,
    openTypeManager: openTypeManager
  };
})();
