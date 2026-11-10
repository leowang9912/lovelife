/* utils.js — 基础工具 */
window.Utils = (function () {
  function uid() {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function todayStr(d) {
    const dt = d || new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function parseDate(s) {
    if (!s) return null;
    // 纯日期串按本地零点解析：JS 默认把 'YYYY-MM-DD' 当 UTC 零点，
    // 东八区会偏成 08:00，天数取整因此可能差 1（v1.1.0 修正）
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function daysBetween(a, b) {
    if (!a || !b) return null; // 脏数据兜底：缺日期返回 null，不抛错
    const ms = (b.getTime() - a.getTime());
    return Math.floor(ms / 86400000);
  }

  function formatMoney(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return '¥' + Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  function formatDays(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    if (n >= 365) return (n / 365).toFixed(1) + ' 年';
    if (n >= 30) return (n / 30).toFixed(1) + ' 个月';
    return n + ' 天';
  }

  function formatCost(n) {
    if (n === null || n === undefined || isNaN(n) || !isFinite(n)) return '—';
    if (n >= 1) return '¥' + n.toFixed(2);
    return '¥' + n.toFixed(3);
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  }

  function monthKey(dateStr) {
    return String(dateStr).slice(0, 7); // YYYY-MM
  }

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }

  function cnDate(dateStr) {
    const d = parseDate(dateStr);
    if (!d) return dateStr || '—';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function relativeDay(dateStr) {
    const d = parseDate(dateStr);
    if (!d) return '—';
    const diff = daysBetween(d, new Date());
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    return diff + ' 天前';
  }

  /* ---------- 温度区间 / 季季（v1.0.8 组合温季与穿搭推荐） ---------- */
  // 解析温度标签 → [min, max]：支持 '>28℃' '<5℃' '22~28℃' '-5~0℃' 及自定义 '18~26℃'
  function parseTempRange(label) {
    const s = String(label || '').replace(/\s/g, '').replace(/[Ｃ]/g, 'C').replace(/℃/g, '');
    let m = s.match(/^([<>])((-?\d+(?:\.\d+)?))$/);
    if (m) return m[1] === '>' ? [Number(m[2]), 999] : [-999, Number(m[2])];
    m = s.match(/^(-?\d+(?:\.\d+)?)~(-?\d+(?:\.\d+)?)$/);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      return [Math.min(a, b), Math.max(a, b)];
    }
    return null;
  }
  // 温度 T 是否落在任一区间内
  function tempMatch(labels, t) {
    if (t == null || isNaN(t)) return false;
    return (labels || []).some(function (lb) {
      const r = parseTempRange(lb);
      return r && t >= r[0] && t <= r[1];
    });
  }
  // 温度标签集合 与 目标区间 {min,max} 是否重叠（v1.0.8 区间匹配）
  function tempOverlap(labels, range) {
    if (!range || range.min == null || range.max == null) return false;
    return (labels || []).some(function (lb) {
      const r = parseTempRange(lb);
      return r && r[0] <= range.max && r[1] >= range.min;
    });
  }
  // 月份 → 季节（3~5 春 / 6~8 夏 / 9~11 秋 / 12~2 冬）
  function monthSeason(dateStr) {
    const d = parseDate(dateStr) || new Date();
    const m = d.getMonth() + 1;
    if (m >= 3 && m <= 5) return '春';
    if (m >= 6 && m <= 8) return '夏';
    if (m >= 9 && m <= 11) return '秋';
    return '冬';
  }

  return {
    uid: uid, todayStr: todayStr, parseDate: parseDate, daysBetween: daysBetween,
    formatMoney: formatMoney, formatDays: formatDays, formatCost: formatCost,
    escapeHtml: escapeHtml, debounce: debounce, download: download,
    monthKey: monthKey, daysAgo: daysAgo, cnDate: cnDate, relativeDay: relativeDay,
    parseTempRange: parseTempRange, tempMatch: tempMatch, tempOverlap: tempOverlap, monthSeason: monthSeason
  };
})();
