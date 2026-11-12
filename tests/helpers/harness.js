/* tests/helpers/harness.js — lovelife 测试共享基建
   （JSDOM 环境 + fetch mock + 等待工具 + 通用断言助手）
   用法：
     const { makeWindow, waitFor, sleep, lastModal, waitMain, APP } = require('./helpers/harness');
     const w = makeWindow({
       data: { items: [...], wallet: {...}, settings: {...} },
       routes: { 'api/xxx': ({ body, ok, fail }) => ok({ ... }) },  // 自定义/覆盖路由
       onSave: (target, data) => {}                                 // 观察落盘
     });
   约定：特殊接口一律用 opts.routes 覆盖，不要改本文件（多套测试共用）。
   等待：渲染/异步落地一律用 waitFor(() => 条件)，不要裸 sleep 硬等。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP = path.join(__dirname, '..', '..', 'app');

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* 条件轮询：fn 返回 truthy 即通过并返回该值；超时抛错（label 用于定位） */
async function waitFor(fn, opts) {
  opts = opts || {};
  const timeout = opts.timeout || 5000;
  const interval = opts.interval || 40;
  const label = opts.label || String(fn).slice(0, 80);
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('waitFor 超时（' + timeout + 'ms）: ' + label);
    await sleep(interval);
  }
}

function lastModal(doc) { return Array.from(doc.querySelectorAll('.modal')).pop(); }

/* 等弹窗彻底消失（UI.modal 关闭后节点残留 ~220ms，不能只看 .modal 有无） */
function waitNoModal(doc, opts) {
  return waitFor(function () { return !doc.querySelector('.modal'); },
    Object.assign({ label: '弹窗关闭' }, opts || {}));
}

/* 等待登录进入主界面（点击账号选择 → main-content 出现） */
async function waitMain(w) {
  const doc = w.document;
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    const acc = doc.querySelector('[data-acc]');
    if (acc) { acc.click(); continue; }
    if (doc.getElementById('main-content')) return true;
  }
  return false;
}

/* 统一断言：失败抛 Error（带上下文文案） */
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const DEFAULT_DATA = function () {
  return {
    items: [], outfits: [], events: [], food: [],
    settings: { idleWarnDays: 60, budget: { monthlyTotal: 0, categories: {} }, planSections: [], rememberAccount: true, navOrder: [] },
    wallet: {
      bills: [], accounts: [], balances: [], templates: [], imports: [], tags: [], catsVersion: 2,
      cats: {
        expense: [
          { id: 'w_food', name: '食品餐饮', icon: 'color_ic_parent_restaurant', children: [{ id: 'w_food_lunch', name: '午餐', icon: 'x' }] },
          { id: 'w_shop', name: '购物消费', icon: 'color_ic_parent_shopping', children: [{ id: 'w_shop_digital', name: '手机数码', icon: 'x' }] }
        ],
        income: [
          { id: 'w_in_wages', name: '工资', icon: 'x', children: [] },
          { id: 'w_in_resale', name: '二手闲置', icon: 'x', children: [] }
        ]
      },
      syncMap: { w_shop_digital: 'digital', w_shop_clothing: 'clothing', w_shop_beauty: 'life' }
    },
    categories: {
      digital: [{ id: 'host', name: '主机类', icon: 'laptop', children: [{ id: 'host_phone', name: '手机' }, { id: 'host_other', name: '其他主机' }] }],
      clothing: [{ id: 'top', name: '上装', icon: 'shirt', children: [{ id: 'top_tee', name: 'T恤' }] }],
      life: [{ id: 'skin', name: '护肤', icon: 'heart', children: [{ id: 'skin_other', name: '其他' }] }],
      foodCuisine: [], foodType: [], meal: [], foodTag: [], occasion: [], season: [],
      tagPresets: [], condition: [], remainLevel: [], sizeSystem: [], skinType: [], usageFreq: [], washMethod: []
    }
  };
};

const APP_SCRIPTS = [
  'vendor/lucide.min.js',
  'js/utils.js', 'js/models.js', 'js/storage.js', 'js/charts.js', 'js/cutout.js',
  'js/ui.js', 'js/weather.js',
  'js/views-plan.js', 'js/views-home.js', 'js/views-main.js', 'js/views-life.js',
  'js/views-food.js', 'js/views-wallet.js', 'js/views-settings.js', 'js/views-timeline.js',
  'js/updater.js', 'js/app.js'
];

/* 造一个装好前端的 JSDOM 窗口（fetch 已 mock，数据由 opts.data 驱动） */
function makeWindow(opts) {
  opts = opts || {};
  const defaults = DEFAULT_DATA();
  const data = Object.assign({}, defaults, opts.data || {});
  // wallet/categories 允许局部覆盖（浅并入顶层键）
  if (opts.data && opts.data.wallet) data.wallet = Object.assign({}, defaults.wallet, opts.data.wallet);
  if (opts.data && opts.data.categories) data.categories = Object.assign({}, defaults.categories, opts.data.categories);
  const saved = opts.saved || {};

  const dom = new JSDOM(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), {
    url: 'http://127.0.0.1:8765/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const win = dom.window;
  win.HTMLCanvasElement.prototype.getContext = function () {
    return {
      drawImage: function () {}, getImageData: function () { return { data: new Uint8ClampedArray(4) }; },
      putImageData: function () {}, fillRect: function () {}, clearRect: function () {}
    };
  };
  win.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new win.Blob([1])); };
  win.URL.createObjectURL = function () { return 'blob:x'; };
  win.URL.revokeObjectURL = function () {};
  if (typeof win.createImageBitmap !== 'function') {
    win.createImageBitmap = async function () { return { width: 1, height: 1, close: function () {} }; };
  }
  if (win.confirm === undefined || opts.forceConfirm !== false) win.confirm = function () { return true; };

  const routes = opts.routes || {};
  win.fetch = async function (url, fopts) {
    const u = String(url);
    let body = null;
    if (fopts && fopts.body && typeof fopts.body === 'string') { try { body = JSON.parse(fopts.body); } catch (e) {} }
    if (opts.onCall) opts.onCall(u, body, fopts);
    const ok = function (b) {
      return { ok: true, status: 200, json: async function () { return b; }, blob: async function () { return new Blob([1]); }, arrayBuffer: async function () { return new ArrayBuffer(4); }, text: async function () { return JSON.stringify(b); } };
    };
    const fail = function (b, code) {
      return { ok: false, status: code || 500, json: async function () { return b || { ok: false }; }, text: async function () { return JSON.stringify(b || { ok: false }); } };
    };
    // 自定义路由优先（键用 includes 匹配，回调返回 undefined 则落入默认路由）
    const keys = Object.keys(routes);
    for (let i = 0; i < keys.length; i++) {
      if (u.indexOf(keys[i]) >= 0) {
        const r = routes[keys[i]]({ url: u, body: body, ok: ok, fail: fail, opts: fopts });
        if (r !== undefined) return r;
      }
    }
    if (u.indexOf('/api/session') >= 0) return ok({ ok: true, accounts: [{ id: 'me', name: 'Me', icon: 'x' }], lastAccountId: 'me', dataRoot: 'm', schemaVersion: 3 });
    if (u.indexOf('/api/ping') >= 0) return ok({ ok: true });
    if (u.indexOf('/api/save') >= 0 && body) {
      saved[body.target] = JSON.parse(JSON.stringify(body.data));
      if (opts.onSave) opts.onSave(body.target, body.data);
      return ok({ ok: true });
    }
    if (u.indexOf('/api/db') >= 0) {
      return ok({
        ok: true, schemaVersion: 3,
        account: { id: 'me', name: 'Me', icon: 'x' },
        accounts: [{ id: 'me', name: 'Me', icon: 'x' }],
        items: JSON.parse(JSON.stringify(data.items)),
        outfits: JSON.parse(JSON.stringify(data.outfits)),
        events: JSON.parse(JSON.stringify(data.events)),
        food: JSON.parse(JSON.stringify(data.food)),
        settings: JSON.parse(JSON.stringify(data.settings)),
        categories: JSON.parse(JSON.stringify(data.categories)),
        wallet: JSON.parse(JSON.stringify(data.wallet)),
        habits: JSON.parse(JSON.stringify(data.habits || { defs: [], log: {} })),
        todos: JSON.parse(JSON.stringify(data.todos || { defs: [], done: {} })),
        timeline: JSON.parse(JSON.stringify(data.timeline || { blocks: [], points: [], types: [], timer: null })),
        dataRoot: 'm'
      });
    }
    if (u.indexOf('/api/import/parse') >= 0) return ok({ ok: true, format: 'pasted_text', bills: [], skipped: [], warnings: [] });
    if (u.indexOf('/api/update/check') >= 0) return ok({ ok: true, localVersion: '1.0.1', remoteVersion: '1.0.1', hasUpdate: false, changelog: [] });
    if (u.indexOf('/api/version') >= 0) return ok({ version: '1.0.1', minSchema: 3, changelog: ['a'] });
    if (u.indexOf('/api/desktop-shortcut') >= 0) return ok({ ok: true, path: 'C:\\Users\\me\\Desktop\\人生管家.lnk', name: '人生管家' });
    if (u.indexOf('/api/backup') >= 0) return ok(new Uint8Array([1]));
    if (u.indexOf('/api/data-root') >= 0) return ok({ ok: true, dataRoot: body && body.path });
    if (u.indexOf('/api/account') >= 0) return ok({ ok: true, accounts: [{ id: 'me', name: 'Me', icon: 'x' }], lastAccountId: 'me' });
    return ok({ ok: true });
  };

  for (let i = 0; i < APP_SCRIPTS.length; i++) {
    win.eval(fs.readFileSync(path.join(APP, APP_SCRIPTS[i]), 'utf8'));
  }
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  return win;
}

module.exports = { APP, APP_SCRIPTS, makeWindow, waitFor, sleep, lastModal, waitNoModal, waitMain, assert, DEFAULT_DATA };
