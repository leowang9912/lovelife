/* views-wallet.js — 我的钱袋 v2：记账界面（分类图标网格）/ 流水 / 账户 / 导入 / 分类管理 */
window.WalletView = (function () {
  const S = window.Storage;
  const U = window.Utils;
  const UI = window.UI;

  let tab = 'bills';
  const filters = {
    range: 'month', catId: '', accountId: '', type: '', q: '',
    date: '', month: '', // 统计下钻：精确到某日/某月（设置后 range 临时切 all）
    sortKey: 'date', sortDir: 'desc'
  };
  let bulkMode = false; // 批量删除模式：勾选框按需显示（默认隐藏）

  /* ---------- 工具 ---------- */
  function money(n) {
    const v = Number(n) || 0;
    return '¥' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function esc(t) { return U.escapeHtml(t == null ? '' : t); }
  function today() { return U.todayStr(); }
  function monthKey(d) { return (d || '').slice(0, 7); }
  function nowMonth() { return today().slice(0, 7); }

  // 人民币大写（转整数「分」再拆位，杜绝浮点拆位错误：0.47→肆角柒分、2.01→贰元零壹分）
  function digitUppercase(n) {
    const D = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
    const centsTotal = Math.round(Math.abs(Number(n) || 0) * 100);
    const yuan = Math.floor(centsTotal / 100);
    const jiao = Math.floor(centsTotal / 10) % 10;
    const fen = centsTotal % 10;
    function yuanPart(num) {
      if (num === 0) return '';
      const units = ['', '拾', '佰', '仟'];
      const bigs = ['', '万', '亿'];
      let s = '', gi = 0, needZero = false;
      while (num > 0) {
        const g = num % 10000;
        num = Math.floor(num / 10000);
        let gs = '', innerZero = false;
        for (let i = 0, g2 = g; i < 4; i++) {
          const d = g2 % 10;
          g2 = Math.floor(g2 / 10);
          if (d === 0) { innerZero = true; }
          else {
            gs = D[d] + units[i] + (innerZero && gs ? '零' : '') + gs;
            innerZero = false;
          }
        }
        if (gs) {
          s = gs + bigs[gi] + (needZero ? '零' : '') + s;
          needZero = false;
        } else if (s) {
          needZero = true;
        }
        gi++;
      }
      return s;
    }
    let s = (yuanPart(yuan) || '零') + '元';
    if (jiao === 0 && fen === 0) return s + '整';
    if (jiao === 0) s += '零';
    else s += D[jiao] + '角';
    if (fen > 0) s += D[fen] + '分';
    else s += '整';
    return s;
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

  // 最近使用分类（本地记忆，记账网格置顶常用项，减少翻找）
  function recentCats() {
    try { return JSON.parse(localStorage.getItem('ll-recent-cats') || '[]'); } catch (e) { return []; }
  }
  function rememberRecentCat(id) {
    if (!id) return;
    const list = recentCats().filter(function (x) { return x !== id; });
    list.unshift(id);
    try { localStorage.setItem('ll-recent-cats', JSON.stringify(list.slice(0, 8))); } catch (e) {}
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
    if (filters.date) {
      list = list.filter(function (b) { return b.date === filters.date; });
    } else if (filters.month) {
      list = list.filter(function (b) { return monthKey(b.date || '') === filters.month; });
    } else {
      list = list.filter(inRange);
    }
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
    main.querySelector('#btn-goto-stats').addEventListener('click', function () {
      window.App.go('plan');
      // 锚定到收支统计栏目（钱袋相关统计集中在整体统计块）
      setTimeout(function () {
        const el = document.querySelector('[data-id="wBalance"]');
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    });
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
      // 两级选择：一级下拉 + 二级下拉联动（不再全平铺）
      let curTop = filters.catId || '';
      let curSub = filters.catId || '';
      // 从现有筛选反推一级/二级
      ['expense', 'income'].forEach(function (kind) {
        catTree(kind).forEach(function (c) {
          if (c.id === filters.catId) { curTop = c.id; curSub = ''; }
          (c.children || []).forEach(function (ch) {
            if (ch.id === filters.catId) { curTop = c.id; curSub = ch.id; }
          });
        });
      });
      const topSel = '<select id="f-cat1"><option value="">全部分类</option>' +
        ['expense', 'income'].map(function (kind) {
          return catTree(kind).map(function (c) {
            return '<option value="' + esc(c.id) + '"' + (curTop === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
          }).join('');
        }).join('') + '</select>';
      const topNode = curTop ? (function () {
        let found = null;
        ['expense', 'income'].forEach(function (kind) {
          catTree(kind).forEach(function (c) { if (c.id === curTop) found = c; });
        });
        return found;
      })() : null;
      const subs = (topNode && topNode.children) || [];
      const subSel = '<select id="f-cat2"' + (subs.length ? '' : ' disabled') + '><option value="">全部子类</option>' +
        subs.map(function (ch) {
          return '<option value="' + esc(ch.id) + '"' + (curSub === ch.id ? ' selected' : '') + '>' + esc(ch.name) + '</option>';
        }).join('') + '</select>';
      return topSel + subSel;
    };
    const accOpts = function () {
      let s = '<option value="">全部账户</option>';
      (wallet.accounts || []).forEach(function (a) {
        s += '<option value="' + esc(a.id) + '"' + (filters.accountId === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>';
      });
      return s;
    };

    // 头部汇总卡：标签跟随当前筛选范围（本月/今年/全部/精确日期），不再误导
    const rangeLabel = filters.date ? filters.date
      : filters.month ? filters.month.replace('-', ' 年 ') + ' 月'
        : filters.range === 'year' ? '今年' : filters.range === 'all' ? '全部' : '本月';
    box.innerHTML =
      ((filters.date || filters.month)
        ? '<div class="filter-bar"><span class="tag tag-on">' + UI.icon('filter', 12) + ' 已筛选 ' + esc(rangeLabel) + '</span>' +
        '<button class="btn btn-ghost btn-sm" id="f-clear-date">清除日期筛选</button></div>'
        : '') +
      '<div class="yw-month-head">' +
      '<div class="yw-month-cell"><span class="yw-month-label">' + esc(rangeLabel) + '支出</span><span class="yw-month-val out">' + money(exp) + '</span></div>' +
      '<div class="yw-month-cell"><span class="yw-month-label">' + esc(rangeLabel) + '收入</span><span class="yw-month-val in">' + money(inc) + '</span></div>' +
      '<div class="yw-month-cell"><span class="yw-month-label">结余</span><span class="yw-month-val">' + money(inc - exp) + '</span></div>' +
      '</div>' +
      '<div class="filter-bar">' +
      '<div class="yw-month-nav">' +
      '<button class="btn btn-ghost btn-sm" id="mn-prev" title="上一月">‹</button>' +
      '<span class="yw-month-now">' + esc(monthNavLabel()) + '</span>' +
      '<button class="btn btn-ghost btn-sm" id="mn-next" title="下一月">›</button>' +
      '</div>' +
      '<button class="btn btn-ghost btn-sm" id="btn-bulk-del">' + UI.icon('trash-2', 14) + ' ' + (bulkMode ? '退出批量' : '批量删除') + '</button>' +
      '<div class="seg-toggle">' +
      [['month', '本月'], ['year', '今年'], ['all', '全部']].map(function (r) {
        return '<button class="seg-btn' + (filters.range === r[0] ? ' on' : '') + '" data-range="' + r[0] + '">' + r[1] + '</button>';
      }).join('') + '</div>' +
      '<select id="f-type"><option value="">收支/转账</option>' +
      '<option value="expense"' + (filters.type === 'expense' ? ' selected' : '') + '>支出</option>' +
      '<option value="income"' + (filters.type === 'income' ? ' selected' : '') + '>收入</option>' +
      '<option value="transfer"' + (filters.type === 'transfer' ? ' selected' : '') + '>转账</option></select>' +
      catOpts() +
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
        ? billsGroupedHTML(list, bulkMode)
        : '<div class="empty-state"><div class="empty-icon">' + UI.icon('receipt', 48) + '</div>' +
        '<div>' + (filters.q || filters.catId || filters.type || filters.accountId ? '没有符合筛选的结果' : '还没有记账记录') + '</div></div>');

    box.querySelectorAll('[data-range]').forEach(function (el) {
      el.addEventListener('click', function () {
        filters.range = el.getAttribute('data-range');
        filters.date = ''; filters.month = '';
        renderBills(box);
      });
    });
    const clearDate = box.querySelector('#f-clear-date');
    if (clearDate) clearDate.addEventListener('click', function () {
      filters.date = ''; filters.month = '';
      renderBills(box);
    });
    const mnPrev = box.querySelector('#mn-prev');
    if (mnPrev) mnPrev.addEventListener('click', function () { shiftMonth(-1); });
    const mnNext = box.querySelector('#mn-next');
    if (mnNext) mnNext.addEventListener('click', function () { shiftMonth(1); });
    const bulkDel = box.querySelector('#btn-bulk-del');
    if (bulkDel) bulkDel.addEventListener('click', async function () {
      // 批量模式：先显示勾选框（平时不显示）；有选中则执行删除
      const checked = Array.prototype.map.call(box.querySelectorAll('.bulk-row:checked'), function (c) {
        return c.getAttribute('data-bulk');
      });
      if (!bulkMode) {
        bulkMode = true;
        renderBills(box);
        UI.toast('批量模式：勾选要删除的账单，组头可全选当天', 'success');
        return;
      }
      if (!checked.length) {
        bulkMode = false;
        renderBills(box);
        return;
      }
      if (await UI.confirmDialog('批量删除', '删除选中的 ' + checked.length + ' 笔账单？余额回滚，自动生成的词条/美食一并清理。')) {
        for (let i = 0; i < checked.length; i++) await S.removeBill(checked[i]);
        bulkMode = false;
        UI.toast('已删除 ' + checked.length + ' 笔', 'success');
        window.App.refresh();
      }
    });
    // 组头全选当天
    box.querySelectorAll('.day-check').forEach(function (el) {
      el.addEventListener('change', function () {
        const day = el.getAttribute('data-day');
        const group = el.closest('.yw-day-group');
        if (group) group.querySelectorAll('.bulk-row').forEach(function (c) { c.checked = el.checked; });
      });
    });
    const bindSel = function (id, key) {
      const el = box.querySelector(id);
      if (el) el.addEventListener('change', function () { filters[key] = el.value; renderBills(box); });
    };
    bindSel('#f-type', 'type'); bindSel('#f-acc', 'accountId'); bindSel('#f-sort', 'sortKey');
    // 分类两级联动：一级变化→二级列出子类；二级变化→按二级筛选
    const cat1 = box.querySelector('#f-cat1');
    if (cat1) cat1.addEventListener('change', function () {
      filters.catId = cat1.value;
      renderBills(box);
    });
    const cat2 = box.querySelector('#f-cat2');
    if (cat2) cat2.addEventListener('change', function () {
      filters.catId = cat2.value || cat1.value;
      renderBills(box);
    });
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
      row.addEventListener('click', function (e) {
        if (e.target.closest('.yw-bulk')) return; // 勾选批量框不打开编辑
        // 点「已同步」标签直达词条/美食记录（打通记账→词条动线）
        const syncBtn = e.target.closest('[data-item-open]');
        if (syncBtn) {
          e.stopPropagation();
          if (window.Views && window.Views.openItemDetail) {
            window.Views.openItemDetail(syncBtn.getAttribute('data-item-open'));
          }
          return;
        }
        const foodBtn = e.target.closest('[data-food-open]');
        if (foodBtn) {
          e.stopPropagation();
          // openFoodEditor(dateStr, rec)：第二个参数是记录对象（不是 id）
          const rec = ((S.getDB().food) || []).find(function (f) {
            return f.id === foodBtn.getAttribute('data-food-open');
          });
          if (rec && window.FoodView && window.FoodView.openFoodEditor) {
            window.FoodView.openFoodEditor(rec.date, rec);
          }
          return;
        }
        const bill = (wallet.bills || []).find(function (b) { return b.id === row.getAttribute('data-bill'); });
        if (bill) openBillForm(bill);
      });
    });
  }

  // 月份导航标签（跟随筛选月；空=本月）
  function monthNavLabel() {
    const m = filters.month || nowMonth();
    return m.slice(0, 4) + ' 年 ' + Number(m.slice(5, 7)) + ' 月';
  }
  function shiftMonth(delta) {
    const base = filters.month || nowMonth();
    const d = new Date(Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1 + delta, 1);
    filters.month = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    filters.date = '';
    filters.range = 'all';
    renderBills(document.getElementById('wallet-body'));
  }

  // 日期分组：今天/昨天/具体日期，组头带当日小计；批量模式组头可全选当天
  function billsGroupedHTML(list, bulkMode) {
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
        (bulkMode ? '<label class="yw-day-check"><input type="checkbox" class="day-check" data-day="' + esc(d) + '">全选当天</label>' : '') +
        '<span class="yw-day-label">' + esc(label) + '</span>' +
        '<span class="muted small">' + esc(full) + '</span>' +
        '<div class="flex1"></div>' +
        (exp ? '<span class="yw-day-sum out">支 ' + money(exp) + '</span>' : '') +
        (inc ? '<span class="yw-day-sum in">收 ' + money(inc) + '</span>' : '') +
        '</div>' +
        '<div class="yw-bill-list">' + rows.map(function (b) { return billRowHTML(b, bulkMode); }).join('') + '</div>' +
        '</div>';
    }).join('');
  }

  // 统一风格的流水行：图标圆底 + 分类名/备注 + 账户·日期，右侧金额红绿
  // bulkMode：批量模式下显示勾选框（平时不显示）
  function billRowHTML(b, bulkMode) {
    const linked = b.itemId ? (S.getDB().items || []).find(function (i) { return i.id === b.itemId; }) : null;
    const foodRec = b.foodId ? (S.getDB().food || []).find(function (f) { return f.id === b.foodId; }) : null;
    const sign = b.type === 'income' ? '+' : b.type === 'transfer' ? '→' : '-';
    const amtCls = b.type === 'income' ? 'yw-amt-in' : 'yw-amt-out';
    const iconId = b.type === 'transfer' ? 'color_ic_transfer_accounts' : (b.subCatId || b.catId);
    return '<div class="yw-bill-row" data-bill="' + esc(b.id) + '">' +
      (bulkMode ? '<label class="yw-bulk"><input type="checkbox" class="bulk-row" data-bulk="' + esc(b.id) + '"></label>' : '') +
      '<div class="yw-bill-ic">' + catIconHTML(iconId, 24) + '</div>' +
      '<div class="yw-bill-main">' +
      '<div class="yw-bill-title">' + esc(b.type === 'transfer' ? '转账' : catLabel(b.subCatId || b.catId)) +
      (b.note ? '<span class="yw-bill-note">' + esc(b.note) + '</span>' : '') + '</div>' +
      '<div class="yw-bill-meta muted small">' + esc(b.date) + (b.time ? ' ' + esc(b.time) : '') +
      (b.accountName || accountName(b.accountId) ? ' · ' + esc(b.accountName || accountName(b.accountId)) : '') +
      (b.type === 'transfer' && b.toAccountId ? ' → ' + esc(accountName(b.toAccountId)) : '') +
      (linked ? ' <button class="yw-sync-tag" data-item-open="' + esc(linked.id) + '" title="点击查看词条">' + UI.icon('link', 10) + '已同步' + domainLabel(linked.kind) + '</button>' : '') +
      (foodRec ? ' <button class="yw-sync-tag" data-food-open="' + esc(foodRec.id) + '" title="点击查看美食记录">' + UI.icon('utensils', 10) + '已同步美食日历</button>' : '') +
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
      '<input type="time" id="yw-time" value="' + esc(bill ? (bill.time || '') : '') + '" title="时间（可选，同日多笔排序更准）">' +
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

      '<div class="yw-tpl-row" id="yw-tpl-row"></div>' +
      (bill && (bill.itemId || bill.foodId) && !bill.syncOff
        ? '<div class="yw-unlink-row"><span class="muted small">' + UI.icon('link', 12) + ' 已同步到词条/美食，修改会自动跟随</span>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="yw-unlink">解除关联</button></div>'
        : '') +
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
        (editing ? '' : '<button class="btn btn-ghost" data-x="more">记一笔并继续</button>') +
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
          // 最近使用过的子类排前（记账提速）
          const rec = recentCats();
          const subs = (parent ? (parent.children || []).slice() : []);
          subs.sort(function (a, b) {
            const ia = rec.indexOf(a.id), ib = rec.indexOf(b.id);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
          });
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

        // 模板账单：常用固定开支一键填充（房租/话费等），可把当前表单存为模板
        const tplRow = w.querySelector('#yw-tpl-row');
        function renderTemplates() {
          const tpls = ((S.getDB().wallet || {}).templates) || [];
          tplRow.innerHTML = tpls.length
            ? '<span class="muted small">模板：</span>' + tpls.map(function (t) {
              return '<span class="tag yw-tpl" data-tpl="' + esc(t.id) + '" title="点击填充；点 × 删除">' +
                esc(t.name) + '<button class="chip-del" data-tpl-del="' + esc(t.id) + '">×</button></span>';
            }).join('') + '<button type="button" class="btn btn-ghost btn-sm" id="yw-tpl-save">存为模板</button>'
            : '<button type="button" class="btn btn-ghost btn-sm" id="yw-tpl-save">' + UI.icon('bookmark-plus', 14) + ' 存为模板（如房租/话费，下次一键填充）</button>';
          tplRow.querySelectorAll('[data-tpl]').forEach(function (el) {
            el.addEventListener('click', function (e) {
              if (e.target.closest('[data-tpl-del]')) return;
              const t = (((S.getDB().wallet || {}).templates) || []).find(function (x) { return x.id === el.getAttribute('data-tpl'); });
              if (!t) return;
              type = t.type || 'expense';
              w.querySelectorAll('[data-bft]').forEach(function (x) {
                x.classList.toggle('on', x.getAttribute('data-bft') === type);
              });
              curParent = t.catId || '';
              curSub = t.subCatId || '';
              renderCatsBox();
              amtInput.value = t.amount != null ? String(t.amount) : '';
              w.querySelector('#yw-note').value = t.note || '';
              if (t.accountId) w.querySelector('#yw-acc').value = t.accountId;
              syncAmtCN();
              UI.toast('已填充模板「' + t.name + '」', 'success');
            });
          });
          tplRow.querySelectorAll('[data-tpl-del]').forEach(function (el) {
            el.addEventListener('click', async function (e) {
              e.stopPropagation();
              if (await UI.confirmDialog('删除模板', '删除该模板？')) {
                await S.removeBillTemplate(el.getAttribute('data-tpl-del'));
                renderTemplates();
              }
            });
          });
          const saveTpl = tplRow.querySelector('#yw-tpl-save');
          if (saveTpl) saveTpl.addEventListener('click', async function () {
            const name = (w.querySelector('#yw-note').value.trim() || '模板') + ' ' + (amtInput.value || '');
            await S.saveBillTemplate({
              id: U.uid(), name: name.trim(), type: type,
              catId: curParent, subCatId: curSub,
              amount: Number(amtInput.value) || 0,
              note: w.querySelector('#yw-note').value.trim(),
              accountId: w.querySelector('#yw-acc').value
            });
            renderTemplates();
            UI.toast('已存为模板', 'success');
          });
        }
        renderTemplates();

        // 解除关联：手动断开词条同步（之后编辑不再自动重建）
        const unlinkBtn = w.querySelector('#yw-unlink');
        if (unlinkBtn) unlinkBtn.addEventListener('click', async function () {
          if (!bill) return;
          if (await UI.confirmDialog('解除关联', '解除这笔账单与词条/美食的同步关联？（词条本身保留）')) {
            await S.unlinkBillSync(bill.id);
            close();
            UI.toast('已解除关联', 'success');
            window.App.refresh();
          }
        });

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
        let saving = false;
        async function doSave(keepOpen) {
          if (saving) return;
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
            id: (bill && !keepOpen) ? bill.id : U.uid(),
            type: type, amount: amount, date: date,
            time: w.querySelector('#yw-time') ? w.querySelector('#yw-time').value : '',
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
          if (type === 'transfer' && rec.accountId === rec.toAccountId) {
            UI.toast('转出与转入账户不能相同', 'error'); return;
          }
          saving = true;
          try {
            await S.saveBill(rec);
            const synced = rec.itemId ? (S.getDB().items || []).find(function (i) { return i.id === rec.itemId; }) : null;
            if (curSub || curParent) rememberRecentCat(curSub || curParent); // 记录最近使用分类
            if (keepOpen) {
              // 连续记账：保留分类/账户/日期，清金额备注，聚焦金额
              amtInput.value = '';
              w.querySelector('#yw-note').value = '';
              syncAmtCN();
              amtInput.focus();
              UI.toast('已记一笔' + (synced ? '，已同步到「' + domainLabel(synced.kind) + '」' : '') + '，继续下一笔', 'success');
              window.App.refresh();
            } else {
              close();
              UI.toast(editing ? '已保存' : '记账成功' + (synced ? '，已同步到「' + domainLabel(synced.kind) + '」' : ''), 'success');
              window.App.refresh();
            }
          } catch (e) {
            UI.toast(e.message || '保存失败', 'error');
          } finally {
            saving = false;
          }
        }
        w.querySelector('[data-x=s]').addEventListener('click', function () { doSave(false); });
        const moreBtn = w.querySelector('[data-x=more]');
        if (moreBtn) moreBtn.addEventListener('click', function () { doSave(true); });
        // 快捷键：Enter=记一笔，Esc=关闭（输入法组词中不拦截）
        w.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { close(); return; }
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            doSave(false);
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
        // 对账：最近一次余额快照 vs 当前余额，差额一眼可见（建议：主动发现错账）
        const snaps = (wallet.balances || []).filter(function (r) { return r.accountId === a.id; })
          .sort(function (x, y) { return (y.date || '').localeCompare(x.date || ''); });
        const snap = snaps[0];
        const diff = snap ? Math.round(((Number(a.balance) || 0) - (Number(snap.balance) || 0)) * 100) / 100 : null;
        return '<div class="item-card acc-card-w">' +
          '<div class="item-info"><div class="item-name">' + UI.icon(a.icon || 'wallet', 16) + ' ' + esc(a.name) + '</div>' +
          '<div class="item-meta">' + money(a.balance) + (a.note ? ' · ' + esc(a.note) : '') + '</div>' +
          (snap ? '<div class="item-meta muted small">快照 ' + esc(snap.date) + ' ' + money(snap.balance) +
            ' · 差 ' + (diff === 0 ? '0' : money(diff)) + '</div>' : '') +
          '</div>' +
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
        ? (function () {
          // 按日期分组：同一天多个账户的记录归一组（多账户快照）
          const byDate = {};
          const order = [];
          records.forEach(function (r) {
            const d = r.date || '';
            if (!byDate[d]) { byDate[d] = []; order.push(d); }
            byDate[d].push(r);
          });
          return order.map(function (d) {
            return '<div class="yw-bal-group"><div class="yw-day-label">' + esc(d) + '</div>' +
              byDate[d].map(function (r) {
                return '<div class="mini-row"><span class="flex1">' + esc(accountName(r.accountId) || '账户') + '</span>' +
                  '<strong>' + money(r.balance) + '</strong>' +
                  (r.note ? '<span class="muted small">' + esc(r.note) + '</span>' : '') +
                  '<button class="btn btn-ghost btn-sm" data-bal-del="' + esc(r.id) + '">删除</button></div>';
              }).join('') + '</div>';
          }).join('');
        })()
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

  // 记余额（v1.1.2）：一次记录多个账户的余额（留空跳过该账户），同批次同日期
  function openBalanceForm() {
    const accs = ((S.getDB().wallet || {}).accounts) || [];
    if (!accs.length) { UI.toast('请先添加账户', 'error'); return; }
    UI.modal({
      title: '记余额（可同时记录多个账户）', width: 520,
      bodyHTML: '<div class="form-grid">' +
        '<label class="f-full"><span class="f-label">日期</span><input type="date" id="bf-date" value="' + today() + '"></label>' +
        accs.map(function (a) {
          return '<label><span class="f-label">' + esc(a.name) + '</span>' +
            '<input type="number" step="0.01" data-bal-acc="' + esc(a.id) + '" placeholder="留空=不记" value="' + esc(a.balance) + '"></label>';
        }).join('') +
        '<label class="f-full"><span class="f-label">备注</span><input id="bf-note" placeholder="如：对账 / 发薪后"></label></div>' +
        '<p class="muted small">默认填入当前余额，只改有变化的即可；留空的账户本次不记录。</p>',
      footerHTML: '<button class="btn btn-ghost" data-x="c">取消</button><button class="btn btn-primary" data-x="s">保存</button>',
      onMount: function (w, close) {
        w.querySelector('[data-x=c]').addEventListener('click', close);
        w.querySelector('[data-x=s]').addEventListener('click', async function () {
          const date = w.querySelector('#bf-date').value;
          const note = w.querySelector('#bf-note').value.trim();
          const recs = [];
          w.querySelectorAll('[data-bal-acc]').forEach(function (el) {
            const raw = el.value.trim();
            if (raw === '') return; // 留空不记
            recs.push({
              id: U.uid(), date: date, accountId: el.getAttribute('data-bal-acc'),
              balance: Number(raw) || 0, note: note,
              createdAt: new Date().toISOString()
            });
          });
          if (!recs.length) { UI.toast('至少填写一个账户的余额', 'error'); return; }
          await S.saveBalanceRecords(recs);
          close();
          UI.toast('已记录 ' + recs.length + ' 个账户的余额', 'success');
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
            // 允许负余额（信用卡欠款场景）
            balance: Number(w.querySelector('#af-bal').value) || 0,
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
      '<p class="muted small">支持：支付宝账单 CSV、微信支付账单 CSV、通用模板 CSV、其他记账 App 导出的 JSON/CSV（GBK/UTF-8 自动识别）。导入前可预览识别结果，重复账单默认跳过。</p>' +
      '<div class="form-grid" style="margin-top:8px">' +
      '<label class="f-full"><span class="f-label">或直接粘贴账单文本（如从支付宝/微信复制的多行记录）</span>' +
      '<textarea id="paste-bills" rows="3" class="search-input" placeholder="例：2026-11-01 支出 23.5 午饭 / 午饭 23.5（缺日期按今天）"></textarea></label>' +
      '</div><div class="btn-row"><button class="btn btn-ghost btn-sm" id="btn-paste-parse">' + UI.icon('clipboard', 14) + ' 识别粘贴内容</button></div>' +
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
    const pasteBtn = box.querySelector('#btn-paste-parse');
    if (pasteBtn) pasteBtn.addEventListener('click', function () {
      const text = box.querySelector('#paste-bills').value.trim();
      if (!text) { UI.toast('请先粘贴账单文本', 'error'); return; }
      parseAndPreview(box, text, '粘贴导入');
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
    // 按当前筛选导出（日期/分类/类型），无筛选=全量
    const q = ['acc=' + encodeURIComponent(S.accId())];
    if (filters.date) { q.push('from=' + filters.date); q.push('to=' + filters.date); }
    else if (filters.month) {
      q.push('from=' + filters.month + '-01');
      const d = new Date(Number(filters.month.slice(0, 4)), Number(filters.month.slice(5, 7)), 0);
      q.push('to=' + filters.month + '-' + String(d.getDate()).padStart(2, '0'));
    } else if (filters.range === 'year') {
      q.push('from=' + today().slice(0, 4) + '-01-01');
    }
    if (filters.catId) q.push('catId=' + encodeURIComponent(filters.catId));
    if (filters.type) q.push('type=' + filters.type);
    fetch('/api/export/bills?' + q.join('&')).then(function (r) {
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

  // 编码探测：UTF-8 严格解码失败 → 回退 GBK（支付宝/网银账单导出多为 GBK，强制 UTF-8 会整文件乱码）
  function decodeFileText(buf) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      try {
        return new TextDecoder('gbk').decode(buf);
      } catch (e2) {
        return new TextDecoder('utf-8').decode(buf);
      }
    }
  }

  function handleImportFile(file, box) {
    const reader = new FileReader();
    reader.onload = async function () {
      const text = decodeFileText(new Uint8Array(reader.result));
      await parseAndPreview(box, text, file.name);
    };
    reader.readAsArrayBuffer(file);
  }

  // 文件与粘贴文本共用：解析 → 预览
  async function parseAndPreview(box, text, filename) {
    const preview = box.querySelector('#import-preview');
    preview.innerHTML = '<div class="muted">正在识别…</div>';
    try {
      const r = await fetch('/api/import/parse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename || 'pasted.txt', text: text })
      });
      const out = await r.json();
      if (!out.ok) throw new Error(out.error || '解析失败');
      renderImportPreview(preview, out, filename || '粘贴导入');
    } catch (e) {
      preview.innerHTML = '<div class="tag tag-warn">识别失败：' + esc(e.message) + '</div>';
    }
  }

  function renderImportPreview(preview, out, filename) {
    const fmtName = {
      alipay_csv: '支付宝账单', wechat_csv: '微信支付账单', generic_csv: '通用/模板 CSV',
      app_json: '记账 App 备份', pasted_text: '粘贴文本', unknown: '未识别格式'
    }[out.format] || out.format;
    const bills = out.bills || [];
    // 去重：服务端标记优先（build_import_plan），前端兜底再查一次已有账单
    const existing = ((S.getDB().wallet || {}).bills) || [];
    bills.forEach(function (b) {
      if (b.dup) return;
      b.dup = existing.some(function (e) {
        return e.date === b.date && Math.abs(Number(e.amount) - Number(b.amount)) < 0.005 &&
          e.type === b.type && (!b.note || !e.note || e.note.trim() === String(b.note || '').trim());
      });
    });
    const dups = bills.filter(function (b) { return b.dup; });
    const noTo = bills.filter(function (b) { return b.type === 'transfer' && !b.toAccountName && !b.toAccountId; });
    const PREVIEW_N = 100;
    const shown = bills.slice(0, PREVIEW_N);
    const rest = bills.length - shown.length;

    preview.innerHTML =
      '<div class="import-preview-box">' +
      '<div class="tag">格式：' + esc(fmtName) + '</div> ' +
      '<div class="tag">识别 ' + bills.length + ' 笔</div> ' +
      (dups.length ? '<div class="tag tag-warn">疑似重复 ' + dups.length + ' 笔（默认不导入）</div> ' : '') +
      (noTo.length ? '<div class="tag tag-warn">' + noTo.length + ' 笔转账缺转入账户（将跳过）</div> ' : '') +
      ((out.skipped || []).length ? '<div class="tag tag-warn">解析跳过 ' + out.skipped.length + ' 笔</div>' : '') +
      ((out.warnings || []).map(function (m) { return '<div class="muted small">' + esc(m) + '</div>'; }).join('')) +
      '<div class="btn-row" style="margin-top:8px">' +
      '<button class="btn btn-ghost btn-sm" id="imp-sel-all">全选</button>' +
      '<button class="btn btn-ghost btn-sm" id="imp-sel-none">全不选</button></div>' +
      '<div class="mini-table" style="max-height:320px;overflow:auto;margin-top:6px">' +
      shown.map(function (b, i) {
        return '<div class="mini-row' + (b.dup ? ' imp-dup' : '') + '">' +
          '<label class="chip-check"><input type="checkbox" class="imp-row" data-i="' + i + '"' +
          (b.dup ? '' : ' checked') + '></label>' +
          '<span class="flex1">' + esc(b.date) + ' ' + esc(b.note || b.catName || '') + '</span>' +
          (b.subCatName || b.catName ? '<span class="tag">' + esc(b.subCatName || b.catName) + '</span>' : '') +
          '<span>' + esc(typeLabel(b.type)) + ' ' + money(b.amount) + '</span>' +
          (b.dup ? '<span class="tag tag-warn">重复</span>' : '') +
          (b.type === 'transfer' && !b.toAccountName ? '<span class="tag tag-warn">缺转入</span>' : '') +
          '</div>';
      }).join('') +
      (rest > 0 ? '<div class="mini-row muted small">… 还有 ' + rest + ' 笔未逐条预览，将默认导入（可用上方按钮统一调整已预览部分）</div>' : '') +
      '</div>' +
      '<div class="btn-row" style="margin-top:12px">' +
      '<button class="btn btn-primary" id="imp-commit">导入选中账单</button>' +
      '<button class="btn btn-ghost" id="imp-cancel">取消</button></div></div>';

    preview.querySelector('#imp-cancel').addEventListener('click', function () { preview.innerHTML = ''; });
    preview.querySelector('#imp-sel-all').addEventListener('click', function () {
      preview.querySelectorAll('.imp-row').forEach(function (c) { c.checked = true; });
    });
    preview.querySelector('#imp-sel-none').addEventListener('click', function () {
      preview.querySelectorAll('.imp-row').forEach(function (c) { c.checked = false; });
    });
    preview.querySelector('#imp-commit').addEventListener('click', async function () {
      // 选中集合 = 已预览勾选部分 + 未预览部分默认全收（排除重复/缺转入的）
      const picked = [];
      preview.querySelectorAll('.imp-row').forEach(function (c) {
        if (c.checked) picked.push(shown[Number(c.getAttribute('data-i'))]);
      });
      if (rest > 0) {
        bills.slice(PREVIEW_N).forEach(function (b) {
          if (!b.dup && !(b.type === 'transfer' && !b.toAccountName && !b.toAccountId)) picked.push(b);
        });
      }
      const rows = picked.filter(function (b) {
        return b && !b.dup && !(b.type === 'transfer' && !b.toAccountName && !b.toAccountId);
      });
      if (!rows.length) { UI.toast('没有可导入的账单（全被勾掉或都是重复）', 'error'); return; }

      // 标签列 → 入个人标签库并关联
      const tagLib = (S.getDB().wallet.tags || []).slice();
      function tagIdOf(name) {
        let t = tagLib.find(function (x) { return x.name === name; });
        if (!t) { t = { id: U.uid(), name: name }; tagLib.push(t); }
        return t.id;
      }
      const recs = rows.map(function (b) {
        const cat = matchCat(b.catName, b.subCatName, b.type) || {};
        const tagNames = (b.tagsName && b.tagsName.length ? b.tagsName : (b.tags || []))
          .map(function (t) { return String(t || '').trim(); }).filter(Boolean);
        return {
          id: U.uid(), type: b.type || 'expense',
          amount: Math.abs(Number(b.amount) || 0),
          date: b.date, time: b.time || '',
          catId: cat.catId || '', subCatId: cat.subCatId || '',
          // 匹配不上账户 = 不区分账户（不动余额），不再强行塞进某个账户
          accountId: matchAccount(b.accountName),
          toAccountId: b.type === 'transfer' ? matchAccount(b.toAccountName) : '',
          note: b.note || '', tagIds: tagNames.map(tagIdOf),
          accountName: b.accountName || '',
          source: 'import:' + out.format,
          createdAt: new Date().toISOString()
        };
      });

      const btn = preview.querySelector('#imp-commit');
      btn.disabled = true;
      btn.textContent = '导入中…';
      const done = [];
      try {
        await S.saveBills(recs); // 批量入库（统一持久化）+ 自动词条/美食同步
        recs.forEach(function (r) { done.push(r.id); });
      } catch (e) {
        UI.toast('导入中断：' + (e.message || '保存失败') + '，已写入批次可撤销', 'error');
      }
      // 即使部分失败也记批次（可整批撤销），并把标签库落盘
      const dbNow = S.getDB();
      dbNow.wallet.tags = tagLib;
      await S.persist('wallet').catch(function () {});
      await S.saveImportBatch({
        id: U.uid(), name: filename, format: out.format,
        billIds: done, createdAt: new Date().toISOString()
      });
      UI.toast('导入完成 ' + done.length + ' 笔' + (rows.length > done.length ? '（' + (rows.length - done.length) + ' 笔失败）' : ''), 'success');
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
    // 匹配不上 = 不区分账户（不动余额）；不再兜底塞进某账户污染余额
    if (!name) return '';
    const n = String(name);
    const hit = accs.find(function (a) { return n.indexOf(a.name) >= 0 || a.name.indexOf(n) >= 0; });
    return hit ? hit.id : '';
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

  /* 统计下钻入口（我的统计点图表 → 跳钱袋流水并带上筛选） */
  function jumpTo(opts) {
    opts = opts || {};
    filters.catId = opts.catId || '';
    filters.type = opts.type || '';
    filters.q = opts.q || '';
    filters.accountId = '';
    filters.date = opts.date || '';
    filters.month = opts.month || '';
    if (filters.date || filters.month) {
      filters.range = 'all';
    } else if (opts.range) {
      filters.range = opts.range;
    }
    tab = 'bills';
    window.App.go('wallet');
  }

  return {
    render: render, openBillForm: openBillForm, renderBills: renderBills,
    mountImportUI: mountImportUI, catTreeCompactHTML: catTreeCompactHTML,
    downloadTemplate: downloadTemplate, jumpTo: jumpTo
  };
})();
