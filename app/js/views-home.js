/* views-home.js — 我的主页（v1.1.2）：快捷记录 / 打卡 / 天气穿搭推荐 / 概览提醒 */
window.HomeView = (function () {
  const S = window.Storage;
  const U = window.Utils;
  const UI = window.UI;
  const M = window.Models;

  function today() { return U.todayStr(); }

  function greet() {
    const h = new Date().getHours();
    if (h < 6) return '夜深了';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }

  function weekName() {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date().getDay()];
  }

  function render(root) {
    const db = S.getDB();
    const t = today();
    // 今日概览
    const todayBills = ((db.wallet || {}).bills || []).filter(function (b) { return b.date === t; });
    let todayExp = 0, todayInc = 0;
    todayBills.forEach(function (b) {
      const a = Math.abs(Number(b.amount) || 0);
      if (b.type === 'income') todayInc += a; else if (b.type === 'expense') todayExp += a;
    });
    const outfitDone = (db.outfits || []).filter(function (o) { return o.date === t; });
    const foodDone = (db.food || []).filter(function (f) { return f.date === t; });

    // 本月速览
    const mk = U.monthKey(t);
    const wstat = M.walletStats(db);
    const budgetTotal = Number((db.settings.budget || {}).monthlyTotal) || 0;

    // 提醒中心：临期（PAO/保修）+ 长期吃灰
    const expiring = M.expiryList(db).slice(0, 4);
    const idleWarn = Number(db.settings.idleWarnDays) || 60;
    const idleList = (M.summary(db).idleList || []).filter(function (x) { return x.idle >= idleWarn; }).slice(0, 4);

    // 最近动态（跨模块 5 条）
    const feed = [];
    ((db.wallet || {}).bills || []).slice(-3).forEach(function (b) {
      feed.push({
        at: (b.date || '') + ' ' + (b.time || ''), icon: 'receipt',
        text: '记账 · ' + (b.note || '账单') + ' · ' + U.formatMoney(b.amount),
        go: function () {
          if (window.WalletView && window.WalletView.jumpTo) window.WalletView.jumpTo({ date: b.date });
          else window.App.go('wallet');
        }
      });
    });
    (db.outfits || []).slice(-1).forEach(function (o) {
      feed.push({
        at: o.date, icon: 'shirt',
        text: '穿搭打卡 · ' + U.cnDate(o.date),
        go: function () { window.Views.openOutfitEditor(o.date, o); }
      });
    });
    (db.food || []).slice(-1).forEach(function (f) {
      feed.push({
        at: f.date, icon: 'utensils',
        text: '美食 · ' + (f.name || f.meal || '记录'),
        go: function () { window.FoodView.openFoodEditor(f.date, f); }
      });
    });
    (db.items || []).slice(-2).forEach(function (i) {
      feed.push({
        at: (i.createdAt || '').slice(0, 10), icon: 'package',
        text: '建档 · ' + (i.name || '物品'),
        go: function () { window.Views.openItemDetail(i.id); }
      });
    });
    feed.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });

    root.innerHTML =
      '<div class="home-hero">' +
      '<div class="home-greet">' + greet() + ' 👋</div>' +
      '<div class="home-date muted">' + U.cnDate(t) + ' ' + weekName() + '</div>' +
      '</div>' +

      // 四大快捷记录（大按钮、各颜色）
      '<div class="home-quick-grid">' +
      homeQuick('hq-digital', 'gamepad-2', '记数码', '#0071e3') +
      homeQuick('hq-clothing', 'shirt', '记衣服', '#ff2d55') +
      homeQuick('hq-life', 'heart', '记美妆', '#af52de') +
      homeQuick('hq-bill', 'wallet', '记一笔账', '#34c759') +
      '</div>' +

      // 打卡区（完成态）
      '<div class="home-check-row">' +
      homeCheck('hc-outfit', 'shirt', '穿搭打卡', outfitDone.length) +
      homeCheck('hc-food', 'utensils', '美食打卡', foodDone.length) +
      '</div>' +

      // 天气穿搭推荐（从穿搭日历挪来）+ 今日概览
      '<div class="home-two">' +
      '<div class="panel weather-card" id="home-weather"><div class="panel-body"></div></div>' +
      '<div class="panel"><div class="panel-head">' + UI.icon('sun', 16) + ' 今日概览</div><div class="panel-body">' +
      '<div class="home-mini-grid">' +
      '<div class="home-mini"><div class="yw-bal-label">今日记账</div><div class="home-mini-val">' + todayBills.length + ' 笔</div></div>' +
      '<div class="home-mini"><div class="yw-bal-label">今日支出</div><div class="home-mini-val out">' + U.formatMoney(todayExp) + '</div></div>' +
      '<div class="home-mini"><div class="yw-bal-label">今日收入</div><div class="home-mini-val in">' + U.formatMoney(todayInc) + '</div></div>' +
      '<div class="home-mini"><div class="yw-bal-label">打卡</div><div class="home-mini-val">' +
      (outfitDone.length ? '穿搭✓ ' : '穿搭✗ ') + (foodDone.length ? '美食✓' : '美食✗') + '</div></div>' +
      '</div></div></div>' +
      '</div>';

    bind(root, feed, outfitDone, foodDone);
  }

  function esc(t) { return U.escapeHtml(t == null ? '' : t); }

  function homeQuick(id, icon, label, color) {
    return '<button class="home-quick" id="' + id + '" style="--hq:' + color + '">' +
      '<span class="home-quick-ic">' + UI.icon(icon, 28) + '</span>' +
      '<span class="home-quick-label">' + label + '</span></button>';
  }

  function homeCheck(id, icon, label, done) {
    return '<button class="home-check' + (done ? ' done' : '') + '" id="' + id + '">' +
      UI.icon(icon, 20) + '<span>' + label + '</span>' +
      '<span class="home-check-state">' + (done ? '今日已打 ✓' : '去打卡') + '</span></button>';
  }

  function bind(root, feed, outfitDone, foodDone) {
    root.querySelector('#hq-digital').addEventListener('click', function () {
      window.Views.openItemEditor(null, 'digital');
    });
    root.querySelector('#hq-clothing').addEventListener('click', function () {
      window.Views.openItemEditor(null, 'clothing');
    });
    root.querySelector('#hq-life').addEventListener('click', function () {
      window.Views.openItemEditor(null, 'life');
    });
    root.querySelector('#hq-bill').addEventListener('click', function () {
      window.WalletView.openBillForm(null);
    });
    // 打卡：已有今日记录直接编辑那条，没有则新建（完成后按钮变已打）
    root.querySelector('#hc-outfit').addEventListener('click', function () {
      const rec = outfitDone[0] || null;
      window.Views.openOutfitEditor(today(), rec);
    });
    root.querySelector('#hc-food').addEventListener('click', function () {
      const rec = foodDone[0] || null;
      window.FoodView.openFoodEditor(today(), rec);
    });
    // 天气穿搭推荐卡（沿用穿搭日历的推荐渲染）
    const weatherCard = root.querySelector('#home-weather');
    if (weatherCard && window.Views && window.Views.renderOutfitRec) {
      window.Views.renderOutfitRec(weatherCard);
    }
    root.querySelectorAll('[data-feed]').forEach(function (el) {
      el.addEventListener('click', function () {
        const f = feed[Number(el.getAttribute('data-feed'))];
        if (f && f.go) f.go();
      });
    });
  }

  return { render: render };
})();
