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
      recs.forEach(function (r) { (r.images || []).forEach(function (p) { imgs.push({ p: p, rid: r.id }); }); });
      cells += '<div class="cal-cell' + (isToday ? ' cal-today' : '') + (recs.length ? ' cal-has' : '') + '" data-date="' + dateStr + '">' +
        '<div class="cal-day">' + d + '</div>' +
        (recs.length ? UI.calAddMini() : '') +
        (imgs.length
          ? '<div class="cal-cover" data-carousel=\'' + JSON.stringify(imgs).replace(/'/g, '&#39;') + '\'>' +
          '<img data-path="' + U.escapeHtml(imgs[0].p) + '"/>' +
          (imgs.length > 1
            ? UI.calNav() +
            '<span class="cal-more">1/' + imgs.length + '</span>'
            : '') + '</div>'
          : recs.length
            ? '<div class="cal-outfits">' + recs.map(function (r) {
              return '<div class="cal-outfit-chip" data-open-rec="' + r.id + '"><span>' + U.escapeHtml(r.meal || '') +
                (r.fromBill || (r.linkedBillIds || []).length ? ' <i class="tag" title="来自钱袋账单" style="font-style:normal;padding:0 5px">账</i>' : '') + ' · ' +
                U.escapeHtml(r.name || r.foodCuisine || '') + '</span></div>';
            }).join('') + '</div>'
            : UI.calHint()) +
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
      '<button class="btn btn-primary" id="btn-add-food">' + UI.icon('utensils', 14) + ' 美食打卡</button></div></div>' +
      '<div class="cal-grid">' +
      ['日', '一', '二', '三', '四', '五', '六'].map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('') +
      cells + '</div>' +
      // 空态卡化（丙3）：当月一条记录都没有时给引导卡
      (Object.keys(byDate).length ? '' :
        '<div class="empty-state empty-card"><div class="empty-icon">' + UI.icon('utensils', 48) + '</div>' +
        '<p>这个月还没有美食记录</p><button class="btn btn-ghost" id="btn-empty-food">＋ 美食打卡</button></div>') +
      '<p class="muted pad-8">点击日期记录或查看当天餐食；单日多图可用箭头切换。</p>';

    root.querySelector('#food-year').addEventListener('change', function (e) { calYear = Number(e.target.value); render(root); });
    root.querySelector('#food-month').addEventListener('change', function (e) { calMonth = Number(e.target.value); render(root); });
    root.querySelector('#food-today').addEventListener('click', function () {
      const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); render(root);
    });
    root.querySelector('#btn-add-food').addEventListener('click', function () { openEditor(U.todayStr(), null); });
    const emptyFoodBtn = root.querySelector('#btn-empty-food');
    if (emptyFoodBtn) emptyFoodBtn.addEventListener('click', function () {
      // 空态引导：本月没有记录 → 直接打卡（当前月记今天，翻月记该月 1 号）
      const isCurMonth = key === (function () {
        const n = new Date();
        return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0');
      })();
      openEditor(isCurMonth ? U.todayStr() : key + '-01', null);
    });
    root.querySelectorAll('.cal-cell[data-date]').forEach(function (cell) {
      cell.addEventListener('click', function (e) {
        const dateStr = cell.getAttribute('data-date');
        const recs = byDate[dateStr] || [];
        if (e.target.closest('[data-nav-dir]')) return;
        if (e.target.closest('.cal-add-mini')) { openEditor(dateStr, null); return; }
        const chip = e.target.closest('[data-open-rec]');
        if (chip) {
          const rec = recs.find(function (r) { return r.id === chip.getAttribute('data-open-rec'); });
          if (rec) openEditor(dateStr, rec);
          return;
        }
        const cover = e.target.closest('.cal-cover');
        if (cover) {
          // 点图打开当前轮播图对应的那条记录
          let imgs = [];
          try { imgs = JSON.parse(cover.getAttribute('data-carousel')); } catch (err) { imgs = []; }
          const cur = Number(cover.querySelector('.cal-more') ? (cover.querySelector('.cal-more').textContent.split('/')[0]) - 1 : 0) || 0;
          const hit = imgs[cur] && recs.find(function (r) { return r.id === imgs[cur].rid; });
          if (hit) { openEditor(dateStr, hit); return; }
          if (recs.length === 1) { openEditor(dateStr, recs[0]); return; }
          if (!recs.length) { openEditor(dateStr, null); return; }
          // 多条且无法定位图片归属 → 落入下方选择器
        }
        if (recs.length === 1) { openEditor(dateStr, recs[0]); return; }
        if (recs.length > 1) {
          UI.pickRecord('选择要查看的记录 · ' + U.cnDate(dateStr), recs.map(function (r) {
            return {
              id: r.id, thumbPath: (r.images && r.images[0]) || '', icon: 'utensils',
              text: (r.meal || '') + ' · ' + (r.foodCuisine || '') +
                (r.foodType ? ' / ' + r.foodType : '') + ' · ' + (r.name || ''),
              sub: U.formatMoney(r.price) + (r.location ? ' · ' + r.location : '')
            };
          }), function (rid) {
            if (rid === null) openEditor(dateStr, null);
            else {
              const rec = recs.find(function (r) { return r.id === rid; });
              if (rec) openEditor(dateStr, rec);
            }
          });
          return;
        }
        openEditor(dateStr, null);
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

  function openEditor(dateStr, rec) {
    const db = S.getDB();
    const existing = rec ? [] : db.food.filter(function (f) { return f.date === dateStr; });
    const cuisines = db.categories.foodCuisine || [];
    const types = db.categories.foodType || [];
    const meals = db.categories.meal || [];
    const tags = db.categories.foodTag || [];
    const isEdit = !!rec;
    rec = rec || {
      id: U.uid(), date: dateStr, meal: '', foodCuisine: '', foodType: '', name: '', price: '',
      tags: [], rating: 0, location: '', note: '', calories: '', fullness: '', images: []
    };
    // 菜系下拉兜底（甲1）：账单同步预填的「其他」等值若不在分类库里，也要能选中显示
    const cuisineOpts = (rec.foodCuisine && cuisines.indexOf(rec.foodCuisine) < 0)
      ? [rec.foodCuisine].concat(cuisines) : cuisines;

    UI.modal({
      title: (isEdit ? '编辑美食 · ' : '美食打卡 · ') + U.cnDate(dateStr), width: 700,
      bodyHTML:
        // existing 列表独立容器（甲21-①同型）：删旧记录只重绘本区，新表单不丢
        '<div id="food-existing"></div>' +
        (rec.fromBill ? '<p class="muted small">' + UI.icon('receipt', 12) + ' 来自钱袋账单（自动同步）；改账单会同步更新此处，这里补充的评分/图片等会保留</p>' : '') +
        '<form id="food-form"><div class="form-grid">' +
        // 日期可改（甲16）：记错日子不用删了重录；账单来源日期跟随账单（置灰+提示）
        '<label><span class="f-label">日期</span>' +
        '<input type="date" name="date" value="' + U.escapeHtml(rec.date || dateStr) + '"' +
        (rec.fromBill ? ' disabled title="日期随账单"' : '') + '></label>' +
        (rec.fromBill ? '<p class="muted small f-full">' + UI.icon('receipt', 12) + ' 日期随账单：改账单日期会自动同步</p>' : '') +
        '<label><span class="f-label">菜系 <span class="req-star"> *</span></span>' +
        '<select name="foodCuisine"><option value="">请选择</option>' +
        cuisineOpts.map(function (t) {
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
        '<label><span class="f-label">价格 <span class="req-star"> *</span></span><input type="number" step="0.01" min="0" name="price" value="' + rec.price + '"></label>' +
        '<label><span class="f-label">菜名/描述</span><input name="name" value="' + U.escapeHtml(rec.name || '') + '"></label>' +
        // 甲10：评分/饱腹感 0~5、热量/价格 ≥0，输入约束 + validateFood 范围校验双保险
        '<label><span class="f-label">评分（0-5）</span><input type="number" min="0" max="5" name="rating" value="' + (rec.rating || '') + '"></label>' +
        '<label><span class="f-label">热量 kcal</span><input type="number" min="0" name="calories" value="' + (rec.calories || '') + '"></label>' +
        '<label><span class="f-label">地点/店铺</span><input name="location" value="' + U.escapeHtml(rec.location || '') + '"></label>' +
        '<label><span class="f-label">饱腹感（0-5）</span><input type="number" min="0" max="5" name="fullness" value="' + (rec.fullness || '') + '"></label>' +
        '<label class="f-full"><span class="f-label">备注</span><input name="note" value="' + U.escapeHtml(rec.note || '') + '"></label>' +
        '<div class="f-full"><span class="f-label">场景标签</span><div class="chip-row">' +
        tags.map(function (t) {
          const on = (rec.tags || []).indexOf(t) >= 0;
          return '<label class="chip-check"><input type="checkbox" name="tags" value="' + U.escapeHtml(t) + '"' + (on ? ' checked' : '') + '><span>' + U.escapeHtml(t) + '</span></label>';
        }).join('') + '</div></div>' +
        '<div class="f-full"><span class="f-label">图片（可多张，自动裁切）</span><div id="food-imgs"></div></div>' +
        '</div></form>',
      footerHTML: (isEdit ? '<button class="btn btn-danger" data-x="d">删除</button>' : '') +
        '<button class="btn btn-ghost" data-x="c">关闭</button><button class="btn btn-primary" data-x="s">保存打卡</button>',
      formGuard: true, // 带表单弹窗：误点遮罩先确认「放弃已填内容？」（甲8）
      // 任何关闭路径（×/遮罩/按钮）都先刷新底层日历：防弹窗关闭后不刷新、已删记录"复活"（A10）
      onClose: function () { window.App.refresh(); },
      onMount: function (wrap, close) {
        const uploader = UI.imageUploader(wrap.querySelector('#food-imgs'), { paths: rec.images || [] });
        if (isEdit) {
          wrap.querySelector('[data-x=d]').addEventListener('click', async function () {
            if (!await UI.confirmDialog('删除美食', '删除这条美食记录？')) return;
            await S.removeFood(rec.id);
            UI.toast('已删除', 'success');
            close(); // onClose 统一刷新底层日历
          });
        }
        // existing 列表区（甲21-①同型）：删除旧记录只重绘本区，新表单已填内容不丢
        const existingBox = wrap.querySelector('#food-existing');
        function renderExisting() {
          const list = rec ? [] : db.food.filter(function (f) { return f.date === dateStr; });
          existingBox.innerHTML = list.length
            ? '<div class="existing-outfits">' + list.map(function (f) {
              return '<div class="mini-row"><span class="flex1">' + U.escapeHtml(f.meal || '') + ' · ' +
                U.escapeHtml(f.foodCuisine || '') + (f.foodType ? ' / ' + U.escapeHtml(f.foodType) : '') +
                ' · ' + U.escapeHtml(f.name || '') + ' · ' + U.formatMoney(f.price) + '</span>' +
                '<button class="btn-icon" data-edit-food="' + f.id + '" title="编辑">' + UI.icon('pencil', 14) + '</button>' +
                '<button class="btn-icon" data-del-food="' + f.id + '">' + UI.icon('trash-2', 14) + '</button></div>';
            }).join('') + '</div>'
            : '';
          existingBox.querySelectorAll('[data-del-food]').forEach(function (b) {
            b.addEventListener('click', async function () {
              if (!await UI.confirmDialog('删除美食', '删除这条美食记录？')) return;
              await S.removeFood(b.getAttribute('data-del-food'));
              UI.toast('已删除', 'success');
              renderExisting(); // 只重绘 existing 列表区（底层日历在 onClose 统一刷新，A10）
            });
          });
          existingBox.querySelectorAll('[data-edit-food]').forEach(function (b) {
            b.addEventListener('click', function () {
              const f = S.getDB().food.find(function (x) { return x.id === b.getAttribute('data-edit-food'); });
              if (f) { close(); openEditor(dateStr, f); }
            });
          });
        }
        renderExisting();
        wrap.querySelector('[data-x=c]').addEventListener('click', function () { close(); });
        wrap.querySelector('[data-x=s]').addEventListener('click', async function () {
          const fd = new FormData(wrap.querySelector('#food-form'));
          const data = Object.assign({}, rec, {
            // 日期可改（甲16）：fromBill 条目输入置灰（disabled 不进 FormData）→ 落回 rec.date 随账单
            date: fd.get('date') || rec.date || dateStr,
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
          // 用户改过价格 → priceManual：此后账单同步不再覆盖该价格（A7，与物品侧同口径）
          if (isEdit && Number(data.price) !== Number(rec.price)) data.priceManual = true;
          const errs = M.validateFood(data);
          if (errs.length) { UI.toast(errs.join('；'), 'error'); return; }
          const btn = wrap.querySelector('[data-x=s]');
          UI.loadingBtn(btn, true); // 丙4：保存中 loading
          try {
            data.images = await uploader.finalize();
            await S.saveFood(data);
            close(); UI.toast(isEdit ? '已保存' : '打卡成功', 'success'); // onClose 统一刷新
          } catch (e) {
            // 保存失败回滚（甲23-③同型）：内存与磁盘旧态对齐，提示用户
            try { await S.loadAll(); } catch (e2) {}
            UI.toast('保存失败：' + e.message, 'error');
            UI.loadingBtn(btn, false);
          }
        });
      }
    });
  }

  return { render: render, openFoodEditor: openEditor };
})();
