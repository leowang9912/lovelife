/* update-flow.test.js — 检测三态区分 + 下载进度轮询 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const APP = path.join(__dirname, '..', 'app');

function makeWindow(checkResponse, statusSeq) {
  const dom = new JSDOM(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), {
    url: 'http://127.0.0.1:8765/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  let statusIdx = 0;
  window.fetch = async (url, opts) => {
    const u = String(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, blob: async () => new Blob([1]), arrayBuffer: async () => new ArrayBuffer(4) });
    if (u.includes('/api/session')) return ok({ ok: true, accounts: [{ id: 'me', name: 'Me', icon: 'x' }], lastAccountId: 'me', dataRoot: 'mem', schemaVersion: 3 });
    if (u.includes('/api/ping')) return ok({ ok: true });
    if (u.includes('/api/update/check')) return ok(checkResponse);
    if (u.includes('/api/update/apply')) return ok({ ok: true, state: 'downloading' });
    if (u.includes('/api/update/status')) {
      const st = statusSeq[Math.min(statusIdx, statusSeq.length - 1)];
      statusIdx++;
      return ok(st);
    }
    if (u.includes('/api/db')) return ok({
      schemaVersion: 3, account: { id: 'me', name: 'Me', icon: 'x' },
      accounts: [{ id: 'me', name: 'Me', icon: 'x' }],
      items: [], outfits: [], food: [], events: [],
      settings: { idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} }, planSections: [], rememberAccount: true },
      categories: {
        digital: [], clothing: [], life: [],
        foodCuisine: [], foodType: [], meal: [], foodTag: [], occasion: [], season: [],
        tagPresets: [], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
      }, dataRoot: 'mem'
    });
    return ok({ ok: true });
  };
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  window.URL.createObjectURL = () => 'blob:x';
  for (const f of ['utils.js', 'models.js', 'storage.js', 'charts.js', 'cutout.js', 'ui.js',
    'views-plan.js', 'views-main.js', 'views-life.js', 'views-food.js', 'views-settings.js', 'updater.js', 'app.js']) {
    window.eval(fs.readFileSync(path.join(APP, 'js', f), 'utf8'));
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return window;
}

async function waitForMain(window) {
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 300));
    const acc = window.document.querySelector('[data-acc]');
    if (acc) { acc.click(); continue; }
    if (window.document.getElementById('main-content')) return true;
  }
  return false;
}

async function openSettings(window) {
  window.App.go('settings');
  await new Promise(r => setTimeout(r, 250));
  return window.document.getElementById('main-content');
}

async function clickCheck(window) {
  const btn = window.document.getElementById('btn-check-update');
  btn.click();
  await new Promise(r => setTimeout(r, 300));
  return window.document.getElementById('update-info').innerHTML;
}

async function main() {
  // 用例1：检测失败 → 必须显示"检测失败"，绝不能显示"已是最新"
  {
    const w = makeWindow({ ok: false, error: '无法连接更新源', details: [] }, []);
    if (!(await waitForMain(w))) throw new Error('case1 no main');
    await openSettings(w);
    const html = await clickCheck(w);
    if (html.indexOf('检测失败') < 0) throw new Error('case1: 未显示检测失败: ' + html);
    if (html.indexOf('已是最新') >= 0) throw new Error('case1: 误报已是最新');
    console.log('OK  case1 检测失败 ≠ 无更新');
  }
  // 用例2：远端确认相等 → 显示已是最新（含确认信息）
  {
    const w = makeWindow({ ok: true, localVersion: '1.0.1', remoteVersion: '1.0.1', hasUpdate: false, changelog: [] }, []);
    if (!(await waitForMain(w))) throw new Error('case2 no main');
    await openSettings(w);
    const html = await clickCheck(w);
    if (html.indexOf('已是最新版本') < 0 || html.indexOf('已确认') < 0) throw new Error('case2: ' + html);
    if (html.indexOf('检测失败') >= 0) throw new Error('case2: 误报失败');
    console.log('OK  case2 真实无更新（远端已确认）');
  }
  // 用例3：有新版 → 弹更新窗 + 进度轮询显示
  {
    const w = makeWindow(
      { ok: true, localVersion: '1.0.0', remoteVersion: '1.0.1', hasUpdate: true, changelog: ['x'], assets: { win64: 'https://github.com/x/y/releases/download/v1.0.1/z.zip' } },
      [
        { state: 'downloading', downloaded: 5 * 1024 * 1024, total: 15 * 1024 * 1024, percent: 33.3, source: 'https://ghfast.top/x', phase: 'downloading', error: '' },
        { state: 'downloading', downloaded: 15 * 1024 * 1024, total: 15 * 1024 * 1024, percent: 100, source: 'https://ghfast.top/x', phase: 'verifying', error: '' },
        { state: 'done', downloaded: 15 * 1024 * 1024, total: 15 * 1024 * 1024, percent: 100, source: 'https://ghfast.top/x', phase: 'installing', error: '' }
      ]
    );
    if (!(await waitForMain(w))) throw new Error('case3 no main');
    await openSettings(w);
    await clickCheck(w);
    await new Promise(r => setTimeout(r, 300));
    const modal = w.document.querySelector('.modal');
    if (!modal) throw new Error('case3: 更新弹窗未出现');
    const updBtn = modal.querySelector('[data-x=u]');
    updBtn.click();
    await new Promise(r => setTimeout(r, 1600));   // 第一轮轮询
    let text = modal.querySelector('#update-progress').textContent;
    if (text.indexOf('下载中') < 0 || text.indexOf('MB') < 0) throw new Error('case3: 进度未显示: ' + text);
    await new Promise(r => setTimeout(r, 4200));   // 轮询至 done
    text = modal.querySelector('#update-progress').textContent;
    const bar = modal.querySelector('#dl-bar');
    if (text.indexOf('更新完成') < 0) throw new Error('case3: 未到完成态: ' + text);
    if (!bar || bar.style.width !== '100%') throw new Error('case3: 进度条未满');
    console.log('OK  case3 有新版 → 进度显示 → 完成');
  }
  console.log('========== update-flow 全部通过 ==========');
  process.exit(0);
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
