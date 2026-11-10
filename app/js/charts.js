/* charts.js — 轻量 SVG 图表：折线、柱状、环图、排行条
   v1.2.0（丙/丁）：柱状支持收入/支出双色分组 + 图内小图例 + 悬停 tooltip；
   环图扇区旁标百分比（≥3%）；折线浅色渐变填充（线下渐隐）+ 线尾锚点标签；
   下钻 data-drill-* 由图表内建（views-plan 只绑点击），<title> 原生悬停轻实现、不引库 */
window.Charts = (function () {
  const PALETTE = ['#4f6ef7', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];
  // 渐变 id 唯一（同页多张折线图不串色）
  let uid = 0;
  // 图表内所有用户可控文本（物品名/分类名）统一转义，防注入破坏 SVG
  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function svgEl(w, h) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">';
  }

  /* 下钻属性（v1.2.0）：data item 携带 drill {date|month|catId} 时直接落到形状上，
     views-plan 的 bindWalletDrill 只需按 [data-drill-*] 绑点击（不再按形状序号猜配对） */
  function drillAttrs(drill) {
    if (!drill) return '';
    if (drill.date) return ' data-drill-date="' + esc(drill.date) + '"';
    if (drill.month) return ' data-drill-month="' + esc(drill.month) + '"';
    if (drill.catId) return ' data-drill-cat="' + esc(drill.catId) + '"';
    return '';
  }

  /* 折线图 data: [{label, value}] opts: {endLabel} —— 线下渐隐渐变填充 + 线尾锚点标签 */
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
    const gid = 'charts-ln-' + (++uid);
    let s = svgEl(w, h);
    // 浅色渐变填充（丁）：线下渐隐（上浓下透）
    s += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#4f6ef7" stop-opacity="0.22"/>' +
      '<stop offset="1" stop-color="#4f6ef7" stop-opacity="0"/></linearGradient></defs>';
    // 网格
    for (let g = 0; g <= 4; g++) {
      const y = padT + (ih / 4) * g;
      s += '<line x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '" stroke="#e2e8f0" stroke-width="1"/>';
      s += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#94a3b8">' + Math.round(max - (max / 4) * g) + '</text>';
    }
    s += '<path d="' + area + '" fill="url(#' + gid + ')"/>';
    s += '<path d="' + path + '" fill="none" stroke="#4f6ef7" stroke-width="2.5" stroke-linejoin="round"/>';
    pts.forEach(function (p, i) {
      s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.5" fill="#fff" stroke="#4f6ef7" stroke-width="2"><title>' + esc(data[i].label) + ': ' + esc(data[i].value) + '</title></circle>';
    });
    // 线尾当前值锚点标签（丁）：小圆点 + 金额，标签向左展开不越界
    if (opts.endLabel != null && pts.length) {
      const lp = pts[pts.length - 1];
      s += '<circle cx="' + lp[0] + '" cy="' + lp[1] + '" r="4.5" fill="#4f6ef7" stroke="#fff" stroke-width="2"/>';
      s += '<text x="' + lp[0] + '" y="' + (lp[1] - 10) + '" text-anchor="end" font-size="11" font-weight="700" fill="#4f6ef7">' + esc(opts.endLabel) + '</text>';
    }
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

  /* 柱状图
     单序列：data [{label, value, color?, drill?}]
     分组双色（丙）：opts.series = [{key, name, color}]，data 里每项带各序列值
     （d[key] 数值 / d[key+'Text'] 悬停展示文案），同档两根相邻细柱 + 图内小图例 +
     悬停 tooltip（日期·收入·支出） */
  function bar(data, opts) {
    opts = opts || {};
    const series = opts.series && opts.series.length ? opts.series : null;
    const w = 560, h = 200, padL = 48, padB = 28, padT = series ? 36 : 16, padR = 12;
    let max = 1;
    data.forEach(function (d) {
      if (series) series.forEach(function (se) { max = Math.max(max, Number(d[se.key]) || 0); });
      else max = Math.max(max, Number(d.value) || 0);
    });
    const iw = w - padL - padR, ih = h - padT - padB;
    const step = iw / Math.max(data.length, 1);
    let s = svgEl(w, h);
    for (let g = 0; g <= 4; g++) {
      const y = padT + (ih / 4) * g;
      s += '<line x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '" stroke="#e2e8f0" stroke-width="1"/>';
      s += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#94a3b8">' + Math.round(max - (max / 4) * g) + '</text>';
    }
    // 图内小图例（丙）：色点 + 标签，放在绘图区上方
    if (series) {
      let lx = padL;
      series.forEach(function (se) {
        s += '<circle cx="' + (lx + 4) + '" cy="' + (padT - 20) + '" r="4" fill="' + se.color + '"/>';
        s += '<text x="' + (lx + 12) + '" y="' + (padT - 16) + '" font-size="11" fill="#6e6e73">' + esc(se.name) + '</text>';
        lx += 12 + String(se.name).length * 12 + 14;
      });
    }
    const every = Math.ceil(data.length / 8);
    data.forEach(function (d, i) {
      const da = drillAttrs(d.drill);
      if (series) {
        // 悬停 tooltip：日期 · 收入 · 支出（两根柱同文案，<title> 原生悬停）
        const tip = esc(d.label) + series.map(function (se) {
          return ' · ' + esc(se.name) + ' ' + esc(d[se.key + 'Text'] != null ? d[se.key + 'Text'] : d[se.key]);
        }).join('');
        const bw = Math.min(18, step * 0.26);
        const gap = Math.min(4, step * 0.06);
        const x0 = padL + step * i + (step - (bw * series.length + gap * (series.length - 1))) / 2;
        series.forEach(function (se, k) {
          const v = Number(d[se.key]) || 0;
          const bh = (v / max) * ih;
          const x = x0 + k * (bw + gap);
          const y = padT + ih - bh;
          s += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(bh, 1).toFixed(1) +
            '" rx="3" fill="' + se.color + '"' + da + '><title>' + tip + '</title></rect>';
        });
      } else {
        const bh = (d.value / max) * ih;
        const bw = Math.min(48, step * 0.6);
        const x = padL + step * i + (step - bw) / 2;
        const y = padT + ih - bh;
        s += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(bh, 1) + '" rx="4" fill="' +
          (d.color || PALETTE[i % PALETTE.length]) + '"' + da + '><title>' + esc(d.label) + ': ' + esc(d.value) + '</title></rect>';
      }
      if (i % every === 0 || i === data.length - 1) {
        s += '<text x="' + (padL + step * i + step / 2) + '" y="' + (h - 8) + '" text-anchor="middle" font-size="10" fill="#94a3b8">' + esc(d.label) + '</text>';
      }
    });
    s += '</svg>';
    return s;
  }

  /* 环图 data: [{label, value, catId?}] —— 扇区旁标百分比（≥3% 才标）+ 悬停数值 */
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
      const da = drillAttrs({ catId: d.catId });
      const pct = Math.round(frac * 100);
      const tip = esc(d.label) + ': ' + esc(d.value) + '（' + pct + '%）';
      if (frac >= 0.999) {
        s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r + r2) / 2 + '" fill="none" stroke="' + color + '" stroke-width="' + (r - r2) + '"' + da + '><title>' + tip + '</title></circle>';
      } else {
        const large = frac > 0.5 ? 1 : 0;
        const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
        const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
        const x3 = cx + r2 * Math.cos(a2), y3 = cy + r2 * Math.sin(a2);
        const x4 = cx + r2 * Math.cos(angle), y4 = cy + r2 * Math.sin(angle);
        s += '<path d="M' + x1 + ' ' + y1 + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2 +
          ' L' + x3 + ' ' + y3 + ' A' + r2 + ' ' + r2 + ' 0 ' + large + ' 0 ' + x4 + ' ' + y4 + ' Z" fill="' + color + '"' + da + '><title>' + tip + '</title></path>';
      }
      // 扇区旁百分比（丙）：≥3% 才标，防小扇区挤叠；深色扇区白字 + 淡描边保证可读
      if (frac >= 0.03) {
        const mid = frac >= 0.999 ? -Math.PI / 2 : (angle + a2) / 2;
        const lr = (r + r2) / 2;
        const lx = cx + lr * Math.cos(mid), ly = cy + lr * Math.sin(mid);
        s += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 3.5).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="600"' +
          ' fill="#fff" stroke="rgba(0,0,0,.28)" stroke-width="2" paint-order="stroke" pointer-events="none">' + pct + '%</text>';
      }
      angle = a2;
    });
    if (opts.centerText) {
      s += '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="16" font-weight="700" fill="#0f172a">' + opts.centerText + '</text>';
      s += '<text x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle" font-size="10" fill="#94a3b8">' + (opts.centerSub || '') + '</text>';
    }
    s += '</svg>';
    // 常驻图例（v1.0.7）：色点 + 名称 + 数值 + 占比，色块代指一目了然（opts.legend===false 可关）
    // v1.2.0：图例行带金额占比不变；catId 存在时行内建下钻属性
    let legend = '';
    if (opts.legend !== false && data.length) {
      legend = '<div class="donut-legend">' + data.map(function (d, i) {
        const color = d.color || PALETTE[i % PALETTE.length];
        const pct = Math.round((d.value / total) * 100);
        return '<div class="donut-legend-row"' + drillAttrs({ catId: d.catId }) + '>' +
          '<span class="donut-dot" style="background:' + color + '"></span>' +
          '<span class="donut-legend-label">' + esc(d.label) + '</span>' +
          '<span class="donut-legend-val">' + esc(d.valueText != null ? d.valueText : d.value) + '</span>' +
          '<span class="donut-legend-pct">' + pct + '%</span>' +
          '</div>';
      }).join('') + '</div>';
    }
    return '<div class="donut-wrap">' + s + legend + '</div>';
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
