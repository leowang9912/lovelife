/* 生成 UI 验收预览页（Chrome headless 截图用，非回归锁）：
   preview-home.html = 首页（美食四合一打卡视觉）；
   preview-editor.html = 票据编辑器（表单重排 + 日期三段式 + 点击弹月历） */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWindow, waitMain } = require('../helpers/harness');

const ROOT = path.join(__dirname, '..', '..');

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const css = ['styles.css', 'extra.css'].map(function (f) {
  return fs.readFileSync(path.join(ROOT, 'app', 'css', f), 'utf8');
}).join('\n');
const scripts = [
  'vendor/lucide.min.js', 'js/utils.js', 'js/models.js', 'js/storage.js', 'js/charts.js', 'js/cutout.js',
  'js/ui.js', 'js/weather.js', 'js/views-plan.js', 'js/views-main.js', 'js/views-life.js', 'js/views-food.js',
  'js/views-wallet.js', 'js/views-home.js', 'js/views-timeline.js', 'js/views-tickets.js', 'js/app.js'
].map(function (s) { return '<script src="../app/' + s + '"></script>'; }).join('\n');

function page(seed, goExpr, title) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + title + '</title><style>' + css +
    '</style></head><body><div id="app"></div>' +
    '<script>window.__PREVIEW_DATA__ = ' + JSON.stringify(seed) + ';</script>' +
    '<script>window.fetch = function (u) {' +
    'u = String(u); var D = window.__PREVIEW_DATA__;' +
    'function ok(data) { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(data); } }); }' +
    'if (u.indexOf("/api/session") >= 0) return ok({ ok: true, accounts: [{ id: "me", name: "Me", icon: "x" }], lastAccountId: "me", dataRoot: "m", schemaVersion: 3 });' +
    'if (u.indexOf("/api/db") >= 0) return ok({ ok: true, schemaVersion: 3, account: { id: "me", name: "Me", icon: "x" }, accounts: [{ id: "me", name: "Me", icon: "x" }, ],' +
    ' items: [], outfits: [], events: [], food: D.food || [], settings: D.settings || {}, categories: { expense: [], income: [], tagPresets: D.tagPresets || [] },' +
    ' wallet: { bills: [], accounts: [], cats: { expense: [], income: [] }, tags: D.tags || [], imports: [], templates: [], balances: [] },' +
    ' habits: { defs: [], log: {} }, todos: D.todos || { defs: [], done: {} }, timeline: D.timeline || { blocks: [], points: [], types: [], timer: null },' +
    ' tickets: D.tickets || { items: [], types: [] }, dataRoot: "m" });' +
    'return ok({ ok: true }); };' +
    'window.Weather = window.Weather || { targetDate: function () { return { date: "", doneToday: false }; }, dayRange: function () { return Promise.resolve(null); }, recommend: function () { return { outfits: [], combos: [] }; } };' +
    '</script>' + scripts +
    '<script>window.addEventListener("load", function () { setTimeout(function () {' + goExpr +
    '}, 1200); });</script>' +
    '</body></html>';
}

(async function () {
  const today = ymd(new Date());
  // —— 首页：美食打卡（今日早餐已记） ——
  const homeSeed = {
    food: [
      { id: 'f1', date: today, meal: '早餐', foodCuisine: '中餐', name: '包子', price: 8, tags: [], images: [] }
    ],
    categories: { meal: ['早餐', '午餐', '晚餐', '加餐'], foodCuisine: ['中餐'], foodType: [], foodTag: [] },
    todos: { defs: [], done: {} }
  };
  // —— 编辑器：火车票表单 + 点击出发日期弹月历 ——
  const editorSeed = { tickets: { items: [], types: [] }, todos: { defs: [], done: {} } };
  const goHome = ' if (window.App && window.App.go) window.App.go("home");';
  const goEditor = ' if (window.TicketsView) { window.App.go("tickets"); setTimeout(function () {' +
    ' window.TicketsView.openEditor(null);' +
    ' setTimeout(function () {' +
    '  var m = document.querySelector(".modal-wrap") || document.querySelector(".modal");' +
    '  var seg = m && m.querySelector(".dp-seg");' +
    '  if (seg) seg.dispatchEvent(new Event("pointerdown", { bubbles: true }));' +
    ' }, 400);' +
    ' }, 200); }';

  // —— 时间日历：计时运行态（按钮尺寸对齐验收） ——
  const timerSeed = {
    todos: { defs: [], done: {} },
    timeline: {
      blocks: [], points: [], types: [],
      timer: { typeId: 'work', startedAt: Date.now() - 65000, note: '' }
    }
  };
  const goTimer = ' if (window.App && window.App.go) window.App.go("timeline");';

  // —— 物品编辑器（记数码）：标签 chip 自适应验收 ——
  const itemSeed = {
    todos: { defs: [], done: {} },
    tagPresets: ['贵重物品', '待出售闲置', '断舍离候选', '赠送']
  };
  const goItem = ' if (window.Views && window.Views.openItemEditor) window.Views.openItemEditor(null, "digital");';

  for (const [name, seed, goExpr] of [['preview-home.html', homeSeed, goHome], ['preview-editor.html', editorSeed, goEditor], ['preview-timer.html', timerSeed, goTimer], ['preview-item.html', itemSeed, goItem]]) {
    // JSDOM 冒烟：页面可渲染
    const w = makeWindow({ data: JSON.parse(JSON.stringify(seed)) });
    await waitMain(w);
    const html = page(seed, goExpr, name);
    fs.writeFileSync(path.join(ROOT, 'tests', name), html, 'utf8');
    console.log('OK tests/' + name);
  }
})().catch(function (e) {
  console.log('ERR', (e && e.message) || e);
  process.exit(1);
});
