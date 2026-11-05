/* models.js — 数据模型、默认分类、成本计算引擎 v3 */
window.Models = (function () {
  const U = window.Utils;

  function defaultCategories() {
    return window.__DEFAULT_CATEGORIES__ || {
      digital: [], clothing: [], life: [],
      foodCuisine: [], foodType: [], meal: [], foodTag: [],
      occasion: [], season: [], tagPresets: [], condition: [],
      remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
    };
  }

  /* 钱袋分类兜底：服务端未下发 wallet.cats 时（如旧 exe 未重编译），前端仍可用完整主流记账分类树 */
  function defaultWalletCats() {
    const P = function (id, name, icon, children) {
      return { id: id, name: name, icon: icon, children: children || [] };
    };
    const C = function (id, name, icon) { return { id: id, name: name, icon: icon }; };
    return {
      expense: [
        P('w_food', '食品餐饮', 'color_ic_parent_restaurant', [
          C('w_food_breakfast', '早餐', 'color_ic_restaurant_breakfast'), C('w_food_lunch', '午餐', 'color_ic_restaurant_lunch'),
          C('w_food_dinner', '晚餐', 'color_ic_restaurant_dinner'), C('w_food_snack', '休闲零食', 'color_ic_restaurant_snacks'),
          C('w_food_fresh', '生鲜食品', 'color_ic_restaurant_fresh'), C('w_food_foodstuff', '粮油调味', 'color_ic_restaurant_foodstuff'),
          C('w_food_treat', '请客吃饭', 'color_ic_restaurant_treat'), C('w_food_wine', '饮料酒水', 'color_ic_restaurant_wine'),
          C('w_food_other', '其他', 'color_ic_parent_restaurant')]),
        P('w_shop', '购物消费', 'color_ic_parent_shopping', [
          C('w_shop_digital', '手机数码', 'color_ic_shopping_phone'), C('w_shop_clothing', '服饰运动', 'color_ic_shopping_motion'),
          C('w_shop_beauty', '个护美妆', 'color_ic_shopping_makeup'), C('w_shop_watch', '配饰腕表', 'color_ic_shopping_watch'),
          C('w_shop_appliance', '生活电器', 'color_ic_shopping_electric'), C('w_shop_home', '日常家居', 'color_ic_shopping_home'),
          C('w_shop_baby', '母婴玩具', 'color_ic_shopping_baby'), C('w_shop_office', '办公用品', 'color_ic_shopping_office'),
          C('w_shop_pets', '宠物用品', 'color_ic_shopping_pets'), C('w_shop_virtual', '虚拟充值', 'color_ic_shopping_recharge'),
          C('w_shop_renovation', '装修装饰', 'color_ic_shopping_renovation'), C('w_shop_other', '其他', 'color_ic_parent_shopping')]),
        P('w_traffic', '出行交通', 'color_ic_parent_traffic', [
          C('w_tf_taxi', '打车', 'color_ic_traffic_taxi'), C('w_tf_public', '公共交通', 'color_ic_traffic_bus'),
          C('w_tf_fuel', '加油', 'color_ic_traffic_oil'), C('w_tf_park', '停车费', 'color_ic_traffic_parking'),
          C('w_tf_maintain', '保养修车', 'color_ic_traffic_maintain'), C('w_tf_train', '火车', 'color_ic_traffic_train'),
          C('w_tf_flight', '飞机', 'color_ic_traffic_aircraft'), C('w_tf_other', '其他', 'color_ic_parent_traffic')]),
        P('w_home', '居家生活', 'color_ic_parent_home', [
          C('w_hm_rent', '房租还贷', 'color_ic_home_loan'), C('w_hm_water', '水费', 'color_ic_home_water'),
          C('w_hm_power', '电费', 'color_ic_home_electricity_fees'), C('w_hm_gas', '燃气费', 'color_ic_home_gas'),
          C('w_hm_property', '物业费', 'color_ic_home_property'), C('w_hm_net', '话费宽带', 'color_ic_home_telephone_bill'),
          C('w_hm_parking', '车位费', 'color_ic_home_parking_lot'), C('w_hm_clean', '家政清洁', 'color_ic_home_husekeeping'),
          C('w_hm_other', '其他', 'color_ic_parent_home')]),
        P('w_fun', '休闲娱乐', 'color_ic_parent_game', [
          C('w_fn_travel', '旅游度假', 'color_ic_game_travel'), C('w_fn_movie', '电影唱歌', 'color_ic_game_film'),
          C('w_fn_sport', '运动健身', 'color_ic_game_keep_fit'), C('w_fn_chess', '棋牌桌游', 'color_ic_game_chess'),
          C('w_fn_show', '演出', 'color_ic_game_show'), C('w_fn_bar', '酒吧', 'color_ic_game_bar'),
          C('w_fn_bath', '足浴按摩', 'color_ic_game_foot_bath'), C('w_fn_other', '其他', 'color_ic_parent_game')]),
        P('w_edu', '文化教育', 'color_ic_parent_education', [
          C('w_ed_book', '书报杂志', 'color_ic_education_book'), C('w_ed_train', '培训考试', 'color_ic_education_train'),
          C('w_ed_tuition', '学费', 'color_ic_education_tuition'), C('w_ed_other', '其他', 'color_ic_parent_education')]),
        P('w_medical', '健康医疗', 'color_ic_parent_medical', [
          C('w_md_drug', '买药', 'color_ic_medical_medicine'), C('w_md_hospital', '医院', 'color_ic_medical_hospital'),
          C('w_md_care', '滋补保健', 'color_ic_medical_healthcare'), C('w_md_other', '其他', 'color_ic_parent_medical')]),
        P('w_gift', '送礼人情', 'color_ic_parent_gift', [
          C('w_gf_present', '礼物', 'color_ic_gift_gift'), C('w_gf_redpacket', '红包', 'color_ic_gift_red_paper'),
          C('w_gf_elder', '孝敬长辈', 'color_ic_gift_filial_piety'), C('w_gf_reward', '打赏', 'color_ic_gift_reward'),
          C('w_gf_lend', '借出', 'color_ic_gift_lend'), C('w_gf_other', '其他', 'color_ic_parent_gift')]),
        P('w_pet', '宠物', 'color_ic_shopping_pets', [
          C('w_pt_food', '宠物食品', 'color_ic_shopping_pets'), C('w_pt_medical', '宠物医疗', 'color_ic_medical_medicine'),
          C('w_pt_groom', '宠物美容', 'color_ic_shopping_pets'), C('w_pt_other', '其他', 'color_ic_shopping_pets')]),
        P('w_other_exp', '其他支出', 'color_ic_parent_other', [
          C('w_oe_charity', '慈善捐助', 'color_ic_other_charitable'), C('w_oe_loss', '罚款赔偿', 'color_ic_other_fine'),
          C('w_oe_invest', '理财支出', 'color_ic_stock_out'), C('w_oe_other', '其他', 'color_ic_parent_other')])
      ],
      income: [
        C('w_in_wages', '工资', 'color_ic_income_wages'), C('w_in_bonus', '奖金', 'color_ic_income_bonus'),
        C('w_in_subsidy', '补贴', 'color_ic_income_subsidy'), C('w_in_parttime', '兼职外快', 'color_ic_income_part_time_job'),
        C('w_in_reimb', '报销', 'color_ic_income_reimbursement'), C('w_in_gift', '礼金人情', 'color_ic_income_cash_gift'),
        C('w_in_borrow', '借入', 'color_ic_income_borrow'), C('w_in_resale', '二手闲置', 'color_ic_income_second_hand'),
        C('w_in_finance', '理财盈利', 'color_ic_income_manager_money'), C('w_in_winning', '中奖', 'color_ic_income_winning'),
        C('w_in_other', '其他', 'color_ic_income_other')
      ]
    };
  }

  function defaultSettings() {
    return {
      idleWarnDays: 60, currency: '¥', theme: 'light', rememberAccount: false,
      requiredFields: { name: true, category: true, purchaseDate: true, purchasePrice: true },
      budget: { monthlyTotal: 0, categories: { clothing: 0, life: 0, food: 0, digital: 0 } },
      planSections: [
        { id: 'kpi', enabled: true, fixed: true },
        { id: 'composition', enabled: true, fixed: true },
        { id: 'monthly', enabled: true },
        { id: 'budget', enabled: true },
        { id: 'wTrend', enabled: true },
        { id: 'wCatPie', enabled: true },
        { id: 'expiry', enabled: true },
        { id: 'idle', enabled: true },
        { id: 'cpw', enabled: true },
        { id: 'game', enabled: true },
        { id: 'empty', enabled: true },
        { id: 'valueTrend', enabled: true },
        { id: 'foodStats', enabled: true },
        { id: 'resale', enabled: false },
        { id: 'seasonOccasion', enabled: false },
        { id: 'wearTrend', enabled: false },
        { id: 'deviceRank', enabled: false }
      ],
      makeupLooks: [], customTags: []
    };
  }

  function emptyDB() {
    return {
      version: 3, items: [], outfits: [], food: [], events: [],
      categories: defaultCategories(), settings: defaultSettings()
    };
  }

  /* ---------- 分类（v1.0.1：数码=device/game 共用 digital 树） ---------- */
  function catList(db, kind) {
    if (kind === 'device' || kind === 'game' || kind === 'digital') return db.categories.digital || [];
    return db.categories[kind] || [];
  }

  function findCategory(db, item) {
    const list = catList(db, item.kind);
    return list.find(function (c) { return c.id === item.categoryId; }) || null;
  }

  function findSubCategory(db, item) {
    const l1 = findCategory(db, item);
    if (!l1 || !l1.children) return null;
    return l1.children.find(function (c) { return c.id === item.subCategoryId; }) || null;
  }

  function isGameItem(item) {
    return item.categoryId === 'game' || String(item.subCategoryId || '').indexOf('gm_') === 0;
  }

  /* ---------- 成本 ---------- */
  function ownInvested(db, item) {
    let sum = Number(item.purchasePrice) || 0;
    db.events.forEach(function (e) {
      if (e.itemId === item.id && e.type === 'repair') sum += Number(e.cost) || 0;
    });
    return sum;
  }

  function totalInvested(db, item) {
    let sum = ownInvested(db, item);
    db.items.forEach(function (i) {
      if (i.parentItemId === item.id) sum += ownInvested(db, i);
    });
    return sum;
  }

  /* 使用周期截止日：已售出(soldDate) > 状态非在用(retiredAt) > 现在。
     物品一旦非在用，日均使用成本/使用天数/吃灰/开封时长等使用类指标全部冻结为固定值，
     不再随时间刷新（v1.1.0 用户要求）。 */
  function useEndDate(item, now) {
    return U.parseDate(item.soldDate) || U.parseDate(item.retiredAt) || (now || new Date());
  }

  function calcItemCost(db, item, now) {
    now = now || new Date();
    const cat = findCategory(db, item) || {};
    const pDate = U.parseDate(item.purchaseDate) || now;
    const soldDate = U.parseDate(item.soldDate);
    const endDate = useEndDate(item, now);
    const heldDays = Math.max(1, U.daysBetween(pDate, endDate));
    const invested = totalInvested(db, item);

    const lifeYears = Number(item.estimatedLifeYears) || Number(cat.lifeYears) || 5;
    const residualRate = item.residualRate !== null && item.residualRate !== undefined
      ? Number(item.residualRate) : (Number(cat.residualRate) || 0.1);
    const usedRatio = Math.min(1, heldDays / (lifeYears * 365));
    const base = Number(item.purchasePrice) || 0;
    const value = base * (residualRate + (1 - residualRate) * (1 - usedRatio));
    const dailyCost = invested / heldDays;

    // 使用次数：手动累计（life/clothing/digital 通用）
    const useCount = Number(item.useCount) || 0;
    const wearCount = totalWearCount(db, item);
    const playHours = Number(item.playHours) || 0;

    let costPerUse = null;
    if (item.kind === 'clothing' && wearCount > 0) costPerUse = invested / wearCount;
    else if (item.kind === 'life' && useCount > 0) costPerUse = invested / useCount;
    else if (useCount > 0) costPerUse = invested / useCount;

    const costPerHour = playHours > 0 ? invested / playHours : null;
    let netCost = null, recoveryRate = null;
    if (soldDate && item.soldPrice !== null && item.soldPrice !== undefined) {
      netCost = invested - (Number(item.soldPrice) || 0);
      recoveryRate = invested > 0 ? (Number(item.soldPrice) || 0) / invested : null;
    }
    return {
      heldDays: heldDays, invested: invested, dailyCost: dailyCost,
      monthlyCost: dailyCost * 30, currentValue: value, usedRatio: usedRatio,
      lifeYears: lifeYears, costPerUse: costPerUse, costPerHour: costPerHour,
      netCost: netCost, recoveryRate: recoveryRate
    };
  }

  /* ---------- 使用流水（所有物品通用） ---------- */
  /**
   * usageLog: [{id, date, delta, source:'manual'|'outfit'|'edit', note}]
   * useCount = 与流水保持同步（增删流水时联动）
   */
  function logSum(item) {
    return (item.usageLog || []).reduce(function (a, b) { return a + (Number(b.delta) || 0); }, 0);
  }

  function appendUsageLog(item, delta, source, note, refId, date) {
    if (!item.usageLog) item.usageLog = [];
    item.usageLog.push({
      id: U.uid(), date: date || U.todayStr(), delta: delta,
      source: source || 'manual', note: note || '', refId: refId || '',
      at: new Date().toISOString()
    });
    // 同步总数：衣服计入手动部分，其他计入 useCount
    if (item.kind === 'clothing') {
      item.manualWearCount = (Number(item.manualWearCount) || 0) + delta;
    } else {
      item.useCount = Math.max(0, (Number(item.useCount) || 0) + delta);
    }
    return item;
  }

  function removeUsageLogEntry(item, logId) {
    const idx = (item.usageLog || []).findIndex(function (l) { return l.id === logId; });
    if (idx < 0) return item;
    const entry = item.usageLog[idx];
    item.usageLog.splice(idx, 1);
    const d = Number(entry.delta) || 0;
    if (item.kind === 'clothing') {
      item.manualWearCount = Math.max(0, (Number(item.manualWearCount) || 0) - d);
    } else {
      item.useCount = Math.max(0, (Number(item.useCount) || 0) - d);
    }
    return item;
  }

  /* ---------- 穿着次数：自动（穿搭打卡）+ 手动 ---------- */
  function autoWearMap(db) {
    const map = {};
    db.outfits.forEach(function (o) {
      (o.itemIds || []).forEach(function (id) {
        map[id] = (map[id] || 0) + 1;
      });
    });
    return map;
  }

  function totalWearCount(db, item) {
    if (item.kind === 'life') return Number(item.useCount) || 0;
    const auto = autoWearMap(db)[item.id] || 0;
    return auto + (Number(item.manualWearCount) || 0);
  }

  function itemsWithComputed(db) {
    return db.items.map(function (it) {
      const clone = Object.assign({}, it);
      clone.autoWear = autoWearMap(db)[clone.id] || 0;
      clone.manualWear = Number(clone.manualWearCount) || 0;
      clone.wearCount = totalWearCount(db, clone);
      clone.cost = calcItemCost(db, clone);
      return clone;
    });
  }

  /* ---------- 化妆品：开封/PAO/临期 ---------- */
  function lifeStatus(item, now) {
    now = now || new Date();
    // 非在用物品：开封时长等使用类指标冻结在截止日（PAO 到期日本身客观不变）
    const end = useEndDate(item, now);
    const opened = U.parseDate(item.openedDate);
    const pao = Number(item.paoMonths) || 0;
    let paoExpiry = null, daysLeft = null, state = 'ok';
    if (opened && pao > 0) {
      const exp = new Date(opened);
      exp.setMonth(exp.getMonth() + pao);
      paoExpiry = U.todayStr(exp);
      daysLeft = U.daysBetween(now, exp);
      if (daysLeft < 0) state = 'expired';
      else if (daysLeft <= 30) state = 'near';
    }
    return {
      openedDays: opened ? U.daysBetween(opened, end) : null,
      paoExpiry: paoExpiry, paoDaysLeft: daysLeft, paoState: state,
      isEmptied: item.status === 'empty' || item.remainLevel === '空',
      emptyDate: item.emptyDate || '',
      repurchase: !!item.repurchase
    };
  }

  function expiryList(db, now) {
    now = now || new Date();
    const out = [];
    db.items.forEach(function (it) {
      // 已离开（售出/转赠/报废）的物品不再提醒临期与保修
      if (it.status === 'sold' || it.status === 'gifted' || it.status === 'broken') return;
      if (it.kind === 'life') {
        const s = lifeStatus(it, now);
        if (s.paoState === 'near' || s.paoState === 'expired') {
          out.push({ item: it, daysLeft: s.paoDaysLeft, kind: 'pao', label: s.paoState === 'expired' ? '已过期' : '临期' });
        }
      }
      if (it.warrantyEnd) {
        const w = U.parseDate(it.warrantyEnd);
        if (w) {
          const d = U.daysBetween(now, w);
          if (d < 0) out.push({ item: it, daysLeft: d, kind: 'warranty', label: '保修已过' });
          else if (d <= 30) out.push({ item: it, daysLeft: d, kind: 'warranty', label: '保修临期' });
        }
      }
    });
    return out.sort(function (a, b) { return a.daysLeft - b.daysLeft; });
  }

  function emptyList(db) {
    return db.items.filter(function (i) {
      return i.kind === 'life' && (i.status === 'empty' || i.remainLevel === '空' || i.repurchase);
    });
  }

  /* ---------- 美食统计 ---------- */
  function foodStats(db) {
    const recs = db.food.slice();
    const now = new Date();
    const mk = U.monthKey(U.todayStr(now));
    const month = recs.filter(function (r) { return U.monthKey(r.date) === mk; });
    function sum(arr, f) { return arr.reduce(function (a, b) { return a + (f(b) || 0); }, 0); }
    const byMeal = {}, byType = {}, byTag = {}, byCuisine = {};
    recs.forEach(function (r) {
      byMeal[r.meal || '其他'] = (byMeal[r.meal || '其他'] || 0) + 1;
      byType[r.foodType || '其他'] = (byType[r.foodType || '其他'] || 0) + 1;
      byCuisine[r.foodCuisine || '其他'] = (byCuisine[r.foodCuisine || '其他'] || 0) + 1;
      (r.tags || []).forEach(function (t) { byTag[t] = (byTag[t] || 0) + 1; });
    });
    return {
      total: recs.length,
      monthCount: month.length,
      monthSpend: sum(month, function (r) { return Number(r.price) || 0; }),
      totalSpend: sum(recs, function (r) { return Number(r.price) || 0; }),
      monthCalories: sum(month, function (r) { return Number(r.calories) || 0; }),
      avgRating: recs.filter(function (r) { return r.rating; }).length
        ? sum(recs, function (r) { return Number(r.rating) || 0; }) / recs.filter(function (r) { return r.rating; }).length : 0,
      byMeal: byMeal, byType: byType, byTag: byTag, byCuisine: byCuisine
    };
  }

  /* 吃灰天数（距上次使用的天数）：取 手动lastUsedDate / 穿搭流水 / 使用流水 三者最近一天，
     都没有才按购入日起算（v1.0.9 修正：美妆/数码此前只看购入日，天天在用也显示吃灰） */
  function idleDaysOf(db, i, now) {
    now = now || new Date();
    // 非在用物品：吃灰天数冻结在截止日，不再随时间增长
    const end = useEndDate(i, now);
    const d0 = function (s) {
      const d = U.daysBetween(U.parseDate(s), end);
      return d == null ? 0 : d;
    };
    let last = i.lastUsedDate || '';
    if (i.kind === 'clothing') {
      const w = lastWearDate(db, i.id);
      if (w && w > last) last = w;
    }
    (i.usageLog || []).forEach(function (l) {
      if (l && l.date && l.date > last) last = l.date;
    });
    return last ? d0(last) : d0(i.purchaseDate);
  }

  /* ---------- 汇总 ---------- */
  // 钱袋（记账）统计：与物品/美食合并时，已关联物品的账单金额只算一次
  // （账单里算过、物品购入里也有 → 差值扣除），未记账的物品购入照常计。
  function walletStats(db) {
    const bills = ((db.wallet || {}).bills) || [];
    const monthExpense = {}, monthIncome = {}, monthLinked = {};
    let curExp = 0, curInc = 0, curLinked = 0;
    const byCat = {};
    const mk = U.monthKey(U.todayStr());
    bills.forEach(function (b) {
      const k = U.monthKey(b.date || '');
      const a = Math.abs(Number(b.amount) || 0);
      if (b.type === 'income') {
        monthIncome[k] = (monthIncome[k] || 0) + a;
        if (k === mk) curInc += a;
      } else if (b.type === 'expense') {
        monthExpense[k] = (monthExpense[k] || 0) + a;
        // 已关联物品词条或美食条目的账单，在合并口径里不再重复计（P0 修复：正餐账单曾被算两遍）
        const linked = b.itemId || b.foodId;
        if (linked) monthLinked[k] = (monthLinked[k] || 0) + a;
        if (k === mk) {
          curExp += a;
          if (linked) curLinked += a;
          const key = b.subCatId || b.catId || 'other';
          byCat[key] = (byCat[key] || 0) + a;
        }
      }
    });
    return {
      monthExpense: curExp, monthIncome: curInc,
      monthUnlinkedExpense: Math.max(0, curExp - curLinked), monthLinkedExpense: curLinked,
      monthlyExpense: monthExpense, monthlyIncome: monthIncome, monthlyLinkedExpense: monthLinked,
      byCat: byCat, billCount: bills.length
    };
  }

  function summary(db, now) {
    now = now || new Date();
    const list = itemsWithComputed(db);
    const active = list.filter(function (i) { return i.status !== 'sold' && i.status !== 'gifted'; });
    const devices = active.filter(function (i) { return i.kind === 'device'; });
    const games = active.filter(function (i) { return i.kind === 'game'; });
    const clothes = active.filter(function (i) { return i.kind === 'clothing'; });
    const lifes = active.filter(function (i) { return i.kind === 'life'; });

    function sum(arr, f) { return arr.reduce(function (a, b) { return a + (f(b) || 0); }, 0); }

    const totalInvest = sum(list, function (i) { return ownInvested(db, i); });
    const activeInvest = sum(active, function (i) { return ownInvested(db, i); });
    const bookValue = sum(active, function (i) { return i.cost.currentValue; });
    const resalePotential = sum(active, function (i) { return Number(i.estimatedResalePrice) || 0; });

    const mk = U.monthKey(U.todayStr(now));
    const monthNew = list.filter(function (i) { return U.monthKey(i.purchaseDate) === mk; });
    const monthSpend = sum(monthNew, function (i) { return Number(i.purchasePrice) || 0; });

    const idleDays = function (i) { return idleDaysOf(db, i, now); };
    const idleList = active.map(function (i) { return { item: i, idle: idleDays(i) }; })
      .sort(function (a, b) { return b.idle - a.idle; });

    const gameStatusCount = { unopened: 0, playing: 0, finished: 0, dropped: 0 };
    games.forEach(function (g) {
      const s = g.gameStatus || 'unopened';
      if (gameStatusCount[s] !== undefined) gameStatusCount[s]++;
    });

    const monthly = {};
    list.forEach(function (i) {
      const k = U.monthKey(i.purchaseDate);
      monthly[k] = (monthly[k] || 0) + (Number(i.purchasePrice) || 0);
    });

    const cpwList = clothes.map(function (c) {
      return { item: c, cpw: c.cost.costPerUse, wear: c.wearCount };
    }).sort(function (a, b) { return (a.cpw === null ? 9e9 : a.cpw) - (b.cpw === null ? 9e9 : b.cpw); });

    const lifeUseList = lifes.map(function (c) {
      return { item: c, cpw: c.cost.costPerUse, uses: c.useCount };
    }).sort(function (a, b) { return (a.cpw === null ? 9e9 : a.cpw) - (b.cpw === null ? 9e9 : b.cpw); });

    // 本月消费分类（预算用）
    const catSpend = { digital: 0, clothing: 0, life: 0, food: 0 };
    list.forEach(function (i) {
      if (U.monthKey(i.purchaseDate) !== mk) return;
      const k = i.kind === 'device' || i.kind === 'game' ? 'digital' : i.kind;
      if (catSpend[k] !== undefined) catSpend[k] += Number(i.purchasePrice) || 0;
    });
    catSpend.food = foodStats(db).monthSpend;

    // 估值趋势（近 12 月账面估值简化：当前值 + 未过折旧部分）
    const wstat = walletStats(db);
    // 综合花费（合并口径）：账单支出 + 物品购入 + 美食 − 已关联物品的账单（防重复计）
    const combinedMonthSpend = wstat.monthExpense + monthSpend + (foodStats(db).monthSpend || 0) - wstat.monthLinkedExpense;
    return {
      items: list,
      counts: { all: list.length, device: devices.length, game: games.length, clothing: clothes.length, life: lifes.length },
      totalInvest: totalInvest, activeInvest: activeInvest, bookValue: bookValue,
      resalePotential: resalePotential, monthSpend: monthSpend, monthNewCount: monthNew.length,
      idleList: idleList, gameStatusCount: gameStatusCount, monthlySpend: monthly,
      cpwList: cpwList, lifeUseList: lifeUseList,
      dailyCostTotal: sum(active, function (i) { return ownInvested(db, i) / i.cost.heldDays; }),
      expiry: expiryList(db, now), empties: emptyList(db),
      food: foodStats(db), catSpend: catSpend,
      wallet: wstat, combinedMonthSpend: combinedMonthSpend
    };
  }

  function lastWearDate(db, itemId) {
    let last = null;
    db.outfits.forEach(function (o) {
      if ((o.itemIds || []).indexOf(itemId) >= 0) {
        if (!last || o.date > last) last = o.date;
      }
    });
    return last;
  }

  function validateItem(db, item) {
    const req = db.settings.requiredFields || {};
    const errs = [];
    if (req.name !== false && !String(item.name || '').trim()) errs.push('名称必填');
    if (req.category !== false && !item.categoryId) errs.push('种类必填');
    if (req.purchaseDate !== false && !item.purchaseDate) errs.push('购买日期必填');
    if (req.purchasePrice !== false && (item.purchasePrice === '' || item.purchasePrice === null || item.purchasePrice === undefined || isNaN(Number(item.purchasePrice)))) {
      errs.push('购买价格必填');
    }
    return errs;
  }

  function validateFood(rec) {
    const errs = [];
    if (!rec.foodCuisine) errs.push('菜系必填');
    if (!rec.meal) errs.push('餐别必填');
    if (rec.price === '' || rec.price === null || rec.price === undefined || isNaN(Number(rec.price))) errs.push('价格必填');
    return errs;
  }

  return {
    defaultCategories: defaultCategories, defaultSettings: defaultSettings, emptyDB: emptyDB,
    defaultWalletCats: defaultWalletCats,
    findCategory: findCategory, findSubCategory: findSubCategory,
    catList: catList, isGameItem: isGameItem,
    ownInvested: ownInvested, totalInvested: totalInvested, calcItemCost: calcItemCost,
    autoWearMap: autoWearMap, totalWearCount: totalWearCount, itemsWithComputed: itemsWithComputed,
    logSum: logSum, appendUsageLog: appendUsageLog, removeUsageLogEntry: removeUsageLogEntry,
    lifeStatus: lifeStatus, expiryList: expiryList, emptyList: emptyList, foodStats: foodStats, idleDaysOf: idleDaysOf,
    walletStats: walletStats, useEndDate: useEndDate,
    summary: summary, lastWearDate: lastWearDate,
    validateItem: validateItem, validateFood: validateFood
  };
})();
