/* settings-functions.test.js — 设置页各功能逐项验证
   （已迁移到 tests/helpers/harness.js；API 调用记录经 'api/' 汇总路由收集，
     desktop-shortcut/update/account 等走 harness 默认路由，特殊响应用 routes 覆盖） */
'use strict';
const { makeWindow, waitFor, waitMain } = require('./helpers/harness');

const calls = [];   // 记录 API 调用
let settings = {
  idleWarnDays: 60,
  budget: { monthlyTotal: 0, categories: { digital: 0, clothing: 0, life: 0, food: 0 } },
  planSections: [], rememberAccount: true
};
let categories = {
  digital: [{ id: 'host', name: 'Host', lifeYears: 5, residualRate: 0.1, children: [] }],
  clothing: [], life: [],
  foodCuisine: [], foodType: [], meal: [], foodTag: [], occasion: [], season: [],
  tagPresets: [], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
};
let accounts = [{ id: 'me', name: 'Me', icon: 'x' }, { id: 'b', name: 'Other', icon: 'y' }];
let items = [{ id: 'i1', kind: 'clothing', categoryId: 'top', name: 'T', purchaseDate: '2025-01-01', purchasePrice: 100, status: 'in_use' }];

let curN = 0, curName = '';
function begin(n, name) { curN = n; curName = name; }

async function main() {
  const w = makeWindow({
    routes: {
      // 先记录所有 API 调用，返回 undefined 落入后续路由/默认路由
      'api/': ({ url, body, opts }) => {
        calls.push({ url: url, method: (opts && opts.method) || 'GET', body: body });
      },
      'api/session': ({ ok }) => ok({ ok: true, accounts, lastAccountId: 'me', dataRoot: 'D:\\x\\data', schemaVersion: 3 }),
      'api/account': ({ body, ok }) => {
        if (body && body.action === 'rename') {
          const a = accounts.find(x => x.id === body.id); if (a) { a.name = body.name; a.icon = body.icon; }
        }
        if (body && body.action === 'delete') accounts = accounts.filter(x => x.id !== body.id);
        return ok({ ok: true, accounts });
      },
      'api/db': ({ ok }) => ok({
        schemaVersion: 3,
        account: accounts.find(a => a.id === 'me'), accounts,
        items: items.slice(), outfits: [], food: [], events: [],
        settings, categories, dataRoot: 'D:\\x\\data'
      }),
      'api/save': ({ body, ok }) => {
        if (body && body.target === 'settings') { settings = body.data.settings; categories = body.data.categories; }
        return ok({ ok: true });
      }
    }
  });
  if (!(await waitMain(w))) throw new Error('未能进入主界面');
  w.App.go('settings');
  const root = await waitFor(function () {
    const mc = w.document.getElementById('main-content');
    return mc && mc.querySelector('#b-total') ? mc : null;
  }, { label: '设置页未渲染' });

  // 1 预算保存
  begin(1, '月度预算保存');
  root.querySelector('#b-total').value = '3000';
  root.querySelector('#b-digital').value = '1000';
  root.querySelector('#btn-save-budget').click();
  await waitFor(function () {
    return settings.budget.monthlyTotal === 3000 && settings.budget.categories.digital === 1000;
  }, { label: '预算保存失败' });
  if (settings.budget.monthlyTotal !== 3000 || settings.budget.categories.digital !== 1000) throw new Error('预算保存失败: ' + JSON.stringify(settings.budget));
  console.log('PASS 1. 月度预算保存');

  // 2 通用（吃灰预警）保存（v1.1.9：变更即存，对齐板块勾选；底部保存按钮已移除）
  begin(2, '通用设置保存（变更即存）');
  root.querySelector('#set-idle').value = '45';
  root.querySelector('#set-idle').dispatchEvent(new (root.ownerDocument.defaultView.Event)('change'));
  await waitFor(function () { return settings.idleWarnDays === 45; }, { label: '吃灰预警保存失败' });
  if (settings.idleWarnDays !== 45) throw new Error('吃灰预警保存失败: ' + settings.idleWarnDays);
  console.log('PASS 2. 通用设置保存（变更即存）');

  // 3 成本模型保存
  begin(3, '成本模型保存');
  const lifeInput = root.querySelector('.cat-table input[data-f=life]');
  lifeInput.value = '6';
  root.querySelector('#btn-save-cats').click();
  await waitFor(function () {
    return categories.digital[0].lifeYears === 6;
  }, { label: '成本模型保存失败' });
  if (categories.digital[0].lifeYears !== 6) throw new Error('成本模型保存失败: ' + categories.digital[0].lifeYears);
  console.log('PASS 3. 成本模型保存');

  // 4 账号重命名
  begin(4, '账号重命名');
  root.querySelector('[data-rename="b"]').click();
  await waitFor(function () {
    const mm = w.document.querySelector('.modal');
    return mm && mm.querySelector('#acc-name');
  }, { label: '重命名弹窗未出现' });
  let modal = w.document.querySelector('.modal');
  if (!modal) throw new Error('重命名弹窗未出现');
  modal.querySelector('#acc-name').value = 'Renamed';
  modal.querySelector('[data-x=s]').click();
  await waitFor(function () {
    const a = accounts.find(x => x.id === 'b');
    return a && a.name === 'Renamed';
  }, { label: '账号重命名失败' });
  if (accounts.find(a => a.id === 'b').name !== 'Renamed') throw new Error('账号重命名失败');
  console.log('PASS 4. 账号重命名');

  // 5 账号切换
  begin(5, '账号切换');
  root.querySelector('[data-switch="b"]') && root.querySelector('[data-switch="b"]').click();
  await waitFor(function () {
    return calls.some(c => c.url.includes('/api/account') && c.body && c.body.action === 'select' && c.body.id === 'b');
  }, { label: '账号切换未调用 select' });
  const selCalls = calls.filter(c => c.url.includes('/api/account') && c.body && c.body.action === 'select' && c.body.id === 'b');
  if (!selCalls.length) throw new Error('账号切换未调用 select');
  console.log('PASS 5. 账号切换');

  // 6 导出备份
  begin(6, '导出备份包');
  root.querySelector('#btn-export').click();
  await waitFor(function () {
    return calls.some(c => c.url.includes('/api/backup'));
  }, { label: '导出备份未调用' });
  if (!calls.some(c => c.url.includes('/api/backup'))) throw new Error('导出备份未调用');
  console.log('PASS 6. 导出备份包');

  // 7 数据路径迁移
  begin(7, '数据路径迁移');
  root.querySelector('#new-root').value = 'E:\\newdata';
  root.querySelector('#btn-move-root').click();
  await waitFor(function () {
    const mm = w.document.querySelector('.modal');
    return mm && mm.querySelector('[data-act=yes]');
  }, { label: '迁移确认弹窗未出现' });
  modal = w.document.querySelector('.modal');
  if (modal) { modal.querySelector('[data-act=yes]').click(); await waitFor(function () {
    return calls.some(c => c.url.includes('/api/data-root'));
  }, { label: '数据路径迁移未调用' }); }
  const moveCall = calls.find(c => c.url.includes('/api/data-root'));
  if (!moveCall || moveCall.body.path !== 'E:\\newdata') throw new Error('数据路径迁移未调用或参数错');
  console.log('PASS 7. 数据路径迁移');

  // 重新进入设置页（避免此前刷新导致旧 DOM 引用失效）
  w.App.go('settings');
  const root2 = await waitFor(function () {
    const mc = w.document.getElementById('main-content');
    return mc && mc.querySelector('#btn-view-log') ? mc : null;
  }, { label: '设置页未重新渲染' });

  // 8 查看更新日志
  begin(8, '查看更新日志');
  root2.querySelector('#btn-view-log').click();
  await waitFor(function () {
    const mm = w.document.querySelector('.modal');
    return mm && mm.textContent.indexOf('更新日志') >= 0;
  }, { label: '更新日志弹窗未出现' });
  modal = w.document.querySelector('.modal');
  if (!modal || modal.textContent.indexOf('更新日志') < 0) throw new Error('更新日志弹窗未出现');
  modal.querySelector('.modal-close').click();
  await waitFor(function () { return !w.document.querySelector('.modal'); }, { label: '更新日志弹窗未关闭' });
  console.log('PASS 8. 查看更新日志');

  // 9 检查更新三态（已是最新）
  begin(9, '检查更新（已是最新态）');
  root2.querySelector('#btn-check-update').click();
  await waitFor(function () {
    const el = w.document.getElementById('update-info');
    return el && el.innerHTML.indexOf('已是最新版本') >= 0;
  }, { label: '检查更新结果异常' });
  const infoHTML = w.document.getElementById('update-info').innerHTML;
  if (infoHTML.indexOf('已是最新版本') < 0) throw new Error('检查更新结果异常: ' + infoHTML);
  console.log('PASS 9. 检查更新（已是最新态）');

  // 10 清空数据（走确认弹窗）
  begin(10, '清空当前账号数据');
  items = [{ id: 'i1', kind: 'clothing', categoryId: 'top', name: 'T', purchaseDate: '2025-01-01', purchasePrice: 100, status: 'in_use' }];
  root2.querySelector('#btn-reset').click();
  await waitFor(function () {
    const mm = w.document.querySelector('.modal');
    return mm && mm.querySelector('[data-act=yes]');
  }, { label: '清空确认弹窗未出现' });
  modal = w.document.querySelector('.modal');
  if (!modal) throw new Error('清空确认弹窗未出现');
  modal.querySelector('[data-act=yes]').click();
  await waitFor(function () {
    const arr = calls.filter(c => c.url.includes('/api/save') && c.body && c.body.target === 'items');
    const last = arr[arr.length - 1];
    return last && last.body.data.length === 0;
  }, { label: '清空数据未生效' });
  const saveAfterReset = calls.filter(c => c.url.includes('/api/save') && c.body.target === 'items');
  const last = saveAfterReset[saveAfterReset.length - 1];
  if (!last || last.body.data.length !== 0) throw new Error('清空数据未生效');
  console.log('PASS 10. 清空当前账号数据');

  // 11 桌面快捷方式
  begin(11, '创建桌面快捷方式');
  root2.querySelector('#btn-shortcut').click();
  await waitFor(function () {
    return calls.some(c => c.url.includes('/api/desktop-shortcut')) &&
      !w.document.getElementById('btn-shortcut').disabled;
  }, { label: '快捷方式接口未调用' });
  if (!calls.some(c => c.url.includes('/api/desktop-shortcut'))) throw new Error('快捷方式接口未调用');
  const btnS = w.document.getElementById('btn-shortcut');
  if (btnS.disabled) throw new Error('按钮未恢复可用');
  console.log('PASS 11. 创建桌面快捷方式');

  console.log('========== settings-functions：11 项全部通过 ==========');
  process.exit(0);
}

main().catch(e => { console.error('FAIL ' + curN + '. ' + curName + ': ' + e.message); process.exit(1); });
