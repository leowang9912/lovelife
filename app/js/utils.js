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

  return {
    uid: uid, todayStr: todayStr, parseDate: parseDate, daysBetween: daysBetween,
    formatMoney: formatMoney, formatDays: formatDays, formatCost: formatCost,
    escapeHtml: escapeHtml, debounce: debounce, download: download,
    monthKey: monthKey, daysAgo: daysAgo, cnDate: cnDate, relativeDay: relativeDay
  };
})();
