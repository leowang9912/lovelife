/* views-life.js — 我的生活（美妆洗护：使用次数、PAO、空瓶、回购） */
window.LifeView = (function () {
  const U = window.Utils;
  const M = window.Models;
  const S = window.Storage;
  const UI = window.UI;

  const state = { filterCat: '', filterSub: '', filterStatus: '', search: '' };

  function render(root) {
    const db = S.getDB();
    if (!db) return;
    const cats = db.categories.life || [];
    const all = M.itemsWithComputed(db).filter(function (i) { return i.kind === 'life'; });
    let list = all;
    if (state.filterCat) {
      list = list.filter(function (i) {
        if (i.categoryId === state.filterCat) return true;
        const l1 = cats.find(function (c) { return c.id === i.categoryId; });
        return l1 && l1.children && l1.children.some(function (c) { return c.id === state.filterCat; });
      });
    }
    if (state.filterStatus) list = list.filter(function (i) { return (i.status || 'in_use') === state.filterStatus; });
    if (state.search) {
      const q = state.search.toLowerCase();
      list = list.filter(function (i) {
        return (i.name || '').toLowerCase().indexOf(q) >= 0 || (i.brand || '').toLowerCase().indexOf(q) >= 0 ||
          (i.shade || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    list = list.slice().sort(function (a, b) {
      return (b.openedDate || b.purchaseDate || '').localeCompare(a.openedDate || a.purchaseDate || '');
    });

    const expiring = all.filter(function (i) {
      const s = M.lifeStatus(i);
      return s.paoState === 'near' || s.paoState === 'expired';
    }).length;

    root.innerHTML =
      '<div class="page-head"><h2>我的生活</h2><div class="page-actions">' +
      (expiring ? '<span class="tag tag-warn">' + expiring + ' 件临期</span>' : '') +
      '<button class="btn btn-ghost" id="btn-looks">💄 妆容组合</button>' +
      '<button class="btn btn-primary" id="btn-add-life">＋ 记美妆</button></div></div>' +
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
      [['in_use', '在用'], ['idle', '闲置'], ['to_sell', '待出闲置'], ['broken', '损坏报废']].map(function (s) {
        return '<option value="' + s[0] + '"' + (state.filterStatus === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
      }).join('') + '</select>' +
      '<span class="count-label">共 ' + list.length + ' 件</span></div>' +
      (list.length
        ? '<div class="item-grid">' + list.map(function (i) {
          return UI.itemCard(i, { icon: '💄', quickAdd: true });
        }).join('') + '</div>'
        : '<div class="empty-state"><div class="empty-icon">💄</div><p>还没有记录</p></div>');

    root.querySelector('#btn-add-life').addEventListener('click', function () {
      window.Views.openItemEditor(null, 'life');
    });
    root.querySelector('#btn-looks').addEventListener('click', function () { openLooks(root); });
    root.querySelector('#life-search').addEventListener('input', U.debounce(function (e) {
      state.search = e.target.value; render(root);
      const inp = root.querySelector('#life-search');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }, 280));
    root.querySelector('#life-cat').addEventListener('change', function (e) {
      state.filterCat = e.target.value; render(root);
    });
    root.querySelector('#life-status').addEventListener('change', function (e) {
      state.filterStatus = e.target.value; render(root);
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
        await S.saveItem(it);
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
      return { id: i.id, name: i.name, brand: i.brand, categoryName: c ? c.name : '其他' };
    });
    UI.comboManager({
      title: '💄 妆容组合', icon: '💄', items: items,
      combos: db.settings.makeupLooks,
      onChange: function () { S.saveSettings(); }
    });
  }

  return { render: render };
})();
