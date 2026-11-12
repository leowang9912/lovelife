/* storage.js — 本地数据服务客户端 v3（多账号） */
window.Storage = (function () {
  const U = window.Utils;
  const M = window.Models;

  let db = null;
  let session = null; // {accounts, lastAccountId, dataRoot}
  const listeners = [];
  const accountChangeListeners = []; // 账号切换成功后的钩子（A3：模块筛选/搜索/排序状态统一重置）
  // 双向同步防环标志位（v1.1.7）：账单→词条（_applyBillMemory）与词条→账单（syncItemToBills/syncFoodToBills）
  // 嵌套触发只走一层——正/反向同步期间的任何再入保存不再触发对向回写
  let _biSyncing = false;

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
      habits: normHabits(raw.habits),
      todos: raw.todos && typeof raw.todos === 'object' ? raw.todos : { defs: [], done: {} },
      timeline: normTimeline(raw.timeline),
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

  /* ---------- 保存队列（v1.1.9 防并发竞态） ----------
     /api/save 全部经 FIFO 队列串行发送：同一时刻只有一个在途，后来的排队——
     快速连点不再产生乱序在途请求（磁盘短暂回退旧值）；单个失败不卡死队列，后续照常发。
     请求体在入队时快照（persist 调用瞬间），发送顺序=入队顺序=内存改动顺序 */
  const saveQueue = [];
  let saveSending = false;
  function enqueueSave(opts) {
    return new Promise(function (resolve, reject) {
      saveQueue.push({ opts: opts, resolve: resolve, reject: reject });
      drainSaveQueue();
    });
  }
  function drainSaveQueue() {
    if (saveSending) return;
    const job = saveQueue.shift();
    if (!job) return;
    saveSending = true;
    api('/api/save', job.opts).then(job.resolve, job.reject).then(function () {
      // 成败都放行下一单：失败不卡死队列
      saveSending = false;
      drainSaveQueue();
    });
  }

  async function persist(scope) {
    if (!db) return;
    const acc = accId();
    const jobs = [];
    const push = function (target, data) {
      jobs.push({
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: target, data: data, acc: acc })
      });
    };
    if (!scope || scope === 'items') push('items', db.items);
    if (!scope || scope === 'outfits') push('outfits', db.outfits);
    if (!scope || scope === 'food') push('food', db.food);
    if (!scope || scope === 'events') push('events', db.events);
    // habits 域载荷过滤（v1.1.9 拍板 5）：预设建议（__seed）不落盘，只写被交互转正的 def
    if (!scope || scope === 'habits') push('habits', habitsPayload());
    // todos 域（v1.2.0 稽核修复）：此前漏 push 导致 persist('todos') 空转假成功、重启全丢
    if (!scope || scope === 'todos') push('todos', { defs: (db.todos || {}).defs || [], done: (db.todos || {}).done || {} });
    // timeline 域（v1.2.01 时间日历）：时间段 + 记录类时间点 + 自定义类型 + 计时器
    if (!scope || scope === 'timeline') {
      const tl = db.timeline || {};
      push('timeline', {
        blocks: tl.blocks || [], points: tl.points || [],
        types: tl.types || [], timer: tl.timer || null
      });
    }
    if (!scope || scope === 'settings') {
      jobs.push({
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'settings', acc: acc, data: { settings: db.settings, categories: db.categories } })
      });
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
    const results = await Promise.all(jobs.map(enqueueSave));
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
    const prevRec = idx >= 0 ? db.items[idx] : null; // 反向同步基线（调用方可能直接改原对象时与 item 同引用，见 syncItemToBills）
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
    // 词条 → 账单反向同步（v1.1.7）：名称/购入金额/购入日期真实变化才回写关联购入账单
    const billTouched = prevRec ? syncItemToBills(item, prevRec) : false;
    return billTouched ? Promise.all([persist('items'), persist('wallet')]) : persist('items');
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
    const prevRec = idx >= 0 ? db.food[idx] : null; // 反向同步基线（与 saveItem 同口径）
    if (idx >= 0) db.food[idx] = rec;
    else db.food.push(rec);
    // 词条 → 账单反向同步（v1.1.7）：名称/价格/日期真实变化才回写关联正餐账单
    const billTouched = prevRec ? syncFoodToBills(rec, prevRec) : false;
    return billTouched ? Promise.all([persist('food'), persist('wallet')]) : persist('food');
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

  /* ---------- 热力打卡（habits 域，v1.1.7） ----------
     数据：db.habits = { defs: [{id, name, color, type, max, showNum}], log: { habitId: { 'YYYY-MM-DD': true|n } } }
     - 日期键 = U.todayStr() 口径的 'YYYY-MM-DD'（本地零点）
     - **二值习惯**（type='check'，默认）：有键=已打卡（值 true/1）
     - **计数习惯**（type='count'，v1.1.5 梯度式）：值=正整数次数（如喝水 3 次）；
       max=满色阈值（默认 5）；showNum=格子中心显示次数（默认 true）
     - 可补打/编辑过去的日子：setHabitCount 直接设定历史键次数
     - 预设三例（运动/阅读/早睡）= 内存建议（__seed 标记，见 ensureHabitSeeds），不落盘 */
  const HABIT_COLORS = [
    '#aecbfa', '#d7aefb', '#b7e1c1', '#fbd2a7',
    '#f6b8d0', '#a8e0e8', '#f7e6a1', '#f2b3b3'
  ];
  const HABIT_PRESETS = ['运动', '阅读', '早睡'];

  function habits() { return db.habits; }

  /* 预设 id（固定 hb_preset_0..2） */
  function isPresetId(id) { return /^hb_preset_[0-2]$/.test(String(id || '')); }

  /* 预设播种（主页热力卡/统计页 habitHeat 共用，v1.1.9 拍板 5/6）：
     **纯内存零副作用**——只把建议塞进 db.habits.defs（带 __seed 标记），绝不落盘。
     落盘过滤见 habitsPayload：只有被交互转正（去 __seed）的 def 才写盘。
     播种条件（逐条补，与 habitSeeded 墓碑口径一致）：
     - habitSeeded（删光标记）= 用户主动清空 → 不再播种（既有口径）
     - 账号已有自建习惯（defs 含非预设 id）→ 不播种（建议只服务空账号）
     - 预设 id 不在 defs、不在 settings.habitPresetGone（删除墓碑）→ 播为建议 */
  function ensureHabitSeeds() {
    const h = db.habits || (db.habits = { defs: [], log: {} });
    const s = db.settings || {};
    if (s.habitSeeded) return h.defs;
    if (h.defs.some(function (d) { return d && !isPresetId(d.id); })) return h.defs;
    const gone = Array.isArray(s.habitPresetGone) ? s.habitPresetGone : [];
    HABIT_PRESETS.forEach(function (n, i) {
      const id = 'hb_preset_' + i;
      if (h.defs.some(function (d) { return d && d.id === id; })) return;
      if (gone.indexOf(id) >= 0) return;
      h.defs.push({ id: id, name: n, color: HABIT_COLORS[i % HABIT_COLORS.length], __seed: true });
    });
    return h.defs;
  }

  /* 被交互的预设转正（只动被交互的那条）：去掉 __seed 标记，随本次写入落盘。
     返回被转正的 def（供落盘失败时还原建议态），非建议返回 null */
  function materializeHabit(habitId) {
    const defs = ((db.habits || {}).defs) || [];
    for (let i = 0; i < defs.length; i++) {
      if (defs[i] && defs[i].id === habitId && defs[i].__seed) { delete defs[i].__seed; return defs[i]; }
    }
    return null;
  }

  /* 落盘载荷：过滤预设建议（__seed）——未交互的预设永远只在内存（拍板 5） */
  function habitsPayload() {
    const h = db.habits || { defs: [], log: {} };
    return {
      defs: (h.defs || []).filter(function (d) { return d && !d.__seed; }),
      log: h.log || {}
    };
  }

  /* 结构兜底（loadAll/各操作共用，与服务端 _sanitize_habits 同语义）：
     缺省 {defs:[],log:{}}；defs 归一 type/max/showNum；log 值归一 true→1、正整数保留 */
  function normHabits(raw) {
    const out = { defs: [], log: {} };
    if (!raw || typeof raw !== 'object') return out;
    if (Array.isArray(raw.defs)) {
      raw.defs.forEach(function (d) {
        if (d && typeof d === 'object' && typeof d.id === 'string' && d.id) {
          const def = d;
          if (def.__seed) delete def.__seed; // 建议标记不入盘（防御：落盘侧已过滤）
          if (def.type !== 'check' && def.type !== 'count') def.type = 'check';
          if (!(Number(def.max) > 0)) def.max = 5;
          if (def.showNum == null) def.showNum = true;
          out.defs.push(def);
        }
      });
    }
    if (raw.log && typeof raw.log === 'object' && !Array.isArray(raw.log)) {
      Object.keys(raw.log).forEach(function (hid) {
        const m = raw.log[hid];
        if (hid && m && typeof m === 'object' && !Array.isArray(m)) {
          const map = {};
          Object.keys(m).forEach(function (k) {
            const v = m[k];
            // true（二值打卡）与 ≥1 整数（计数）保留原值；0/负/非法剔除
            const ok = v === true || (typeof v === 'number' && isFinite(v) && Math.floor(v) >= 1);
            if (ok && /^\d{4}-\d{2}-\d{2}$/.test(k)) map[k] = v === true ? true : Math.floor(v);
          });
          out.log[hid] = map;
        }
      });
    }
    return out;
  }

  /* 梯度色（计数习惯）：n/max 线性映射深浅（1 次最浅 → max 次满色），返回 #rrggbb。
     底色=#f2f2f4（未打卡浅灰），与习惯色 srgb 线性插值；
     颜色容错：#abc 正确展开为 #aabbcc；非法颜色回落色池首色（不产出 NaN 脏样式） */
  function habitColorScale(color, n, max) {
    const m = Math.max(1, Number(max) || 5);
    const t = Math.min(1, Math.max(0, (Number(n) || 0) / m));
    const pct = 0.35 + 0.65 * t; // 1/max 也至少 35% 深度，满色 100%
    const parseHex = function (s) {
      let v = String(s == null ? '' : s).replace('#', '');
      if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2]; // #abc → #aabbcc
      if (!/^[0-9a-fA-F]{6}$/.test(v)) return null;
      return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
    };
    const bg = [242, 242, 244]; // #f2f2f4
    const fg = parseHex(color) || parseHex(HABIT_COLORS[0]);
    const mix = fg.map(function (f, i) { return Math.round(bg[i] + (f - bg[i]) * pct); });
    return '#' + mix.map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  /* 保存/更新习惯定义（新增自动补 id；无颜色时从 8 色池按序循环取）。
     落盘失败回滚内存改动（按写入对象身份判断，防覆盖并发新写），保持 UI/内存/磁盘一致 */
  function saveHabitDef(def) {
    const h = db.habits || (db.habits = { defs: [], log: {} });
    if (!def.id) def.id = U.uid();
    if (def.__seed) delete def.__seed; // 编辑/保存=被交互 → 该条转正随本次落盘（拍板 5）
    const idx = h.defs.findIndex(function (d) { return d.id === def.id; });
    const prev = idx >= 0 ? h.defs[idx] : null;
    if (idx >= 0) h.defs[idx] = def;
    else {
      if (!def.color) def.color = HABIT_COLORS[h.defs.length % HABIT_COLORS.length];
      h.defs.push(def);
    }
    return persist('habits').catch(function (e) {
      const i = h.defs.findIndex(function (d) { return d === def; });
      if (i >= 0) {
        if (prev) h.defs[i] = prev;
        else h.defs.splice(i, 1);
      }
      throw e;
    });
  }

  /* 删除习惯：连带删除该习惯全部打卡记录（log[habitId]），不留孤儿。
     删光（defs 清空）= 用户主动清空：置 settings.habitSeeded 并落盘——
     「首次播种」只对真正的新账号生效，删光后重启不得被预设三例复活。
     预设墓碑（v1.1.9 拍板 5）：删除的预设 id 记 settings.habitPresetGone 并落盘——
     被删的预设（无论转正与否）重启后不得被播种复活；未交互的预设不受影响。
     落盘失败回滚 defs/log/标记 */
  function removeHabitDef(id) {
    const h = db.habits || (db.habits = { defs: [], log: {} });
    const idx = h.defs.findIndex(function (d) { return d.id === id; });
    const removed = idx >= 0 ? h.defs[idx] : null;
    const removedLog = h.log[id];
    h.defs = h.defs.filter(function (d) { return d.id !== id; });
    delete h.log[id];
    const cleared = !h.defs.length;
    const prevFlag = db.settings ? db.settings.habitSeeded : undefined;
    if (cleared && db.settings) db.settings.habitSeeded = true;
    let tombAdded = false, prevGone;
    if (isPresetId(id) && db.settings) {
      prevGone = Array.isArray(db.settings.habitPresetGone) ? db.settings.habitPresetGone.slice() : undefined;
      const gone = Array.isArray(db.settings.habitPresetGone) ? db.settings.habitPresetGone : (db.settings.habitPresetGone = []);
      if (gone.indexOf(id) < 0) { gone.push(id); tombAdded = true; }
    }
    const jobs = [persist('habits')];
    if ((cleared && prevFlag !== true) || tombAdded) jobs.push(persist('settings'));
    return Promise.all(jobs).catch(function (e) {
      if (removed) h.defs.splice(Math.min(idx, h.defs.length), 0, removed);
      if (removedLog) h.log[id] = removedLog;
      if (cleared && db.settings) db.settings.habitSeeded = prevFlag;
      if (tombAdded && db.settings) {
        if (prevGone) db.settings.habitPresetGone = prevGone;
        else delete db.settings.habitPresetGone;
      }
      throw e;
    });
  }

  /* 打/取消打卡（同键再点=取消）；补打过去的日子直接传历史 dateStr（YYYY-MM-DD）。
     二值语义写 true（countOf 读取时归 1）；计数习惯用 setHabitCount 写数字。
     落盘失败回滚本次写入（若期间未被再次修改），防「失败后刷新出幽灵打卡」 */
  function toggleHabit(habitId, dateStr) {
    const h = db.habits || (db.habits = { defs: [], log: {} });
    const seedDef = materializeHabit(habitId); // 打卡=被交互 → 仅该条预设建议转正随落盘（拍板 5）
    const key = dateStr || U.todayStr();
    const map = h.log[habitId] || (h.log[habitId] = {});
    const prev = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
    let wrote;
    if (map[key]) {
      delete map[key];
      wrote = undefined;
      if (!Object.keys(map).length) delete h.log[habitId]; // 空映射不落盘留孤儿键
    } else {
      map[key] = true;
      wrote = true;
    }
    return persist('habits').then(function (r) {
      // v1.2.0 双向联动：习惯打卡 ↔ 勾选「同步到习惯打卡」的待办
      const sync = syncTodoFromHabit(habitId, key, wrote === true);
      return sync ? sync.then(function () { return r; }) : r;
    }).catch(function (e) {
      const m2 = h.log[habitId];
      const cur = m2 ? m2[key] : undefined;
      if (cur === wrote) { // 期间被再次修改则不回滚（后续写入有自己的成败）
        if (wrote === undefined) {
          if (m2) { m2[key] = prev; if (!Object.keys(m2).length) delete h.log[habitId]; }
        } else if (m2) {
          delete m2[key];
          if (!Object.keys(m2).length) delete h.log[habitId];
        }
      }
      // 落盘失败：本次交互未生效则还原建议态（仅当该习惯已无任何打卡记录）
      if (seedDef && !(h.log[habitId] && Object.keys(h.log[habitId]).length)) seedDef.__seed = true;
      throw e;
    });
  }

  /* 计数习惯（v1.1.5 梯度式）：直接设定某日次数；n<=0 清除该日（=未打卡）。
     落盘失败回滚本次写入（同 toggleHabit 口径） */
  function setHabitCount(habitId, dateStr, n) {
    const h = db.habits || (db.habits = { defs: [], log: {} });
    const seedDef = materializeHabit(habitId); // 计次=被交互 → 仅该条预设建议转正随落盘（拍板 5）
    const key = dateStr || U.todayStr();
    const map = h.log[habitId] || (h.log[habitId] = {});
    const prev = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
    const v = Math.floor(Number(n) || 0);
    const wrote = v > 0 ? v : undefined;
    if (v > 0) map[key] = v;
    else {
      delete map[key];
      if (!Object.keys(map).length) delete h.log[habitId];
    }
    return persist('habits').then(function (r) {
      // v1.2.0 双向联动：计数习惯打卡 ↔ 关联待办（toggleHabit 之外的另一入口）
      const sync = syncTodoFromHabit(habitId, key, wrote > 0);
      return sync ? sync.then(function () { return r; }) : r;
    }).catch(function (e) {
      const m2 = h.log[habitId];
      const cur = m2 ? m2[key] : undefined;
      if (cur === wrote) {
        if (wrote === undefined) {
          if (m2) { m2[key] = prev; if (!Object.keys(m2).length) delete h.log[habitId]; }
        } else if (m2) {
          if (prev === undefined) delete m2[key];
          else m2[key] = prev;
          if (!Object.keys(m2).length) delete h.log[habitId];
        }
      }
      // 落盘失败：本次交互未生效则还原建议态（仅当该习惯已无任何打卡记录）
      if (seedDef && !(h.log[habitId] && Object.keys(h.log[habitId]).length)) seedDef.__seed = true;
      throw e;
    });
  }

  /* 某日打卡次数（二值习惯=0/1；计数习惯=次数） */
  function habitCountOf(habitId, dateStr) {
    const v = ((db.habits || {}).log || {})[habitId] && ((db.habits || {}).log || {})[habitId][dateStr];
    return typeof v === 'number' ? v : (v ? 1 : 0);
  }

  /* 手动落盘整个 habits 域（与 saveSettings 同形；载荷经 habitsPayload 过滤 __seed 建议） */
  function saveHabits() { return persist('habits'); }

  /* ---------- 待办事项（todos 域，v1.2.0） ----------
     defs: {id,name,date:'YYYY-MM-DD'(起始/一次性),due:'HH:MM',
            repeat:'none'|'daily'|'weekly'|'monthly'|'ndays'|'workday',
            repeatOn:[0-6]周几数组|1-31号, interval:N, remindBefore:分钟(0=关),
            linkHabitId:'', createdAt, archived}
     done: { [defId]: { 'YYYY-MM-DD': { t: iso, s: 'done'|'skipped' } } } */
  function todoDef(id) {
    return ((db.todos || {}).defs || []).filter(function (d) { return d.id === id; })[0];
  }
  /* 该日是否到期（none=仅起始当天；循环=起始日起按规则；短月按月末夹紧） */
  function todoDueOn(def, dateStr) {
    if (!def || def.archived || !def.due) return false;
    const start = def.date || '';
    if (def.repeat === 'none') return dateStr === start;
    if (!start || dateStr < start) return false;
    // 循环截止（v1.2.2）：repeatUntil 当天后不再生成实例（历史/已完成保留——不删定义即可停）
    if (def.repeatUntil && dateStr > def.repeatUntil) return false;
    const p = String(dateStr).split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    const dow = (d.getDay() + 6) % 7; // 周一=0
    if (def.repeat === 'daily') return true;
    if (def.repeat === 'workday') return dow <= 4;
    if (def.repeat === 'weekly') return (def.repeatOn || []).indexOf(dow) >= 0;
    if (def.repeat === 'monthly') {
      const dim = new Date(p[0], p[1], 0).getDate();
      return p[2] === Math.min(Number(def.repeatOn) || 1, dim);
    }
    if (def.repeat === 'ndays') {
      const n = Number(def.interval) || 1;
      const s = String(start).split('-').map(Number);
      const diff = Math.round((d - new Date(s[0], s[1] - 1, s[2])) / 86400000);
      return n > 0 && diff >= 0 && diff % n === 0;
    }
    return false;
  }
  function todoStatus(defId, dateStr) {
    return ((((db.todos || {}).done || {})[defId] || {})[dateStr] || {}).s || '';
  }
  function todoNowStr(now) {
    now = now || new Date();
    return U.todayStr(now) + ' ' + String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0');
  }
  /* 标记完成/跳过（status='done'|'skipped'|''=恢复未决）；done 时联动习惯打卡 */
  function setTodoDone(defId, dateStr, status) {
    db.todos = db.todos || { defs: [], done: {} };
    const m = (db.todos.done = db.todos.done || {})[defId] = (db.todos.done || {})[defId] || {};
    if (!status) delete m[dateStr];
    else m[dateStr] = { t: new Date().toISOString(), s: status };
    const def = todoDef(defId);
    const jobs = [persist('todos')];
    if (def && def.linkHabitId && status === 'done') {
      db.habits = db.habits || { defs: [], log: {} };
      const lg = (db.habits.log = db.habits.log || {})[def.linkHabitId] = (db.habits.log || {})[def.linkHabitId] || {};
      lg[dateStr] = true;
      jobs.push(persist('habits'));
    }
    return Promise.all(jobs);
  }
  /* 习惯打卡 → 待办反向同步（双向联动，勾选「同步到习惯打卡」的待办） */
  function syncTodoFromHabit(habitId, dateStr, on) {
    const defs = ((db.todos || {}).defs || []).filter(function (d) {
      return d.linkHabitId === habitId && todoDueOn(d, dateStr);
    });
    if (!defs.length) return null;
    const doneMap = (db.todos.done = db.todos.done || {});
    defs.forEach(function (d) {
      const m = doneMap[d.id] = doneMap[d.id] || {};
      if (on) m[dateStr] = { t: new Date().toISOString(), s: 'done' };
      else if (m[dateStr] && m[dateStr].s === 'done') delete m[dateStr];
    });
    return persist('todos');
  }
  function saveTodoDef(def) {
    db.todos = db.todos || { defs: [], done: {} };
    const list = db.todos.defs = db.todos.defs || [];
    let hit = null;
    list.forEach(function (x) { if (x.id === def.id) hit = x; });
    if (hit) Object.assign(hit, def); else list.push(def);
    return persist('todos');
  }
  function removeTodoDef(id) {
    db.todos = db.todos || { defs: [], done: {} };
    db.todos.defs = (db.todos.defs || []).filter(function (d) { return d.id !== id; });
    if (db.todos.done) delete db.todos.done[id];
    return persist('todos');
  }
  /* 未决实例：近 7 天逾期 + 今天 + 未来 3 天（提前展示后续日期），按 逾期→优先级→时间 排序 */
  function todoOpenInstances(now) {
    now = now || new Date();
    const out = [];
    const nowStr = todoNowStr(now);
    const defs = (db.todos || {}).defs || [];
    const PRIO = { high: 0, mid: 1, low: 2 };
    for (let off = -3; off <= 7; off++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
      const ds = U.todayStr(d);
      defs.forEach(function (def) {
        if (!todoDueOn(def, ds) || todoStatus(def.id, ds)) return;
        out.push({
          def: def, dateStr: ds,
          overdue: (ds + ' ' + (def.due || '23:59')) < nowStr,
          future: ds > U.todayStr(now)
        });
      });
    }
    out.sort(function (a, b) {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      const pa = PRIO[a.def.priority] != null ? PRIO[a.def.priority] : 1;
      const pb = PRIO[b.def.priority] != null ? PRIO[b.def.priority] : 1;
      if (pa !== pb) return pa - pb;
      return (a.dateStr + a.def.due) < (b.dateStr + b.def.due) ? -1 : 1;
    });
    return out;
  }

  /* ===== 时间日历（timeline 域，v1.2.01）=====
     blocks = 时间段 [{id,date,start,end,typeId,note,linkHabitId,habitSynced,source}]
     points = 记录类时间点 [{id,date,time,name,note,linkHabitId,habitSynced}]（待办类时间点由 todos 派生，不双份存储）
     types  = 自定义类型 [{id,name,icon,color}]（默认模板首次自动补全）
     timer  = 计时器 {typeId,startedAt,note} | null（持久化，重启可续）
     习惯联动（综合联动）：linkHabitId 非空时保存=习惯 +1（计次）/置打卡（二值），
     删除回退；toggleHabit/setHabitCount 内部会再串待办联动 → 喝水类多入口统一计数 */
  const TIMELINE_DEFAULT_TYPES = [
    // 时间段类型（kind=block）
    { id: 'sleep', name: '睡觉', icon: 'moon', color: '#8e8e93', kind: 'block', linkHabitId: '' },
    { id: 'work', name: '专注工作', icon: 'trending-up', color: '#ff9500', kind: 'block', linkHabitId: '' },
    { id: 'study', name: '学习/阅读', icon: 'book-open', color: '#af52de', kind: 'block', linkHabitId: '' },
    { id: 'meeting', name: '开会/沟通', icon: 'messages-square', color: '#5856d6', kind: 'block', linkHabitId: '' },
    { id: 'commute', name: '通勤/交通', icon: 'car', color: '#34c759', kind: 'block', linkHabitId: '' },
    { id: 'meal', name: '吃饭', icon: 'utensils', color: '#ff6b00', kind: 'block', linkHabitId: '' },
    { id: 'sport', name: '运动/健身', icon: 'dumbbell', color: '#30b0c7', kind: 'block', linkHabitId: '' },
    { id: 'rest', name: '小憩/打盹', icon: 'coffee', color: '#5ac8fa', kind: 'block', linkHabitId: '' },
    { id: 'chores', name: '家务/事务', icon: 'list-todo', color: '#ffcc00', kind: 'block', linkHabitId: '' },
    { id: 'fun', name: '娱乐/刷手机', icon: 'smartphone', color: '#007aff', kind: 'block', linkHabitId: '' },
    { id: 'social', name: '社交', icon: 'users', color: '#ff2d55', kind: 'block', linkHabitId: '' },
    { id: 'other', name: '其他', icon: 'circle', color: '#aeaeb2', kind: 'block', linkHabitId: '' },
    // 时间点类型（kind=point）
    { id: 'pt_water', name: '喝水', icon: 'cup-soda', color: '#5ac8fa', kind: 'point', linkHabitId: '' },
    { id: 'pt_med', name: '吃药', icon: 'pill', color: '#ff2d55', kind: 'point', linkHabitId: '' },
    { id: 'pt_bp', name: '量血压', icon: 'heart-pulse', color: '#ff3b30', kind: 'point', linkHabitId: '' },
    { id: 'pt_rest', name: '站起来活动', icon: 'person-standing', color: '#34c759', kind: 'point', linkHabitId: '' }
  ];
  function normTimeline(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const tl = {
      blocks: Array.isArray(r.blocks) ? r.blocks.filter(function (b) { return b && typeof b === 'object'; }).map(function (b) {
        return {
          id: String(b.id || U.uid()), gid: String(b.gid || ''), date: String(b.date || ''),
          start: String(b.start || '00:00'), end: String(b.end || '00:00'),
          typeId: String(b.typeId || 'other'), note: String(b.note || ''),
          linkHabitId: String(b.linkHabitId || ''), habitSynced: !!b.habitSynced,
          source: b.source === 'timer' ? 'timer' : 'manual'
        };
      }) : [],
      points: Array.isArray(r.points) ? r.points.filter(function (p) { return p && typeof p === 'object'; }).map(function (p) {
        return {
          id: String(p.id || U.uid()), date: String(p.date || ''), time: String(p.time || '00:00'),
          typeId: String(p.typeId || 'pt_water'), name: String(p.name || '时间点'), note: String(p.note || ''),
          linkHabitId: String(p.linkHabitId || ''), habitSynced: !!p.habitSynced
        };
      }) : [],
      types: Array.isArray(r.types) && r.types.length ? r.types.filter(function (t) { return t && typeof t === 'object'; }).map(function (t) {
        return {
          id: String(t.id || U.uid()), name: String(t.name || '未命名'),
          icon: String(t.icon || 'circle'), color: String(t.color || '#aeaeb2'),
          // v1.2.01 两套类型：'block'=时间段 / 'point'=时间点；linkHabitId=类型固定关联打卡
          kind: t.kind === 'point' ? 'point' : 'block',
          linkHabitId: String(t.linkHabitId || '')
        };
      }) : TIMELINE_DEFAULT_TYPES.map(function (t) { return Object.assign({}, t); }),
      timer: (r.timer && typeof r.timer === 'object' && r.timer.startedAt) ? {
        typeId: String(r.timer.typeId || 'other'), startedAt: Number(r.timer.startedAt) || Date.now(),
        note: String(r.timer.note || '')
      } : null
    };
    return tl;
  }
  function timeline() { db.timeline = db.timeline || normTimeline(null); return db.timeline; }
  /* 习惯综合联动：on=true 记一次/置打卡；on=false 回退一次/清打卡。内部 syncTodoFromHabit 串待办 */
  function timelineHabitSync(habitId, dateStr, on) {
    if (!habitId) return Promise.resolve();
    const h = db.habits || (db.habits = { defs: [], log: {} });
    const def = (h.defs || []).filter(function (x) { return x.id === habitId; })[0];
    if (!def) return Promise.resolve();
    const n = habitCountOf(habitId, dateStr) || 0;
    if (def.type === 'count') {
      const nv = on ? n + 1 : Math.max(0, n - 1);
      return setHabitCount(habitId, dateStr, nv);
    }
    if (on && !n) return toggleHabit(habitId, dateStr);
    if (!on && n) return toggleHabit(habitId, dateStr);
    return Promise.resolve();
  }
  function saveTimelineBlock(bl) {
    const tl = timeline();
    bl = bl || {};
    const rec = {
      id: bl.id || U.uid(), gid: String(bl.gid || ''), date: String(bl.date || ''), start: String(bl.start || '00:00'),
      end: String(bl.end || '00:00'), typeId: String(bl.typeId || 'other'), note: String(bl.note || ''),
      linkHabitId: String(bl.linkHabitId || ''), habitSynced: !!bl.habitSynced,
      source: bl.source === 'timer' ? 'timer' : 'manual'
    };
    const i = tl.blocks.findIndex(function (x) { return x.id === rec.id; });
    const prev = i >= 0 ? tl.blocks[i] : null;
    // 习惯联动差分：关联变化时回退旧的、记新的（防重复计）
    const jobs = [];
    if (prev && prev.habitSynced && prev.linkHabitId && prev.linkHabitId !== rec.linkHabitId) {
      jobs.push(timelineHabitSync(prev.linkHabitId, prev.date, false));
      rec.habitSynced = false;
    }
    if (rec.linkHabitId && !rec.habitSynced) {
      rec.habitSynced = true;
      jobs.push(timelineHabitSync(rec.linkHabitId, rec.date, true));
    }
    if (!rec.linkHabitId) rec.habitSynced = false;
    const prevSnap = i >= 0 ? tl.blocks[i] : null;
    if (i >= 0) tl.blocks[i] = rec; else tl.blocks.push(rec);
    return Promise.all(jobs).then(function () { return persist('timeline'); }).then(function () { return rec; })
      .catch(function (e) {
        // 落盘失败回滚内存（同 toggleHabit 口径，v1.2.01 边界锁）：防"失败后刷新出幽灵记录"
        const cur = tl.blocks.findIndex(function (x) { return x.id === rec.id; });
        if (cur >= 0) {
          if (prevSnap) tl.blocks[cur] = prevSnap;
          else tl.blocks.splice(cur, 1);
        }
        if (rec.habitSynced && rec.linkHabitId) timelineHabitSync(rec.linkHabitId, rec.date, false);
        throw e;
      });
  }
  function removeTimelineBlock(id) {
    const tl = timeline();
    const i = tl.blocks.findIndex(function (x) { return x.id === id; });
    if (i < 0) return Promise.resolve();
    const rec = tl.blocks[i];
    tl.blocks.splice(i, 1);
    const job = rec.habitSynced && rec.linkHabitId ? timelineHabitSync(rec.linkHabitId, rec.date, false) : Promise.resolve();
    return job.then(function () { return persist('timeline'); }).catch(function (e) {
      tl.blocks.splice(Math.min(i, tl.blocks.length), 0, rec); // 删除失败恢复
      if (rec.habitSynced && rec.linkHabitId) timelineHabitSync(rec.linkHabitId, rec.date, true);
      throw e;
    });
  }
  /* 删整组（跨天拆分块共用 gid）：删除/编辑重建前调这个，防只删半条留孤儿 */
  function removeTimelineGroup(id) {
    const tl = timeline();
    const rec = tl.blocks.filter(function (x) { return x.id === id; })[0];
    if (!rec) return Promise.resolve();
    const ids = rec.gid
      ? tl.blocks.filter(function (x) { return x.gid === rec.gid; }).map(function (x) { return x.id; })
      : [id];
    return ids.reduce(function (p, bid) {
      return p.then(function () { return removeTimelineBlock(bid); });
    }, Promise.resolve());
  }
  function saveTimelinePoint(pt) {
    const tl = timeline();
    pt = pt || {};
    const rec = {
      id: pt.id || U.uid(), date: String(pt.date || ''), time: String(pt.time || '00:00'),
      typeId: String(pt.typeId || 'pt_water'), name: String(pt.name || '时间点'), note: String(pt.note || ''),
      linkHabitId: String(pt.linkHabitId || ''), habitSynced: !!pt.habitSynced
    };
    const i = tl.points.findIndex(function (x) { return x.id === rec.id; });
    const prev = i >= 0 ? tl.points[i] : null;
    const jobs = [];
    if (prev && prev.habitSynced && prev.linkHabitId && prev.linkHabitId !== rec.linkHabitId) {
      jobs.push(timelineHabitSync(prev.linkHabitId, prev.date, false));
      rec.habitSynced = false;
    }
    if (rec.linkHabitId && !rec.habitSynced) {
      rec.habitSynced = true;
      jobs.push(timelineHabitSync(rec.linkHabitId, rec.date, true));
    }
    if (!rec.linkHabitId) rec.habitSynced = false;
    const prevSnap = i >= 0 ? tl.points[i] : null;
    if (i >= 0) tl.points[i] = rec; else tl.points.push(rec);
    return Promise.all(jobs).then(function () { return persist('timeline'); }).then(function () { return rec; })
      .catch(function (e) {
        const cur = tl.points.findIndex(function (x) { return x.id === rec.id; });
        if (cur >= 0) {
          if (prevSnap) tl.points[cur] = prevSnap;
          else tl.points.splice(cur, 1);
        }
        if (rec.habitSynced && rec.linkHabitId) timelineHabitSync(rec.linkHabitId, rec.date, false);
        throw e;
      });
  }
  function removeTimelinePoint(id) {    const tl = timeline();
    const i = tl.points.findIndex(function (x) { return x.id === id; });
    if (i < 0) return Promise.resolve();
    const rec = tl.points[i];
    tl.points.splice(i, 1);
    const job = rec.habitSynced && rec.linkHabitId ? timelineHabitSync(rec.linkHabitId, rec.date, false) : Promise.resolve();
    return job.then(function () { return persist('timeline'); }).catch(function (e) {
      tl.points.splice(Math.min(i, tl.points.length), 0, rec);
      if (rec.habitSynced && rec.linkHabitId) timelineHabitSync(rec.linkHabitId, rec.date, true);
      throw e;
    });
  }
  function setTimelineTimer(t) {
    timeline().timer = t || null;
    return persist('timeline');
  }
  function saveTimelineType(t) {
    const tl = timeline();
    t = t || {};
    const rec = {
      id: t.id || U.uid(), name: String(t.name || '未命名'),
      icon: String(t.icon || 'circle'), color: String(t.color || '#aeaeb2'),
      kind: t.kind === 'point' ? 'point' : 'block', linkHabitId: String(t.linkHabitId || '')
    };
    const i = tl.types.findIndex(function (x) { return x.id === rec.id; });
    const prevSnap = i >= 0 ? tl.types[i] : null;
    if (i >= 0) tl.types[i] = rec; else tl.types.push(rec);
    return persist('timeline').then(function () { return rec; }).catch(function (e) {
      const cur = tl.types.findIndex(function (x) { return x.id === rec.id; });
      if (cur >= 0) {
        if (prevSnap) tl.types[cur] = prevSnap;
        else tl.types.splice(cur, 1);
      }
      throw e;
    });
  }
  function removeTimelineType(id) {
    const tl = timeline();
    const snapTypes = tl.types.slice();
    const snapBlocks = tl.blocks.map(function (b) { return { id: b.id, typeId: b.typeId }; });
    tl.types = tl.types.filter(function (x) { return x.id !== id; });
    // 引用该类型的记录归入 other（不删用户记录）
    tl.blocks.forEach(function (b) { if (b.typeId === id) b.typeId = 'other'; });
    return persist('timeline').catch(function (e) {
      tl.types = snapTypes;
      snapBlocks.forEach(function (s) {
        const b = tl.blocks.filter(function (x) { return x.id === s.id; })[0];
        if (b) b.typeId = s.typeId;
      });
      throw e;
    });
  }

  /* ===== 统计口径（导出供「我的统计」栏目与主页热力卡共用）=====
     日期键一律 'YYYY-MM-DD'（U.todayStr 口径），连续=自然日相邻。
     - habitYearCount：该年打卡天数（补打的历史日子照计）
     - habitCurrentStreak：当前连续——终点=今天；今天尚未打卡则从昨天往回数（今天不打不断签），
       与统计页「打卡连续与季节分布」栏目同口径
     - habitLongestStreak：历史最长连续天数（跨月/跨年连续不断） */
  function habitYearCount(habitId, year) {
    const map = ((db.habits || {}).log || {})[habitId] || {};
    const p = String(year);
    let n = 0;
    Object.keys(map).forEach(function (k) {
      if (map[k] && k.slice(0, 4) === p) n++;
    });
    return n;
  }

  function habitCurrentStreak(habitId) {
    const map = ((db.habits || {}).log || {})[habitId] || {};
    const cur = new Date();
    if (!map[U.todayStr(cur)]) cur.setDate(cur.getDate() - 1); // 今天还没打卡不断签
    let n = 0;
    while (map[U.todayStr(cur)]) {
      n++;
      cur.setDate(cur.getDate() - 1);
    }
    return n;
  }

  function habitLongestStreak(habitId) {
    const map = ((db.habits || {}).log || {})[habitId] || {};
    const days = Object.keys(map).filter(function (k) {
      return map[k] && /^\d{4}-\d{2}-\d{2}$/.test(k);
    }).sort();
    let best = 0, run = 0, prev = null;
    days.forEach(function (k) {
      const d = U.parseDate(k);
      if (!d) return;
      run = (prev && U.daysBetween(prev, d) === 1) ? run + 1 : 1;
      if (run > best) best = run;
      prev = d;
    });
    return best;
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
  // 双向同步防环（v1.1.7）：正向同步期间置 _biSyncing，嵌套触发的 saveItem/saveFood 不再反向回写（只走一层）
  function _applyBillMemory(bill, prev, idx) {
    _biSyncing = true;
    try { return _applyBillMemoryInner(bill, prev, idx); }
    finally { _biSyncing = false; }
  }

  function _applyBillMemoryInner(bill, prev, idx) {
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
    } else if (bill.type === 'expense' && domain && prevItem) {
      // 编辑已关联账单：就地更新原词条（保留图片/使用记录等用户补充数据），绝不删除重建；
      // 名称双向全跟（拍板）——手动物品仅在账单有备注时跟名，防清空备注被兜底名覆盖。
      // 金额/日期：fromBill 合并词条按账单合计/最早重算（既定口径）；手动物品只补空不覆盖。
      // 此前只认 fromBill===bill.id，手动物品改账单备注会被解除关联并复活出重复词条（v118 修复）
      const nm = billSyncName(bill);
      if (prevItem.name !== nm && (prevItem.fromBill || String(bill.note || '').trim())) prevItem.name = nm;
      prevItem.linkedBillIds = prevItem.linkedBillIds || [];
      if (prevItem.linkedBillIds.indexOf(bill.id) < 0) prevItem.linkedBillIds.push(bill.id);
      bill.itemId = prevItem.id;
      if (prevItem.fromBill) {
        recalcItemFromBills(prevItem); // 手动物品此处 no-op（既定口径：不被账单改写金额/日期）
      } else {
        if (prevItem.purchasePrice == null || prevItem.purchasePrice === '') prevItem.purchasePrice = Number(bill.amount) || 0;
        if (!prevItem.purchaseDate) prevItem.purchaseDate = bill.date;
        prevItem.updatedAt = new Date().toISOString();
      }
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
    if (bill.type === 'expense' && isMeal && prevFood) {
      // 编辑已关联正餐账单：就地更新原美食（绝不删除重建），名称跟随账单备注（手动美食
      // 仅在有备注时跟名，防清空备注被兜底名覆盖）；日期随账单（编辑器置灰「日期随账单」
      // 的承诺，v118 落地——此前改账单日期美食不跟、且手动美食会被解除关联复活出重复条目）
      prevFood.linkedBillIds = prevFood.linkedBillIds || [];
      if (prevFood.linkedBillIds.indexOf(bill.id) < 0) prevFood.linkedBillIds.push(bill.id);
      bill.foodId = prevFood.id;
      const foodName = billSyncName(bill);
      if (prevFood.name !== foodName && (prevFood.fromBill || String(bill.note || '').trim())) prevFood.name = foodName;
      if (prevFood.fromBill) {
        // 「日期随账单」口径：自动生成美食的日期=这一顿的日期，改账单日期就地跟随
        if (bill.date && prevFood.date !== bill.date) prevFood.date = bill.date;
        // 价格默认=关联账单合计；用户改过（priceManual）则保留，不被账单静默改写（A7，与物品侧同口径）
        if (!prevFood.priceManual) {
          const fBills = db.wallet.bills.filter(function (b) { return b.foodId === prevFood.id; });
          prevFood.price = Math.round(fBills.reduce(function (s, b) {
            return s + Math.abs(Number(b.amount) || 0);
          }, 0) * 100) / 100;
        }
      } else if (prevFood.price == null || prevFood.price === '') {
        prevFood.price = Number(bill.amount) || 0; // 手动美食只补空（与物品侧同口径）
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

  /* ================= 词条 → 账单 反向同步（v1.1.7）：名称/金额/日期回写 =================
     触发：saveItem / saveFood 保存时，与库中旧值相比**真实变化**的字段才回写（防误踩、防环）。
     口径（拍板"名称+金额+日期全跟"）：
     - 名称：name → bill.note（billSyncName「备注优先」的反向映射），回写全部关联支出账单
     - 金额：仅 1:1 单账单关联回写——1:1 时金额等价；N:1 合并词条金额=关联账单合计
       （recalcItemFromBills），回写会把合计摊回每笔、越滚越大，破坏合计口径，故不回写。
       priceManual 美食手改价/手动物品价照回写（用户显式改=两边都该是它）；
       账单侧再编辑仍不会改回 priceManual 美食价（单向保护，A7 口径不动）。
       回写金额同步调账：先按旧值回滚余额 → 改金额 → 按新值入账（applyBillToBalance）
     - 日期：物品仅 1:1 回写（合并词条日期=最早账单，N:1 回写会压平分期付款的真实日期）；
       美食回写全部关联账单（同日合并语义：日期=这一顿的日期）
     - 只回写支出账单：二手回血收入账单金额=售出价，不被购入价/名称污染；
       syncOff（解除关联/删过同步记忆）的账单不动，删除/解除既有行为不变
     - 防环：_biSyncing 同步标志位，正/反向同步嵌套触发只走一层；反向=就地改账单字段
       （不走 saveBill），正向=就地改词条（不走 saveItem），两侧结构上不互相回调 */

  // 金额标准化：空值=null（视为未填不回写）；取绝对值+两位小数（与 recalcItemFromBills 同口径）
  function _syncPrice(v) {
    return (v == null || v === '') ? null : Math.round(Math.abs(Number(v)) * 100) / 100;
  }

  // 支出账单金额回写：同步调账保持账户余额一致（回滚旧值→改金额→套新值），返回是否有真实变化
  function _writeBillAmount(bill, amt) {
    const cur = Math.round(Math.abs(Number(bill.amount) || 0) * 100) / 100;
    if (cur === amt) return false;
    applyBillToBalance(bill, -1);
    bill.amount = amt;
    applyBillToBalance(bill, 1);
    return true;
  }

  // 物品 → 关联购入账单（名称→备注全部；金额/日期仅 1:1），返回是否有回写
  function syncItemToBills(item, old) {
    if (_biSyncing || !item || !old || item === old || !db.wallet) return false;
    const name = String(item.name || '').trim();
    const nmChg = !!name && name !== String(old.name || '').trim();
    const price = _syncPrice(item.purchasePrice);
    const priceChg = price != null && price !== _syncPrice(old.purchasePrice);
    const date = String(item.purchaseDate || '');
    const dateChg = !!date && date !== String(old.purchaseDate || '');
    if (!nmChg && !priceChg && !dateChg) return false;
    const bills = (db.wallet.bills || []).filter(function (b) {
      return b && b.type === 'expense' && b.itemId === item.id && !b.syncOff;
    });
    if (!bills.length) return false;
    const single = bills.length === 1;
    let touched = false;
    _biSyncing = true; // 回写期间置位：嵌套触发的对向同步只走一层
    try {
      bills.forEach(function (b) {
        if (nmChg && b.note !== name) { b.note = name; touched = true; }
        if (single && priceChg && _writeBillAmount(b, price)) touched = true;
        if (single && dateChg && b.date !== date) { b.date = date; touched = true; }
      });
    } finally { _biSyncing = false; }
    return touched;
  }

  // 美食 → 关联正餐账单（名称/日期→全部；金额仅 1:1，priceManual 手改价也回写），返回是否有回写
  function syncFoodToBills(rec, old) {
    if (_biSyncing || !rec || !old || rec === old || !db.wallet) return false;
    const name = String(rec.name || '').trim();
    const nmChg = !!name && name !== String(old.name || '').trim();
    const price = _syncPrice(rec.price);
    const priceChg = price != null && price !== _syncPrice(old.price);
    const date = String(rec.date || '');
    const dateChg = !!date && date !== String(old.date || '');
    if (!nmChg && !priceChg && !dateChg) return false;
    const bills = (db.wallet.bills || []).filter(function (b) {
      return b && b.type === 'expense' && b.foodId === rec.id && !b.syncOff;
    });
    if (!bills.length) return false;
    const single = bills.length === 1;
    let touched = false;
    _biSyncing = true; // 回写期间置位：嵌套触发的对向同步只走一层
    try {
      bills.forEach(function (b) {
        if (nmChg && b.note !== name) { b.note = name; touched = true; }
        if (single && priceChg && _writeBillAmount(b, price)) touched = true;
        if (dateChg && b.date !== date) { b.date = date; touched = true; }
      });
    } finally { _biSyncing = false; }
    return touched;
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

  /* 美食 → 账单（对齐 addBillFromItem）：已有美食一键生成消费账单并双向关联（美食同步的反向链路）
     口径与 addBillFromItem 一致：accountId:'' 不区分账户不动余额、source:'manual'、
     金额/日期/名称互通；防重复（已有 expense 且非 syncOff 的关联账单则返回既有账单不重复生成）；
     餐别→钱袋子类复用 MEAL_BY_CAT 反向映射，保证生成的正餐账单仍命中 isMeal，
     编辑账单时美食关联不被解除（与 autoSyncFoodFromBill 同一映射源，往返一致） */
  function addBillFromFood(food) {
    if (!food) return Promise.reject(new Error('美食不存在'));
    const exists = db.wallet.bills.find(function (b) {
      return b.foodId === food.id && b.type === 'expense' && !b.syncOff;
    });
    if (exists) return Promise.resolve(exists);
    const mealCat = {};
    Object.keys(MEAL_BY_CAT).forEach(function (cid) { mealCat[MEAL_BY_CAT[cid]] = cid; });
    const bill = {
      id: U.uid(), type: 'expense',
      amount: Math.abs(Number(food.price) || 0),
      date: food.date || U.todayStr(), time: '',
      catId: 'w_food', subCatId: mealCat[food.meal] || 'w_food_other',
      accountId: '', note: food.name || '',
      tagIds: [], foodId: food.id, source: 'manual',
      createdAt: new Date().toISOString()
    };
    return saveBill(bill).then(function () {
      // saveBill 的自动同步（autoSyncFoodFromBill）按「同日同名」挂关联，名称兜底/同名撞车时
      // 可能错挂或新建条目（fromBill 逻辑被套上）：补记场景强制对齐本美食，参照 addBillFromItem
      const b = db.wallet.bills.find(function (x) { return x.id === bill.id; });
      const rec = db.food.find(function (f) { return f.id === food.id; });
      if (b && rec) {
        if (b.foodId && b.foodId !== rec.id) {
          const wrong = db.food.find(function (f) { return f.id === b.foodId && f.fromBill === b.id; });
          if (wrong) {
            // 自动同步误建的条目（确为本账单生成）→ 整条撤销，绝不碰用户已有记录
            db.food = db.food.filter(function (f) { return f.id !== wrong.id; });
          } else {
            // 挂到同日同名的既有美食上 → 只摘本账单的关联
            const other = db.food.find(function (f) { return f.id === b.foodId; });
            if (other) other.linkedBillIds = (other.linkedBillIds || []).filter(function (x) { return x !== b.id; });
          }
        }
        b.foodId = rec.id;
        delete b.syncOff; // 显式关联回来即恢复同步（与显式 itemId 同口径）
        rec.linkedBillIds = rec.linkedBillIds || [];
        if (rec.linkedBillIds.indexOf(b.id) < 0) rec.linkedBillIds.push(b.id);
        // 手动美食只补空不覆盖金额/日期（与 addBillFromItem 同口径）
        if (rec.price == null || rec.price === '') rec.price = b.amount;
        if (!rec.date) rec.date = b.date;
      }
      return Promise.all([persist('wallet'), persist('food')]).then(function () { return bill; });
    });
  }

  function saveSettings() { return persist('settings'); }

  function resetAll() {
    db.items = []; db.outfits = []; db.food = []; db.events = [];
    db.habits = { defs: [], log: {} }; // 热力打卡一并清空（与"清空当前账号数据"语义一致）
    db.todos = { defs: [], done: {} }; // 待办事项一并清空（v1.2.0）
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
    /* 热力打卡（habits 域） */
    habits: habits, saveHabitDef: saveHabitDef, removeHabitDef: removeHabitDef,
    /* 待办事项（todos 域，v1.2.0） */
    todoDef: todoDef, todoDueOn: todoDueOn, todoStatus: todoStatus, todoNowStr: todoNowStr,
    setTodoDone: setTodoDone, syncTodoFromHabit: syncTodoFromHabit,
    saveTodoDef: saveTodoDef, removeTodoDef: removeTodoDef, todoOpenInstances: todoOpenInstances,
    saveTodos: function () { return persist('todos'); },
    /* 时间日历（timeline 域，v1.2.01） */
    timeline: timeline, normTimeline: normTimeline, TIMELINE_DEFAULT_TYPES: TIMELINE_DEFAULT_TYPES,
    saveTimelineBlock: saveTimelineBlock, removeTimelineBlock: removeTimelineBlock,
    removeTimelineGroup: removeTimelineGroup,
    saveTimelinePoint: saveTimelinePoint, removeTimelinePoint: removeTimelinePoint,
    setTimelineTimer: setTimelineTimer,
    saveTimelineType: saveTimelineType, removeTimelineType: removeTimelineType,
    saveTimeline: function () { return persist('timeline'); },
    toggleHabit: toggleHabit, setHabitCount: setHabitCount, habitCountOf: habitCountOf,
    habitColorScale: habitColorScale,
    saveHabits: saveHabits, HABIT_COLORS: HABIT_COLORS,
    ensureHabitSeeds: ensureHabitSeeds, isPresetId: isPresetId, HABIT_PRESETS: HABIT_PRESETS,
    habitYearCount: habitYearCount, habitCurrentStreak: habitCurrentStreak,
    habitLongestStreak: habitLongestStreak,
    /* 钱袋 */
    wallet: wallet, saveBill: saveBill, saveBills: saveBills, removeBill: removeBill,
    saveWalletAccount: saveWalletAccount, removeWalletAccount: removeWalletAccount,
    saveWalletCat: saveWalletCat, removeWalletCat: removeWalletCat,
    saveWalletTag: saveWalletTag, removeWalletTag: removeWalletTag,
    saveImportBatch: saveImportBatch, revertImport: revertImport,
    saveBillTemplate: saveBillTemplate, removeBillTemplate: removeBillTemplate,
    unlinkBillSync: unlinkBillSync, addBillFromItem: addBillFromItem, addBillFromFood: addBillFromFood,
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
