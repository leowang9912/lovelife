/* settings-cost.test.js — 验证设置页成本模型可见（新分类树） */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const APP = path.join(__dirname, '..', 'app');

const dom = new JSDOM(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), {
  url: 'http://127.0.0.1:8765/', runScripts: 'outside-only', pretendToBeVisual: true
});
const { window } = dom;

window.fetch = async (url) => {
  const u = String(url);
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, blob: async () => new Blob([1]), arrayBuffer: async () => new ArrayBuffer(4) });
  if (u.includes('/api/session')) return ok({ ok: true, accounts: [{ id: 'me', name: 'Me', icon: 'x' }], lastAccountId: 'me', dataRoot: 'mem', schemaVersion: 3 });
  if (u.includes('/api/ping')) return ok({ ok: true });
  if (u.includes('/api/db')) return ok({
    schemaVersion: 3,
    account: { id: 'me', name: 'Me', icon: 'x' },
    accounts: [{ id: 'me', name: 'Me', icon: 'x' }],
    items: [], outfits: [], food: [], events: [],
    settings: {
      idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} },
      planSections: [], rememberAccount: true
    },
    categories: {
      digital: [
        { id: 'host', name: 'Host', lifeYears: 5, residualRate: 0.1, children: [{ id: 'host_phone', name: 'Phone' }] },
        { id: 'game', name: 'Game', children: [{ id: 'gm_cartridge', name: 'Cart' }] }
      ],
      clothing: [{ id: 'top', name: 'Top', children: [] }],
      life: [{ id: 'skin', name: 'Skin', children: [] }],
      foodCuisine: [], foodType: [], meal: [], foodTag: [], occasion: [], season: [],
      tagPresets: [], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
    },
    dataRoot: 'mem'
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

setTimeout(async () => {
  try {
    let acc = window.document.querySelector('[data-acc]');
    if (acc) { acc.click(); await new Promise(r => setTimeout(r, 250)); }
    if (!window.document.getElementById('main-content')) {
      acc = window.document.querySelector('[data-acc]');
      if (acc) { acc.click(); await new Promise(r => setTimeout(r, 250)); }
    }
    const mc = window.document.getElementById('main-content');
    if (!mc) {
      console.error('FAIL: no main-content. app=', window.document.getElementById('app').innerHTML.slice(0, 200));
      process.exit(1);
    }
    window.App.go('settings');
    await new Promise(r => setTimeout(r, 300));
    const html = window.document.getElementById('main-content').innerHTML;
    const rows = window.document.querySelectorAll('.cat-table tbody tr[data-cid]').length;
    const inputs = window.document.querySelectorAll('.cat-table input[data-f]').length;
    const hasHost = html.indexOf('Host') >= 0;
    const hasScroll = html.indexOf('table-scroll') >= 0;
    console.log('cost rows:', rows, '| inputs:', inputs, '| has Host:', hasHost, '| has table-scroll:', hasScroll);
    if (rows < 3 || inputs < 6 || !hasHost || !hasScroll) {
      console.error('FAIL: cost model not visible');
      process.exit(1);
    }
    console.log('PASS: cost model visible');
    process.exit(0);
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  }
}, 1500);
