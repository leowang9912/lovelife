/* settings-cost.test.js — 验证设置页成本模型可见（新分类树）
   （已迁移到 tests/helpers/harness.js） */
'use strict';
const { makeWindow, waitFor, waitMain } = require('./helpers/harness');

let curN = 0, curName = '';
function begin(n, name) { curN = n; curName = name; }

async function main() {
  const w = makeWindow({
    data: {
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
      }
    }
  });

  begin(1, '成本模型可见（新分类树）');
  if (!(await waitMain(w))) throw new Error('no main-content. app=' + w.document.getElementById('app').innerHTML.slice(0, 200));
  const mc = w.document.getElementById('main-content');
  if (!mc) throw new Error('no main-content. app=' + w.document.getElementById('app').innerHTML.slice(0, 200));

  w.App.go('settings');
  await waitFor(function () {
    return w.document.querySelectorAll('.cat-table tbody tr[data-cid]').length > 0;
  }, { label: 'cost model not visible' });
  const html = w.document.getElementById('main-content').innerHTML;
  const rows = w.document.querySelectorAll('.cat-table tbody tr[data-cid]').length;
  const inputs = w.document.querySelectorAll('.cat-table input[data-f]').length;
  const hasHost = html.indexOf('Host') >= 0;
  const hasScroll = html.indexOf('table-scroll') >= 0;
  if (rows < 3 || inputs < 6 || !hasHost || !hasScroll) {
    throw new Error('cost model not visible');
  }
  console.log('PASS 1. 成本模型可见（新分类树）');

  console.log('========== settings-cost：1 项全部通过 ==========');
  process.exit(0);
}

main().catch(e => { console.error('FAIL ' + curN + '. ' + curName + ': ' + e.message); process.exit(1); });
