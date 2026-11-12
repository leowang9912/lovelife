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
  let drillSource = ''; // 统计下钻来源条（A13）：「来自统计：〈周期〉 · 分类X」，可关闭/点击清除筛选

  /* 账号切换重置（A3）：清筛选/搜索/排序状态回默认，防上一账号状态残留 */
  function resetState() {
    filters.range = 'month'; filters.catId = ''; filters.accountId = ''; filters.type = ''; filters.q = '';
    filters.date = ''; filters.month = '';
    filters.sortKey = 'date'; filters.sortDir = 'desc';
    bulkMode = false;
    drillSource = '';
    tab = 'bills';
  }

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
  /* v1.1.9：分类屏蔽——记账表单不显示（导入/已有账单不受影响，历史照常展示） */
  function isWcatHidden(id) {
    return ((S.getDB().settings || {}).hiddenWcats || []).indexOf(id) >= 0;
  }
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
  // 键加账号前缀（乙4）：多账号各记各的，不再跨账号共享
  function recentCatKey() { return (S.accId() ? S.accId() + ':' : '') + 'll-recent-cats'; }
  function recentCats() {
    try { return JSON.parse(localStorage.getItem(recentCatKey()) || '[]'); } catch (e) { return []; }
  }
  function rememberRecentCat(id) {
    if (!id) return;
    const list = recentCats().filter(function (x) { return x !== id; });
    list.unshift(id);
    try { localStorage.setItem(recentCatKey(), JSON.stringify(list.slice(0, 8))); } catch (e) {}
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
  // 本周区间（周一为一周开始，与「我的统计」statPeriod 同口径）：统计下钻带周期用（A13）
  function weekInterval() {
    const now = new Date();
    const dow = (now.getDay() + 6) % 7;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    return { startStr: U.todayStr(start), endStr: U.todayStr(end) };
  }
  function inRange(b) {
    const d = b.date || '';
    if (filters.range === 'all') return true;
    if (filters.range === 'month') return monthKey(d) === nowMonth();
    if (filters.range === 'year') return d.slice(0, 4) === today().slice(0, 4);
    if (filters.range === 'week') {
      const w = weekInterval();
      return !!d && d >= w.startStr && d < w.endStr;
    }
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
      '<div class="page-head"><h2>我的钱袋</h2><div class="page-actions">' +
      '<button class="btn btn-ghost" id="btn-goto-io">' + UI.icon('file-up', 14) + ' 导入 / 导出</button>' +
      '<button class="btn btn-ghost" id="btn-goto-stats">' + UI.icon('chart-column', 14) + ' 查看统计</button>' +
      '<button class="btn btn-primary" id="btn-add-bill">' + UI.icon('plus', 14) + ' 记一笔</button>' +
      '</div></div>' +
      '<div class="settings-tabs" id="wallet-tabs">' + TABS.map(function (t) {
        return '<button type="button" class="stab-btn' + (tab === t.id ? ' on' : '') + '" data-wt="' + t.id + '">' +
          UI.icon(t.icon, 16) + ' ' + t.label + '</button>';
      }).join('') + '</div>' +
      '<div id="wallet-body"></div>';

    main.querySelector('#btn-add-bill').addEventListener('click', function () { openBillForm(null); });
    // 甲22 导入/导出入口：钱袋页直达设置 → 记账设置分组（账单导入导出挂在那）
    main.querySelector('#btn-goto-io').addEventListener('click', function () {
      window.App.go('settings');
      setTimeout(function () {
        const btn = document.querySelector('[data-stab-btn="bill"]');
        if (btn) btn.click();
        const sec = document.querySelector('.stab[data-stab="bill"]');
        if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    });
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
    if (!db) return; // 会话已停止（如删除当前账号）：防残留的防抖回调空指针
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

    // 头部汇总卡：标签跟随当前筛选范围（本周/本月/今年/全部/精确日期），不再误导
    const rangeLabel = filters.date ? filters.date
      : filters.month ? filters.month.replace('-', ' 年 ') + ' 月'
        : filters.range === 'week' ? '本周' : filters.range === 'year' ? '今年' : filters.range === 'all' ? '全部' : '本月';
    box.innerHTML =
      (drillSource
        ? '<div class="filter-bar drill-src"><span class="tag tag-on">' + UI.icon('filter', 12) + ' ' + esc(drillSource) + '</span>' +
        '<button class="btn btn-ghost btn-sm" id="f-clear-drill">清除筛选</button>' +
        '<button class="btn-icon" id="f-close-drill" title="关闭来源条">' + UI.icon('x', 14) + '</button></div>'
        : '') +
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
        : (function () {
          const hasFilter = !!(filters.q || filters.catId || filters.type || filters.accountId || filters.date || filters.month);
          // 空态卡化（丙3）：.empty-state.empty-card 统一结构（图标48 + 文案 + 引导按钮）
          return '<div class="empty-state empty-card"><div class="empty-icon">' + UI.icon('receipt', 48) + '</div>' +
            '<p>' + (hasFilter ? '没有符合筛选的结果' : '还没有记账记录') + '</p>' +
            (hasFilter
              ? '<button class="btn btn-ghost" id="f-clear-all">清除筛选</button>'
              : '<button class="btn btn-ghost" id="f-empty-add">' + UI.icon('plus', 14) + ' 记一笔</button>') +
            '</div>';
        })());

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
    // 空态引导按钮（丙3）：有筛选=清除筛选回默认视图；无筛选=记一笔
    const clearAll = box.querySelector('#f-clear-all');
    if (clearAll) clearAll.addEventListener('click', function () {
      filters.range = 'month'; filters.catId = ''; filters.accountId = ''; filters.type = ''; filters.q = '';
      filters.date = ''; filters.month = '';
      drillSource = '';
      renderBills(box);
    });
    const emptyAdd = box.querySelector('#f-empty-add');
    if (emptyAdd) emptyAdd.addEventListener('click', function () { openBillForm(null); });
    // 统计下钻来源条（A13）：点「清除筛选」清掉下钻筛选回默认；× 只收起来源条
    const clearDrill = box.querySelector('#f-clear-drill');
    if (clearDrill) clearDrill.addEventListener('click', function () {
      filters.catId = ''; filters.type = ''; filters.q = '';
      filters.date = ''; filters.month = '';
      filters.range = 'month';
      drillSource = '';
      renderBills(box);
    });
    const closeDrill = box.querySelector('#f-close-drill');
    if (closeDrill) closeDrill.addEventListener('click', function () {
      drillSource = '';
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
      (b.type === 'transfer' && (b.toAccountId || b.toAccountName) ? ' → ' + esc(b.toAccountName || accountName(b.toAccountId)) : '') +
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
    let tplOutsideFn = null; // 模板清单外侧收起监听（onClose 移除防泄漏）

    const body =
      '<div class="yw">' +
      // v1.1.9：类型切换挪到标题旁（headExtra）；本行=日期/时间/账户，左对齐
      '<div class="yw-top">' +
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
      onClose: function () {
        if (tplOutsideFn) { document.removeEventListener('click', tplOutsideFn); tplOutsideFn = null; }
      },
      // v1.1.9：支出/收入/转账挪到标题旁（headExtra），告别折行/独占一行
      headExtra: '<div class="seg-toggle yw-type">' +
        [['expense', '支出'], ['income', '收入'], ['transfer', '转账']].map(function (t) {
          return '<button type="button" class="seg-btn' + (type === t[0] ? ' on' : '') + '" data-bft="' + t[0] + '">' + t[1] + '</button>';
        }).join('') + '</div>',
      bodyHTML: body,
      footerHTML: (editing ? '<button class="btn btn-danger" id="yw-del">删除</button>' : '') +
        '<div class="flex1"></div>' +
        '<button class="btn btn-ghost" data-x="c">取消</button>' +
        (editing ? '' : '<button class="btn btn-ghost" data-x="more">记一笔并继续</button>') +
        '<button class="btn btn-primary btn-lg" data-x="s">' + (editing ? '保存' : '记一笔') + '</button>',
      onMount: function (w, close) {
        function renderCatsBox() {
          const box = w.querySelector('#yw-cats');
          // v1.1.9 分类屏蔽：记账表单不显示被屏蔽分类（历史账单/导入不受影响）；
          // 稽核修复：编辑已屏蔽分类的账单时该分类仍显示（否则误以为被改成第一个分类）
          const list = catTree(type === 'income' ? 'income' : 'expense').filter(function (c) {
            return !isWcatHidden(c.id) || c.id === curParent;
          });
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
          const subs = (parent ? (parent.children || []).slice() : []).filter(function (ch) {
            return !isWcatHidden(ch.id) || ch.id === curSub;
          });
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

        // 模板账单（v1.1.9 方案 A）：「套用模板 ▾」下拉清单（名称·金额·分类·备注一眼可辨），
        // 已套用显示摘要 chip（× 移除）；「存为模板」默认名=分类 · ¥金额（可读）
        const tplRow = w.querySelector('#yw-tpl-row');
        let appliedTplId = '';
        function catNameOfTpl(t) {
          const kinds = ['expense', 'income'];
          for (let k = 0; k < kinds.length; k++) {
            const list = catTree(kinds[k]);
            for (let i = 0; i < list.length; i++) {
              const ch = list[i].children || [];
              for (let j = 0; j < ch.length; j++) if (ch[j].id === t.subCatId) return ch[j].name;
              if (list[i].id === (t.subCatId || t.catId)) return list[i].name;
            }
          }
          return '';
        }
        function tplSummary(t) {
          return (t.name || '模板') + (catNameOfTpl(t) ? ' · ' + catNameOfTpl(t) : '') + ' · ' + U.formatMoney(t.amount || 0);
        }
        function applyTpl(t) {
          if (!t) return;
          appliedTplId = t.id;
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
          renderTemplates();
          UI.toast('已填充模板「' + t.name + '」', 'success');
        }
        function renderTemplates() {
          const tpls = ((S.getDB().wallet || {}).templates) || [];
          const applied = tpls.filter(function (t) { return t.id === appliedTplId; })[0];
          tplRow.innerHTML =
            (tpls.length ? '<button type="button" class="btn btn-ghost btn-sm" id="yw-tpl-pick">' +
              UI.icon('bookmark', 14) + ' 套用模板 ▾</button>' : '') +
            (applied ? '<span class="tag yw-tpl-on">' + esc(tplSummary(applied)) +
              '<button type="button" class="chip-del" id="yw-tpl-clear" title="移除套用">×</button></span>' : '') +
            '<button type="button" class="btn btn-ghost btn-sm" id="yw-tpl-save">' + UI.icon('bookmark-plus', 14) +
            (tpls.length ? ' 存为模板' : ' 存为模板（如房租/话费，下次一键填充）') + '</button>' +
            '<div class="yw-tpl-pop" id="yw-tpl-pop" hidden>' + tpls.map(function (t) {
              return '<div class="yw-tpl-item" data-tpl="' + esc(t.id) + '">' +
                '<div class="yw-tpl-item-main">' +
                '<div class="yw-tpl-item-name">' + esc(t.name || '未命名模板') + '</div>' +
                '<div class="yw-tpl-item-sub">' + esc([catNameOfTpl(t), t.note ? t.note : ''].filter(Boolean).join(' · ') || '—') + '</div>' +
                '</div><span class="yw-tpl-item-amt">' + U.formatMoney(t.amount || 0) + '</span>' +
                '<button type="button" class="btn-icon yw-tpl-item-del" data-tpl-del="' + esc(t.id) + '" title="删除模板">' +
                UI.icon('trash-2', 13) + '</button></div>';
            }).join('') + '</div>';
          const pick = tplRow.querySelector('#yw-tpl-pick');
          const pop = tplRow.querySelector('#yw-tpl-pop');
          if (pick && pop) {
            pick.addEventListener('click', function (e) {
              e.stopPropagation();
              pop.hidden = !pop.hidden;
            });
            pop.addEventListener('click', async function (e) {
              const del = e.target.closest ? e.target.closest('[data-tpl-del]') : null;
              if (del) {
                e.stopPropagation();
                if (await UI.confirmDialog('删除模板', '删除该模板？')) {
                  await S.removeBillTemplate(del.getAttribute('data-tpl-del'));
                  if (appliedTplId === del.getAttribute('data-tpl-del')) appliedTplId = '';
                  renderTemplates();
                }
                return;
              }
              const it = e.target.closest ? e.target.closest('[data-tpl]') : null;
              if (!it) return;
              const t = (((S.getDB().wallet || {}).templates) || []).filter(function (x) { return x.id === it.getAttribute('data-tpl'); })[0];
              pop.hidden = true;
              applyTpl(t);
            });
          }
          const clearBtn = tplRow.querySelector('#yw-tpl-clear');
          if (clearBtn) clearBtn.addEventListener('click', function () {
            appliedTplId = '';
            renderTemplates();
          });
          const saveTpl = tplRow.querySelector('#yw-tpl-save');
          if (saveTpl) saveTpl.addEventListener('click', async function () {
            // v1.1.9：默认名=「分类 · ¥金额」（可读，替代旧「备注+数字」模糊名）
            const catN = (function () {
              const list = catTree(type === 'income' ? 'income' : 'expense');
              for (let i = 0; i < list.length; i++) {
                const ch = list[i].children || [];
                for (let j = 0; j < ch.length; j++) if (ch[j].id === curSub) return ch[j].name;
                if (list[i].id === (curSub || curParent)) return list[i].name;
              }
              return '';
            })();
            const name = (catN ? catN + ' · ' : '') + U.formatMoney(Number(amtInput.value) || 0);
            const newId = U.uid();
            await S.saveBillTemplate({
              id: newId, name: name, type: type,
              catId: curParent, subCatId: curSub,
              amount: Number(amtInput.value) || 0,
              note: w.querySelector('#yw-note').value.trim(),
              accountId: w.querySelector('#yw-acc').value
            });
            appliedTplId = newId;
            renderTemplates();
            UI.toast('已存为模板「' + name + '」', 'success');
          });
        }
        renderTemplates();
        // 点外侧收起模板清单（稽核修复：onClose 必须移除，否则每次开弹窗泄漏一个 document 监听器）
        tplOutsideFn = function (e) {
          const pop = tplRow.querySelector('#yw-tpl-pop');
          if (!pop || pop.hidden) return;
          if (!pop.contains(e.target) && !(e.target.closest && e.target.closest('#yw-tpl-pick'))) pop.hidden = true;
        };
        document.addEventListener('click', tplOutsideFn);

        // 解除关联：手动断开词条同步（之后编辑不再自动重建）
        const unlinkBtn = w.querySelector('#yw-unlink');
        if (unlinkBtn) unlinkBtn.addEventListener('click', async function () {
          if (!bill) return;
          // 文案与行为一致（A6）：解除关联只解绑不删词条
          if (await UI.confirmDialog('解除关联', '解除后词条将保留，不再与账单同步')) {
            await S.unlinkBillSync(bill.id, true);
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
          const saveBtnEl = w.querySelector('[data-x=s]');
          const moreBtnEl = w.querySelector('[data-x=more]');
          UI.loadingBtn(saveBtnEl, true); // 丙4：保存中 loading
          if (moreBtnEl) UI.loadingBtn(moreBtnEl, true);
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
            UI.loadingBtn(saveBtnEl, false);
            if (moreBtnEl) UI.loadingBtn(moreBtnEl, false);
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
      '</div><div class="panel-body">' + ((wallet.accounts || []).length
        ? '<div class="acc-grid">' + (wallet.accounts || []).map(function (a) {
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
          // 该账户的余额记录历史（最近 3 条），体现"余额记录=各账户分别的余额"
          (snaps.length
            ? '<div class="acc-bal-hist">' + snaps.slice(0, 3).map(function (r) {
              return '<div class="acc-bal-line"><span class="flex1">' + esc(r.date || '') + '</span>' +
                '<span>' + money(r.balance) + '</span></div>';
            }).join('') + (snaps.length > 3 ? '<div class="acc-bal-line muted small">共 ' + snaps.length + ' 条记录</div>' : '') + '</div>'
            : '') +
          '</div>' +
          '<div class="detail-btn-row">' +
          '<button class="btn btn-ghost btn-sm" data-bal-add="' + esc(a.id) + '">记余额</button>' +
          '<button class="btn btn-ghost btn-sm" data-acc-edit="' + esc(a.id) + '">编辑</button>' +
          '<button class="btn btn-ghost btn-sm" data-acc-del="' + esc(a.id) + '">删除</button>' +
          '</div></div>';
        }).join('') + '</div>'
        // 空态卡化（丙3）：无账户时给添加引导
        : '<div class="empty-state empty-card"><div class="empty-icon">' + UI.icon('wallet', 48) + '</div>' +
        '<p>还没有账户</p><button class="btn btn-ghost" id="f-empty-add-acc">' + UI.icon('plus', 14) + ' 添加账户</button></div>') +
      '</div></div>' +

      '<div class="panel"><div class="panel-head">' + UI.icon('history', 16) + ' 余额记录' +
      '<div class="flex1"></div>' +
      '<button class="btn btn-primary btn-sm" id="btn-add-balance">' + UI.icon('plus', 14) + ' 记余额（全部账户）</button></div>' +
      '<div class="panel-body">' +
      '<p class="muted small">按账户分别记录某个时间点的余额（对账快照）。资产走势统计结合账单流水自动倒推每日余额，快照用于校准——见「我的统计 → 资产走势」。</p>' +
      (records.length
        ? (function () {
          // 按账户分组：每组=一个账户的余额历史（余额记录就是各账户分别的余额）
          const byAcc = {};
          const order = [];
          (wallet.accounts || []).forEach(function (a) {
            if (!byAcc[a.id]) { byAcc[a.id] = []; order.push(a.id); }
          });
          records.forEach(function (r) {
            const k = r.accountId || '_';
            if (!byAcc[k]) { byAcc[k] = []; order.push(k); }
            byAcc[k].push(r);
          });
          return order.filter(function (k) { return byAcc[k].length; }).map(function (k) {
            const acc = (wallet.accounts || []).find(function (a) { return a.id === k; });
            const head = acc
              ? UI.icon(acc.icon || 'wallet', 14) + ' ' + esc(acc.name) + ' <span class="muted small">当前 ' + money(acc.balance) + '</span>'
              : '其他记录';
            return '<div class="yw-bal-group"><div class="yw-day-label">' + head + '</div>' +
              byAcc[k].map(function (r) {
                return '<div class="mini-row"><span class="flex1">' + esc(r.date || '') + '</span>' +
                  '<strong>' + money(r.balance) + '</strong>' +
                  (r.note ? '<span class="muted small">' + esc(r.note) + '</span>' : '') +
                  '<button class="btn btn-ghost btn-sm" data-bal-del="' + esc(r.id) + '">删除</button></div>';
              }).join('') + '</div>';
          }).join('');
        })()
        // 空态卡化（丙3）：统一 empty-state empty-card 结构 + 引导操作
        : '<div class="empty-state empty-card"><div class="empty-icon">' + UI.icon('history', 48) + '</div>' +
        '<p>还没有余额记录</p><button class="btn btn-ghost" id="f-empty-add-bal">' + UI.icon('plus', 14) + ' 记余额</button></div>') +
      '</div></div>';

    box.querySelector('#btn-add-acc').addEventListener('click', function () { openAccountForm(null); });
    box.querySelector('#btn-transfer').addEventListener('click', openTransferForm);
    box.querySelector('#btn-add-balance').addEventListener('click', function () { openBalanceForm(); });
    // 空态引导按钮（丙3）
    const emptyAcc = box.querySelector('#f-empty-add-acc');
    if (emptyAcc) emptyAcc.addEventListener('click', function () { openAccountForm(null); });
    const emptyBal = box.querySelector('#f-empty-add-bal');
    if (emptyBal) emptyBal.addEventListener('click', function () { openBalanceForm(); });
    box.querySelectorAll('[data-bal-add]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        openBalanceForm(el.getAttribute('data-bal-add'));
      });
    });
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
  // onlyAccId（v1.1.3）：从账户卡进入时只记该账户的余额
  function openBalanceForm(onlyAccId) {
    let accs = ((S.getDB().wallet || {}).accounts) || [];
    if (!accs.length) { UI.toast('请先添加账户', 'error'); return; }
    if (onlyAccId) accs = accs.filter(function (a) { return a.id === onlyAccId; });
    if (!accs.length) { UI.toast('账户不存在', 'error'); return; }
    const single = !!onlyAccId;
    UI.modal({
      title: single ? '记余额 · ' + accs[0].name : '记余额（可同时记录多个账户）', width: single ? 420 : 520,
      bodyHTML: '<div class="form-grid">' +
        '<label class="f-full"><span class="f-label">日期</span><input type="date" id="bf-date" value="' + today() + '"></label>' +
        accs.map(function (a) {
          return '<label><span class="f-label">' + esc(a.name) + '</span>' +
            '<input type="number" step="0.01" data-bal-acc="' + esc(a.id) + '" placeholder="留空=不记" value="' + esc(a.balance) + '"></label>';
        }).join('') +
        '<label class="f-full"><span class="f-label">备注</span><input id="bf-note" placeholder="如：对账 / 发薪后"></label></div>' +
        '<p class="muted small">' + (single
          ? '记录该账户在这个时间点的余额（对账快照）。'
          : '分别记录各账户在这个时间点的余额（对账快照）。默认填入当前余额，只改有变化的即可；留空的账户本次不记录。') + '</p>',
      footerHTML: '<button class="btn btn-ghost" data-x="c">取消</button><button class="btn btn-primary" data-x="s">保存</button>',
      onMount: function (w, close) {
        w.querySelector('[data-x=c]').addEventListener('click', close);
        w.querySelector('[data-x=s]').addEventListener('click', async function () {
          const date = w.querySelector('#bf-date').value;
          const note = w.querySelector('#bf-note').value.trim();
          if (!date) { UI.toast('请选择日期', 'error'); return; }
          const recs = [];
          let bad = false;
          w.querySelectorAll('[data-bal-acc]').forEach(function (el) {
            const raw = el.value.trim();
            if (raw === '') return; // 留空不记
            const v = Number(raw);
            if (!isFinite(v)) { bad = true; return; } // 非法数字不静默记 0
            recs.push({
              id: U.uid(), date: date, accountId: el.getAttribute('data-bal-acc'),
              balance: Math.round(v * 100) / 100, note: note,
              createdAt: new Date().toISOString()
            });
          });
          if (bad) { UI.toast('余额必须是数字', 'error'); return; }
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
    // 按当前筛选导出（日期/分类/类型/账户/关键词），与流水列表当前视图同口径（甲7）；
    // month 未显式翻月时按当前显示月推 from/to，不再误导全量
    const count = filteredBills().length;
    UI.confirmDialog('导出账单', '将导出 ' + count + ' 笔（按当前筛选条件）').then(function (yes) {
      if (!yes) return;
      const q = ['acc=' + encodeURIComponent(S.accId())];
      const monthRange = function (m) {
        q.push('from=' + m + '-01');
        const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0);
        q.push('to=' + m + '-' + String(d.getDate()).padStart(2, '0'));
      };
      if (filters.date) { q.push('from=' + filters.date); q.push('to=' + filters.date); }
      else if (filters.month) monthRange(filters.month);
      else if (filters.range === 'month') monthRange(nowMonth());
      else if (filters.range === 'week') {
        const wk = weekInterval();
        q.push('from=' + wk.startStr);
        const end = new Date(wk.endStr);
        end.setDate(end.getDate() - 1); // weekInterval.endStr 为开区间，导出 to 含边界
        q.push('to=' + U.todayStr(end));
      } else if (filters.range === 'year') {
        q.push('from=' + today().slice(0, 4) + '-01-01');
        q.push('to=' + today().slice(0, 4) + '-12-31');
      }
      if (filters.catId) q.push('catId=' + encodeURIComponent(filters.catId));
      if (filters.type) q.push('type=' + filters.type);
      if (filters.accountId) q.push('accountId=' + encodeURIComponent(filters.accountId));
      if (filters.q) q.push('q=' + encodeURIComponent(filters.q));
      fetch('/api/export/bills?' + q.join('&')).then(function (r) {
        return r.blob();
      }).then(function (blob) {
        U.download(blob, 'lovelife-账单-' + today() + '.csv');
        UI.toast('账单已导出', 'success');
      }).catch(function () { UI.toast('导出失败', 'error'); });
    });
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
        // acc 必传：服务端按它取已有账单去重，漏传会拿 lastAccountId（可能是别的账号）比对
        body: JSON.stringify({ filename: filename || 'pasted.txt', text: text, acc: S.accId() })
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
    // 去重（甲6 收紧，与 bill_import.build_import_plan 同口径）：
    // 服务端标记优先，前端兜底再查一次已有账单——两侧备注都为空时须「日期+金额+类型+账户名」
    // 全同才算重复（防同价咖啡丢账）；任一侧有备注维持既有判重语义。
    const existing = ((S.getDB().wallet || {}).bills) || [];
    function acctKeyOf(x) {
      return String(x.accountName || (x.accountId ? accountName(x.accountId) : '') || '').trim() + '→' +
        String(x.toAccountName || (x.toAccountId ? accountName(x.toAccountId) : '') || '').trim();
    }
    bills.forEach(function (b) {
      if (b.dup) return;
      b.dup = existing.some(function (e) {
        if (e.date !== b.date || e.type !== b.type) return false;
        if (Math.abs(Number(e.amount) - Number(b.amount)) >= 0.005) return false;
        const bn = String(b.note || '').trim(), en = String(e.note || '').trim();
        if (!bn && !en) return acctKeyOf(b) === acctKeyOf(e);
        return bn === en || !bn || !en;
      });
    });
    const dups = bills.filter(function (b) { return b.dup; });
    // 非重复 = 主预览表（前 100 条逐条可勾，超出部分默认导入）；重复项集中到「查看重复」展开区逐条勾回
    const nonDupIdx = [];
    bills.forEach(function (b, i) { if (!b.dup) nonDupIdx.push(i); });
    const shownIdx = nonDupIdx.slice(0, 100);
    const tailIdx = nonDupIdx.slice(100);
    const rest = tailIdx.length;
    // 转账双侧账户任一缺失/未匹配/相同 → 整条跳过（P0-4），预览标注原因与「缺转入」同级
    const trSkip = bills.filter(function (b) { return !b.dup && transferSkipReason(b); });

    function rowHTML(i, checked, dupMark) {
      const b = bills[i];
      return '<div class="mini-row' + (dupMark ? ' imp-dup' : '') + '">' +
        '<label class="chip-check"><input type="checkbox" class="imp-row" data-i="' + i + '"' +
        (checked ? ' checked' : '') + '></label>' +
        '<span class="flex1">' + esc(b.date) + ' ' + esc(b.note || b.catName || '') + '</span>' +
        (b.subCatName || b.catName ? '<span class="tag">' + esc(b.subCatName || b.catName) + '</span>' : '') +
        '<span>' + esc(typeLabel(b.type)) + ' ' + money(b.amount) + '</span>' +
        (dupMark ? '<span class="tag tag-warn">重复</span>' : '') +
        (function () {
          const r = transferSkipReason(b);
          return r ? '<span class="tag tag-warn">' + esc(r) + '</span>' : '';
        })() +
        '</div>';
    }
    preview.innerHTML =
      '<div class="import-preview-box">' +
      '<div class="tag">格式：' + esc(fmtName) + '</div> ' +
      '<div class="tag">识别 ' + bills.length + ' 笔</div> ' +
      (dups.length ? '<div class="tag tag-warn">疑似重复 ' + dups.length + ' 笔（默认不导入）</div> ' : '') +
      (trSkip.length ? '<div class="tag tag-warn">' + trSkip.length + ' 笔转账账户缺失/未匹配（将跳过）</div> ' : '') +
      ((out.skipped || []).length ? '<div class="tag tag-warn">解析跳过 ' + out.skipped.length + ' 笔</div>' : '') +
      ((out.warnings || []).map(function (m) { return '<div class="muted small">' + esc(m) + '</div>'; }).join('')) +
      // 甲5：明示余额影响 + 可选「不动余额」（勾选后账单记为不区分账户，仅保留原账户名展示）
      '<div class="import-bal-hint muted small" style="margin-top:8px">' + UI.icon('wallet', 12) +
      ' 导入后将增减所选账户余额；勾选「本次导入不动余额」则记为不区分账户（保留原账户名展示，不改余额）。</div>' +
      '<label class="chip-check"><input type="checkbox" id="imp-no-bal"> 本次导入不动余额</label>' +
      '<div class="btn-row" style="margin-top:8px">' +
      '<button class="btn btn-ghost btn-sm" id="imp-sel-all">全选</button>' +
      '<button class="btn btn-ghost btn-sm" id="imp-sel-none">全不选</button></div>' +
      '<div class="mini-table" style="max-height:320px;overflow:auto;margin-top:6px">' +
      shownIdx.map(function (i) { return rowHTML(i, true, false); }).join('') +
      (rest > 0 ? '<div class="mini-row muted small">… 还有 ' + rest + ' 笔未逐条预览，将默认导入（可用上方按钮统一调整已预览部分）</div>' : '') +
      '</div>' +
      // 甲6：重复项收进展开区，逐条可勾回导入（预览外的重复也能恢复）
      (dups.length
        ? '<div class="imp-dup-box" style="margin-top:8px">' +
        '<button type="button" class="btn btn-ghost btn-sm" id="imp-dup-toggle">' +
        UI.icon('copy', 14) + ' 查看重复 ' + dups.length + ' 条（默认不导入，可勾选导入）</button>' +
        '<div class="mini-table" id="imp-dup-list" style="display:none;max-height:240px;overflow:auto;margin-top:6px">' +
        dups.map(function (b) { return rowHTML(bills.indexOf(b), false, true); }).join('') +
        '</div></div>'
        : '') +
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
    // 甲6：重复展开区收/放
    const dupToggle = preview.querySelector('#imp-dup-toggle');
    if (dupToggle) dupToggle.addEventListener('click', function () {
      const list = preview.querySelector('#imp-dup-list');
      const opening = list.style.display === 'none';
      list.style.display = opening ? '' : 'none';
      dupToggle.textContent = (opening ? '收起重复 ' : '查看重复 ') + dups.length + ' 条（默认不导入，可勾选导入）';
    });
    preview.querySelector('#imp-commit').addEventListener('click', async function () {
      // 选中集合 = 已勾选部分（含勾回的重复项）+ 未预览部分默认全收（转账账户缺失的仍排除）
      const picked = [];
      preview.querySelectorAll('.imp-row').forEach(function (c) {
        if (!c.checked) return;
        const b = bills[Number(c.getAttribute('data-i'))];
        if (b) picked.push(b);
      });
      if (rest > 0) {
        tailIdx.forEach(function (i) { picked.push(bills[i]); });
      }
      const rows = picked.filter(function (b) {
        return b && !transferSkipReason(b);
      });
      if (!rows.length) { UI.toast('没有可导入的账单（全被勾掉或都是重复）', 'error'); return; }
      // 甲5：勾选「本次导入不动余额」→ accountId 全部置 ''（不区分账户/不动余额），
      // 原账户名保留在 accountName/toAccountName，账单行仍可读
      const noBalEl = preview.querySelector('#imp-no-bal');
      const noBal = !!(noBalEl && noBalEl.checked);

      // 标签列 → 入个人标签库并关联
      const tagLib = (S.getDB().wallet.tags || []).slice();
      function tagIdOf(name) {
        let t = tagLib.find(function (x) { return x.name === name; });
        if (!t) { t = { id: U.uid(), name: name }; tagLib.push(t); }
        return t.id;
      }
      const recs = [];
      rows.forEach(function (b) {
        const cat = matchCat(b.catName, b.subCatName, b.type) || {};
        const tagNames = (b.tagsName && b.tagsName.length ? b.tagsName : (b.tags || []))
          .map(function (t) { return String(t || '').trim(); }).filter(Boolean);
        // 非转账：匹配不上 = 不区分账户（不动余额），不再强行塞进某个账户
        // 转账：双侧已由 transferSkipReason 保证都解析到真实账户且互不相同（P0-4）
        // 甲5 勾「本次导入不动余额」：accountId/toAccountId 全部置 ''（不区分账户语义），
        // 原账户名保留在 accountName/toAccountName 供展示
        const t = transferAccounts(b);
        const rec = {
          id: U.uid(), type: b.type || 'expense',
          amount: Math.abs(Number(b.amount) || 0),
          date: b.date, time: b.time || '',
          catId: cat.catId || '', subCatId: cat.subCatId || '',
          accountId: noBal ? '' : (accountExists(b.accountId) ? b.accountId : matchAccount(b.accountName || '')),
          toAccountId: (b.type === 'transfer' && !noBal) ? t.toId : '',
          note: b.note || '', tagIds: tagNames.map(tagIdOf),
          accountName: b.accountName || '',
          toAccountName: b.toAccountName || '',
          source: 'import:' + out.format,
          createdAt: new Date().toISOString()
        };
        // CSV 往返（乙2）：恢复词条/美食关联（走既有 itemId/foodId 字段）；
        // id 在本账号不存在就忽略不带——不报错，也不挡既有自动词条/美食同步
        const dbNow = S.getDB();
        if (b.itemId && (dbNow.items || []).some(function (i) { return i.id === b.itemId; })) rec.itemId = b.itemId;
        if (b.foodId && (dbNow.food || []).some(function (f) { return f.id === b.foodId; })) rec.foodId = b.foodId;
        recs.push(rec);
      });

      const btn = preview.querySelector('#imp-commit');
      btn.disabled = true;
      btn.textContent = '导入中…';
      // 批次先记全量 recs id（P1-1/1-6）：saveBills 失败也保留可追溯、可整批撤销
      const batchIds = recs.map(function (r) { return r.id; });
      let okCount = 0;
      try {
        await S.saveBills(recs); // 批量入库（统一持久化）+ 自动词条/美食同步
        okCount = recs.length;
      } catch (e) {
        UI.toast('导入中断：' + (e.message || '保存失败') + '，已记入批次可整批撤销', 'error');
      }
      // 无论成败都记批次（失败的 billId 在撤销时容错跳过），并把标签库落盘
      try {
        const dbNow = S.getDB();
        dbNow.wallet.tags = tagLib;
        await S.persist('wallet');
        await S.saveImportBatch({
          id: U.uid(), name: filename, format: out.format,
          billIds: batchIds, createdAt: new Date().toISOString()
        });
      } catch (e) {
        UI.toast('批次记录失败：' + (e.message || '保存失败'), 'error');
      }
      if (okCount) {
        UI.toast('导入完成 ' + okCount + ' 笔' + (rows.length > okCount ? '（' + (rows.length - okCount) + ' 笔失败）' : ''), 'success');
      }
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

  function accountExists(id) {
    return !!id && (((S.getDB().wallet || {}).accounts) || []).some(function (a) { return a && a.id === id; });
  }

  // 转账导入（P0-4）：双侧账户都必须解析到真实账户且互不相同，否则整条跳过——
  // 单边入账 = 凭空造钱/吞钱（applyBillToBalance 已另加防御，这里在导入源头拦截）
  function transferAccounts(b) {
    const fromId = accountExists(b.accountId) ? b.accountId : matchAccount(b.accountName || '');
    const toId = accountExists(b.toAccountId) ? b.toAccountId : matchAccount(b.toAccountName || '');
    return { fromId: fromId, toId: toId };
  }

  function transferSkipReason(b) {
    if (!b || b.type !== 'transfer') return '';
    const t = transferAccounts(b);
    if (!t.fromId && !t.toId) return '缺转出/转入账户';
    if (!t.fromId) return '转出账户缺失或未匹配';
    if (!t.toId) return '转入账户缺失或未匹配';
    if (t.fromId === t.toId) return '转出与转入账户相同';
    return '';
  }

  /* 分类聚类（统计口径，v1.2.01）——只影响「分类统计」模块的展示，不改记账分类：
     · 聚类：二级分类归入自定义组（环图按组聚合，组不下钻）
     · 组顺序 = groups 数组顺序（卡上 ↑↓）即环图顺序
     · 零嵌套弹窗（真机 --app 嵌套 modal 不可靠——"新建无效/卡很久/恢复默认无效"根因）：
       新建组 = 直接建卡就地改名；恢复默认 = 两段式按钮；保存 = 先关后存（秒响应） */
  function openCatMergeDialog() {
    const db = S.getDB();
    const mg = db.settings.catMerge = db.settings.catMerge || { enabled: false, groups: [], soloOrder: [] };
    UI.modal({
      title: '分类聚类与排序（仅分类统计）', width: 720,
      bodyHTML:
        '<div class="cmg-mode"><span class="f-label">统计口径</span>' +
        '<label><input type="radio" name="cmg-mode" value="cat"' + (mg.enabled ? '' : ' checked') + '> 按分类</label>' +
        '<label><input type="radio" name="cmg-mode" value="group"' + (mg.enabled ? ' checked' : '') + '> 按合并组</label></div>' +
        '<p class="muted small cmg-note">只作用于「分类统计」的展示，不改动记账分类本身。</p>' +
        '<div class="cmg-cols">' +
        '<div class="cmg-left"><h4 class="detail-sub">分类（点击选中 / 行内下拉归组）</h4><div id="cmg-tree"></div></div>' +
        '<div class="cmg-right"><h4 class="detail-sub">合并组</h4><div id="cmg-groups"></div>' +
        '<div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" id="cmg-add">' + UI.icon('plus', 14) + ' 新建合并组</button></div></div>' +
        '</div>',
      footerHTML: '<button type="button" class="btn btn-ghost" data-x="restore">恢复默认</button><div class="flex1"></div>' +
        '<button type="button" class="btn btn-ghost" data-x="c">取消</button>' +
        '<button type="button" class="btn btn-primary" data-x="s">保存</button>',
      onMount: function (w, close) {
        let groups = (mg.groups || []).map(function (g) {
          return { id: g.id, name: g.name, members: (g.members || []).slice() };
        });
        let soloOrder = (mg.soloOrder || []).slice();
        let curGid = groups.length ? groups[0].id : null;
        const picked = {}; // 左栏多选集
        const treeBox = w.querySelector('#cmg-tree');
        const groupBox = w.querySelector('#cmg-groups');
        // 短名（本文件私有；views-plan 的 findWalletCat 是闭包私有，跨文件调用会 ReferenceError——曾致组卡成员渲染抛错）
        const nameOf = function (id) {
          const f = findCat(id);
          return f && f.node ? f.node.name : id;
        };
        const memberOf = function (id) {
          for (let i = 0; i < groups.length; i++) if (groups[i].members.indexOf(id) >= 0) return groups[i].id;
          return null;
        };
        function renderTree() {
          treeBox.innerHTML = catTree('expense').map(function (c) {
            return '<div class="cmg-l1">' + catIconHTML(c.id, 16) + esc(c.name) + '</div>' +
              (c.children || []).map(function (ch) {
                const g = memberOf(ch.id);
                return '<div class="cmg-l2' + (picked[ch.id] ? ' cmg-sel' : '') + '" data-cmg-pick="' + esc(ch.id) + '">' +
                  '<span class="flex1">' + catIconHTML(ch.id, 14) + esc(ch.name) + '</span>' +
                  '<select data-cmg-assign="' + esc(ch.id) + '"><option value="">独立</option>' +
                  groups.map(function (gg) {
                    return '<option value="' + esc(gg.id) + '"' + (g === gg.id ? ' selected' : '') + '>' + esc(gg.name) + '</option>';
                  }).join('') + '<option value="__new__">＋ 新建组…</option></select></div>';
            }).join('');
          }).join('');
        }
        function renderGroups() {
          const nPick = Object.keys(picked).length;
          groupBox.innerHTML = groups.length ? groups.map(function (g, i) {
            return '<div class="cmg-group' + (g.id === curGid ? ' on' : '') + '" data-cmg-g="' + esc(g.id) + '">' +
              '<div class="cmg-ghead"><input class="cmg-gname" data-cmg-name="' + esc(g.id) + '" value="' + esc(g.name) + '" placeholder="组名">' +
              '<button type="button" class="btn-icon" data-cmg-move="up" data-cmg-g="' + esc(g.id) + '" title="上移"' + (i === 0 ? ' disabled' : '') + '>' + UI.icon('chevron-up', 14) + '</button>' +
              '<button type="button" class="btn-icon" data-cmg-move="down" data-cmg-g="' + esc(g.id) + '" title="下移"' + (i === groups.length - 1 ? ' disabled' : '') + '>' + UI.icon('chevron-down', 14) + '</button>' +
              '<button type="button" class="btn btn-ghost btn-sm cmg-join" data-cmg-join="' + esc(g.id) + '"' +
              (nPick ? '' : ' disabled') + '>＋ 加入选中' + (nPick ? '（' + nPick + '）' : '') + '</button>' +
              '<button type="button" class="btn-icon" data-cmg-del="' + esc(g.id) + '" title="删除合并组">' + UI.icon('trash-2', 14) + '</button></div>' +
              '<div class="cmg-members">' + (g.members.length ? g.members.map(function (m) {
                return '<span class="tag">' + esc(nameOf(m)) +
                  '<button type="button" class="chip-del" data-cmg-out="' + esc(m) + '">×</button></span>';
              }).join('') : '<span class="muted small">点左侧分类行选中后加入，或用行内下拉归组</span>') + '</div></div>';
          }).join('') : '<p class="muted small">还没有合并组：点下方「新建合并组」或左侧下拉「＋ 新建组…」</p>';
        }
        function renderAll() { renderTree(); renderGroups(); }
        // 新建组（零嵌套）：直接建卡 + 聚焦名称框全选，就地改名——绕开嵌套 modal（真机不可靠）
        function addGroup(withMemberId) {
          const g = { id: U.uid(), name: '新分组 ' + (groups.length + 1), members: [] };
          if (withMemberId) {
            groups.forEach(function (gg) { gg.members = gg.members.filter(function (m) { return m !== withMemberId; }); });
            g.members.push(withMemberId);
          }
          groups.push(g);
          curGid = g.id;
          renderAll();
          const inp = groupBox.querySelector('[data-cmg-name="' + g.id + '"]');
          if (inp) { inp.focus(); inp.select(); }
          return g;
        }
        // 事件委托（一次绑定，重渲不失效）
        treeBox.addEventListener('click', function (e) {
          const row = e.target.closest ? e.target.closest('[data-cmg-pick]') : null;
          if (!row || (e.target.closest && e.target.closest('select'))) return;
          const id = row.getAttribute('data-cmg-pick');
          if (picked[id]) delete picked[id]; else picked[id] = 1;
          row.classList.toggle('cmg-sel', !!picked[id]);
          renderGroups();
        });
        treeBox.addEventListener('change', function (e) {
          const sel = e.target.closest ? e.target.closest('[data-cmg-assign]') : null;
          if (!sel) return;
          const id = sel.getAttribute('data-cmg-assign');
          const to = sel.value;
          if (to === '__new__') { addGroup(id); return; }
          groups.forEach(function (gg) { gg.members = gg.members.filter(function (m) { return m !== id; }); });
          if (to) {
            const gg = groups.filter(function (x) { return x.id === to; })[0];
            if (gg) { gg.members.push(id); curGid = to; }
          }
          renderAll();
        });
        groupBox.addEventListener('click', function (e) {
          const t = e.target;
          const move = t.closest ? t.closest('[data-cmg-move]') : null;
          if (move) {
            const gid = move.getAttribute('data-cmg-g');
            const dir = move.getAttribute('data-cmg-move') === 'up' ? -1 : 1;
            const i = groups.findIndex(function (g) { return g.id === gid; });
            const j = i + dir;
            if (i >= 0 && j >= 0 && j < groups.length) {
              const tmp = groups[i]; groups[i] = groups[j]; groups[j] = tmp;
              curGid = gid;
              renderGroups();
            }
            return;
          }
          const join = t.closest ? t.closest('[data-cmg-join]') : null;
          if (join) {
            const g = groups.filter(function (x) { return x.id === join.getAttribute('data-cmg-join'); })[0];
            if (!g) return;
            Object.keys(picked).forEach(function (id) {
              groups.forEach(function (gg) { gg.members = gg.members.filter(function (m) { return m !== id; }); });
              g.members.push(id);
              delete picked[id];
            });
            curGid = g.id;
            renderAll();
            UI.toast('已加入「' + g.name + '」', 'success');
            return;
          }
          const out = t.closest ? t.closest('[data-cmg-out]') : null;
          if (out) {
            const id = out.getAttribute('data-cmg-out');
            groups.forEach(function (gg) { gg.members = gg.members.filter(function (m) { return m !== id; }); });
            renderAll();
            return;
          }
          const del = t.closest ? t.closest('[data-cmg-del]') : null;
          if (del) {
            const id = del.getAttribute('data-cmg-del');
            groups = groups.filter(function (g) { return g.id !== id; });
            if (curGid === id) curGid = groups.length ? groups[0].id : null;
            renderAll();
            return;
          }
          const card = t.closest ? t.closest('[data-cmg-g]') : null;
          if (card && !t.closest('input') && !t.closest('button')) {
            curGid = card.getAttribute('data-cmg-g');
            renderGroups();
          }
        });
        groupBox.addEventListener('input', function (e) {
          const inp = e.target.closest ? e.target.closest('[data-cmg-name]') : null;
          if (!inp) return;
          const g = groups.filter(function (x) { return x.id === inp.getAttribute('data-cmg-name'); })[0];
          if (g) g.name = inp.value; // 就地改名，不重渲（打字不卡）
        });
        renderAll();
        w.querySelector('#cmg-add').addEventListener('click', function () { addGroup(null); });
        w.querySelector('[data-x=c]').addEventListener('click', close);
        // 恢复默认：两段式确认（零嵌套，不再弹 confirmDialog）
        let restoreArmed = false;
        let restoreTimer = null;
        const restoreBtn = w.querySelector('[data-x=restore]');
        restoreBtn.addEventListener('click', function () {
          if (!restoreArmed) {
            restoreArmed = true;
            restoreBtn.textContent = '确认清空？';
            restoreBtn.classList.add('btn-danger');
            restoreTimer = setTimeout(function () {
              restoreArmed = false;
              restoreBtn.textContent = '恢复默认';
              restoreBtn.classList.remove('btn-danger');
            }, 3000);
            return;
          }
          clearTimeout(restoreTimer);
          db.settings.catMerge = { enabled: false, groups: [], soloOrder: [] };
          close();
          UI.toast('已恢复默认口径', 'success');
          S.saveSettings().catch(function (e) {
            UI.toast('保存失败：' + ((e && e.message) || e) + '，请重试', 'error');
          });
          setTimeout(function () { window.App.refresh(); }, 400);
        });
        // 保存：先落内存+关弹窗（秒响应），持久化与整页刷新放到后台（不阻塞点击）
        w.querySelector('[data-x=s]').addEventListener('click', function () {
          const checked = w.querySelector('input[name=cmg-mode]:checked');
          const mode = checked ? checked.value : 'cat'; // 兜底：radio 未选中按分类
          db.settings.catMerge = { enabled: mode === 'group', groups: groups, soloOrder: soloOrder };
          close();
          UI.toast(mode === 'group' ? ('聚类排序已保存（' + groups.length + ' 组）') : '已保存（按分类口径）', 'success');
          S.saveSettings().catch(function (e) {
            UI.toast('保存失败：' + ((e && e.message) || e) + '，请重试', 'error');
          });
          setTimeout(function () { window.App.refresh(); }, 400);
        });
      }
    });
  }

  /* ---------- 分类一览（挂载到设置 → 记账设置，紧凑展示）+ 分类管理（甲20） ----------
     添加子类/改名/删除 按钮走委托接线（本文件不改 views-settings.js）；
     删除分类时引用它的账单自动归入「其他」（removeWalletCat 仍拦"被使用"，先归位再删）。 */
  function catTreeCompactHTML() {
    bindCatOps();
    return '<div id="s-cat-list">' + catListBodyHTML() + '</div>';
  }
  function catListBodyHTML() {
    // v1.1.9 方案 A：chip 流 + hover 浮出操作（子类紧凑 chip、一级操作横排，告别按钮墙）
    function hideBtn(id) {
      return '<button class="chip-op" data-wcat-hide="' + esc(id) + '" title="' + (isWcatHidden(id) ? '恢复显示' : '屏蔽（记账时不显示）') + '">' +
        UI.icon(isWcatHidden(id) ? 'eye' : 'eye-off', 13) + '</button>';
    }
    function block(kind, title) {
      return '<h4 class="detail-sub">' + title + '</h4><div class="ycat-list">' +
        catTree(kind).map(function (c) {
          const subs = (c.children || []).map(function (ch) {
            return '<span class="ycat-chip' + (isWcatHidden(ch.id) ? ' wcat-hidden' : '') + '">' +
              catIconHTML(ch.id, 15) + '<span title="' + esc(ch.name) + '">' + esc(ch.name) + '</span>' +
              '<span class="ycat-chip-ops">' +
              hideBtn(ch.id) +
              '<button class="chip-op" data-wcat-ren="' + esc(ch.id) + '" data-wcat-kind="' + kind + '" title="改名">' + UI.icon('pencil', 13) + '</button>' +
              '<button class="chip-op" data-wcat-del="' + esc(ch.id) + '" data-wcat-kind="' + kind + '" title="删除">' + UI.icon('trash-2', 13) + '</button>' +
              '</span></span>';
          }).join('');
          return '<div class="ycat-row' + (isWcatHidden(c.id) ? ' wcat-hidden' : '') + '">' +
            '<div class="ycat-row-head">' + catIconHTML(c.id, 18) + '<strong>' + esc(c.name) + '</strong>' +
            '<span class="muted small">' + ((c.children || []).length) + ' 个子类</span>' +
            '<div class="ycat-row-ops">' +
            hideBtn(c.id) +
            '<button class="chip-op" data-wcat-add="' + esc(c.id) + '" data-wcat-kind="' + kind + '" title="添加子类">' + UI.icon('plus', 13) + '</button>' +
            '<button class="chip-op" data-wcat-ren="' + esc(c.id) + '" data-wcat-kind="' + kind + '" title="改名">' + UI.icon('pencil', 13) + '</button>' +
            '<button class="chip-op" data-wcat-del="' + esc(c.id) + '" data-wcat-kind="' + kind + '" title="删除">' + UI.icon('trash-2', 13) + '</button>' +
            '</div></div>' +
            '<div class="ycat-chips">' + (subs || '<span class="muted small">暂无子类</span>') + '</div></div>';
        }).join('') + '</div>';
    }
    return block('expense', '支出分类（主流记账复刻）') + block('income', '收入分类（主流记账复刻）');
  }
  function refreshCatList() {
    const box = document.getElementById('s-cat-list');
    if (box) box.innerHTML = catListBodyHTML();
  }
  function findCatNode(id, kind) {
    const list = catTree(kind);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.id === id) return { node: c, parent: null, top: c };
      const ch = c.children || [];
      for (let j = 0; j < ch.length; j++) {
        if (ch[j].id === id) return { node: ch[j], parent: c, top: c };
      }
    }
    return null;
  }
  function openCatNameModal(title, value, onSave) {
    UI.modal({
      title: title, width: 420,
      bodyHTML: '<div class="form-grid"><label class="f-full"><span class="f-label">分类名称 <span class="req-star">*</span></span>' +
        '<input id="wcat-name" value="' + esc(value) + '" placeholder="如：早餐 / 宠物零食"></label></div>',
      footerHTML: '<button class="btn btn-ghost" data-x="c">取消</button><button class="btn btn-primary" data-x="s">保存</button>',
      onMount: function (w, close) {
        w.querySelector('[data-x=c]').addEventListener('click', close);
        w.querySelector('[data-x=s]').addEventListener('click', function () {
          const name = w.querySelector('#wcat-name').value.trim();
          if (!name) { UI.toast('请填写分类名称', 'error'); return; }
          Promise.resolve(onSave(name)).then(function () { close(); }).catch(function (e) {
            UI.toast((e && e.message) || '保存失败', 'error');
          });
        });
      }
    });
  }
  // 删除分类：引用该分类（含其子类）的账单自动归入「其他」（甲20）；
  // 树里没有「其他」时子类归回一级、一级归未分类，账单保持可读
  function reassignBillsForCat(id, kind, hit) {
    const db = S.getDB();
    const ids = {};
    ids[id] = true;
    (hit.node.children || []).forEach(function (ch) { ids[ch.id] = true; });
    const fallbackTop = catTree(kind).find(function (c) { return c.id !== id && /其他/.test(c.name); }) || null;
    const newCat = fallbackTop ? fallbackTop.id : (hit.parent ? hit.parent.id : '');
    let touched = 0;
    (db.wallet.bills || []).forEach(function (b) {
      if (!b || (!ids[b.catId] && !ids[b.subCatId])) return;
      b.catId = newCat;
      b.subCatId = '';
      touched++;
    });
    return touched ? S.persist('wallet') : Promise.resolve();
  }
  let catOpsBound = false;
  function bindCatOps() {
    if (catOpsBound) return;
    catOpsBound = true;
    document.addEventListener('click', function (e) {
      const target = e.target && e.target.closest ? e.target : null;
      if (!target) return;
      const add = target.closest('[data-wcat-add]');
      const ren = target.closest('[data-wcat-ren]');
      const del = target.closest('[data-wcat-del]');
      const hide = target.closest('[data-wcat-hide]');
      if (hide) {
        // v1.1.9 分类屏蔽：只影响记账表单显示，历史账单/导入不受影响
        const id = hide.getAttribute('data-wcat-hide');
        const db = S.getDB();
        const arr = (db.settings.hiddenWcats || []).slice();
        const i = arr.indexOf(id);
        if (i >= 0) arr.splice(i, 1); else arr.push(id);
        db.settings.hiddenWcats = arr;
        S.saveSettings().then(function () {
          refreshCatList();
          UI.toast(i >= 0 ? '分类已恢复显示' : '分类已屏蔽，记账时不再显示（历史账单不受影响）', 'success');
        });
        return;
      }
      if (!add && !ren && !del) return;
      const kind = (add || ren || del).getAttribute('data-wcat-kind') || 'expense';
      if (add) {
        const hit = findCatNode(add.getAttribute('data-wcat-add'), kind);
        if (!hit) return;
        openCatNameModal('添加子类', '', function (name) {
          const child = { id: U.uid(), name: name, icon: '' };
          hit.node.children = hit.node.children || [];
          hit.node.children.push(child);
          return S.saveWalletCat(hit.node, kind).then(function () {
            refreshCatList();
            UI.toast('子类已添加，记账弹窗立即可选', 'success');
          });
        });
        return;
      }
      if (ren) {
        const hit = findCatNode(ren.getAttribute('data-wcat-ren'), kind);
        if (!hit) return;
        openCatNameModal('分类改名', hit.node.name, function (name) {
          hit.node.name = name;
          return S.saveWalletCat(hit.top, kind).then(function () {
            refreshCatList();
            UI.toast('分类已改名', 'success');
          });
        });
        return;
      }
      const id = del.getAttribute('data-wcat-del');
      const hit = findCatNode(id, kind);
      if (!hit) return;
      UI.confirmDialog('删除分类', '删除「' + hit.node.name + '」？引用该分类的账单将自动归入「其他」。').then(function (yes) {
        if (!yes) return;
        reassignBillsForCat(id, kind, hit).then(function () {
          return S.removeWalletCat(id, kind);
        }).then(function () {
          refreshCatList();
          UI.toast('分类已删除，相关账单已归入「其他」', 'success');
        }).catch(function (err) {
          UI.toast((err && err.message) || '删除失败', 'error');
        });
      });
    });
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
      // 周/月/年原样带上（周=本周日期区间，inRange 已支持，A13）——下钻不丢周期
      filters.range = opts.range;
    }
    // 统计下钻来源条（A13）：「来自统计：〈周期〉 · 分类X」，可关闭、点击清除筛选
    if (opts.range) {
      const periodName = { week: '本周', month: '本月', year: '今年', all: '全部' }[opts.range] || opts.range;
      drillSource = '来自统计：' + periodName + (filters.catId ? ' · ' + catLabel(filters.catId) : '');
    } else {
      drillSource = '';
    }
    tab = 'bills';
    window.App.go('wallet');
  }

  return {
    render: render, openBillForm: openBillForm, renderBills: renderBills,
    mountImportUI: mountImportUI, catTreeCompactHTML: catTreeCompactHTML,
    openCatMergeDialog: openCatMergeDialog,
    downloadTemplate: downloadTemplate, jumpTo: jumpTo, resetState: resetState
  };
})();
