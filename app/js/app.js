/* app.js — 启动页 / 账号选择 / 全局搜索 / 路由（人生管家 lovelife） */
window.App = (function () {
  const S = window.Storage;
  const U = window.Utils;

  let current = 'plan';
  let booted = false;

  const NAV = [
    { id: 'plan', label: '我的统计', icon: '📊' },
    { id: 'digital', label: '我的数码', icon: '🎮' },
    { id: 'clothing', label: '我的衣橱', icon: '👕' },
    { id: 'life', label: '我的生活', icon: '💄' },
    { id: 'outfits', label: '穿搭日历', icon: '📅' },
    { id: 'food', label: '美食日历', icon: '🍽️' },
    { id: 'settings', label: '设置', icon: '⚙️' }
  ];

  const AVATARS = ['😊', '😎', '🐱', '🐶', '🦊', '🐼', '🦁', '🌟', '🌙', '🍀',
    '🔥', '💎', '🎨', '🎧', '🍰', '🚀', '🌈', '🦋', '🌊', '🍑',
    '⚽', '🎮', '📚', '☕'];

  function go(id) {
    current = id;
    render();
  }

  function refresh() { render(); }

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
    app.innerHTML =
      '<aside class="sidebar">' +
      '<div class="brand"><span class="brand-icon">∞</span>' +
      '<div><div class="brand-name">人生管家</div><div class="brand-sub">' +
      U.escapeHtml((db.account && db.account.icon) || '') + ' ' + U.escapeHtml((db.account && db.account.name) || '') +
      '</div></div></div>' +
      '<nav class="nav">' + NAV.map(function (n) {
        return '<a class="nav-item' + (current === n.id ? ' active' : '') + '" data-nav="' + n.id + '">' +
          '<span class="nav-icon">' + n.icon + '</span><span>' + n.label + '</span></a>';
      }).join('') + '</nav>' +
      '<div class="sidebar-foot"><div class="muted small">Ctrl+K 全局搜索 · 可整包迁移</div></div>' +
      '</aside>' +
      '<main class="main">' +
      '<div class="top-search"><input id="global-search" placeholder="全局搜索物品 / 穿搭 / 美食…（Ctrl+K）">' +
      '<div class="search-results" id="search-results"></div></div>' +
      '<div id="main-content"></div></main>';

    app.querySelectorAll('[data-nav]').forEach(function (el) {
      el.addEventListener('click', function () { go(el.getAttribute('data-nav')); });
    });

    const main = document.getElementById('main-content');
    if (current === 'plan') window.PlanView.render(main);
    else if (current === 'digital') window.Views.items(main, 'digital');
    else if (current === 'clothing') window.Views.items(main, 'clothing');
    else if (current === 'life') window.LifeView.render(main);
    else if (current === 'outfits') window.Views.outfits(main);
    else if (current === 'food') window.FoodView.render(main);
    else if (current === 'settings') window.SettingsView.render(main);

    bindSearch();
  }

  /* ---------- 全局搜索 ---------- */
  function bindSearch() {
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
          results.push({ type: i.kind === 'life' ? '生活' : i.kind === 'clothing' ? '衣服' : '数码', name: i.name, go: i.kind === 'life' ? 'life' : i.kind === 'clothing' ? 'clothing' : 'digital', id: i.id });
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
      box.innerHTML = results.length
        ? results.slice(0, 12).map(function (r) {
          return '<div class="sr-row" data-go="' + r.go + '" data-id="' + (r.id || '') + '">' +
            '<span class="tag">' + r.type + '</span><span class="flex1">' + U.escapeHtml(r.name) + '</span></div>';
        }).join('')
        : '<div class="sr-row"><span class="muted">没有找到相关内容</span></div>';
      box.classList.add('show');
      box.querySelectorAll('[data-go]').forEach(function (row) {
        row.addEventListener('click', function () {
          const go = row.getAttribute('data-go');
          const id = row.getAttribute('data-id');
          box.classList.remove('show');
          input.value = '';
          goPage(go);
          if (id) setTimeout(function () { window.Views.openItemDetail(id); }, 120);
        });
      });
    }

    input.addEventListener('input', U.debounce(doSearch, 220));
    input.addEventListener('focus', function () {
      if (input.value.trim()) doSearch();
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.top-search')) box.classList.remove('show');
    });
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

  async function init() {
    try {
      await boot();
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
  });

  return {
    go: go, refresh: refresh, render: render,
    showAccountPicker: showAccountPicker,
    avatarPickerHTML: avatarPickerHTML, bindAvatarPicker: bindAvatarPicker,
    AVATARS: AVATARS
  };
})();
