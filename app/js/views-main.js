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
  const itemState = { kind: null, filterCat: '', filterStatus: '', filterTag: '', search: '' };

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
    list = list.slice().sort(function (a, b) { return (b.purchaseDate || '').localeCompare(a.purchaseDate || ''); });
    // 标签筛选候选：本类物品用过的全部标签（v1.0.7）
    const tagOptions = [];
    all.forEach(function (i) {
      (i.tags || []).forEach(function (t) { if (t && tagOptions.indexOf(t) < 0) tagOptions.push(t); });
    });
    tagOptions.sort();

    const titles = { digital: '我的数码', clothing: '我的衣橱' };
    const icons = { digital: '🎮', clothing: '👕' };

    root.innerHTML =
      '<div class="page-head"><h2>' + titles[kind] + '</h2><div class="page-actions">' +
      (kind === 'clothing' ? '<button class="btn btn-ghost" id="btn-outfit-looks">👗 穿搭组合</button>' : '') +
      '<button class="btn btn-primary" id="btn-add-item">＋ 记' + (kind === 'digital' ? '数码' : '衣服') + '</button></div></div>' +
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
      '<span class="count-label">共 ' + list.length + ' 件</span></div>' +
      (list.length
        ? '<div class="item-grid">' + list.map(function (i) {
          return UI.itemCard(i, { icon: icons[kind], quickAdd: kind === 'clothing' });
        }).join('') + '</div>'
        : '<div class="empty-state"><div class="empty-icon">' + icons[kind] + '</div><p>还没有记录</p></div>');

    root.querySelector('#btn-add-item').addEventListener('click', function () { openItemEditor(null, kind); });
    const btnLooks = root.querySelector('#btn-outfit-looks');
    if (btnLooks) btnLooks.addEventListener('click', function () { openOutfitLooks(root); });
    root.querySelector('#item-search').addEventListener('input', U.debounce(function (e) {
      itemState.search = e.target.value;
      items(root, kind);
      const inp = root.querySelector('#item-search');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
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
        await S.saveItem(it);
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
      bodyHTML: '<form id="item-form">' + UI.itemFormHTML(db, item, formKind) + '</form>',
      footerHTML: '<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存</button>',
      onMount: function (wrap, close) {
        const form = wrap.querySelector('#item-form');
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
            await S.saveItem(data);
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
  function openItemDetail(id) {
    const db = S.getDB();
    const raw = db.items.find(function (i) { return i.id === id; });
    if (!raw) return;
    const item = M.itemsWithComputed(db).find(function (i) { return i.id === id; });
    const cost = item.cost;
    const events = db.events.filter(function (e) { return e.itemId === id; })
      .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    const lifeS = item.kind === 'life' ? M.lifeStatus(item) : null;

    let costRows =
      row('购买价格', U.formatMoney(item.purchasePrice)) +
      row('持有天数', cost.heldDays + ' 天') +
      row('总投入', U.formatMoney(cost.invested)) +
      row('日均成本', U.formatCost(cost.dailyCost) + ' / 天');
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
          '<button class="btn btn-primary" id="btn-use-plus">✓ 使用一次（+1）</button>' +
          '<button class="btn btn-ghost" id="btn-use-edit">编辑使用次数</button></div>'
          : item.kind === 'clothing'
            ? '<div class="detail-btn-row"><button class="btn btn-primary" id="btn-wear-plus">✓ 穿了一次（+1）</button></div>' : '') +
        '<h4 class="detail-sub">使用记录（可单条删除）</h4><div id="usage-log">' +
        UI.usageLogHTML(item) + '</div>' +
        '<h4 class="detail-sub">生命周期流水</h4><div>' +
        (events.length ? events.map(function (e) {
          return '<div class="mini-row"><span class="muted">' + U.escapeHtml(e.date) + '</span>' +
            '<span class="tag">' + U.escapeHtml(e.type) + '</span><span class="flex1">' + U.escapeHtml(e.note || '') + '</span></div>';
        }).join('') : '<p class="empty-hint">暂无流水</p>') + '</div>' +
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
            M.removeUsageLogEntry(raw, b.getAttribute('data-del-log'));
            await S.saveItem(raw);
            UI.toast('已删除该条记录', 'success');
            close(); openItemDetail(id); window.App.refresh();
          });
        });
        wrap.querySelector('#btn-edit-item').addEventListener('click', function () {
          close(); openItemEditor(id, item.kind);
        });
        wrap.querySelector('#btn-del-item').addEventListener('click', async function () {
          if (await UI.confirmDialog('删除确认', '确定删除「' + item.name + '」？')) {
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
        (outs.length ? '<button class="cal-add-mini" title="再记一条">＋</button>' : '') +
        (imgs.length
          ? '<div class="cal-cover" data-carousel=\'' + JSON.stringify(imgs).replace(/'/g, '&#39;') + '\'>' +
          '<img data-path="' + U.escapeHtml(imgs[0].p) + '"/>' +
          (imgs.length > 1
            ? '<button class="cal-nav prev" data-nav-dir="-1">‹</button>' +
            '<button class="cal-nav next" data-nav-dir="1">›</button>' +
            '<span class="cal-more">1/' + imgs.length + '</span>'
            : '') + '</div>'
          : outs.length
            ? '<div class="cal-outfits">' + outs.map(function (o) {
              return '<div class="cal-outfit-chip" data-open-rec="' + o.id + '"><span>' + ((o.itemIds || []).length) + ' 件' +
                (o.occasion ? ' · ' + U.escapeHtml(o.occasion) : '') + '</span></div>';
            }).join('') + '</div>'
            : '<div class="cal-hint">＋</div>') +
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
      '<button class="btn btn-primary" id="btn-add-outfit">👗 穿搭打卡</button></div></div>' +
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
              id: o.id, thumbPath: (o.images && o.images[0]) || '', icon: '👗',
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
      title: '👗 穿搭组合', icon: '👗', items: items,
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
          : '<div class="look-noimg">' + icon + '</div>') +
        '<div class="look-name">' + U.escapeHtml(lk.name) + '</div>' +
        (UI.comboBadges(lk) ? '<div class="look-tags">' + UI.comboBadges(lk) + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  /* 穿搭打卡编辑器：大图、分类勾选、妆容整合（rec 传入=编辑该条） */
  function openOutfitEditor(dateStr, rec) {
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
    const rv = rec || {};

    UI.modal({
      title: (rec ? '编辑穿搭 · ' : '穿搭打卡 · ') + U.cnDate(dateStr), width: 760,
      bodyHTML:
        (existing.length ? '<div class="existing-outfits">' + existing.map(function (o) {
          return '<div class="mini-row"><span class="flex1">' +
            ((o.itemIds || []).length) + ' 件衣服 · ' + ((o.cosmeticIds || []).length) + ' 件妆品' +
            (o.occasion ? ' · ' + U.escapeHtml(o.occasion) : '') + ' ' + U.escapeHtml(o.note || '') + '</span>' +
            '<button class="btn-icon" data-del-out="' + o.id + '" title="删除">×</button></div>';
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
        '<label><span class="f-label">温度 ℃</span><input type="number" name="temperature" value="' + (rv.temperature == null ? '' : rv.temperature) + '"></label>' +
        '<label class="f-full"><span class="f-label">备注（选填）</span><input name="note" value="' + U.escapeHtml(rv.note || '') + '"></label>' +
        '</div>' +
        '<h4 class="detail-sub">👗 勾选这天穿的衣服</h4>' +
        (outfitLooks.length ? lookStripHTML(outfitLooks, 'olook', '👗') : '') +
        '<div id="cloth-picker"></div>' +
        '<h4 class="detail-sub">💄 勾选这天用的妆品（自动计一次使用）</h4>' +
        (looks.length ? lookStripHTML(looks, 'look', '✨') : '') +
        '<div id="cos-picker"></div>' +
        '<h4 class="detail-sub">📷 OOTD 照片（有图日历将显示大图）</h4>' +
        '<div id="outfit-imgs"></div>' +
        '</form>',
      footerHTML: (rec ? '<button class="btn btn-danger" data-act="del">删除</button>' : '') +
        '<button class="btn btn-ghost" data-act="cancel">关闭</button><button class="btn btn-primary" data-act="save">保存打卡</button>',
      onMount: function (wrap, close) {
        const cosItems = cosmetics.map(function (i) {
          return { id: i.id, name: i.name, brand: i.brand, shade: i.shade, images: i.images, categoryName: catName(i) };
        });
        let clothPick = UI.picker(wrap.querySelector('#cloth-picker'), clothPickerItems, (rv.itemIds || []).slice(), {});
        let cosPick = UI.picker(wrap.querySelector('#cos-picker'), cosItems, (rv.cosmeticIds || []).slice(), { icon: '💄' });
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
          const btn = wrap.querySelector('[data-act=save]');
          btn.disabled = true;
          try {
            const images = await uploader.finalize();
            await S.saveOutfit({
              id: rec ? rec.id : U.uid(), date: dateStr,
              occasion: fd.get('occasion') || '', weather: fd.get('weather') || '',
              temperature: fd.get('temperature') === '' ? null : Number(fd.get('temperature')),
              note: (fd.get('note') || '').trim(),
              itemIds: itemIds, cosmeticIds: cosmeticIds, images: images
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
    openOutfitEditor: openOutfitEditor
  };
})();
