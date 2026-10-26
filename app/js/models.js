/* models.js — 数据模型、默认分类、成本计算引擎 v3 */
window.Models = (function () {
  const U = window.Utils;

  function defaultCategories() {
    // 与服务端 DEFAULT_CATEGORIES 一致（服务端持久化优先，此处兜底）
    return window.__DEFAULT_CATEGORIES__ || {
      device: [], game: [], clothing: [], life: [],
      foodType: [], meal: [], foodTag: [], occasion: [], season: []
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
      makeupLooks: []
    };
  }

  function emptyDB() {
    return {
      version: 3, items: [], outfits: [], food: [], events: [],
      categories: defaultCategories(), settings: defaultSettings()
    };
  }

  /* ---------- 分类 ---------- */
  function findCategory(db, item) {
    const list = (db.categories[item.kind] || []);
    return list.find(function (c) { return c.id === item.categoryId; }) || null;
  }

  function lifeL2(db, item) {
    const l1 = (db.categories.life || []).find(function (c) { return c.id === item.categoryId; });
    if (!l1 || !l1.children) return null;
    return l1.children.find(function (c) { return c.id === item.subCategoryId; }) || null;
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

  function calcItemCost(db, item, now) {
    now = now || new Date();
    const cat = findCategory(db, item) || {};
    const pDate = U.parseDate(item.purchaseDate) || now;
    const soldDate = U.parseDate(item.soldDate);
    const endDate = soldDate || now;
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

  function appendUsageLog(item, delta, source, note) {
    if (!item.usageLog) item.usageLog = [];
    item.usageLog.push({
      id: U.uid(), date: U.todayStr(), delta: delta,
      source: source || 'manual', note: note || '',
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
      openedDays: opened ? U.daysBetween(opened, now) : null,
      paoExpiry: paoExpiry, paoDaysLeft: daysLeft, paoState: state,
      isEmptied: item.status === 'empty',
      emptyDate: item.emptyDate || '',
      repurchase: !!item.repurchase
    };
  }

  function expiryList(db, now) {
    now = now || new Date();
    const out = [];
    db.items.forEach(function (it) {
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
      return i.kind === 'life' && (i.status === 'empty' || i.repurchase);
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

  /* ---------- 汇总 ---------- */
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

    const idleDays = function (i) {
      if (i.lastUsedDate) return U.daysBetween(U.parseDate(i.lastUsedDate), now);
      if (i.kind === 'clothing') {
        const last = lastWearDate(db, i.id);
        return last ? U.daysBetween(U.parseDate(last), now) : U.daysBetween(U.parseDate(i.purchaseDate), now);
      }
      return U.daysBetween(U.parseDate(i.purchaseDate), now);
    };
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
    return {
      items: list,
      counts: { all: list.length, device: devices.length, game: games.length, clothing: clothes.length, life: lifes.length },
      totalInvest: totalInvest, activeInvest: activeInvest, bookValue: bookValue,
      resalePotential: resalePotential, monthSpend: monthSpend, monthNewCount: monthNew.length,
      idleList: idleList, gameStatusCount: gameStatusCount, monthlySpend: monthly,
      cpwList: cpwList, lifeUseList: lifeUseList,
      dailyCostTotal: sum(active, function (i) { return ownInvested(db, i) / i.cost.heldDays; }),
      expiry: expiryList(db, now), empties: emptyList(db),
      food: foodStats(db), catSpend: catSpend
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
    findCategory: findCategory, lifeL2: lifeL2,
    ownInvested: ownInvested, totalInvested: totalInvested, calcItemCost: calcItemCost,
    autoWearMap: autoWearMap, totalWearCount: totalWearCount, itemsWithComputed: itemsWithComputed,
    logSum: logSum, appendUsageLog: appendUsageLog, removeUsageLogEntry: removeUsageLogEntry,
    lifeStatus: lifeStatus, expiryList: expiryList, emptyList: emptyList, foodStats: foodStats,
    summary: summary, lastWearDate: lastWearDate,
    validateItem: validateItem, validateFood: validateFood
  };
})();
