/* updater.js — 应用内版本检查与一键更新（进度可见 + 三态区分） */
window.Updater = (function () {
  const U = window.Utils;

  let lastCheck = null;

  /* ---------- 版本检查 ----------
   * 返回三态：
   *   { ok:true, hasUpdate:true, ... }   有新版
   *   { ok:true, hasUpdate:false, ... }  确认已是最新（远端成功返回且版本相等）
   *   { ok:false, error:'...' }          检测失败（≠没有新版）
   */
  async function check(silent) {
    try {
      // 30 秒超时：服务端多源检测最坏情况较慢，但不能让按钮无限转圈
      const ac = new AbortController();
      const timer = setTimeout(function () { ac.abort(); }, 30000);
      let r;
      try {
        r = await fetch('/api/update/check', { method: 'POST', signal: ac.signal });
      } finally {
        clearTimeout(timer);
      }
      const out = await r.json();
      lastCheck = out;
      if (!out.ok) {
        // 检测失败：明确区别于"无更新"
        if (!silent) window.UI.toast('检测失败：' + (out.error || '网络异常') + '（不代表没有新版）', 'error');
        return out;
      }
      if (out.hasUpdate && silent) {
        window.UI.toast('发现新版本 v' + out.remoteVersion + '，可在设置中更新', 'info');
      }
      return out;
    } catch (e) {
      lastCheck = { ok: false, error: e.message, network: true };
      if (!silent) window.UI.toast('检测失败：' + e.message + '（不代表没有新版）', 'error');
      return lastCheck;
    }
  }

  function getLast() { return lastCheck; }

  function fmtMB(bytes) {
    if (!bytes) return '0';
    return (bytes / 1024 / 1024).toFixed(1);
  }

  /* ---------- 一键更新（异步下载 + 进度轮询） ---------- */
  function showUpdateDialog(info) {
    window.UI.modal({
      title: '发现新版本 v' + info.remoteVersion,
      width: 500,
      bodyHTML:
        '<p class="muted">当前版本 v' + U.escapeHtml(info.localVersion) + ' → 新版本 v' + U.escapeHtml(info.remoteVersion) + '</p>' +
        '<h4 class="detail-sub">更新内容</h4>' +
        '<ul class="changelog-list">' +
        (info.changelog || []).map(function (c) { return '<li>' + U.escapeHtml(c) + '</li>'; }).join('') +
        '</ul>' +
        '<div class="dl-wrap">' +
        '<div class="dl-track"><div class="dl-bar" id="dl-bar"></div></div>' +
        '<div class="dl-text" id="update-progress">更新将替换程序文件，你的数据（data）不受影响</div>' +
        '</div>',
      footerHTML:
        '<button class="btn btn-ghost" data-x="c">稍后再说</button>' +
        '<button class="btn btn-primary" data-x="u" id="btn-do-update">一键更新</button>',
      onMount: function (w, close) {
        let polling = null;
        w.querySelector('[data-x=c]').addEventListener('click', function () {
          if (polling) clearInterval(polling);
          close();
        });
        w.querySelector('[data-x=u]').addEventListener('click', function () {
          startUpdate(w, info, function (done) {
            if (done) {
              if (polling) clearInterval(polling);
              // 等待服务重启后自动刷新
              waitRestart(w, info);
            }
          }, function (setPoll) { polling = setPoll; });
        });
      }
    });
  }

  function startUpdate(w, info, onDone, setPoll) {
    const url = (info.assets && (info.assets.win64 || info.assets.win)) || '';
    if (!url) {
      window.UI.toast('更新包地址缺失', 'error');
      return;
    }
    const btn = w.querySelector('[data-x=u]');
    const bar = w.querySelector('#dl-bar');
    const text = w.querySelector('#update-progress');
    btn.disabled = true;
    btn.textContent = '下载中…';
    text.textContent = '正在开始下载…';

    fetch('/api/update/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    }).then(function (r) { return r.json(); }).then(function (out) {
      if (!out.ok) throw new Error(out.error || '启动更新失败');
      let finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        if (bar) bar.style.width = '100%';
        text.textContent = '✅ 更新完成，正在重启…';
        btn.textContent = '更新完成';
        onDone(true);
      }
      // 轮询下载进度；installing 阶段即启动重启守护（done 状态仅存在 0.8 秒，
      // 旧逻辑经常错过导致不自动刷新——v1.0.7 改为阶段触发 + 落盘标记兜底）
      const timer = setInterval(async function () {
        try {
          const st = await (await fetch('/api/update/status')).json();
          const pct = st.percent || 0;
          if (bar) bar.style.width = pct + '%';
          const phaseText = {
            downloading: '下载中', verifying: '校验中', installing: '准备安装'
          }[st.phase || 'downloading'] || '处理中';
          const src = st.source ? st.source.replace(/^https:\/\//, '').split('/')[0] : '';
          text.textContent = phaseText + ' ' + fmtMB(st.downloaded) + ' / ' + fmtMB(st.total) + ' MB' +
            (pct ? '（' + pct + '%）' : '') + (src ? ' · 源: ' + src : '');
          if (st.state === 'done') {
            clearInterval(timer);
            finish();
          } else if (st.state === 'failed') {
            clearInterval(timer);
            text.innerHTML = '❌ 更新失败：' + U.escapeHtml(st.error || '未知错误') +
              ' <button class="btn btn-ghost btn-sm" id="btn-retry-update">重试</button>';
            btn.textContent = '更新失败';
            btn.disabled = true;
            const retry = w.querySelector('#btn-retry-update');
            if (retry) retry.addEventListener('click', function () {
              const btn2 = w.querySelector('[data-x=u]');
              btn2.disabled = false; btn2.textContent = '一键更新';
              startUpdate(w, info, onDone, setPoll);
            });
            onDone(false);
          } else if (st.phase === 'installing') {
            clearInterval(timer);
            finish();
          }
        } catch (e) {
          /* 服务重启中会短暂失败，忽略 */
        }
      }, 1200);
      if (setPoll) setPoll(timer);
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = '一键更新';
      text.innerHTML = '❌ 启动更新失败：' + U.escapeHtml(e.message) +
        ' <button class="btn btn-ghost btn-sm" id="btn-retry-update">重试</button>';
      const retry = w.querySelector('#btn-retry-update');
      if (retry) retry.addEventListener('click', function () {
        startUpdate(w, info, onDone, setPoll);
      });
      onDone(false);
    });
  }

  /* 更新安装→重启守护：等新版本服务起来后自动刷新，并标记"升级成功"（v1.0.7） */
  function waitRestart(w, info) {
    if (w.__restartWatch) return; // 幂等：installing/done 双触发只守一次
    w.__restartWatch = true;
    const text = w.querySelector('#update-progress');
    const wantVer = String((info && info.remoteVersion) || '');
    let tries = 0;
    const timer = setInterval(async function () {
      tries++;
      // 服务已回到新版（version.json 已被替换）才算成功，防止旧服务未死时误判
      try {
        const p = await fetch('/api/version', { cache: 'no-store' });
        if (p.ok) {
          const v = await p.json();
          if (!wantVer || String(v.version) === wantVer) {
            clearInterval(timer);
            if (text) text.textContent = '✅ 已升级到 v' + wantVer + '，正在刷新…';
            try { sessionStorage.setItem('lovelife-upgraded', wantVer); } catch (e) {}
            setTimeout(function () { location.reload(); }, 600);
            return;
          }
        }
      } catch (e) { /* 服务重启中 */ }
      // 更新失败的兜底观察：服务没换但状态变 failed
      try {
        const st = await (await fetch('/api/update/status', { cache: 'no-store' })).json();
        if (st.state === 'failed' && tries < 10) {
          clearInterval(timer);
          if (text) text.innerHTML = '❌ 更新失败：' + U.escapeHtml(st.error || '未知错误');
          window.UI.toast('更新失败：' + (st.error || '未知错误'), 'error');
          return;
        }
      } catch (e) { /* 忽略 */ }
      if (tries > 80) {
        clearInterval(timer);
        if (text) text.textContent = '⚠️ 服务未自动重启，请手动双击 lovelife.bat';
      }
    }, 1500);
  }

  return { check: check, getLast: getLast, showUpdateDialog: showUpdateDialog };
})();
