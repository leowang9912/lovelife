/* v117-cost-audit.test.js — 成本模型全公式审计 + 错例（总投入 5298）根因锁：
   错例：物品「测试」购入价 899，详情却显示 总投入 5298、已使用 2057 天、日均 2.58 元/天。
   审计结论：总投入 = 购入价 + 维修流水 + 配件挂靠（TCO，设计口径）；
   5298 = 899 + 4399，差额只能来自挂靠配件/维修流水，breakdown 字段把构成逐项可审计。
   用例：
   1) 错例重现（配件挂靠路径）：899 + 4399 配件 → 总投入 5298、日均 5298/2057、breakdown 指明配件
   2) 错例重现（维修流水路径）：899 + repair 4399 → 5298，breakdown.repairs 逐条可见
   3) 总投入纯净性：无配件无维修 → 总投入 === 购入价（锁死不多算）
   4) breakdown 自洽 + totalInvested 一致：多构成组合下 invested = 购入价+维修+配件
   5) 日均/月均公式锁：dailyCost = invested/heldDays、monthlyCost = dailyCost*30
   6) 天数边界：缺购入日期/未来购入 → 1 天（heldDays ≥ 1）
   7) 冻结口径：retiredAt/soldDate 截止冻结、soldDate 优先（既定口径勿动）
   8) 次均-服饰：分母 = 穿搭自动 + 手动；usageLog 台账不重复计
   9) 次均-美妆：分母 = useCount（usageLog 同步总数，不叠加）
  10) 次均-数码：分母 = useCount；0 次 → null
  11) 修复锁：服饰 wearCount=0 时不得退化到 useCount 分母
  12) 每小时成本（游戏）：0 小时 → null
  13) 折旧现值：item/分类残值率口径 + 显式 0 不被默认值吞（修复锁）
  14) 二手回血：净成本/回血率；空售出价 → null
  15) 合品（账单合并）不重复计：手动物品不被同名账单推高；fromBill=账单合计单一来源
  16) 配件挂靠边界：挂靠不分域、只挂一层（孙配件不递归）
  17) 汇总口径：summary 总投入按自身投入求和（配件不因挂靠计两次）
  18) 负购入价兜底按 0（日均不为负） */
'use strict';
const { makeWindow, waitFor, waitMain, assert } = require('./helpers/harness');

let cur = '';

/* 合成 db（纯模型用例直接喂 Models，不落盘） */
function makeDB(items, events, outfits) {
  return {
    items: items || [], events: events || [], outfits: outfits || [], food: [],
    settings: {}, wallet: { bills: [], accounts: [] },
    categories: {
      digital: [
        { id: 'host', name: '主机类', lifeYears: 5, residualRate: 0.1, children: [{ id: 'host_other', name: '其他主机' }] },
        { id: 'acc', name: '配件', children: [] },
        { id: 'game', name: '游戏', lifeYears: 5, children: [] }
      ],
      clothing: [{ id: 'top', name: '上装', lifeYears: 3, children: [] }],
      life: [{ id: 'skin', name: '护肤', lifeYears: 2, residualRate: 0, children: [] }]
    }
  };
}

const NOW = new Date(2026, 10, 9, 12, 0, 0); // 2026-11-09 正午（错例当天）
function close(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }

async function main() {
  const w = makeWindow();
  const M = w.Models;

  /* ---------- 1 错例重现：配件挂靠 TCO 路径 ---------- */
  cur = '1. 错例重现（配件挂靠）：899+4399 配件 → 总投入 5298 / 日均 2.58';
  {
    const host = {
      id: 'it-test', kind: 'device', categoryId: 'host', name: '测试',
      purchaseDate: '2021-03-23', purchasePrice: 899, status: 'in_use'
    };
    const acc = {
      id: 'it-acc4399', kind: 'device', categoryId: 'acc', name: '挂靠设备',
      purchaseDate: '2021-03-23', purchasePrice: 4399, parentItemId: 'it-test', status: 'in_use'
    };
    const cost = M.calcItemCost(makeDB([host, acc]), host, NOW);
    assert(cost.invested === 5298, '总投入应 5298（899+4399），实为 ' + cost.invested);
    assert(cost.heldDays === 2057, '已使用天数应 2057（2021-03-23→2026-11-09），实为 ' + cost.heldDays);
    assert(close(cost.dailyCost, 5298 / 2057), '日均应 5298/2057，实为 ' + cost.dailyCost);
    assert(close(cost.dailyCost, 2.5756, 5e-4), '日均≈2.58 与用户反馈一致，实为 ' + cost.dailyCost);
    const bd = cost.breakdown;
    assert(bd.purchase === 899 && bd.repairCost === 0 && bd.accessoriesTotal === 4399,
      'breakdown 构成错：' + JSON.stringify({ p: bd.purchase, r: bd.repairCost, a: bd.accessoriesTotal }));
    assert(bd.accessories.length === 1 && bd.accessories[0].id === 'it-acc4399' && bd.accessories[0].amount === 4399,
      'breakdown 应指明 4399 来自配件 it-acc4399');
    assert(bd.heldDays.days === 2057 && bd.heldDays.source === 'now', 'breakdown 天数口径错');
    console.log('PASS ' + cur);
  }

  /* ---------- 2 错例重现：维修流水路径 ---------- */
  cur = '2. 错例重现（维修流水）：899 + repair 4399 → 5298，逐条可审计';
  {
    const it = {
      id: 'it-rep', kind: 'device', categoryId: 'host', name: '测试',
      purchaseDate: '2021-03-23', purchasePrice: 899, status: 'in_use'
    };
    const ev = [{ id: 'ev1', itemId: 'it-rep', type: 'repair', cost: 4399, date: '2023-05-01', note: '换主板' }];
    const cost = M.calcItemCost(makeDB([it], ev), it, NOW);
    assert(cost.invested === 5298, '维修路径总投入应 5298，实为 ' + cost.invested);
    const bd = cost.breakdown;
    assert(bd.purchase === 899 && bd.repairCost === 4399 && bd.accessoriesTotal === 0,
      'breakdown 构成错：' + JSON.stringify({ p: bd.purchase, r: bd.repairCost, a: bd.accessoriesTotal }));
    assert(bd.repairs.length === 1 && bd.repairs[0].cost === 4399 && bd.repairs[0].note === '换主板',
      'breakdown 应逐条列出维修流水');
    // 非 repair 类型流水不计投入（出售/转借只作生命周期展示）
    const cost2 = M.calcItemCost(makeDB([it], [{ id: 'ev2', itemId: 'it-rep', type: 'sell', cost: 4399 }]), it, NOW);
    assert(cost2.invested === 899, '非 repair 流水不得计入总投入，实为 ' + cost2.invested);
    console.log('PASS ' + cur);
  }

  /* ---------- 3 总投入纯净性 ---------- */
  cur = '3. 总投入纯净性：无配件无维修 → 总投入 === 购入价';
  {
    const it = { id: 'it-pure', kind: 'device', categoryId: 'host', name: '裸机', purchaseDate: '2021-03-23', purchasePrice: 899, status: 'in_use' };
    const cost = M.calcItemCost(makeDB([it]), it, NOW);
    assert(cost.invested === 899, '总投入不得多算，实为 ' + cost.invested);
    // 同 id 他物事件/无主配件均不串入（域隔离）
    const db = makeDB([it,
      { id: 'it-x', kind: 'device', categoryId: 'acc', name: '别人', purchasePrice: 4399, parentItemId: 'it-none' }
    ], [{ id: 'ev9', itemId: 'it-x', type: 'repair', cost: 4399 }]);
    const cost2 = M.calcItemCost(db, it, NOW);
    assert(cost2.invested === 899, '他物配件/维修不得算进本机，实为 ' + cost2.invested);
    console.log('PASS ' + cur);
  }

  /* ---------- 4 breakdown 自洽 + 与 totalInvested 一致 ---------- */
  cur = '4. breakdown 自洽：invested = 购入价 + 维修 + 配件（与 totalInvested 一致）';
  {
    const host = { id: 'it-mix', kind: 'device', categoryId: 'host', name: '混合', purchaseDate: '2021-03-23', purchasePrice: 899, status: 'in_use' };
    const a1 = { id: 'it-a1', kind: 'device', categoryId: 'acc', name: '配件1', purchasePrice: 300, parentItemId: 'it-mix' };
    const a2 = { id: 'it-a2', kind: 'device', categoryId: 'acc', name: '配件2', purchasePrice: 100, parentItemId: 'it-mix' };
    const db = makeDB([host, a1, a2], [
      { id: 'ev1', itemId: 'it-mix', type: 'repair', cost: 50 },
      { id: 'ev2', itemId: 'it-a1', type: 'repair', cost: 50 } // 配件自身维修计入配件投入
    ]);
    const cost = M.calcItemCost(db, host, NOW);
    const bd = cost.breakdown;
    assert(cost.invested === 899 + 100 + 400, '总投入应 1399，实为 ' + cost.invested);
    assert(bd.invested === bd.purchase + bd.repairCost + bd.accessoriesTotal, 'breakdown 加和不自洽');
    assert(close(M.totalInvested(db, host), cost.invested), 'totalInvested 与 calcItemCost.invested 必须同口径');
    assert(close(M.ownInvested(db, host), 949), 'ownInvested=购入价+自身维修，实为 ' + M.ownInvested(db, host));
    console.log('PASS ' + cur);
  }

  /* ---------- 5 日均/月均公式 ---------- */
  cur = '5. 日均/月均公式锁：dailyCost=invested/heldDays、monthlyCost=dailyCost*30';
  {
    const it = { id: 'it-d', kind: 'device', categoryId: 'host', name: '日均', purchaseDate: '2021-03-23', purchasePrice: 2057, status: 'in_use' };
    const cost = M.calcItemCost(makeDB([it]), it, NOW);
    assert(cost.heldDays === 2057 && close(cost.dailyCost, 1), '2057 元用 2057 天日均应 1，实为 ' + cost.dailyCost);
    assert(close(cost.monthlyCost, 30), '月均应 30，实为 ' + cost.monthlyCost);
    console.log('PASS ' + cur);
  }

  /* ---------- 6 天数边界 ---------- */
  cur = '6. 天数边界：缺购入日期/未来购入 → 1 天';
  {
    const noDate = { id: 'it-nd', kind: 'device', categoryId: 'host', name: '无日期', purchaseDate: '', purchasePrice: 100, status: 'in_use' };
    const c1 = M.calcItemCost(makeDB([noDate]), noDate, NOW);
    assert(c1.heldDays === 1, '缺购入日期按 1 天，实为 ' + c1.heldDays);
    const future = { id: 'it-fu', kind: 'device', categoryId: 'host', name: '未来', purchaseDate: '2027-01-01', purchasePrice: 100, status: 'in_use' };
    const c2 = M.calcItemCost(makeDB([future]), future, NOW);
    assert(c2.heldDays === 1 && c2.dailyCost === 100, '未来购入按 1 天且日均不为负，实为 ' + c2.heldDays + '/' + c2.dailyCost);
    console.log('PASS ' + cur);
  }

  /* ---------- 7 冻结口径（既定） ---------- */
  cur = '7. 冻结口径：retiredAt/soldDate 截止、soldDate 优先（既定口径锁）';
  {
    const it = {
      id: 'it-frz', kind: 'device', categoryId: 'host', name: '停用',
      purchaseDate: '2026-01-01', purchasePrice: 3650, status: 'idle', retiredAt: '2026-06-01'
    };
    const c1 = M.calcItemCost(makeDB([it]), it, new Date(2026, 6, 1));
    const c2 = M.calcItemCost(makeDB([it]), it, new Date(2026, 11, 1));
    assert(c1.heldDays === 151 && c1.heldDays === c2.heldDays, '停用后天数冻结在 retiredAt，实为 ' + c1.heldDays + '/' + c2.heldDays);
    assert(close(c1.dailyCost, c2.dailyCost), '停用后日均冻结');
    assert(c1.breakdown.heldDays.source === 'retiredAt', 'breakdown 截止来源应 retiredAt');
    const sold = Object.assign({}, it, { status: 'sold', soldDate: '2026-05-01' });
    const c3 = M.calcItemCost(makeDB([sold]), sold, NOW);
    assert(c3.heldDays === 120 && c3.breakdown.heldDays.source === 'soldDate', 'soldDate 优先于 retiredAt，实为 ' + c3.heldDays);
    const live = { id: 'it-live', kind: 'device', categoryId: 'host', name: '在用', purchaseDate: '2026-01-01', purchasePrice: 3650, status: 'in_use' };
    const c4 = M.calcItemCost(makeDB([live]), live, NOW);
    assert(c4.breakdown.heldDays.source === 'now', '在用截止来源应 now');
    console.log('PASS ' + cur);
  }

  /* ---------- 8 次均-服饰分母 ---------- */
  cur = '8. 次均-服饰：分母=穿搭自动+手动，usageLog 台账不重复计';
  {
    const it = {
      id: 'it-clo', kind: 'clothing', categoryId: 'top', name: 'T恤',
      purchaseDate: '2026-01-01', purchasePrice: 500, status: 'in_use',
      manualWearCount: 3,
      usageLog: [
        { id: 'l1', date: '2026-10-01', delta: 1, source: 'manual' },
        { id: 'l2', date: '2026-10-02', delta: 1, source: 'manual' },
        { id: 'l3', date: '2026-10-03', delta: 1, source: 'edit' }
      ]
    };
    const outfits = [
      { id: 'o1', date: '2026-10-01', itemIds: ['it-clo'] },
      { id: 'o2', date: '2026-10-02', itemIds: ['it-clo'] }
    ];
    const cost = M.calcItemCost(makeDB([it], [], outfits), it, NOW);
    assert(cost.costPerUse === 100, '分母 5（自动2+手动3）次均应 100，实为 ' + cost.costPerUse);
    assert(!close(cost.costPerUse, 500 / 8), 'usageLog 不得叠加进分母（否则 500/8）');
    const pu = cost.breakdown.perUse;
    assert(pu && pu.denominator === 'wear' && pu.count === 5 && pu.auto === 2 && pu.manual === 3,
      'breakdown 次均分母错：' + JSON.stringify(pu));
    console.log('PASS ' + cur);
  }

  /* ---------- 9 次均-美妆分母 ---------- */
  cur = '9. 次均-美妆：分母=useCount（usageLog 同步总数，不叠加）';
  {
    const it = {
      id: 'it-life', kind: 'life', categoryId: 'skin', name: '口红',
      purchaseDate: '2026-01-01', purchasePrice: 60, status: 'in_use', useCount: 6,
      usageLog: [
        { id: 'l1', date: '2026-10-01', delta: 3, source: 'manual' },
        { id: 'l2', date: '2026-10-02', delta: 3, source: 'outfit' }
      ]
    };
    const cost = M.calcItemCost(makeDB([it]), it, NOW);
    assert(cost.costPerUse === 10, '次均应 60/6=10，实为 ' + cost.costPerUse);
    assert(cost.breakdown.perUse.denominator === 'use' && cost.breakdown.perUse.count === 6,
      'breakdown 分母口径错');
    console.log('PASS ' + cur);
  }

  /* ---------- 10 次均-数码 + 0 次边界 ---------- */
  cur = '10. 次均-数码：分母=useCount；0 次 → null';
  {
    const it = { id: 'it-dev', kind: 'device', categoryId: 'host', name: '手机', purchaseDate: '2026-01-01', purchasePrice: 400, status: 'in_use', useCount: 4 };
    const cost = M.calcItemCost(makeDB([it]), it, NOW);
    assert(cost.costPerUse === 100, '数码次均应 400/4，实为 ' + cost.costPerUse);
    assert(cost.breakdown.perUse.denominator === 'use' && cost.breakdown.perUse.count === 4, 'breakdown 分母错');
    const it0 = Object.assign({}, it, { id: 'it-dev0', useCount: 0 });
    const cost0 = M.calcItemCost(makeDB([it0]), it0, NOW);
    assert(cost0.costPerUse === null && cost0.breakdown.perUse === null, '0 次次均应 null');
    console.log('PASS ' + cur);
  }

  /* ---------- 11 修复锁：服饰分母不退化 ---------- */
  cur = '11. 修复锁：服饰 wearCount=0 不得退化到 useCount 分母';
  {
    const it = {
      id: 'it-clo0', kind: 'clothing', categoryId: 'top', name: '未穿',
      purchaseDate: '2026-01-01', purchasePrice: 500, status: 'in_use',
      manualWearCount: 0, useCount: 5 // 历史脏数据：美妆口径字段串进服饰
    };
    const cost = M.calcItemCost(makeDB([it]), it, NOW);
    assert(cost.costPerUse === null, '服饰 0 次穿着次均应 null（不看 useCount），实为 ' + cost.costPerUse);
    assert(cost.breakdown.perUse === null, 'breakdown 分母应 null');
    console.log('PASS ' + cur);
  }

  /* ---------- 12 每小时成本 ---------- */
  cur = '12. 每小时成本（游戏）：invested/playHours，0 小时 → null';
  {
    const g = { id: 'it-game', kind: 'game', categoryId: 'game', name: '游戏', purchaseDate: '2026-01-01', purchasePrice: 300, status: 'in_use', playHours: 100 };
    const cost = M.calcItemCost(makeDB([g]), g, NOW);
    assert(cost.costPerHour === 3, '每小时成本应 3，实为 ' + cost.costPerHour);
    assert(cost.breakdown.perHour && cost.breakdown.perHour.hours === 100, 'breakdown 时长错');
    const g0 = Object.assign({}, g, { id: 'it-game0', playHours: 0 });
    const cost0 = M.calcItemCost(makeDB([g0]), g0, NOW);
    assert(cost0.costPerHour === null && cost0.breakdown.perHour === null, '0 小时应 null');
    console.log('PASS ' + cur);
  }

  /* ---------- 13 折旧现值 ---------- */
  cur = '13. 折旧现值：item/分类残值率、显式 0 生效（修复锁）、默认 0.1';
  {
    const it = {
      id: 'it-dep', kind: 'device', categoryId: 'host', name: '折旧',
      purchaseDate: '2025-11-09', purchasePrice: 1000, status: 'in_use',
      estimatedLifeYears: 2, residualRate: 0.2 // 寿命 730 天，已用 365 天 → usedRatio 0.5
    };
    const cost = M.calcItemCost(makeDB([it]), it, NOW);
    assert(close(cost.usedRatio, 0.5), 'usedRatio 应 0.5，实为 ' + cost.usedRatio);
    assert(close(cost.currentValue, 1000 * (0.2 + 0.8 * 0.5)), '现值应 600，实为 ' + cost.currentValue);
    // 修复锁：分类残值率显式 0 不得被 0.1 吞
    const it2 = {
      id: 'it-dep0', kind: 'life', categoryId: 'skin', name: '零残值',
      purchaseDate: '2025-11-09', purchasePrice: 1000, status: 'in_use', residualRate: null
    };
    const cost2 = M.calcItemCost(makeDB([it2]), it2, NOW); // skin 分类 residualRate: 0
    assert(cost2.lifeYears === 2, '分类寿命 2 年应生效，实为 ' + cost2.lifeYears);
    assert(close(cost2.usedRatio, 0.5) && close(cost2.currentValue, 500),
      '分类残值率 0 应生效（现值=1000×0.5），实为 ' + cost2.currentValue);
    // 默认 0.1 + 寿命 5：item/分类都空时
    const it3 = { id: 'it-depD', kind: 'device', categoryId: 'game', name: '默认', purchaseDate: '2025-11-09', purchasePrice: 1000, status: 'in_use' };
    const cost3 = M.calcItemCost(makeDB([it3]), it3, NOW); // game 分类无 residualRate
    assert(cost3.lifeYears === 5 && close(cost3.usedRatio, 365 / 1825), '默认寿命 5 年，实为 ' + cost3.lifeYears + '/' + cost3.usedRatio);
    assert(close(cost3.currentValue, 1000 * (0.1 + 0.9 * (1 - 365 / 1825))), '默认残值率 0.1，实为 ' + cost3.currentValue);
    // 修复锁：预估寿命 0/负数不产生 0 除/负 usedRatio，落到分类/默认
    const it4 = { id: 'it-depZ', kind: 'device', categoryId: 'host', name: '零寿命', purchaseDate: '2025-11-09', purchasePrice: 1000, status: 'in_use', estimatedLifeYears: 0 };
    const cost4 = M.calcItemCost(makeDB([it4]), it4, NOW);
    assert(cost4.lifeYears === 5 && cost4.usedRatio >= 0 && cost4.usedRatio <= 1, '寿命 0 落默认 5 年，实为 ' + cost4.lifeYears);
    const it5 = Object.assign({}, it4, { id: 'it-depN', estimatedLifeYears: -3 });
    const cost5 = M.calcItemCost(makeDB([it5]), it5, NOW);
    assert(cost5.lifeYears === 5 && cost5.usedRatio >= 0, '负寿命不得把 usedRatio 打负，实为 ' + cost5.usedRatio);
    console.log('PASS ' + cur);
  }

  /* ---------- 14 二手回血 ---------- */
  cur = '14. 二手回血：净成本/回血率；空售出价 → null';
  {
    const it = { id: 'it-res', kind: 'device', categoryId: 'host', name: '回血', purchaseDate: '2021-03-23', purchasePrice: 899, status: 'sold', soldDate: '2026-11-01', soldPrice: 300 };
    const cost = M.calcItemCost(makeDB([it]), it, NOW);
    assert(close(cost.netCost, 599), '净成本应 599，实为 ' + cost.netCost);
    assert(close(cost.recoveryRate, 300 / 899), '回血率应 300/899，实为 ' + cost.recoveryRate);
    const it0 = Object.assign({}, it, { id: 'it-res0', soldPrice: '' });
    const cost0 = M.calcItemCost(makeDB([it0]), it0, NOW);
    assert(cost0.netCost === null && cost0.recoveryRate === null, '空售出价不计回血');
    // 回血不改写日均/总投入（毛口径），只出净成本
    assert(cost.invested === 899 && cost.dailyCost > 0, '回血后日均/总投入仍为毛口径');
    console.log('PASS ' + cur);
  }

  /* ---------- 15 合品（账单合并）不重复计（storage 集成） ---------- */
  cur = '15. 合品不重复计：手动物品不被同名账单推高；fromBill=账单合计单一来源';
  {
    const w2 = makeWindow();
    if (!(await waitMain(w2))) throw new Error('no main');
    const S = w2.Storage, M2 = w2.Models;
    const db = S.getDB();
    // （a）手动物品 899 + 同名 4399 账单合并 → 购入价/总投入保持 899（防配件账单撞名压价）
    const manual = {
      id: 'it-man', kind: 'device', categoryId: 'host', name: '测试',
      purchaseDate: '2021-03-23', purchasePrice: 899, status: 'in_use', images: [], tags: []
    };
    db.items.push(manual);
    await S.saveBill({
      id: 'b-merge', type: 'expense', amount: 4399, date: '2023-05-01', time: '',
      catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '测试', tagIds: [], source: 'manual'
    });
    const merged = db.wallet.bills.find(function (b) { return b.id === 'b-merge'; });
    assert(merged && merged.itemId === 'it-man', '同名账单应合并进手动物品（合品语义前提）');
    const mItem = db.items.find(function (i) { return i.id === 'it-man'; });
    assert(mItem.purchasePrice === 899, '手动物品金额不得被同名账单改写，实为 ' + mItem.purchasePrice);
    const cManual = M2.calcItemCost(db, mItem, NOW);
    assert(cManual.invested === 899, '手动物品总投入应仍 899，实为 ' + cManual.invested);
    // （b）fromBill 物品：金额=关联账单合计（899+4399=5298，单一来源不再叠加）
    const fb = {
      id: 'it-fb', kind: 'device', categoryId: 'host', name: '合并机',
      purchaseDate: '2021-03-23', purchasePrice: 899, status: 'in_use', images: [], tags: [],
      fromBill: 'b-fb1', linkedBillIds: ['b-fb1']
    };
    db.items.push(fb);
    db.wallet.bills.push({ id: 'b-fb1', type: 'expense', amount: 899, date: '2021-03-23', catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '合并机', itemId: 'it-fb', source: 'manual' });
    await S.saveBill({
      id: 'b-fb2', type: 'expense', amount: 4399, date: '2023-05-01', time: '',
      catId: 'w_shop', subCatId: 'w_shop_digital', accountId: '', note: '合并机', tagIds: [], itemId: 'it-fb', source: 'manual'
    });
    const fbBill = db.wallet.bills.find(function (b) { return b.id === 'b-fb2'; });
    assert(fbBill && fbBill.itemId === 'it-fb', '显式关联账单应挂到 fromBill 物品');
    const fbItem = db.items.find(function (i) { return i.id === 'it-fb'; });
    assert(fbItem.purchasePrice === 5298, 'fromBill 金额=账单合计 5298，实为 ' + fbItem.purchasePrice);
    const cFb = M2.calcItemCost(db, fbItem, NOW);
    assert(cFb.invested === 5298 && cFb.breakdown.purchase === 5298 && cFb.breakdown.accessoriesTotal === 0 && cFb.breakdown.repairCost === 0,
      'fromBill 总投入=账单合计且不重复叠加，实为 ' + cFb.invested);
    console.log('PASS ' + cur);
  }

  /* ---------- 16 配件挂靠边界 ---------- */
  cur = '16. 配件边界：挂靠不分域、只挂一层（孙配件不递归）';
  {
    const host = { id: 'it-h', kind: 'device', categoryId: 'host', name: '主机', purchaseDate: '2021-03-23', purchasePrice: 1000, status: 'in_use' };
    const acc = { id: 'it-a', kind: 'device', categoryId: 'acc', name: '配件', purchasePrice: 200, parentItemId: 'it-h' };
    const grand = { id: 'it-g', kind: 'device', categoryId: 'acc', name: '孙配件', purchasePrice: 300, parentItemId: 'it-a' };
    const cross = { id: 'it-c', kind: 'clothing', categoryId: 'top', name: '跨域挂靠', purchasePrice: 100, parentItemId: 'it-h' };
    const cost = M.calcItemCost(makeDB([host, acc, grand, cross]), host, NOW);
    assert(cost.invested === 1000 + 200 + 100, '总投入=主机+一层配件（含跨域），孙配件 300 不递归，实为 ' + cost.invested);
    console.log('PASS ' + cur);
  }

  /* ---------- 17 汇总口径 ---------- */
  cur = '17. 汇总口径：summary 总投入按自身投入求和（配件不计两次）';
  {
    const w3 = makeWindow();
    if (!(await waitMain(w3))) throw new Error('no main');
    const S3 = w3.Storage, M3 = w3.Models;
    const db3 = S3.getDB();
    db3.items.push(
      { id: 'it-h2', kind: 'device', categoryId: 'host', name: '主机', purchaseDate: '2021-03-23', purchasePrice: 899, status: 'in_use', images: [], tags: [] },
      { id: 'it-a3', kind: 'device', categoryId: 'host', name: '配件', purchaseDate: '2021-03-23', purchasePrice: 4399, parentItemId: 'it-h2', status: 'in_use', images: [], tags: [] }
    );
    const sum = M3.summary(db3, NOW);
    assert(sum.totalInvest === 899 + 4399, '汇总总投入=自身投入求和 5298（配件只算一次），实为 ' + sum.totalInvest);
    const hostC = sum.items.find(function (i) { return i.id === 'it-h2'; }).cost;
    assert(hostC.invested === 5298, '主机 TCO 5298（含挂靠），实为 ' + hostC.invested);
    assert(close(sum.dailyCostTotal, 899 / hostC.heldDays + 4399 / hostC.heldDays),
      '日均合计按自身投入（防配件双计），实为 ' + sum.dailyCostTotal);
    console.log('PASS ' + cur);
  }

  /* ---------- 18 负价兜底 ---------- */
  cur = '18. 负购入价兜底按 0（日均不为负）';
  {
    const it = { id: 'it-neg', kind: 'device', categoryId: 'host', name: '负价', purchaseDate: '2021-03-23', purchasePrice: -899, status: 'in_use' };
    const cost = M.calcItemCost(makeDB([it]), it, NOW);
    assert(cost.invested === 0 && cost.breakdown.purchase === 0, '负购入价按 0，实为 ' + cost.invested);
    assert(cost.dailyCost === 0, '日均不得为负，实为 ' + cost.dailyCost);
    console.log('PASS ' + cur);
  }

  console.log('========== v117-cost-audit：18 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + (e && e.message ? e.message : e));
  process.exit(1);
});
