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
    const startDow = (new Date(calYear, calMonth, 1).getDay() + 6) % 7; // v1.2.0 周一为第一列（拍板）
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
      // v1.1.9：日期右侧餐别快捷框（早/中/晚/加）——筛选器：点框过滤下方内容区；
      // 已录=绿框；筛选中点下方空白=该餐录入（预填）
      const filter = mealFilterOf[dateStr] || '';
      const showRecs = filter ? recs.filter(function (r) { return mealSlotOf(r.meal) === filter; }) : recs;
      const imgs = [];
      showRecs.forEach(function (r) { (r.images || []).forEach(function (p) { imgs.push({ p: p, rid: r.id }); }); });
      const slotDone = { '早': 0, '中': 0, '晚': 0, '加': 0 };
      recs.forEach(function (r) { slotDone[mealSlotOf(r.meal)]++; });
      const mealRow = '<div class="cal-meals">' + MEAL_SLOTS.map(function (p) {
        const n = slotDone[p.slot];
        return '<button type="button" class="cal-meal' + (n ? ' meal-on' : '') + (filter === p.slot ? ' filter-on' : '') +
          '" data-meal-slot="' + p.slot + '" data-meal-name="' + p.name + '" title="' + p.name +
          (n ? ' · 已录 ' + n + ' 条' : ' · 点击筛选/录入') + '">' + p.slot + '</button>';
      }).join('') + '</div>';
      cells += '<div class="cal-cell' + (isToday ? ' cal-today' : '') + (recs.length ? ' cal-has' : '') + '" data-date="' + dateStr + '">' +
        '<div class="cal-day-row"><div class="cal-day">' + d + '</div>' + mealRow + '</div>' +
        (imgs.length
          ? '<div class="cal-cover" data-carousel=\'' + JSON.stringify(imgs).replace(/'/g, '&#39;') + '\'>' +
          '<img data-path="' + U.escapeHtml(imgs[0].p) + '"/>' +
          (imgs.length > 1
            ? UI.calNav() +
            '<span class="cal-more">1/' + imgs.length + '</span>'
            : '') + '</div>'
          : showRecs.length
            ? '<div class="cal-outfits">' + showRecs.map(function (r) {
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
      '<div class="cal-grid' + ((db.settings.foodMealQuick === 'hover') ? ' quick-hover' : '') + '">' +
      ['一', '二', '三', '四', '五', '六', '日'].map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('') +
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
        // v1.1.9 餐别快捷框=筛选器：点框过滤下方内容区（再点取消）；筛选中点空白=该餐录入
        // 筛选视图在 handler 内重算（渲染循环的局部量不可见）
        const filterNow = mealFilterOf[dateStr] || '';
        const showRecs = filterNow ? recs.filter(function (r) { return mealSlotOf(r.meal) === filterNow; }) : recs;
        const presetMeal = filterNow ? ((MEAL_SLOTS.filter(function (p) { return p.slot === filterNow; })[0] || {}).name) : '';
        const mealBtn = e.target.closest('[data-meal-slot]');
        if (mealBtn) {
          e.stopPropagation();
          const slot = mealBtn.getAttribute('data-meal-slot');
          mealFilterOf[dateStr] = (mealFilterOf[dateStr] === slot) ? '' : slot;
          render(root);
          return;
        }
        const chip = e.target.closest('[data-open-rec]');
        if (chip) {
          const rec = showRecs.find(function (r) { return r.id === chip.getAttribute('data-open-rec'); });
          if (rec) openEditor(dateStr, rec);
          return;
        }
        const cover = e.target.closest('.cal-cover');
        if (cover) {
          // 点图打开当前轮播图对应的那条记录
          let imgs = [];
          try { imgs = JSON.parse(cover.getAttribute('data-carousel')); } catch (err) { imgs = []; }
          const cur = Number(cover.querySelector('.cal-more') ? (cover.querySelector('.cal-more').textContent.split('/')[0]) - 1 : 0) || 0;
          const hit = imgs[cur] && showRecs.find(function (r) { return r.id === imgs[cur].rid; });
          if (hit) { openEditor(dateStr, hit); return; }
          if (showRecs.length === 1) { openEditor(dateStr, showRecs[0]); return; }
          if (!showRecs.length) {
            openEditor(dateStr, null, presetMeal);
            return;
          }
          // 多条且无法定位图片归属 → 落入下方选择器
        }
        if (showRecs.length === 1) { openEditor(dateStr, showRecs[0]); return; }
        if (showRecs.length > 1) {
          UI.pickRecord('选择要查看的记录 · ' + U.cnDate(dateStr), showRecs.map(function (r) {
            return {
              id: r.id, thumbPath: (r.images && r.images[0]) || '', icon: 'utensils',
              text: (r.meal || '') + ' · ' + (r.foodCuisine || '') +
                (r.foodType ? ' / ' + r.foodType : '') + ' · ' + (r.name || ''),
              sub: U.formatMoney(r.price) + (r.location ? ' · ' + r.location : '')
            };
          }), function (rid) {
            if (rid === null) openEditor(dateStr, null, presetMeal);
            else {
              const rec = showRecs.find(function (r) { return r.id === rid; });
              if (rec) openEditor(dateStr, rec);
            }
          });
          return;
        }
        openEditor(dateStr, null, presetMeal);
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

  /* v1.1.9：餐别快捷框——早/中/晚/加（加=加餐+夜宵+无餐别） */
  function mealSlotOf(meal) {
    const m = String(meal || '');
    if (m === '早餐') return '早';
    if (m === '午餐') return '中';
    if (m === '晚餐') return '晚';
    return '加';
  }
  const MEAL_SLOTS = [
    { slot: '早', name: '早餐' }, { slot: '中', name: '午餐' },
    { slot: '晚', name: '晚餐' }, { slot: '加', name: '加餐' }
  ];
  /* 每格餐别筛选态（date → '早'|'中'|'晚'|'加'|''），再点同钮=取消筛选 */
  let mealFilterOf = {};

  function openEditor(dateStr, rec, presetMeal) {
    const db = S.getDB();
    const existing = rec ? [] : db.food.filter(function (f) { return f.date === dateStr; });
    const cuisines = db.categories.foodCuisine || [];
    const types = db.categories.foodType || [];
    const meals = db.categories.meal || [];
    const tags = db.categories.foodTag || [];
    const isEdit = !!rec;
    rec = rec || {
      id: U.uid(), date: dateStr, meal: presetMeal || '', foodCuisine: '', foodType: '', name: '', price: '',
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
        '</div></form>' +
        // 账单同步（对齐物品侧）：新建可顺手记账；已有美食可补生成消费账单/查看关联
        '<div class="form-section"><div class="form-section-title">' + UI.icon('receipt', 16) +
        ' 账单同步</div><div id="food-bill-sync"></div></div>',
      footerHTML: (isEdit ? '<button class="btn btn-danger" data-x="d">删除</button>' : '') +
        '<button class="btn btn-ghost" data-x="c">关闭</button><button class="btn btn-primary" data-x="s">保存打卡</button>',
      formGuard: true, // 带表单弹窗：误点遮罩先确认「放弃已填内容？」（甲8）
      // 任何关闭路径（×/遮罩/按钮）都先刷新底层日历：防弹窗关闭后不刷新、已删记录"复活"（A10）
      onClose: function () { window.App.refresh(); },
      onMount: function (wrap, close) {
        const uploader = UI.imageUploader(wrap.querySelector('#food-imgs'), { paths: rec.images || [] });
        // 表单读取（保存/生成账单共用，防两处字段口径漂移）
        function readForm() {
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
          return data;
        }
        // 账单同步区：新建=顺手记账勾选（填了价格才显示，默认勾选）；已有=生成消费账单/关联管理（对齐物品侧）
        function linkedFoodBills() {
          return ((S.getDB().wallet || {}).bills || []).filter(function (b) { return b.foodId === rec.id; });
        }
        function renderBillSync() {
          const box = wrap.querySelector('#food-bill-sync');
          if (!box) return;
          if (!isEdit) {
            const priceEl = wrap.querySelector('[name=price]');
            const pv = priceEl ? priceEl.value : '';
            // 空价格/金额 0 不显示勾选（0 元账单无意义）；填写正数价格才出现，默认勾选
            const show = pv !== '' && !isNaN(Number(pv)) && Number(pv) > 0;
            box.innerHTML = show
              ? '<label class="chip-check"><input type="checkbox" id="food-sync-bill" checked>' +
              '<span>同时在钱袋记一笔消费账单（金额/日期取本表单，可稍后修改）</span></label>'
              : '';
            return;
          }
          const linked = linkedFoodBills();
          if (linked.length) {
            box.innerHTML = '<p class="muted small">已关联 ' + linked.length + ' 笔账单（金额/日期互通）：</p>' +
              linked.map(function (b) {
                return '<div class="mini-row"><span class="muted">' + U.escapeHtml(b.date) + '</span>' +
                  '<button type="button" class="yw-sync-tag" data-bill-open="' + U.escapeHtml(b.id) +
                  '" title="点击跳转钱袋流水">' + UI.icon('link', 10) + '已关联账单</button>' +
                  '<span class="flex1">' + U.escapeHtml(b.note || '') + '</span><strong>' +
                  U.formatMoney(b.amount) + '</strong></div>';
              }).join('') +
              '<div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" id="btn-unlink-food-bill">解除关联</button></div>';
            // 点「已关联账单」标签直达钱袋流水并定位（对齐物品侧 data-item-open 的跳转写法）
            box.querySelectorAll('[data-bill-open]').forEach(function (el) {
              el.addEventListener('click', function (e) {
                e.stopPropagation();
                const b = ((S.getDB().wallet || {}).bills || []).find(function (x) {
                  return x.id === el.getAttribute('data-bill-open');
                });
                if (!b) return;
                if (window.WalletView && window.WalletView.jumpTo) window.WalletView.jumpTo({ date: b.date });
                if (window.WalletView && window.WalletView.openBillForm) window.WalletView.openBillForm(b);
              });
            });
            box.querySelector('#btn-unlink-food-bill').addEventListener('click', async function () {
              // 文案与行为一致（A6）：解除关联只解绑不删美食（unlinkBillSync keepRec）
              if (await UI.confirmDialog('解除关联', '解除后美食记录将保留，不再与账单同步')) {
                for (let i = 0; i < linked.length; i++) await S.unlinkBillSync(linked[i].id, true);
                renderBillSync();
                UI.toast('已解除关联', 'success');
              }
            });
          } else {
            box.innerHTML = '<p class="muted small">该美食还没有关联账单。点下面的按钮会<b>先保存美食当前内容</b>（含校验与新图片），再按名称/价格/日期生成一笔消费账单，实现美食与账单互通。</p>' +
              '<div class="btn-row"><button type="button" class="btn btn-primary btn-sm" id="btn-gen-food-bill">' +
              UI.icon('receipt', 14) + ' 生成消费账单（将先保存美食当前内容）</button></div>';
            box.querySelector('#btn-gen-food-bill').addEventListener('click', async function () {
              const gbtn = box.querySelector('#btn-gen-food-bill');
              try {
                // 先跑校验 + 图片落盘保存美食当前内容，再生成账单（与物品侧「生成购入账单」同口径）
                const data = readForm();
                const errs = M.validateFood(data);
                if (errs.length) { UI.toast(errs.join('；'), 'error'); return; }
                UI.loadingBtn(gbtn, true);
                try {
                  data.images = await uploader.finalize();
                  await S.saveFood(data);
                  await S.addBillFromFood(data);
                  UI.toast('已记入钱袋（可在钱袋查看/修改）', 'success');
                  renderBillSync();
                  window.App.refresh();
                } finally {
                  UI.loadingBtn(gbtn, false);
                }
              } catch (e) {
                UI.toast(e.message || '生成失败', 'error');
              }
            });
          }
        }
        renderBillSync();
        if (!isEdit) {
          const priceEl = wrap.querySelector('[name=price]');
          if (priceEl) priceEl.addEventListener('input', renderBillSync);
        }
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
          // v1.1.9 稽核修复：rec 已被重赋值为恒真对象，判空必须用 isEdit（否则列表恒空）
          const list = isEdit ? [] : db.food.filter(function (f) { return f.date === dateStr; });
          existingBox.innerHTML = list.length
            ? '<div class="existing-outfits">' + list.map(function (f) {
              return '<div class="mini-row op-host"><span class="flex1">' + U.escapeHtml(f.meal || '') + ' · ' +
                U.escapeHtml(f.foodCuisine || '') + (f.foodType ? ' / ' + U.escapeHtml(f.foodType) : '') +
                ' · ' + U.escapeHtml(f.name || '') + ' · ' + U.formatMoney(f.price) + '</span>' +
                '<span class="op-float">' +
                '<button class="btn-icon" data-edit-food="' + f.id + '" title="编辑">' + UI.icon('pencil', 14) + '</button>' +
                '<button class="btn-icon" data-del-food="' + f.id + '" title="删除">' + UI.icon('trash-2', 14) + '</button></span></div>';
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
          const data = readForm();
          const errs = M.validateFood(data);
          if (errs.length) { UI.toast(errs.join('；'), 'error'); return; }
          const btn = wrap.querySelector('[data-x=s]');
          UI.loadingBtn(btn, true); // 丙4：保存中 loading
          try {
            data.images = await uploader.finalize();
            await S.saveFood(data);
            // 账单同步：新建勾选则生成消费账单并双向关联（金额/日期/名称互通，对齐物品侧）
            const syncBox = wrap.querySelector('#food-sync-bill');
            if (syncBox && syncBox.checked) {
              await S.addBillFromFood(data);
              close(); UI.toast('已记入钱袋（可在钱袋查看/修改）', 'success');
            } else {
              close(); UI.toast(isEdit ? '已保存' : '打卡成功', 'success'); // onClose 统一刷新
            }
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

  return {
    render: render, openFoodEditor: openEditor,
    // 稽核修复：账号切换清餐别筛选/月锚，防跨账号残留
    resetState: function () { mealFilterOf = {}; calYear = undefined; calMonth = undefined; }
  };
})();
