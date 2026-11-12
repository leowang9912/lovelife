/* update-flow.test.js — 检测三态区分 + 下载进度轮询
   （已迁移到 tests/helpers/harness.js；更新状态机 mock 全部用 opts.routes 表达） */
'use strict';
const harness = require('./helpers/harness');
const makeWindow = harness.makeWindow;
const waitFor = harness.waitFor;
const waitMain = harness.waitMain;

let curN = 0, curName = '';
function begin(n, name) { curN = n; curName = name; }

function makeFlowWindow(checkResponse, statusSeq) {
  let statusIdx = 0;
  return makeWindow({
    routes: {
      'api/update/check': ({ ok }) => ok(checkResponse),
      'api/update/apply': ({ ok }) => ok({ ok: true, state: 'downloading' }),
      'api/update/status': ({ ok }) => {
        const st = statusSeq[Math.min(statusIdx, statusSeq.length - 1)];
        statusIdx++;
        return ok(st);
      },
      // 与旧 mock 一致：/api/version 不带 version 字段，避免重启守护误判"已升级"改写进度文案
      'api/version': ({ ok }) => ok({ ok: true })
    }
  });
}

async function openSettings(w) {
  w.App.go('settings');
  await waitFor(function () {
    return w.document.getElementById('btn-check-update');
  }, { label: '设置页未渲染' });
  return w.document.getElementById('main-content');
}

async function clickCheck(w) {
  const btn = w.document.getElementById('btn-check-update');
  btn.click();
}

async function main() {
  // 用例1：检测失败 → 必须显示"检测失败"，绝不能显示"已是最新"
  begin(1, 'case1 检测失败 ≠ 无更新');
  {
    const w = makeFlowWindow({ ok: false, error: '无法连接更新源', details: [] }, []);
    if (!(await waitMain(w))) throw new Error('case1 no main');
    await openSettings(w);
    await clickCheck(w);
    await waitFor(function () {
      const el = w.document.getElementById('update-info');
      return el && el.innerHTML.indexOf('检测失败') >= 0;
    }, { label: 'case1: 未显示检测失败' });
    const html = w.document.getElementById('update-info').innerHTML;
    if (html.indexOf('检测失败') < 0) throw new Error('case1: 未显示检测失败: ' + html);
    if (html.indexOf('已是最新') >= 0) throw new Error('case1: 误报已是最新');
    console.log('PASS 1. case1 检测失败 ≠ 无更新');
  }
  // 用例2：远端确认相等 → 显示已是最新（含确认信息）
  begin(2, 'case2 真实无更新（远端已确认）');
  {
    const w = makeFlowWindow({ ok: true, localVersion: '1.0.1', remoteVersion: '1.0.1', hasUpdate: false, changelog: [] }, []);
    if (!(await waitMain(w))) throw new Error('case2 no main');
    await openSettings(w);
    await clickCheck(w);
    await waitFor(function () {
      const el = w.document.getElementById('update-info');
      return el && el.innerHTML.indexOf('已是最新版本') >= 0;
    }, { label: 'case2: 未显示已是最新版本' });
    const html = w.document.getElementById('update-info').innerHTML;
    if (html.indexOf('已是最新版本') < 0 || html.indexOf('已确认') < 0) throw new Error('case2: ' + html);
    if (html.indexOf('检测失败') >= 0) throw new Error('case2: 误报失败');
    console.log('PASS 2. case2 真实无更新（远端已确认）');
  }
  // 用例3：有新版 → 弹更新窗 + 进度轮询显示
  begin(3, 'case3 有新版 → 进度显示 → 完成');
  {
    const w = makeFlowWindow(
      { ok: true, localVersion: '1.0.0', remoteVersion: '1.0.1', hasUpdate: true, changelog: ['x'], assets: { win64: 'https://github.com/x/y/releases/download/v1.0.1/z.zip' } },
      [
        { state: 'downloading', downloaded: 5 * 1024 * 1024, total: 15 * 1024 * 1024, percent: 33.3, source: 'https://ghfast.top/x', phase: 'downloading', error: '' },
        { state: 'downloading', downloaded: 15 * 1024 * 1024, total: 15 * 1024 * 1024, percent: 100, source: 'https://ghfast.top/x', phase: 'verifying', error: '' },
        { state: 'done', downloaded: 15 * 1024 * 1024, total: 15 * 1024 * 1024, percent: 100, source: 'https://ghfast.top/x', phase: 'installing', error: '' }
      ]
    );
    if (!(await waitMain(w))) throw new Error('case3 no main');
    await openSettings(w);
    await clickCheck(w);
    await waitFor(function () { return w.document.querySelector('.modal'); }, { label: 'case3: 更新弹窗未出现' });
    const modal = w.document.querySelector('.modal');
    if (!modal) throw new Error('case3: 更新弹窗未出现');
    const updBtn = modal.querySelector('[data-x=u]');
    updBtn.click();
    // 第一轮轮询：下载中 + MB 进度
    await waitFor(function () {
      const t = modal.querySelector('#update-progress');
      return t && t.textContent.indexOf('下载中') >= 0 && t.textContent.indexOf('MB') >= 0;
    }, { label: 'case3: 进度未显示' });
    let text = modal.querySelector('#update-progress').textContent;
    if (text.indexOf('下载中') < 0 || text.indexOf('MB') < 0) throw new Error('case3: 进度未显示: ' + text);
    // 轮询至 done
    await waitFor(function () {
      const t = modal.querySelector('#update-progress');
      return t && t.textContent.indexOf('更新完成') >= 0;
    }, { label: 'case3: 未到完成态', timeout: 8000 });
    text = modal.querySelector('#update-progress').textContent;
    const bar = modal.querySelector('#dl-bar');
    if (text.indexOf('更新完成') < 0) throw new Error('case3: 未到完成态: ' + text);
    if (!bar || bar.style.width !== '100%') throw new Error('case3: 进度条未满');
    console.log('PASS 3. case3 有新版 → 进度显示 → 完成');
  }
  console.log('========== update-flow：3 项全部通过 ==========');
  process.exit(0);
}

main().catch(e => { console.error('FAIL ' + curN + '. ' + curName + ': ' + e.message); process.exit(1); });
