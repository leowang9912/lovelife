/* views-settings.js — 账号 / 数据路径 / 预算 / 成本模型 / 备份 */
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

    root.innerHTML =
      '<div class="page-head"><h2>设置</h2></div>' +
      '<div class="dash-grid">' +

      '<div class="panel"><div class="panel-head"><h3>👤 账号</h3></div><div class="panel-body">' +
      '<p class="muted">当前账号：<strong>' + U.escapeHtml(cur.icon || '') + ' ' + U.escapeHtml(cur.name || '—') + '</strong>，数据彼此独立。</p>' +
      '<div class="mini-table">' + accounts.map(function (a) {
        return '<div class="mini-row"><span>' + U.escapeHtml(a.icon || '😊') + '</span>' +
          '<span class="flex1">' + U.escapeHtml(a.name) + (a.id === cur.id ? ' <span class="tag">当前</span>' : '') + '</span>' +
          (a.id === cur.id ? '' : '<button class="btn btn-ghost btn-sm" data-switch="' + a.id + '">切换</button>') +
          '<button class="btn-icon" data-rename="' + a.id + '" title="重命名">✎</button>' +
          (accounts.length > 1 ? '<button class="btn-icon" data-del-acc="' + a.id + '" title="删除">×</button>' : '') +
          '</div>';
      }).join('') + '</div>' +
      '<div class="btn-row"><button class="btn btn-primary btn-sm" id="btn-add-acc">＋ 新建账号</button>' +
      '<button class="btn btn-ghost btn-sm" id="btn-switch-page">回到启动页</button></div>' +
      '</div></div>' +

      '<div class="panel"><div class="panel-head"><h3>📁 数据路径</h3></div><div class="panel-body">' +
      '<p class="muted">个人数据在根目录下按账号分文件夹存放，可整体迁移。</p>' +
      '<p>当前根目录：<strong id="data-root">' + U.escapeHtml(db.dataRoot || '') + '</strong></p>' +
      '<div class="form-grid"><label class="f-full"><span class="f-label">新的数据根目录（绝对路径）</span>' +
      '<input id="new-root" placeholder="如 E:\\lovelife-data"></label></div>' +
      '<div class="btn-row">' +
      '<button class="btn btn-primary btn-sm" id="btn-move-root">迁移并切换</button>' +
      '<button class="btn btn-ghost btn-sm" id="btn-export">导出备份包</button>' +
      '<button class="btn btn-ghost btn-sm" id="btn-import">从备份恢复</button>' +
      '<input type="file" id="import-file" accept=".gz,.tar,.tgz" hidden></div>' +
      '</div></div>' +

      '<div class="panel"><div class="panel-head"><h3>💰 月度预算</h3></div><div class="panel-body">' +
      '<div class="form-grid">' +
      '<label><span class="f-label">每月总预算</span><input type="number" id="b-total" value="' + (budget.monthlyTotal || 0) + '"></label>' +
      '<label><span class="f-label">数码预算</span><input type="number" id="b-digital" value="' + ((budget.categories || {}).digital || 0) + '"></label>' +
      '<label><span class="f-label">衣服预算</span><input type="number" id="b-clothing" value="' + ((budget.categories || {}).clothing || 0) + '"></label>' +
      '<label><span class="f-label">生活预算</span><input type="number" id="b-life" value="' + ((budget.categories || {}).life || 0) + '"></label>' +
      '<label><span class="f-label">美食预算</span><input type="number" id="b-food" value="' + ((budget.categories || {}).food || 0) + '"></label>' +
      '</div><button class="btn btn-primary btn-sm" id="btn-save-budget" style="margin-top:12px">保存预算</button>' +
      '</div></div>' +

      '<div class="panel"><div class="panel-head"><h3>⚙️ 通用</h3></div><div class="panel-body">' +
      '<div class="form-grid"><label><span class="f-label">吃灰预警天数</span>' +
      '<input type="number" id="set-idle" value="' + (db.settings.idleWarnDays || 60) + '"></label></div>' +
      '<button class="btn btn-primary btn-sm" id="btn-save-settings">保存</button>' +
      '</div></div>' +

      '<div class="panel span-2"><div class="panel-head"><h3>📊 成本模型（可修改）</h3></div><div class="panel-body">' +
      catTable('device', '数码设备', cats.device) +
      catTable('game', '游戏', cats.game) +
      '<button class="btn btn-primary btn-sm" id="btn-save-cats">保存成本模型</button>' +
      '</div></div>' +

      '<div class="panel span-2"><div class="panel-head"><h3>🔄 版本与更新</h3></div><div class="panel-body">' +
      '<p>当前版本：<strong id="cur-ver">…</strong></p>' +
      '<p class="muted">启动时自动检测新版；更新只替换程序文件，你的数据不受影响。</p>' +
      '<div class="btn-row">' +
      '<button class="btn btn-primary" id="btn-check-update">检查更新</button>' +
      '<button class="btn btn-ghost" id="btn-view-log">查看更新日志</button></div>' +
      '<div id="update-info" class="muted small"></div>' +
      '</div></div>' +

      '<div class="panel span-2"><div class="panel-head"><h3>🗑️ 危险操作</h3></div><div class="panel-body">' +
      '<button class="btn btn-danger" id="btn-reset">清空当前账号数据</button></div></div>' +
      '</div>';

    // 版本信息
    fetch('/api/version').then(function (r) { return r.json(); }).then(function (v) {
      const el = root.querySelector('#cur-ver');
      if (el) el.textContent = 'v' + (v.version || '1.0.0') + '（数据结构 v' + (v.minSchema || 3) + '）';
    }).catch(function () {});

    root.querySelector('#btn-check-update').addEventListener('click', async function () {
      const btn = root.querySelector('#btn-check-update');
      btn.disabled = true; btn.textContent = '检查中…';
      const info = await window.Updater.check(false);
      btn.disabled = false; btn.textContent = '检查更新';
      if (info && info.ok) {
        if (info.hasUpdate) {
          window.Updater.showUpdateDialog(info);
        } else {
          root.querySelector('#update-info').textContent = '已是最新版本 v' + info.localVersion;
          UI.toast('已是最新版本', 'success');
        }
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
          title: '编辑账号', width: 420,
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
        title: '新建账号', width: 420,
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
    root.querySelector('#btn-save-settings').addEventListener('click', async function () {
      db.settings.idleWarnDays = Number(root.querySelector('#set-idle').value) || 60;
      await S.saveSettings();
      UI.toast('已保存', 'success');
    });
    root.querySelector('#btn-save-cats').addEventListener('click', async function () {
      root.querySelectorAll('[data-cat-kind]').forEach(function (tbl) {
        const kind = tbl.getAttribute('data-cat-kind');
        tbl.querySelectorAll('tr[data-cid]').forEach(function (tr) {
          const cat = (db.categories[kind] || []).find(function (c) { return c.id === tr.getAttribute('data-cid'); });
          if (!cat) return;
          cat.lifeYears = Number(tr.querySelector('[data-f=life]').value) || cat.lifeYears;
          const rv = Number(tr.querySelector('[data-f=res]').value);
          if (!isNaN(rv)) cat.residualRate = rv;
        });
      });
      await S.saveSettings();
      UI.toast('成本模型已保存', 'success');
    });
    root.querySelector('#btn-reset').addEventListener('click', async function () {
      if (await UI.confirmDialog('清空确认', '将删除当前账号全部记录，无法恢复。确定？')) {
        await S.resetAll();
        UI.toast('已清空', 'success'); window.App.refresh();
      }
    });
  }

  function catTable(kind, title, list) {
    return '<h4 class="detail-sub">' + title + '</h4>' +
      '<table class="cat-table" data-cat-kind="' + kind + '"><thead><tr><th>分类</th><th>寿命(年)</th><th>残值率</th></tr></thead><tbody>' +
      (list || []).map(function (c) {
        return '<tr data-cid="' + c.id + '"><td>' + (c.icon || '') + ' ' + U.escapeHtml(c.name) + '</td>' +
          '<td><input type="number" step="0.5" data-f="life" value="' + (c.lifeYears || '') + '" style="width:80px"></td>' +
          '<td><input type="number" step="0.01" data-f="res" value="' + (c.residualRate !== undefined ? c.residualRate : '') + '" style="width:80px"></td></tr>';
      }).join('') + '</tbody></table>';
  }

  return { render: render };
})();
