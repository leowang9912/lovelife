/* app.js — 启动页 / 账号选择 / 全局搜索 / 路由（人生管家 lovelife） */
window.App = (function () {
  const S = window.Storage;
  const U = window.Utils;

  /* 前端资源版本：与 version.json 的程序版本分开校验。
     两者不一致 = 更新只换了一半（如 exe 新但 app/ 旧），设置页会提示手动覆盖。 */
  const FRONTEND_VERSION = "1.1.5";

  let current = 'home'; // 默认首屏=我的主页（v1.1.2）
  let booted = false;

  const NAV = [
    { id: 'home', label: '我的主页', icon: 'house' },
    { id: 'plan', label: '我的统计', icon: 'chart-column' },
    { id: 'digital', label: '我的数码', icon: 'gamepad-2' },
    { id: 'clothing', label: '我的衣橱', icon: 'shirt' },
    { id: 'life', label: '我的生活', icon: 'heart' },
    { id: 'wallet', label: '我的钱袋', icon: 'wallet' },
    { id: 'outfits', label: '穿搭日历', icon: 'calendar-days' },
    { id: 'food', label: '美食日历', icon: 'utensils' },
    { id: 'settings', label: '设置', icon: 'settings' }
  ];

  const AVATARS = ['😊', '😎', '🐱', '🐶', '🦊', '🐼', '🦁', '🌟', '🌙', '🍀',
    '🔥', '💎', '🎨', '🎧', '🍰', '🚀', '🌈', '🦋', '🌊', '🍑',
    '⚽', '🎮', '📚', '☕'];

  // 侧栏导航顺序：settings.navOrder 可在设置中排序；未登记的项按默认顺序排在后
  function navOrdered(db) {
    const order = (db && db.settings && db.settings.navOrder) || [];
    return NAV.slice().sort(function (a, b) {
      const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }

  function go(id) {
    current = id;
    render();
  }

  function refresh() { render(); }

  /* 账号切换后统一重置各模块状态（A3）：清 filter/search/排序缓存（排序记忆按新账号
     listSort 重读）、统计周期 statRange 回默认——防上一账号的筛选/搜索/排序状态残留 */
  function resetModuleStates() {
    if (window.Views && window.Views.resetState) window.Views.resetState();
    if (window.LifeView && window.LifeView.resetState) window.LifeView.resetState();
    if (window.WalletView && window.WalletView.resetState) window.WalletView.resetState();
    if (window.PlanView && window.PlanView.resetState) window.PlanView.resetState();
    if (window.FoodView && window.FoodView.resetState) window.FoodView.resetState();
  }
  S.onAccountChange(resetModuleStates);

  /* ---------- 启动页 / 账号选择（横向一排） ---------- */
  function avatarPickerHTML(current) {
    return '<div class="avatar-grid">' + AVATARS.map(function (a) {
      return '<div class="avatar-opt' + (a === current ? ' on' : '') + '" data-av="' + a + '">' + a + '</div>';
    }).join('') + '</div>';
  }

  function bindAvatarPicker(wrap, inputSelector) {
    wrap.querySelectorAll('.avatar-opt').forEach(function (el) {
      el.addEventListener('click', function () {
        wrap.querySelectorAll('.avatar-opt').forEach(function (x) { x.classList.remove('on'); });
        el.classList.add('on');
        const inp = wrap.querySelector(inputSelector);
        if (inp) inp.value = el.getAttribute('data-av');
      });
    });
  }

  function showAccountPicker() {
    const app = document.getElementById('app');
    const session = S.getSession() || { accounts: [] };
    const accounts = session.accounts || [];
    app.innerHTML =
      '<div class="connect-screen">' +
      '<div class="connect-card">' +
      '<div class="connect-icon">∞</div>' +
      '<h1>人生管家</h1>' +
      '<p class="muted">选择账号进入 · 数据彼此独立</p>' +
      '<div class="acc-row">' +
      accounts.map(function (a) {
        return '<div class="acc-card" data-acc="' + a.id + '">' +
          '<div class="acc-avatar">' + U.escapeHtml(a.icon || '😊') + '</div>' +
          '<div class="acc-name">' + U.escapeHtml(a.name) + '</div></div>';
      }).join('') +
      '<div class="acc-card acc-add" id="btn-new-acc"><div class="acc-avatar">＋</div><div class="acc-name">新建账号</div></div>' +
      '</div>' +
      '<label class="chip-check remember"><input type="checkbox" id="remember"' +
      (session.lastAccountId ? ' checked' : '') + '><span>记住上次账号，下次自动进入</span></label>' +
      '<p class="muted small" id="acc-tip"></p>' +
      '</div></div>';

    app.querySelectorAll('[data-acc]').forEach(function (el) {
      el.addEventListener('click', async function () {
        const id = el.getAttribute('data-acc');
        const remember = app.querySelector('#remember').checked;
        try {
          await S.selectAccount(id);
          const db = S.getDB();
          db.settings.rememberAccount = remember;
          await S.saveSettings();
          await fetch('/api/account', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'select', id: remember ? id : '' })
          });
          render();
        } catch (e) {
          console.error('账号进入失败', e);
          const tip = document.getElementById('acc-tip');
          if (tip) tip.textContent = e.message;
          else window.UI.toast(e.message, 'error');
        }
      });
    });
    app.querySelector('#btn-new-acc').addEventListener('click', function () {
      window.UI.modal({
        title: '新建账号', width: 560,
        bodyHTML: '<div class="form-grid">' +
          '<label class="f-full"><span class="f-label">昵称</span><input id="na-name" placeholder="如：我 / 妈妈"></label>' +
          '<div class="f-full"><span class="f-label">选择头像</span><input type="hidden" id="na-icon" value="😊">' +
          avatarPickerHTML('😊') + '</div></div>',
        footerHTML: '<button class="btn btn-ghost" data-x="c">取消</button><button class="btn btn-primary" data-x="s">创建并进入</button>',
        onMount: function (w, c) {
          bindAvatarPicker(w, '#na-icon');
          w.querySelector('[data-x=c]').addEventListener('click', c);
          w.querySelector('[data-x=s]').addEventListener('click', async function () {
            const name = w.querySelector('#na-name').value.trim();
            if (!name) { window.UI.toast('请填写昵称', 'error'); return; }
            try {
              const acc = await S.createAccount(name, w.querySelector('#na-icon').value || '😊');
              await S.selectAccount(acc.id);
              c(); render();
            } catch (e) {
              window.UI.toast(e.message, 'error');
            }
          });
        }
      });
    });
  }

  /* ---------- 主界面 ---------- */
  function render() {
    const app = document.getElementById('app');
    if (!S.getDB()) {
      showAccountPicker();
      return;
    }
    const db = S.getDB();
    // 侧栏宽度（v1.0.8）：恢复上次拖拽保存的宽度
    if (db.settings.sidebarWidth) {
      document.documentElement.style.setProperty('--sidebar-w', Number(db.settings.sidebarWidth) + 'px');
    }
    app.innerHTML =
      '<aside class="sidebar">' +
      '<div class="side-search"><span class="side-search-ic">' + window.UI.icon('search', 18) + '</span>' +
      '<input id="global-search" placeholder="快速搜索"><span class="side-kbd">Ctrl K</span>' +
      '<div class="search-results" id="search-results"></div></div>' +
      '<nav class="nav">' + navOrdered(db).filter(function (n) { return n.id !== 'settings'; }).map(function (n) {
        return '<a class="nav-item' + (current === n.id ? ' active' : '') + '" data-nav="' + n.id + '">' +
          '<span class="nav-icon">' + window.UI.icon(n.icon, 20) + '</span><span>' + n.label + '</span></a>';
      }).join('') + '</nav>' +
      '<div class="sidebar-foot">' +
      '<a class="nav-item' + (current === 'settings' ? ' active' : '') + '" data-nav="settings">' +
      '<span class="nav-icon">' + window.UI.icon('settings', 20) + '</span><span>设置</span></a>' +
      '<div class="side-divider"></div>' +
      '<div class="side-account" id="side-account-jump" title="账号设置">' +
      '<div class="side-avatar">' + U.escapeHtml((db.account && db.account.icon) || '😊') + '</div>' +
      '<div class="side-account-name">' + U.escapeHtml((db.account && db.account.name) || '') + '</div>' +
      '</div>' +
      '</div>' +
      '<div class="sidebar-resizer" id="sidebar-resizer" title="拖动调节侧栏宽度；双击恢复默认"></div>' +
      '</aside>' +
      '<main class="main">' +
      '<div id="main-content"></div></main>';

    app.querySelectorAll('[data-nav]').forEach(function (el) {
      el.addEventListener('click', function () { go(el.getAttribute('data-nav')); });
    });
    // 账户行：直达设置 → 账号页（v1.1.2）
    const accJump = app.querySelector('#side-account-jump');
    if (accJump) accJump.addEventListener('click', function () {
      go('settings');
      setTimeout(function () {
        const b = document.querySelector('[data-stab-btn="account"]');
        if (b) b.click();
      }, 60);
    });

    const main = document.getElementById('main-content');
    if (current === 'home') window.HomeView.render(main);
    else if (current === 'plan') window.PlanView.render(main);
    else if (current === 'digital') window.Views.items(main, 'digital');
    else if (current === 'clothing') window.Views.items(main, 'clothing');
    else if (current === 'life') window.LifeView.render(main);
    else if (current === 'wallet') window.WalletView.render(main);
    else if (current === 'outfits') window.Views.outfits(main);
    else if (current === 'food') window.FoodView.render(main);
    else if (current === 'settings') window.SettingsView.render(main);

    bindSearch();
    bindSidebarResize(db);
  }

  /* ---------- 侧栏宽度拖拽（v1.0.8）：接缝按住拖动，双击恢复默认 ---------- */
  function bindSidebarResize(db) {
    const handle = document.getElementById('sidebar-resizer');
    if (!handle) return;
    const MIN = 176, MAX = 300, DEF = 200;
    let dragging = false;
    let lastW = Number(db.settings.sidebarWidth) || DEF;
    handle.addEventListener('pointerdown', function (e) {
      dragging = true;
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      lastW = Math.min(MAX, Math.max(MIN, e.clientX));
      document.documentElement.style.setProperty('--sidebar-w', lastW + 'px');
    });
    function stop(e) {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
      db.settings.sidebarWidth = lastW;
      S.saveSettings();
    }
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('dblclick', function () {
      document.documentElement.style.setProperty('--sidebar-w', DEF + 'px');
      lastW = DEF;
      db.settings.sidebarWidth = DEF;
      S.saveSettings();
      window.UI.toast('侧栏宽度已恢复默认', 'success');
    });
  }

  /* ---------- 全局搜索 ---------- */
  let docClickBound = false;
  function bindSearch() {
    // 输入框随外壳重建，每次都要绑；document 级监听只绑一次防泄漏
    const input = document.getElementById('global-search');
    const box = document.getElementById('search-results');
    if (!input) return;

    function doSearch() {
      const q = input.value.trim().toLowerCase();
      if (!q) { box.classList.remove('show'); box.innerHTML = ''; return; }
      const db = S.getDB();
      const results = [];
      db.items.forEach(function (i) {
        if (((i.name || '') + (i.brand || '') + (i.notes || '') + (i.shade || '')).toLowerCase().indexOf(q) >= 0) {
          results.push({ type: i.kind === 'life' ? '生活' : i.kind === 'clothing' ? '衣橱' : '数码', name: i.name, go: i.kind === 'life' ? 'life' : i.kind === 'clothing' ? 'clothing' : 'digital', id: i.id });
        }
      });
      db.outfits.forEach(function (o) {
        if (((o.note || '') + (o.occasion || '')).toLowerCase().indexOf(q) >= 0) {
          results.push({ type: '穿搭', name: (o.occasion || '打卡') + ' · ' + o.date, go: 'outfits' });
        }
      });
      db.food.forEach(function (f) {
        if (((f.name || '') + (f.location || '') + (f.note || '') + (f.foodType || '')).toLowerCase().indexOf(q) >= 0) {
          results.push({ type: '美食', name: (f.name || f.foodType) + ' · ' + f.date, go: 'food' });
        }
      });
      // 钱袋账单：备注/分类名/金额可搜，命中直达流水（v1.2.0；分类名按 cats 树解析补齐，乙4）
      const wb = (db.wallet || {}).bills || [];
      const billCatName = (function () {
        const cats = (db.wallet || {}).cats || {};
        const map = {};
        ['expense', 'income'].forEach(function (k) {
          (cats[k] || []).forEach(function (c) {
            if (c && c.id) map[c.id] = c.name || '';
            (c.children || []).forEach(function (ch) { if (ch && ch.id) map[ch.id] = ch.name || ''; });
          });
        });
        return function (b) { return (map[b.catId] || '') + ' ' + (map[b.subCatId] || ''); };
      })();
      wb.forEach(function (b) {
        const hay = ((b.note || '') + ' ' + (b.accountName || '') + ' ' + String(b.amount || '') + ' ' + billCatName(b)).toLowerCase();
        if (hay.indexOf(q) >= 0) {
          results.push({ type: '账单', name: (b.note || '账单') + ' · ' + b.date + ' · ¥' + (b.amount || 0), go: 'wallet', billDate: b.date });
        }
      });
      box.innerHTML = results.length
        ? results.slice(0, 12).map(function (r, ri) {
          return '<div class="sr-row" data-go="' + r.go + '" data-id="' + (r.id || '') + '" data-ri="' + ri + '">' +
            '<span class="tag">' + r.type + '</span><span class="flex1">' + U.escapeHtml(r.name) + '</span></div>';
        }).join('')
        : '<div class="sr-row"><span class="muted">没有找到相关内容</span></div>';
      box.classList.add('show');
      box.querySelectorAll('[data-go]').forEach(function (row) {
        row.addEventListener('click', function () {
          const go = row.getAttribute('data-go');
          const id = row.getAttribute('data-id');
          const r = results[Number(row.getAttribute('data-ri'))] || {};
          box.classList.remove('show');
          input.value = '';
          if (go === 'wallet' && r.billDate && window.WalletView && window.WalletView.jumpTo) {
            window.WalletView.jumpTo({ date: r.billDate }); // 账单命中直达流水并定位日期
            return;
          }
          goPage(go);
          if (id) setTimeout(function () { window.Views.openItemDetail(id); }, 120);
        });
      });
    }

    input.addEventListener('input', U.debounce(doSearch, 220));
    input.addEventListener('focus', function () {
      if (input.value.trim()) doSearch();
    });
    if (!docClickBound) {
      docClickBound = true;
      document.addEventListener('click', function (e) {
        if (!e.target.closest('.side-search') && !e.target.closest('.search-results')) {
          const rb = document.getElementById('search-results'); // 实时查找，避免闭包旧元素
          if (rb) rb.classList.remove('show');
        }
      });
    }
  }

  function goPage(id) {
    current = id;
    render();
  }

  /* ---------- 启动流程 ---------- */
  async function boot() {
    await S.loadSession();
    return S.getSession();
  }

  /* 启动静默检查更新（3 秒后，避免阻塞启动） */
  function scheduleUpdateCheck() {
    setTimeout(function () {
      if (window.Updater) window.Updater.check(true);
    }, 3000);
  }

  /* 更新完成自动刷新后：提示升级成功并清掉更新标记（v1.0.7） */
  function checkUpgradeToast() {
    try {
      const ver = sessionStorage.getItem('lovelife-upgraded');
      if (!ver) return;
      sessionStorage.removeItem('lovelife-upgraded');
      fetch('/api/update/clear-done', { method: 'POST' }).catch(function () {});
      setTimeout(function () {
        window.UI.toast('升级成功 v' + (ver || FRONTEND_VERSION), 'success');
      }, 500);
    } catch (e) { /* 忽略 */ }
  }

  async function init() {
    try {
      await boot();
      checkUpgradeToast();
      const session = S.getSession();
      // 启动动画 → 账号选择（记住则自动进入）
      const app = document.getElementById('app');
      app.innerHTML =
        '<div class="splash"><div class="splash-logo">∞</div>' +
        '<div class="splash-name">人生管家</div>' +
        '<div class="splash-bar"><i></i></div></div>';
      await new Promise(function (r) { setTimeout(r, 700); });

      const remember = session.lastAccountId && (session.accounts || []).some(function (a) {
        return a.id === session.lastAccountId;
      });
      if (remember) {
        try {
          await S.selectAccount(session.lastAccountId);
          const db = S.getDB();
          if (db.settings.rememberAccount === false) {
            showAccountPicker();
            scheduleUpdateCheck();
            return;
          }
          render();
          scheduleUpdateCheck();
          return;
        } catch (e) { /* fallthrough */ }
      }
      showAccountPicker();
      scheduleUpdateCheck();
    } catch (e) {
      const app = document.getElementById('app');
      app.innerHTML = '<div class="connect-screen"><div class="connect-card">' +
        '<div class="connect-icon">∞</div><h1>人生管家</h1>' +
        '<p class="muted">无法连接本地数据服务</p>' +
        '<p class="muted small">请通过 lovelife.bat 启动，或确认 lovelife-server.exe 正在运行</p>' +
        '<button class="btn btn-primary btn-lg" onclick="location.reload()">重试</button>' +
        '</div></div>';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    init();
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const input = document.getElementById('global-search');
        if (input) { input.focus(); input.select(); }
      }
    });
    // 窗口尺寸记忆（v1.1.4）：调整窗口后记录大小，下次启动脚本按此开窗。
    // 小于 1024x700 的尺寸不记（防畸形窗口被记住）；失败静默不影响使用
    const WIN_MIN_W = 1024, WIN_MIN_H = 700;
    let winSizeTimer = null;
    window.addEventListener('resize', function () {
      // 最小窗口硬限制：拖过界立即拉回（--app 软件窗口生效，普通浏览器标签忽略降级）
      if (window.outerWidth < WIN_MIN_W || window.outerHeight < WIN_MIN_H) {
        try {
          window.resizeTo(Math.max(WIN_MIN_W, window.outerWidth || WIN_MIN_W), Math.max(WIN_MIN_H, window.outerHeight || WIN_MIN_H));
        } catch (e) { /* 浏览器拒绝时降级：内容层 min-width 保证不畸形 */ }
      }
      clearTimeout(winSizeTimer);
      winSizeTimer = setTimeout(function () {
        const w = window.outerWidth, h = window.outerHeight;
        if (!w || !h || w < WIN_MIN_W || h < WIN_MIN_H) return;
        try {
          fetch('/api/window-size', { method: 'POST', body: JSON.stringify({ width: w, height: h }) }).catch(function () {});
        } catch (e) { /* 忽略 */ }
      }, 600);
    });
    // 关闭前最后记一次（resize 防抖未到就关窗口也不丢）
    window.addEventListener('beforeunload', function () {
      const w = window.outerWidth, h = window.outerHeight;
      if (!w || !h || w < WIN_MIN_W || h < WIN_MIN_H) return;
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/window-size', JSON.stringify({ width: w, height: h }));
        } else {
          fetch('/api/window-size', { method: 'POST', body: JSON.stringify({ width: w, height: h }), keepalive: true }).catch(function () {});
        }
      } catch (e) { /* 忽略 */ }
    });
  });

  return {
    go: go, refresh: refresh, render: render,
    showAccountPicker: showAccountPicker,
    avatarPickerHTML: avatarPickerHTML, bindAvatarPicker: bindAvatarPicker,
    AVATARS: AVATARS, FRONTEND_VERSION: FRONTEND_VERSION, NAV: NAV
  };
})();
