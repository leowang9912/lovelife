/* updater.js — 应用内版本检查与一键更新 */
window.Updater = (function () {
  const U = window.Utils;

  let lastCheck = null;

  async function check(silent) {
    try {
      const r = await fetch('/api/update/check', { method: 'POST' });
      const out = await r.json();
      lastCheck = out;
      if (!out.ok) {
        if (!silent) window.UI.toast(out.error || '检查更新失败', 'error');
        return out;
      }
      if (out.hasUpdate && silent) {
        window.UI.toast('发现新版本 v' + out.remoteVersion + '，可在设置中更新', 'info');
      }
      return out;
    } catch (e) {
      if (!silent) window.UI.toast('检查更新失败：' + e.message, 'error');
      return { ok: false, error: e.message };
    }
  }

  function showUpdateDialog(info) {
    window.UI.modal({
      title: '发现新版本 v' + info.remoteVersion,
      width: 480,
      bodyHTML:
        '<p class="muted">当前版本 v' + U.escapeHtml(info.localVersion) + ' → 新版本 v' + U.escapeHtml(info.remoteVersion) + '</p>' +
        '<h4 class="detail-sub">更新内容</h4>' +
        '<ul class="changelog-list">' +
        (info.changelog || []).map(function (c) {
          return '<li>' + U.escapeHtml(c) + '</li>';
        }).join('') + '</ul>' +
        '<p class="muted small">更新将替换程序文件，你的数据（data）不会受影响。</p>' +
        '<div id="update-progress" class="muted small"></div>',
      footerHTML:
        '<button class="btn btn-ghost" data-x="c">稍后再说</button>' +
        '<button class="btn btn-primary" data-x="u">一键更新</button>',
      onMount: function (w, close) {
        w.querySelector('[data-x=c]').addEventListener('click', close);
        w.querySelector('[data-x=u]').addEventListener('click', async function () {
          const url = (info.assets && (info.assets.win64 || info.assets.win)) || '';
          if (!url) {
            window.UI.toast('更新包地址缺失', 'error');
            return;
          }
          const btn = w.querySelector('[data-x=u]');
          btn.disabled = true;
          btn.textContent = '更新中…';
          w.querySelector('#update-progress').textContent = '正在下载并安装，请稍候…';
          try {
            const r = await fetch('/api/update/apply', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: url })
            });
            const out = await r.json();
            if (!out.ok) throw new Error(out.error || '更新失败');
            w.querySelector('#update-progress').textContent = '更新已开始，程序将自动重启…';
            // 等服务重启后刷新页面
            let tries = 0;
            const timer = setInterval(async function () {
              tries++;
              try {
                const p = await fetch('/api/ping');
                if (p.ok) {
                  clearInterval(timer);
                  window.UI.toast('更新完成，已重启', 'success');
                  setTimeout(function () { location.reload(); }, 600);
                }
              } catch (e) {
                if (tries > 40) clearInterval(timer);
              }
            }, 1500);
          } catch (e) {
            btn.disabled = false;
            btn.textContent = '一键更新';
            w.querySelector('#update-progress').textContent = '更新失败：' + e.message;
          }
        });
      }
    });
  }

  return {
    check: check,
    showUpdateDialog: showUpdateDialog,
    getLast: function () { return lastCheck; }
  };
})();
