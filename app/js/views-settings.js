/* views-settings.js — 设置页：6 组单列纵向排列（任何窗口下同宽逐项排布） */
window.SettingsView = (function () {
  const U = window.Utils;
  const M = window.Models;
  const S = window.Storage;
  const UI = window.UI;

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
      '<div class="settings-stack">' +
      stabBar() +

      /* 1️⃣ 账号 */
      section('account', '账号',
        '<p class="muted">当前账号：<strong>' + U.escapeHtml(cur.icon || '') + ' ' + U.escapeHtml(cur.name || '—') + '</strong>，各账号数据完全独立。</p>' +
        '<div class="mini-table">' + accounts.map(function (a) {
          return '<div class="mini-row"><span>' + U.escapeHtml(a.icon || '😊') + '</span>' +
            '<span class="flex1">' + U.escapeHtml(a.name) + (a.id === cur.id ? ' <span class="tag">当前</span>' : '') + '</span>' +
            (a.id === cur.id ? '' : '<button class="btn btn-ghost btn-sm" data-switch="' + a.id + '">切换</button>') +
            '<button class="btn-icon" data-rename="' + a.id + '" title="重命名">' + UI.icon('pencil', 14) + '</button>' +
            (accounts.length > 1 ? '<button class="btn-icon" data-del-acc="' + a.id + '" title="删除">×</button>' : '') +
            '</div>';
        }).join('') + '</div>' +
        '<div class="btn-row"><button class="btn btn-primary btn-sm" id="btn-add-acc">' + UI.icon('plus', 14) + ' 新建账号</button>' +
        '<button class="btn btn-ghost btn-sm" id="btn-switch-page">回到启动页</button></div>') +

      /* 2️⃣ 数据与备份 */
      section('data', '数据与备份',
        '<p class="muted">数据按账号存放在根目录子文件夹（JSON + 图片），可整体迁移。</p>' +
        '<p class="path-text">当前根目录：<strong class="path-text">' + U.escapeHtml(db.dataRoot || '') + '</strong></p>' +
        '<div class="form-grid"><label class="f-full"><span class="f-label">新的数据根目录（绝对路径）</span>' +
        '<input id="new-root" placeholder="如 E:\\lovelife-data"></label></div>' +
        '<div class="btn-row">' +
        '<button class="btn btn-primary btn-sm" id="btn-move-root">' + UI.icon('folder-sync', 14) + ' 迁移并切换</button>' +
        '<button class="btn btn-ghost btn-sm" id="btn-export">' + UI.icon('download', 14) + ' 导出全量备份包</button>' +
        '<button class="btn btn-ghost btn-sm" id="btn-import">' + UI.icon('upload', 14) + ' 从备份恢复</button>' +
        '<input type="file" id="import-file" accept=".gz,.tar,.tgz" hidden></div>' +
        '<h4 class="detail-sub">账单导入 / 导出（我的钱袋）</h4>' +
        '<div id="s-bill-io"></div>') +

      /* 3️⃣ 消费与统计口径 */
      section('cost', '消费与统计口径',
        '<h4 class="detail-sub">月度预算</h4>' +
        '<div class="form-grid">' +
        '<label><span class="f-label">每月总预算</span><input type="number" id="b-total" value="' + (budget.monthlyTotal || 0) + '"></label>' +
        '<label><span class="f-label">数码预算</span><input type="number" id="b-digital" value="' + ((budget.categories || {}).digital || 0) + '"></label>' +
        '<label><span class="f-label">衣服预算</span><input type="number" id="b-clothing" value="' + ((budget.categories || {}).clothing || 0) + '"></label>' +
        '<label><span class="f-label">生活预算</span><input type="number" id="b-life" value="' + ((budget.categories || {}).life || 0) + '"></label>' +
        '<label><span class="f-label">美食预算</span><input type="number" id="b-food" value="' + ((budget.categories || {}).food || 0) + '"></label>' +
        '</div><div class="btn-row"><button class="btn btn-primary btn-sm" id="btn-save-budget">' + UI.icon('save', 14) + ' 保存预算</button></div>' +
        '<h4 class="detail-sub">成本模型（寿命 / 残值率）</h4>' +
        catTable('digital', '数码（含游戏）', cats.digital) +
        catTable('clothing', '服饰（寿命参考）', cats.clothing) +
        catTable('life', '美妆（寿命参考）', cats.life) +
        '<div class="btn-row"><button class="btn btn-primary btn-sm" id="btn-save-cats">' + UI.icon('save', 14) + ' 保存成本模型</button></div>' +
        '<h4 class="detail-sub">记账分类一览</h4>' +
        (window.WalletView ? window.WalletView.catTreeCompactHTML() : '<p class="muted small">钱袋模块未加载</p>')) +

      /* 4️⃣ 使用偏好 */
      section('pref', '使用偏好',
        '<div class="form-grid"><label><span class="f-label">吃灰预警天数</span>' +
        '<input type="number" id="set-idle" value="' + (db.settings.idleWarnDays || 60) + '"></label></div>' +
        '<div class="btn-row"><button class="btn btn-primary btn-sm" id="btn-save-settings">' + UI.icon('save', 14) + ' 保存偏好</button></div>' +
        '<h4 class="detail-sub">我的统计板块显示</h4>' +
        '<p class="muted">屏蔽后该板块整体从「我的统计」隐藏；可随时恢复。</p>' +
        '<div class="chip-row">' +
        (window.PlanView ? window.PlanView.BLOCKS : []).map(function (b) {
          const on = blocks[b.id] !== false;
          return '<label class="chip-check"><input type="checkbox" data-block-pref="' + b.id + '"' +
            (on ? ' checked' : '') + '><span>' + b.name + '</span></label>';
        }).join('') + '</div>' +
        '<h4 class="detail-sub">标签管理</h4>' +
        '<p class="muted">个人标签库：录入表单可直接选用。删除只影响标签库，已打标签的物品不受影响。</p>' +
        '<div class="mini-table" id="tag-lib-list"></div>' +
        '<div class="tag-add-row"><input id="tag-lib-new" placeholder="添加标签到标签库">' +
        '<button type="button" class="btn btn-ghost btn-sm" id="tag-lib-add">添加</button></div>') +

      /* 5️⃣ 软件 */
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

      /* 6️⃣ 危险操作 */
      '<div class="panel panel-danger stab" data-stab="danger"><div class="panel-head"><h3>危险操作</h3></div><div class="panel-body">' +
      '<p class="muted">清空当前账号的全部物品、穿搭、美食、流水记录，不可恢复。建议先导出备份。</p>' +
      '<div class="btn-row"><button class="btn btn-danger" id="btn-reset">' + UI.icon('trash-2', 14) + ' 清空当前账号数据</button></div></div></div>' +

      '</div>';

    bind(root, db, accounts, cur);
  }

  /* 标签库管理（v1.0.9）：增删个人标签库；预设只读展示 */
  function refreshTagLib(root, db) {
    const box = root.querySelector('#tag-lib-list');
    if (!box) return;
    const lib = db.settings.customTags || [];
    const presets = (db.categories && db.categories.tagPresets) || [];
    box.innerHTML =
      '<div class="mini-row"><span class="flex1 muted">预设（固定，不可删）</span>' +
      '<span class="muted small">' + (presets.length ? presets.join('、') : '—') + '</span></div>' +
      (lib.length ? lib.map(function (t) {
        return '<div class="mini-row"><span class="flex1">' + U.escapeHtml(t) + '</span>' +
          '<button class="btn-icon" data-del-taglib="' + U.escapeHtml(t) + '" title="从标签库删除">' +
          UI.icon('trash-2', 14) + '</button></div>';
      }).join('') : '<div class="mini-row"><span class="muted">标签库为空，可在录入表单输入自定义标签后自动入</span></div>');
    box.querySelectorAll('[data-del-taglib]').forEach(function (b) {
      b.addEventListener('click', async function () {
        const v = b.getAttribute('data-del-taglib');
        if (!await UI.confirmDialog('删除标签', '从标签库删除「' + v + '」？已打此标签的物品不受影响。')) return;
        db.settings.customTags = (db.settings.customTags || []).filter(function (x) { return x !== v; });
        await S.saveSettings();
        UI.toast('已从标签库删除', 'success');
        refreshTagLib(root, db);
      });
    });
  }

  /* 分标签渲染（v1.0.9）：一次只显示一组；切换只换显隐，既有绑定不受影响 */
  const STABS = [
    { id: 'account', label: '账号', icon: 'users' },
    { id: 'data', label: '数据与备份', icon: 'database' },
    { id: 'cost', label: '消费与统计口径', icon: 'wallet' },
    { id: 'pref', label: '使用偏好', icon: 'sliders-horizontal' },
    { id: 'soft', label: '软件', icon: 'app-window' },
    { id: 'danger', label: '危险操作', icon: 'triangle-alert' }
  ];
  function section(stab, title, body) {
    return '<div class="panel stab' + (stab === 'account' ? ' stab-on' : '') + '" data-stab="' + stab + '">' +
      '<div class="panel-head"><h3>' + title + '</h3></div>' +
      '<div class="panel-body">' + body + '</div></div>';
  }
  function stabBar() {
    return '<div class="settings-tabs">' + STABS.map(function (t, i) {
      return '<button type="button" class="stab-btn' + (i === 0 ? ' on' : '') + '" data-stab-btn="' + t.id + '">' +
        UI.icon(t.icon, 16) + '<span>' + t.label + '</span></button>';
    }).join('') + '</div>';
  }

  /* ---------- 事件绑定 ---------- */
  function bind(root, db, accounts, cur) {
    // 分标签切换（只换显隐，各组既有绑定不受影响）
    root.querySelectorAll('[data-stab-btn]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = b.getAttribute('data-stab-btn');
        root.querySelectorAll('[data-stab-btn]').forEach(function (x) { x.classList.toggle('on', x === b); });
        root.querySelectorAll('.stab').forEach(function (p) {
          p.classList.toggle('stab-on', p.getAttribute('data-stab') === id);
        });
      });
    });
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
      b.addEventListener('click', async function () {
        const id = b.getAttribute('data-del-acc');
        if (await UI.confirmDialog('删除账号', '删除账号将移除其全部数据，确定？')) {
          await S.deleteAccount(id, true);
          UI.toast('账号已删除', 'success');
          window.App.refresh();
        }
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

    /* 数据与备份 */
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
      if (!await UI.confirmDialog('恢复备份', '将覆盖当前账号数据，确定？')) return;
      try {
        await S.importBackup(f);
        UI.toast('已恢复', 'success'); window.App.refresh();
      } catch (err) { UI.toast(err.message, 'error'); }
    });
    // 账单导入/导出（钱袋入口统一收在设置）
    const billIO = root.querySelector('#s-bill-io');
    if (billIO && window.WalletView) window.WalletView.mountImportUI(billIO);

    /* 消费与统计口径 */
    root.querySelector('#btn-save-budget').addEventListener('click', async function () {
      db.settings.budget = {
        monthlyTotal: Number(root.querySelector('#b-total').value) || 0,
        categories: {
          digital: Number(root.querySelector('#b-digital').value) || 0,
          clothing: Number(root.querySelector('#b-clothing').value) || 0,
          life: Number(root.querySelector('#b-life').value) || 0,
          food: Number(root.querySelector('#b-food').value) || 0
        }
      };
      await S.saveSettings();
      UI.toast('预算已保存', 'success');
    });
    root.querySelector('#btn-save-cats').addEventListener('click', async function () {
      // 改动存 settings.costModelOverrides（服务端 load_db 会合并回分类树），
      // 同步改内存里的分类树供本次会话即时生效
      db.settings.costModelOverrides = db.settings.costModelOverrides || {};
      root.querySelectorAll('[data-cat-kind]').forEach(function (tbl) {
        const kind = tbl.getAttribute('data-cat-kind');
        tbl.querySelectorAll('tr[data-cid]').forEach(function (tr) {
          const cat = (db.categories[kind] || []).find(function (c) { return c.id === tr.getAttribute('data-cid'); });
          if (!cat) return;
          const ly = Number(tr.querySelector('[data-f=life]').value);
          if (ly > 0) cat.lifeYears = ly;
          // 残值率留空 = 不覆盖（防 Number('')=0 把 0 写进覆盖）
          const rvInput = tr.querySelector('[data-f=res]').value;
          if (rvInput !== '') {
            const rv = Number(rvInput);
            if (!isNaN(rv)) cat.residualRate = rv;
          }
          // 键带 kind 前缀：digital「配件」与 clothing「配饰」同 id 'acc'，裸 id 会互相覆盖（v1.0.9 修复）
          db.settings.costModelOverrides[kind + ':' + cat.id] = {
            lifeYears: cat.lifeYears, residualRate: cat.residualRate
          };
        });
      });
      await S.saveSettings();
      UI.toast('成本模型已保存', 'success');
    });

    /* 使用偏好 */
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
      UI.toast('已加入标签库', 'success');
      refreshTagLib(root, db);
    });
    root.querySelector('#btn-save-settings').addEventListener('click', async function () {
      db.settings.idleWarnDays = Number(root.querySelector('#set-idle').value) || 60;
      await S.saveSettings();
      UI.toast('偏好已保存', 'success');
    });
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
      if (await UI.confirmDialog('清空确认', '将删除当前账号全部记录，无法恢复。确定？')) {
        await S.resetAll();
        UI.toast('已清空', 'success'); window.App.refresh();
      }
    });
  }

  function catTable(kind, title, list) {
    const rows = (list || []).map(function (c) {
      return '<tr data-cid="' + c.id + '"><td>' + UI.iconOrEmoji(c.icon, 16) + ' ' + U.escapeHtml(c.name) +
        (c.children && c.children.length ? '<span class="muted small">（' + c.children.length + ' 个子类）</span>' : '') +
        '</td>' +
        '<td><input type="number" step="0.5" data-f="life" value="' + (c.lifeYears || '') + '" placeholder="—"></td>' +
        '<td><input type="number" step="0.01" data-f="res" value="' +
        (c.residualRate !== undefined && c.residualRate !== null ? c.residualRate : '') + '" placeholder="—"></td></tr>';
    }).join('');
    return '<div class="table-scroll"><table class="cat-table" data-cat-kind="' + kind + '">' +
      '<thead><tr><th>' + title + '</th><th>寿命(年)</th><th>残值率</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="3" class="muted">暂无分类</td></tr>') +
      '</tbody></table></div>';
  }

  return { render: render };
})();
