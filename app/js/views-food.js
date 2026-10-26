/* views-food.js — 美食日历（记录型：菜系+餐别+价格必填，日历仅大图轮播） */
window.FoodView = (function () {
  const U = window.Utils;
  const M = window.Models;
  const S = window.Storage;
  const UI = window.UI;

  let calYear, calMonth;

  function render(root) {
    const db = S.getDB();
    if (!db) return;
    if (calYear === undefined) {
      const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth();
    }
    const key = calYear + '-' + String(calMonth + 1).padStart(2, '0');
    const startDow = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const byDate = {};
    db.food.forEach(function (r) {
      if (U.monthKey(r.date) === key) {
        if (!byDate[r.date]) byDate[r.date] = [];
        byDate[r.date].push(r);
      }
    });

    let cells = '';
    for (let i = 0; i < startDow; i++) cells += '<div class="cal-cell cal-empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = key + '-' + String(d).padStart(2, '0');
      const recs = byDate[dateStr] || [];
      const isToday = dateStr === U.todayStr();
      const imgs = [];
      recs.forEach(function (r) { (r.images || []).forEach(function (p) { imgs.push(p); }); });
      cells += '<div class="cal-cell' + (isToday ? ' cal-today' : '') + (recs.length ? ' cal-has' : '') + '" data-date="' + dateStr + '">' +
        '<div class="cal-day">' + d + '</div>' +
        (imgs.length
          ? '<div class="cal-cover" data-carousel=\'' + JSON.stringify(imgs) + '\'>' +
          '<img data-path="' + U.escapeHtml(imgs[0]) + '"/>' +
          (imgs.length > 1
            ? '<button class="cal-nav prev" data-nav-dir="-1">‹</button>' +
            '<button class="cal-nav next" data-nav-dir="1">›</button>' +
            '<span class="cal-more">1/' + imgs.length + '</span>'
            : '') + '</div>'
          : recs.length
            ? '<div class="cal-outfits">' + recs.map(function (r) {
              return '<div class="cal-outfit-chip"><span>' + U.escapeHtml(r.meal || '') + ' · ' +
                U.escapeHtml(r.name || r.foodCuisine || '') + '</span></div>';
            }).join('') + '</div>'
            : '<div class="cal-hint">＋</div>') +
        '</div>';
    }

    root.innerHTML =
      '<div class="page-head"><h2>美食日历</h2><div class="page-actions cal-jump">' +
      '<select id="food-year">' + [calYear - 3, calYear - 2, calYear - 1, calYear, calYear + 1, calYear + 2, calYear + 3].map(function (y) {
        return '<option value="' + y + '"' + (y === calYear ? ' selected' : '') + '>' + y + ' 年</option>';
      }).join('') + '</select>' +
      '<select id="food-month">' + Array.from({ length: 12 }, function (_, i) {
        return '<option value="' + i + '"' + (i === calMonth ? ' selected' : '') + '>' + (i + 1) + ' 月</option>';
      }).join('') + '</select>' +
      '<button class="btn btn-ghost" id="food-today">今天</button>' +
      '<button class="btn btn-primary" id="btn-add-food">＋ 记一餐</button></div></div>' +
      '<div class="cal-grid">' +
      ['日', '一', '二', '三', '四', '五', '六'].map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('') +
      cells + '</div>' +
      '<p class="muted pad-8">点击日期记录或查看当天餐食；单日多图可用箭头切换。</p>';

    root.querySelector('#food-year').addEventListener('change', function (e) { calYear = Number(e.target.value); render(root); });
    root.querySelector('#food-month').addEventListener('change', function (e) { calMonth = Number(e.target.value); render(root); });
    root.querySelector('#food-today').addEventListener('click', function () {
      const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); render(root);
    });
    root.querySelector('#btn-add-food').addEventListener('click', function () { openEditor(U.todayStr(), null); });
    root.querySelectorAll('.cal-cell[data-date]').forEach(function (cell) {
      cell.addEventListener('click', function (e) {
        if (e.target.closest('[data-nav-dir]')) return;
        openEditor(cell.getAttribute('data-date'), null);
      });
    });
    root.querySelectorAll('img[data-path]').forEach(async function (img) {
      const url = await S.getImageURL(img.getAttribute('data-path'));
      if (url) img.src = url;
    });
    bindCarousels(root);
  }

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

  function openEditor(dateStr, rec) {
    const db = S.getDB();
    const existing = db.food.filter(function (f) { return f.date === dateStr; });
    const cuisines = db.categories.foodCuisine || [];
    const types = db.categories.foodType || [];
    const meals = db.categories.meal || [];
    const tags = db.categories.foodTag || [];
    rec = rec || {
      id: U.uid(), date: dateStr, meal: '', foodCuisine: '', foodType: '', name: '', price: '',
      tags: [], rating: 0, location: '', note: '', calories: '', fullness: '', images: []
    };

    UI.modal({
      title: '记一餐 · ' + U.cnDate(dateStr), width: 700,
      bodyHTML:
        (existing.length ? '<div class="existing-outfits">' + existing.map(function (f) {
          return '<div class="mini-row"><span class="flex1">' + U.escapeHtml(f.meal || '') + ' · ' +
            U.escapeHtml(f.foodCuisine || '') + (f.foodType ? ' / ' + U.escapeHtml(f.foodType) : '') +
            ' · ' + U.escapeHtml(f.name || '') + ' · ' + U.formatMoney(f.price) + '</span>' +
            '<button class="btn-icon" data-edit-food="' + f.id + '" title="编辑">✎</button>' +
            '<button class="btn-icon" data-del-food="' + f.id + '">×</button></div>';
        }).join('') + '</div>' : '') +
        '<form id="food-form"><div class="form-grid">' +
        '<label><span class="f-label">菜系 <span class="req-star"> *</span></span>' +
        '<select name="foodCuisine"><option value="">请选择</option>' +
        cuisines.map(function (t) {
          return '<option value="' + U.escapeHtml(t) + '"' + (rec.foodCuisine === t ? ' selected' : '') + '>' + U.escapeHtml(t) + '</option>';
        }).join('') + '</select></label>' +
        '<label><span class="f-label">品类（选填）</span><select name="foodType"><option value="">（不指定）</option>' +
        types.map(function (t) {
          return '<option value="' + U.escapeHtml(t) + '"' + (rec.foodType === t ? ' selected' : '') + '>' + U.escapeHtml(t) + '</option>';
        }).join('') + '</select></label>' +
        '<label><span class="f-label">餐别 <span class="req-star"> *</span></span><select name="meal"><option value="">请选择</option>' +
        meals.map(function (t) {
          return '<option value="' + U.escapeHtml(t) + '"' + (rec.meal === t ? ' selected' : '') + '>' + U.escapeHtml(t) + '</option>';
        }).join('') + '</select></label>' +
        '<label><span class="f-label">价格 <span class="req-star"> *</span></span><input type="number" step="0.01" name="price" value="' + rec.price + '"></label>' +
        '<label><span class="f-label">菜名/描述</span><input name="name" value="' + U.escapeHtml(rec.name || '') + '"></label>' +
        '<label><span class="f-label">评分（1-5）</span><input type="number" min="1" max="5" name="rating" value="' + (rec.rating || '') + '"></label>' +
        '<label><span class="f-label">热量 kcal</span><input type="number" name="calories" value="' + (rec.calories || '') + '"></label>' +
        '<label><span class="f-label">地点/店铺</span><input name="location" value="' + U.escapeHtml(rec.location || '') + '"></label>' +
        '<label><span class="f-label">饱腹感（1-5）</span><input type="number" min="1" max="5" name="fullness" value="' + (rec.fullness || '') + '"></label>' +
        '<label class="f-full"><span class="f-label">备注</span><input name="note" value="' + U.escapeHtml(rec.note || '') + '"></label>' +
        '<div class="f-full"><span class="f-label">场景标签</span><div class="chip-row">' +
        tags.map(function (t) {
          const on = (rec.tags || []).indexOf(t) >= 0;
          return '<label class="chip-check"><input type="checkbox" name="tags" value="' + U.escapeHtml(t) + '"' + (on ? ' checked' : '') + '><span>' + U.escapeHtml(t) + '</span></label>';
        }).join('') + '</div></div>' +
        '<div class="f-full"><span class="f-label">图片（可多张，自动裁切）</span><div id="food-imgs"></div></div>' +
        '</div></form>',
      footerHTML: '<button class="btn btn-ghost" data-x="c">关闭</button><button class="btn btn-primary" data-x="s">保存</button>',
      onMount: function (wrap, close) {
        const uploader = UI.imageUploader(wrap.querySelector('#food-imgs'), { paths: rec.images || [] });
        wrap.querySelectorAll('[data-del-food]').forEach(function (b) {
          b.addEventListener('click', async function () {
            await S.removeFood(b.getAttribute('data-del-food'));
            close(); openEditor(dateStr, null);
          });
        });
        wrap.querySelectorAll('[data-edit-food]').forEach(function (b) {
          b.addEventListener('click', function () {
            const f = S.getDB().food.find(function (x) { return x.id === b.getAttribute('data-edit-food'); });
            if (f) { close(); openEditor(dateStr, f); }
          });
        });
        wrap.querySelector('[data-x=c]').addEventListener('click', function () { close(); window.App.refresh(); });
        wrap.querySelector('[data-x=s]').addEventListener('click', async function () {
          const fd = new FormData(wrap.querySelector('#food-form'));
          const data = Object.assign({}, rec, {
            date: dateStr,
            foodCuisine: fd.get('foodCuisine') || '',
            foodType: fd.get('foodType') || '',
            meal: fd.get('meal') || '',
            price: fd.get('price') === '' ? '' : Number(fd.get('price')),
            name: (fd.get('name') || '').trim(),
            rating: fd.get('rating') === '' ? 0 : Number(fd.get('rating')),
            calories: fd.get('calories') === '' ? '' : Number(fd.get('calories')),
            location: (fd.get('location') || '').trim(),
            fullness: fd.get('fullness') === '' ? '' : Number(fd.get('fullness')),
            note: (fd.get('note') || '').trim(),
            tags: fd.getAll('tags').filter(Boolean)
          });
          const errs = M.validateFood(data);
          if (errs.length) { UI.toast(errs.join('；'), 'error'); return; }
          const btn = wrap.querySelector('[data-x=s]');
          btn.disabled = true;
          try {
            data.images = await uploader.finalize();
            await S.saveFood(data);
            close(); UI.toast('已记录', 'success'); window.App.refresh();
          } catch (e) {
            UI.toast('保存失败：' + e.message, 'error'); btn.disabled = false;
          }
        });
      }
    });
  }

  return { render: render };
})();
