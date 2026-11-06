/* storage.js — 本地数据服务客户端 v3（多账号） */
window.Storage = (function () {
  const U = window.Utils;
  const M = window.Models;

  let db = null;
  let session = null; // {accounts, lastAccountId, dataRoot}
  const listeners = [];
  const accountChangeListeners = []; // 账号切换成功后的钩子（A3：模块筛选/搜索/排序状态统一重置）

  function onChange(fn) { listeners.push(fn); }
  function onAccountChange(fn) { accountChangeListeners.push(fn); }
  function emit() {
    const ref = db;
    listeners.forEach(function (fn) { try { fn(ref); } catch (e) { console.error(e); } });
  }
  function getDB() { return db; }
  function getSession() { return session; }
  function accId() {
    return (db && db.account && db.account.id) || (session && session.lastAccountId) || 'me';
  }

  async function api(path, opts) {
    const r = await fetch(path, opts);
    if (!r.ok) {
      // 服务端错误文案透传（如 409「账号已删除或已切换」），让 toast 能提示用户怎么办
      let msg = '';
      try {
        const out = await r.json();
        msg = out && out.error ? String(out.error) : '';
      } catch (e) { /* 非 JSON 错误体忽略 */ }
      throw new Error(msg || ('数据服务错误 ' + r.status));
    }
    return r;
  }

  // load_db 读取侧体检提示（坏文件隔离/脏元素剔除）：toast 提醒一次，防静默丢数据
  const warnedMsgs = {};
  function notifyWarnings(list) {
    if (!list || !list.length) return;
    const UI = window.UI;
    if (!UI || !UI.toast) return;
    list.slice(0, 3).forEach(function (m) {
      const key = String(m || '');
      if (!key || warnedMsgs[key]) return;
      warnedMsgs[key] = 1;
      UI.toast(key, 'error');
    });
  }

  /* ---------- 会话 / 账号 ---------- */
  async function loadSession() {
    const r = await api('/api/session');
    session = await r.json();
    return session;
  }

  async function createAccount(name, icon) {
    const r = await api('/api/account', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', name: name, icon: icon })
    });
    const out = await r.json();
    if (!out.ok) throw new Error(out.error || '创建失败');
    session.accounts = out.accounts;
    return out.account;
  }

  async function updateAccount(id, name, icon) {
    const r = await api('/api/account', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rename', id: id, name: name, icon: icon })
    });
    const out = await r.json();
    if (!out.ok) throw new Error(out.error || '修改失败');
    session.accounts = out.accounts;
    return out.accounts;
  }

  async function deleteAccount(id, purge) {
    const r = await api('/api/account', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: id, purge: purge })
    });
    const out = await r.json();
    if (!out.ok) throw new Error(out.error || '删除失败');
    session.accounts = out.accounts;
    // 删除的是当前登录账号：停止会话——清内存 db 并重载 /api/session，
    // 防止旧会话继续保存把已删数据目录写活（目录复活）；调用方据此回到账号选择屏
    const curId = (db && db.account && db.account.id) || '';
    if (curId === id) {
      db = null;
      if (session) session.lastAccountId = '';
      await loadSession().catch(function () {});
      if (session) session.lastAccountId = '';
    }
    return out.accounts;
  }

  async function selectAccount(id) {
    await api('/api/account', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'select', id: id })
    });
    if (session) session.lastAccountId = id;
    await loadAll(id);
    // 账号切换成功：通知钩子重置各模块的筛选/搜索/排序状态（A3），防上一账号的状态残留
    accountChangeListeners.forEach(function (fn) { try { fn(id); } catch (e) { console.error(e); } });
    return db;
  }

  async function setDataRoot(path, move) {
    const r = await api('/api/data-root', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path, move: move })
    });
    const out = await r.json();
    if (!out.ok) throw new Error(out.error || '设置失败');
    if (session) session.dataRoot = out.dataRoot;
    return out.dataRoot;
  }

  /* ---------- 数据读写 ---------- */
  async function loadAll(forceAcc) {
    const useAcc = forceAcc || accId();
    const r = await api('/api/db?acc=' + encodeURIComponent(useAcc));
    const raw = await r.json();
    db = {
      version: raw.schemaVersion || 3,
      account: raw.account,
      accounts: raw.accounts,
      items: raw.items || [],
      outfits: raw.outfits || [],
      food: raw.food || [],
      events: raw.events || [],
      categories: raw.categories || M.defaultCategories(),
      settings: Object.assign(M.defaultSettings(), raw.settings || {}),
      wallet: Object.assign({
        bills: [], accounts: [], cats: { expense: [], income: [] }, tags: [], imports: [],
        // templates 兜底：服务端未下发（旧 exe）时必须是数组，否则 persist 会把 undefined 洗成 [] 毁掉已存模板
        templates: [], balances: []
      }, raw.wallet || {}),
      dataRoot: raw.dataRoot || ''
    };
    // 钱袋分类兜底：服务端未下发（旧 exe 未重编译）时用前端主流记账分类树，保证记账可用
    if (!db.wallet.cats || !db.wallet.cats.expense || !db.wallet.cats.expense.length) {
      db.wallet.cats = M.defaultWalletCats();
    }
    if (!db.wallet.accounts || !db.wallet.accounts.length) {
      db.wallet.accounts = [
        { id: 'ac_cash', name: '现金', icon: 'banknote', type: 'cash', balance: 0, note: '' },
        { id: 'ac_wechat', name: '微信', icon: 'message-circle', type: 'wallet', balance: 0, note: '' },
        { id: 'ac_alipay', name: '支付宝', icon: 'smartphone', type: 'wallet', balance: 0, note: '' },
        { id: 'ac_bank', name: '银行卡', icon: 'credit-card', type: 'bank', balance: 0, note: '' },
        { id: 'ac_other', name: '其他', icon: 'wallet', type: 'other', balance: 0, note: '' }
      ];
    }
    if (!db.wallet.syncMap) {
      db.wallet.syncMap = {
        w_shop_digital: 'digital', w_shop_clothing: 'clothing', w_shop_watch: 'clothing',
        w_shop_beauty: 'life', w_shop_appliance: 'life', w_shop_home: 'life'
      };
    }
    notifyWarnings(raw.warnings); // 服务端读取侧体检提示（坏文件已隔离等）
    emit();
    return db;
  }

  async function persist(scope) {
    if (!db) return;
    const acc = accId();
    const jobs = [];
    const push = function (target, data) {
      jobs.push(api('/api/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: target, data: data, acc: acc })
      }));
    };
    if (!scope || scope === 'items') push('items', db.items);
    if (!scope || scope === 'outfits') push('outfits', db.outfits);
    if (!scope || scope === 'food') push('food', db.food);
    if (!scope || scope === 'events') push('events', db.events);
    if (!scope || scope === 'settings') {
      jobs.push(api('/api/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'settings', acc: acc, data: { settings: db.settings, categories: db.categories } })
      }));
    }
    if (!scope || scope === 'wallet') {
      push('wallet', {
        bills: db.wallet.bills, accounts: db.wallet.accounts, cats: db.wallet.cats,
        tags: db.wallet.tags, imports: db.wallet.imports,
        balances: db.wallet.balances || [],
        templates: db.wallet.templates || [],
        catsVersion: db.wallet.catsVersion || 2
      });
    }
    const results = await Promise.all(jobs);
    for (const r of results) {
      const out = await r.json();
      // 服务端 error 文案透传（如 409 账号已删除），toast 才能提示到点上
      if (!out.ok) throw new Error(out.error || '保存失败');
    }
    emit();
  }

  /* ---------- 图片：压缩 / 裁切结果上传 ---------- */
  async function compressImage(file, maxSide, quality) {
    maxSide = maxSide || 1280;
    quality = quality || 0.82;
    const bitmap = await createImageBitmap(file);
    let w = bitmap.width, h = bitmap.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    w = Math.round(w * scale); h = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise(function (res) { canvas.toBlob(res, 'image/webp', quality); });
    return blob || file;
  }

  async function uploadBlob(blob, filename) {
    const fd = new FormData();
    fd.append('file', blob, filename || 'img.webp');
    const r = await api('/api/upload?acc=' + encodeURIComponent(accId()), { method: 'POST', body: fd });
    const out = await r.json();
    if (!out.ok) throw new Error(out.error || '上传失败');
    return out.path;
  }

  async function saveImage(file) {
    const blob = await compressImage(file);
    return uploadBlob(blob, (file.name || 'img') + '.webp');
  }

  async function saveImages(files) {
    const paths = [];
    for (const f of files) paths.push(await saveImage(f));
    return paths;
  }

  function getImageURL(path) {
    if (!path) return Promise.resolve('');
    if (path.indexOf('data:') === 0 || path.indexOf('http') === 0 || path.indexOf('blob:') === 0) {
      return Promise.resolve(path);
    }
    const p = path.replace(/^images\//, '');
    return Promise.resolve('/api/images/' + encodeURIComponent(accId()) + '/' + encodeURIComponent(p));
  }

  /* ---------- 备份 ---------- */
  async function exportBackup() {
    await persist();
    const r = await api('/api/backup?acc=' + encodeURIComponent(accId()));
    const blob = await r.blob();
    const name = 'lovelife-backup-' + U.todayStr() + '.tar.gz';
    U.download(blob, name);
    return name;
  }

  async function importBackup(file) {
    const r = await api('/api/restore?acc=' + encodeURIComponent(accId()), { method: 'POST', body: file });
    const out = await r.json();
    if (!out.ok) throw new Error(out.error || '恢复失败');
    await loadAll();
    return true;
  }

  /* ---------- 业务操作 ---------- */
  function saveItem(item) {
    const idx = db.items.findIndex(function (i) { return i.id === item.id; });
    // 新分类体系盖章：防止服务端旧数据迁移把新建物品的分类当旧分类重写（v1.0.9 修复）
    item.taxonomy = 2;
    item.updatedAt = new Date().toISOString();
    // 使用周期截止（v1.1.0）：状态非在用 → 记截止日（日均成本/吃灰等使用类指标从此冻结）；
    // 切回在用 → 恢复计时。幂等写法：只看当前状态，不依赖旧值（调用方可能直接改原对象）
    if (item.status !== 'in_use') {
      item.retiredAt = item.retiredAt || item.soldDate || U.todayStr();
    } else if (item.retiredAt) {
      delete item.retiredAt;
    }
    if (idx >= 0) db.items[idx] = item;
    else {
      item.createdAt = item.createdAt || new Date().toISOString();
      db.items.push(item);
    }
    return persist('items');
  }

  function removeItem(id) {
    const gone = db.items.find(function (i) { return i.id === id; });
    db.items = db.items.filter(function (i) { return i.id !== id; });
    db.outfits.forEach(function (o) {
      o.itemIds = (o.itemIds || []).filter(function (x) { return x !== id; });
      o.cosmeticIds = (o.cosmeticIds || []).filter(function (x) { return x !== id; });
      if (o.cosmeticQty) delete o.cosmeticQty[id];
    });
    db.events = db.events.filter(function (e) { return e.itemId !== id; });
    // 子物品的父引用置空（防 parentItemId 悬空）
    db.items.forEach(function (i) {
      if (i.parentItemId === id) delete i.parentItemId;
    });
    // 组合（妆容/穿搭 look）成员引用同步摘除（settings 里的组合成员，P1-3c 级联）
    if (db.settings) {
      ['makeupLooks', 'outfitLooks'].forEach(function (k) {
        (db.settings[k] || []).forEach(function (c) {
          if (c && Array.isArray(c.itemIds)) {
            c.itemIds = c.itemIds.filter(function (x) { return x !== id; });
          }
        });
      });
    }
    // 钱袋账单解除关联（账单本身保留，只是不再指向这个物品）
    if (db.wallet) {
      db.wallet.bills.forEach(function (b) {
        if (b.itemId !== id) return;
        delete b.itemId;
        // 用户删掉了该账单自动生成的词条 = 不要这条同步，记 syncOff 防编辑账单时复活
        if (gone && gone.fromBill === b.id) b.syncOff = true;
      });
    }
    return Promise.all([persist('items'), persist('outfits'), persist('events'),
      persist('settings'), persist('wallet')]);
  }

  /* 妆品使用次数（v1.0.9）：打卡可带 cosmeticQty {id: 次数}；旧记录无该字段视为 1 次
     map 含该键即以 clamp(0..99) 后的值为准（0 = 勾了但未使用），键缺失才回退 */
  function cosQtyOf(rec, cid) {
    const map = (rec && rec.cosmeticQty) || {};
    if (Object.prototype.hasOwnProperty.call(map, cid)) {
      const q = Math.floor(Number(map[cid]));
      return isNaN(q) ? 0 : Math.min(99, Math.max(0, q));
    }
    return ((rec && rec.cosmeticIds) || []).indexOf(cid) >= 0 ? 1 : 0;
  }

  /* 旧流水（无 refId）兜底匹配：必须日期非空且备注精确等于该打卡的流水说明——
     不能用 indexOf 子串匹配（同日多条打卡会删错别条；空日期恒真会误删任意一条） */
  function legacyLogMatches(l, outfit) {
    return !l.refId && outfit.date && l.note === '穿搭打卡 ' + outfit.date;
  }

  function saveOutfit(outfit) {
    const idx = db.outfits.findIndex(function (o) { return o.id === outfit.id; });
    const isNew = idx < 0;
    const oldRec = isNew ? null : db.outfits[idx];
    if (!isNew) db.outfits[idx] = outfit;
    else db.outfits.push(outfit);
    // 妆品使用次数：按次数记流水；增/减/改次数统一"撤销旧流水 + 记新流水"，始终一条流水/每件/每次打卡
    const oldIds = (oldRec && oldRec.cosmeticIds) || [];
    const newIds = outfit.cosmeticIds || [];
    const all = newIds.slice();
    oldIds.forEach(function (cid) { if (all.indexOf(cid) < 0) all.push(cid); });
    let touched = false;
    all.forEach(function (cid) {
      const oldQ = oldRec ? cosQtyOf(oldRec, cid) : 0;
      const newQ = cosQtyOf(outfit, cid);
      if (oldQ === newQ) return;
      const it = db.items.find(function (i) { return i.id === cid; });
      if (!it) return;
      if (oldQ > 0) {
        // 精确撤销该打卡旧流水（按 refId 锚定，老数据按精确备注+日期兜底）
        const log = (it.usageLog || []).find(function (l) {
          return l.source === 'outfit' && (l.refId === outfit.id || legacyLogMatches(l, outfit));
        });
        if (log) M.removeUsageLogEntry(it, log.id);
      }
      if (newQ > 0) M.appendUsageLog(it, newQ, 'outfit', '穿搭打卡 ' + (outfit.date || ''), outfit.id, outfit.date || '');
      touched = true;
    });
    return touched ? Promise.all([persist('outfits'), persist('items')]) : persist('outfits');
  }

  function removeOutfit(id) {
    const o = db.outfits.find(function (x) { return x.id === id; });
    // 撤销该次打卡带来的化妆品使用次数（流水按次数记账，移除即整条撤销）
    if (o && (o.cosmeticIds || []).length) {
      o.cosmeticIds.forEach(function (cid) {
        const it = db.items.find(function (i) { return i.id === cid; });
        if (!it) return;
        // 精确匹配 refId，老数据按精确备注+日期兜底
        const logIdx = (it.usageLog || []).findIndex(function (l) {
          return l.source === 'outfit' && (l.refId === o.id || legacyLogMatches(l, o));
        });
        if (logIdx >= 0) M.removeUsageLogEntry(it, it.usageLog[logIdx].id);
        else if (!(it.usageLog || []).length && Number(it.useCount) > 0) {
          // 仅对完全没有流水记录的老数据兜底扣减；
          // 有流水但匹配不到 = 用户已手动删过该条，不能再扣（防双扣）
          it.useCount = Math.max(0, Number(it.useCount) - cosQtyOf(o, cid));
        }
      });
    }
    db.outfits = db.outfits.filter(function (x) { return x.id !== id; });
    return Promise.all([persist('outfits'), persist('items')]);
  }

  function saveFood(rec) {
    const idx = db.food.findIndex(function (f) { return f.id === rec.id; });
    if (idx >= 0) db.food[idx] = rec;
    else db.food.push(rec);
    return persist('food');
  }

  function removeFood(id) {
    const gone = db.food.find(function (f) { return f.id === id; });
    db.food = db.food.filter(function (f) { return f.id !== id; });
    // 账单侧解除美食引用（防止悬空 foodId 影响合并口径）
    db.wallet.bills.forEach(function (b) {
      if (b.foodId !== id) return;
      delete b.foodId;
      // 用户删掉了该账单自动生成的美食 = 不要这条同步，记 syncOff 防编辑账单时复活
      if (gone && gone.fromBill === b.id) b.syncOff = true;
    });
    return Promise.all([persist('food'), persist('wallet')]);
  }

  function saveEvent(ev) {
    const idx = db.events.findIndex(function (e) { return e.id === ev.id; });
    if (idx >= 0) db.events[idx] = ev;
    else db.events.push(ev);
    return persist('events');
  }

  function removeEvent(id) {
    db.events = db.events.filter(function (e) { return e.id !== id; });
    return persist('events');
  }

  /* ---------- 钱袋（记账 v1.1.0） ---------- */
  function wallet() { return db.wallet; }

  // 账单对账户余额的影响：支出减、收入加、转账在两账户间移动。
  // 「不区分账户」（accountId 为空）的账单照常入账/统计/同步词条，但不动任何账户余额（用户拍板）。
  // sign=+1 应用，-1 回滚（编辑/删除账单时先回滚旧值再套新值）。
  function applyBillToBalance(bill, sign) {
    const s = sign >= 0 ? 1 : -1;
    const amt = Math.abs(Number(bill.amount) || 0);
    const find = function (id) {
      return (db.wallet.accounts || []).find(function (a) { return a.id === id; });
    };
    if (bill.type === 'transfer') {
      // 转账必须双侧账户都在（P0-4）：任一侧缺失/为空则两侧都不动——
      // 单边生效 = 凭空造钱（只加不减）或吞钱（只减不加）
      const from = bill.accountId ? find(bill.accountId) : null;
      const to = bill.toAccountId ? find(bill.toAccountId) : null;
      if (!from || !to) {
        console.warn('[lovelife] 转账单边账户缺失，已跳过余额调整', bill.id, bill.accountId, bill.toAccountId);
        return;
      }
      from.balance = (Number(from.balance) || 0) - s * amt;
      to.balance = (Number(to.balance) || 0) + s * amt;
    } else if (bill.accountId) {
      const acc = find(bill.accountId);
      if (acc) acc.balance = (Number(acc.balance) || 0) + (bill.type === 'income' ? s * amt : -s * amt);
    }
  }

  // 账单入内存（余额 + 词条/美食同步）；persist 由调用方统一执行（批量导入只发 3 个请求）
  function _applyBillMemory(bill, prev, idx) {
    const explicitItemId = bill.itemId; // 调用方显式指定关联（如新建物品勾"同时记账"）
    if (idx >= 0) {
      applyBillToBalance(db.wallet.bills[idx], -1);
      bill.createdAt = db.wallet.bills[idx].createdAt || bill.createdAt;
      // syncOff（解除关联/删过同步记录的记忆）随账单本体继承：
      // 编辑表单重建 rec 时可能丢该字段，漏继承会让同步"自动复活"（口径禁止）
      if (!bill.syncOff && db.wallet.bills[idx].syncOff) bill.syncOff = true;
      db.wallet.bills[idx] = bill;
    } else {
      bill.createdAt = bill.createdAt || new Date().toISOString();
      db.wallet.bills.push(bill);
    }
    applyBillToBalance(bill, 1);

    // 词条同步：编辑时**就地更新**原词条（保留图片/使用记录/评分等用户补充数据），
    // 绝不删除重建；名字变了也只改名。仅当账单不再命中同步时才解绑/按规则清理。
    const prevItem = prev && prev.itemId ? db.items.find(function (i) { return i.id === prev.itemId; }) : null;
    const prevFood = prev && prev.foodId ? db.food.find(function (f) { return f.id === prev.foodId; }) : null;
    delete bill.itemId;
    delete bill.foodId;

    const domain = syncKindOfBill(bill);
    if (bill.syncOff && !explicitItemId) {
      // 用户解除过关联/删除过同步词条：不再自动同步（可手动关联回来）
      if (prevItem) autoCleanupItemForBill({ id: bill.id, itemId: prevItem.id });
      if (prevFood) autoCleanupFoodForBill({ id: bill.id, foodId: prevFood.id });
    } else if (bill.type === 'expense' && domain && prevItem && prevItem.fromBill === bill.id) {
      const nm = billSyncName(bill);
      if (prevItem.name !== nm) prevItem.name = nm;
      prevItem.linkedBillIds = prevItem.linkedBillIds || [];
      if (prevItem.linkedBillIds.indexOf(bill.id) < 0) prevItem.linkedBillIds.push(bill.id);
      bill.itemId = prevItem.id;
      recalcItemFromBills(prevItem);
    } else {
      if (prevItem) autoCleanupItemForBill({ id: bill.id, itemId: prevItem.id });
      if (idx < 0 && explicitItemId) {
        const it = db.items.find(function (i) { return i.id === explicitItemId; });
        if (it) {
          delete bill.syncOff; // 显式关联回来即恢复同步
          bill.itemId = it.id;
          it.linkedBillIds = it.linkedBillIds || [];
          if (it.linkedBillIds.indexOf(bill.id) < 0) it.linkedBillIds.push(bill.id);
          if (it.fromBill) recalcItemFromBills(it);
          else {
            if (it.purchasePrice == null || it.purchasePrice === '') it.purchasePrice = Number(bill.amount) || 0;
            if (!it.purchaseDate) it.purchaseDate = bill.date;
          }
        }
      } else {
        autoSyncItemFromBill(bill);
      }
    }

    const isMeal = bill.syncOff ? null : MEAL_BY_CAT[bill.subCatId || bill.catId];
    // 二手回血：「二手闲置」收入按名称关联合品，自动回填售出价/售出日（回血率计算链路现成）
    // 同名多个词条时跳过（P2-10）：唯一命中才回填，防误改别件的状态/售出价
    if (bill.type === 'income' && (bill.subCatId === 'w_in_resale' || bill.catId === 'w_in_resale')) {
      const nm = billSyncName(bill);
      const hits = (db.items || []).filter(function (i) { return i.name === nm; });
      if (hits.length === 1) {
        const soldItem = hits[0];
        soldItem.soldPrice = Number(bill.amount) || soldItem.soldPrice;
        soldItem.soldDate = bill.date;
        soldItem.status = 'sold';
        soldItem.taxonomy = 2;
        soldItem.linkedBillIds = soldItem.linkedBillIds || [];
        if (soldItem.linkedBillIds.indexOf(bill.id) < 0) soldItem.linkedBillIds.push(bill.id);
        bill.itemId = soldItem.id;
      } else if (hits.length > 1) {
        console.warn('[lovelife] 二手回血：同名词条 ' + hits.length + ' 个，跳过售出回填以免误改', nm);
      }
    }
    if (bill.type === 'expense' && isMeal && prevFood && prevFood.fromBill === bill.id) {
      prevFood.linkedBillIds = prevFood.linkedBillIds || [];
      if (prevFood.linkedBillIds.indexOf(bill.id) < 0) prevFood.linkedBillIds.push(bill.id);
      bill.foodId = prevFood.id;
      // 账单备注变更 → 美食名称跟随（与物品侧同口径，A7）
      const foodName = billSyncName(bill);
      if (prevFood.name !== foodName) prevFood.name = foodName;
      // 价格默认=关联账单合计；用户改过（priceManual）则保留，不被账单静默改写（A7，与物品侧同口径）
      if (!prevFood.priceManual) {
        const fBills = db.wallet.bills.filter(function (b) { return b.foodId === prevFood.id; });
        prevFood.price = Math.round(fBills.reduce(function (s, b) {
          return s + Math.abs(Number(b.amount) || 0);
        }, 0) * 100) / 100;
      }
    } else {
      if (prevFood) autoCleanupFoodForBill({ id: bill.id, foodId: prevFood.id });
      autoSyncFoodFromBill(bill);
    }
  }

  function _persistWalletAll() {
    return Promise.all([persist('wallet'), persist('items'), persist('food')]);
  }

  function saveBill(bill) {
    if (!bill.id) bill.id = U.uid();
    const idx = db.wallet.bills.findIndex(function (b) { return b.id === bill.id; });
    const prev = idx >= 0 ? JSON.parse(JSON.stringify(db.wallet.bills[idx])) : null;
    _applyBillMemory(bill, prev, idx);
    return _persistWalletAll().catch(function (err) {
      // 持久化失败 → 从盘整体重载回滚全部内存副作用（词条/美食/余额/账单都可能被改过，
      // 逐项手撤必然漏；磁盘是未成功的旧态，重载即一致），再把错误抛回给调用方 toast
      return loadAll().catch(function () {}).then(function () { throw err; });
    });
  }

  // 批量入库（导入用）：内存全量应用后统一持久化，千笔导入只发 3 个请求
  function saveBills(list) {
    (list || []).forEach(function (bill) {
      if (!bill.id) bill.id = U.uid();
      const idx = db.wallet.bills.findIndex(function (b) { return b.id === bill.id; });
      _applyBillMemory(bill, idx >= 0 ? db.wallet.bills[idx] : null, idx);
    });
    return _persistWalletAll().catch(function (err) {
      // 失败同样整体重载回滚（批次 billIds 由调用方先记录全量，失败也可追溯/整批撤销）
      return loadAll().catch(function () {}).then(function () { throw err; });
    });
  }

  function removeBill(id) {
    const bill = db.wallet.bills.find(function (b) { return b.id === id; });
    if (bill) {
      applyBillToBalance(bill, -1);
      // 词条同步：自动生成的词条/美食随账单删除；合并/手动建的只解绑
      autoCleanupItemForBill(bill);
      autoCleanupFoodForBill(bill);
    }
    db.wallet.bills = db.wallet.bills.filter(function (b) { return b.id !== id; });
    return Promise.all([persist('wallet'), persist('items'), persist('food')]);
  }

  function saveWalletAccount(acc) {
    const list = db.wallet.accounts;
    const idx = list.findIndex(function (a) { return a.id === acc.id; });
    if (idx >= 0) list[idx] = acc;
    else { acc.id = acc.id || U.uid(); list.push(acc); }
    return persist('wallet');
  }

  function removeWalletAccount(id) {
    // 有流水的账户不允许直接删，防止余额悬空（调用方负责提示）
    const used = db.wallet.bills.some(function (b) {
      return b.accountId === id || b.toAccountId === id;
    });
    if (used) return Promise.reject(new Error('该账户已有流水，请先转移或删除相关账单'));
    db.wallet.accounts = db.wallet.accounts.filter(function (a) { return a.id !== id; });
    // 同步清理该账户的余额快照（不留孤儿引用）
    db.wallet.balances = (db.wallet.balances || []).filter(function (r) { return r.accountId !== id; });
    // 模板引用该账户的字段置空（模板保留，P2-11）
    (db.wallet.templates || []).forEach(function (t) {
      if (t && t.accountId === id) t.accountId = '';
    });
    return persist('wallet');
  }

  function saveWalletCat(node, kind) {
    const list = db.wallet.cats[kind] || (db.wallet.cats[kind] = []);
    const idx = list.findIndex(function (c) { return c.id === node.id; });
    if (idx >= 0) list[idx] = node;
    else { node.id = node.id || U.uid(); list.push(node); }
    return persist('wallet');
  }

  function removeWalletCat(id, kind) {
    const list = db.wallet.cats[kind] || [];
    const used = db.wallet.bills.some(function (b) {
      return b.catId === id || b.subCatId === id;
    });
    if (used) return Promise.reject(new Error('该分类已被账单使用，无法删除'));
    const strip = function (nodes) {
      return nodes.filter(function (c) { return c.id !== id; })
        .map(function (c) {
          if (c.children) c.children = strip(c.children);
          return c;
        });
    };
    db.wallet.cats[kind] = strip(list);
    // 模板引用该分类的字段置空（模板保留，P2-11）；一级被删时二级必悬空，一并置空
    (db.wallet.templates || []).forEach(function (t) {
      if (!t) return;
      if (t.catId === id) { t.catId = ''; t.subCatId = ''; }
      else if (t.subCatId === id) { t.subCatId = ''; }
    });
    return persist('wallet');
  }

  function saveWalletTag(tag) {
    const list = db.wallet.tags;
    const idx = list.findIndex(function (t) { return t.id === tag.id; });
    if (idx >= 0) list[idx] = tag;
    else { tag.id = tag.id || U.uid(); list.push(tag); }
    return persist('wallet');
  }

  function removeWalletTag(id) {
    db.wallet.tags = db.wallet.tags.filter(function (t) { return t.id !== id; });
    db.wallet.bills.forEach(function (b) {
      if (b.tagIds) b.tagIds = b.tagIds.filter(function (x) { return x !== id; });
    });
    return persist('wallet');
  }

  function saveImportBatch(batch) {
    if (!batch.id) batch.id = U.uid();
    const list = db.wallet.imports;
    const idx = list.findIndex(function (x) { return x.id === batch.id; });
    if (idx >= 0) list[idx] = batch;
    else list.push(batch);
    return persist('wallet');
  }

  // 撤销一次导入：删除该批次账单、回滚余额，并清理自动同步的词条/美食（不留孤儿）
  function revertImport(batchId) {
    const batch = db.wallet.imports.find(function (x) { return x.id === batchId; });
    const ids = (batch && Array.isArray(batch.billIds)) ? batch.billIds : [];
    ids.forEach(function (id) {
      // 失败批次可能有 billIds 从未落盘：不存在的 id 容错跳过（不误伤别的账单）
      const bill = db.wallet.bills.find(function (b) { return b && b.id === id; });
      if (!bill) return;
      applyBillToBalance(bill, -1);
      autoCleanupItemForBill(bill);
      autoCleanupFoodForBill(bill);
    });
    db.wallet.bills = db.wallet.bills.filter(function (b) { return ids.indexOf(b.id) < 0; });
    db.wallet.imports = db.wallet.imports.filter(function (x) { return x.id !== batchId; });
    return Promise.all([persist('wallet'), persist('items'), persist('food')]);
  }

  /* ---------- 词条同步：账单 → 物品（全自动，零操作） ----------
     规则：记账命中同步分类（手机数码/服饰运动/配饰腕表/个护美妆/生活电器/日常家居）
     → 自动在对应模块生成/合并词条；账单是金融语义权威源（金额/日期以账单为准）。
     「词条有差异」由映射解决：记账叫「手机数码」→ 数码域归入「主机类」等子类。 */
  function syncKindOfBill(bill) {
    const map = (db.wallet && db.wallet.syncMap) || {};
    return map[bill.subCatId] || map[bill.catId] || null;
  }

  function billsOfItem(itemId) {
    return db.wallet.bills.filter(function (b) { return b.itemId === itemId; });
  }

  // 词条名 → 物品子类（关键词匹配分类树，匹配不到归「其他」）
  // 常见商品别名：英文品名也能归对类（"iPhone 17"→手机、"iPad"→平板）
  const CAT_ALIASES = [
    [/iphone|华为|mate\s?\d|小米\s?\d|redmi|oppo|vivo|三星|galaxy|pixel/i, '手机'],
    [/ipad|平板|pad\s?air|pad\s?pro/i, '平板'],
    [/macbook|thinkpad|拯救者|游戏本/i, '笔记本'],
    [/airpods|耳机|earbuds|buds|音箱|sound/i, '耳机'],
    [/相机|sony|a7|富士|fuji|leica|镜头/i, '相机'],
    [/switch|ps5|ps4|xbox|steam\s?deck/i, '掌机'],
    [/手表|watch|手环|band/i, '手表'],
    [/口红|唇釉|粉底|眼影|腮红|睫毛|散粉|气垫/i, '彩妆'],
    [/面霜|乳液|精华|爽肤水|洁面|防晒|眼霜|面膜/i, '护肤'],
    [/t恤|衬衫|外套|大衣|羽绒|卫衣|毛衣/i, 'T恤'],
    [/裤|牛仔|短裤|西裤/i, '西裤'],
    [/鞋|sneaker|nike|adidas|aj/i, '鞋']
  ];

  function guessItemCat(kind, name) {
    const tree = (db.categories && db.categories[kind]) || [];
    const n = String(name || '');
    // 别名表优先（英文品名 → 中文子类名），再走子类名包含匹配（只正向，防"表"误命中"手表"）
    let alias = '';
    CAT_ALIASES.forEach(function (pair) {
      if (!alias && pair[0].test(n)) alias = pair[1];
    });
    const hitName = alias || n;
    for (let i = 0; i < tree.length; i++) {
      const l1 = tree[i];
      const ch = l1.children || [];
      for (let j = 0; j < ch.length; j++) {
        if (ch[j].name && hitName.indexOf(ch[j].name) >= 0 && ch[j].name.length >= 2) {
          return { l1: l1.id, l2: ch[j].id };
        }
      }
      if (alias && l1.name && hitName.indexOf(l1.name) >= 0) return { l1: l1.id, l2: '' };
    }
    for (let i = 0; i < tree.length; i++) {
      const ch = tree[i].children || [];
      for (let j = 0; j < ch.length; j++) {
        if (/其他/.test(ch[j].name || '')) return { l1: tree[i].id, l2: ch[j].id };
      }
    }
    return { l1: tree[0] ? tree[0].id : '', l2: '' };
  }

  /* ================= 词条自动同步（记账 → 物品 / 美食）=================
     规则（v1.2.0 重写）：
     - 命中同步分类 → 自动生成/合并词条，全自动零操作
     - 编辑账单**就地更新**原词条（保留图片/使用记录等用户补充数据），绝不删除重建
     - 自动生成词条的金额 = 关联账单合计（分次付款不丢账），日期 = 最早账单；
       手动建档的词条不被账单覆盖金额/日期（仅补空字段），防止配件账单撞名压价
     - 删除账单：仅当词条由该账单生成且无其他账单关联时才删，否则只解绑 */

  const SYNC_ITEM_KIND = { digital: 'device', clothing: 'clothing', life: 'life' };

  // 词条名：备注优先；没写备注用分类名（记了就同步，不静默跳过）
  function billSyncName(bill) {
    let name = String(bill.note || '').trim();
    if (name) return name;
    const cats = (db.wallet && db.wallet.cats) || {};
    let catName = '';
    ['expense', 'income'].forEach(function (k) {
      (cats[k] || []).forEach(function (c) {
        if (c.id === (bill.subCatId || bill.catId)) catName = catName || c.name;
        (c.children || []).forEach(function (ch) {
          if (ch.id === (bill.subCatId || bill.catId)) catName = catName || ch.name;
        });
      });
    });
    return catName || '未命名';
  }

  // 自动生成词条的金额/日期按关联账单重算（合计金额 + 最早日期）
  function recalcItemFromBills(item) {
    if (!item || !item.fromBill) return; // 手动物品金额/日期不被账单改写
    const bills = db.wallet.bills.filter(function (b) { return b.itemId === item.id; });
    if (!bills.length) return;
    item.purchasePrice = Math.round(bills.reduce(function (s, b) {
      return s + Math.abs(Number(b.amount) || 0);
    }, 0) * 100) / 100;
    item.purchaseDate = bills.map(function (b) { return b.date || ''; }).filter(Boolean).sort()[0] || item.purchaseDate;
    item.updatedAt = new Date().toISOString();
  }

  function autoSyncItemFromBill(bill) {
    const domain = syncKindOfBill(bill);
    if (!domain || bill.type !== 'expense') return null;
    const kind = SYNC_ITEM_KIND[domain] || domain;
    const name = billSyncName(bill);
    // 同域同名词条 → 合并（词条唯一）；数码域兼容 device/game/digital 三种历史 kind
    const sameKind = function (ik) {
      if (domain === 'digital') return ik === 'device' || ik === 'game' || ik === 'digital';
      return ik === kind;
    };
    let item = (db.items || []).find(function (i) {
      return sameKind(i.kind) && i.name === name;
    });
    if (item) {
      item.taxonomy = 2;
      item.linkedBillIds = item.linkedBillIds || [];
      if (item.linkedBillIds.indexOf(bill.id) < 0) item.linkedBillIds.push(bill.id);
      bill.itemId = item.id; // 先挂关联再重算（否则合计里漏掉本笔）
      if (item.fromBill) {
        recalcItemFromBills(item); // 自动生成词条：金额=关联账单合计、日期=最早
      } else {
        // 手动建档词条：仅补空字段，不覆盖用户填的金额/日期（防配件账单撞名压价）
        if (item.purchasePrice == null || item.purchasePrice === '') item.purchasePrice = Number(bill.amount) || 0;
        if (!item.purchaseDate) item.purchaseDate = bill.date;
        item.updatedAt = new Date().toISOString();
      }
    } else {
      const cat = guessItemCat(domain, name); // 分类树按域键查（categories.digital）
      item = {
        id: U.uid(), kind: kind,
        categoryId: cat.l1, subCategoryId: cat.l2,
        name: name,
        purchaseDate: bill.date, purchasePrice: Number(bill.amount) || 0,
        channel: bill.accountName || '',
        status: 'in_use', images: [], tags: [],
        linkedBillIds: [bill.id], fromBill: bill.id,
        taxonomy: 2,
        createdAt: new Date().toISOString()
      };
      db.items.push(item);
    }
    bill.itemId = item.id;
    return item;
  }

  /* 美食同步（v1.1.0）：正餐账单 → 美食日历条目（零食/酒水/生鲜不进，用户拍板"只同步正餐"） */
  const MEAL_BY_CAT = {
    w_food_breakfast: '早餐', w_food_lunch: '午餐', w_food_dinner: '晚餐', w_food_treat: '加餐'
  };

  function autoSyncFoodFromBill(bill) {
    if (bill.syncOff) return null; // 解除关联/删过同步美食：防自动复活（与词条侧同口径）
    const cat = bill.subCatId || bill.catId;
    const meal = MEAL_BY_CAT[cat];
    if (!meal || bill.type !== 'expense') return null;
    let name = String(bill.note || '').trim();
    if (!name) {
      // 备注为空用子类名（与物品词条同规则）
      const cats = (db.wallet && db.wallet.cats) || {};
      (cats.expense || []).forEach(function (c) {
        (c.children || []).forEach(function (ch) {
          if (ch.id === cat) name = name || ch.name;
        });
      });
      name = name || meal;
    }
    // 同日同名合并（一顿饭一条）；自动生成条目金额=关联账单合计
    let rec = (db.food || []).find(function (f) {
      return f.date === bill.date && f.name === name;
    });
    if (rec) {
      rec.linkedBillIds = rec.linkedBillIds || [];
      if (rec.linkedBillIds.indexOf(bill.id) < 0) rec.linkedBillIds.push(bill.id);
      if (rec.fromBill) {
        // 价格默认=关联账单合计；用户改过（priceManual）则保留（A7）
        if (!rec.priceManual) {
          const bills = db.wallet.bills.filter(function (b) { return b.foodId === rec.id; });
          bills.push(bill);
          rec.price = Math.round(bills.reduce(function (s, b) { return s + Math.abs(Number(b.amount) || 0); }, 0) * 100) / 100;
        }
      } else if (rec.price == null || rec.price === '') {
        rec.price = Number(bill.amount) || 0;
      }
    } else {
      rec = {
        id: U.uid(), date: bill.date, meal: meal,
        // 菜系预填「其他」（甲1）：账单来源没有菜系概念，空值会被编辑器"菜系必填"卡住，
        // 补评分/图片永远存不上；预填「其他」最稳，手动新建仍必填
        foodCuisine: '其他', foodType: '', name: name,
        price: Number(bill.amount) || 0, note: '', tags: [], images: [],
        linkedBillIds: [bill.id], fromBill: bill.id
      };
      db.food.push(rec);
    }
    bill.foodId = rec.id;
    return rec;
  }

  // 同步解绑/清理（删除或不再命中的账单）：仅当记录由该账单生成且无其他关联时才删，
  // 否则只解绑；来源移交最早关联账单（防止编辑/删除"首笔账单"毁掉用户补充的数据）
  function detachSync(rec, listName, billId, idKey) {
    if (!rec) return;
    const others = (rec.linkedBillIds || []).filter(function (x) { return x !== billId; });
    if (rec.fromBill === billId && others.length === 0) {
      db[listName] = db[listName].filter(function (r) { return r.id !== rec.id; });
      // 记住"用户不要这条同步"，编辑账单时不再复活重建
      db.wallet.bills.forEach(function (b) {
        if (b.id === billId) b.syncOff = true;
      });
    } else {
      rec.linkedBillIds = others;
      if (rec.fromBill === billId) {
        rec.fromBill = others[0] || '';
        if (!rec.fromBill) delete rec.fromBill;
        if (idKey === 'itemId') recalcItemFromBills(rec);
      }
    }
  }

  function autoCleanupFoodForBill(bill) {
    if (!bill || !bill.foodId) return;
    const rec = db.food.find(function (f) { return f.id === bill.foodId; });
    detachSync(rec, 'food', bill.id, 'foodId');
    delete bill.foodId;
  }

  function autoCleanupItemForBill(bill) {
    if (!bill || !bill.itemId) return;
    const item = db.items.find(function (i) { return i.id === bill.itemId; });
    detachSync(item, 'items', bill.id, 'itemId');
    delete bill.itemId;
  }

  /* ---------- 账户余额记录（快照）：记录某个时间点各账户的余额，与流水倒推曲线互补 ---------- */
  function saveBalanceRecord(rec) {
    if (!rec.id) rec.id = U.uid();
    const list = db.wallet.balances || (db.wallet.balances = []);
    const idx = list.findIndex(function (r) { return r.id === rec.id; });
    if (idx >= 0) list[idx] = rec;
    else list.push(rec);
    return persist('wallet');
  }

  // 多账户批量快照（v1.1.2）：一次记录多个账户的余额（同批次同日期）
  function saveBalanceRecords(recs) {
    const list = db.wallet.balances || (db.wallet.balances = []);
    const batchId = U.uid();
    (recs || []).forEach(function (rec) {
      if (!rec.id) rec.id = U.uid();
      rec.batchId = rec.batchId || batchId;
      const idx = list.findIndex(function (r) { return r.id === rec.id; });
      if (idx >= 0) list[idx] = rec;
      else list.push(rec);
    });
    return persist('wallet');
  }

  function removeBalanceRecord(id) {
    db.wallet.balances = (db.wallet.balances || []).filter(function (r) { return r.id !== id; });
    return persist('wallet');
  }

  /* 数据体检（v1.2.0）：修复悬空关联/孤儿同步记录，报告修复数量
     v1.1.3 口径：修引用但绝不删用户真实记录内容（置空/摘引用可以）；
     删行仅限真孤儿（fromBill 指向已删账单且无其他关联的自动建档记录）。
     步骤顺序：先清洗引用 → 再判孤儿 → 孤儿剔除后再清一遍引用 → 余额快照。 */
  function repairData() {
    let fixed = 0;
    const warnings = [];
    const itemIds = {};
    db.items.forEach(function (i) { if (i && i.id) itemIds[i.id] = true; });
    const foodIds = {};
    db.food.forEach(function (f) { if (f && f.id) foodIds[f.id] = true; });
    const billIds = {};
    db.wallet.bills.forEach(function (b) { if (b && b.id) billIds[b.id] = true; });
    const accIds = {};
    (db.wallet.accounts || []).forEach(function (a) { if (a && a.id) accIds[a.id] = true; });

    // ---- 清洗悬空引用（只摘引用，不删记录本体） ----
    function cleanRefs() {
      // 账单 → 词条/美食：悬空解除
      db.wallet.bills.forEach(function (b) {
        if (b.itemId && !itemIds[b.itemId]) { delete b.itemId; fixed++; }
        if (b.foodId && !foodIds[b.foodId]) { delete b.foodId; fixed++; }
        // 账单指向已删账户：置空（不删账单）；转账双侧口径由 applyBillToBalance 兜底
        if (b.accountId && !accIds[b.accountId]) { b.accountId = ''; fixed++; }
        if (b.toAccountId && !accIds[b.toAccountId]) { b.toAccountId = ''; fixed++; }
      });
      // 词条/美食 linkedBillIds 悬空 → 摘除
      [db.items, db.food].forEach(function (list) {
        list.forEach(function (r) {
          if (!r || !Array.isArray(r.linkedBillIds)) return;
          const before = r.linkedBillIds.length;
          r.linkedBillIds = r.linkedBillIds.filter(function (x) { return billIds[x]; });
          if (r.linkedBillIds.length !== before) fixed++;
        });
      });
      // 词条 parentItemId 悬空 → 置空
      db.items.forEach(function (i) {
        if (i && i.parentItemId && !itemIds[i.parentItemId]) { delete i.parentItemId; fixed++; }
      });
      // 穿搭打卡 itemIds/cosmeticIds/cosmeticQty 悬空 → 摘除
      db.outfits.forEach(function (o) {
        if (!o) return;
        ['itemIds', 'cosmeticIds'].forEach(function (k) {
          if (!Array.isArray(o[k])) return;
          const before = o[k].length;
          o[k] = o[k].filter(function (x) { return itemIds[x]; });
          if (o[k].length !== before) fixed++;
        });
        if (o.cosmeticQty && typeof o.cosmeticQty === 'object') {
          Object.keys(o.cosmeticQty).forEach(function (cid) {
            if (!itemIds[cid]) { delete o.cosmeticQty[cid]; fixed++; }
          });
        }
      });
      // 事件 itemId 悬空 → 置空（事件本体保留）
      db.events.forEach(function (e) {
        if (e && e.itemId && !itemIds[e.itemId]) { delete e.itemId; fixed++; }
      });
      // 组合（妆容/穿搭 look）成员悬空 → 摘除
      ['makeupLooks', 'outfitLooks'].forEach(function (k) {
        (db.settings && db.settings[k] || []).forEach(function (c) {
          if (!c || !Array.isArray(c.itemIds)) return;
          const before = c.itemIds.length;
          c.itemIds = c.itemIds.filter(function (x) { return itemIds[x]; });
          if (c.itemIds.length !== before) fixed++;
        });
      });
      // 导入批次 billIds 悬空 → 摘除
      (db.wallet.imports || []).forEach(function (im) {
        if (!im || !Array.isArray(im.billIds)) return;
        const before = im.billIds.length;
        im.billIds = im.billIds.filter(function (x) { return billIds[x]; });
        if (im.billIds.length !== before) fixed++;
      });
    }
    cleanRefs(); // 先清洗引用再判孤儿（否则 linkedBillIds 里的死引用会让真孤儿漏判）
    // 自动同步的孤儿记录（来源账单已不存在且无其他关联）→ 清理（既有语义：真孤儿才删）
    db.items = db.items.filter(function (i) {
      if (i.fromBill && !billIds[i.fromBill] && !(i.linkedBillIds || []).length) { fixed++; return false; }
      return true;
    });
    db.food = db.food.filter(function (f) {
      if (f.fromBill && !billIds[f.fromBill] && !(f.linkedBillIds || []).length) { fixed++; return false; }
      return true;
    });
    cleanRefs(); // 孤儿剔除可能产生新的悬空引用（如打卡/账单还指着被清的词条），再清一遍

    // ---- 停用物品补记停用时间（甲11，v1.1.6 数据体检）----
    // v1.1.0 前停用的物品从未补写 retiredAt，useEndDate 走 now 兜底导致「共使用 X 天」每天还在涨。
    // 回填规则：status ∈ 闲置/借出/待出闲置/损坏报废/已售出/已转赠 且无 retiredAt 的物品，
    // retiredAt = 最近使用记录日期（usageLog 最大 date）|| updatedAt（ISO 取日期部分）|| purchaseDate || 今天。
    // 只在 repairData（数据体检）触发；自动保存路径（saveItem）维持既有口径不变。幂等：补过就不再动。
    const RETIRED_STATUS = { idle: 1, borrowed: 1, to_sell: 1, broken: 1, sold: 1, gifted: 1 };
    const dateRe = /^\d{4}-\d{2}-\d{2}/;
    let backfilled = 0;
    db.items.forEach(function (i) {
      if (!i || i.retiredAt || !RETIRED_STATUS[i.status]) return;
      let d = '';
      (i.usageLog || []).forEach(function (l) {
        const ld = l && l.date && dateRe.test(String(l.date)) ? String(l.date).slice(0, 10) : '';
        if (ld && ld > d) d = ld;
      });
      if (!d && i.updatedAt && dateRe.test(String(i.updatedAt))) d = String(i.updatedAt).slice(0, 10);
      if (!d && i.purchaseDate && dateRe.test(String(i.purchaseDate))) d = String(i.purchaseDate).slice(0, 10);
      if (!d) d = U.todayStr();
      i.retiredAt = d;
      backfilled++;
    });
    if (backfilled) warnings.push('已为 ' + backfilled + ' 件停用物品补记停用时间');

    // ---- 余额快照 ----
    // 无 accountId 的旧余额记录（v1.1.2 前的数据）不是孤儿，绝不删：
    // 只有一个账户时回填它；多账户保留原样并计 warnings
    let legacy = 0;
    const onlyAcc = (db.wallet.accounts || []).length === 1 ? db.wallet.accounts[0].id : '';
    const kept = [];
    (db.wallet.balances || []).forEach(function (r) {
      if (!r || !r.accountId) {
        if (r) {
          if (onlyAcc) { r.accountId = onlyAcc; fixed++; }
          else legacy++;
          kept.push(r);
        }
      } else if (accIds[r.accountId]) {
        kept.push(r);
      } else {
        fixed++; // 指向已删账户的孤儿快照才删
      }
    });
    db.wallet.balances = kept;
    if (legacy) warnings.push('有 ' + legacy + ' 条旧余额记录未关联账户（多账户无法自动归属，已保留原样）');
    if (warnings.length) notifyWarnings(warnings);
    return Promise.all([persist('items'), persist('food'), persist('wallet')]).then(function () {
      return { fixed: fixed, warnings: warnings };
    });
  }

  /* 模板账单（v1.2.0）：常用固定开支一键填充（房租/话费/健身卡等） */
  function saveBillTemplate(tpl) {
    if (!tpl.id) tpl.id = U.uid();
    const list = db.wallet.templates || (db.wallet.templates = []);
    const idx = list.findIndex(function (t) { return t.id === tpl.id; });
    if (idx >= 0) list[idx] = tpl;
    else list.push(tpl);
    return persist('wallet');
  }

  function removeBillTemplate(id) {
    db.wallet.templates = (db.wallet.templates || []).filter(function (t) { return t.id !== id; });
    return persist('wallet');
  }

  // 解除账单的词条同步（用户手动断开；syncOff 后编辑不再自动复活）
  // keepRec=true（「解除关联」入口，A6）：只解绑不删词条——词条保留并转手动维护
  // （fromBill 摘除，此后任何路径都不得触发删除）；keepRec 省略=既有语义
  // （自动生成且无其他关联的词条随同步删除），与 v113 回归锁口径一致
  function unlinkBillSync(billId, keepRec) {
    const bill = db.wallet.bills.find(function (b) { return b.id === billId; });
    if (!bill) return Promise.resolve();
    bill.syncOff = true;
    if (keepRec) {
      const item = bill.itemId ? db.items.find(function (i) { return i.id === bill.itemId; }) : null;
      const food = bill.foodId ? db.food.find(function (f) { return f.id === bill.foodId; }) : null;
      [item, food].forEach(function (rec) {
        if (!rec) return;
        rec.linkedBillIds = (rec.linkedBillIds || []).filter(function (x) { return x !== billId; });
        if (rec.fromBill === billId) delete rec.fromBill;
      });
    } else {
      autoCleanupItemForBill({ id: billId, itemId: bill.itemId });
      autoCleanupFoodForBill({ id: billId, foodId: bill.foodId });
    }
    delete bill.itemId;
    delete bill.foodId;
    return Promise.all([persist('wallet'), persist('items'), persist('food')]);
  }

  /* 物品 → 账单（v1.1.2）：已有词条一键生成购入账单并双向关联（词条同步的反向链路） */
  function addBillFromItem(item) {
    if (!item) return Promise.reject(new Error('物品不存在'));
    // 已有购入（支出）账单则不重复生成；二手回血收入账单不算购入，不能误挡补记（P2-9）
    const exists = db.wallet.bills.find(function (b) {
      return b.itemId === item.id && b.type === 'expense';
    });
    if (exists) return Promise.reject(new Error('该物品已有购入账单'));
    const kindMap = { device: 'w_shop_digital', game: 'w_shop_digital', clothing: 'w_shop_clothing', life: 'w_shop_beauty' };
    const bill = {
      id: U.uid(), type: 'expense',
      amount: Math.abs(Number(item.purchasePrice) || 0),
      date: item.purchaseDate || U.todayStr(), time: '',
      catId: 'w_shop', subCatId: kindMap[item.kind] || 'w_shop_other',
      accountId: '', note: item.name || '',
      tagIds: [], itemId: item.id, source: 'manual',
      createdAt: new Date().toISOString()
    };
    return saveBill(bill).then(function () {
      // saveBill 的自动同步会挂关联；手动物品只补空字段不覆盖金额——补记场景强制对齐物品
      const it = db.items.find(function (i) { return i.id === item.id; });
      if (it) {
        if (!it.purchasePrice) it.purchasePrice = bill.amount;
        if (!it.purchaseDate) it.purchaseDate = bill.date;
      }
      return Promise.all([persist('items')]).then(function () { return bill; });
    });
  }

  function saveSettings() { return persist('settings'); }

  function resetAll() {
    db.items = []; db.outfits = []; db.food = []; db.events = [];
    db.settings = M.defaultSettings();
    // 钱袋一并清空（账单/账户/余额记录/导入批次），与"清空当前账号数据"语义一致
    db.wallet = {
      bills: [], accounts: [], cats: M.defaultWalletCats(), tags: [], imports: [],
      balances: [], syncMap: db.wallet && db.wallet.syncMap, catsVersion: 2
    };
    return persist();
  }

  return {
    loadSession: loadSession, getSession: getSession,
    createAccount: createAccount, updateAccount: updateAccount,
    deleteAccount: deleteAccount, selectAccount: selectAccount,
    setDataRoot: setDataRoot, accId: accId,
    getDB: getDB, onChange: onChange, onAccountChange: onAccountChange,
    loadAll: loadAll, persist: persist,
    uploadBlob: uploadBlob, saveImages: saveImages, saveImage: saveImage,
    compressImage: compressImage, getImageURL: getImageURL,
    exportBackup: exportBackup, importBackup: importBackup,
    saveItem: saveItem, removeItem: removeItem,
    saveOutfit: saveOutfit, removeOutfit: removeOutfit,
    saveFood: saveFood, removeFood: removeFood,
    saveEvent: saveEvent, removeEvent: removeEvent,
    /* 钱袋 */
    wallet: wallet, saveBill: saveBill, saveBills: saveBills, removeBill: removeBill,
    saveWalletAccount: saveWalletAccount, removeWalletAccount: removeWalletAccount,
    saveWalletCat: saveWalletCat, removeWalletCat: removeWalletCat,
    saveWalletTag: saveWalletTag, removeWalletTag: removeWalletTag,
    saveImportBatch: saveImportBatch, revertImport: revertImport,
    saveBillTemplate: saveBillTemplate, removeBillTemplate: removeBillTemplate,
    unlinkBillSync: unlinkBillSync, addBillFromItem: addBillFromItem,
    /* 词条同步（自动） */
    syncKindOfBill: syncKindOfBill, billsOfItem: billsOfItem,
    autoSyncItemFromBill: autoSyncItemFromBill, guessItemCat: guessItemCat,
    /* 账户余额记录 */
    saveBalanceRecord: saveBalanceRecord, saveBalanceRecords: saveBalanceRecords,
    removeBalanceRecord: removeBalanceRecord,
    repairData: repairData,
    saveSettings: saveSettings, resetAll: resetAll
  };
})();
