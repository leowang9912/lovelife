/* views-wallet.js — 我的钱袋 v2：记账界面（分类图标网格）/ 流水 / 账户 / 导入 / 分类管理 */
window.WalletView = (function () {
  const S = window.Storage;
  const U = window.Utils;
  const UI = window.UI;

  let tab = 'bills';
  const filters = {
    range: 'month', catId: '', accountId: '', type: '', q: '',
    sortKey: 'date', sortDir: 'desc'
  };

  /* ---------- 工具 ---------- */
  function money(n) {
    const v = Number(n) || 0;
    return '¥' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function esc(t) { return U.escapeHtml(t == null ? '' : t); }
  function today() { return U.todayStr(); }
  function monthKey(d) { return (d || '').slice(0, 7); }
  function nowMonth() { return today().slice(0, 7); }

  // 人民币大写（主流记账同款：输入数字实时转换）
  function digitUppercase(n) {
    const fraction = ['角', '分'];
    const digit = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
    const unit = [['元', '万', '亿'], ['', '拾', '佰', '仟']];
    let num = Math.abs(Number(n) || 0);
    let s = '';
    for (let i = 0; i < fraction.length; i++) {
      s += (digit[Math.floor(num * 10 * Math.pow(10, i)) % 10] + fraction[i]).replace(/零./, '');
    }
    s = s || '整';
    num = Math.floor(num);
    for (let i = 0; i < unit[0].length && num > 0; i++) {
      let p = '';
      for (let j = 0; j < unit[1].length && num > 0; j++) {
        p = digit[num % 10] + unit[1][j] + p;
        num = Math.floor(num / 10);
      }
      s = p.replace(/(零.)*零$/, '').replace(/^$/, '零') + unit[0][i] + s;
    }
    return s.replace(/(零.)*零元/, '元').replace(/(零.)+/g, '零').replace(/^整$/, '零元整');
  }

  // 分类树遍历
  function catTree(kind) { return ((S.getDB().wallet || {}).cats || {})[kind] || []; }
  function findCat(id) {
    ['expense', 'income'].forEach(function () {});
    const kinds = ['expense', 'income'];
    for (let ki = 0; ki < kinds.length; ki++) {
      const list = catTree(kinds[ki]);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.id === id) return { node: c, kind: kinds[ki], parent: null };
        const ch = c.children || [];
        for (let j = 0; j < ch.length; j++) {
          if (ch[j].id === id) return { node: ch[j], kind: kinds[ki], parent: c };
        }
      }
    }
    return null;
  }
  function catIconOf(id) {
    const f = findCat(id);
    return (f && f.node && f.node.icon) || (f && f.parent && f.parent.icon) || 'color_ic_parent_other';
  }
  function catLabel(id) {
    const f = findCat(id);
    if (!f) return '未分类';
    return f.parent ? f.parent.name + ' · ' + f.node.name : f.node.name;
  }
  // 分类图标（内置彩色图标）；未提取到时退回 lucide
  function catIconHTML(id, size) {
    size = size || 44;
    const name = catIconOf(id);
    if (/^color_ic_/.test(name)) {
      return '<img class="ycat-img" src="/vendor/cat-icons/' + name + '.png" width="' + size + '" height="' + size + '" alt="">';
    }
    return UI.icon(name, size);
  }
  function accountName(id) {
    const acc = ((S.getDB().wallet || {}).accounts || []).find(function (a) { return a.id === id; });
    return acc ? acc.name : '';
  }
  function typeLabel(t) {
    return t === 'income' ? '收入' : t === 'transfer' ? '转账' : '支出';
  }
  function domainLabel(kind) {
    // 物品实际 kind 是 device/game（数码）/clothing/life；digital 是钱袋域名
    return (kind === 'digital' || kind === 'device' || kind === 'game') ? '我的数码'
      : kind === 'clothing' ? '我的衣橱' : kind === 'life' ? '我的生活' : '';
  }

  /* ---------- 筛选 ---------- */
  function inRange(b) {
    const d = b.date || '';
    if (filters.range === 'all') return true;
    if (filters.range === 'month') return monthKey(d) === nowMonth();
    if (filters.range === 'year') return d.slice(0, 4) === today().slice(0, 4);
    return true;
  }
  function filteredBills() {
    let list = ((S.getDB().wallet || {}).bills || []).slice();
    list = list.filter(inRange);
    if (filters.type) list = list.filter(function (b) { return b.type === filters.type; });
    if (filters.catId) list = list.filter(function (b) { return b.catId === filters.catId || b.subCatId === filters.catId; });
    if (filters.accountId) {
      list = list.filter(function (b) {
        return b.accountId === filters.accountId || b.toAccountId === filters.accountId;
      });
    }
    if (filters.q) {
      const q = filters.q.toLowerCase();
      list = list.filter(function (b) {
        return ((b.note || '') + catLabel(b.subCatId || b.catId)).toLowerCase().indexOf(q) >= 0;
      });
    }
    const dir = filters.sortDir === 'asc' ? 1 : -1;
    const key = filters.sortKey;
    list.sort(function (a, b) {
      if (key === 'amount') return (Number(a.amount) - Number(b.amount)) * dir;
      if (key === 'cat') return catLabel(a.subCatId || a.catId).localeCompare(catLabel(b.subCatId || b.catId)) * dir;
      const da = (a.date || '') + ' ' + (a.time || ''), db2 = (b.date || '') + ' ' + (b.time || '');
      return (da < db2 ? -1 : da > db2 ? 1 : 0) * dir;
    });
    return list;
  }

  /* ---------- 页面骨架：设置页同款顶部标签（导入/分类管理已移入设置） ---------- */
  const TABS = [
    { id: 'bills', label: '流水账', icon: 'list' },
    { id: 'accounts', label: '账户', icon: 'wallet' }
  ];

  function render(main) {
    main.innerHTML =
      '<div class="page-head">' +
      '<div><h2>我的钱袋</h2><div class="muted small">记账 · 账户 · 词条自动同步到数码/衣橱/生活（导入导出与分类管理在设置页）</div></div>' +
      '<div class="page-actions">' +
      '<button class="btn btn-ghost" id="btn-goto-stats">' + UI.icon('chart-column', 16) + ' 查看统计</button>' +
      '<button class="btn btn-primary" id="btn-add-bill">' + UI.icon('plus', 16) + ' 记一笔</button>' +
      '</div></div>' +
      '<div class="settings-tabs" id="wallet-tabs">' + TABS.map(function (t) {
        return '<button type="button" class="stab-btn' + (tab === t.id ? ' on' : '') + '" data-wt="' + t.id + '">' +
          UI.icon(t.icon, 16) + ' ' + t.label + '</button>';
      }).join('') + '</div>' +
      '<div id="wallet-body"></div>';

    main.querySelector('#btn-add-bill').addEventListener('click', function () { openBillForm(null); });
    main.querySelector('#btn-goto-stats').addEventListener('click', function () { window.App.go('plan'); });
    main.querySelectorAll('[data-wt]').forEach(function (el) {
      el.addEventListener('click', function () {
        tab = el.getAttribute('data-wt');
        render(main);
      });
    });
    const box = main.querySelector('#wallet-body');
    if (tab === 'bills') renderBills(box);
    else renderAccounts(box);
  }

  /* ---------- 流水账（统一风格的列表） ---------- */
  function renderBills(box) {
    const db = S.getDB();
    const wallet = db.wallet;
    const list = filteredBills();
    let exp = 0, inc = 0;
    list.forEach(function (b) {
      const a = Math.abs(Number(b.amount) || 0);
      if (b.type === 'income') inc += a;
      else if (b.type === 'expense') exp += a;
    });

    const catOpts = function () {
      let s = '<option value="">全部分类</option>';
      ['expense', 'income'].forEach(function (kind) {
        catTree(kind).forEach(function (c) {
          s += '<option value="' + esc(c.id) + '"' + (filters.catId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
          (c.children || []).forEach(function (ch) {
            s += '<option value="' + esc(ch.id) + '"' + (filters.catId === ch.id ? ' selected' : '') + '>' + esc(c.name) + ' · ' + esc(ch.name) + '</option>';
          });
        });
      });
      return s;
    };
    const accOpts = function () {
      let s = '<option value="">全部账户</option>';
      (wallet.accounts || []).forEach(function (a) {
        s += '<option value="' + esc(a.id) + '"' + (filters.accountId === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>';
      });
      return s;
    };

    // 月度头部卡（统一风格的：本月支出/收入/结余）
    box.innerHTML =
      '<div class="yw-month-head">' +
      '<div class="yw-month-cell"><span class="yw-month-label">本月支出</span><span class="yw-month-val out">' + money(exp) + '</span></div>' +
      '<div class="yw-month-cell"><span class="yw-month-label">本月收入</span><span class="yw-month-val in">' + money(inc) + '</span></div>' +
      '<div class="yw-month-cell"><span class="yw-month-label">结余</span><span class="yw-month-val">' + money(inc - exp) + '</span></div>' +
      '</div>' +
      '<div class="filter-bar">' +
      '<div class="seg-toggle">' +
      [['month', '本月'], ['year', '今年'], ['all', '全部']].map(function (r) {
        return '<button class="seg-btn' + (filters.range === r[0] ? ' on' : '') + '" data-range="' + r[0] + '">' + r[1] + '</button>';
      }).join('') + '</div>' +
      '<select id="f-type"><option value="">收支/转账</option>' +
      '<option value="expense"' + (filters.type === 'expense' ? ' selected' : '') + '>支出</option>' +
      '<option value="income"' + (filters.type === 'income' ? ' selected' : '') + '>收入</option>' +
      '<option value="transfer"' + (filters.type === 'transfer' ? ' selected' : '') + '>转账</option></select>' +
      '<select id="f-cat">' + catOpts() + '</select>' +
      '<select id="f-acc">' + accOpts() + '</select>' +
      '<select id="f-sort">' +
      [['date', '日期'], ['amount', '金额'], ['cat', '分类']].map(function (s) {
        return '<option value="' + s[0] + '"' + (filters.sortKey === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
      }).join('') + '</select>' +
      '<button class="btn btn-ghost btn-sm" id="f-dir">' + UI.icon(filters.sortDir === 'asc' ? 'arrow-up' : 'arrow-down', 14) +
      (filters.sortDir === 'asc' ? ' 升序' : ' 降序') + '</button>' +
      '<input id="f-q" class="search-input" placeholder="搜索备注 / 分类…" value="' + esc(filters.q) + '">' +
      '</div>' +
      (list.length
        ? billsGroupedHTML(list)
        : '<div class="empty-state"><div class="empty-icon">' + UI.icon('receipt', 48) + '</div>' +
        '<div>' + (filters.q || filters.catId || filters.type || filters.accountId ? '没有符合筛选的结果' : '还没有记账记录') + '</div></div>');

    box.querySelectorAll('[data-range]').forEach(function (el) {
      el.addEventListener('click', function () { filters.range = el.getAttribute('data-range'); renderBills(box); });
    });
    const bindSel = function (id, key) {
      const el = box.querySelector(id);
      if (el) el.addEventListener('change', function () { filters[key] = el.value; renderBills(box); });
    };
    bindSel('#f-type', 'type'); bindSel('#f-cat', 'catId'); bindSel('#f-acc', 'accountId'); bindSel('#f-sort', 'sortKey');
    const dirBtn = box.querySelector('#f-dir');
    if (dirBtn) dirBtn.addEventListener('click', function () {
      filters.sortDir = filters.sortDir === 'asc' ? 'desc' : 'asc';
      renderBills(box);
    });
    const q = box.querySelector('#f-q');
    if (q) q.addEventListener('input', U.debounce(function () {
      filters.q = q.value.trim();
      renderBills(box);
      const q2 = box.querySelector('#f-q');
      if (q2) { q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); }
    }, 260));

    box.querySelectorAll('[data-bill]').forEach(function (row) {
      row.addEventListener('click', function () {
        const bill = (wallet.bills || []).find(function (b) { return b.id === row.getAttribute('data-bill'); });
        if (bill) openBillForm(bill);
      });
    });
  }

  // 日期分组：今天/昨天/具体日期，组头带当日小计
  function billsGroupedHTML(list) {
    const groups = {};
    const order = [];
    list.forEach(function (b) {
      const d = b.date || '';
      if (!groups[d]) { groups[d] = []; order.push(d); }
      groups[d].push(b);
    });
    const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return order.map(function (d) {
      const rows = groups[d];
      let exp = 0, inc = 0;
      rows.forEach(function (b) {
        const a = Math.abs(Number(b.amount) || 0);
        if (b.type === 'income') inc += a; else if (b.type === 'expense') exp += a;
      });
      const t = new Date(d);
      let label = d;
      if (d === today()) label = '今天';
      else {
        const y = new Date(); y.setDate(y.getDate() - 1);
        if (d === U.todayStr(y)) label = '昨天';
      }
      const full = isNaN(t) ? d : ((t.getMonth() + 1) + '月' + t.getDate() + '日 ' + weekNames[t.getDay()]);
      return '<div class="yw-day-group">' +
        '<div class="yw-day-head">' +
        '<span class="yw-day-label">' + esc(label) + '</span>' +
        '<span class="muted small">' + esc(full) + '</span>' +
        '<div class="flex1"></div>' +
        (exp ? '<span class="yw-day-sum out">支 ' + money(exp) + '</span>' : '') +
        (inc ? '<span class="yw-day-sum in">收 ' + money(inc) + '</span>' : '') +
        '</div>' +
        '<div class="yw-bill-list">' + rows.map(billRowHTML).join('') + '</div>' +
        '</div>';
    }).join('');
  }

  // 统一风格的流水行：图标圆底 + 分类名/备注 + 账户·日期，右侧金额红绿
  function billRowHTML(b) {
    const linked = b.itemId ? (S.getDB().items || []).find(function (i) { return i.id === b.itemId; }) : null;
    const sign = b.type === 'income' ? '+' : b.type === 'transfer' ? '→' : '-';
    const amtCls = b.type === 'income' ? 'yw-amt-in' : 'yw-amt-out';
    const iconId = b.type === 'transfer' ? 'color_ic_transfer_accounts' : (b.subCatId || b.catId);
    return '<div class="yw-bill-row" data-bill="' + esc(b.id) + '">' +
      '<div class="yw-bill-ic">' + catIconHTML(iconId, 24) + '</div>' +
      '<div class="yw-bill-main">' +
      '<div class="yw-bill-title">' + esc(b.type === 'transfer' ? '转账' : catLabel(b.subCatId || b.catId)) +
      (b.note ? '<span class="yw-bill-note">' + esc(b.note) + '</span>' : '') + '</div>' +
      '<div class="yw-bill-meta muted small">' + esc(b.date) + (b.time ? ' ' + esc(b.time) : '') +
      (b.accountName || accountName(b.accountId) ? ' · ' + esc(b.accountName || accountName(b.accountId)) : '') +
      (b.type === 'transfer' && b.toAccountId ? ' → ' + esc(accountName(b.toAccountId)) : '') +
      (linked ? ' · <span class="yw-sync-tag">已同步' + domainLabel(linked.kind) + '</span>' : '') +
      (b.source && b.source !== 'manual' ? ' · 导入' : '') +
      '</div></div>' +
      '<div class="yw-bill-amt ' + amtCls + '">' + sign + money(b.amount) + '</div>' +
      '</div>';
  }

  /* ---------- 记一笔（桌面式：金额输入框 + 分类图标网格，无数字键盘） ---------- */
  function openBillForm(bill) {
    const editing = !!bill;
    const wallet = S.getDB().wallet;
    let type = bill ? bill.type : 'expense';
    let curParent = bill && bill.catId ? bill.catId : '';
    let curSub = bill && bill.subCatId ? bill.subCatId : '';

    const body =
      '<div class="yw">' +
      '<div class="yw-top">' +
      '<div class="seg-toggle yw-type">' +
      [['expense', '支出'], ['income', '收入'], ['transfer', '转账']].map(function (t) {
        return '<button type="button" class="seg-btn' + (type === t[0] ? ' on' : '') + '" data-bft="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="yw-top-right">' +
      '<input type="date" id="yw-date" value="' + esc(bill ? bill.date : today()) + '">' +
      '<select id="yw-acc">' +
      '<option value=""' + (!bill || !bill.accountId ? ' selected' : '') + '>不区分账户</option>' +
      (wallet.accounts || []).map(function (a) {
        return '<option value="' + esc(a.id) + '"' + (bill && bill.accountId === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>';
      }).join('') + '</select>' +
      '<select id="yw-to-acc" style="display:none"><option value="">转入账户…</option>' +
      (wallet.accounts || []).map(function (a) {
        return '<option value="' + esc(a.id) + '"' + (bill && bill.toAccountId === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>';
      }).join('') + '</select>' +
      '</div></div>' +

      '<div class="yw-amount-row">' +
      '<span class="yw-yen">¥</span>' +
      '<input id="yw-amt" class="yw-amt-input" type="text" inputmode="decimal" autocomplete="off" ' +
      'placeholder="0.00" value="' + esc(bill ? bill.amount : '') + '">' +
      '<span class="yw-amt-cn muted small" id="yw-amt-cn"></span>' +
      '</div>' +

      '<div class="yw-cats" id="yw-cats"></div>' +

      '<div class="yw-fields">' +
      '<input id="yw-note" class="yw-note" placeholder="备注（如：午饭 / iPhone 17；命中手机数码·服饰·美妆等分类会自动同步词条）" value="' + esc(bill ? (bill.note || '') : '') + '">' +
      '<div class="chip-row" id="yw-tags">' + ((wallet.tags || []).map(function (t) {
        const on = bill && (bill.tagIds || []).indexOf(t.id) >= 0;
        return '<span class="tag' + (on ? ' tag-on' : '') + '" data-tag="' + esc(t.id) + '">' + esc(t.name) + '</span>';
      }).join('')) + '</div>' +
      '</div></div>';

    UI.modal({
      title: editing ? '编辑账单' : '记一笔', width: 640,
      bodyHTML: body,
      footerHTML: (editing ? '<button class="btn btn-danger" id="yw-del">删除</button>' : '') +
        '<div class="flex1"></div>' +
        '<button class="btn btn-ghost" data-x="c">取消</button>' +
        '<button class="btn btn-primary btn-lg" data-x="s">' + (editing ? '保存' : '记一笔') + '</button>',
      onMount: function (w, close) {
        function renderCatsBox() {
          const box = w.querySelector('#yw-cats');
          const list = catTree(type === 'income' ? 'income' : 'expense');
          if (type === 'transfer') {
            box.innerHTML = '<div class="yw-transfer-hint muted">转账不计入收支：从转出账户转入转入账户，仅移动余额。</div>';
            w.querySelector('#yw-to-acc').style.display = '';
            return;
          }
          w.querySelector('#yw-to-acc').style.display = 'none';
          if (!curParent && list.length) curParent = list[0].id;
          const parent = list.find(function (c) { return c.id === curParent; }) || list[0];
          const subs = (parent ? parent.children || [] : []);
          box.innerHTML =
            '<div class="yw-cat-tabs">' + list.map(function (c) {
              return '<div class="yw-cat-tab' + (parent && c.id === parent.id ? ' on' : '') + '" data-parent="' + esc(c.id) + '">' +
                catIconHTML(c.id, 22) + '<span>' + esc(c.name) + '</span></div>';
            }).join('') + '</div>' +
            (subs.length
              ? '<div class="yw-cat-grid">' + subs.map(function (ch) {
                return '<div class="yw-cat-cell' + (curSub === ch.id ? ' on' : '') +
                  '" data-sub="' + esc(ch.id) + '" data-p="' + esc(parent ? parent.id : '') + '">' +
                  catIconHTML(ch.id, 20) + '<span>' + esc(ch.name) + '</span></div>';
              }).join('') + '</div>'
              : '<div class="yw-cat-grid"><div class="yw-cat-cell' + (curParent ? ' on' : '') +
              '" data-sub="' + esc(parent ? parent.id : '') + '" data-p="' + esc(parent ? parent.id : '') + '">' +
              catIconHTML(parent ? parent.id : '', 20) + '<span>' + esc(parent ? parent.name : '') + '</span></div></div>');
          box.querySelectorAll('[data-parent]').forEach(function (el) {
            el.addEventListener('click', function () {
              curParent = el.getAttribute('data-parent');
              curSub = '';
              renderCatsBox();
            });
          });
          box.querySelectorAll('[data-sub]').forEach(function (el) {
            el.addEventListener('click', function () {
              curSub = el.getAttribute('data-sub');
              curParent = el.getAttribute('data-p');
              renderCatsBox();
            });
          });
        }
        renderCatsBox();

        w.querySelectorAll('[data-bft]').forEach(function (el) {
          el.addEventListener('click', function () {
            w.querySelectorAll('[data-bft]').forEach(function (x) { x.classList.remove('on'); });
            el.classList.add('on');
            type = el.getAttribute('data-bft');
            curParent = ''; curSub = '';
            renderCatsBox();
          });
        });

        // 金额：输入即显人民币大写
        const amtInput = w.querySelector('#yw-amt');
        const cnEl = w.querySelector('#yw-amt-cn');
        function syncAmtCN() {
          const v = Math.abs(Number(amtInput.value) || 0);
          cnEl.textContent = v ? '人民币大写：' + digitUppercase(v) : '';
        }
        amtInput.addEventListener('input', syncAmtCN);
        syncAmtCN();
        setTimeout(function () { amtInput.focus(); }, 60);

        w.querySelectorAll('#yw-tags [data-tag]').forEach(function (el) {
          el.addEventListener('click', function () { el.classList.toggle('tag-on'); });
        });

        if (editing) {
          w.querySelector('#yw-del').addEventListener('click', async function () {
            if (await UI.confirmDialog('删除确认', '删除这笔账单？账户余额回滚，自动生成的词条会一并清理。')) {
              await S.removeBill(bill.id);
              close();
              UI.toast('账单已删除', 'success');
              window.App.refresh();
            }
          });
        }

        w.querySelector('[data-x=c]').addEventListener('click', close);
        w.querySelector('[data-x=s]').addEventListener('click', async function () {
          const amount = Math.abs(Number(amtInput.value) || 0);
          if (!amount) { UI.toast('请输入金额', 'error'); amtInput.focus(); return; }
          const date = w.querySelector('#yw-date').value;
          if (!date) { UI.toast('请选择日期', 'error'); return; }
          if (type !== 'transfer' && !curSub && !curParent) { UI.toast('请选择分类', 'error'); return; }
          const tagIds = Array.prototype.map.call(w.querySelectorAll('#yw-tags .tag-on'), function (el) {
            return el.getAttribute('data-tag');
          });
          const f = (curSub && curSub !== curParent) ? findCat(curSub) : findCat(curParent);
          const rec = {
            id: bill ? bill.id : U.uid(),
            type: type, amount: amount, date: date,
            time: bill ? (bill.time || '') : '',
            catId: type === 'transfer' ? '' : (f && f.parent ? f.parent.id : curParent),
            subCatId: type === 'transfer' ? '' : ((f && f.parent) ? curSub : ''),
            accountId: w.querySelector('#yw-acc').value,
            toAccountId: type === 'transfer' ? w.querySelector('#yw-to-acc').value : '',
            note: w.querySelector('#yw-note').value.trim(),
            tagIds: tagIds,
            accountName: accountName(w.querySelector('#yw-acc').value),
            source: bill ? (bill.source || 'manual') : 'manual',
            createdAt: bill ? bill.createdAt : undefined,
            updatedAt: new Date().toISOString()
          };
          if (type === 'transfer' && (!rec.accountId || !rec.toAccountId)) {
            UI.toast('转账需选择转出与转入账户', 'error'); return;
          }
          try {
            await S.saveBill(rec);
            const synced = rec.itemId ? (S.getDB().items || []).find(function (i) { return i.id === rec.itemId; }) : null;
            close();
            UI.toast(editing ? '已保存' : '记账成功' + (synced ? '，已同步到「' + domainLabel(synced.kind) + '」' : ''), 'success');
            window.App.refresh();
          } catch (e) {
            UI.toast(e.message || '保存失败', 'error');
          }
        });
      }
    });
  }

  /* ---------- 账户预算 ---------- */
  /* ---------- 账户：账户卡 + 余额记录（某时点各账户余额快照，配流水倒推曲线） ---------- */
  function renderAccounts(box) {
    const db = S.getDB();
    const wallet = db.wallet;
    let total = 0;
    (wallet.accounts || []).forEach(function (a) { total += Number(a.balance) || 0; });
    const records = (wallet.balances || []).slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });

    box.innerHTML =
      '<div class="kpi-row"><div class="kpi-mini"><div class="kpi-label">账户总余额</div>' +
      '<div class="kpi-value">' + money(total) + '</div></div>' +
      '<div class="kpi-mini"><div class="kpi-label">账户数</div><div class="kpi-value">' + (wallet.accounts || []).length + '</div></div>' +
      '<div class="kpi-mini"><div class="kpi-label">余额记录</div><div class="kpi-value">' + records.length + ' 条</div></div></div>' +

      '<div class="panel"><div class="panel-head">' + UI.icon('wallet', 16) + ' 账户' +
      '<div class="flex1"></div><button class="btn btn-ghost btn-sm" id="btn-add-acc">' + UI.icon('plus', 14) + ' 添加账户</button>' +
      '<button class="btn btn-ghost btn-sm" id="btn-transfer">' + UI.icon('arrow-left-right', 14) + ' 转账</button>' +
      '</div><div class="panel-body"><div class="acc-grid">' + (wallet.accounts || []).map(function (a) {
        return '<div class="item-card acc-card-w">' +
          '<div class="item-info"><div class="item-name">' + UI.icon(a.icon || 'wallet', 16) + ' ' + esc(a.name) + '</div>' +
          '<div class="item-meta">' + money(a.balance) + (a.note ? ' · ' + esc(a.note) : '') + '</div></div>' +
          '<div class="detail-btn-row">' +
          '<button class="btn btn-ghost btn-sm" data-acc-edit="' + esc(a.id) + '">编辑</button>' +
          '<button class="btn btn-ghost btn-sm" data-acc-del="' + esc(a.id) + '">删除</button>' +
          '</div></div>';
      }).join('') + '</div></div></div>' +

      '<div class="panel"><div class="panel-head">' + UI.icon('history', 16) + ' 余额记录' +
      '<div class="flex1"></div>' +
      '<button class="btn btn-primary btn-sm" id="btn-add-balance">' + UI.icon('plus', 14) + ' 记余额</button></div>' +
      '<div class="panel-body">' +
      '<p class="muted small">记录某个时间点各账户的余额（对账快照）。资产走势统计结合账单流水自动倒推每日余额，快照用于校准——见「我的统计 → 资产走势」。</p>' +
      (records.length
        ? '<div class="mini-table">' + records.map(function (r) {
          return '<div class="mini-row"><span class="muted">' + esc(r.date) + '</span>' +
            '<span class="flex1">' + esc(accountName(r.accountId) || '账户') + '</span>' +
            '<strong>' + money(r.balance) + '</strong>' +
            (r.note ? '<span class="muted small">' + esc(r.note) + '</span>' : '') +
            '<button class="btn btn-ghost btn-sm" data-bal-del="' + esc(r.id) + '">删除</button></div>';
        }).join('') + '</div>'
        : '<div class="empty-hint muted">还没有余额记录</div>') +
      '</div></div>';

    box.querySelector('#btn-add-acc').addEventListener('click', function () { openAccountForm(null); });
    box.querySelector('#btn-transfer').addEventListener('click', openTransferForm);
    box.querySelector('#btn-add-balance').addEventListener('click', function () { openBalanceForm(); });
    box.querySelectorAll('[data-acc-edit]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        openAccountForm((wallet.accounts || []).find(function (a) { return a.id === el.getAttribute('data-acc-edit'); }));
      });
    });
    box.querySelectorAll('[data-acc-del]').forEach(function (el) {
      el.addEventListener('click', async function (e) {
        e.stopPropagation();
        const id = el.getAttribute('data-acc-del');
        if (await UI.confirmDialog('删除确认', '删除该账户？有流水的账户无法删除。')) {
          try {
            await S.removeWalletAccount(id);
            UI.toast('账户已删除', 'success');
            window.App.refresh();
          } catch (err) { UI.toast(err.message, 'error'); }
        }
      });
    });
    box.querySelectorAll('[data-bal-del]').forEach(function (el) {
      el.addEventListener('click', async function () {
        const id = el.getAttribute('data-bal-del');
        if (await UI.confirmDialog('删除确认', '删除这条余额记录？')) {
          await S.removeBalanceRecord(id);
          window.App.refresh();
        }
      });
    });
  }

  // 记余额：某日某账户的余额快照
  function openBalanceForm() {
    const accs = ((S.getDB().wallet || {}).accounts) || [];
    if (!accs.length) { UI.toast('请先添加账户', 'error'); return; }
    UI.modal({
      title: '记余额', width: 460,
      bodyHTML: '<div class="form-grid">' +
        '<label><span class="f-label">日期</span><input type="date" id="bf-date" value="' + today() + '"></label>' +
        '<label><span class="f-label">账户</span><select id="bf-acc">' + accs.map(function (a) {
          return '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>';
        }).join('') + '</select></label>' +
        '<label><span class="f-label">当时的余额 <span class="req-star">*</span></span>' +
        '<input id="bf-bal" type="number" step="0.01" placeholder="0.00"></label>' +
        '<label class="f-full"><span class="f-label">备注</span><input id="bf-note" placeholder="如：对账 / 发薪后"></label></div>',
      footerHTML: '<button class="btn btn-ghost" data-x="c">取消</button><button class="btn btn-primary" data-x="s">保存</button>',
      onMount: function (w, close) {
        w.querySelector('[data-x=c]').addEventListener('click', close);
        w.querySelector('[data-x=s]').addEventListener('click', async function () {
          const bal = Math.abs(Number(w.querySelector('#bf-bal').value) || 0);
          if (!w.querySelector('#bf-bal').value && w.querySelector('#bf-bal').value !== '0') {
            UI.toast('请填写余额', 'error'); return;
          }
          await S.saveBalanceRecord({
            id: U.uid(), date: w.querySelector('#bf-date').value,
            accountId: w.querySelector('#bf-acc').value,
            balance: bal, note: w.querySelector('#bf-note').value.trim(),
            createdAt: new Date().toISOString()
          });
          close();
          UI.toast('余额已记录', 'success');
          window.App.refresh();
        });
      }
    });
  }

  function openAccountForm(acc) {
    const editing = !!acc;
    UI.modal({
      title: editing ? '编辑账户' : '添加账户', width: 480,
      bodyHTML: '<div class="form-grid">' +
        '<label><span class="f-label">名称 <span class="req-star">*</span></span>' +
        '<input id="af-name" value="' + esc(acc ? acc.name : '') + '" placeholder="如：工资卡"></label>' +
        '<label><span class="f-label">类型</span><select id="af-type">' +
        [['cash', '现金'], ['wallet', '钱包'], ['bank', '银行卡'], ['other', '其他']].map(function (t) {
          return '<option value="' + t[0] + '"' + (acc && acc.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
        }).join('') + '</select></label>' +
        '<label><span class="f-label">余额</span><input id="af-bal" type="number" step="0.01" value="' + (acc ? esc(acc.balance) : '0') + '"></label>' +
        '<label class="f-full"><span class="f-label">备注</span><input id="af-note" value="' + esc(acc ? (acc.note || '') : '') + '"></label></div>',
      footerHTML: '<button class="btn btn-ghost" data-x="c">取消</button><button class="btn btn-primary" data-x="s">保存</button>',
      onMount: function (w, close) {
        w.querySelector('[data-x=c]').addEventListener('click', close);
        w.querySelector('[data-x=s]').addEventListener('click', async function () {
          const name = w.querySelector('#af-name').value.trim();
          if (!name) { UI.toast('请填写账户名', 'error'); return; }
          await S.saveWalletAccount({
            id: acc ? acc.id : U.uid(), name: name, icon: acc ? (acc.icon || 'wallet') : 'wallet',
            type: w.querySelector('#af-type').value,
            balance: Math.abs(Number(w.querySelector('#af-bal').value) || 0),
            note: w.querySelector('#af-note').value.trim()
          });
          close(); UI.toast(editing ? '已保存' : '账户已添加', 'success');
          window.App.refresh();
        });
      }
    });
  }

  function openTransferForm() {
    const accs = ((S.getDB().wallet || {}).accounts) || [];
    if (accs.length < 2) { UI.toast('至少需要两个账户', 'error'); return; }
    UI.modal({
      title: '账户转账', width: 480,
      bodyHTML: '<div class="form-grid">' +
        '<label><span class="f-label">从</span><select id="tf-from">' + accs.map(function (a) {
          return '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>';
        }).join('') + '</select></label>' +
        '<label><span class="f-label">到</span><select id="tf-to">' + accs.map(function (a, i) {
          return '<option value="' + esc(a.id) + '"' + (i === 1 ? ' selected' : '') + '>' + esc(a.name) + '</option>';
        }).join('') + '</select></label>' +
        '<label><span class="f-label">金额 <span class="req-star">*</span></span>' +
        '<input id="tf-amount" type="number" step="0.01" min="0" placeholder="0.00"></label>' +
        '<label><span class="f-label">日期</span><input id="tf-date" type="date" value="' + today() + '"></label>' +
        '<label class="f-full"><span class="f-label">备注</span><input id="tf-note" placeholder="如：还信用卡"></label></div>',
      footerHTML: '<button class="btn btn-ghost" data-x="c">取消</button><button class="btn btn-primary" data-x="s">确认转账</button>',
      onMount: function (w, close) {
        w.querySelector('[data-x=c]').addEventListener('click', close);
        w.querySelector('[data-x=s]').addEventListener('click', async function () {
          const amount = Math.abs(Number(w.querySelector('#tf-amount').value) || 0);
          const from = w.querySelector('#tf-from').value, to = w.querySelector('#tf-to').value;
          if (!amount) { UI.toast('请填写金额', 'error'); return; }
          if (from === to) { UI.toast('转出与转入不能相同', 'error'); return; }
          await S.saveBill({
            id: U.uid(), type: 'transfer', amount: amount,
            date: w.querySelector('#tf-date').value, time: '',
            catId: '', subCatId: '', accountId: from, toAccountId: to,
            note: w.querySelector('#tf-note').value.trim(), tagIds: [], source: 'manual'
          });
          close(); UI.toast('转账完成', 'success');
          window.App.refresh();
        });
      }
    });
  }

  /* ---------- 账单导入（挂载到设置 → 数据与备份；钱袋页不再放） ---------- */
  function mountImportUI(box) {
    const imports = (((S.getDB().wallet || {}).imports) || []).slice().reverse();
    box.innerHTML =
      '<div class="btn-row">' +
      '<button class="btn btn-primary btn-sm" id="btn-import">' + UI.icon('file-up', 14) + ' 选择账单文件导入</button>' +
      '<button class="btn btn-ghost btn-sm" id="btn-tpl">' + UI.icon('download', 14) + ' 下载导入模板</button>' +
      '<button class="btn btn-ghost btn-sm" id="btn-export-bills">' + UI.icon('file-down', 14) + ' 导出账单 CSV</button>' +
      '<input type="file" id="import-file" accept=".csv,.json,.txt" style="display:none"></div>' +
      '<p class="muted small">支持：支付宝账单 CSV、微信支付账单 CSV、通用模板 CSV、其他记账 App 导出的 JSON/CSV。导入前可预览识别结果，重复账单自动去重。</p>' +
      '<div id="import-preview"></div>' +
      '<h4 class="detail-sub">导入批次</h4>' +
      (imports.length ? '<div class="mini-table">' + imports.map(function (b) {
        return '<div class="mini-row"><span class="flex1">' + esc(b.name || b.id) + ' · ' + esc(b.createdAt || '').slice(0, 10) +
          ' · ' + (b.billIds || []).length + ' 笔</span>' +
          '<button class="btn btn-ghost btn-sm" data-revert="' + esc(b.id) + '">撤销此批</button></div>';
      }).join('') + '</div>' : '<div class="empty-hint muted">还没有导入记录</div>');

    const fileInput = box.querySelector('#import-file');
    box.querySelector('#btn-import').addEventListener('click', function () { fileInput.click(); });
    box.querySelector('#btn-tpl').addEventListener('click', downloadTemplate);
    box.querySelector('#btn-export-bills').addEventListener('click', exportBills);
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) handleImportFile(fileInput.files[0], box);
      fileInput.value = '';
    });
    box.querySelectorAll('[data-revert]').forEach(function (el) {
      el.addEventListener('click', async function () {
        const id = el.getAttribute('data-revert');
        if (await UI.confirmDialog('撤销确认', '撤销这次导入？该批次账单全部删除，余额回滚。')) {
          await S.revertImport(id);
          UI.toast('已撤销', 'success');
          window.App.refresh();
        }
      });
    });
  }

  function exportBills() {
    fetch('/api/export/bills?acc=' + encodeURIComponent(S.accId())).then(function (r) {
      return r.blob();
    }).then(function (blob) {
      U.download(blob, 'lovelife-账单-' + today() + '.csv');
      UI.toast('账单已导出', 'success');
    }).catch(function () { UI.toast('导出失败', 'error'); });
  }

  function downloadTemplate() {
    fetch('/api/import/template').then(function (r) { return r.blob(); }).then(function (blob) {
      U.download(blob, 'lovelife-记账模板.csv');
      UI.toast('模板已下载', 'success');
    }).catch(function () { UI.toast('模板下载失败', 'error'); });
  }

  function handleImportFile(file, box) {
    const reader = new FileReader();
    reader.onload = async function () {
      const text = String(reader.result || '');
      const preview = box.querySelector('#import-preview');
      preview.innerHTML = '<div class="muted">正在识别…</div>';
      try {
        const r = await fetch('/api/import/parse', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, text: text })
        });
        const out = await r.json();
        if (!out.ok) throw new Error(out.error || '解析失败');
        renderImportPreview(preview, out, file.name);
      } catch (e) {
        preview.innerHTML = '<div class="tag tag-warn">识别失败：' + esc(e.message) + '</div>';
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function renderImportPreview(preview, out, filename) {
    const fmtName = {
      alipay_csv: '支付宝账单', wechat_csv: '微信支付账单', generic_csv: '通用/模板 CSV',
      app_json: '记账 App 备份', unknown: '未识别格式'
    }[out.format] || out.format;
    const bills = out.bills || [];
    const existing = ((S.getDB().wallet || {}).bills) || [];
    const dups = bills.filter(function (b) {
      return existing.some(function (e) {
        return e.date === b.date && Math.abs(Number(e.amount) - Number(b.amount)) < 0.005 &&
          e.type === b.type && (!b.note || !e.note || e.note === b.note);
      });
    });

    preview.innerHTML =
      '<div class="import-preview-box">' +
      '<div class="tag">格式：' + esc(fmtName) + '</div> ' +
      '<div class="tag">识别 ' + bills.length + ' 笔</div> ' +
      (dups.length ? '<div class="tag tag-warn">疑似重复 ' + dups.length + ' 笔</div> ' : '') +
      ((out.skipped || []).length ? '<div class="tag tag-warn">跳过 ' + out.skipped.length + ' 笔</div>' : '') +
      ((out.warnings || []).map(function (m) { return '<div class="muted small">' + esc(m) + '</div>'; }).join('')) +
      '<div class="mini-table" style="max-height:280px;overflow:auto;margin-top:8px">' +
      bills.slice(0, 100).map(function (b, i) {
        return '<div class="mini-row"><label class="chip-check"><input type="checkbox" class="imp-row" data-i="' + i + '" checked></label>' +
          '<span class="flex1">' + esc(b.date) + ' ' + esc(b.note || b.catName || '') + '</span>' +
          '<span>' + esc(typeLabel(b.type)) + ' ' + money(b.amount) + '</span>' +
          (dups.indexOf(b) >= 0 ? '<span class="tag tag-warn">重复</span>' : '') + '</div>';
      }).join('') + (bills.length > 100 ? '<div class="mini-row muted small">… 仅预览前 100 笔，导入时全量生效</div>' : '') +
      '</div>' +
      '<div class="btn-row" style="margin-top:12px">' +
      '<button class="btn btn-primary" id="imp-commit">导入选中账单</button>' +
      '<button class="btn btn-ghost" id="imp-cancel">取消</button></div></div>';

    preview.querySelector('#imp-cancel').addEventListener('click', function () { preview.innerHTML = ''; });
    preview.querySelector('#imp-commit').addEventListener('click', async function () {
      const checks = preview.querySelectorAll('.imp-row:checked');
      const rows = Array.prototype.map.call(checks, function (c) { return bills[Number(c.getAttribute('data-i'))]; });
      if (!rows.length) { UI.toast('请至少选中一笔', 'error'); return; }
      const billIds = [];
      for (let i = 0; i < rows.length; i++) {
        const b = rows[i];
        const cat = matchCat(b.catName, b.subCatName, b.type) || {};
        const rec = {
          id: U.uid(), type: b.type || 'expense',
          amount: Math.abs(Number(b.amount) || 0),
          date: b.date, time: b.time || '',
          catId: cat.catId || '', subCatId: cat.subCatId || '',
          accountId: matchAccount(b.accountName),
          note: b.note || '', tagIds: [],
          accountName: b.accountName || '',
          source: 'import:' + out.format,
          createdAt: new Date().toISOString()
        };
        await S.saveBill(rec); // 自动词条同步
        billIds.push(rec.id);
      }
      await S.saveImportBatch({
        id: U.uid(), name: filename, format: out.format,
        billIds: billIds, createdAt: new Date().toISOString()
      });
      UI.toast('导入完成 ' + billIds.length + ' 笔', 'success');
      window.App.refresh();
    });
  }

  function matchCat(catName, subCatName, type) {
    const kind = type === 'income' ? 'income' : 'expense';
    const list = catTree(kind);
    let hitCat = '', hitSub = '';
    list.forEach(function (c) {
      if (catName && c.name === catName) hitCat = c.id;
      (c.children || []).forEach(function (ch) {
        if (subCatName && ch.name === subCatName) { hitSub = ch.id; hitCat = hitCat || c.id; }
        if (!subCatName && catName && ch.name === catName) { hitSub = ch.id; hitCat = c.id; }
      });
    });
    if (!hitCat && !hitSub) {
      const fallback = list.find(function (c) { return /其他/.test(c.name); });
      if (fallback) hitCat = fallback.id;
    }
    return { catId: hitCat, subCatId: hitSub };
  }

  function matchAccount(name) {
    const accs = ((S.getDB().wallet || {}).accounts) || [];
    if (!name) return (accs[0] || {}).id || '';
    const n = String(name);
    const hit = accs.find(function (a) { return n.indexOf(a.name) >= 0 || a.name.indexOf(n) >= 0; });
    return hit ? hit.id : (accs.find(function (a) { return a.type === 'other'; }) || accs[0] || {}).id || '';
  }

  /* ---------- 分类一览（挂载到设置 → 消费与统计口径，紧凑展示） ---------- */
  function catTreeCompactHTML() {
    function block(kind, title) {
      return '<h4 class="detail-sub">' + title + '</h4><div class="ycat-compact">' +
        catTree(kind).map(function (c) {
          const subs = (c.children || []).map(function (ch) {
            return '<span class="ycat-mini">' + catIconHTML(ch.id, 18) + esc(ch.name) + '</span>';
          }).join('');
          return '<div class="ycat-compact-row">' +
            '<span class="ycat-compact-l1">' + catIconHTML(c.id, 20) + esc(c.name) + '</span>' +
            '<span class="ycat-compact-subs">' + (subs || '<span class="muted small">—</span>') + '</span></div>';
        }).join('') + '</div>';
    }
    return block('expense', '支出分类（主流记账复刻）') + block('income', '收入分类（主流记账复刻）');
  }

  return {
    render: render, openBillForm: openBillForm, renderBills: renderBills,
    mountImportUI: mountImportUI, catTreeCompactHTML: catTreeCompactHTML,
    downloadTemplate: downloadTemplate
  };
})();
