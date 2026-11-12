/* views-settings.js — 设置页：7 组单列纵向排列（账号/数据备份/记账设置/预算与成本/界面与偏好/软件/危险操作） */
window.SettingsView = (function () {
  const U = window.Utils;
  const M = window.Models;
  const S = window.Storage;
  const UI = window.UI;

  /* 甲14：会话级页面态——当前分标签（任何 refresh 后恢复原标签，不再跳回「账号」）
     + 数据体检结果（存在模块态里渲染，refresh 后仍在，直到下次数据操作） */
  let curStab = 'account';
  let repairResult = '';

  /* 甲12：分类预算输入行按钱包分类树自动生成（10 大类全齐、名称=分类树名称）；
     保存键沿用 budget.walletCats[大类id]（与「我的统计 · 预算进度」读取口径一致，兼容既有数据） */
  function walletBudgetInputs(db, budget) {
    let list = ((((db || {}).wallet || {}).cats) || {}).expense || [];
    if (!list.length && M.defaultWalletCats) list = M.defaultWalletCats().expense || [];
    const wc = (budget && budget.walletCats) || {};
    return list.map(function (c) {
      return '<label><span class="f-label">' + U.escapeHtml(c.name) + '</span>' +
        '<input type="number" data-wcat-budget="' + U.escapeHtml(c.id) + '" value="' + (Number(wc[c.id]) || 0) + '"></label>';
    }).join('');
  }

  /* 甲17：危险操作前自动备份——服务端把账号数据快照到 backups/（/api/backup?snapshot=1 钩子）；
     快照失败则取消本次操作（确认框承诺「操作前将自动备份」，做不到就不做） */
  async function autoBackup() {
    try {
      const r = await fetch('/api/backup?acc=' + encodeURIComponent(S.accId()) + '&snapshot=1');
      return !!(r && r.ok);
    } catch (e) { return false; }
  }

  function render(root) {
    const db = S.getDB();
    const session = S.getSession() || {};
    const accounts = (db && db.accounts) || session.accounts || [];
    const cur = (db && db.account) || {};
    const cats = (db && db.categories) || {};
    const budget = (db && db.settings.budget) || { monthlyTotal: 0, categories: {} };
    const blocks = window.PlanView ? window.PlanView.blockState(db) : { overall: true, digital: true, clothing: true, life: true };

    root.innerHTML =
      '<div class="page-head"><h2>设置</h2></div>' +
      // 标签栏移出内容栈（v1.1.6）：标题→标签→面板的垂直节奏与其他页面一致
      stabBar() +
      '<div class="settings-stack">' +

      /* 1️⃣ 账号 */
      section('account', '账号',
        '<p class="muted">当前账号：<strong>' + U.escapeHtml(cur.icon || '') + ' ' + U.escapeHtml(cur.name || '—') + '</strong>，各账号数据完全独立。</p>' +
        '<div class="mini-table">' + accounts.map(function (a) {
          return '<div class="mini-row op-host"><span>' + U.escapeHtml(a.icon || '😊') + '</span>' +
            '<span class="flex1">' + U.escapeHtml(a.name) + (a.id === cur.id ? ' <span class="tag">当前</span>' : '') + '</span>' +
            '<span class="op-float">' +
            '<button class="btn-icon" data-rename="' + a.id + '" title="重命名">' + UI.icon('pencil', 14) + '</button>' +
            (accounts.length > 1 ? '<button class="btn-icon" data-del-acc="' + a.id + '" title="删除">' + UI.icon('trash-2', 14) + '</button>' : '') +
            '</span>' +
            (a.id === cur.id ? '' : '<button class="btn btn-ghost btn-sm" data-switch="' + a.id + '">切换</button>') +
            '</div>';
        }).join('') + '</div>' +
        '<div class="btn-row"><button class="btn btn-primary btn-sm" id="btn-add-acc">' + UI.icon('plus', 14) + ' 新建账号</button>' +
        '<button class="btn btn-ghost btn-sm" id="btn-switch-page">回到启动页</button></div>') +

      /* 2️⃣ 数据备份：目录迁移 / 备份恢复 / 数据体检 */
      section('data', '数据备份',
        '<p class="muted">数据按账号存放在根目录子文件夹（JSON + 图片），可整体迁移。</p>' +
        '<p class="path-text">当前根目录：<strong class="path-text">' + U.escapeHtml(db.dataRoot || '') + '</strong></p>' +
        '<div class="form-grid"><label class="f-full"><span class="f-label">新的数据根目录（绝对路径）</span>' +
        '<input id="new-root" placeholder="如 E:\\lovelife-data"></label></div>' +
        '<div class="btn-row">' +
        '<button class="btn btn-primary btn-sm" id="btn-move-root">' + UI.icon('folder-sync', 14) + ' 迁移并切换</button>' +
        '<button class="btn btn-ghost btn-sm" id="btn-export">' + UI.icon('download', 14) + ' 导出全量备份包</button>' +
        '<button class="btn btn-ghost btn-sm" id="btn-import">' + UI.icon('upload', 14) + ' 从备份恢复</button>' +
        '<input type="file" id="import-file" accept=".gz,.tar,.tgz" hidden></div>' +
        '<h4 class="detail-sub">数据体检</h4>' +
        '<p class="muted small">检查并修复：账单与词条/美食的悬空关联、自动同步的孤儿记录、余额快照的失效账户。安全可重复执行。</p>' +
        '<div class="btn-row"><button class="btn btn-ghost btn-sm" id="btn-repair">' + UI.icon('stethoscope', 14) + ' 开始体检</button>' +
        '<span id="repair-result" class="muted small">' + U.escapeHtml(repairResult) + '</span></div>') +

      /* 3️⃣ 记账设置：账单导入导出 / 分类一览 / 分类预算 */
      section('bill', '记账设置',
        '<h4 class="detail-sub">账单导入 / 导出（我的钱袋）</h4>' +
        '<div id="s-bill-io"></div>' +
        '<h4 class="detail-sub">记账分类一览</h4>' +
        (window.WalletView ? window.WalletView.catTreeCompactHTML() : '<p class="muted small">钱袋模块未加载</p>') +
        '<h4 class="detail-sub">记账分类预算（可选，0=不设）</h4>' +
        '<p class="muted small">按记账分类树自动生成全部大类，名称随分类树（如「送礼人情」）；与「预算与成本」的物品分域预算互不覆盖。</p>' +
        '<div class="form-grid">' +
        walletBudgetInputs(db, budget) +
        '</div>' +
        '<div class="btn-row"><button class="btn btn-primary btn-sm" id="btn-save-wcat-budget">' + UI.icon('save', 14) + ' 保存记账分类预算</button></div>') +

      /* 4️⃣ 预算与成本：总预算 / 物品分域预算 / 成本模型 */
      section('cost', '预算与成本',
        '<h4 class="detail-sub">月度预算</h4>' +
        '<div class="form-grid">' +
        '<label><span class="f-label">每月总预算</span><input type="number" id="b-total" value="' + (budget.monthlyTotal || 0) + '"></label>' +
        '</div>' +
        '<h4 class="detail-sub">物品分域预算</h4>' +
        '<div class="form-grid">' +
        '<label><span class="f-label">数码预算</span><input type="number" id="b-digital" value="' + ((budget.categories || {}).digital || 0) + '"></label>' +
        '<label><span class="f-label">衣服预算</span><input type="number" id="b-clothing" value="' + ((budget.categories || {}).clothing || 0) + '"></label>' +
        '<label><span class="f-label">生活预算</span><input type="number" id="b-life" value="' + ((budget.categories || {}).life || 0) + '"></label>' +
        '<label><span class="f-label">美食预算</span><input type="number" id="b-food" value="' + ((budget.categories || {}).food || 0) + '"></label>' +
        '</div>' +
        '<div class="btn-row"><button class="btn btn-primary btn-sm" id="btn-save-budget">' + UI.icon('save', 14) + ' 保存预算</button></div>' +
        '<h4 class="detail-sub">成本模型（寿命 / 残值率）</h4>' +
        catTable('digital', '数码（含游戏）', cats.digital) +
        catTable('clothing', '服饰（寿命参考）', cats.clothing) +
        catTable('life', '美妆（寿命参考）', cats.life) +
        '<div class="btn-row"><button class="btn btn-primary btn-sm" id="btn-save-cats">' + UI.icon('save', 14) + ' 保存成本模型</button></div>' +
        '<div id="cost-err" class="small"></div>') +

      /* 5️⃣ 界面与偏好：导航排序 / 板块显示 / 吃灰预警 / 标签管理（两库并列） */
      section('pref', '界面与偏好',
        '<h4 class="detail-sub">侧栏导航</h4>' +
        '<div class="mini-table" id="nav-order-list"></div>' +
        '<h4 class="detail-sub">我的统计板块显示</h4>' +
        '<div class="chip-row">' +
        (window.PlanView ? window.PlanView.BLOCKS : []).map(function (b) {
          const on = blocks[b.id] !== false;
          return '<label class="chip-check"><input type="checkbox" data-block-pref="' + b.id + '"' +
            (on ? ' checked' : '') + '><span>' + b.name + '</span></label>';
        }).join('') + '</div>' +
        '<h4 class="detail-sub">吃灰预警天数</h4>' +
        '<div class="form-grid"><label><span class="f-label">吃灰预警天数</span>' +
        '<input type="number" id="set-idle" value="' + (db.settings.idleWarnDays || 60) + '"></label></div>' +
        '<p class="muted small">修改后自动保存（与板块显示一致）。</p>' +
        '<h4 class="detail-sub">美食日历餐别快捷</h4>' +
        '<div class="form-grid"><label><span class="f-label">餐别快捷框（早/中/晚/加）显示</span>' +
        '<select id="set-meal-quick">' +
        '<option value="always"' + (db.settings.foodMealQuick !== 'hover' ? ' selected' : '') + '>常驻显示（推荐）</option>' +
        '<option value="hover"' + (db.settings.foodMealQuick === 'hover' ? ' selected' : '') + '>悬停当天浮出</option>' +
        '</select></label></div>' +
        '<h4 class="detail-sub">物品标签库</h4>' +
        '<p class="muted">个人标签库：录入表单可直接选用。删除只影响标签库，已打标签的物品不受影响。</p>' +
        '<div class="mini-table" id="tag-lib-list"></div>' +
        '<div class="tag-add-row"><input id="tag-lib-new" placeholder="添加标签到物品标签库">' +
        '<button type="button" class="btn btn-ghost btn-sm" id="tag-lib-add">添加</button></div>' +
        '<h4 class="detail-sub">钱袋标签库</h4>' +
        '<p class="muted">钱袋账单标签库：记一笔时可直接选用。删除时已打此标签的账单会移除标记。</p>' +
        '<div class="mini-table" id="wtag-list"></div>' +
        '<div class="tag-add-row"><input id="wtag-new" placeholder="添加标签到钱袋标签库">' +
        '<button type="button" class="btn btn-ghost btn-sm" id="wtag-add">添加</button></div>') +

      /* 6️⃣ 软件 */
      section('soft', '软件',
        '<p>当前版本：<strong id="cur-ver">…</strong> <span class="muted small" id="fe-ver"></span></p>' +
        '<div id="ver-mismatch"></div>' +
        '<p class="muted">启动时自动检测新版；更新只替换程序文件，数据不受影响。</p>' +
        '<div class="btn-row">' +
        '<button class="btn btn-primary" id="btn-check-update">' + UI.icon('refresh-cw', 14) + ' 检查更新</button>' +
        '<button class="btn btn-ghost" id="btn-view-log">' + UI.icon('file-text', 14) + ' 查看更新日志</button>' +
        '<button class="btn btn-ghost" id="btn-shortcut">' + UI.icon('monitor-up', 14) + ' 创建桌面快捷方式</button></div>' +
        '<p class="muted small">在桌面创建「人生管家」快捷方式，双击即可启动（自动打开应用窗口）。</p>' +
        '<div id="update-info" class="muted small"></div>') +

      /* 7️⃣ 危险操作 */
      '<div class="panel panel-danger stab" data-stab="danger"><div class="panel-head"><h3>危险操作</h3></div><div class="panel-body">' +
      '<p class="muted">清空当前账号的全部数据：全部记录（物品/穿搭/美食/打卡/账单/账户/余额/导入记录/模板）+ 全部设置（预算/标签库/导航排序/成本模型/界面偏好/穿搭组合与妆容组合），不可恢复。操作前将自动备份一份到 backups/。</p>' +
      '<div class="btn-row"><button class="btn btn-danger" id="btn-reset">' + UI.icon('trash-2', 14) + ' 清空当前账号数据</button></div></div></div>' +

      '</div>';

    bind(root, db, accounts, cur);
  }

  /* 侧栏导航（v1.2.01）：排序 + 屏蔽任意模块（设置常驻），实时起效。
     顺序单源=App.navOrdered（曾各自拼序致设置列表与侧栏漂移） */
  function refreshNavOrder(root, db) {
    const box = root.querySelector('#nav-order-list');
    if (!box || !window.App || !window.App.navOrdered) return;
    const list = window.App.navOrdered(db);
    const hidden = db.settings.navHidden || [];
    box.innerHTML = list.map(function (n, i) {
      const hid = hidden.indexOf(n.id) >= 0;
      return '<div class="mini-row"><span class="flex1">' + UI.icon(n.icon, 14) + ' ' + n.label +
        (hid ? '<span class="muted small"> · 已屏蔽</span>' : '') + '</span>' +
        (n.id === 'settings' ? '' :
          '<button class="btn-icon" data-nav-hide="' + U.escapeHtml(n.id) + '" title="' + (hid ? '恢复显示' : '屏蔽（侧栏隐藏）') + '">' +
          UI.icon(hid ? 'eye' : 'eye-off', 14) + '</button>') +
        '<button class="btn-icon" data-nav-up="' + i + '" title="上移">' + UI.icon('chevron-up', 14) + '</button>' +
        '<button class="btn-icon" data-nav-down="' + i + '" title="下移">' + UI.icon('chevron-down', 14) + '</button></div>';
    }).join('');
    // 屏蔽/恢复：侧栏实时起效
    box.querySelectorAll('[data-nav-hide]').forEach(function (b) {
      b.addEventListener('click', async function () {
        const id = b.getAttribute('data-nav-hide');
        const arr = (db.settings.navHidden || []).slice();
        const k = arr.indexOf(id);
        if (k >= 0) arr.splice(k, 1); else arr.push(id);
        db.settings.navHidden = arr;
        await S.saveSettings();
        refreshNavOrder(root, db);
        if (window.App && window.App.refresh) window.App.refresh(); // 实时起效
        window.UI.toast(k >= 0 ? '已恢复显示' : '已屏蔽（侧栏隐藏）', 'success');
      });
    });
    async function move(from, to) {
      const ids = list.map(function (x) { return x.id; });
      if (to < 0 || to >= ids.length) return;
      const arr = ids.slice();
      const tmp = arr[from]; arr[from] = arr[to]; arr[to] = tmp;
      db.settings.navOrder = arr;
      await S.saveSettings();
      refreshNavOrder(root, db);
      window.UI.toast('导航顺序已保存', 'success');
    }
    box.querySelectorAll('[data-nav-up]').forEach(function (b) {
      b.addEventListener('click', function () {
        const i = Number(b.getAttribute('data-nav-up'));
        move(i, i - 1);
      });
    });
    box.querySelectorAll('[data-nav-down]').forEach(function (b) {
      b.addEventListener('click', function () {
        const i = Number(b.getAttribute('data-nav-down'));
        move(i, i + 1);
      });
    });
  }

  /* 物品标签库（v1.0.9）：增删物品自定义标签库（customTags）；预设只读展示 */
  function refreshTagLib(root, db) {
    const box = root.querySelector('#tag-lib-list');
    if (!box) return;
    const lib = db.settings.customTags || [];
    const presets = (db.categories && db.categories.tagPresets) || [];
    box.innerHTML =
      '<div class="mini-row"><span class="flex1 muted">预设（固定，不可删）</span>' +
      '<span class="muted small">' + (presets.length ? presets.join('、') : '—') + '</span></div>' +
      (lib.length ? lib.map(function (t) {
        return '<div class="mini-row op-host"><span class="flex1">' + U.escapeHtml(t) + '</span>' +
          '<span class="op-float"><button class="btn-icon" data-del-taglib="' + U.escapeHtml(t) + '" title="从物品标签库删除">' +
          UI.icon('trash-2', 14) + '</button></span></div>';
      }).join('') : '<div class="empty-state empty-card"><div class="empty-icon">' + UI.icon('tags', 48) + '</div>' +
        '<p>物品标签库为空，可在录入表单输入自定义标签后自动入库</p>' +
        '<button type="button" class="btn btn-ghost" data-eg-go="clothing">去添加物品</button></div>');
    box.querySelectorAll('[data-del-taglib]').forEach(function (b) {
      b.addEventListener('click', async function () {
        const v = b.getAttribute('data-del-taglib');
        if (!await UI.confirmDialog('删除标签', '从物品标签库删除「' + v + '」？已打此标签的物品不受影响。')) return;
        db.settings.customTags = (db.settings.customTags || []).filter(function (x) { return x !== v; });
        await S.saveSettings();
        UI.toast('已从物品标签库删除', 'success');
        refreshTagLib(root, db);
      });
    });
  }

  /* 钱袋标签库（六分组重组新增）：wallet.tags 增删，账单标签与物品标签分库管理 */
  function refreshWalletTags(root, db) {
    const box = root.querySelector('#wtag-list');
    if (!box) return;
    const tags = (db.wallet && db.wallet.tags) || [];
    box.innerHTML = tags.length ? tags.map(function (t) {
      return '<div class="mini-row op-host"><span class="flex1">' + U.escapeHtml(t.name) + '</span>' +
        '<span class="op-float"><button class="btn-icon" data-del-wtag="' + U.escapeHtml(t.id) + '" title="从钱袋标签库删除">' +
        UI.icon('trash-2', 14) + '</button></span></div>';
    }).join('') : '<div class="empty-state empty-card"><div class="empty-icon">' + UI.icon('wallet', 48) + '</div>' +
      '<p>钱袋标签库为空，记账时输入的标签会自动入库</p>' +
      '<button type="button" class="btn btn-ghost" data-eg-go="wallet">去记一笔</button></div>';
    box.querySelectorAll('[data-del-wtag]').forEach(function (b) {
      b.addEventListener('click', async function () {
        const id = b.getAttribute('data-del-wtag');
        const tag = ((db.wallet && db.wallet.tags) || []).find(function (t) { return t.id === id; });
        const name = tag ? tag.name : '';
        if (!await UI.confirmDialog('删除标签', '从钱袋标签库删除「' + name + '」？已打此标签的账单会移除标记。')) return;
        await S.removeWalletTag(id);
        UI.toast('已从钱袋标签库删除', 'success');
        refreshWalletTags(root, db);
      });
    });
  }

  /* 分标签渲染（v1.0.9）：一次只显示一组；切换只换显隐，既有绑定不受影响 */
  const STABS = [
    { id: 'account', label: '账号', icon: 'users' },
    { id: 'data', label: '数据备份', icon: 'database' },
    { id: 'bill', label: '记账设置', icon: 'receipt' },
    { id: 'cost', label: '预算与成本', icon: 'coins' },
    { id: 'pref', label: '界面与偏好', icon: 'sliders-horizontal' },
    { id: 'soft', label: '软件', icon: 'app-window' },
    { id: 'danger', label: '危险操作', icon: 'triangle-alert' }
  ];
  function section(stab, title, body) {
    return '<div class="panel stab' + (stab === curStab ? ' stab-on' : '') + '" data-stab="' + stab + '">' +
      '<div class="panel-head"><h3>' + title + '</h3></div>' +
      '<div class="panel-body">' + body + '</div></div>';
  }
  function stabBar() {
    return '<div class="settings-tabs">' + STABS.map(function (t) {
      return '<button type="button" class="stab-btn' + (t.id === curStab ? ' on' : '') + '" data-stab-btn="' + t.id + '">' +
        UI.icon(t.icon, 16) + '<span>' + t.label + '</span></button>';
    }).join('') + '</div>';
  }

  /* ---------- 事件绑定 ---------- */
  function bind(root, db, accounts, cur) {
    // 分标签切换（只换显隐，各组既有绑定不受影响）
    root.querySelectorAll('[data-stab-btn]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = b.getAttribute('data-stab-btn');
        curStab = id; // 甲14：记住当前分标签，refresh 后恢复（不跳回「账号」）
        root.querySelectorAll('[data-stab-btn]').forEach(function (x) { x.classList.toggle('on', x === b); });
        root.querySelectorAll('.stab').forEach(function (p) {
          p.classList.toggle('stab-on', p.getAttribute('data-stab') === id);
        });
      });
    });
    // 空态卡引导按钮（丙3）：事件委托（每 root 只绑一次）
    if (!root.hasAttribute('data-eg-bound')) {
      root.setAttribute('data-eg-bound', '1');
      root.addEventListener('click', function (e) {
        const b = e.target && e.target.closest ? e.target.closest('[data-eg-go]') : null;
        if (b && root.contains(b)) window.App.go(b.getAttribute('data-eg-go'));
      });
    }
    // 版本信息（三方校验：version.json / exe / 前端资源，不一致 = 上次更新只换了一半）
    fetch('/api/version').then(function (r) { return r.json(); }).then(function (v) {
      const el = root.querySelector('#cur-ver');
      const fe = (window.App && window.App.FRONTEND_VERSION) || '';
      const exe = v.serverBuild || '';
      if (el) el.textContent = 'v' + (v.version || '');
      const feEl = root.querySelector('#fe-ver');
      if (feEl) feEl.textContent = '程序 v' + (exe || '—') + ' · 前端 v' + (fe || '—');
      const mm = root.querySelector('#ver-mismatch');
      const vers = [v.version, exe, fe].filter(Boolean);
      const mismatch = vers.length >= 2 && vers.some(function (x) { return x !== vers[0]; });
      if (mm && mismatch) {
        mm.innerHTML = '<div class="update-warn" style="margin:8px 0">' + UI.icon('triangle-alert', 14) + ' <strong>版本组件不一致</strong>（清单 v' +
          U.escapeHtml(v.version || '—') + ' / 程序 v' + U.escapeHtml(exe || '—') + ' / 前端 v' + U.escapeHtml(fe || '—') +
          '）：上次更新未完整落地，界面功能可能异常（如栏目排序失效）。请下载最新 zip 解压覆盖整个安装目录（data 文件夹会保留），重启即可修复。</div>';
      }
    }).catch(function () {});

    /* 账号 */
    root.querySelectorAll('[data-switch]').forEach(function (b) {
      b.addEventListener('click', async function () {
        await S.selectAccount(b.getAttribute('data-switch'));
        UI.toast('已切换账号', 'success');
        window.App.refresh();
      });
    });
    root.querySelectorAll('[data-rename]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = b.getAttribute('data-rename');
        const a = accounts.find(function (x) { return x.id === id; });
        UI.modal({
          title: '编辑账号', width: 560,
          bodyHTML: '<div class="form-grid">' +
            '<label class="f-full"><span class="f-label">昵称</span><input id="acc-name" value="' + U.escapeHtml(a.name) + '"></label>' +
            '<div class="f-full"><span class="f-label">选择头像</span><input type="hidden" id="acc-icon" value="' + U.escapeHtml(a.icon || '😊') + '">' +
            window.App.avatarPickerHTML(a.icon || '😊') + '</div></div>',
          footerHTML: '<button class="btn btn-ghost" data-x="c">取消</button><button class="btn btn-primary" data-x="s">保存</button>',
          onMount: function (w, c) {
            window.App.bindAvatarPicker(w, '#acc-icon');
            w.querySelector('[data-x=c]').addEventListener('click', c);
            w.querySelector('[data-x=s]').addEventListener('click', async function () {
              await S.updateAccount(id, w.querySelector('#acc-name').value.trim(), w.querySelector('#acc-icon').value || '😊');
              c(); window.App.refresh();
            });
          }
        });
      });
    });
    root.querySelectorAll('[data-del-acc]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = b.getAttribute('data-del-acc');
        const isCur = !!(cur && cur.id === id);
        const accName = (accounts.find(function (x) { return x.id === id; }) || {}).name || '';
        const headMsg = isCur
          ? '将删除当前登录账号「' + accName + '」。删除后回到启动页重新选择账号。'
          : '将删除账号「' + accName + '」。';
        async function doDel(purge) {
          try {
            await S.deleteAccount(id, purge);
            UI.toast(purge ? '账号及其数据已彻底删除' : '账号已移除（数据保留在磁盘）', 'success');
            if (isCur) {
              // 删的是当前登录账号：会话已停止（内存 db 已清、已重载 /api/session），
              // 回到账号选择屏——旧会话不得继续保存把已删数据目录写活（A1）
              window.App.showAccountPicker();
            } else {
              window.App.refresh();
            }
          } catch (e) { UI.toast(e.message || '删除失败', 'error'); }
        }
        // 甲17 两档删除：彻底删除（purge=true）/ 仅移除账号（purge=false，数据保留在磁盘）
        UI.modal({
          title: '删除账号', width: 440,
          bodyHTML: '<p class="confirm-text">' + U.escapeHtml(headMsg) + '请选择删除方式：</p>' +
            '<div class="del-acc-opts">' +
            '<p class="muted small"><strong>彻底删除（含数据）</strong>：账号及其全部数据从磁盘删除，不可恢复。</p>' +
            '<p class="muted small"><strong>仅移除账号（数据保留在磁盘）</strong>：账号从列表移除，数据目录保留在磁盘，可先手动备份再清理。</p>' +
            '</div>',
          footerHTML: '<button class="btn btn-ghost" data-x="c">取消</button>' +
            '<button class="btn btn-ghost" data-act="keep">仅移除账号（数据保留在磁盘）</button>' +
            '<button class="btn btn-danger" data-act="yes">彻底删除（含数据）</button>',
          onMount: function (w, close) {
            w.querySelector('[data-x=c]').addEventListener('click', close);
            w.querySelector('[data-act=keep]').addEventListener('click', function () { close(); doDel(false); });
            w.querySelector('[data-act=yes]').addEventListener('click', function () { close(); doDel(true); });
          }
        });
      });
    });
    root.querySelector('#btn-add-acc').addEventListener('click', function () {
      UI.modal({
        title: '新建账号', width: 560,
        bodyHTML: '<div class="form-grid">' +
          '<label class="f-full"><span class="f-label">昵称</span><input id="acc-name" placeholder="如：妈妈 / 工作号"></label>' +
          '<div class="f-full"><span class="f-label">选择头像</span><input type="hidden" id="acc-icon" value="😊">' +
          window.App.avatarPickerHTML('😊') + '</div></div>',
        footerHTML: '<button class="btn btn-ghost" data-x="c">取消</button><button class="btn btn-primary" data-x="s">创建</button>',
        onMount: function (w, c) {
          window.App.bindAvatarPicker(w, '#acc-icon');
          w.querySelector('[data-x=c]').addEventListener('click', c);
          w.querySelector('[data-x=s]').addEventListener('click', async function () {
            const name = w.querySelector('#acc-name').value.trim();
            if (!name) { UI.toast('请填写昵称', 'error'); return; }
            const acc = await S.createAccount(name, w.querySelector('#acc-icon').value || '😊');
            await S.selectAccount(acc.id);
            c(); UI.toast('账号已创建并切换', 'success'); window.App.refresh();
          });
        }
      });
    });
    root.querySelector('#btn-switch-page').addEventListener('click', function () {
      window.App.showAccountPicker();
    });

    /* 数据备份 */
    root.querySelector('#btn-move-root').addEventListener('click', async function () {
      const path = root.querySelector('#new-root').value.trim();
      if (!path) { UI.toast('请填写新路径', 'error'); return; }
      if (!await UI.confirmDialog('迁移数据', '将数据复制到新目录并切换，原目录保留。确定？')) return;
      try {
        await S.setDataRoot(path, true);
        UI.toast('数据路径已切换', 'success');
        window.App.refresh();
      } catch (e) { UI.toast(e.message, 'error'); }
    });
    root.querySelector('#btn-export').addEventListener('click', async function () {
      try {
        const n = await S.exportBackup();
        UI.toast('已导出 ' + n, 'success');
      } catch (e) { UI.toast(e.message, 'error'); }
    });
    root.querySelector('#btn-import').addEventListener('click', function () {
      root.querySelector('#import-file').click();
    });
    root.querySelector('#import-file').addEventListener('change', async function (e) {
      const f = e.target.files[0];
      if (!f) return;
      // 文案与实际一致（A16）：恢复是与当前数据合并（备份里缺的文件保留现状），不是整体覆盖
      // 甲17：确认框提示自动备份；服务端恢复前本身也会留快照（恢复前快照已有，这里补自动导出）
      if (!await UI.confirmDialog('恢复备份', '将与当前账号数据合并（备份中缺的文件保留现状）。操作前将自动备份一份到 backups/，确定？')) return;
      if (!await autoBackup()) {
        UI.toast('自动备份失败，已取消恢复', 'error');
        return;
      }
      try {
        repairResult = '';
        await S.importBackup(f);
        UI.toast('已恢复', 'success'); window.App.refresh();
      } catch (err) { UI.toast(err.message, 'error'); }
    });
    // 数据体检（v1.2.0）：修复悬空关联/孤儿同步记录
    // 甲14：结果存模块态再渲染——refresh 重渲染不再抹掉结果，直到下次数据操作
    const repairBtn = root.querySelector('#btn-repair');
    if (repairBtn) repairBtn.addEventListener('click', async function () {
      repairBtn.disabled = true;
      repairResult = '体检中…';
      const out = root.querySelector('#repair-result');
      if (out) out.textContent = repairResult;
      try {
        const r = await S.repairData();
        repairResult = r.fixed ? '已修复 ' + r.fixed + ' 处数据问题' : '数据健康，无需修复';
        const el = root.querySelector('#repair-result');
        if (el) el.textContent = repairResult;
        UI.toast(r.fixed ? '体检完成，修复 ' + r.fixed + ' 处' : '数据健康', 'success');
        window.App.refresh();
      } catch (e) {
        repairResult = '体检失败：' + (e && e.message || e);
        const el = root.querySelector('#repair-result');
        if (el) el.textContent = repairResult;
      } finally {
        repairBtn.disabled = false;
      }
    });

    /* 记账设置 */
    // 账单导入/导出（钱袋入口统一收在设置）
    const billIO = root.querySelector('#s-bill-io');
    if (billIO && window.WalletView) window.WalletView.mountImportUI(billIO);
    // 记账分类预算：只写 walletCats，与「预算与成本」的保存按钮互不覆盖
    root.querySelector('#btn-save-wcat-budget').addEventListener('click', async function () {
      const walletCats = {};
      root.querySelectorAll('[data-wcat-budget]').forEach(function (el) {
        const v = Number(el.value) || 0;
        if (v > 0) walletCats[el.getAttribute('data-wcat-budget')] = v;
      });
      db.settings.budget = db.settings.budget || {};
      db.settings.budget.walletCats = walletCats;
      await S.saveSettings();
      UI.toast('记账分类预算已保存', 'success');
    });

    /* 预算与成本 */
    // 月度总预算 + 物品分域预算：只写 monthlyTotal+categories，walletCats 由记账设置单独维护，此处不动
    root.querySelector('#btn-save-budget').addEventListener('click', async function () {
      db.settings.budget = db.settings.budget || {};
      db.settings.budget.monthlyTotal = Number(root.querySelector('#b-total').value) || 0;
      db.settings.budget.categories = {
        digital: Number(root.querySelector('#b-digital').value) || 0,
        clothing: Number(root.querySelector('#b-clothing').value) || 0,
        life: Number(root.querySelector('#b-life').value) || 0,
        food: Number(root.querySelector('#b-food').value) || 0
      };
      await S.saveSettings();
      UI.toast('预算已保存', 'success');
    });
    root.querySelector('#btn-save-cats').addEventListener('click', async function () {
      // 甲13 校验：寿命 > 0、残值率 0~1（如 0.3）——越界红字拦截，不静默忽略；
      // 留空 = 不覆盖（防 Number('')=0 把 0 写进覆盖）；回默认走每行「恢复默认」按钮
      const errBox = root.querySelector('#cost-err');
      const errs = [];
      const edits = [];
      root.querySelectorAll('[data-cat-kind]').forEach(function (tbl) {
        const kind = tbl.getAttribute('data-cat-kind');
        tbl.querySelectorAll('tr[data-cid]').forEach(function (tr) {
          const cat = (db.categories[kind] || []).find(function (c) { return c.id === tr.getAttribute('data-cid'); });
          if (!cat) return;
          const lifeEl = tr.querySelector('[data-f=life]');
          const resEl = tr.querySelector('[data-f=res]');
          lifeEl.classList.remove('input-err');
          resEl.classList.remove('input-err');
          const name = cat.name || tr.getAttribute('data-cid');
          let ly = null, rv = null;
          const lifeStr = (lifeEl.value || '').trim();
          const resStr = (resEl.value || '').trim();
          if (lifeStr !== '') {
            ly = Number(lifeStr);
            if (isNaN(ly) || ly <= 0) {
              errs.push('「' + name + '」寿命需大于 0');
              lifeEl.classList.add('input-err');
              ly = null;
            }
          }
          if (resStr !== '') {
            rv = Number(resStr);
            if (isNaN(rv) || rv < 0 || rv > 1) {
              errs.push('「' + name + '」残值率需在 0~1 之间（如 0.3）');
              resEl.classList.add('input-err');
              rv = null;
            }
          }
          edits.push({ kind: kind, cat: cat, ly: ly, rv: rv });
        });
      });
      if (errs.length) {
        if (errBox) errBox.innerHTML = '<span class="field-err">' + U.escapeHtml(errs.join('；')) + '。已阻止保存，请修正后重试。</span>';
        UI.toast('成本模型有 ' + errs.length + ' 处校验未通过', 'error');
        return;
      }
      if (errBox) errBox.innerHTML = '';
      // 改动存 settings.costModelOverrides（服务端 load_db 会合并回分类树），
      // 同步改内存里的分类树供本次会话即时生效
      db.settings.costModelOverrides = db.settings.costModelOverrides || {};
      edits.forEach(function (e) {
        const cat = e.cat;
        if (e.ly !== null) cat.lifeYears = e.ly;
        // 残值率留空 = 不覆盖（防 Number('')=0 把 0 写进覆盖）
        if (e.rv !== null) cat.residualRate = e.rv;
        // 键带 kind 前缀：digital「配件」与 clothing「配饰」同 id 'acc'，裸 id 会互相覆盖（v1.0.9 修复）
        db.settings.costModelOverrides[e.kind + ':' + cat.id] = {
          lifeYears: cat.lifeYears, residualRate: cat.residualRate
        };
      });
      await S.saveSettings();
      UI.toast('成本模型已保存', 'success');
    });
    /* 甲13 恢复默认：每行一键重置为默认寿命 5 年 / 残值率 0.1（models.js 成本模型缺省值）并立即落库 */
    root.querySelectorAll('[data-cost-default]').forEach(function (b) {
      b.addEventListener('click', async function () {
        const tr = b.closest('tr');
        const tbl = tr && tr.closest('[data-cat-kind]');
        if (!tr || !tbl) return;
        const kind = tbl.getAttribute('data-cat-kind');
        const cat = (db.categories[kind] || []).find(function (c) { return c.id === tr.getAttribute('data-cid'); });
        if (!cat) return;
        const lifeEl = tr.querySelector('[data-f=life]');
        const resEl = tr.querySelector('[data-f=res]');
        lifeEl.value = '5';
        resEl.value = '0.1';
        lifeEl.classList.remove('input-err');
        resEl.classList.remove('input-err');
        cat.lifeYears = 5;
        cat.residualRate = 0.1;
        db.settings.costModelOverrides = db.settings.costModelOverrides || {};
        db.settings.costModelOverrides[kind + ':' + cat.id] = { lifeYears: 5, residualRate: 0.1 };
        await S.saveSettings();
        const errBox = root.querySelector('#cost-err');
        if (errBox) errBox.innerHTML = '';
        UI.toast('「' + (cat.name || '') + '」已恢复默认（寿命 5 年 / 残值率 0.1）', 'success');
      });
    });

    /* 界面与偏好 */
    refreshNavOrder(root, db);
    // 物品标签库（customTags）
    refreshTagLib(root, db);
    const tagAddBtn = root.querySelector('#tag-lib-add');
    if (tagAddBtn) tagAddBtn.addEventListener('click', async function () {
      const inp = root.querySelector('#tag-lib-new');
      const v = (inp.value || '').trim();
      if (!v) { inp.focus(); return; }
      db.settings.customTags = db.settings.customTags || [];
      if (db.settings.customTags.indexOf(v) < 0) db.settings.customTags.push(v);
      inp.value = '';
      await S.saveSettings();
      UI.toast('已加入物品标签库', 'success');
      refreshTagLib(root, db);
    });
    // 钱袋标签库（wallet.tags）
    refreshWalletTags(root, db);
    const wtagAddBtn = root.querySelector('#wtag-add');
    if (wtagAddBtn) wtagAddBtn.addEventListener('click', async function () {
      const inp = root.querySelector('#wtag-new');
      const v = (inp.value || '').trim();
      if (!v) { inp.focus(); return; }
      const tags = (db.wallet && db.wallet.tags) || [];
      if (tags.some(function (t) { return t.name === v; })) { UI.toast('该标签已存在', 'error'); return; }
      await S.saveWalletTag({ name: v });
      inp.value = '';
      UI.toast('已加入钱袋标签库', 'success');
      refreshWalletTags(root, db);
    });
    // v1.1.9 稽核：偏好项变更即存（对齐板块勾选的行为），不再依赖底部保存按钮
    const savePref = async function () {
      db.settings.idleWarnDays = Number(root.querySelector('#set-idle').value) || 60;
      db.settings.foodMealQuick = (root.querySelector('#set-meal-quick') || {}).value === 'hover' ? 'hover' : 'always';
      await S.saveSettings();
      UI.toast('偏好已保存', 'success');
    };
    root.querySelector('#set-idle').addEventListener('change', savePref);
    root.querySelector('#set-meal-quick').addEventListener('change', savePref);
    root.querySelectorAll('[data-block-pref]').forEach(function (cb) {
      cb.addEventListener('change', async function () {
        const id = cb.getAttribute('data-block-pref');
        db.settings.planBlocks = db.settings.planBlocks || {};
        db.settings.planBlocks[id] = cb.checked;
        await S.saveSettings();
        UI.toast(cb.checked ? '板块已显示' : '板块已隐藏', 'success');
      });
    });

    /* 软件 */
    root.querySelector('#btn-check-update').addEventListener('click', async function () {
      const btn = root.querySelector('#btn-check-update');
      btn.disabled = true; btn.innerHTML = UI.icon('refresh-cw', 14) + ' 检查中…';
      const info = await window.Updater.check(false);
      btn.disabled = false; btn.innerHTML = UI.icon('refresh-cw', 14) + ' 检查更新';
      const out = root.querySelector('#update-info');
      if (!info || !info.ok) {
        const msg = (info && info.error) ? info.error : '网络异常';
        out.innerHTML = '<span class="update-warn">' + UI.icon('triangle-alert', 14) + ' <strong>检测失败</strong>：' + U.escapeHtml(msg) +
          '。这<em>不代表</em>没有新版，请稍后再点「检查更新」。</span>';
        return;
      }
      if (info.hasUpdate) {
        out.innerHTML = '<span class="update-found">发现新版本 v' + U.escapeHtml(info.remoteVersion) + '，已弹出更新窗口</span>';
        window.Updater.showUpdateDialog(info);
      } else {
        const t = new Date();
        const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
        out.innerHTML = '<span class="update-ok">' + UI.icon('circle-check', 14) + ' <strong>已是最新版本</strong> v' + U.escapeHtml(info.localVersion) +
          '（远端 v' + U.escapeHtml(info.remoteVersion) + ' 已确认 · 检查于 ' + hh + '）</span>';
        UI.toast('已是最新版本', 'success');
      }
    });
    root.querySelector('#btn-view-log').addEventListener('click', function () {
      fetch('/api/version').then(function (r) { return r.json(); }).then(function (v) {
        UI.modal({
          title: '更新日志 v' + (v.version || ''),
          width: 460,
          bodyHTML: '<ul class="changelog-list">' + (v.changelog || []).map(function (c) {
            return '<li>' + U.escapeHtml(c) + '</li>';
          }).join('') + '</ul>'
        });
      });
    });
    root.querySelector('#btn-shortcut').addEventListener('click', async function () {
      const btn = root.querySelector('#btn-shortcut');
      btn.disabled = true; btn.innerHTML = UI.icon('monitor-up', 14) + ' 创建中…';
      try {
        const r = await fetch('/api/desktop-shortcut', { method: 'POST' });
        const out = await r.json();
        if (out.ok) {
          UI.toast('桌面快捷方式已创建：' + (out.name || '人生管家'), 'success');
        } else {
          UI.toast(out.error || '创建失败', 'error');
        }
      } catch (e) {
        UI.toast('创建失败：' + e.message, 'error');
      }
      btn.disabled = false; btn.innerHTML = UI.icon('monitor-up', 14) + ' 创建桌面快捷方式';
    });

    /* 危险操作 */
    root.querySelector('#btn-reset').addEventListener('click', async function () {
      // 文案=实际范围（A15）：不拆档、一次彻底清空；模板与穿搭/妆容组合也在清空范围内，明示
      // 甲17：确认框提示「操作前将自动备份」，确认后先快照到 backups/ 再清空（快照失败则取消）
      if (await UI.confirmDialog('清空确认', '将清空当前账号的全部记录（物品/穿搭/美食/打卡/账单/账户/余额/导入记录/模板）和全部设置（预算/标签库/导航排序/成本模型/界面偏好/穿搭组合与妆容组合），无法恢复。操作前将自动备份一份到 backups/，确定？')) {
        if (!await autoBackup()) {
          UI.toast('自动备份失败，已取消清空', 'error');
          return;
        }
        repairResult = '';
        await S.resetAll();
        UI.toast('已清空（清空前已自动备份到 backups/）', 'success'); window.App.refresh();
      }
    });
  }

  function catTable(kind, title, list) {
    const rows = (list || []).map(function (c) {
      return '<tr data-cid="' + c.id + '"><td>' + UI.iconOrEmoji(c.icon, 16) + ' ' + U.escapeHtml(c.name) +
        (c.children && c.children.length ? '<span class="muted small">（' + c.children.length + ' 个子类）</span>' : '') +
        '</td>' +
        '<td><input type="number" step="0.5" data-f="life" value="' + (c.lifeYears || '') + '" placeholder="默认 5"></td>' +
        '<td><input type="number" step="0.01" data-f="res" value="' +
        (c.residualRate !== undefined && c.residualRate !== null ? c.residualRate : '') + '" placeholder="0~1，如 0.3"></td>' +
        '<td class="cat-act"><button type="button" class="btn btn-ghost btn-sm" data-cost-default' +
        ' title="恢复默认（寿命 5 年 / 残值率 0.1）">恢复默认</button></td></tr>';
    }).join('');
    return '<div class="table-scroll"><table class="cat-table" data-cat-kind="' + kind + '">' +
      '<thead><tr><th>' + title + '</th><th>寿命(年)（大于 0）</th><th>残值率（0~1，如 0.3）</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="4" class="muted">暂无分类</td></tr>') +
      '</tbody></table></div>';
  }

  return { render: render };
})();
