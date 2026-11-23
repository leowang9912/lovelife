/* 生成票据板块静态预览页（Chrome headless 视觉验收用，非回归锁）——v1.2.6 票面重构 */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWindow, waitMain } = require('../helpers/harness');

const ROOT = path.join(__dirname, '..', '..');

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function addDay(ds, n) {
  const p = ds.split('-');
  return ymd(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
}

(async function () {
  const today = ymd(new Date());
  const tmr = addDay(today, 1);
  const seed = {
    tickets: {
      items: [
        {
          id: 'k1', type: 'train', name: '上海虹桥→北京南', date: today, arriveDate: tmr, time: '23:00', endTime: '07:30',
          location: '', seat: '01车12A', price: 553, ticketNo: 'E123456789', note: '', reimb: 'none',
          images: [], buyDate: today, billId: '', todoId: '', ext: { no: 'G12', from: '上海虹桥', to: '北京南', gate: '5B', sub: '二等座' }, createdAt: Date.now()
        },
        {
          id: 'k2', type: 'flight', name: 'CA123 北京→成都', date: today, arriveDate: today, time: '08:00', endTime: '11:20',
          location: '', seat: '32A', price: 1280, ticketNo: '99922233344', note: '', reimb: 'pending',
          images: [], buyDate: addDay(today, -5), billId: '', todoId: '', ext: { no: 'CA123', from: '首都T3', to: '天府T2', gate: 'A12', sub: '经济舱' }, createdAt: Date.now()
        },
        {
          id: 'k3', type: 'bus', name: '杭州→乌镇', date: addDay(today, -1), arriveDate: addDay(today, -1), time: '09:30', endTime: '10:50',
          location: '', seat: '12号', price: 35, ticketNo: '', note: '', reimb: 'none',
          images: [], buyDate: addDay(today, -1), billId: '', todoId: '', ext: { no: 'K588', from: '杭州客运中心', to: '乌镇' }, createdAt: Date.now()
        },
        {
          id: 'k4', type: 'concert', name: '周杰伦·嘉年华', date: addDay(today, 7), arriveDate: addDay(today, 7), time: '19:30', endTime: '22:00',
          location: '国家体育场', seat: '12排34号', price: 980, ticketNo: 'TK886612', note: '', reimb: 'none',
          images: [], buyDate: addDay(today, -30), billId: '', todoId: '', ext: { sub: '看台 C 区' }, createdAt: Date.now()
        },
        {
          id: 'k5', type: 'movie', name: '沙丘3', date: addDay(today, -2), arriveDate: addDay(today, -2), time: '14:00', endTime: '',
          location: '万达影城', seat: '5排8座', price: 45, ticketNo: 'MV2026', note: '', reimb: 'none',
          images: [], buyDate: addDay(today, -2), billId: '', todoId: '', ext: { cinema: '3号厅 IMAX' }, createdAt: Date.now()
        },
        {
          id: 'k6', type: 'exhibition', name: '莫奈光影展', date: addDay(today, -3), arriveDate: addDay(today, -3), time: '10:00', endTime: '',
          location: '上海博物馆', seat: '', price: 88, ticketNo: 'EX5566', note: '', reimb: 'settled',
          images: [], buyDate: addDay(today, -10), billId: '', todoId: '', ext: {}, createdAt: Date.now()
        },
        {
          id: 'k7', type: 'attraction', name: '拙政园', date: tmr, arriveDate: tmr, time: '09:00', endTime: '',
          location: '苏州市姑苏区', seat: '', price: 70, ticketNo: 'AT7788', note: '', reimb: 'none',
          images: [], buyDate: today, billId: '', todoId: '', ext: {}, createdAt: Date.now()
        },
        {
          id: 'k8', type: 'other', name: '密室逃脱·星辰', date: addDay(today, -5), arriveDate: addDay(today, -5), time: '18:30', endTime: '20:00',
          location: '星辰密室', seat: '4人场', price: 128, ticketNo: '', note: '', reimb: 'none',
          images: [], buyDate: addDay(today, -5), billId: '', todoId: '', ext: {}, createdAt: Date.now()
        }
      ],
      types: []
    }
  };
  // JSDOM 冒烟：确认票墙渲染 8 张
  const w = makeWindow({ data: JSON.parse(JSON.stringify(seed)) });
  await waitMain(w);
  w.App.go('tickets');
  await new Promise(function (r) { setTimeout(r, 250); });
  const cards = w.document.querySelectorAll('.tk-card').length;
  if (cards !== 8) throw new Error('JSDOM 冒烟失败 cards=' + cards);

  const css = ['styles.css', 'extra.css'].map(function (f) {
    return fs.readFileSync(path.join(ROOT, 'app', 'css', f), 'utf8');
  }).join('\n');
  const scripts = [
    'vendor/lucide.min.js', 'js/utils.js', 'js/models.js', 'js/storage.js', 'js/charts.js', 'js/cutout.js',
    'js/ui.js', 'js/weather.js', 'js/views-plan.js', 'js/views-main.js', 'js/views-life.js', 'js/views-food.js',
    'js/views-wallet.js', 'js/views-home.js', 'js/views-timeline.js', 'js/views-tickets.js', 'js/app.js'
  ].map(function (s) { return '<script src="../app/' + s + '"></script>'; }).join('\n');

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>preview tickets</title><style>' + css +
    '</style></head><body><div id="app"></div>' +
    '<script>window.__PREVIEW_DATA__ = ' + JSON.stringify(seed) + ';</script>' +
    '<script>window.fetch = function (u) {' +
    'u = String(u); var D = window.__PREVIEW_DATA__;' +
    'function ok(data) { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(data); } }); }' +
    'if (u.indexOf("/api/session") >= 0) return ok({ ok: true, accounts: [{ id: "me", name: "Me", icon: "x" }], lastAccountId: "me", dataRoot: "m", schemaVersion: 3 });' +
    'if (u.indexOf("/api/db") >= 0) return ok({ ok: true, schemaVersion: 3, account: { id: "me", name: "Me", icon: "x" }, accounts: [{ id: "me", name: "Me", icon: "x" }, ],' +
    ' items: [], outfits: [], events: [], food: [], settings: {}, categories: { expense: [], income: [] },' +
    ' wallet: { bills: [], accounts: [], cats: { expense: [], income: [] }, tags: [], imports: [], templates: [], balances: [] },' +
    ' habits: { defs: [], log: {} }, todos: { defs: [], done: {} }, timeline: { blocks: [], points: [], types: [], timer: null },' +
    ' tickets: D.tickets, dataRoot: "m" });' +
    'return ok({ ok: true }); };' +
    'window.Weather = window.Weather || { targetDate: function () { return { date: "", doneToday: false }; }, dayRange: function () { return Promise.resolve(null); }, recommend: function () { return { outfits: [], combos: [] }; } };' +
    '</script>' + scripts +
    '<script>window.addEventListener("load", function () { setTimeout(function () {' +
    ' if (window.App && window.App.go) window.App.go("tickets");' +
    '}, 1200); });</script>' +
    '</body></html>';

  fs.writeFileSync(path.join(ROOT, 'tests', 'preview-tickets.html'), html, 'utf8');
  console.log('OK tests/preview-tickets.html (JSDOM smoke cards=' + cards + ')');
})().catch(function (e) {
  console.log('ERR', (e && e.message) || e);
  process.exit(1);
});
