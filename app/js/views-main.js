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
  const itemState = { kind: null, filterCat: '', filterStatus: '', search: '' };

  function items(root, kind) {
    if (itemState.kind !== kind) {
      itemState.kind = kind; itemState.filterCat = ''; itemState.filterStatus = ''; itemState.search = '';
    }
    const db = S.getDB();
    if (!db) return;
    const cats = UI.catsFor(db, kind);
    const kinds = kind === 'digital' ? ['device', 'game'] : [kind];
    const all = M.itemsWithComputed(db).filter(function (i) { return kinds.indexOf(i.kind) >= 0; });
    let list = all;
    if (itemState.filterCat) list = list.filter(function (i) { return i.categoryId === itemState.filterCat || i.subCategoryId === itemState.filterCat; });
    if (itemState.filterStatus) list = list.filter(function (i) { return (i.status || 'in_use') === itemState.filterStatus; });
    if (itemState.search) {
      const q = itemState.search.toLowerCase();
      list = list.filter(function (i) {
        return (i.name || '').toLowerCase().indexOf(q) >= 0 || (i.brand || '').toLowerCase().indexOf(q) >= 0 ||
          (i.notes || '').toLowerCase().indexOf(q) >= 0 || (i.shade || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    list = list.slice().sort(function (a, b) { return (b.purchaseDate || '').localeCompare(a.purchaseDate || ''); });

    const titles = { digital: '我的数码', clothing: '我的衣橱' };
    const icons = { digital: '🎮', clothing: '👕' };

    root.innerHTML =
      '<div class="page-head"><h2>' + titles[kind] + '</h2><div class="page-actions">' +
      '<button class="btn btn-primary" id="btn-add-item">＋ 添加' + (kind === 'digital' ? '数码' : '衣服') + '</button></div></div>' +
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
      '<span class="count-label">共 ' + list.length + ' 件</span></div>' +
      (list.length
        ? '<div class="item-grid">' + list.map(function (i) {
          return UI.itemCard(i, { icon: icons[kind], quickAdd: kind === 'clothing' });
        }).join('') + '</div>'
        : '<div class="empty-state"><div class="empty-icon">' + icons[kind] + '</div><p>还没有记录</p></div>');

    root.querySelector('#btn-add-item').addEventListener('click', function () { openItemEditor(null, kind); });
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
    const item = id ? Object.assign({}, db.items.find(function (i) { return i.id === id; })) : {
      id: U.uid(), kind: kind === 'digital' ? 'device' : kind,
      status: 'in_use', purchaseDate: U.todayStr(), images: [], gameStatus: 'unopened', useCount: 0
    };
    if (!item) return;
    const formKind = kind || item.kind;
    UI.modal({
      title: (id ? '编辑' : '添加') + (formKind === 'digital' ? '数码' : formKind === 'life' ? '生活' : kindLabel(item.kind || formKind)),
      width: 720,
      bodyHTML: '<form id="item-form">' + UI.itemFormHTML(db, item, formKind) + '</form>',
      footerHTML: '<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存</button>',
      onMount: function (wrap, close) {
        const form = wrap.querySelector('#item-form');
        UI.bindFormToggles(form, db, formKind);
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
          ? '<button class="btn btn-primary btn-sm" id="btn-use-plus">✓ 使用一次（+1）</button>' +
          '<button class="btn btn-ghost btn-sm" id="btn-use-edit" style="margin-left:8px">编辑使用次数</button>'
          : item.kind === 'clothing'
            ? '<button class="btn btn-primary btn-sm" id="btn-wear-plus">✓ 穿了一次（+1）</button>' : '') +
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
    return '<div class="kv-row"><span>' + k + '</span><span>' + U.escapeHtml(String(v)) + '</span></div>';
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
      // 收集当天所有图片用于轮播
      const imgs = [];
      outs.forEach(function (o) { (o.images || []).forEach(function (p) { imgs.push(p); }); });
      cells += '<div class="cal-cell' + (isToday ? ' cal-today' : '') + (outs.length ? ' cal-has' : '') + '" data-date="' + dateStr + '">' +
        '<div class="cal-day">' + d + '</div>' +
        (imgs.length
          ? '<div class="cal-cover" data-carousel=\'' + JSON.stringify(imgs) + '\'>' +
          '<img data-path="' + U.escapeHtml(imgs[0]) + '"/>' +
          (imgs.length > 1
            ? '<button class="cal-nav prev" data-nav-dir="-1">‹</button>' +
            '<button class="cal-nav next" data-nav-dir="1">›</button>' +
            '<span class="cal-more">1/' + imgs.length + '</span>'
            : '') + '</div>'
          : outs.length
            ? '<div class="cal-outfits">' + outs.map(function (o) {
              return '<div class="cal-outfit-chip"><span>' + ((o.itemIds || []).length) + ' 件' +
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
      '<button class="btn btn-primary" id="btn-add-outfit">＋ 今日打卡</button></div></div>' +
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
        if (e.target.closest('[data-nav-dir]')) return; // 轮播按钮不触发打卡
        openOutfitEditor(cell.getAttribute('data-date'));
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
        const url = await S.getImageURL(imgs[idx]);
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

  /* 穿搭打卡编辑器：大图、分类勾选、妆容整合 */
  function openOutfitEditor(dateStr) {
    const db = S.getDB();
    const clothes = M.itemsWithComputed(db).filter(function (i) {
      return i.kind === 'clothing' && i.status !== 'sold' && i.status !== 'gifted';
    });
    const cosmetics = M.itemsWithComputed(db).filter(function (i) {
      return i.kind === 'life' && i.status !== 'sold' && i.status !== 'dropped';
    });
    const catName = function (i) {
      const c = (db.categories[i.kind] || []).find(function (x) { return x.id === i.categoryId; });
      return c ? c.name : '其他';
    };
    const clothPickerItems = clothes.map(function (i) {
      return { id: i.id, name: i.name, brand: i.brand, thumb: i.images && i.images[0] ? null : null, images: i.images, categoryName: catName(i) };
    });
    // 预加载缩略图 URL（异步填充）
    const existing = db.outfits.filter(function (o) { return o.date === dateStr; });
    const looks = db.settings.makeupLooks || [];
    const occasions = db.categories.occasion || [];

    UI.modal({
      title: '穿搭打卡 · ' + U.cnDate(dateStr), width: 760,
      bodyHTML:
        (existing.length ? '<div class="existing-outfits">' + existing.map(function (o) {
          return '<div class="mini-row"><span class="flex1">' +
            ((o.itemIds || []).length) + ' 件衣服 · ' + ((o.cosmeticIds || []).length) + ' 件妆品' +
            (o.occasion ? ' · ' + U.escapeHtml(o.occasion) : '') + ' ' + U.escapeHtml(o.note || '') + '</span>' +
            '<button class="btn-icon" data-del-out="' + o.id + '" title="删除">×</button></div>';
        }).join('') + '</div>' : '') +
        '<form id="outfit-form"><div class="form-grid">' +
        '<label><span class="f-label">场合（选填）</span><select name="occasion"><option value="">（不指定）</option>' +
        occasions.map(function (o) { return '<option value="' + U.escapeHtml(o) + '">' + U.escapeHtml(o) + '</option>'; }).join('') + '</select></label>' +
        '<label><span class="f-label">天气（选填）</span><select name="weather">' +
        ['晴', '多云', '阴', '小雨', '大雨', '雪', '风'].map(function (w) { return '<option value="' + w + '">' + w + '</option>'; }).join('') + '</select></label>' +
        '<label><span class="f-label">温度 ℃</span><input type="number" name="temperature"></label>' +
        '<label class="f-full"><span class="f-label">备注（选填）</span><input name="note"></label>' +
        '</div>' +
        '<h4 class="detail-sub">👗 勾选今天穿的衣服</h4>' +
        '<div id="cloth-picker"></div>' +
        '<h4 class="detail-sub">💄 勾选今天用的妆品（自动计一次使用）</h4>' +
        (looks.length ? '<div class="chip-row" style="margin-bottom:8px">' + looks.map(function (lk, i) {
          return '<button type="button" class="btn btn-ghost btn-sm" data-look="' + i + '">✨ ' + U.escapeHtml(lk.name) + '</button>';
        }).join('') + '</div>' : '') +
        '<div id="cos-picker"></div>' +
        '<h4 class="detail-sub">📷 OOTD 照片（有图日历将显示大图）</h4>' +
        '<div id="outfit-imgs"></div>' +
        '</form>',
      footerHTML: '<button class="btn btn-ghost" data-act="cancel">关闭</button><button class="btn btn-primary" data-act="save">保存打卡</button>',
      onMount: function (wrap, close) {
        const cosItems = cosmetics.map(function (i) {
          return { id: i.id, name: i.name, brand: i.brand, shade: i.shade, images: i.images, thumb: null, categoryName: catName(i) };
        });
        let clothPick = UI.picker(wrap.querySelector('#cloth-picker'), clothPickerItems, [], {});
        let cosPick = UI.picker(wrap.querySelector('#cos-picker'), cosItems, [], { icon: '💄' });
        // 异步填充缩略图后重绘
        async function fillThumbs(items, mapTo) {
          for (const it of items) {
            if (it.images && it.images[0]) mapTo[it.id] = await S.getImageURL(it.images[0]);
          }
        }
        const clothThumbs = {}, cosThumbs = {};
        Promise.all([fillThumbs(clothes, clothThumbs), fillThumbs(cosmetics, cosThumbs)]).then(function () {
          clothPickerItems.forEach(function (i) { i.thumb = clothThumbs[i.id] || null; });
          cosItems.forEach(function (i) { i.thumb = cosThumbs[i.id] || null; });
          clothPick = UI.picker(wrap.querySelector('#cloth-picker'), clothPickerItems, clothPick.getSelected(), {});
          cosPick = UI.picker(wrap.querySelector('#cos-picker'), cosItems, cosPick.getSelected(), { icon: '💄' });
        });

        wrap.querySelectorAll('[data-look]').forEach(function (b) {
          b.addEventListener('click', function () {
            const lk = looks[Number(b.getAttribute('data-look'))];
            if (!lk) return;
            const cur = cosPick.getSelected();
            lk.itemIds.forEach(function (id) { if (cur.indexOf(id) < 0) cur.push(id); });
            cosPick.setSelected(cur);
            UI.toast('已套用妆容：' + lk.name, 'success');
          });
        });
        wrap.querySelectorAll('[data-del-out]').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            await S.removeOutfit(btn.getAttribute('data-del-out'));
            close(); UI.toast('已删除', 'success'); openOutfitEditor(dateStr);
          });
        });
        const uploader = UI.imageUploader(wrap.querySelector('#outfit-imgs'), {});
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
              id: U.uid(), date: dateStr,
              occasion: fd.get('occasion') || '', weather: fd.get('weather') || '',
              temperature: fd.get('temperature') === '' ? null : Number(fd.get('temperature')),
              note: (fd.get('note') || '').trim(),
              itemIds: itemIds, cosmeticIds: cosmeticIds, images: images
            });
            // 妆品使用 +1 已在存储层处理
            close(); UI.toast('打卡成功', 'success'); window.App.refresh();
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
