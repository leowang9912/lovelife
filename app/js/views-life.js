/* views-life.js — 我的生活（美妆洗护：使用次数、PAO、空瓶、回购） */
window.LifeView = (function () {
  const U = window.Utils;
  const M = window.Models;
  const S = window.Storage;
  const UI = window.UI;

  const state = { filterCat: '', filterSub: '', filterStatus: '', filterTag: '', search: '', sort: { key: 'date', dir: -1 } };

  /* 账号切换重置（A3）：清筛选/搜索，排序记忆改从新账号 listSort 重读 */
  function resetState() {
    state.filterCat = ''; state.filterSub = ''; state.filterStatus = ''; state.filterTag = '';
    state.search = '';
    state.sort = { key: 'date', dir: -1 };
    state.sortLoaded = false;
  }

  function render(root) {
    const db = S.getDB();
    if (!db) return;
    const cats = db.categories.life || [];
    const all = M.itemsWithComputed(db).filter(function (i) { return i.kind === 'life'; });
    let list = all;
    if (state.filterCat) {
      // 精确匹配（A11）：一级=categoryId、二级=subCategoryId；
      // 不得按父类模糊匹配（选子分类会列出同父类所有物品）
      list = list.filter(function (i) {
        return i.categoryId === state.filterCat || i.subCategoryId === state.filterCat;
      });
    }
    if (state.filterStatus) list = list.filter(function (i) { return (i.status || 'in_use') === state.filterStatus; });
    if (state.filterTag) list = list.filter(function (i) { return (i.tags || []).indexOf(state.filterTag) >= 0; });
    if (state.search) {
      const q = state.search.toLowerCase();
      list = list.filter(function (i) {
        return (i.name || '').toLowerCase().indexOf(q) >= 0 || (i.brand || '').toLowerCase().indexOf(q) >= 0 ||
          (i.shade || '').toLowerCase().indexOf(q) >= 0 || (i.notes || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    // 排序（v1.0.8）：字段 + 方向双向可调；选择落盘记忆（v1.0.9）
    if (!state.sortLoaded) {
      const sv = (db.settings.listSort || {}).life;
      if (sv && sv.key) state.sort = { key: sv.key, dir: sv.dir === 1 ? 1 : -1 };
      state.sortLoaded = true;
    }
    list = UI.sortItems(list, state.sort.key, state.sort.dir, db);
    // 标签筛选候选：本页物品用过的全部标签（v1.0.7）
    const tagOptions = [];
    all.forEach(function (i) {
      (i.tags || []).forEach(function (t) { if (t && tagOptions.indexOf(t) < 0) tagOptions.push(t); });
    });
    tagOptions.sort();

    // 「N 件临期」与 models.js expiryList 同口径：已售出/转赠/报废的物品不再计临期（乙4）
    const expiring = all.filter(function (i) {
      if (i.status === 'sold' || i.status === 'gifted' || i.status === 'broken') return false;
      const s = M.lifeStatus(i);
      return s.paoState === 'near' || s.paoState === 'expired';
    }).length;

    root.innerHTML =
      '<div class="page-head"><h2>我的生活</h2><div class="page-actions">' +
      (expiring ? '<span class="tag tag-warn">' + expiring + ' 件临期</span>' : '') +
      '<button class="btn btn-ghost" id="btn-looks">' + UI.icon('palette', 14) + ' 妆容组合</button>' +
      '<button class="btn btn-primary" id="btn-add-life">' + UI.icon('plus', 14) + ' 记美妆</button></div></div>' +
      '<div class="filter-bar">' +
      '<input class="search-input" id="life-search" placeholder="搜索名称 / 品牌 / 色号…" value="' + U.escapeHtml(state.search) + '">' +
      '<select id="life-cat"><option value="">全部分类</option>' +
      cats.map(function (c) {
        return '<option value="' + c.id + '"' + (state.filterCat === c.id ? ' selected' : '') + '>' + U.escapeHtml(c.name) + '</option>' +
          (c.children || []).map(function (s) {
            return '<option value="' + s.id + '"' + (state.filterCat === s.id ? ' selected' : '') + '>　' + U.escapeHtml(s.name) + '</option>';
          }).join('');
      }).join('') + '</select>' +
      '<select id="life-status"><option value="">全部状态</option>' +
      [['in_use', '在用'], ['idle', '闲置'], ['borrowed', '借出'], ['to_sell', '待出闲置'], ['broken', '损坏报废'], ['sold', '已售出'], ['gifted', '已转赠']].map(function (s) {
        return '<option value="' + s[0] + '"' + (state.filterStatus === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
      }).join('') + '</select>' +
      '<select id="life-tag"><option value="">全部标签</option>' +
      tagOptions.map(function (t) {
        return '<option value="' + U.escapeHtml(t) + '"' + (state.filterTag === t ? ' selected' : '') + '>' + U.escapeHtml(t) + '</option>';
      }).join('') + '</select>' +
      '<select id="life-sort" title="排序字段">' +
      UI.sortOptionsFor('life').map(function (d) {
        return '<option value="' + d.key + '"' + (state.sort.key === d.key ? ' selected' : '') + '>' + d.label + '</option>';
      }).join('') + '</select>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="life-sort-dir" title="点击切换排序方向">' +
      UI.sortDirLabel(state.sort.key, state.sort.dir) + ' ' + UI.icon('arrow-up-down', 14) + '</button>' +
      '<span class="count-label">共 ' + list.length + ' 件</span></div>' +
      (list.length
        ? '<div class="item-grid">' + list.map(function (i) {
          return UI.itemCard(i, { icon: 'heart', quickAdd: true, sortKey: state.sort.key });
        }).join('') + '</div>'
        : (all.length
          // 空态卡化（丙3）：有筛选保留「清除筛选」
          ? '<div class="empty-state empty-card"><div class="empty-icon">' + UI.icon('heart', 48) + '</div>' +
            '<p>没有符合筛选的结果</p><button class="btn btn-ghost" id="btn-clear-filter">清除筛选</button></div>'
          : '<div class="empty-state empty-card"><div class="empty-icon">' + UI.icon('heart', 48) + '</div>' +
            '<p>还没有记录，先记一件美妆吧</p>' +
            '<button class="btn btn-ghost" id="btn-empty-add">＋ 记美妆</button></div>'));

    root.querySelector('#btn-add-life').addEventListener('click', function () {
      window.Views.openItemEditor(null, 'life');
    });
    const emptyAdd = root.querySelector('#btn-empty-add');
    if (emptyAdd) emptyAdd.addEventListener('click', function () {
      window.Views.openItemEditor(null, 'life');
    });
    root.querySelector('#btn-looks').addEventListener('click', function () { openLooks(root); });
    // 中文输入法组词期间不重绘（v1.0.9）；重绘后恢复光标 offset，不再一律跳末尾（甲9）
    const searchEl = root.querySelector('#life-search');
    let composing = false;
    const refreshSearch = function (val, selStart, selEnd) {
      state.search = val; render(root);
      const inp = root.querySelector('#life-search');
      if (inp) {
        inp.focus();
        try {
          const pos = selStart == null ? inp.value.length : selStart;
          inp.setSelectionRange(pos, selEnd == null ? pos : selEnd);
        } catch (e) { /* 忽略不支持 selection 的输入 */ }
      }
    };
    searchEl.addEventListener('compositionstart', function () { composing = true; });
    searchEl.addEventListener('compositionend', function (e) {
      composing = false;
      refreshSearch(e.target.value, e.target.selectionStart, e.target.selectionEnd);
    });
    searchEl.addEventListener('input', U.debounce(function (e) {
      if (composing) return;
      refreshSearch(e.target.value, e.target.selectionStart, e.target.selectionEnd);
    }, 280));
    root.querySelector('#life-cat').addEventListener('change', function (e) {
      state.filterCat = e.target.value; render(root);
    });
    root.querySelector('#life-status').addEventListener('change', function (e) {
      state.filterStatus = e.target.value; render(root);
    });
    root.querySelector('#life-tag').addEventListener('change', function (e) {
      state.filterTag = e.target.value; render(root);
    });
    const clearBtn = root.querySelector('#btn-clear-filter');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      state.filterCat = ''; state.filterStatus = ''; state.filterTag = ''; state.search = '';
      render(root);
    });
    function persistSort() {
      db.settings.listSort = db.settings.listSort || {};
      db.settings.listSort.life = { key: state.sort.key, dir: state.sort.dir };
      S.saveSettings().catch(function () { UI.toast('排序记忆保存失败', 'error'); });
    }
    root.querySelector('#life-sort').addEventListener('change', function (e) {
      const def = UI.sortOptionsFor('life').find(function (d) { return d.key === e.target.value; });
      state.sort = { key: e.target.value, dir: (def && def.defDir) || 1 };
      persistSort();
      render(root);
    });
    root.querySelector('#life-sort-dir').addEventListener('click', function () {
      state.sort.dir = state.sort.dir === 1 ? -1 : 1;
      persistSort();
      render(root);
    });
    root.querySelectorAll('.item-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('[data-quick]')) return;
        window.Views.openItemDetail(card.getAttribute('data-id'));
      });
    });
    root.querySelectorAll('[data-quick]').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        const id = btn.getAttribute('data-quick');
        const it = S.getDB().items.find(function (x) { return x.id === id; });
        if (!it) return;
        M.appendUsageLog(it, 1, 'manual', '手动记录');
        try {
          await S.saveItem(it);
        } catch (err) {
          M.removeUsageLogEntry(it, (it.usageLog[it.usageLog.length - 1] || {}).id);
          UI.toast('保存失败，已还原', 'error');
          return;
        }
        UI.toast('使用 +1', 'success');
        render(root);
      });
    });
    root.querySelectorAll('img[data-path]').forEach(async function (img) {
      const url = await S.getImageURL(img.getAttribute('data-path'));
      if (url) img.src = url;
    });
  }

  /* 妆容组合管理（通用组合管理器：范例图 + 可编辑） */
  function openLooks(root) {
    const db = S.getDB();
    db.settings.makeupLooks = db.settings.makeupLooks || [];
    const lifes = M.itemsWithComputed(db).filter(function (i) { return i.kind === 'life'; });
    const items = lifes.map(function (i) {
      const c = (db.categories.life || []).find(function (x) { return x.id === i.categoryId; });
      return { id: i.id, name: i.name, brand: i.brand, images: i.images, categoryName: c ? c.name : '其他' };
    });
    UI.comboManager({
      title: '妆容组合', icon: 'palette', items: items,
      combos: db.settings.makeupLooks,
      onChange: function () { S.saveSettings(); }
    });
  }

  return { render: render, resetState: resetState };
})();
