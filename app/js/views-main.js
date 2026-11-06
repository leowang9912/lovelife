/* views-main.js — 我的数码 / 我的衣橱 / 穿搭日历 */
window.Views = (function () {
  const U = window.Utils;
  const M = window.Models;
  const S = window.Storage;
  const UI = window.UI;

  function kindLabel(k) {
    return { digital: '数码', device: '设备', game: '游戏', clothing: '衣服', life: '生活' }[k] || k;
  }

  /* =============== 物品库 =============== */
  const itemState = { kind: null, filterCat: '', filterStatus: '', filterTag: '', search: '', sorts: {} };

  function items(root, kind) {
    if (itemState.kind !== kind) {
      itemState.kind = kind; itemState.filterCat = ''; itemState.filterStatus = ''; itemState.filterTag = ''; itemState.search = '';
    }
    const db = S.getDB();
    if (!db) return;
    const cats = UI.catsFor(db, kind);
    const kinds = kind === 'digital' ? ['device', 'game'] : [kind];
    const all = M.itemsWithComputed(db).filter(function (i) { return kinds.indexOf(i.kind) >= 0; });
    let list = all;
    if (itemState.filterCat) list = list.filter(function (i) { return i.categoryId === itemState.filterCat || i.subCategoryId === itemState.filterCat; });
    if (itemState.filterStatus) list = list.filter(function (i) { return (i.status || 'in_use') === itemState.filterStatus; });
    if (itemState.filterTag) list = list.filter(function (i) { return (i.tags || []).indexOf(itemState.filterTag) >= 0; });
    if (itemState.search) {
      const q = itemState.search.toLowerCase();
      list = list.filter(function (i) {
        return (i.name || '').toLowerCase().indexOf(q) >= 0 || (i.brand || '').toLowerCase().indexOf(q) >= 0 ||
          (i.notes || '').toLowerCase().indexOf(q) >= 0 || (i.shade || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    // 排序（v1.0.8）：字段 + 方向双向可调；选择落盘记忆（v1.0.9）
    const sortKinds = kind === 'digital' ? 'digital' : kind;
    const savedSort = (db.settings.listSort || {})[kind];
    const sortState = itemState.sorts[kind] ||
      (itemState.sorts[kind] = savedSort && savedSort.key
        ? { key: savedSort.key, dir: savedSort.dir === 1 ? 1 : -1 }
        : { key: 'date', dir: -1 });
    list = UI.sortItems(list, sortState.key, sortState.dir, db);
    // 标签筛选候选：本类物品用过的全部标签（v1.0.7）
    const tagOptions = [];
    all.forEach(function (i) {
      (i.tags || []).forEach(function (t) { if (t && tagOptions.indexOf(t) < 0) tagOptions.push(t); });
    });
    tagOptions.sort();

    const titles = { digital: '我的数码', clothing: '我的衣橱' };
    const icons = { digital: 'gamepad-2', clothing: 'shirt' };

    root.innerHTML =
      '<div class="page-head"><h2>' + titles[kind] + '</h2><div class="page-actions">' +
      (kind === 'clothing' ? '<button class="btn btn-ghost" id="btn-outfit-looks">' + UI.icon('layers', 14) + ' 穿搭组合</button>' : '') +
      '<button class="btn btn-primary" id="btn-add-item">' + UI.icon('plus', 14) + ' 记' + (kind === 'digital' ? '数码' : '衣服') + '</button></div></div>' +
      '<div class="filter-bar">' +
      '<input class="search-input" id="item-search" placeholder="搜索名称 / 品牌 / 备注…" value="' + U.escapeHtml(itemState.search) + '">' +
      '<select id="filter-cat"><option value="">全部种类</option>' +
      cats.map(function (c) {
        let opts = '<option value="' + c.id + '"' + (itemState.filterCat === c.id ? ' selected' : '') + '>' + U.escapeHtml(c.name) + '</option>';
        if (c.children) {
          c.children.forEach(function (s) {
            opts += '<option value="' + s.id + '"' + (itemState.filterCat === s.id ? ' selected' : '') + '>　' + U.escapeHtml(s.name) + '</option>';
          });
        }
        return opts;
      }).join('') + '</select>' +
      '<select id="filter-status"><option value="">全部状态</option>' +
      [['in_use', '在用'], ['idle', '闲置'], ['borrowed', '借出'], ['to_sell', '待出闲置'], ['broken', '损坏报废'], ['sold', '已售出'], ['gifted', '已转赠']].map(function (s) {
        return '<option value="' + s[0] + '"' + (itemState.filterStatus === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
      }).join('') + '</select>' +
      '<select id="filter-tag"><option value="">全部标签</option>' +
      tagOptions.map(function (t) {
        return '<option value="' + U.escapeHtml(t) + '"' + (itemState.filterTag === t ? ' selected' : '') + '>' + U.escapeHtml(t) + '</option>';
      }).join('') + '</select>' +
      '<select id="filter-sort" title="排序字段">' +
      UI.sortOptionsFor(sortKinds).map(function (d) {
        return '<option value="' + d.key + '"' + (sortState.key === d.key ? ' selected' : '') + '>' + d.label + '</option>';
      }).join('') + '</select>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="sort-dir" title="点击切换排序方向">' +
      UI.sortDirLabel(sortState.key, sortState.dir) + ' ' + UI.icon('arrow-up-down', 14) + '</button>' +
      '<span class="count-label">共 ' + list.length + ' 件</span></div>' +
      (list.length
        ? '<div class="item-grid">' + list.map(function (i) {
          return UI.itemCard(i, { icon: icons[kind], quickAdd: true, sortKey: sortState.key });
        }).join('') + '</div>'
        : (all.length
          ? '<div class="empty-state"><div class="empty-icon">' + UI.iconOrEmoji(icons[kind], 48) + '</div>' +
            '<p>没有符合筛选的结果</p><button class="btn btn-ghost" id="btn-clear-filter">清除筛选</button></div>'
          : '<div class="empty-state"><div class="empty-icon">' + UI.iconOrEmoji(icons[kind], 48) + '</div><p>还没有记录</p></div>'));

    root.querySelector('#btn-add-item').addEventListener('click', function () { openItemEditor(null, kind); });
    const btnLooks = root.querySelector('#btn-outfit-looks');
    if (btnLooks) btnLooks.addEventListener('click', function () { openOutfitLooks(root); });
    // 中文输入法组词期间不重绘（否则候选窗被打断），组词结束再刷新（v1.0.9）
    const searchEl = root.querySelector('#item-search');
    let composing = false;
    const refreshSearch = function (val) {
      itemState.search = val;
      items(root, kind);
      const inp = root.querySelector('#item-search');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    };
    searchEl.addEventListener('compositionstart', function () { composing = true; });
    searchEl.addEventListener('compositionend', function (e) { composing = false; refreshSearch(e.target.value); });
    searchEl.addEventListener('input', U.debounce(function (e) {
      if (composing) return;
      refreshSearch(e.target.value);
    }, 280));
    root.querySelector('#filter-cat').addEventListener('change', function (e) {
      itemState.filterCat = e.target.value; items(root, kind);
    });
    root.querySelector('#filter-status').addEventListener('change', function (e) {
      itemState.filterStatus = e.target.value; items(root, kind);
    });
    root.querySelector('#filter-tag').addEventListener('change', function (e) {
      itemState.filterTag = e.target.value; items(root, kind);
    });
    const clearBtn = root.querySelector('#btn-clear-filter');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      itemState.filterCat = ''; itemState.filterStatus = ''; itemState.filterTag = ''; itemState.search = '';
      items(root, kind);
    });
    function persistSort() {
      db.settings.listSort = db.settings.listSort || {};
      db.settings.listSort[kind] = { key: sortState.key, dir: sortState.dir };
      S.saveSettings().catch(function () { UI.toast('排序记忆保存失败', 'error'); });
    }
    root.querySelector('#filter-sort').addEventListener('change', function (e) {
      const def = UI.sortOptionsFor(sortKinds).find(function (d) { return d.key === e.target.value; });
      itemState.sorts[kind] = { key: e.target.value, dir: (def && def.defDir) || 1 };
      persistSort();
      items(root, kind);
    });
    root.querySelector('#sort-dir').addEventListener('click', function () {
      sortState.dir = sortState.dir === 1 ? -1 : 1;
      persistSort();
      items(root, kind);
    });
    root.querySelectorAll('.item-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('[data-quick]')) return;
        openItemDetail(card.getAttribute('data-id'));
      });
    });
    root.querySelectorAll('[data-quick]').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        const id = btn.getAttribute('data-quick');
        const it = db.items.find(function (x) { return x.id === id; });
        if (!it) return;
        M.appendUsageLog(it, 1, 'manual', '手动记录');
        try {
          await S.saveItem(it);
        } catch (err) {
          M.removeUsageLogEntry(it, (it.usageLog[it.usageLog.length - 1] || {}).id);
          UI.toast('保存失败，已还原', 'error');
          return;
        }
        UI.toast('穿着 +1', 'success');
        items(root, kind);
      });
    });
    bindImages(root);
  }

  function bindImages(root) {
    root.querySelectorAll('img[data-path]').forEach(async function (img) {
      const url = await S.getImageURL(img.getAttribute('data-path'));
      if (url) img.src = url;
    });
  }

  /* ---------- 编辑器 ---------- */
  function openItemEditor(id, kind) {
    const db = S.getDB();
    let item;
    if (id) {
      const found = db.items.find(function (i) { return i.id === id; });
      if (!found) { UI.toast('物品不存在（可能已被删除）', 'error'); return; }
      item = Object.assign({}, found);
    } else {
      item = {
        id: U.uid(), kind: kind === 'digital' ? 'device' : kind,
        status: 'in_use', purchaseDate: U.todayStr(), images: [], gameStatus: 'unopened', useCount: 0
      };
    }
    const formKind = kind || item.kind;
    UI.modal({
      title: (id ? '编辑' : '记') + (formKind === 'digital' ? '数码' : formKind === 'life' ? '美妆' : kindLabel(item.kind || formKind)),
      width: 720,
      bodyHTML: '<form id="item-form">' + UI.itemFormHTML(db, item, formKind) + '</form>' +
        // 账单同步（v1.1.2）：新建可顺手记账；已有词条可补生成购入账单/查看关联
        '<div class="form-section"><div class="form-section-title">' + UI.icon('receipt', 16) +
        ' 账单同步</div><div id="item-bill-sync"></div></div>',
      footerHTML: '<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存</button>',
      onMount: function (wrap, close) {
        const form = wrap.querySelector('#item-form');
        // 账单同步区：新建=顺手记账勾选；已有词条=生成购入账单/关联管理（v1.1.2）
        function renderBillSync() {
          const box = wrap.querySelector('#item-bill-sync');
          if (!box) return;
          const linked = id ? (S.billsOfItem ? S.billsOfItem(id) : []) : [];
          if (!id) {
            box.innerHTML = '<label class="chip-check"><input type="checkbox" id="item-sync-bill" checked>' +
              '<span>同时在钱袋记一笔购入账单（金额/日期取本表单，可稍后修改）</span></label>';
            return;
          }
          if (linked.length) {
            box.innerHTML = '<p class="muted small">已关联 ' + linked.length + ' 笔账单（金额/日期互通）：</p>' +
              linked.map(function (b) {
                return '<div class="mini-row"><span class="muted">' + U.escapeHtml(b.date) + '</span>' +
                  '<span class="flex1">' + U.escapeHtml(b.note || '') + '</span><strong>' +
                  U.formatMoney(b.amount) + '</strong></div>';
              }).join('') +
              '<div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" id="btn-unlink-bill">解除关联</button></div>';
            box.querySelector('#btn-unlink-bill').addEventListener('click', async function () {
              if (await UI.confirmDialog('解除关联', '解除该物品与账单的关联？（账单保留）')) {
                for (let i = 0; i < linked.length; i++) await S.unlinkBillSync(linked[i].id);
                renderBillSync();
                UI.toast('已解除关联', 'success');
              }
            });
          } else {
            box.innerHTML = '<p class="muted small">该词条还没有关联账单。可按当前物品信息（名称/购入价/购买日期）生成一笔购入账单，实现词条与账单互通。</p>' +
              '<div class="btn-row"><button type="button" class="btn btn-primary btn-sm" id="btn-gen-bill">' +
              UI.icon('receipt', 14) + ' 生成购入账单</button></div>';
            box.querySelector('#btn-gen-bill').addEventListener('click', async function () {
              try {
                // 先保存当前表单（确保物品信息最新），再生成账单
                const data = UI.readItemForm(form, item, formKind);
                await S.saveItem(data);
                await S.addBillFromItem(data);
                UI.toast('已生成购入账单（可在钱袋查看/修改）', 'success');
                renderBillSync();
                window.App.refresh();
              } catch (e) {
                UI.toast(e.message || '生成失败', 'error');
              }
            });
          }
        }
        renderBillSync();
        UI.bindFormToggles(form, db, formKind);
        UI.bindTagAdd(form);
        const uploader = UI.imageUploader(wrap.querySelector('#form-img-uploader'), { paths: item.images || [] });
        wrap.querySelector('[data-act=cancel]').addEventListener('click', close);
        wrap.querySelector('[data-act=save]').addEventListener('click', async function () {
          const data = UI.readItemForm(form, item, formKind);
          const errs = M.validateItem(db, data);
          if (errs.length) { UI.toast(errs.join('；'), 'error'); return; }
          const btn = wrap.querySelector('[data-act=save]');
          btn.disabled = true; btn.textContent = '保存中…';
          try {
            data.images = await uploader.finalize();
            // 次数改动记「修正」流水（与详情页同口径：总数=流水合计，v1.0.9；新物品不记）
            if (item.id && (Number(data.useCount) || 0) !== (Number(item.useCount) || 0)) {
              const d1 = (Number(data.useCount) || 0) - (Number(item.useCount) || 0);
              data.useCount = Number(item.useCount) || 0;
              M.appendUsageLog(data, d1, 'edit', '编辑修正', '');
            }
            if (item.id && (Number(data.manualWearCount) || 0) !== (Number(item.manualWearCount) || 0)) {
              const d2 = (Number(data.manualWearCount) || 0) - (Number(item.manualWearCount) || 0);
              data.manualWearCount = Number(item.manualWearCount) || 0;
              M.appendUsageLog(data, d2, 'edit', '编辑修正', '');
            }
            await S.saveItem(data);
            // 词条同步：勾选则生成购入账单并双向关联（金额/日期/名称互通）
            const syncBox = wrap.querySelector('#item-sync-bill');
            if (syncBox && syncBox.checked) {
              const accs = (S.getDB().wallet || {}).accounts || [];
              const kindMap = { device: 'w_shop_digital', game: 'w_shop_digital', clothing: 'w_shop_clothing', life: 'w_shop_beauty' };
              await S.saveBill({
                id: U.uid(), type: 'expense',
                amount: Math.abs(Number(data.purchasePrice) || 0),
                date: data.purchaseDate || U.todayStr(), time: '',
                catId: 'w_shop', subCatId: kindMap[data.kind] || 'w_shop_other',
                accountId: (accs[0] || {}).id || '', note: data.name || '',
                tagIds: [], itemId: data.id, source: 'manual',
                createdAt: new Date().toISOString()
              });
            }
            close(); UI.toast('已保存', 'success'); window.App.refresh();
          } catch (e) {
            UI.toast('保存失败：' + e.message, 'error');
            btn.disabled = false; btn.textContent = '保存';
          }
        });
      }
    });
  }

  /* ---------- 详情 ---------- */
  /* 词条同步（自动）：物品来源账单只读展示（记账自动生成/合并词条，无需手动关联） */
  function linkedBillsHTML(raw) {
    const bills = (S.billsOfItem && S.billsOfItem(raw.id)) || [];
    if (!bills.length) {
      return '<p class="empty-hint">在钱袋记一笔该分类的账，会自动同步到此处</p>';
    }
    return '<div class="muted small" style="margin-bottom:6px">' +
      (raw.fromBill ? '由钱袋记账自动生成 · ' : '') + '金额/日期与账单互通（金融语义以账单为准）</div>' +
      bills.map(function (b) {
        return '<div class="mini-row"><span class="muted">' + U.escapeHtml(b.date) + '</span>' +
          '<span class="tag">' + (b.type === 'income' ? '收入' : b.type === 'transfer' ? '转账' : '支出') + '</span>' +
          '<span class="flex1">' + U.escapeHtml(b.note || '') + '</span>' +
          '<strong>' + U.formatMoney(b.amount) + '</strong></div>';
      }).join('');
  }

  function openItemDetail(id) {
    const db = S.getDB();
    const raw = db.items.find(function (i) { return i.id === id; });
    if (!raw) return;
    const item = M.itemsWithComputed(db).find(function (i) { return i.id === id; });
    const cost = item.cost;
    const events = db.events.filter(function (e) { return e.itemId === id; })
      .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    const lifeS = item.kind === 'life' ? M.lifeStatus(item) : null;

    const stopped = item.retiredAt || item.soldDate;
    let costRows =
      row('购买价格', U.formatMoney(item.purchasePrice)) +
      row(stopped ? '共使用' : '已使用', cost.heldDays + ' 天') +
      row('总投入', U.formatMoney(cost.invested)) +
      row('日均成本', U.formatCost(cost.dailyCost) + ' / 天' + (stopped ? '（已停用 · 固定值）' : ''));
    // 使用周期（v1.1.0）：非在用物品显示截止日，成本类指标已冻结
    if (item.retiredAt || item.soldDate) {
      costRows += row('使用周期', U.cnDate(item.purchaseDate) + ' ~ ' + U.cnDate(item.retiredAt || item.soldDate)) +
        row('成本状态', '已停用 · 固定值');
    }
    if (item.kind === 'clothing') {
      costRows += row('穿着次数', item.wearCount + ' 次（自动 ' + item.autoWear + ' + 手动 ' + item.manualWear + '）') +
        row('每次穿着成本', cost.costPerUse != null ? U.formatCost(cost.costPerUse) : '尚未穿着');
    }
    if (item.kind === 'life') {
      costRows += row('使用次数', (item.useCount || 0) + ' 次') +
        row('单次成本', cost.costPerUse != null ? U.formatCost(cost.costPerUse) : '—');
      if (lifeS && lifeS.openedDays != null) costRows += row('已开封', lifeS.openedDays + ' 天');
      if (lifeS && lifeS.paoExpiry) {
        costRows += row('PAO 到期', lifeS.paoExpiry + '（' + (lifeS.paoDaysLeft < 0 ? '已过期' : '剩 ' + lifeS.paoDaysLeft + ' 天') + '）');
      }
      if (item.emptyDate) costRows += row('用完日期', item.emptyDate);
    }
    if (item.kind === 'game') {
      costRows += row('游玩时长', (item.playHours || 0) + ' 小时');
      if (cost.costPerHour) costRows += row('每小时成本', U.formatCost(cost.costPerHour));
    }
    costRows += row('折旧现值', U.formatMoney(cost.currentValue));

    UI.modal({
      title: item.name, width: 760,
      bodyHTML:
        (item.images && item.images.length ? '<div class="detail-imgs" id="detail-imgs"></div>' : '') +
        '<div class="detail-cols"><div class="detail-main">' +
        '<div class="detail-tags"><span class="tag">' + kindLabel(item.kind) + '</span>' +
        '<span class="tag tag-status">' + statusLabel(item.status) + '</span>' +
        (item.kind === 'life' && lifeS && lifeS.paoState === 'near' ? '<span class="tag tag-warn">PAO 临期</span>' : '') +
        '</div>' +
        '<h4 class="detail-sub">基本信息</h4><div class="detail-kv">' +
        kv('品牌', item.brand) + kv('型号', item.model) + kv('规格/容量', item.spec || item.configText) +
        kv('色号', item.shade) + kv('成色', item.condition) + kv('SN', item.serialNumber) +
        kv('存放位置', item.storageLocation) + kv('购入渠道', item.channel) +
        kv('购买日期', U.cnDate(item.purchaseDate)) +
        kv('标签', (item.tags || []).join('、')) + kv('备注', item.notes) +
        kv('保修截止', item.warrantyEnd) + kv('电池健康', item.batteryHealth !== null && item.batteryHealth !== undefined ? item.batteryHealth + '%' : '') +
        kv('尺码', item.sizeSystem ? item.sizeSystem + ' ' + item.size : item.size) +
        kv('清洗方式', item.washMethod) + kv('上次清洗', item.lastCleanedDate) +
        kv('剩余量', item.remainLevel) + kv('使用频率', item.usageFreq) +
        kv('肤质适配', (item.skinType || []).join('、')) + kv('致敏', item.allergenic) +
        '</div>' +
        (item.kind === 'life'
          ? '<div class="detail-btn-row">' +
          '<button class="btn btn-primary" id="btn-use-plus">' + UI.icon('check', 14) + ' 使用一次（+1）</button>' +
          '<button class="btn btn-ghost" id="btn-use-edit">编辑使用次数</button></div>'
          : item.kind === 'clothing'
            ? '<div class="detail-btn-row"><button class="btn btn-primary" id="btn-wear-plus">' + UI.icon('check', 14) + ' 穿了一次（+1）</button></div>' : '') +
        '<h4 class="detail-sub">使用记录（可单条删除）</h4><div id="usage-log">' +
        UI.usageLogHTML(item) + '</div>' +
        '<h4 class="detail-sub">生命周期流水</h4><div>' +
        (events.length ? events.map(function (e) {
          return '<div class="mini-row"><span class="muted">' + U.escapeHtml(e.date) + '</span>' +
            '<span class="tag">' + U.escapeHtml(e.type) + '</span><span class="flex1">' + U.escapeHtml(e.note || '') + '</span></div>';
        }).join('') : '<p class="empty-hint">暂无流水</p>') + '</div>' +
        '<h4 class="detail-sub">关联账单（词条同步）</h4><div id="linked-bills">' +
        linkedBillsHTML(raw) + '</div>' +
        '</div><div class="detail-side">' +
        '<h4 class="detail-sub">成本分析</h4><div class="detail-kv">' + costRows + '</div>' +
        '<div class="detail-actions">' +
        '<button class="btn btn-primary btn-block" id="btn-edit-item">编辑</button>' +
        '<button class="btn btn-ghost btn-block" id="btn-del-item">删除</button></div></div></div>',
      onMount: function (wrap, close) {
        if (item.images && item.images.length) {
          const box = wrap.querySelector('#detail-imgs');
          item.images.forEach(async function (p) {
            const url = await S.getImageURL(p);
            if (url) { const im = document.createElement('img'); im.src = url; box.appendChild(im); }
          });
        }
        const plus = wrap.querySelector('#btn-use-plus');
        if (plus) plus.addEventListener('click', async function () {
          M.appendUsageLog(raw, 1, 'manual', '手动记录');
          await S.saveItem(raw);
          UI.toast('使用 +1', 'success');
          close(); openItemDetail(id); window.App.refresh();
        });
        const wplus = wrap.querySelector('#btn-wear-plus');
        if (wplus) wplus.addEventListener('click', async function () {
          M.appendUsageLog(raw, 1, 'manual', '手动记录');
          await S.saveItem(raw);
          UI.toast('穿着 +1', 'success');
          close(); openItemDetail(id); window.App.refresh();
        });
        const uedit = wrap.querySelector('#btn-use-edit');
        if (uedit) uedit.addEventListener('click', function () {
          UI.modal({
            title: '编辑使用次数', width: 380,
            bodyHTML: '<p class="muted small">修改会计入一条「修正」记录，可随时删除</p>' +
              '<label class="f-label">累计使用次数</label>' +
              '<input type="number" id="use-total" value="' + (raw.useCount || 0) + '" class="search-input">',
            footerHTML: '<button class="btn btn-ghost" data-x="c">取消</button><button class="btn btn-primary" data-x="s">保存</button>',
            onMount: function (w2, c2) {
              w2.querySelector('[data-x=c]').addEventListener('click', c2);
              w2.querySelector('[data-x=s]').addEventListener('click', async function () {
                const target = Number(w2.querySelector('#use-total').value) || 0;
                const cur = Number(raw.useCount) || 0;
                const diff = target - cur;
                raw.useCount = target;
                if (diff !== 0) {
                  if (!raw.usageLog) raw.usageLog = [];
                  raw.usageLog.push({
                    id: U.uid(), date: U.todayStr(), delta: diff,
                    source: 'edit', note: '手动修正为 ' + target, at: new Date().toISOString()
                  });
                }
                await S.saveItem(raw);
                c2(); close(); openItemDetail(id); window.App.refresh();
              });
            }
          });
        });
        wrap.querySelectorAll('[data-del-log]').forEach(function (b) {
          b.addEventListener('click', async function () {
            const logId = b.getAttribute('data-del-log');
            const entry = (raw.usageLog || []).find(function (l) { return l.id === logId; });
            M.removeUsageLogEntry(raw, logId);
            try {
              await S.saveItem(raw);
            } catch (err) {
              if (entry) M.appendUsageLog(raw, entry.delta, entry.source, entry.note, entry.refId, entry.date);
              UI.toast('删除失败，已还原', 'error');
              return;
            }
            UI.toast('已删除该条记录', 'success');
            close(); openItemDetail(id); window.App.refresh();
          });
        });
        wrap.querySelector('#btn-edit-item').addEventListener('click', function () {
          close(); openItemEditor(id, item.kind);
        });
        wrap.querySelector('#btn-del-item').addEventListener('click', async function () {
          if (await UI.confirmDialog('删除确认', '确定删除「' + item.name + '」？关联的穿搭勾选与使用流水将一并移除。')) {
            await S.removeItem(id); close(); UI.toast('已删除', 'success'); window.App.refresh();
          }
        });
      }
    });
  }

  function row(k, v) { return '<div class="kv-row"><span>' + k + '</span><strong>' + v + '</strong></div>'; }
  function kv(k, v) {
    if (v === undefined || v === null || v === '') return '';
    return '<div class="kv-row"><span>' + k + '</span><strong>' + U.escapeHtml(String(v)) + '</strong></div>';
  }
  function statusLabel(s) {
    return {
      in_use: '在用', idle: '闲置', borrowed: '借出', to_sell: '待出闲置',
      broken: '损坏报废', sold: '已售出', gifted: '已转赠'
    }[s] || s || '在用';
  }

  /* =============== 穿搭日历 =============== */
  let calYear, calMonth;

  /* 温度显示：区间优先（tempMin~tempMax），兼容旧单值 temperature */
  /* 天气描述 → 打卡天气下拉选项（推荐预填用） */
  const WEATHER_FORM_MAP = {
    '晴': '晴', '大部晴': '晴', '多云': '多云', '阴': '阴', '雾': '阴', '雾凇': '阴',
    '毛毛雨': '小雨', '小雨': '小雨', '阵雨': '小雨', '冻雨': '小雨',
    '中雨': '大雨', '大雨': '大雨', '强阵雨': '大雨', '暴雨': '大雨', '雷雨': '大雨', '雷雨冰雹': '大雨',
    '小雪': '雪', '中雪': '雪', '大雪': '雪', '阵雪': '雪', '雪粒': '雪'
  };
  function tempText(o) {
    const hasMin = o.tempMin != null, hasMax = o.tempMax != null;
    if (!hasMin && !hasMax) {
      return o.temperature != null ? o.temperature + '℃' : '';
    }
    const a = hasMin ? Number(o.tempMin) : Number(o.tempMax);
    const b = hasMax ? Number(o.tempMax) : Number(o.tempMin);
    return a === b ? a + '℃' : a + '~' + b + '℃';
  }

  /* 天气 · 穿搭推荐面板（v1.0.8）：温度区间 / 当日锁定 / 已打卡推次日 / 自动定位 */
  async function renderOutfitRec(card) {
    if (!card || !window.Weather) return;
    const db = S.getDB();
    // 今日/明日可手动切换（v1.0.9）：自动切换只做默认值，手动选择覆盖
    const auto = window.Weather.targetDate(db);
    const forced = card.getAttribute('data-force-target') || '';
    const tomorrowStr = (function () { const d = new Date(); d.setDate(d.getDate() + 1); return U.todayStr(d); })();
    const target = forced === 'today' ? { date: U.todayStr(), doneToday: auto.doneToday }
      : forced === 'tomorrow' ? { date: tomorrowStr, doneToday: true }
        : auto;
    const range = await window.Weather.dayRange(target.date, false);
    const rec = window.Weather.recommend(db, range, target.date);
    const dayLabel = target.doneToday ? '明日' : '今日';
    const applyLabel = target.doneToday ? '＋明日' : '＋今日';

    function outfitCard(o) {
      const img = (o.images && o.images[0]) || '';
      return '<div class="rec-card">' +
        (img ? '<img data-path="' + U.escapeHtml(img) + '" alt=""/>'
          : '<div class="rec-noimg">' + UI.icon('shirt', 32) + '</div>') +
        '<div class="rec-name">' + U.escapeHtml(o.occasion || U.cnDate(o.date)) + '</div>' +
        '<div class="muted small">' + U.escapeHtml(o.date || '') +
        (tempText(o) ? ' · ' + tempText(o) : '') + '</div>' +
        '<div class="rec-btns">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-open-outfit="' + U.escapeHtml(o.id) + '">查看</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-use-outfit="' + U.escapeHtml(o.id) + '">' + applyLabel + '</button>' +
        '</div></div>';
    }
    function comboCard(c) {
      const img = (c.images && c.images[0]) || '';
      return '<div class="rec-card">' +
        (img ? '<img data-path="' + U.escapeHtml(img) + '" alt=""/>'
          : '<div class="rec-noimg">' + UI.icon('shirt', 32) + '</div>') +
        '<div class="rec-name">' + U.escapeHtml(c.name) + '</div>' +
        '<div class="rec-tags">' + UI.comboBadges(c) + '</div>' +
        '<div class="rec-btns">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-use-combo="' + U.escapeHtml(c.id) + '">' + applyLabel + '</button>' +
        '</div></div>';
    }

    const rangeText = range && range.min != null
      ? range.min + '~' + range.max + '℃'
      : '—';
    const useToday = target.date === U.todayStr();
    const forLabel = (useToday ? '今日天气' : '明日天气') + ' · ' + target.date +
      ' <span class="seg-toggle">' +
      '<button type="button" class="seg-btn' + (useToday ? ' on' : '') + '" data-force-t="today">今日</button>' +
      '<button type="button" class="seg-btn' + (useToday ? '' : ' on') + '" data-force-t="tomorrow">明日</button></span>';
    const wLeft = '<div class="weather-now"><div class="weather-icon">' +
      UI.iconOrEmoji(range ? (range.icon || 'cloud') : 'cloud', 32) + '</div>' +
      '<div><div class="weather-for">' + forLabel + '</div>' +
      '<div class="weather-temp">' + rangeText + '</div>' +
      '<div class="muted small">' + U.escapeHtml(range ? (range.desc || '') : '未获取到天气') + '</div>' +
      '<div class="muted small">' +
      (range && range.fetchedAt ? '数据刷新：' + U.escapeHtml(range.fetchedAt) : '尚未获取数据') +
      '</div>' +
      '<div class="muted small">' +
      (range ? (range.source === 'manual' ? '手动设定（仅当天有效）' : '自动获取 · 当日首次获取后锁定') : '可手动填入温度区间') +
      '</div>' +
      '<div class="rec-btns" style="justify-content:flex-start;margin-top:6px">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="w-refresh" title="重新获取">' + UI.icon('refresh-cw', 14) + ' 刷新</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="w-manual">' + UI.icon('pencil-line', 14) + ' 手动填入</button>' +
      '</div></div></div>';

    const recHTML = (rec.outfits.length || rec.combos.length)
      ? rec.outfits.map(outfitCard).join('') + rec.combos.map(comboCard).join('')
      : '<p class="muted small">暂无匹配的推荐——多打卡积累穿搭，或给组合设好适配温度/季节</p>';

    card.innerHTML = '<div class="panel-body weather-body">' + wLeft +
      '<div class="weather-recs">' +
      '<div class="weather-rec-title">' + dayLabel + '穿搭推荐（' + rec.season + ' · ' + rangeText + '）</div>' +
      '<div class="rec-strip">' + recHTML + '</div>' +
      '</div></div>';

    card.querySelectorAll('img[data-path]').forEach(async function (img) {
      const url = await S.getImageURL(img.getAttribute('data-path'));
      if (url) img.src = url;
    });

    // 刷新：只有数据真正取到新值才算成功（fetchedAt 变化为准），失败保留上次数据
    // 今日/明日切换（手动选择覆盖自动切换）
    card.querySelectorAll('[data-force-t]').forEach(function (b) {
      b.addEventListener('click', function () {
        card.setAttribute('data-force-target', b.getAttribute('data-force-t'));
        renderOutfitRec(card);
      });
    });

    const refreshBtn = card.querySelector('#w-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', async function () {
      refreshBtn.disabled = true; refreshBtn.textContent = '刷新中…';
      // 用数据序号判定是否真取到新数据（分钟级时间戳会同分钟误判失败）
      const beforeSeq = range && range.seq != null ? range.seq : null;
      const rec = await window.Weather.dayRange(target.date, true);
      renderOutfitRec(card);
      const ok = !!(rec && rec.seq != null && rec.seq !== beforeSeq);
      UI.toast(ok ? '已刷新' : '刷新失败，仍为上次数据', ok ? 'success' : 'error');
    });

    const manBtn = card.querySelector('#w-manual');
    if (manBtn) manBtn.addEventListener('click', function () {
      UI.modal({
        title: '手动填入' + dayLabel + '温度区间', width: 420,
        bodyHTML: '<div class="form-grid">' +
          '<label><span class="f-label">最低 ℃</span><input type="number" id="w-min" value="' +
          (range && range.min != null ? range.min : '') + '"></label>' +
          '<label><span class="f-label">最高 ℃</span><input type="number" id="w-max" value="' +
          (range && range.max != null ? range.max : '') + '"></label></div>' +
          '<p class="muted small">仅 ' + target.date + ' 当天有效，覆盖自动天气；用于穿搭推荐。</p>',
        footerHTML: '<button class="btn btn-ghost" data-x="c">取消</button><button class="btn btn-primary" data-x="s">保存</button>',
        onMount: function (w2, close) {
          w2.querySelector('[data-x=c]').addEventListener('click', close);
          w2.querySelector('[data-x=s]').addEventListener('click', function () {
            const a = Number(w2.querySelector('#w-min').value);
            const b = Number(w2.querySelector('#w-max').value);
            const minEl = w2.querySelector('#w-min');
            const maxEl = w2.querySelector('#w-max');
            if (minEl.value.trim() === '' || maxEl.value.trim() === '') {
              UI.toast('请填写最低和最高温度', 'error'); return;
            }
            if (isNaN(a) || isNaN(b)) { UI.toast('温度必须是数字', 'error'); return; }
            if (a > b) { UI.toast('最低温度不能高于最高温度', 'error'); return; }
            window.Weather.setManual(target.date, a, b);
            close();
            UI.toast('已设定 ' + target.date + ' 温度区间 ' + a + '~' + b + '℃', 'success');
            renderOutfitRec(card);
          });
        }
      });
    });

    card.querySelectorAll('[data-open-outfit]').forEach(function (b) {
      b.addEventListener('click', function () {
        const o = db.outfits.find(function (x) { return x.id === b.getAttribute('data-open-outfit'); });
        if (o) openOutfitEditor(o.date, o);
      });
    });
    card.querySelectorAll('[data-use-outfit]').forEach(function (b) {
      b.addEventListener('click', function () {
        const o = db.outfits.find(function (x) { return x.id === b.getAttribute('data-use-outfit'); });
        if (!o) return;
        openOutfitEditor(target.date, null, {
          itemIds: (o.itemIds || []).slice(), cosmeticIds: (o.cosmeticIds || []).slice(),
          cosmeticQty: Object.assign({}, o.cosmeticQty || {}), occasion: o.occasion || '',
          // 推荐按温度匹配，预填把目标日温度区间一并带上
          tempMin: range ? range.min : null, tempMax: range ? range.max : null,
          weather: WEATHER_FORM_MAP[(range && range.desc) || ''] || ''
        });
      });
    });
    card.querySelectorAll('[data-use-combo]').forEach(function (b) {
      b.addEventListener('click', function () {
        const c = (db.settings.outfitLooks || []).find(function (x) { return x.id === b.getAttribute('data-use-combo'); });
        if (!c) return;
        openOutfitEditor(target.date, null, {
          itemIds: (c.itemIds || []).slice(), cosmeticIds: [], occasion: '',
          tempMin: range ? range.min : null, tempMax: range ? range.max : null,
          weather: WEATHER_FORM_MAP[(range && range.desc) || ''] || ''
        });
      });
    });
  }

  function outfits(root) {
    const db = S.getDB();
    if (!db) return;
    if (calYear === undefined) {
      const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth();
    }
    const key = calYear + '-' + String(calMonth + 1).padStart(2, '0');
    const first = new Date(calYear, calMonth, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const byDate = {};
    db.outfits.forEach(function (o) {
      if (U.monthKey(o.date) === key) {
        if (!byDate[o.date]) byDate[o.date] = [];
        byDate[o.date].push(o);
      }
    });

    let cells = '';
    for (let i = 0; i < startDow; i++) cells += '<div class="cal-cell cal-empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = key + '-' + String(d).padStart(2, '0');
      const outs = byDate[dateStr] || [];
      const isToday = dateStr === U.todayStr();
      // 收集当天所有图片用于轮播（保留记录归属，点图可开对应条目）
      const imgs = [];
      outs.forEach(function (o) { (o.images || []).forEach(function (p) { imgs.push({ p: p, rid: o.id }); }); });
      cells += '<div class="cal-cell' + (isToday ? ' cal-today' : '') + (outs.length ? ' cal-has' : '') + '" data-date="' + dateStr + '">' +
        '<div class="cal-day">' + d + '</div>' +
        (outs.length ? UI.calAddMini() : '') +
        (imgs.length
          ? '<div class="cal-cover" data-carousel=\'' + JSON.stringify(imgs).replace(/'/g, '&#39;') + '\'>' +
          '<img data-path="' + U.escapeHtml(imgs[0].p) + '"/>' +
          (imgs.length > 1
            ? UI.calNav() +
            '<span class="cal-more">1/' + imgs.length + '</span>'
            : '') + '</div>'
          : outs.length
            ? '<div class="cal-outfits">' + outs.map(function (o) {
              return '<div class="cal-outfit-chip" data-open-rec="' + o.id + '"><span>' + ((o.itemIds || []).length) + ' 件' +
                (o.occasion ? ' · ' + U.escapeHtml(o.occasion) : '') + '</span></div>';
            }).join('') + '</div>'
            : UI.calHint()) +
        '</div>';
    }

    root.innerHTML =
      '<div class="page-head"><h2>穿搭日历</h2><div class="page-actions cal-jump">' +
      '<select id="jump-year">' + [calYear - 3, calYear - 2, calYear - 1, calYear, calYear + 1, calYear + 2, calYear + 3].map(function (y) {
        return '<option value="' + y + '"' + (y === calYear ? ' selected' : '') + '>' + y + ' 年</option>';
      }).join('') + '</select>' +
      '<select id="jump-month">' + Array.from({ length: 12 }, function (_, i) {
        return '<option value="' + i + '"' + (i === calMonth ? ' selected' : '') + '>' + (i + 1) + ' 月</option>';
      }).join('') + '</select>' +
      '<button class="btn btn-ghost" id="btn-today">今天</button>' +
      '<button class="btn btn-primary" id="btn-add-outfit">' + UI.icon('calendar-check', 14) + ' 穿搭打卡</button></div></div>' +
      // 天气穿搭推荐已移至「我的主页」（v1.1.2），此处不再重复展示
      '<div class="cal-grid">' +
      ['日', '一', '二', '三', '四', '五', '六'].map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('') +
      cells + '</div>';

    root.querySelector('#jump-year').addEventListener('change', function (e) {
      calYear = Number(e.target.value); outfits(root);
    });
    root.querySelector('#jump-month').addEventListener('change', function (e) {
      calMonth = Number(e.target.value); outfits(root);
    });
    root.querySelector('#btn-today').addEventListener('click', function () {
      const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); outfits(root);
    });
    root.querySelector('#btn-add-outfit').addEventListener('click', function () {
      openOutfitEditor(U.todayStr());
    });
    root.querySelectorAll('.cal-cell[data-date]').forEach(function (cell) {
      cell.addEventListener('click', function (e) {
        const dateStr = cell.getAttribute('data-date');
        const recs = byDate[dateStr] || [];
        if (e.target.closest('[data-nav-dir]')) return; // 轮播按钮不触发
        if (e.target.closest('.cal-add-mini')) { openOutfitEditor(dateStr); return; }
        const chip = e.target.closest('[data-open-rec]');
        if (chip) {
          const rec = recs.find(function (o) { return o.id === chip.getAttribute('data-open-rec'); });
          if (rec) openOutfitEditor(dateStr, rec);
          return;
        }
        const cover = e.target.closest('.cal-cover');
        if (cover) {
          // 点图打开当前轮播图对应的那条记录
          let imgs = [];
          try { imgs = JSON.parse(cover.getAttribute('data-carousel')); } catch (err) { imgs = []; }
          const cur = Number(cover.querySelector('.cal-more') ? (cover.querySelector('.cal-more').textContent.split('/')[0]) - 1 : 0) || 0;
          const hit = imgs[cur] && recs.find(function (o) { return o.id === imgs[cur].rid; });
          if (hit) { openOutfitEditor(dateStr, hit); return; }
          if (recs.length === 1) { openOutfitEditor(dateStr, recs[0]); return; }
          if (!recs.length) { openOutfitEditor(dateStr); return; }
          // 多条且无法定位图片归属 → 落入下方选择器
        }
        if (recs.length === 1) { openOutfitEditor(dateStr, recs[0]); return; }
        if (recs.length > 1) {
          UI.pickRecord('选择要查看的记录 · ' + U.cnDate(dateStr), recs.map(function (o) {
            return {
              id: o.id, thumbPath: (o.images && o.images[0]) || '', icon: 'shirt',
              text: ((o.itemIds || []).length) + ' 件衣服 · ' + ((o.cosmeticIds || []).length) + ' 件妆品' +
                (o.occasion ? ' · ' + o.occasion : ''),
              sub: o.note || o.weather || ''
            };
          }), function (rid) {
            if (rid === null) openOutfitEditor(dateStr);
            else {
              const rec = recs.find(function (o) { return o.id === rid; });
              if (rec) openOutfitEditor(dateStr, rec);
            }
          });
          return;
        }
        openOutfitEditor(dateStr);
      });
    });
    bindImages(root);
    bindCarousels(root);
  }

  /* 日历格内图片轮播 */
  function bindCarousels(root) {
    root.querySelectorAll('.cal-cover[data-carousel]').forEach(function (box) {
      let imgs = [];
      try { imgs = JSON.parse(box.getAttribute('data-carousel')); } catch (e) { imgs = []; }
      if (imgs.length < 2) return;
      let idx = 0;
      const img = box.querySelector('img');
      const label = box.querySelector('.cal-more');
      async function show(i) {
        idx = (i + imgs.length) % imgs.length;
        const url = await S.getImageURL(imgs[idx].p);
        if (url) img.src = url;
        if (label) label.textContent = (idx + 1) + '/' + imgs.length;
      }
      box.querySelectorAll('[data-nav-dir]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          show(idx + Number(btn.getAttribute('data-nav-dir')));
        });
      });
    });
  }

  /* 穿搭组合管理（仅衣服；通用组合管理器：范例图 + 可编辑） */
  function openOutfitLooks(root) {
    const db = S.getDB();
    db.settings.outfitLooks = db.settings.outfitLooks || [];
    const clothes = M.itemsWithComputed(db).filter(function (i) {
      return i.kind === 'clothing' && i.status !== 'sold' && i.status !== 'gifted';
    });
    const items = clothes.map(function (i) {
      const c = (db.categories.clothing || []).find(function (x) { return x.id === i.categoryId; });
      return { id: i.id, name: i.name, brand: i.brand, images: i.images, categoryName: c ? c.name : '其他' };
    });
    UI.comboManager({
      title: '穿搭组合', icon: 'layers', items: items,
      combos: db.settings.outfitLooks,
      onChange: function () { S.saveSettings(); }
    });
  }

  /* 组合快捷卡片（打卡弹窗用）：有范例图显图、无图显图标，点选套用（v1.0.7） */
  function lookStripHTML(list, attr, icon) {
    return '<div class="look-strip">' + list.map(function (lk, i) {
      return '<div class="look-card" data-' + attr + '="' + i + '">' +
        (lk.images && lk.images[0]
          ? '<img data-path="' + U.escapeHtml(lk.images[0]) + '" alt=""/>'
          : '<div class="look-noimg">' + UI.iconOrEmoji(icon, 28) + '</div>') +
        '<div class="look-name">' + U.escapeHtml(lk.name) + '</div>' +
        (UI.comboBadges(lk) ? '<div class="look-tags">' + UI.comboBadges(lk) + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  /* 穿搭打卡编辑器：rec 传入=编辑该条；prefill 传入=按预填新建（推荐套用，v1.0.8） */
  function openOutfitEditor(dateStr, rec, prefill) {
    const db = S.getDB();
    const clothes = M.itemsWithComputed(db).filter(function (i) {
      return i.kind === 'clothing' && i.status !== 'sold' && i.status !== 'gifted';
    });
    const cosmetics = M.itemsWithComputed(db).filter(function (i) {
      return i.kind === 'life' && i.status !== 'sold' && i.status !== 'gifted';
    });
    const catName = function (i) {
      const c = (db.categories[i.kind] || []).find(function (x) { return x.id === i.categoryId; });
      return c ? c.name : '其他';
    };
    const clothPickerItems = clothes.map(function (i) {
      return { id: i.id, name: i.name, brand: i.brand, images: i.images, categoryName: catName(i) };
    });
    // 预加载缩略图 URL（异步填充）
    const existing = rec ? [] : db.outfits.filter(function (o) { return o.date === dateStr; });
    const looks = db.settings.makeupLooks || [];
    const outfitLooks = db.settings.outfitLooks || [];
    const occasions = db.categories.occasion || [];
    const rv = prefill || rec || {};

    UI.modal({
      title: (rec ? '编辑穿搭 · ' : '穿搭打卡 · ') + U.cnDate(dateStr), width: 760,
      bodyHTML:
        (existing.length ? '<div class="existing-outfits">' + existing.map(function (o) {
          return '<div class="mini-row"><span class="flex1">' +
            ((o.itemIds || []).length) + ' 件衣服 · ' + ((o.cosmeticIds || []).length) + ' 件妆品' +
            (o.occasion ? ' · ' + U.escapeHtml(o.occasion) : '') + ' ' + U.escapeHtml(o.note || '') + '</span>' +
            '<button class="btn-icon" data-del-out="' + o.id + '" title="删除">' + UI.icon('trash-2', 14) + '</button></div>';
        }).join('') + '</div>' : '') +
        '<form id="outfit-form"><div class="form-grid">' +
        '<label><span class="f-label">场合（选填）</span><select name="occasion"><option value="">（不指定）</option>' +
        occasions.map(function (o) {
          return '<option value="' + U.escapeHtml(o) + '"' + (rv.occasion === o ? ' selected' : '') + '>' + U.escapeHtml(o) + '</option>';
        }).join('') + '</select></label>' +
        '<label><span class="f-label">天气（选填）</span><select name="weather"><option value="">（不指定）</option>' +
        ['晴', '多云', '阴', '小雨', '大雨', '雪', '风'].map(function (w) {
          return '<option value="' + w + '"' + (rv.weather === w ? ' selected' : '') + '>' + w + '</option>';
        }).join('') + '</select></label>' +
        '<label><span class="f-label">温度区间 ℃（选填）</span><div class="tag-add-row">' +
        '<input type="number" name="tempMin" placeholder="最低" style="width:88px" value="' +
        (rv.tempMin != null ? rv.tempMin : (rv.temperature != null ? rv.temperature : '')) + '">' +
        '<span class="muted">~</span>' +
        '<input type="number" name="tempMax" placeholder="最高" style="width:88px" value="' +
        (rv.tempMax != null ? rv.tempMax : (rv.temperature != null ? rv.temperature : '')) + '"></div></label>' +
        '<label class="f-full"><span class="f-label">备注（选填）</span><input name="note" value="' + U.escapeHtml(rv.note || '') + '"></label>' +
        '</div>' +
        '<h4 class="detail-sub">' + UI.icon('shirt', 14) + ' 勾选这天穿的衣服</h4>' +
        (outfitLooks.length ? lookStripHTML(outfitLooks, 'olook', 'shirt') : '') +
        '<div id="cloth-picker"></div>' +
        '<h4 class="detail-sub">' + UI.icon('sparkles', 14) + ' 勾选这天用的妆品（自动计一次使用）</h4>' +
        (looks.length ? lookStripHTML(looks, 'look', 'sparkles') : '') +
        '<div id="cos-picker"></div><div id="cos-qty"></div>' +
        '<h4 class="detail-sub">' + UI.icon('camera', 14) + ' OOTD 照片（有图日历将显示大图）</h4>' +
        '<div id="outfit-imgs"></div>' +
        '</form>',
      footerHTML: (rec ? '<button class="btn btn-danger" data-act="del">删除</button>' : '') +
        '<button class="btn btn-ghost" data-act="cancel">关闭</button><button class="btn btn-primary" data-act="save">保存打卡</button>',
      onMount: function (wrap, close) {
        const cosItems = cosmetics.map(function (i) {
          return { id: i.id, name: i.name, brand: i.brand, shade: i.shade, images: i.images, categoryName: catName(i) };
        });
        let clothPick = UI.picker(wrap.querySelector('#cloth-picker'), clothPickerItems, (rv.itemIds || []).slice(), {});
        // 妆品使用次数（v1.0.9）：勾选后可调当天使用次数（默认 1，可到 99）
        const cosQty = Object.assign({}, rv.cosmeticQty || {});
        function renderCosQty() {
          const box = wrap.querySelector('#cos-qty');
          const sel = cosPick.getSelected();
          if (!sel.length) { box.innerHTML = ''; return; }
          box.innerHTML = '<div class="cos-qty-list"><div class="muted small">使用次数（一天可用多次）</div>' +
            sel.map(function (id) {
              const it = cosmetics.find(function (x) { return x.id === id; }) || {};
              const q = Math.max(1, Number(cosQty[id]) || 1);
              return '<div class="cos-qty-row"><span class="flex1">' + U.escapeHtml(it.name || '') + '</span>' +
                '<button type="button" class="btn-icon" data-q-dec="' + U.escapeHtml(id) + '" title="减少使用次数（0=不计）">' + UI.icon('minus', 13) + '</button>' +
                '<span class="cos-qty-n">' + q + ' 次' + (q === 0 ? ' <span class="muted small">不计</span>' : '') + '</span>' +
                '<button type="button" class="btn-icon" data-q-inc="' + U.escapeHtml(id) + '" title="增加使用次数">' + UI.icon('plus', 13) + '</button></div>';
            }).join('') + '</div>';
          box.querySelectorAll('[data-q-inc]').forEach(function (b) {
            b.addEventListener('click', function () {
              const id = b.getAttribute('data-q-inc');
              cosQty[id] = Math.min(99, Math.max(1, Number(cosQty[id]) || 1) + 1);
              renderCosQty();
            });
          });
          box.querySelectorAll('[data-q-dec]').forEach(function (b) {
            b.addEventListener('click', function () {
              const id = b.getAttribute('data-q-dec');
              cosQty[id] = Math.max(0, Math.max(1, Number(cosQty[id]) || 1) - 1);
              renderCosQty();
            });
          });
        }
        let cosPick = UI.picker(wrap.querySelector('#cos-picker'), cosItems, (rv.cosmeticIds || []).slice(), { icon: 'sparkles', onChange: renderCosQty });
        renderCosQty();
        // 缩略图由 UI.picker 内部统一异步解析（v1.0.7），此处无需再补丁重绘
        // 组合卡片范例图
        wrap.querySelectorAll('.look-card img[data-path]').forEach(async function (img) {
          const url = await S.getImageURL(img.getAttribute('data-path'));
          if (url) img.src = url;
        });

        wrap.querySelectorAll('[data-look]').forEach(function (b) {
          b.addEventListener('click', function () {
            const lk = looks[Number(b.getAttribute('data-look'))];
            if (!lk) return;
            const cur = cosPick.getSelected();
            lk.itemIds.forEach(function (id) { if (cur.indexOf(id) < 0) cur.push(id); });
            cosPick.setSelected(cur);
            b.classList.add('on');
            UI.toast('已套用妆容：' + lk.name, 'success');
          });
        });
        wrap.querySelectorAll('[data-olook]').forEach(function (b) {
          b.addEventListener('click', function () {
            const lk = outfitLooks[Number(b.getAttribute('data-olook'))];
            if (!lk) return;
            const cur = clothPick.getSelected();
            (lk.itemIds || []).forEach(function (id) { if (cur.indexOf(id) < 0) cur.push(id); });
            clothPick.setSelected(cur);
            b.classList.add('on');
            UI.toast('已套用穿搭：' + lk.name, 'success');
          });
        });
        wrap.querySelectorAll('[data-del-out]').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            if (!await UI.confirmDialog('删除穿搭', '删除这条穿搭记录？妆品使用次数将同步撤销。')) return;
            await S.removeOutfit(btn.getAttribute('data-del-out'));
            close(); UI.toast('已删除', 'success'); openOutfitEditor(dateStr);
          });
        });
        const uploader = UI.imageUploader(wrap.querySelector('#outfit-imgs'), { paths: (rv.images || []).slice() });
        if (rec) {
          wrap.querySelector('[data-act=del]').addEventListener('click', async function () {
            if (!await UI.confirmDialog('删除穿搭', '删除这条穿搭记录？妆品使用次数将同步撤销。')) return;
            await S.removeOutfit(rec.id);
            close(); UI.toast('已删除', 'success'); window.App.refresh();
          });
        }
        wrap.querySelector('[data-act=cancel]').addEventListener('click', function () { close(); window.App.refresh(); });
        wrap.querySelector('[data-act=save]').addEventListener('click', async function () {
          const fd = new FormData(wrap.querySelector('#outfit-form'));
          const itemIds = clothPick.getSelected();
          const cosmeticIds = cosPick.getSelected();
          if (!itemIds.length && !cosmeticIds.length) {
            UI.toast('至少勾选一件衣服或妆品', 'error'); return;
          }
          // 温度区间校验（与天气手填/组合区间同一标准）
          const tMinV = fd.get('tempMin'), tMaxV = fd.get('tempMax');
          if (tMinV !== '' && tMaxV !== '' && Number(tMinV) > Number(tMaxV)) {
            UI.toast('温度区间：最低不能高于最高', 'error'); return;
          }
          const btn = wrap.querySelector('[data-act=save]');
          btn.disabled = true;
          try {
            const images = await uploader.finalize();
            await S.saveOutfit({
              id: rec ? rec.id : U.uid(), date: dateStr,
              occasion: fd.get('occasion') || '', weather: fd.get('weather') || '',
              tempMin: fd.get('tempMin') === '' ? null : Number(fd.get('tempMin')),
              tempMax: fd.get('tempMax') === '' ? null : Number(fd.get('tempMax')),
              note: (fd.get('note') || '').trim(),
              itemIds: itemIds, cosmeticIds: cosmeticIds, images: images,
              cosmeticQty: (function () {
                const m = {};
                cosmeticIds.forEach(function (id) {
                  const q = cosQty[id] != null ? Math.floor(Number(cosQty[id])) : 1;
                  m[id] = Math.min(99, Math.max(0, isNaN(q) ? 1 : q));
                });
                return m;
              })()
            });
            // 妆品使用 +1 已在存储层处理
            close(); UI.toast(rec ? '已保存' : '打卡成功', 'success'); window.App.refresh();
          } catch (e) {
            UI.toast('保存失败：' + e.message, 'error'); btn.disabled = false;
          }
        });
      }
    });
  }

  return {
    items: items, outfits: outfits,
    openItemEditor: openItemEditor, openItemDetail: openItemDetail,
    openOutfitEditor: openOutfitEditor, renderOutfitRec: renderOutfitRec
  };
})();
