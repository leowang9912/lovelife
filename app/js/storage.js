/* storage.js — 本地数据服务客户端 v3（多账号） */
window.Storage = (function () {
  const U = window.Utils;
  const M = window.Models;

  let db = null;
  let session = null; // {accounts, lastAccountId, dataRoot}
  const listeners = [];

  function onChange(fn) { listeners.push(fn); }
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
    if (!r.ok && r.status >= 500) throw new Error('数据服务错误 ' + r.status);
    return r;
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
    return out.accounts;
  }

  async function selectAccount(id) {
    await api('/api/account', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'select', id: id })
    });
    if (session) session.lastAccountId = id;
    await loadAll(id);
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
      dataRoot: raw.dataRoot || ''
    };
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
    const results = await Promise.all(jobs);
    for (const r of results) {
      const out = await r.json();
      if (!out.ok) throw new Error('保存失败');
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
    item.updatedAt = new Date().toISOString();
    if (idx >= 0) db.items[idx] = item;
    else {
      item.createdAt = item.createdAt || new Date().toISOString();
      db.items.push(item);
    }
    return persist('items');
  }

  function removeItem(id) {
    db.items = db.items.filter(function (i) { return i.id !== id; });
    db.outfits.forEach(function (o) {
      o.itemIds = (o.itemIds || []).filter(function (x) { return x !== id; });
      o.cosmeticIds = (o.cosmeticIds || []).filter(function (x) { return x !== id; });
    });
    db.events = db.events.filter(function (e) { return e.itemId !== id; });
    return Promise.all([persist('items'), persist('outfits'), persist('events')]);
  }

  function saveOutfit(outfit) {
    const idx = db.outfits.findIndex(function (o) { return o.id === outfit.id; });
    const isNew = idx < 0;
    const oldCos = isNew ? [] : (db.outfits[idx].cosmeticIds || []);
    if (!isNew) db.outfits[idx] = outfit;
    else db.outfits.push(outfit);
    // 妆品使用次数：新打卡 +1；编辑时新增妆品补 +1、移除妆品补 -1（对称）
    const newCos = outfit.cosmeticIds || [];
    const added = newCos.filter(function (cid) { return oldCos.indexOf(cid) < 0; });
    const removed = oldCos.filter(function (cid) { return newCos.indexOf(cid) < 0; });
    let touched = false;
    added.forEach(function (cid) {
      const it = db.items.find(function (i) { return i.id === cid; });
      if (it) { M.appendUsageLog(it, 1, 'outfit', '穿搭打卡 ' + (outfit.date || ''), outfit.id); touched = true; }
    });
    removed.forEach(function (cid) {
      const it = db.items.find(function (i) { return i.id === cid; });
      if (!it) return;
      // 精确撤销该打卡的 +1 流水（按 refId 锚定，老数据退回按日期匹配）
      const log = (it.usageLog || []).find(function (l) {
        return l.source === 'outfit' && (l.refId === outfit.id ||
          (!l.refId && l.note && l.note.indexOf(outfit.date || '') >= 0));
      });
      if (log) M.removeUsageLogEntry(it, log.id);
      touched = true;
    });
    return touched ? Promise.all([persist('outfits'), persist('items')]) : persist('outfits');
  }

  function removeOutfit(id) {
    const o = db.outfits.find(function (x) { return x.id === id; });
    // 撤销该次打卡带来的化妆品使用次数（同时移除对应流水）
    if (o && (o.cosmeticIds || []).length) {
      o.cosmeticIds.forEach(function (cid) {
        const it = db.items.find(function (i) { return i.id === cid; });
        if (!it) return;
        // 精确匹配 refId，老数据退回按日期匹配
        const logIdx = (it.usageLog || []).findIndex(function (l) {
          return l.source === 'outfit' && (l.refId === o.id ||
            (!l.refId && l.note && o.date && l.note.indexOf(o.date) >= 0));
        });
        if (logIdx >= 0) M.removeUsageLogEntry(it, it.usageLog[logIdx].id);
        else if (!(it.usageLog || []).length && Number(it.useCount) > 0) {
          // 仅对完全没有流水记录的老数据兜底扣减；
          // 有流水但匹配不到 = 用户已手动删过该条，不能再扣（防双扣）
          it.useCount = Number(it.useCount) - 1;
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
    db.food = db.food.filter(function (f) { return f.id !== id; });
    return persist('food');
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

  function saveSettings() { return persist('settings'); }

  function resetAll() {
    db.items = []; db.outfits = []; db.food = []; db.events = [];
    db.settings = M.defaultSettings();
    return persist();
  }

  return {
    loadSession: loadSession, getSession: getSession,
    createAccount: createAccount, updateAccount: updateAccount,
    deleteAccount: deleteAccount, selectAccount: selectAccount,
    setDataRoot: setDataRoot, accId: accId,
    getDB: getDB, onChange: onChange, loadAll: loadAll, persist: persist,
    uploadBlob: uploadBlob, saveImages: saveImages, saveImage: saveImage,
    compressImage: compressImage, getImageURL: getImageURL,
    exportBackup: exportBackup, importBackup: importBackup,
    saveItem: saveItem, removeItem: removeItem,
    saveOutfit: saveOutfit, removeOutfit: removeOutfit,
    saveFood: saveFood, removeFood: removeFood,
    saveEvent: saveEvent, removeEvent: removeEvent,
    saveSettings: saveSettings, resetAll: resetAll
  };
})();
