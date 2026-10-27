/* charts.js — 轻量 SVG 图表：折线、柱状、环图、排行条 */
window.Charts = (function () {
  const PALETTE = ['#4f6ef7', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];
  // 图表内所有用户可控文本（物品名/分类名）统一转义，防注入破坏 SVG
  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function svgEl(w, h) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">';
  }

  /* 折线图 data: [{label, value}] */
  function line(data, opts) {
    opts = opts || {};
    const w = 560, h = 200, padL = 48, padB = 28, padT = 16, padR = 12;
    const max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));
    const iw = w - padL - padR, ih = h - padT - padB;
    const stepX = data.length > 1 ? iw / (data.length - 1) : 0;
    const pts = data.map(function (d, i) {
      return [padL + i * stepX, padT + ih - (d.value / max) * ih];
    });
    let path = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    let area = path + ' L' + (padL + (data.length - 1) * stepX) + ' ' + (padT + ih) + ' L' + padL + ' ' + (padT + ih) + ' Z';
    let s = svgEl(w, h);
    // 网格
    for (let g = 0; g <= 4; g++) {
      const y = padT + (ih / 4) * g;
      s += '<line x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '" stroke="#e2e8f0" stroke-width="1"/>';
      s += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#94a3b8">' + Math.round(max - (max / 4) * g) + '</text>';
    }
    s += '<path d="' + area + '" fill="rgba(79,110,247,0.12)"/>';
    s += '<path d="' + path + '" fill="none" stroke="#4f6ef7" stroke-width="2.5" stroke-linejoin="round"/>';
    pts.forEach(function (p, i) {
      s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.5" fill="#fff" stroke="#4f6ef7" stroke-width="2"><title>' + esc(data[i].label) + ': ' + esc(data[i].value) + '</title></circle>';
    });
    // x 轴标签（稀疏显示）
    const every = Math.ceil(data.length / 8);
    data.forEach(function (d, i) {
      if (i % every === 0 || i === data.length - 1) {
        s += '<text x="' + pts[i][0] + '" y="' + (h - 8) + '" text-anchor="middle" font-size="10" fill="#94a3b8">' + esc(d.label) + '</text>';
      }
    });
    s += '</svg>';
    return s;
  }

  /* 柱状图 */
  function bar(data, opts) {
    opts = opts || {};
    const w = 560, h = 200, padL = 48, padB = 28, padT = 16, padR = 12;
    const max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));
    const iw = w - padL - padR, ih = h - padT - padB;
    const bw = Math.min(48, (iw / Math.max(data.length, 1)) * 0.6);
    const step = iw / Math.max(data.length, 1);
    let s = svgEl(w, h);
    for (let g = 0; g <= 4; g++) {
      const y = padT + (ih / 4) * g;
      s += '<line x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '" stroke="#e2e8f0" stroke-width="1"/>';
      s += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#94a3b8">' + Math.round(max - (max / 4) * g) + '</text>';
    }
    data.forEach(function (d, i) {
      const bh = (d.value / max) * ih;
      const x = padL + step * i + (step - bw) / 2;
      const y = padT + ih - bh;
      s += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(bh, 1) + '" rx="4" fill="' + (d.color || PALETTE[i % PALETTE.length]) + '"><title>' + esc(d.label) + ': ' + esc(d.value) + '</title></rect>';
      s += '<text x="' + (x + bw / 2) + '" y="' + (h - 8) + '" text-anchor="middle" font-size="10" fill="#94a3b8">' + esc(d.label) + '</text>';
    });
    s += '</svg>';
    return s;
  }

  /* 环图 data: [{label, value}] */
  function donut(data, opts) {
    opts = opts || {};
    const size = 200, cx = size / 2, cy = size / 2, r = 78, r2 = 52;
    const total = data.reduce(function (a, b) { return a + b.value; }, 0) || 1;
    let s = svgEl(size, size + 20);
    let angle = -Math.PI / 2;
    data.forEach(function (d, i) {
      const frac = d.value / total;
      const a2 = angle + frac * Math.PI * 2;
      const color = d.color || PALETTE[i % PALETTE.length];
      if (frac >= 0.999) {
        s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r + r2) / 2 + '" fill="none" stroke="' + color + '" stroke-width="' + (r - r2) + '"/>';
      } else {
        const large = frac > 0.5 ? 1 : 0;
        const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
        const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
        const x3 = cx + r2 * Math.cos(a2), y3 = cy + r2 * Math.sin(a2);
        const x4 = cx + r2 * Math.cos(angle), y4 = cy + r2 * Math.sin(angle);
        s += '<path d="M' + x1 + ' ' + y1 + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2 +
          ' L' + x3 + ' ' + y3 + ' A' + r2 + ' ' + r2 + ' 0 ' + large + ' 0 ' + x4 + ' ' + y4 + ' Z" fill="' + color + '"><title>' + esc(d.label) + ': ' + esc(d.value) + '</title></path>';
      }
      angle = a2;
    });
    if (opts.centerText) {
      s += '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="16" font-weight="700" fill="#0f172a">' + opts.centerText + '</text>';
      s += '<text x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle" font-size="10" fill="#94a3b8">' + (opts.centerSub || '') + '</text>';
    }
    s += '</svg>';
    return s;
  }

  /* 排行条 data: [{label, value, sub}] */
  function rankBars(data, opts) {
    opts = opts || {};
    const max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));
    return data.map(function (d, i) {
      const pct = Math.round((d.value / max) * 100);
      return '<div class="rank-row">' +
        '<div class="rank-label">' + (opts.fmt ? opts.fmt(d) : esc(d.label)) + '</div>' +
        '<div class="rank-bar-track"><div class="rank-bar-fill" style="width:' + pct + '%;background:' + (d.color || PALETTE[i % PALETTE.length]) + '"></div></div>' +
        '<div class="rank-value">' + esc(d.valueText || d.value) + '</div>' +
        '</div>';
    }).join('');
  }

  return { line: line, bar: bar, donut: donut, rankBars: rankBars, PALETTE: PALETTE };
})();
