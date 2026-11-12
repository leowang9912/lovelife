/* 生成时间日历静态预览页（Chrome headless 视觉验收用，非回归锁） */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWindow, waitMain } = require('../helpers/harness');

const ROOT = path.join(__dirname, '..', '..');

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

(async function () {
  const today = ymd(new Date());
  const seed = {
    todos: {
      defs: [
        { id: 't1', name: '喝水', date: today, due: '10:00', repeat: 'daily', remindBefore: 0, linkHabitId: '', priority: 'mid', archived: false },
        { id: 't2', name: '项目评审会', date: today, due: '14:30', repeat: 'none', remindBefore: 30, linkHabitId: '', priority: 'high', archived: false }
      ],
      done: { t1: {} }
    },
    timeline: {
      blocks: [
        { id: 'b1', date: today, start: '09:00', end: '11:30', typeId: 'work', note: '深度工作', linkHabitId: '', habitSynced: false, source: 'manual' },
        { id: 'b2', date: today, start: '11:30', end: '12:00', typeId: 'meal', note: '', linkHabitId: '', habitSynced: false, source: 'manual' },
        { id: 'b3', date: today, start: '12:10', end: '13:00', typeId: 'rest', note: '小憩', linkHabitId: '', habitSynced: false, source: 'manual' },
        { id: 'b4', date: today, start: '13:00', end: '14:20', typeId: 'meeting', note: '周会', linkHabitId: '', habitSynced: false, source: 'manual' },
        { id: 'b5', date: today, start: '13:30', end: '15:00', typeId: 'study', note: '重叠并排测试', linkHabitId: '', habitSynced: false, source: 'manual' },
        { id: 'b6', date: today, start: '15:00', end: '17:30', typeId: 'work', note: '', linkHabitId: '', habitSynced: false, source: 'manual' },
        { id: 'b7', date: today, start: '22:30', end: '23:30', typeId: 'fun', note: '晚间', linkHabitId: '', habitSynced: false, source: 'manual' },
        { id: 'b8', date: today, start: '08:15', end: '08:35', typeId: 'fun', note: '超短条', linkHabitId: '', habitSynced: false, source: 'manual' }
      ],
      points: [{ id: 'p1', date: today, time: '16:00', name: '量血压', note: '', linkHabitId: '', habitSynced: false }],
      types: [],
      timer: null
    }
  };
  // 渲染探测（顺带当冒烟）：确认 JSDOM 路径能出 7 列
  const w = makeWindow({ data: JSON.parse(JSON.stringify(seed)) });
  await waitMain(w);
  w.App.go('timeline');
  await new Promise(function (r) { setTimeout(r, 250); });
  const cols = w.document.querySelectorAll('.tl-col').length;
  const blocks = w.document.querySelectorAll('.tl-block').length;
  if (cols !== 7) throw new Error('JSDOM 冒烟失败 cols=' + cols);
  if (blocks < 8) throw new Error('JSDOM 冒烟失败 blocks=' + blocks);

  const css = ['styles.css', 'extra.css'].map(function (f) {
    return fs.readFileSync(path.join(ROOT, 'app', 'css', f), 'utf8');
  }).join('\n');
  const scripts = [
    'vendor/lucide.min.js', 'js/utils.js', 'js/models.js', 'js/storage.js', 'js/charts.js', 'js/cutout.js',
    'js/ui.js', 'js/weather.js', 'js/views-plan.js', 'js/views-main.js', 'js/views-life.js', 'js/views-food.js',
    'js/views-wallet.js', 'js/views-home.js', 'js/views-timeline.js', 'js/app.js'
  ].map(function (s) { return '<script src="../app/' + s + '"></script>'; }).join('\n');

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>preview timeline</title><style>' + css +
    '</style></head><body><div id="app"></div>' +
    '<script>window.__PREVIEW_DATA__ = ' + JSON.stringify(seed) + ';</script>' +
    '<script>window.fetch = function (u) {' +
    'u = String(u); var D = window.__PREVIEW_DATA__;' +
    'function ok(data) { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(data); } }); }' +
    'if (u.indexOf("/api/session") >= 0) return ok({ ok: true, accounts: [{ id: "me", name: "Me", icon: "x" }], lastAccountId: "me", dataRoot: "m", schemaVersion: 3 });' +
    'if (u.indexOf("/api/db") >= 0) return ok({ ok: true, schemaVersion: 3, account: { id: "me", name: "Me", icon: "x" }, accounts: [{ id: "me", name: "Me", icon: "x" }, ],' +
    ' items: [], outfits: [], events: [], food: [], settings: {}, categories: { expense: [], income: [] },' +
    ' wallet: { bills: [], accounts: [], cats: { expense: [], income: [] }, tags: [], imports: [], templates: [], balances: [] },' +
    ' habits: { defs: [], log: {} }, todos: D.todos, timeline: D.timeline, dataRoot: "m" });' +
    'return ok({ ok: true }); };' +
    'window.Weather = window.Weather || { targetDate: function () { return { date: "", doneToday: false }; }, dayRange: function () { return Promise.resolve(null); }, recommend: function () { return { outfits: [], combos: [] }; } };' +
    '</script>' + scripts +
    '<script>window.addEventListener("load", function () { setTimeout(function () {' +
    ' if (window.App && window.App.go) window.App.go("timeline");' +
    '}, 1200); });</script>' +
    '</body></html>';

  fs.writeFileSync(path.join(ROOT, 'tests', 'preview-timeline.html'), html, 'utf8');
  console.log('OK tests/preview-timeline.html (JSDOM smoke cols=' + cols + ' blocks=' + blocks + ')');
})().catch(function (e) {
  console.log('ERR', (e && e.message) || e);
  process.exit(1);
});
