/* views-tickets.js — 我的票据（v1.2.5）
   票证记录（车票/演唱会/电影…）：仿真票券卡片（存根+撕孔+票身+条码）、三态（未用/已用/作废）
   · 账单双向绑定（拍板）：票价>0 自动建支出账单（bill.ticketId），票价改动账单跟随；删票账单保留（解绑）
   · 时间日历联动（Q1:A）：票生成时间段待办（todoId 双向）——标已用=待办勾完成，反向亦然
   · 类型：预设 7 类 + 自定义（icon/名称/账单分类）；类型专属字段（车次/航班号/艺人…）存 ext */
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
  /* 类型专属字段（拍板 Q3）：train/flight/bus/concert/movie；其他=通用 */
  /* 表单字段（v1.2.5 定稿）：基础信息=购买日期/使用日期/价格；其余全在专属信息。
     数组顺序=表单顺序；[key, 标签, 占位, 必填]。key 属 TOP_FIELDS=顶层，否则 ext。 */
  const TOP_FIELDS = ['name', 'location', 'time', 'endTime', 'seat', 'ticketNo', 'note'];
  const TYPE_FORM = {
    train: [
      ['no', '车次', '如：G1', 1], ['from', '出发站', '如：上海南', 1], ['to', '到达站', '如：北京南', 1],
      ['time', '开车时间', '', 1], ['endTime', '到达时间', '', 1],
      ['gate', '检票口', '如：5B', 0],
      ['sub', '席别', '如：二等座', 0], ['seat', '座位', '如：01车12A', 0],
      ['ticketNo', '票号', '', 0], ['note', '备注', '', 0]
    ],
    flight: [
      ['no', '航班号', '如：CA123', 1], ['from', '出发机场', '如：萧山T3', 1], ['to', '到达机场', '如：首都T3', 1],
      ['time', '登机时间', '', 1], ['endTime', '到达时间（选填）', '', 0],
      ['gate', '登机口', '如：A12', 0],
      ['sub', '舱位', '如：经济舱', 0], ['seat', '座位', '', 0],
      ['ticketNo', '票号', '', 0], ['note', '备注', '', 0]
    ],
    bus: [
      ['no', '班次', '', 0], ['from', '出发站', '', 1], ['to', '到达站', '', 1],
      ['time', '出发时间', '', 1], ['endTime', '到达时间', '', 0],
      ['seat', '座位', '', 0], ['ticketNo', '票号', '', 0], ['note', '备注', '', 0]
    ],
    concert: [
      ['name', '艺人 / 场次', '如：周杰伦·嘉年华', 1], ['location', '场馆', '如：国家体育场', 1],
      ['time', '开演时间', '', 1], ['endTime', '散场时间', '', 0],
      ['sub', '区域', '如：看台 C 区', 0], ['seat', '座位', '如：12排34号', 0],
      ['ticketNo', '票号', '', 0], ['note', '备注', '', 0]
    ],
    movie: [
      ['name', '影片', '', 1], ['location', '影院', '', 1], ['cinema', '影厅', '如：3号厅', 1],
      ['time', '场次时间', '', 1], ['seat', '座位', '', 0],
      ['ticketNo', '票号', '', 0], ['note', '备注', '', 0]
    ],
    exhibition: [
      ['name', '展览名称', '', 1], ['location', '场馆', '', 1],
      ['time', '参观时间', '', 0, 'text'], ['ticketNo', '票号', '', 0], ['note', '备注', '', 0]
    ],
    other: [
      ['name', '名称', '', 1], ['location', '地点', '', 0], ['time', '时间', '', 0, 'text'],
      ['seat', '座位', '', 0], ['ticketNo', '票号', '', 0], ['note', '备注', '', 0]
    ]
  };
  function formFieldsOf(typeId) { return TYPE_FORM[typeId] || TYPE_FORM.other; }
  function statusLabel(st) { return st === 'used' ? '已用' : '未用'; }

  /* ---------- 票券卡（三类真票形态，拍板 2026-11-23） ----------
     火车票：票号/检票口顶行 → 站名→（车次）→站名（右=开/到时间）→ 日期/座位/席别/价格
     登机牌：红竖条 + BOARDING PASS → 航班/舱位 + FROM ✈ TO → 底行 日期/登机时间/登机口/座位
     演唱会/电影/展览/其他：标题 + 字段行 + 右侧淡色副券块（撕线装饰） */
  const ROUTE_TYPES = { train: 1, flight: 1, bus: 1 };
  function isRoute(t) { return !!ROUTE_TYPES[t.type]; }
  function fmtDateCn(ds) {
    return ds ? (Number(ds.slice(0, 4)) + '/' + ds.slice(5, 7) + '/' + ds.slice(8, 10)) : '';
  }
  function cardBodyHTML(t) {
    const price = '<b>¥' + (Number(t.price) || 0).toFixed(1) + '</b>';
    if (t.type === 'train' || t.type === 'bus') {
      // 真票布局：顶行 票号/检票口 → 起点 —车次→ 终点（同一排）→ 日期开 + 座位席别 → 价格
      const no = (t.ext && t.ext.no) ? esc(t.ext.no) : '';
      return '<div class="tk-body">' +
        '<div class="tk-toprow"><span class="tk-ticketno">' + esc(t.ticketNo || '') + '</span>' +
        (t.ext && t.ext.gate ? '<span class="tk-gate">检票口 ' + esc(t.ext.gate) + '</span>' : '') + '</div>' +
        '<div class="tk-route">' +
        '<div class="tk-station">' + esc((t.ext && t.ext.from) || '') + '</div>' +
        '<div class="tk-arrowwrap"><span class="tk-trainno">' + no + '</span><span class="tk-arrowline"></span></div>' +
        '<div class="tk-station">' + esc((t.ext && t.ext.to) || '') + '</div>' +
        '</div>' +
        '<div class="tk-rowline"><span>' + esc(fmtDateCn(t.date)) + ' ' + esc(t.time || '') + '开' +
          (t.endTime ? ' → ' + esc(t.endTime) + '到' : '') + '</span>' +
          '<span>' + esc(t.seat || '') + '</span></div>' +
        '<div class="tk-rowline"><span>' + price + '</span><span>' + esc((t.ext && t.ext.sub) || '') + '</span></div>' +
        '</div>';
    }
    if (t.type === 'flight') {
      // 登机牌布局：BOARDING PASS → FROM ✈ 航班 TO → 舱位/座位 → 日期 · 登机时间 · 登机口
      return '<div class="tk-body tk-boarding">' +
        '<div class="tk-route">' +
        '<div class="tk-station">' + esc((t.ext && t.ext.from) || '') + '</div>' +
        '<div class="tk-arrowwrap"><span class="tk-trainno">' + esc((t.ext && t.ext.no) || '') + '</span>' +
        '<span class="tk-arrowline tk-airline">✈</span></div>' +
        '<div class="tk-station">' + esc((t.ext && t.ext.to) || '') + '</div>' +
        '</div>' +
        '<div class="tk-rowline"><span>' + esc([t.ext && t.ext.sub, t.seat].filter(Boolean).join(' · ')) + '</span></div>' +
        '<div class="tk-rowline"><span>' + esc([fmtDateCn(t.date), t.time ? '登机 ' + t.time : '',
          t.ext && t.ext.gate ? '登机口 ' + t.ext.gate : ''].filter(Boolean).join(' · ')) + '</span></div>' +
        '<div class="tk-rowline"><span>' + price + '</span></div>' +
        '</div>';
    }
    // 演唱会式：标签：值 逐行 + 右副券
    const rows = [];
    if (t.time) rows.push(['时间', esc(t.time) + (t.endTime ? '-' + esc(t.endTime) : '')]);
    if (t.location) rows.push(['场馆', esc(t.location)]);
    if (t.ext && t.ext.cinema) rows.push(['影院', esc(t.ext.cinema)]);
    if (t.ext && t.ext.hall) rows.push(['影厅', esc(t.ext.hall)]);
    if (t.ext && t.ext.sub) rows.push(['区域', esc(t.ext.sub)]);
    if (t.seat) rows.push(['座位', esc(t.seat)]);
    rows.push(['票价', '¥' + (Number(t.price) || 0).toFixed(1) + '元']);
    return '<div class="tk-body tk-event">' +
      '<div class="tk-ev-main">' +
      '<div class="tk-name">' + esc(t.name) + '</div>' +
      rows.map(function (r) { return '<div class="tk-where"><span class="tk-k">' + r[0] + '：</span>' + r[1] + '</div>'; }).join('') +
      '</div>' +
      '<div class="tk-sub"><div class="tk-sub-h">副券</div>' +
      '<div class="tk-sub-d">' + esc(fmtDateCn(t.date)) + '</div>' +
      (t.ext && t.ext.sub ? '<div class="tk-sub-d">' + esc(t.ext.sub) + '</div>' : '') +
      (t.seat ? '<div class="tk-sub-d">' + esc(t.seat) + '</div>' : '') +
      (t.ticketNo ? '<div class="tk-sub-no">TK ' + esc(t.ticketNo) + '</div>' : '') +
      '</div></div>';
  }
  function ticketCardHTML(t) {
    const ty = typeOf(t.type);
    return '<div class="tk-card tk-' + esc(t.status) + '" data-tk="' + esc(t.id) + '" title="点击看详情">' +
      '<div class="tk-stub">' +
      '<div class="tk-stub-type">' + UI.iconOrEmoji(ty.icon, 15) + '</div>' +
      '<div class="tk-stub-no">' + esc(t.ticketNo ? 'No.' + t.ticketNo : ty.name) + '</div>' +
      '<div class="tk-status tk-stub-status">' + statusLabel(t.status) + '</div>' +
      '</div><div class="tk-tear"></div>' +
      cardBodyHTML(t) +
      '</div>';
  }

  /* ---------- 主渲染 ---------- */
  function render(main) {
    const db = S.getDB();
    const items = ((db.tickets || {}).items || []).slice().sort(function (a, b) {
      // 未用优先 → 日期倒序（拍板 7）
      const ua = a.status === 'unused' ? 0 : 1, ub = b.status === 'unused' ? 0 : 1;
      if (ua !== ub) return ua - ub;
      return (b.date || '') < (a.date || '') ? -1 : 1;
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
    // 专属字段=该类型表单里非顶层的键（no/from/to/sub/cinema/hall…）；曾引用未定义 EXT_FIELDS 直接炸掉详情弹窗
    const ext = formFieldsOf(t.type).filter(function (f) { return TOP_FIELDS.indexOf(f[0]) < 0; });
    const extHTML = ext.map(function (f) {
      return t.ext && t.ext[f[0]] ? '<div class="kv-row"><span>' + f[1] + '</span><strong>' + esc(t.ext[f[0]]) + '</strong></div>' : '';
    }).join('');
    UI.modal({
      title: ty.name, width: 560,
      bodyHTML: '<div class="tk-detail">' +
        '<div class="tk-card tk-' + esc(t.status) + ' tk-big">' +
        '<div class="tk-stub"><div class="tk-stub-type">' + UI.iconOrEmoji(ty.icon, 18) + '</div>' +
        '<div class="tk-stub-no">' + esc(t.ticketNo ? 'No.' + t.ticketNo : '') + '</div>' +
        '<div class="tk-status tk-stub-status">' + statusLabel(t.status) + '</div></div>' +
        '<div class="tk-tear"></div>' + cardBodyHTML(t) + '</div>' +
        '<div class="detail-kv">' + extHTML +
        (t.ticketNo ? '<div class="kv-row"><span>票号</span><strong>' + esc(t.ticketNo) + '</strong></div>' : '') +
        (t.buyDate ? '<div class="kv-row"><span>购买日期</span><strong>' + esc(t.buyDate) + '</strong></div>' : '') +
        (t.note ? '<div class="kv-row"><span>备注</span><strong>' + esc(t.note) + '</strong></div>' : '') +
        '<div class="kv-row"><span>账单</span><strong>' + (t.billId ? '已绑定（金额由票价维护）' : '未绑定') + '</strong></div>' +
        '</div>' +
        (t.images && t.images.length ? '<div class="detail-imgs">' + t.images.map(function (p) {
          return '<img data-path="' + esc(p) + '" alt=""/>';
        }).join('') + '</div>' : '') +
        '</div>',
      footerHTML:
        (t.status === 'unused' ? '<button type="button" class="btn btn-primary" data-x="use">标为已用</button>' : '') +
        // 拍板 4A：恢复未用（数据层已支持回退）
        (t.status !== 'unused' ? '<button type="button" class="btn btn-ghost" data-x="unused">恢复未用</button>' : '') +
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
        const useBtn = w.querySelector('[data-x=use]');
        if (useBtn) useBtn.addEventListener('click', function () {
          S.saveTicket(Object.assign({}, t, { status: 'used' })).then(function () {
            close(); UI.toast('已标为已用（行程待办已同步）', 'success');
            setTimeout(function () { render(document.getElementById('main-content')); }, 60);
          }).catch(function (e) { UI.toast('操作失败：' + ((e && e.message) || e), 'error'); });
        });
        const unBtn = w.querySelector('[data-x=unused]');
        if (unBtn) unBtn.addEventListener('click', function () {
          S.saveTicket(Object.assign({}, t, { status: 'unused' })).then(function () {
            close(); UI.toast('已恢复未用', 'success');
            setTimeout(function () { render(document.getElementById('main-content')); }, 60);
          }).catch(function (e) { UI.toast('操作失败：' + ((e && e.message) || e), 'error'); });
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

  /* ---------- 编辑（通用 + 类型专属 + 图片） ---------- */
  function openEditor(t) {
    const isNew = !t;
    t = t || {
      id: U.uid(), type: 'train', name: '', date: U.todayStr(), time: '09:00', endTime: '',
      location: '', seat: '', price: 0, ticketNo: '', note: '',
      status: 'unused', images: [], buyDate: U.todayStr(), ext: {}
    };
    const typeOpts = types().map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (t.type === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>';
    }).join('');
    UI.modal({
      title: isNew ? '添加票据' : '编辑票据', width: 560, formGuard: true,
      bodyHTML:
        // 类型选择（曾缺这个 #tk-type，paintFields 一开弹窗就 null 炸掉）
        '<div class="form-grid"><label class="f-full"><span class="f-label">类型 <span class="req-star">*</span></span>' +
        '<select id="tk-type">' + typeOpts + '</select></label></div>' +
        '<h4 class="detail-sub">基础信息</h4>' +
        '<div class="form-grid">' +
        '<label><span class="f-label">购买日期</span><input type="date" id="tk-buy" value="' + esc(t.buyDate || t.date || U.todayStr()) + '"></label>' +
        '<label><span class="f-label">使用日期 <span class="req-star">*</span></span><input type="date" id="tk-date" value="' + esc(t.date) + '"></label>' +
        '<label><span class="f-label">价格（元） <span class="req-star">*</span></span><input type="number" id="tk-price" step="0.01" min="0" value="' + (Number(t.price) || 0) + '"></label>' +
        '</div>' +
        '<h4 class="detail-sub">专属信息</h4>' +
        '<div class="form-grid" id="tk-ext"></div>' +
        '<div class="form-grid"><div class="f-full"><span class="f-label">票面照片</span><div id="tk-imgs"></div></div></div>' +
        '<p class="muted small">价格大于 0 时自动生成/绑定支出账单（账单日期=购买日期）；行程会进时间日历（可勾完成）。</p>',
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
            return '<label><span class="f-label">' + f[1] + (f[3] ? ' <span class="req-star">*</span>' : '') + '</span>' +
              '<input data-fld="' + f[0] + '" data-req="' + (f[3] ? '1' : '') + '" type="' + (isTime ? 'time' : 'text') + '"' +
              ' value="' + esc(val) + '" placeholder="' + esc(f[2] || '') + '"></label>';
          }).join('');
        }
        paintFields();
        w.querySelector('#tk-type').addEventListener('change', function () {
          harvest(); // 切类型先存下已填内容（同名字段跨类型延续）
          paintFields();
        });
        const uploader = UI.imageUploader(w.querySelector('#tk-imgs'), { paths: (t.images || []).slice() });
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
          const date = w.querySelector('#tk-date').value;
          if (!date) { UI.toast('请填写使用日期', 'error'); UI.loadingBtn(sBtn, false); return; }
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
          let images, imgErr = false;
          try { images = await uploader.finalize(); } catch (e) {
            // 失败保留已存图（含用户本次删掉的不复活），新增图明确提示、不静默丢
            images = uploader.getPaths(); imgErr = true;
          }
          const rname = top.name || ((ext.from && ext.to) ? (ext.from + '→' + ext.to) : (ext.no || '票据'));
          const rec = Object.assign({}, t, {
            type: typeId,
            name: rname,
            date: date,
            price: Math.abs(Number(w.querySelector('#tk-price').value) || 0),
            buyDate: w.querySelector('#tk-buy').value || date,
            ext: ext,
            images: images
          });
          Object.keys(top).forEach(function (k) { rec[k] = top[k]; });
          S.saveTicket(rec).then(function () {
            close();
            UI.toast(isNew ? '已添加（账单/行程已同步）' : '已保存', 'success');
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

  /* ---------- 类型管理（自定义增删，拍板 1） ---------- */
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
