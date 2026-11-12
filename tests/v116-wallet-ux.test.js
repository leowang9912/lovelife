/* v116-wallet-ux.test.js — 记账线 UX 8 项改进回归锁（v1.1.6）：
   1) 甲11 repairData 补记停用物品 retiredAt（最近使用日||updatedAt||purchaseDate||今天），幂等、不动 saveItem 路径
   2) 甲6 bill_import 判重收紧（双空备注须账户名全同）+ bill_export.filter_bills 新参数（Python 侧锁）
   3) 甲6 前端兜底判重同口径 + 预览重复可展开逐条勾回（勾回后可导入）
   4) 甲5 导入预览明示余额影响 + 「本次导入不动余额」（accountId 置 ''、保留账户名、余额不动）；不勾维持既有行为
   5) 甲7 导出跟随当前筛选（month 无显式月按当前显示月推 from/to + accountId/q/分类）+ 确认框「将导出 X 笔」
   6) 甲20 分类管理：添加子类/改名/删除（账单自动归「其他」）+ 新子类立即进记账弹窗网格
   7) 甲22 钱袋页「导入 / 导出」入口 → 设置页并自动切「记账设置」分组
   8) 丙3 流水/账户空态卡化（empty-state empty-card + 图标48/文案/引导按钮，筛选态保留清除筛选）
   注：甲16（views-food.js 美食日期编辑）不属本文件域（归 views-food.js/saveFood 所属 agent），未在此锁。 */
'use strict';
const { makeWindow, waitFor, sleep, waitMain, lastModal, assert } = require('./helpers/harness');
const { spawnSync } = require('child_process');
const path = require('path');

let cur = '';

/* ---- 甲6/甲7 后端（bill_import / bill_export）用 Python 直锁 ---- */
const PY_CHECKS = [
  'import sys',
  'sys.path.insert(0, sys.argv[1])',
  'import bill_import as bi',
  'import bill_export as be',
  '',
  'def bill(note="", acc="", date="2026-11-01", amount=12.5, t="expense", to=""):',
  '    return {"date": date, "amount": amount, "type": t, "note": note, "accountName": acc, "toAccountName": to}',
  '',
  '# 甲6-1 双侧空备注：账户名不同 -> 不算重复（同价咖啡不丢账）',
  'plan = bi.build_import_plan([bill("", "现金"), bill("", "微信")], [])',
  'assert plan["dups"] == 0, plan',
  '# 甲6-2 双侧空备注：账户名全同 -> 算重复',
  'plan = bi.build_import_plan([bill("", "现金"), bill("", "现金")], [])',
  'assert plan["dups"] == 1, plan',
  '# 甲6-3 对已有账单：双空备注 + 账户名不同 -> 不重复',
  'plan = bi.build_import_plan([bill("", "微信")], [bill("", "现金")])',
  'assert plan["dups"] == 0, plan',
  '# 甲6-4 任一侧有备注：维持既有判重语义（一侧为空即命中）',
  'plan = bi.build_import_plan([bill("拿铁", "微信")], [bill("", "现金")])',
  'assert plan["dups"] == 1, plan',
  '# 甲6-5 两侧备注归一相同 -> 重复（不回归）',
  'plan = bi.build_import_plan([bill(" 午 饭 ", "现金")], [bill("午饭", "现金")])',
  'assert plan["dups"] == 1, plan',
  '# 甲6-6 两侧备注不同 -> 不重复（不回归）',
  'plan = bi.build_import_plan([bill("午饭", "现金")], [bill("晚饭", "现金")])',
  'assert plan["dups"] == 0, plan',
  '# 甲6-7 转账双空备注：转入账户名不同 -> 不重复',
  'plan = bi.build_import_plan(',
  '    [bill("", "现金", t="transfer", to="银行卡"), bill("", "现金", t="transfer", to="信用卡")], [])',
  'assert plan["dups"] == 0, plan',
  '# 甲6-8 文件内互重（非空备注）不回归',
  'plan = bi.build_import_plan([bill("午饭"), bill("午饭")], [])',
  'assert plan["dups"] == 1 and plan["bills"][1]["matchNote"] == "文件内重复", plan',
  '',
  'BILLS = [',
  '    {"date": "2026-11-01", "type": "expense", "amount": 12.5, "catId": "w_food", "subCatId": "w_food_lunch",',
  '     "accountId": "ac_cash", "note": "午饭"},',
  '    {"date": "2026-11-02", "type": "expense", "amount": 30, "catId": "w_food", "subCatId": "w_food_dinner",',
  '     "accountId": "ac_wechat", "note": "晚饭"},',
  '    {"date": "2026-11-03", "type": "income", "amount": 100, "catId": "w_in_wages", "subCatId": "",',
  '     "accountId": "ac_bank", "note": "工资"},',
  '    {"date": "2026-11-04", "type": "transfer", "amount": 50, "catId": "", "subCatId": "",',
  '     "accountId": "ac_cash", "toAccountId": "ac_bank", "note": "转账"},',
  ']',
  'CATS = {"expense": [{"id": "w_food", "name": "食品餐饮", "children": [',
  '    {"id": "w_food_lunch", "name": "午餐"}, {"id": "w_food_dinner", "name": "晚餐"}]}],',
  '    "income": [{"id": "w_in_wages", "name": "工资", "children": []}]}',
  '# 既有参数语义不变（位置参数调用兼容）',
  'assert len(be.filter_bills(BILLS, None, None, None, None)) == 4',
  'assert len(be.filter_bills(BILLS, bill_type="expense")) == 2',
  'assert len(be.filter_bills(BILLS, cat_id="w_food")) == 2',
  'assert len(be.filter_bills(BILLS, date_from="2026-11-02", date_to="2026-11-03")) == 2',
  '# 甲7 account_id：匹配 accountId 或 toAccountId',
  'assert [b["note"] for b in be.filter_bills(BILLS, account_id="ac_bank")] == ["工资", "转账"]',
  'assert len(be.filter_bills(BILLS, account_id="ac_cash")) == 2',
  '# 甲7 q：备注+分类名（与流水列表同口径）',
  'assert [b["note"] for b in be.filter_bills(BILLS, q="午", cats=CATS)] == ["午饭"]',
  'assert [b["note"] for b in be.filter_bills(BILLS, q="晚餐", cats=CATS)] == ["晚饭"]',
  'assert [b["note"] for b in be.filter_bills(BILLS, q="工资", cats=CATS)] == ["工资"]',
  'assert len(be.filter_bills(BILLS, q="食品餐饮", cats=CATS)) == 2',
  '# 不传 cats 时 q 只搜备注',
  'assert [b["note"] for b in be.filter_bills(BILLS, q="晚饭")] == ["晚饭"]',
  '# 组合筛选（既有 + 新参数叠加）',
  'assert len(be.filter_bills(BILLS, date_from="2026-11-01", date_to="2026-11-02",',
  '    cat_id="w_food", bill_type="expense", account_id="ac_cash", q="饭", cats=CATS)) == 1',
  'print("PY-OK 19")'
].join('\n');

async function main() {
  /* ==================== 1 甲11 repairData 补记停用时间 ==================== */
  cur = '1. 甲11 repairData 补 retiredAt（最近使用日||updatedAt||purchaseDate||今天）';
  const w1 = makeWindow();
  if (!(await waitMain(w1))) throw new Error('no main');
  const S = w1.Storage;
  await S.loadAll();
  const today = w1.Utils.todayStr();
  S.getDB().items.push(
    { id: 'it-usage', kind: 'device', name: '带使用记录', status: 'idle',
      usageLog: [{ id: 'u1', date: '2026-10-01', delta: 1 }, { id: 'u2', date: '2026-10-05', delta: 1 }],
      updatedAt: '2026-10-02T08:00:00.000Z' },
    { id: 'it-upd', kind: 'device', name: '只有更新时间', status: 'sold', updatedAt: '2026-09-01T10:00:00.000Z' },
    { id: 'it-pur', kind: 'clothing', name: '只有购买日', status: 'to_sell', purchaseDate: '2026-08-15' },
    { id: 'it-none', kind: 'life', name: '什么都没有', status: 'gifted' },
    { id: 'it-inuse', kind: 'device', name: '在用不动', status: 'in_use', purchaseDate: '2026-01-01' },
    { id: 'it-filled', kind: 'device', name: '已有截止', status: 'broken', retiredAt: '2026-07-01' }
  );
  const r1 = await S.repairData();
  const by = function (id) { return S.getDB().items.find(function (x) { return x.id === id; }); };
  assert(by('it-usage').retiredAt === '2026-10-05', '应回填最近使用记录日期: ' + by('it-usage').retiredAt);
  assert(by('it-upd').retiredAt === '2026-09-01', '无使用记录应回退 updatedAt 日期部分: ' + by('it-upd').retiredAt);
  assert(by('it-pur').retiredAt === '2026-08-15', '应回退 purchaseDate: ' + by('it-pur').retiredAt);
  assert(by('it-none').retiredAt === today, '全无来源应回填今天: ' + by('it-none').retiredAt);
  assert(!by('it-inuse').retiredAt, '在用物品不得补记停用时间');
  assert(by('it-filled').retiredAt === '2026-07-01', '已有 retiredAt 不得改写');
  assert((r1.warnings || []).some(function (x) { return x.indexOf('已为 4 件停用物品补记停用时间') >= 0; }),
    'warnings 应报「已为 N 件停用物品补记停用时间」: ' + JSON.stringify(r1.warnings));
  // useEndDate 冻结：补记后不再走 now 兜底（「共使用 X 天」不再每天涨）
  const end = w1.Models.useEndDate(by('it-upd'));
  assert(w1.Utils.todayStr(end) === '2026-09-01', 'useEndDate 应冻结在补记日: ' + w1.Utils.todayStr(end));
  // 幂等：二次体检不再重复回填/告警
  const r2 = await S.repairData();
  assert(!(r2.warnings || []).some(function (x) { return x.indexOf('补记停用时间') >= 0; }), '二次体检不得重复告警');
  assert(by('it-usage').retiredAt === '2026-10-05', '二次体检不得改写已补记值');
  // saveItem 自动保存路径维持既有口径（非在用记截止日、回在用清除）
  const itSave = { id: 'it-save', kind: 'device', name: '保存路径', status: 'idle', images: [] };
  await S.saveItem(itSave);
  assert(by('it-save').retiredAt === today, 'saveItem 既有口径保持（非在用记当天）');
  itSave.status = 'in_use';
  await S.saveItem(itSave);
  assert(!by('it-save').retiredAt, 'saveItem 既有口径保持（回在用清除）');
  console.log('PASS ' + cur);

  /* ==================== 2 甲6/甲7 后端 Python 侧 ==================== */
  cur = '2. 甲6 bill_import 判重收紧 + 甲7 filter_bills 新参数（Python）';
  const py = spawnSync('python', ['-I', '-c', PY_CHECKS, path.join(__dirname, '..', 'app')], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' })
  });
  if (py.status !== 0) {
    throw new Error('Python 侧断言失败（status=' + py.status + '）:\n' + (py.stdout || '') + '\n' + (py.stderr || ''));
  }
  assert(String(py.stdout).indexOf('PY-OK 19') >= 0, 'Python 侧未全部执行: ' + py.stdout);
  console.log('PASS ' + cur);

  /* ==================== 3 甲6 前端判重同口径 + 重复勾回 ==================== */
  cur = '3. 甲6 预览重复可展开逐条勾回 + 空备注按账户名判重';
  const w3 = makeWindow({
    data: {
      wallet: {
        bills: [
          { id: 'old-1', type: 'expense', amount: 25, date: '2026-11-01', time: '', catId: '', subCatId: '',
            accountId: '', note: '', accountName: '现金', tagIds: [], source: 'manual' }
        ]
      }
    },
    routes: {
      'api/import/parse': function (h) {
        return h.ok({
          ok: true, format: 'pasted_text', skipped: [], warnings: [],
          bills: [
            // 与 old-1 双空备注 + 同账户名 → 重复（默认不导入）
            { date: '2026-11-01', type: 'expense', amount: 25, note: '', accountName: '现金' },
            // 双空备注但账户名不同 → 不重复（甲6 收紧：同价咖啡不丢账）
            { date: '2026-11-01', type: 'expense', amount: 25, note: '', accountName: '微信' },
            // 任一侧有备注 → 既有判重语义（命中空备注已有账单）→ 重复
            { date: '2026-11-01', type: 'expense', amount: 25, note: '咖啡', accountName: '现金' }
          ]
        });
      }
    }
  });
  if (!(await waitMain(w3))) throw new Error('no main');
  const doc3 = w3.document;
  const box3 = doc3.createElement('div');
  doc3.body.appendChild(box3);
  w3.WalletView.mountImportUI(box3);
  box3.querySelector('#paste-bills').value = 'x';
  box3.querySelector('#btn-paste-parse').click();
  const p3 = await waitFor(function () {
    const p = box3.querySelector('#import-preview');
    return p && p.querySelector('#imp-commit') ? p : null;
  }, { label: '导入预览未渲染' });
  assert(p3.innerHTML.indexOf('疑似重复 2 笔') >= 0, '应标出疑似重复 2 笔: ' + p3.innerHTML.slice(0, 400));
  const dupToggle = p3.querySelector('#imp-dup-toggle');
  assert(dupToggle && dupToggle.textContent.indexOf('查看重复 2 条') >= 0, '应有「查看重复 2 条」展开按钮');
  const mainRows = Array.prototype.filter.call(p3.querySelectorAll('.imp-row'), function (c) {
    return !c.closest('#imp-dup-list');
  });
  assert(mainRows.length === 1 && mainRows[0].checked, '主预览应只列非重复 1 条且默认勾选');
  const dupRows = p3.querySelectorAll('#imp-dup-list .imp-row');
  assert(dupRows.length === 2, '展开区应逐条列出 2 条重复');
  assert(!dupRows[0].checked && !dupRows[1].checked, '重复项默认不勾');
  dupToggle.click();
  await waitFor(function () { return p3.querySelector('#imp-dup-list').style.display !== 'none'; }, { label: '展开区未展开' });
  dupRows[0].checked = true; // 勾回第一条重复（空备注·现金），第二条（咖啡）保持不勾
  p3.querySelector('#imp-commit').click();
  await waitFor(function () {
    return w3.Storage.getDB().wallet.bills.length === 3;
  }, { label: '勾回的重复项应导入' });
  const db3 = w3.Storage.getDB();
  assert(!db3.wallet.bills.some(function (b) { return b.note === '咖啡'; }), '未勾的重复项不得导入');
  assert(db3.wallet.bills.filter(function (b) { return b.accountName === '现金' && !b.note; }).length === 2,
    '勾回的空备注·现金账单应导入（与旧账并存）');
  assert(db3.wallet.bills.filter(function (b) { return b.accountName === '微信'; }).length === 1,
    '空备注·微信（不同账户）不应被判重吞掉');
  console.log('PASS ' + cur);

  /* ==================== 4 甲5 导入不动余额 ==================== */
  cur = '4. 甲5 导入明示余额影响 +「本次导入不动余额」';
  let parseRound = 0;
  const w4 = makeWindow({
    data: {
      wallet: {
        accounts: [
          { id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 100, note: '' },
          { id: 'ac_bank', name: '银行卡', icon: 'credit-card', type: 'bank', balance: 500, note: '' }
        ],
        bills: []
      }
    },
    routes: {
      'api/import/parse': function (h) {
        parseRound++;
        return h.ok({
          ok: true, format: 'generic_csv', skipped: [], warnings: [],
          bills: parseRound === 1 ? [
            { date: '2026-11-01', type: 'expense', amount: 23.5, note: '午饭', accountName: '现金' },
            { date: '2026-11-02', type: 'transfer', amount: 50, note: '搬钱', accountName: '现金', toAccountName: '银行卡' }
          ] : [
            { date: '2026-11-03', type: 'expense', amount: 40, note: '晚饭', accountName: '现金' }
          ]
        });
      }
    }
  });
  if (!(await waitMain(w4))) throw new Error('no main');
  const doc4 = w4.document;
  const box4 = doc4.createElement('div');
  doc4.body.appendChild(box4);
  w4.WalletView.mountImportUI(box4);
  box4.querySelector('#paste-bills').value = 'x';
  box4.querySelector('#btn-paste-parse').click();
  const p4 = await waitFor(function () {
    const p = box4.querySelector('#import-preview');
    return p && p.querySelector('#imp-no-bal') ? p : null;
  }, { label: '导入预览未出现余额提示/勾选项' });
  assert(p4.innerHTML.indexOf('导入后将增减所选账户余额') >= 0, '预览头部必须明示「导入后将增减所选账户余额」');
  assert(p4.innerHTML.indexOf('本次导入不动余额') >= 0, '必须提供「本次导入不动余额」勾选项');
  assert(!p4.querySelector('#imp-no-bal').checked, '「不动余额」默认不勾（既有行为不变）');
  p4.querySelector('#imp-no-bal').checked = true;
  p4.querySelector('#imp-commit').click();
  await waitFor(function () { return w4.Storage.getDB().wallet.bills.length === 2; }, { label: '导入未落库' });
  const db4 = w4.Storage.getDB();
  db4.wallet.bills.forEach(function (b) {
    assert(b.accountId === '', '勾选后 accountId 必须全部置空: ' + JSON.stringify(b));
    assert(!b.toAccountId, '勾选后 toAccountId 必须置空: ' + JSON.stringify(b));
  });
  const lunch = db4.wallet.bills.find(function (b) { return b.note === '午饭'; });
  const mv = db4.wallet.bills.find(function (b) { return b.note === '搬钱'; });
  assert(lunch && lunch.accountName === '现金', '原账户名应保留展示（账单可读）');
  assert(mv && mv.toAccountName === '银行卡', '转账转入账户名应保留展示');
  const cash = db4.wallet.accounts.find(function (a) { return a.id === 'ac_cash'; }).balance;
  const bank = db4.wallet.accounts.find(function (a) { return a.id === 'ac_bank'; }).balance;
  assert(cash === 100 && bank === 500, '勾选后余额不得变动: cash=' + cash + ' bank=' + bank);
  // 不勾 = 既有行为：动所选账户余额
  box4.querySelector('#import-preview').innerHTML = '';
  box4.querySelector('#paste-bills').value = 'x';
  box4.querySelector('#btn-paste-parse').click();
  const p4b = await waitFor(function () {
    const p = box4.querySelector('#import-preview');
    return p && p.querySelector('#imp-commit') ? p : null;
  }, { label: '第二轮预览未渲染' });
  assert(!p4b.querySelector('#imp-no-bal').checked, '第二轮默认仍不勾');
  p4b.querySelector('#imp-commit').click();
  await waitFor(function () {
    return w4.Storage.getDB().wallet.bills.length === 3;
  }, { label: '第二轮导入未落库' });
  const cash2 = w4.Storage.getDB().wallet.accounts.find(function (a) { return a.id === 'ac_cash'; }).balance;
  assert(Math.round(cash2 * 100) === 6000, '不勾时应维持既有余额增减语义: ' + cash2);
  console.log('PASS ' + cur);

  /* ==================== 5 甲7 导出跟随当前筛选 ==================== */
  cur = '5. 甲7 导出带 accountId/q/分类 + month 按当前显示月 + 确认框「将导出 X 笔」';
  const exportCalls = [];
  const w5 = makeWindow({
    data: {
      wallet: {
        accounts: [{ id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 100, note: '' }],
        bills: [
          { id: 'b1', type: 'expense', amount: 10, date: today, time: '', catId: 'w_food', subCatId: 'w_food_lunch',
            accountId: 'ac_cash', note: '午饭', tagIds: [], source: 'manual' },
          { id: 'b2', type: 'expense', amount: 20, date: today, time: '', catId: 'w_food', subCatId: 'w_food_lunch',
            accountId: 'ac_cash', note: '晚饭', tagIds: [], source: 'manual' },
          { id: 'b3', type: 'income', amount: 30, date: '2026-01-05', time: '', catId: 'w_in_wages', subCatId: '',
            accountId: '', note: '旧账', tagIds: [], source: 'manual' }
        ]
      }
    },
    onCall: function (u) { exportCalls.push(String(u)); }
  });
  if (!(await waitMain(w5))) throw new Error('no main');
  const doc5 = w5.document;
  // 当前筛选：本月（未显式翻月）+ 午餐子类 + 支出 + 关键词「饭」 + 现金账户
  w5.WalletView.jumpTo({ catId: 'w_food_lunch', type: 'expense', q: '饭' });
  await waitFor(function () { return doc5.getElementById('f-acc'); }, { label: '流水筛选栏未渲染' });
  const accSel = doc5.getElementById('f-acc');
  accSel.value = 'ac_cash';
  accSel.dispatchEvent(new w5.Event('change'));
  await waitFor(function () { return doc5.getElementById('f-acc'); }, { label: '筛选重渲染失败' });
  const box5 = doc5.createElement('div');
  doc5.body.appendChild(box5);
  w5.WalletView.mountImportUI(box5);
  box5.querySelector('#btn-export-bills').click();
  const conf = await waitFor(function () {
    const m = lastModal(doc5);
    return m && m.querySelector('[data-act=yes]') ? m : null;
  }, { label: '导出确认框未出现' });
  assert(conf.textContent.indexOf('将导出 2 笔') >= 0, '确认框应写明「将导出 X 笔」=当前筛选结果数: ' + conf.textContent);
  conf.querySelector('[data-act=yes]').click();
  await waitFor(function () {
    return exportCalls.some(function (u) { return u.indexOf('/api/export/bills') >= 0; });
  }, { label: '导出请求未发出' });
  const url = exportCalls.filter(function (u) { return u.indexOf('/api/export/bills') >= 0; })[0];
  const ym = today.slice(0, 7);
  const lastDay = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
  assert(url.indexOf('from=' + ym + '-01') >= 0, 'month 无显式月应按当前显示月推 from: ' + url);
  assert(url.indexOf('to=' + ym + '-' + String(lastDay).padStart(2, '0')) >= 0, '应推当月末 to: ' + url);
  assert(url.indexOf('catId=w_food_lunch') >= 0, '导出应带分类条件: ' + url);
  assert(url.indexOf('type=expense') >= 0, '导出应带类型条件: ' + url);
  assert(url.indexOf('accountId=ac_cash') >= 0, '导出应带账户条件: ' + url);
  assert(decodeURIComponent(url).indexOf('q=饭') >= 0, '导出应带关键词条件: ' + url);
  console.log('PASS ' + cur);

  /* ==================== 6 甲20 分类管理 ==================== */
  cur = '6. 甲20 分类管理（添加子类/改名/删除归其他）+ 新子类进记账网格';
  const w6 = makeWindow({
    data: {
      wallet: {
        cats: {
          expense: [
            { id: 'w_food', name: '食品餐饮', icon: 'color_ic_parent_restaurant', children: [{ id: 'w_food_lunch', name: '午餐', icon: 'x' }] },
            { id: 'w_other_exp', name: '其他支出', icon: 'color_ic_parent_other', children: [{ id: 'w_oe_other', name: '其他', icon: 'x' }] }
          ],
          income: [{ id: 'w_in_wages', name: '工资', icon: 'x', children: [] }]
        },
        bills: [
          { id: 'bl-1', type: 'expense', amount: 12, date: today, time: '', catId: 'w_food', subCatId: 'w_food_lunch',
            accountId: '', note: '午饭', tagIds: [], source: 'manual' },
          { id: 'bl-2', type: 'expense', amount: 30, date: today, time: '', catId: 'w_food', subCatId: '',
            accountId: '', note: '聚餐', tagIds: [], source: 'manual' }
        ]
      }
    }
  });
  if (!(await waitMain(w6))) throw new Error('no main');
  const doc6 = w6.document;
  w6.App.go('settings');
  await waitFor(function () { return doc6.querySelector('[data-wcat-add="w_food"]'); }, { label: '分类一览管理按钮未渲染' });
  assert(doc6.querySelector('[data-wcat-ren="w_food_lunch"]'), '子类应有改名按钮');
  assert(doc6.querySelector('[data-wcat-del="w_food"]'), '一级应有删除按钮');
  // 添加子类
  doc6.querySelector('[data-wcat-add="w_food"]').click();
  let m6 = await waitFor(function () {
    const m = lastModal(doc6);
    return m && m.querySelector('#wcat-name') ? m : null;
  }, { label: '添加子类弹窗未出现' });
  m6.querySelector('#wcat-name').value = '外卖';
  m6.querySelector('[data-x=s]').click();
  await waitFor(function () {
    return (w6.Storage.getDB().wallet.cats.expense[0].children || []).some(function (c) { return c.name === '外卖'; });
  }, { label: '新子类未落库' });
  await waitFor(function () {
    return doc6.getElementById('s-cat-list').textContent.indexOf('外卖') >= 0;
  }, { label: '分类一览未刷新出新子类' });
  // 新子类立即进记账弹窗图标网格
  w6.WalletView.openBillForm(null);
  m6 = await waitFor(function () {
    const m = lastModal(doc6);
    return m && m.querySelector('#yw-cats') ? m : null;
  }, { label: '记账弹窗未出现' });
  assert(m6.querySelector('#yw-cats').textContent.indexOf('外卖') >= 0, '新子类应立即出现在记账弹窗图标网格');
  m6.querySelector('[data-x=c]').click();
  await waitFor(function () { return !lastModal(doc6) || !lastModal(doc6).querySelector('#yw-cats'); }, { label: '记账弹窗未关闭' });
  // 改名
  doc6.querySelector('[data-wcat-ren="w_food_lunch"]').click();
  m6 = await waitFor(function () {
    const m = lastModal(doc6);
    return m && m.querySelector('#wcat-name') ? m : null;
  }, { label: '改名弹窗未出现' });
  m6.querySelector('#wcat-name').value = '午餐改';
  m6.querySelector('[data-x=s]').click();
  await waitFor(function () {
    return doc6.getElementById('s-cat-list').textContent.indexOf('午餐改') >= 0;
  }, { label: '改名未生效' });
  // 删除一级分类：引用的账单自动归「其他」
  doc6.querySelector('[data-wcat-del="w_food"]').click();
  const conf6 = await waitFor(function () {
    const m = lastModal(doc6);
    return m && m.querySelector('[data-act=yes]') ? m : null;
  }, { label: '删除分类确认框未出现' });
  assert(conf6.textContent.indexOf('自动归入「其他」') >= 0, '删除确认应写明账单归「其他」: ' + conf6.textContent);
  conf6.querySelector('[data-act=yes]').click();
  await waitFor(function () {
    return !w6.Storage.getDB().wallet.cats.expense.some(function (c) { return c.id === 'w_food'; });
  }, { label: '分类未删除' });
  const db6 = w6.Storage.getDB();
  const b61 = db6.wallet.bills.find(function (b) { return b.id === 'bl-1'; });
  const b62 = db6.wallet.bills.find(function (b) { return b.id === 'bl-2'; });
  assert(b61 && b61.catId === 'w_other_exp' && !b61.subCatId,
    '子类账单应归「其他」: ' + JSON.stringify(b61));
  assert(b62 && b62.catId === 'w_other_exp' && !b62.subCatId,
    '一级账单应归「其他」: ' + JSON.stringify(b62));
  console.log('PASS ' + cur);

  /* ==================== 7 甲22 导入/导出入口 ==================== */
  cur = '7. 甲22 钱袋页「导入 / 导出」入口跳设置·记账设置分组';
  const w7 = makeWindow();
  if (!(await waitMain(w7))) throw new Error('no main');
  const doc7 = w7.document;
  w7.App.go('wallet');
  await waitFor(function () { return doc7.getElementById('btn-goto-io'); }, { label: '钱袋页缺导入/导出入口' });
  assert(doc7.getElementById('btn-goto-io').textContent.indexOf('导入 / 导出') >= 0, '入口文案应为「导入 / 导出」');
  doc7.getElementById('btn-goto-io').click();
  const billPanel = await waitFor(function () {
    const p = doc7.querySelector('.stab[data-stab="bill"]');
    return p && p.classList.contains('stab-on') ? p : null;
  }, { label: '未自动切到记账设置分组' });
  assert(doc7.querySelector('[data-stab-btn="bill"]').classList.contains('on'), '记账设置标签应高亮');
  assert(billPanel.textContent.indexOf('账单导入') >= 0, '记账设置分组应展示账单导入导出');
  console.log('PASS ' + cur);

  /* ==================== 8 丙3 空态卡化 ==================== */
  cur = '8. 丙3 流水/账户空态卡化（empty-card + 引导按钮）';
  const w8 = makeWindow();
  if (!(await waitMain(w8))) throw new Error('no main');
  const doc8 = w8.document;
  const S8 = w8.Storage;
  w8.App.go('wallet');
  let empty = await waitFor(function () {
    const e = doc8.querySelector('#wallet-body .empty-state.empty-card');
    return e ? e : null;
  }, { label: '流水空态未卡化' });
  assert(empty.querySelector('.empty-icon'), '空态应有图标容器');
  assert(empty.querySelector('p') && empty.querySelector('p').textContent === '还没有记账记录', '空态文案应为 p 元素');
  assert(empty.querySelector('#f-empty-add'), '无筛选空态应给「记一笔」引导');
  // 有筛选 → 清除筛选按钮语义保留
  w8.WalletView.jumpTo({ q: 'zzz-无此关键词' });
  await waitFor(function () {
    return doc8.querySelector('#wallet-body #f-clear-all');
  }, { label: '筛选空态应给清除筛选按钮' });
  empty = doc8.querySelector('#wallet-body .empty-state.empty-card');
  assert(empty.querySelector('p').textContent === '没有符合筛选的结果', '筛选空态文案正确');
  doc8.querySelector('#wallet-body #f-clear-all').click();
  await waitFor(function () {
    return doc8.querySelector('#wallet-body #f-empty-add');
  }, { label: '清除筛选应回默认空态' });
  // 账户空态（清空账户后）
  for (const a of S8.getDB().wallet.accounts.slice()) await S8.removeWalletAccount(a.id);
  doc8.querySelector('[data-wt="accounts"]').click();
  empty = await waitFor(function () {
    const e = doc8.querySelector('#wallet-body .empty-state.empty-card');
    return e ? e : null;
  }, { label: '账户空态未卡化' });
  assert(empty.querySelector('p') && empty.querySelector('p').textContent === '还没有账户', '账户空态文案正确');
  assert(empty.querySelector('#f-empty-add-acc'), '账户空态应给「添加账户」引导');
  assert(doc8.querySelector('#f-empty-add-bal'), '余额记录空态应卡化并给「记余额」引导');
  empty.querySelector('#f-empty-add-acc').click();
  await waitFor(function () {
    const m = lastModal(doc8);
    return m && m.querySelector('#af-name') ? m : null;
  }, { label: '添加账户弹窗未出现' });
  console.log('PASS ' + cur);

  console.log('========== v1.1.6 记账线 UX（甲包）：8 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
