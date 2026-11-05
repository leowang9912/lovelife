/* ui.js — 通用组件 v3：Toast、Modal、裁切、表单、选择器、卡片 */
window.UI = (function () {
  const U = window.Utils;

  /* ---------- Toast ---------- */
  function toast(msg, type) {
    let box = document.getElementById('toast-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast-box';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 10);
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 300);
    }, 2600);
  }

  /* ---------- Modal ---------- */
  function modal(opts) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-mask';
    wrap.innerHTML =
      '<div class="modal" style="' + (opts.width ? 'max-width:' + opts.width + 'px' : '') + '">' +
      '<div class="modal-head"><h3>' + U.escapeHtml(opts.title || '') + '</h3>' +
      '<button class="modal-close" title="关闭">' + icon('x', 16) + '</button></div>' +
      '<div class="modal-body">' + (opts.bodyHTML || '') + '</div>' +
      (opts.footerHTML ? '<div class="modal-foot">' + opts.footerHTML + '</div>' : '') +
      '</div>';
    document.body.appendChild(wrap);
    requestAnimationFrame(function () { wrap.classList.add('show'); });
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      wrap.classList.remove('show');
      setTimeout(function () { wrap.remove(); }, 220);
      if (opts.onClose) { try { opts.onClose(); } catch (e) {} }
    }
    wrap.querySelector('.modal-close').addEventListener('click', close);
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap && opts.closable !== false) close();
    });
    if (opts.onMount) opts.onMount(wrap, close);
    return { close: close, el: wrap };
  }

  function confirmDialog(title, text) {
    return new Promise(function (resolve) {
      let settled = false;
      const done = function (v) { if (!settled) { settled = true; resolve(v); } };
      modal({
        title: title,
        bodyHTML: '<p class="confirm-text">' + U.escapeHtml(text) + '</p>',
        footerHTML: '<button class="btn btn-ghost" data-act="no">取消</button><button class="btn btn-danger" data-act="yes">确认</button>',
        onMount: function (wrap, close) {
          // 先结算再 close：close 会触发 onClose 的 done(false)，done 幂等保证按钮结果优先
          wrap.querySelector('[data-act=no]').addEventListener('click', function () { done(false); close(); });
          wrap.querySelector('[data-act=yes]').addEventListener('click', function () { done(true); close(); });
        },
        // 点遮罩/× 关闭同样结算（否则调用方 await 永久挂起、重复点击叠加确认框）
        onClose: function () { done(false); }
      });
    });
  }

  /* ---------- 图片裁切弹窗（1:1）+ 一键抠图 ---------- */
  function cropImage(file) {
    return new Promise(function (resolve, reject) {
      let settled = false;
      // 任何关闭方式（取消/×/遮罩/确认）都会结算，杜绝上传循环挂死丢图（v1.0.9）
      const done = function (v) { if (!settled) { settled = true; resolve(v); } };
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        let scale = 1, offsetX = 0, offsetY = 0;
        const frame = 320;
        modal({
          title: '裁切图片（1:1）',
          width: 420,
          bodyHTML:
            '<div class="crop-frame" id="crop-frame">' +
            '<canvas id="crop-canvas" width="' + frame + '" height="' + frame + '"></canvas>' +
            '<div class="crop-grid"></div></div>' +
            '<div class="crop-controls">' +
            '<label class="f-label">缩放（可缩小，四周自动补白）</label>' +
            '<input type="range" id="crop-zoom" min="33" max="300" value="100">' +
            '<div class="crop-actions">' +
            '<button class="btn btn-ghost btn-sm" id="crop-cutout">' + icon('scissors', 14) + ' 一键抠图</button>' +
            '<span class="muted small" id="crop-tip">拖动图片调整位置</span>' +
            '</div></div>',
          footerHTML:
            '<button class="btn btn-ghost" data-act="cancel">取消</button>' +
            '<button class="btn btn-ghost" data-act="origin">使用原图</button>' +
            '<button class="btn btn-primary" data-act="ok">确认裁切</button>',
          onClose: function () { done(null); },
          onMount: function (wrap, close) {
            wrap.querySelector('[data-act=cancel]').addEventListener('click', function () {
              done(null); close();
            });
            const canvas = wrap.querySelector('#crop-canvas');
            const ctx = canvas.getContext('2d');
            let cutoutCanvas = null;

            function fit() {
              const base = Math.max(frame / img.width, frame / img.height);
              scale = base * (Number(wrap.querySelector('#crop-zoom').value) / 100);
            }
            function draw() {
              ctx.clearRect(0, 0, frame, frame);
              ctx.fillStyle = '#ffffff'; // 白底补齐：缩小时四周就是输出的白边
              ctx.fillRect(0, 0, frame, frame);
              const w = img.width * scale, h = img.height * scale;
              // 缩小时也允许在白边范围内拖动构图（v1.0.8）
              const maxX = Math.abs(w - frame) / 2, maxY = Math.abs(h - frame) / 2;
              offsetX = Math.min(maxX, Math.max(-maxX, offsetX));
              offsetY = Math.min(maxY, Math.max(-maxY, offsetY));
              if (cutoutCanvas) {
                ctx.drawImage(cutoutCanvas, (frame - w) / 2 + offsetX, (frame - h) / 2 + offsetY, w, h);
              } else {
                ctx.drawImage(img, (frame - w) / 2 + offsetX, (frame - h) / 2 + offsetY, w, h);
              }
            }
            fit(); draw();

            wrap.querySelector('#crop-zoom').addEventListener('input', function () {
              fit(); draw();
            });
            let dragging = false, lastX = 0, lastY = 0;
            canvas.addEventListener('pointerdown', function (e) {
              dragging = true; lastX = e.clientX; lastY = e.clientY;
              canvas.setPointerCapture(e.pointerId);
            });
            canvas.addEventListener('pointermove', function (e) {
              if (!dragging) return;
              offsetX += e.clientX - lastX;
              offsetY += e.clientY - lastY;
              lastX = e.clientX; lastY = e.clientY;
              draw();
            });
            canvas.addEventListener('pointerup', function () { dragging = false; });

            wrap.querySelector('#crop-cutout').addEventListener('click', async function () {
              const btn = wrap.querySelector('#crop-cutout');
              btn.disabled = true;
              btn.textContent = '抠图中…';
              wrap.querySelector('#crop-tip').textContent = '正在处理背景，请稍候';
              try {
                if (!window.Cutout) throw new Error('cutout module missing');
                const tmp = document.createElement('canvas');
                const side = Math.max(img.width, img.height);
                tmp.width = side; tmp.height = side;
                const tctx = tmp.getContext('2d');
                tctx.drawImage(img, (side - img.width) / 2, (side - img.height) / 2);
                cutoutCanvas = await window.Cutout.cutout(tmp);
                draw();
                wrap.querySelector('#crop-tip').textContent = window.Cutout.isModelReady()
                  ? '抠图完成，可继续调整'
                  : '已用基础抠图（AI 模型未加载），纯色背景效果最好';
                btn.textContent = '已抠图';
              } catch (e) {
                wrap.querySelector('#crop-tip').textContent = '抠图失败：' + e.message;
                btn.textContent = '一键抠图';
                btn.disabled = false;
              }
            });

            wrap.querySelector('[data-act=origin]').addEventListener('click', async function () {
              done({ blob: file, isCutout: false });
              close();
            });
            wrap.querySelector('[data-act=ok]').addEventListener('click', async function () {
              const out = cutoutCanvas || canvas;
              let blob;
              if (cutoutCanvas) {
                blob = await new Promise(function (res) { cutoutCanvas.toBlob(res, 'image/png'); });
              } else {
                blob = await new Promise(function (res) { canvas.toBlob(res, 'image/webp', 0.88); });
              }
              done({ blob: blob, isCutout: !!cutoutCanvas });
              close();
            });
          }
        });
        URL.revokeObjectURL(url);
      };
      img.onerror = function () { reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  /* ---------- 图片上传区（上传前裁切） ---------- */
  function imageUploader(container, options) {
    options = options || {};
    let paths = (options.paths || []).slice();
    let pendingBlobs = [];
    let liveURLs = []; // 追踪 objectURL，重绘前回收防泄漏
    const Storage = window.Storage;

    function render() {
      liveURLs.forEach(function (u) { URL.revokeObjectURL(u); });
      liveURLs = [];
      container.className = 'img-uploader';
      let html = '';
      paths.forEach(function (p, i) {
        html += '<div class="img-thumb" data-idx="' + i + '"><img data-path="' + U.escapeHtml(p) + '" alt=""/>' +
          '<button class="img-del" title="删除">' + icon('trash-2', 14) + '</button></div>';
      });
      pendingBlobs.forEach(function (b, i) {
        html += '<div class="img-thumb" data-pidx="' + i + '"><img data-fidx="' + i + '" alt=""/>' +
          '<button class="img-del" title="移除">' + icon('x', 14) + '</button></div>';
      });
      html += '<label class="img-add"><span>＋<br>添加图片</span><input type="file" accept="image/*" multiple hidden></label>';
      container.innerHTML = html;

      container.querySelectorAll('img[data-path]').forEach(async function (img) {
        const url = await Storage.getImageURL(img.getAttribute('data-path'));
        if (url) img.src = url;
      });
      container.querySelectorAll('img[data-fidx]').forEach(function (img) {
        const f = pendingBlobs[Number(img.getAttribute('data-fidx'))];
        if (f) {
          const u = URL.createObjectURL(f.blob || f);
          liveURLs.push(u);
          img.src = u;
        }
      });

      container.querySelector('input[type=file]').addEventListener('change', async function (e) {
        const files = Array.from(e.target.files || []);
        for (const f of files) {
          if (!f.type.startsWith('image/')) continue;
          try {
            const result = await cropImage(f);
            if (!result) continue; // 用户取消：跳过该图，不拖累整批
            pendingBlobs.push({ blob: result.blob, ext: result.isCutout ? '.png' : '.webp' });
          } catch (err) {
            pendingBlobs.push({ blob: f, ext: '.webp' });
          }
        }
        render();
      });

      container.querySelectorAll('.img-del').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const thumb = btn.closest('.img-thumb');
          if (thumb.hasAttribute('data-idx')) paths.splice(Number(thumb.getAttribute('data-idx')), 1);
          else pendingBlobs.splice(Number(thumb.getAttribute('data-pidx')), 1);
          render();
        });
      });
    }
    render();

    return {
      finalize: async function () {
        const saved = paths.slice();
        for (const p of pendingBlobs) {
          const blob = p.blob || p;
          const ext = p.ext || '.webp';
          saved.push(await Storage.uploadBlob(blob, 'img' + ext));
        }
        return saved;
      },
      getPaths: function () { return paths.slice(); }
    };
  }

  /* ---------- 物品表单 ---------- */
  /* ---------- 分类解析（v1.0.1：digital 树统一） ---------- */
  function catsFor(db, kind) {
    const key = (kind === 'digital' || kind === 'device' || kind === 'game') ? 'digital' : kind;
    return (db.categories[key] || []);
  }

  function kindOfCategory(db, kind, categoryId, subCategoryId) {
    if (kind !== 'digital') return kind;
    return (categoryId === 'game' || String(subCategoryId || '').indexOf('gm_') === 0) ? 'game' : 'device';
  }

  function isGameCategory(db, categoryId, subCategoryId) {
    return categoryId === 'game' || String(subCategoryId || '').indexOf('gm_') === 0;
  }

  function lab(req, key, text) {
    return text + (req[key] !== false ? '<span class="req-star"> *</span>' : '');
  }

  const STATUS_OPTS = [
    ['in_use', '在用'], ['idle', '闲置'], ['borrowed', '借出'],
    ['to_sell', '待出闲置'], ['broken', '损坏报废'],
    ['sold', '已售出（归档）'], ['gifted', '已转赠（归档）']
  ];

  /* ---------- 列表排序（v1.0.8）：字段 + 方向双向可调，三类通用 + 各类专属 ---------- */
  function cmpNumGet(get, dir) {
    return function (a, b) {
      const va = get(a), vb = get(b);
      const aN = va == null || isNaN(va), bN = vb == null || isNaN(vb);
      if (aN && bN) return 0;
      if (aN) return 1;   // 无值永远排最后，方向都不影响
      if (bN) return -1;
      return dir * (va - vb);
    };
  }
  const REMAIN_VAL = { '满': 1, '¾': 0.75, '½': 0.5, '¼': 0.25, '空': 0 };
  // cmp 一律为升序自然序；dir = 1 顺着排 / -1 反着排；dirs = [升序文案, 降序文案]
  const SORT_DEFS = [
    { key: 'date', label: '购买时间', kinds: ['digital', 'clothing', 'life'], defDir: -1,
      dirs: ['旧→新', '新→旧'],
      cmp: function (a, b) {
        const ka = a.purchaseDate || '', kb = b.purchaseDate || '';
        if (!ka && !kb) return 0; if (!ka) return 1; if (!kb) return -1;
        return ka.localeCompare(kb);
      } },
    { key: 'price', label: '购入价格', kinds: ['digital', 'clothing', 'life'], defDir: -1,
      dirs: ['低→高', '高→低'],
      cmp: cmpNumGet(function (i) {
        return (i.purchasePrice == null || i.purchasePrice === '') ? null : Number(i.purchasePrice);
      }, 1) },
    { key: 'uses', label: '使用次数', kinds: ['digital', 'clothing', 'life'], defDir: -1,
      dirs: ['少→多', '多→少'],
      cmp: cmpNumGet(function (i) { return (i.kind === 'clothing' ? i.wearCount : i.useCount) || 0; }, 1) },
    { key: 'cpw', label: '单次使用成本', kinds: ['clothing', 'life'], defDir: 1,
      dirs: ['低→高', '高→低'],
      cmp: cmpNumGet(function (i) { return i.cost && i.cost.costPerUse; }, 1) },
    { key: 'daily', label: '单日使用成本', kinds: ['digital'], defDir: -1,
      dirs: ['低→高', '高→低'],
      cmp: cmpNumGet(function (i) { return i.cost && i.cost.dailyCost; }, 1) },
    { key: 'held', label: '使用天数', kinds: ['digital', 'clothing', 'life'], defDir: -1,
      dirs: ['短→长', '长→短'],
      cmp: cmpNumGet(function (i) { return i.cost && i.cost.heldDays; }, 1) },
    { key: 'idle', label: '吃灰天数', kinds: ['digital', 'clothing', 'life'], defDir: -1,
      dirs: ['最近用过', '吃灰最久'],
      cmp: cmpNumGet(function (i) { return window.Models.idleDaysOf(window.Storage.getDB(), i); }, 1) },
    { key: 'name', label: '名称', kinds: ['digital', 'clothing', 'life'], defDir: 1,
      dirs: ['A→Z', 'Z→A'],
      cmp: function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'zh'); } },
    { key: 'cat', label: '分类归拢', kinds: ['digital', 'clothing', 'life'], defDir: 1,
      dirs: ['正序', '倒序'],
      cmp: function (a, b) {
        return String(a.categoryId || '').localeCompare(String(b.categoryId || '')) ||
          String(a.subCategoryId || '').localeCompare(String(b.subCategoryId || ''));
      } },
    { key: 'remain', label: '剩余量', kinds: ['life'], defDir: 1,
      dirs: ['少→多', '多→少'],
      cmp: cmpNumGet(function (i) { return REMAIN_VAL[i.remainLevel]; }, 1) },
    { key: 'fresh', label: '开封时长', kinds: ['life'], defDir: 1,
      dirs: ['开封最久→新', '新开→久'],
      cmp: function (a, b) {
        return String(a.openedDate || '￿').localeCompare(String(b.openedDate || '￿'));
      } },
    { key: 'pao', label: 'PAO 剩余', kinds: ['life'], defDir: 1,
      dirs: ['临期最紧→宽', '宽→最紧'],
      cmp: cmpNumGet(function (i) { return window.Models.lifeStatus(i).paoDaysLeft; }, 1) },
    { key: 'warranty', label: '保修剩余', kinds: ['digital'], defDir: 1,
      dirs: ['临期最紧→宽', '宽→最紧'],
      cmp: cmpNumGet(function (i) { const d = U.parseDate(i.warrantyEnd); return d ? d.getTime() : null; }, 1) }
  ];
  function sortOptionsFor(kind) {
    return SORT_DEFS.filter(function (d) { return d.kinds.indexOf(kind) >= 0; });
  }
  function sortDirLabel(key, dir) {
    const def = SORT_DEFS.find(function (d) { return d.key === key; });
    if (!def) return '';
    return dir === 1 ? def.dirs[0] : def.dirs[1];
  }
  function sortItems(list, key, dir, db) {
    const def = SORT_DEFS.find(function (d) { return d.key === key; });
    if (!def) return list;
    const d = dir === 1 ? 1 : -1;
    return list.slice().sort(function (a, b) { return d * def.cmp(a, b); });
  }

  function enumSel(list, cur, blank) {
    return '<option value="">' + (blank || '（不指定）') + '</option>' +
      (list || []).map(function (v) {
        return '<option value="' + U.escapeHtml(v) + '"' + (String(cur || '') === String(v) ? ' selected' : '') + '>' + U.escapeHtml(v) + '</option>';
      }).join('');
  }

  /* ---------- Lucide 图标（强制规范见 docs/UI-ICON-GUIDE.md） ---------- */
  const ICON_SIZES = { xs: 14, sm: 16, md: 20, lg: 24 };
  /* 规范扩展图标：lucide 缺失且语义必需时自绘（lucide 同风格 24 网格 / stroke 2 / 圆角端点），
     每枚必须在 docs/UI-ICON-GUIDE.md §7 登记 */
  const CUSTOM_ICONS = {
    pants: [['path', { d: 'M5 4h14l-1 5-1 11h-4l-1-9-1 9H8L7 9z' }]]
  };
  function icon(name, size) {
    size = Number(size) || 16;
    const key = String(name || '').split('-').map(function (p) {
      return p ? p.charAt(0).toUpperCase() + p.slice(1) : '';
    }).join('');
    const node = (window.lucide && window.lucide.icons && window.lucide.icons[key]) ||
      (CUSTOM_ICONS[name] ? ['svg', {}, CUSTOM_ICONS[name]] : null);
    if (!node || node[0] !== 'svg') {
      if (window.console && console.warn) console.warn('[icon] 未找到 lucide 图标: ' + name);
      return '<span class="ic ic-missing" style="width:' + size + 'px;height:' + size + 'px"></span>';
    }
    const attrs = node[1] || {};
    function ser(n) {
      if (!Array.isArray(n)) return '';
      const a = n[1] || {};
      // 属性值来自本地打包的 lucide 常量（可信），直接拼接
      return '<' + n[0] + Object.keys(a).map(function (k) {
        return ' ' + k + '="' + a[k] + '"';
      }).join('') + (n[2] && n[2].length ? '>' + n[2].map(ser).join('') + '</' + n[0] + '>' : '/>');
    }
    return '<svg class="ic" xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
      '" viewBox="' + (attrs.viewBox || '0 0 24 24') + '" fill="none" stroke="currentColor" stroke-width="' +
      (attrs['stroke-width'] || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (node[2] || []).map(ser).join('') + '</svg>';
  }
  /* 分类图标兼容：新值=lucide 名，旧数据=emoji（显示为文本不报错） */
  function iconOrEmoji(name, size) {
    if (name && /^[a-z0-9-]+$/.test(name)) return icon(name, size);
    return '<span class="ic ic-emoji" style="font-size:' + (Number(size) || 20) + 'px">' + U.escapeHtml(name || '') + '</span>';
  }

  function chips(name, list, cur) {
    const arr = Array.isArray(cur) ? cur : (cur ? [cur] : []);
    return (list || []).map(function (v) {
      const on = arr.indexOf(v) >= 0;
      return '<label class="chip-check"><input type="checkbox" name="' + name + '" value="' + U.escapeHtml(v) + '"' +
        (on ? ' checked' : '') + '><span>' + U.escapeHtml(v) + '</span></label>';
    }).join('');
  }

  /* 日历单元格公共件（穿搭/美食两日历共用，v1.0.9 抽取） */
  function calAddMini() {
    return '<button class="cal-add-mini" title="再记一条">' + icon('plus', 14) + '</button>';
  }
  function calHint() {
    return '<div class="cal-hint">' + icon('plus', 16) + '</div>';
  }
  function calNav() {
    return '<button class="cal-nav prev" data-nav-dir="-1" title="上一张">' + icon('chevron-left', 16) + '</button>' +
      '<button class="cal-nav next" data-nav-dir="1" title="下一张">' + icon('chevron-right', 16) + '</button>';
  }

  /* 标签 chip：非预设标签带 ×（仅移出本物品；库管理在设置页，v1.0.9） */
  function tagChipHTML(list, cur, presets) {
    const arr = Array.isArray(cur) ? cur : (cur ? [cur] : []);
    return (list || []).map(function (v) {
      const on = arr.indexOf(v) >= 0;
      const fixed = (presets || []).indexOf(v) >= 0;
      return '<span class="chip-wrap">' +
        '<label class="chip-check"><input type="checkbox" name="tags" value="' + U.escapeHtml(v) + '"' +
        (on ? ' checked' : '') + '><span>' + U.escapeHtml(v) + '</span></label>' +
        (fixed ? '' : '<button type="button" class="chip-del" data-del-tag="' + U.escapeHtml(v) + '" title="移出本物品">' + icon('x', 14) + '</button>') +
        '</span>';
    }).join('');
  }

  /* 自定义标签输入：回车/按钮把输入变成新 chip 并自动选中；× 删除标签（v1.0.7） */
  function bindTagAdd(root) {
    const row = root.querySelector('#tag-chips');
    const input = root.querySelector('#tag-new');
    const btn = root.querySelector('#tag-add-btn');
    if (!row || !input) return;
    const db = window.Storage.getDB();
    const presets = (db && db.categories && db.categories.tagPresets) || [];
    function currentVals() {
      return Array.from(row.querySelectorAll('input[name=tags]')).map(function (x) { return x.value; });
    }
    function currentSel() {
      return Array.from(row.querySelectorAll('input[name=tags]:checked')).map(function (x) { return x.value; });
    }
    function rerender(vals, sel) {
      row.innerHTML = tagChipHTML(vals, sel, presets);
    }
    function add() {
      const v = (input.value || '').trim();
      if (!v) { input.focus(); return; }
      const vals = currentVals();
      const sel = currentSel();
      if (vals.indexOf(v) < 0) vals.push(v);
      if (sel.indexOf(v) < 0) sel.push(v);
      rerender(vals, sel);
      input.value = '';
      input.focus();
    }
    // × 仅从当前物品移除并隐藏该 chip（本次表单）；标签库不动（库管理在设置页，v1.0.9 语义修正）
    row.addEventListener('click', function (e) {
      const del = e.target && e.target.closest ? e.target.closest('.chip-del') : null;
      if (!del) return;
      e.preventDefault();
      e.stopPropagation();
      const v = del.getAttribute('data-del-tag');
      rerender(currentVals().filter(function (x) { return x !== v; }),
        currentSel().filter(function (x) { return x !== v; }));
    });
    if (btn) btn.addEventListener('click', add);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); add(); }
    });
  }

  function itemFormHTML(db, item, kind) {
    const req = db.settings.requiredFields || {};
    const cats = catsFor(db, kind);
    const isDigital = kind === 'digital' || item.kind === 'device' || item.kind === 'game';

    const catOpts = cats.map(function (c) {
      return '<option value="' + c.id + '"' + (item.categoryId === c.id ? ' selected' : '') + '>' +
        U.escapeHtml(c.name) + '</option>';
    }).join('');
    const l1 = cats.find(function (c) { return c.id === item.categoryId; });
    const subOpts = ((l1 && l1.children) || []).map(function (c) {
      return '<option value="' + c.id + '"' + (item.subCategoryId === c.id ? ' selected' : '') + '>' +
        U.escapeHtml(c.name) + '</option>';
    }).join('');

    let html =
      '<div class="form-section"><div class="form-section-title">基础信息</div><div class="form-grid">' +
      '<label class="f-full"><span class="f-label">' + lab(req, 'name', '物品名称') + '</span>' +
      '<input name="name" value="' + U.escapeHtml(item.name || '') + '"></label>' +
      '<label><span class="f-label">' + lab(req, 'category', '分类') + '</span>' +
      '<select name="categoryId" id="f-cat"><option value="">请选择</option>' + catOpts + '</select></label>' +
      '<label><span class="f-label">子分类</span><select name="subCategoryId" id="f-sub">' +
      '<option value="">（可选）</option>' + subOpts + '</select></label>' +
      '<label><span class="f-label">' + lab(req, 'purchaseDate', '购买日期') + '</span>' +
      '<input type="date" name="purchaseDate" value="' + U.escapeHtml(item.purchaseDate || '') + '"></label>' +
      '<label><span class="f-label">' + lab(req, 'purchasePrice', '购入金额') + '</span>' +
      '<input type="number" step="0.01" name="purchasePrice" value="' +
      (item.purchasePrice !== null && item.purchasePrice !== undefined ? item.purchasePrice : '') + '"></label>' +
      '<label><span class="f-label">购入渠道</span><input name="channel" value="' + U.escapeHtml(item.channel || '') + '" placeholder="京东/闲鱼/线下…"></label>' +
      '<label><span class="f-label">存放位置</span><input name="storageLocation" value="' + U.escapeHtml(item.storageLocation || '') + '" placeholder="如：书房抽屉2"></label>' +
      '<label><span class="f-label">状态</span><select name="status" id="f-status">' +
      STATUS_OPTS.map(function (s) {
        return '<option value="' + s[0] + '"' + ((item.status || 'in_use') === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
      }).join('') + '</select></label>' +
      // 使用周期截止（v1.1.0）：非在用时补充停用时间，日均成本等使用类指标冻结在该日
      '<label id="f-retired-row"' + ((item.status || 'in_use') === 'in_use' ? ' style="display:none"' : '') + '>' +
      '<span class="f-label">停用时间</span><input type="date" name="retiredAt" value="' +
      U.escapeHtml(item.retiredAt || U.todayStr()) + '"></label>' +
      '<label><span class="f-label">品牌</span><input name="brand" value="' + U.escapeHtml(item.brand || '') + '"></label>' +
      '<label class="f-full"><span class="f-label">备注</span><input name="notes" value="' + U.escapeHtml(item.notes || '') + '"></label>' +
      '<div class="f-full"><span class="f-label">标签（可多选）</span><div class="chip-row" id="tag-chips">' +
      tagChipHTML((db.categories.tagPresets || []).concat(db.settings.customTags || []).concat(item.tags || []).filter(function (v, i, a) { return a.indexOf(v) === i; }), item.tags, db.categories.tagPresets || []) +
      '</div>' +
      '<div class="tag-add-row"><input id="tag-new" placeholder="自定义标签，回车添加">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="tag-add-btn">＋ 添加</button></div>' +
      '</div></div></div>';

    if (isDigital) {
      const deviceOpts = '<option value="">（无）</option>' + db.items.filter(function (i) {
        return (i.kind === 'device' || i.kind === 'game') && i.id !== item.id;
      }).map(function (i) {
        return '<option value="' + i.id + '"' + (item.parentItemId === i.id ? ' selected' : '') + '>' + U.escapeHtml(i.name) + '</option>';
      }).join('');
      html += '<div class="form-section"><div class="form-section-title">数码专属</div><div class="form-grid">' +
        '<label><span class="f-label">SN 序列号</span><input name="serialNumber" value="' + U.escapeHtml(item.serialNumber || '') + '" placeholder="保修/验机/出二手必备"></label>' +
        '<label><span class="f-label">型号</span><input name="model" value="' + U.escapeHtml(item.model || '') + '"></label>' +
        '<label><span class="f-label">配置参数</span><input name="configText" value="' + U.escapeHtml(item.configText || '') + '" placeholder="内存/硬盘/版本…"></label>' +
        '<label><span class="f-label">成色</span><select name="condition">' + enumSel(db.categories.condition, item.condition) + '</select></label>' +
        '<label><span class="f-label">保修截止</span><input type="date" name="warrantyEnd" value="' + U.escapeHtml(item.warrantyEnd || '') + '"></label>' +
        '<label><span class="f-label">固件版本</span><input name="firmware" value="' + U.escapeHtml(item.firmware || '') + '"></label>' +
        '<label><span class="f-label">电池健康度 %</span><input type="number" min="0" max="100" name="batteryHealth" value="' + (item.batteryHealth !== null && item.batteryHealth !== undefined ? item.batteryHealth : '') + '"></label>' +
        '<label><span class="f-label">绑定子配件</span><select name="parentItemId">' + deviceOpts + '</select></label>' +
        '<label><span class="f-label">预估寿命（年）</span><input type="number" step="0.5" name="estimatedLifeYears" value="' + (item.estimatedLifeYears || '') + '"></label>' +
        '<label><span class="f-label">预估二手价</span><input type="number" step="0.01" name="estimatedResalePrice" value="' + (item.estimatedResalePrice || '') + '"></label>' +
        '<label class="game-only"><span class="f-label">游玩状态</span><select name="gameStatus">' +
        [['unopened', '未开坑'], ['playing', '在玩'], ['finished', '已通关'], ['dropped', '弃坑']].map(function (s) {
          return '<option value="' + s[0] + '"' + ((item.gameStatus || 'unopened') === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
        }).join('') + '</select></label>' +
        '<label class="game-only"><span class="f-label">游玩时长（小时）</span><input type="number" step="0.1" name="playHours" value="' + (item.playHours || '') + '"></label>' +
        '</div></div>';
    }

    if (kind === 'clothing' || item.kind === 'clothing') {
      html += '<div class="form-section"><div class="form-section-title">服饰专属</div><div class="form-grid">' +
        '<label><span class="f-label">颜色</span><input name="color" value="' + U.escapeHtml(item.color || '') + '"></label>' +
        '<label><span class="f-label">尺码制</span><select name="sizeSystem">' + enumSel(db.categories.sizeSystem, item.sizeSystem) + '</select></label>' +
        '<label><span class="f-label">号型/尺码</span><input name="size" value="' + U.escapeHtml(item.size || '') + '" placeholder="如 165/88A、M、42"></label>' +
        '<label><span class="f-label">面料材质</span><input name="material" value="' + U.escapeHtml(item.material || '') + '"></label>' +
        '<label><span class="f-label">款式类型</span><input name="styleType" value="' + U.escapeHtml(item.styleType || '') + '" placeholder="修身/宽松/工装…"></label>' +
        '<label><span class="f-label">清洗方式</span><select name="washMethod">' + enumSel(db.categories.washMethod, item.washMethod) + '</select></label>' +
        '<label><span class="f-label">上次清洗日期</span><input type="date" name="lastCleanedDate" value="' + U.escapeHtml(item.lastCleanedDate || '') + '"></label>' +
        '<label><span class="f-label">手动穿着次数</span><input type="number" name="manualWearCount" value="' + (item.manualWearCount || 0) + '"></label>' +
        '<div class="f-full"><div class="chip-row">' +
        '<label class="chip-check"><input type="checkbox" name="wrinkleProne"' + (item.wrinkleProne ? ' checked' : '') + '><span>易皱</span></label>' +
        '<label class="chip-check"><input type="checkbox" name="valuable"' + (item.valuable ? ' checked' : '') + '><span>贵重</span></label>' +
        '<label class="chip-check"><input type="checkbox" name="keepTag"' + (item.keepTag ? ' checked' : '') + '><span>吊牌保留</span></label>' +
        '</div></div>' +
        '<div class="f-full"><span class="f-label">季节</span><div class="chip-row">' +
        chips('season', db.categories.season, item.season) + '</div></div>' +
        '<div class="f-full"><span class="f-label">适合场景</span><div class="chip-row">' +
        chips('occasion', db.categories.occasion, item.occasion) + '</div></div>' +
        '</div></div>';
    }

    if (kind === 'life' || item.kind === 'life') {
      html += '<div class="form-section"><div class="form-section-title">美妆专属</div><div class="form-grid">' +
        '<label><span class="f-label">色号/色名</span><input name="shade" value="' + U.escapeHtml(item.shade || '') + '"></label>' +
        '<label><span class="f-label">容量/规格</span><input name="spec" value="' + U.escapeHtml(item.spec || '') + '" placeholder="30ml / 5g…"></label>' +
        '<label><span class="f-label">开封日期（重点）</span><input type="date" name="openedDate" value="' + U.escapeHtml(item.openedDate || '') + '"></label>' +
        '<label><span class="f-label">PAO 开封保质</span><select name="paoMonths">' +
        [['', '不限'], ['3', '3M'], ['6', '6M'], ['12', '12M'], ['18', '18M'], ['24', '24M'], ['36', '36M']].map(function (s) {
          return '<option value="' + s[0] + '"' + (String(item.paoMonths || '') === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
        }).join('') + '</select></label>' +
        '<label><span class="f-label">未开封限用日期</span><input type="date" name="expiryDate" value="' + U.escapeHtml(item.expiryDate || '') + '"></label>' +
        '<label><span class="f-label">剩余量</span><select name="remainLevel">' + enumSel(db.categories.remainLevel, item.remainLevel, '（未记录）') + '</select></label>' +
        '<label><span class="f-label">用完日期（剩余量选「空」后填写）</span><input type="date" name="emptyDate" value="' + U.escapeHtml(item.emptyDate || '') + '"></label>' +
        '<label><span class="f-label">使用频率</span><select name="usageFreq">' + enumSel(db.categories.usageFreq, item.usageFreq) + '</select></label>' +
        '<label><span class="f-label">是否致敏</span><select name="allergenic">' +
        ['', '是', '否', '不确定'].map(function (v) {
          return '<option value="' + v + '"' + (item.allergenic === v ? ' selected' : '') + '>' + (v || '（不指定）') + '</option>';
        }).join('') + '</select></label>' +
        '<label><span class="f-label">使用次数</span><input type="number" name="useCount" value="' + (item.useCount || 0) + '"></label>' +
        '<div class="f-full"><span class="f-label">肤质适配</span><div class="chip-row">' +
        chips('skinType', db.categories.skinType, item.skinType) + '</div></div>' +
        '<div class="f-full"><div class="chip-row">' +
        '<label class="chip-check"><input type="checkbox" name="repurchase"' + (item.repurchase ? ' checked' : '') + '><span>加入回购清单</span></label>' +
        '</div></div></div></div>';
    }

    html += '<div class="form-section"><div class="form-grid"><div class="f-full">' +
      '<span class="f-label">图片（上传时可裁切/抠图）</span><div id="form-img-uploader"></div></div></div></div>';
    return html;
  }

  function bindFormToggles(formEl, db, kind) {
    const sel = formEl.querySelector('[name=categoryId]');
    const sub = formEl.querySelector('#f-sub');
    if (!sel) return;
    function update() {
      const cats = catsFor(db, kind === 'digital' ? 'digital' : (kind || 'digital'));
      const l1 = cats.find(function (c) { return c.id === sel.value; });
      if (sub) {
        const cur = sub.value;
        sub.innerHTML = '<option value="">（可选）</option>' +
          ((l1 && l1.children) || []).map(function (c) {
            return '<option value="' + c.id + '"' + (cur === c.id ? ' selected' : '') + '>' + U.escapeHtml(c.name) + '</option>';
          }).join('');
      }
      const isGame = isGameCategory(db, sel.value, sub && sub.value);
      formEl.querySelectorAll('.game-only').forEach(function (el) {
        el.style.display = isGame ? '' : 'none';
      });
    }
    sel.addEventListener('change', update);
    if (sub) sub.addEventListener('change', update);
    // 状态联动（v1.1.0）：非在用显示「停用时间」（默认今天），使用类指标从该日起冻结
    const statusSel = formEl.querySelector('#f-status');
    const retiredRow = formEl.querySelector('#f-retired-row');
    if (statusSel && retiredRow) {
      const retiredInput = retiredRow.querySelector('[name=retiredAt]');
      const syncRetired = function () {
        const off = statusSel.value !== 'in_use';
        retiredRow.style.display = off ? '' : 'none';
        if (off && retiredInput && !retiredInput.value) retiredInput.value = U.todayStr();
      };
      statusSel.addEventListener('change', syncRetired);
      syncRetired();
    }
    update();
  }

  function readItemForm(formEl, baseItem, kind) {
    const fd = new FormData(formEl);
    const item = Object.assign({}, baseItem);
    const db = window.Storage.getDB();
    item.categoryId = fd.get('categoryId') || '';
    item.subCategoryId = fd.get('subCategoryId') || '';
    item.name = (fd.get('name') || '').trim();
    item.status = fd.get('status') || 'in_use';
    // 使用周期截止：非在用记停用时间（表单补充，默认今天）；在用则清除恢复计时
    if (item.status !== 'in_use') {
      item.retiredAt = fd.get('retiredAt') || U.todayStr();
    } else {
      delete item.retiredAt;
    }
    item.purchaseDate = fd.get('purchaseDate') || '';
    const pp = fd.get('purchasePrice');
    item.purchasePrice = pp === '' || pp === null ? null : Number(pp);
    item.brand = (fd.get('brand') || '').trim();
    item.notes = (fd.get('notes') || '').trim();
    item.channel = (fd.get('channel') || '').trim();
    item.storageLocation = (fd.get('storageLocation') || '').trim();
    item.tags = fd.getAll('tags').filter(Boolean);
    // 自定义标签入个人标签库（预设不入库），下次录入直接可选（v1.0.7）
    if (item.tags.length) {
      const presets = db.categories.tagPresets || [];
      const lib = (db.settings.customTags || []).slice();
      let changed = false;
      item.tags.forEach(function (t) {
        if (presets.indexOf(t) < 0 && lib.indexOf(t) < 0) { lib.push(t); changed = true; }
      });
      if (changed) {
        db.settings.customTags = lib;
        window.Storage.saveSettings();
      }
    }
    item.kind = kind === 'digital'
      ? (kindOfCategory(db, 'digital', item.categoryId, item.subCategoryId) || 'device')
      : kind;

    if (item.kind === 'device' || item.kind === 'game') {
      item.serialNumber = (fd.get('serialNumber') || '').trim();
      item.model = (fd.get('model') || '').trim();
      item.configText = (fd.get('configText') || '').trim();
      item.condition = fd.get('condition') || '';
      item.warrantyEnd = fd.get('warrantyEnd') || '';
      item.firmware = (fd.get('firmware') || '').trim();
      const bh = fd.get('batteryHealth');
      item.batteryHealth = bh === '' ? null : Number(bh);
      item.parentItemId = fd.get('parentItemId') || '';
      const el = fd.get('estimatedLifeYears');
      item.estimatedLifeYears = el === '' ? null : Number(el);
      const er = fd.get('estimatedResalePrice');
      item.estimatedResalePrice = er === '' ? null : Number(er);
    }
    if (item.kind === 'game') {
      item.gameStatus = fd.get('gameStatus') || 'unopened';
      const ph = fd.get('playHours');
      item.playHours = ph === '' ? null : Number(ph);
    }
    if (item.kind === 'clothing') {
      item.color = (fd.get('color') || '').trim();
      item.sizeSystem = fd.get('sizeSystem') || '';
      item.size = (fd.get('size') || '').trim();
      item.material = (fd.get('material') || '').trim();
      item.styleType = (fd.get('styleType') || '').trim();
      item.washMethod = fd.get('washMethod') || '';
      item.lastCleanedDate = fd.get('lastCleanedDate') || '';
      item.manualWearCount = Number(fd.get('manualWearCount')) || 0;
      item.wrinkleProne = fd.get('wrinkleProne') === 'on';
      item.valuable = fd.get('valuable') === 'on';
      item.keepTag = fd.get('keepTag') === 'on';
      item.season = fd.getAll('season').filter(Boolean);
      item.occasion = fd.getAll('occasion').filter(Boolean);
    }
    if (item.kind === 'life') {
      item.shade = (fd.get('shade') || '').trim();
      item.spec = (fd.get('spec') || '').trim();
      item.openedDate = fd.get('openedDate') || '';
      const pao = fd.get('paoMonths');
      item.paoMonths = pao === '' ? null : Number(pao);
      item.expiryDate = fd.get('expiryDate') || '';
      item.remainLevel = fd.get('remainLevel') || '';
      item.emptyDate = fd.get('emptyDate') || '';
      item.usageFreq = fd.get('usageFreq') || '';
      item.allergenic = fd.get('allergenic') || '';
      item.useCount = Number(fd.get('useCount')) || 0;
      item.skinType = fd.getAll('skinType').filter(Boolean);
      item.repurchase = fd.get('repurchase') === 'on';
    }
    return item;
  }


  /* ---------- 图文选择器（分类 tab + 搜索 + 图文卡片） ---------- */
  /**
   * renderPicker(container, items, selectedIds, opts)
   * items: [{id, name, images, categoryName}]
   */
  function picker(container, items, selectedIds, opts) {
    opts = opts || {};
    const selected = new Set(selectedIds || []);
    let activeCat = '';
    let keyword = '';
    // 缩略图统一异步解析（v1.0.7）：组合编辑/打卡等所有调用方自动出图，
    // 不再各自手写转换补丁
    const thumbMap = {};
    function thumbOf(i) {
      return i.thumb || thumbMap[i.id] || '';
    }
    function resolveThumbs() {
      const jobs = items.map(function (i) {
        if (thumbOf(i)) return null;
        const p = (i.images && i.images[0]) || i.thumbPath || '';
        if (!p) return null;
        return window.Storage.getImageURL(p).then(function (url) {
          if (url) thumbMap[i.id] = url;
        }).catch(function () {});
      }).filter(Boolean);
      if (!jobs.length) return;
      Promise.all(jobs).then(function () {
        if (container.isConnected === false) return; // 弹窗已关，不再重绘
        render();
      });
    }

    function render() {
      const cats = [];
      items.forEach(function (i) {
        const c = i.categoryName || '其他';
        if (cats.indexOf(c) < 0) cats.push(c);
      });
      let list = items;
      if (activeCat) list = list.filter(function (i) { return (i.categoryName || '其他') === activeCat; });
      if (keyword) {
        const q = keyword.toLowerCase();
        list = list.filter(function (i) {
          return (i.name || '').toLowerCase().indexOf(q) >= 0 ||
            ((i.brand || '') + (i.shade || '')).toLowerCase().indexOf(q) >= 0;
        });
      }
      container.innerHTML =
        '<div class="picker-search"><input type="search" id="pk-search" placeholder="搜索名称 / 品牌 / 色号…" value="' + U.escapeHtml(keyword) + '"></div>' +
        '<div class="picker-tabs">' +
        '<button class="ptab' + (activeCat === '' ? ' on' : '') + '" data-cat="">全部</button>' +
        cats.map(function (c) {
          return '<button class="ptab' + (activeCat === c ? ' on' : '') + '" data-cat="' + U.escapeHtml(c) + '">' + U.escapeHtml(c) + '</button>';
        }).join('') + '</div>' +
        '<div class="picker-grid">' +
        (list.length ? list.map(function (i) {
          const on = selected.has(i.id);
          return '<div class="pick-card' + (on ? ' on' : '') + '" data-pid="' + i.id + '">' +
            (thumbOf(i)
              ? '<img src="' + U.escapeHtml(thumbOf(i)) + '"/>'
              : '<div class="pick-noimg">' + iconOrEmoji(opts.icon || 'package', 32) + '</div>') +
            '<div class="pick-name">' + U.escapeHtml(i.name) + '</div>' +
            (on ? '<div class="pick-check">' + icon('check', 16) + '</div>' : '') +
            '</div>';
        }).join('') : '<p class="empty-hint">没有匹配的物品</p>') +
        '</div>';

      const searchEl = container.querySelector('#pk-search');
      searchEl.addEventListener('input', U.debounce(function (e) {
        keyword = e.target.value;
        render();
        const s = container.querySelector('#pk-search');
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      }, 250));
      container.querySelectorAll('.ptab').forEach(function (b) {
        b.addEventListener('click', function () {
          activeCat = b.getAttribute('data-cat');
          render();
        });
      });
      container.querySelectorAll('.pick-card').forEach(function (card) {
        card.addEventListener('click', function () {
          const id = card.getAttribute('data-pid');
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          render();
          if (opts.onChange) opts.onChange(Array.from(selected));
        });
      });
    }
    render();
    resolveThumbs();
    return {
      getSelected: function () { return Array.from(selected); },
      setSelected: function (ids) { selected.clear(); (ids || []).forEach(function (i) { selected.add(i); }); render(); }
    };
  }

  /* ---------- 卡片 ---------- */
  function catIcon(db, item, size) {
    size = Number(size) || 20;
    const key = (item.kind === 'device' || item.kind === 'game') ? 'digital' : item.kind;
    const list = (db && db.categories && db.categories[key]) || [];
    const cat = list.find(function (c) { return c.id === item.categoryId; });
    if (cat && cat.icon) return iconOrEmoji(cat.icon, size);
    if (cat && cat.children) {
      const sub = cat.children.find(function (c) { return c.id === item.subCategoryId; });
      if (sub && sub.icon) return iconOrEmoji(sub.icon, size);
    }
    return icon({ device: 'gamepad-2', game: 'disc-3', clothing: 'shirt', life: 'heart' }[item.kind] || 'package', size);
  }

  /* 卡片信息行：跟随当前排序字段展示对应数值（v1.0.8），无对应则回退成本行 */
  function sortValueLine(sortKey, item, db) {
    switch (sortKey) {
      case 'date': return item.purchaseDate ? '购于 ' + item.purchaseDate : '';
      case 'price': return item.purchasePrice != null ? U.formatMoney(item.purchasePrice) : '';
      case 'uses': return ((item.kind === 'clothing' ? item.wearCount : item.useCount) || 0) + ' 次';
      case 'cpw': return item.cost && item.cost.costPerUse != null ? U.formatCost(item.cost.costPerUse) + ' / 次' : '暂无使用记录';
      case 'daily': return item.cost && item.cost.dailyCost != null ? U.formatCost(item.cost.dailyCost) + ' / 天' : '';
      case 'held': {
        if (!item.cost || item.cost.heldDays == null) return '';
        const stopped = item.retiredAt || item.soldDate;
        return (stopped ? '共使用 ' : '已使用 ') + item.cost.heldDays + ' 天';
      }
      case 'idle': {
        // 已停用显示「已停用」（排序仍按数值参与）
        if (item.retiredAt || item.soldDate) return '已停用';
        const d = window.Models.idleDaysOf(db, item);
        return d <= 1 ? '刚用过' : '吃灰 ' + d + ' 天';
      }
      case 'remain': return item.remainLevel ? '剩余 ' + item.remainLevel : '';
      case 'fresh': return item.openedDate ? '开封 ' + item.openedDate : '未开封';
      case 'pao': {
        const s = window.Models.lifeStatus(item);
        return s.paoState === 'expired' ? 'PAO 已过期'
          : s.paoState === 'near' ? 'PAO 余 ' + s.paoDaysLeft + ' 天'
            : (item.paoMonths ? 'PAO ' + item.paoMonths + ' 个月' : '');
      }
      case 'warranty': return item.warrantyEnd ? '保修至 ' + item.warrantyEnd : '';
      case 'cat': {
        const key = (item.kind === 'device' || item.kind === 'game') ? 'digital' : item.kind;
        const list = catsFor(db, key);
        const l1 = list.find(function (c) { return c.id === item.categoryId; });
        const sub = l1 && l1.children ? l1.children.find(function (c) { return c.id === item.subCategoryId; }) : null;
        return sub ? sub.name : (l1 ? l1.name : '');
      }
      default: return ''; // 名称等：值已在卡片标题，回退成本行
    }
  }

  function itemCard(item, opts) {
    opts = opts || {};
    const cost = item.cost || {};
    const img = (item.images && item.images[0]) ? item.images[0] : '';
    const db = window.Storage.getDB();
    let badges = '';
    if (item.status === 'sold') badges += '<span class="badge badge-sold">已售</span>';
    else if (item.status === 'empty' || item.remainLevel === '空') badges += '<span class="badge badge-empty">空瓶</span>';
    else if (item.status === 'idle') badges += '<span class="badge badge-idle">闲置</span>';
    if (item.kind === 'game' && item.gameStatus) {
      badges += '<span class="badge badge-game">' + { unopened: '未开坑', playing: '在玩', finished: '通关', dropped: '弃坑' }[item.gameStatus] + '</span>';
    }
    if (item.kind === 'clothing') badges += '<span class="badge badge-wear">穿 ' + item.wearCount + ' 次</span>';
    if (item.kind === 'life') badges += '<span class="badge badge-wear">用 ' + (item.useCount || 0) + ' 次</span>';

    let costLine = '';
    if (item.kind === 'clothing' || item.kind === 'life') {
      costLine = cost.costPerUse != null ? U.formatCost(cost.costPerUse) + ' / 次' : U.formatMoney(item.purchasePrice);
    } else if (item.kind === 'game') {
      costLine = cost.costPerHour ? U.formatCost(cost.costPerHour) + '/小时' : U.formatMoney(item.purchasePrice);
    } else {
      costLine = U.formatCost(cost.dailyCost) + ' / 天';
    }

    return '<div class="item-card" data-id="' + item.id + '">' +
      '<div class="item-thumb">' + (img
        ? '<img data-path="' + U.escapeHtml(img) + '" alt=""/>'
        : '<div class="item-noimg">' + catIcon(db, item, 48) + '</div>') +
      '<div class="item-badges">' + badges + '</div>' +
      (opts.quickAdd ? '<button class="quick-add" data-quick="' + item.id + '" title="' + (item.kind === 'clothing' ? '穿着 +1' : '使用 +1') + '">' + icon('plus', 12) + '1</button>' : '') +
      '</div>' +
      '<div class="item-info">' +
      '<div class="item-name" title="' + U.escapeHtml(item.name) + '">' + U.escapeHtml(item.name) + '</div>' +
      '<div class="item-meta">' + U.escapeHtml(item.brand || '') + (item.shade ? ' · ' + U.escapeHtml(item.shade) : '') + '</div>' +
      '<div class="item-cost">' + ((opts.sortKey ? sortValueLine(opts.sortKey, item, db) : '') || costLine) + '</div></div></div>';
  }

  /* ---------- 使用流水面板 ---------- */
  function usageLogHTML(item) {
    const log = (item.usageLog || []).slice().reverse();
    const sourceLabel = { manual: '手动', outfit: '打卡', edit: '修正' };
    return log.length
      ? log.map(function (l) {
        return '<div class="log-row">' +
          '<span class="log-delta ' + (l.delta >= 0 ? 'up' : 'down') + '">' + (l.delta >= 0 ? '+' : '') + l.delta + '</span>' +
          '<span class="muted">' + U.escapeHtml(l.date || '') + '</span>' +
          '<span class="tag">' + (sourceLabel[l.source] || U.escapeHtml(l.source || '手动')) + '</span>' +
          '<span class="flex1">' + U.escapeHtml(l.note || '') + '</span>' +
          '<button class="btn-icon" data-del-log="' + l.id + '" title="删除此条">' + icon('trash-2', 14) + '</button>' +
          '</div>';
      }).join('')
      : '<p class="empty-hint">暂无使用记录</p>';
  }

  /* ---------- 组合管理（妆容/穿搭通用）：列表 + 新建/编辑 + 范例图 ---------- */
  const COMBO_TEMPS = ['>30℃', '25~30℃', '20~25℃', '15~20℃', '10~15℃', '5~10℃', '0~5℃', '-5~0℃', '<-5℃'];
  const COMBO_SEASONS = ['春', '夏', '秋', '冬'];
  /* 组合温度 chip：自定义区间带 ×（仅移出该组合，v1.0.9） */
  function tempChipHTML(vals, sel) {
    return (vals || []).map(function (v) {
      const fixed = COMBO_TEMPS.indexOf(v) >= 0;
      const on = (sel || []).indexOf(v) >= 0;
      return '<span class="chip-wrap">' +
        '<label class="chip-check"><input type="checkbox" name="ctemp" value="' + U.escapeHtml(v) + '"' +
        (on ? ' checked' : '') + '><span>' + U.escapeHtml(v) + '</span></label>' +
        (fixed ? '' : '<button type="button" class="chip-del" data-del-temp="' + U.escapeHtml(v) + '" title="移除该区间">' + icon('x', 14) + '</button>') +
        '</span>';
    }).join('');
  }

  /* 温度候选 = 细化档位 + 该组合已有的自定义区间（老的 5 档标签也兼容显示） */
  function tempCandidates(ed) {
    const extra = ((ed && ed.tempRanges) || []).filter(function (t) { return COMBO_TEMPS.indexOf(t) < 0; });
    return COMBO_TEMPS.concat(extra);
  }
  function comboBadges(c) {
    return (c.seasons || []).concat(c.tempRanges || []).map(function (t) {
      return '<span class="tag">' + U.escapeHtml(t) + '</span>';
    }).join('');
  }

  function comboManager(cfg) {
    // cfg: { title, icon, items, combos, onChange }
    // v1.0.7 两级弹窗：列表只管看/删/进编辑，编辑在独立弹窗，界面不再混作一团
    const combos = cfg.combos;

    function openList() {
      modal({
        title: cfg.title, width: 620,
        bodyHTML:
          (combos.length ? '<div class="combo-list">' + combos.map(function (c, i) {
            return '<div class="combo-row">' +
              (c.images && c.images[0]
                ? '<img class="combo-thumb" data-path="' + U.escapeHtml(c.images[0]) + '" alt=""/>'
                : '<div class="combo-thumb combo-thumb-empty">' + iconOrEmoji(cfg.icon || 'sparkles', 24) + '</div>') +
              '<div class="combo-info"><div class="combo-name">' + U.escapeHtml(c.name) + '</div>' +
              '<div class="combo-meta">' + comboBadges(c) +
              '<span class="muted small">' + (c.itemIds || []).length + ' 件物品' +
              ((c.images || []).length ? ' · 范例图 ' + c.images.length : '') + '</span></div></div>' +
              '<button class="btn btn-ghost btn-sm" data-edit-combo="' + i + '">编辑</button>' +
              '<button class="btn-icon" data-del-combo="' + i + '" title="删除">' + icon('trash-2', 14) + '</button></div>';
          }).join('') + '</div>'
            : '<p class="empty-hint">还没有' + U.escapeHtml(cfg.title) + '，点下方「新建组合」创建第一个</p>'),
        footerHTML: '<button class="btn btn-ghost" data-x="c">关闭</button>' +
          '<button class="btn btn-primary" data-x="n">＋ 新建组合</button>',
        onMount: function (wrap, close) {
          wrap.querySelectorAll('img[data-path]').forEach(async function (img) {
            const url = await window.Storage.getImageURL(img.getAttribute('data-path'));
            if (url) img.src = url;
          });
          wrap.querySelectorAll('[data-edit-combo]').forEach(function (b) {
            b.addEventListener('click', function () {
              close(); openEditor(Number(b.getAttribute('data-edit-combo')));
            });
          });
          wrap.querySelectorAll('[data-del-combo]').forEach(function (b) {
            b.addEventListener('click', async function () {
              if (!await confirmDialog('删除组合', '删除该组合？（不影响物品本身）')) return;
              combos.splice(Number(b.getAttribute('data-del-combo')), 1);
              cfg.onChange();
              toast('已删除', 'success');
              close(); openList();
            });
          });
          wrap.querySelector('[data-x=c]').addEventListener('click', close);
          wrap.querySelector('[data-x=n]').addEventListener('click', function () {
            close(); openEditor(-1);
          });
        }
      });
    }

    function openEditor(editIdx) {
      const ed = editIdx >= 0 ? combos[editIdx] : null;
      let navigated = false;
      modal({
        title: (ed ? '编辑组合 · ' : '新建组合 · ') + cfg.title, width: 720,
        bodyHTML:
          '<div class="form-grid">' +
          '<label class="f-full"><span class="f-label">组合名称</span>' +
          '<input id="combo-name" placeholder="如：日常通勤" value="' + U.escapeHtml(ed ? (ed.name || '') : '') + '"></label>' +
          '<label class="f-full"><span class="f-label">适配温度（可多选）</span><div class="chip-row" id="ctemp-chips">' +
          tempChipHTML(tempCandidates(ed), ed ? (ed.tempRanges || []) : []) + '</div>' +
          '<div class="tag-add-row"><input type="number" id="ctemp-min" placeholder="最低 ℃" style="width:92px">' +
          '<span class="muted">~</span>' +
          '<input type="number" id="ctemp-max" placeholder="最高 ℃" style="width:92px">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="ctemp-add">＋ 添加区间</button></div></label>' +
          '<label class="f-full"><span class="f-label">适配季节（可多选）</span><div class="chip-row">' +
          chips('cseason', COMBO_SEASONS, ed ? (ed.seasons || []) : []) + '</div></label></div>' +
          '<h4 class="detail-sub">选择成员物品</h4><div id="combo-picker"></div>' +
          '<h4 class="detail-sub">范例图（可多张，便于打卡时对照参考）</h4><div id="combo-imgs"></div>',
        footerHTML: '<button class="btn btn-ghost" data-x="c">取消</button>' +
          '<button class="btn btn-primary" data-x="s">' + (ed ? '保存修改' : '保存组合') + '</button>',
        // × / 遮罩关闭也回列表（列表是这棵流程的根）
        onClose: function () { if (!navigated) openList(); },
        onMount: function (wrap, close) {
          const pick = picker(wrap.querySelector('#combo-picker'), cfg.items,
            ed ? (ed.itemIds || []).slice() : [], {});
          const uploader = imageUploader(wrap.querySelector('#combo-imgs'),
            { paths: ed ? (ed.images || []).slice() : [] });
          // 自定义温度区间 → 生成选中 chip（v1.0.8）
          const trow = wrap.querySelector('#ctemp-chips');
          function addTempRange() {
            const a = Number(wrap.querySelector('#ctemp-min').value);
            const b = Number(wrap.querySelector('#ctemp-max').value);
            const minEl = wrap.querySelector('#ctemp-min');
            const maxEl = wrap.querySelector('#ctemp-max');
            if (minEl.value.trim() === '' || maxEl.value.trim() === '') { toast('请填写最低和最高温度', 'error'); return; }
            if (isNaN(a) || isNaN(b)) { toast('温度必须是数字', 'error'); return; }
            if (a > b) { toast('最低温度不能高于最高温度', 'error'); return; }
            const label = a + '~' + b + '℃';
            const vals = Array.from(trow.querySelectorAll('input[name=ctemp]')).map(function (x) { return x.value; });
            const sel = Array.from(trow.querySelectorAll('input[name=ctemp]:checked')).map(function (x) { return x.value; });
            if (vals.indexOf(label) < 0) vals.push(label);
            if (sel.indexOf(label) < 0) sel.push(label);
            trow.innerHTML = tempChipHTML(vals, sel);
            minEl.value = ''; maxEl.value = '';
          }
          const tbtn = wrap.querySelector('#ctemp-add');
          if (tbtn) tbtn.addEventListener('click', addTempRange);
          // 自定义区间 ×：仅移出该组合（v1.0.9）
          trow.addEventListener('click', function (e) {
            const del = e.target && e.target.closest ? e.target.closest('[data-del-temp]') : null;
            if (!del) return;
            e.preventDefault(); e.stopPropagation();
            const v = del.getAttribute('data-del-temp');
            const vals = Array.from(trow.querySelectorAll('input[name=ctemp]')).map(function (x) { return x.value; })
              .filter(function (x) { return x !== v; });
            const sel = Array.from(trow.querySelectorAll('input[name=ctemp]:checked')).map(function (x) { return x.value; })
              .filter(function (x) { return x !== v; });
            trow.innerHTML = tempChipHTML(vals, sel);
          });
          wrap.querySelector('[data-x=c]').addEventListener('click', function () {
            navigated = true; close(); openList();
          });
          wrap.querySelector('[data-x=s]').addEventListener('click', async function () {
            const name = wrap.querySelector('#combo-name').value.trim();
            const ids = pick.getSelected();
            if (!name) { toast('请填写组合名称', 'error'); return; }
            if (!ids.length) { toast('至少选择一件物品', 'error'); return; }
            const btn = wrap.querySelector('[data-x=s]');
            btn.disabled = true;
            try {
              const images = await uploader.finalize();
              const rec = {
                id: ed ? ed.id : U.uid(), name: name, itemIds: ids, images: images,
                tempRanges: Array.from(wrap.querySelectorAll('input[name=ctemp]:checked')).map(function (x) { return x.value; }),
                seasons: Array.from(wrap.querySelectorAll('input[name=cseason]:checked')).map(function (x) { return x.value; })
              };
              if (ed) combos[editIdx] = rec; else combos.push(rec);
              cfg.onChange();
              toast(ed ? '已保存' : '组合已保存', 'success');
              navigated = true; close(); openList();
            } catch (e) {
              toast('保存失败：' + e.message, 'error'); btn.disabled = false;
            }
          });
        }
      });
    }

    openList();
  }

  /* ---------- 日历多条记录选择器（先选后编辑） ---------- */
  function pickRecord(title, rows, cb) {
    modal({
      title: title, width: 520,
      bodyHTML: rows.map(function (r) {
        return '<div class="pick-rec-row" data-pick="' + r.id + '">' +
          (r.thumbPath ? '<img data-path="' + U.escapeHtml(r.thumbPath) + '" alt=""/>'
            : '<div class="pick-rec-thumb-empty">' + iconOrEmoji(r.icon || 'file-text', 24) + '</div>') +
          '<div class="flex1"><div>' + U.escapeHtml(r.text) + '</div>' +
          (r.sub ? '<div class="muted small">' + U.escapeHtml(r.sub) + '</div>' : '') + '</div>' +
          '<span class="muted">' + icon('chevron-right', 14) + '</span></div>';
      }).join(''),
      footerHTML: '<button class="btn btn-ghost" data-x="c">取消</button>' +
        '<button class="btn btn-primary" data-x="n">＋ 新增一条</button>',
      onMount: function (wrap, close) {
        wrap.querySelectorAll('img[data-path]').forEach(async function (img) {
          const url = await window.Storage.getImageURL(img.getAttribute('data-path'));
          if (url) img.src = url;
        });
        wrap.querySelectorAll('[data-pick]').forEach(function (row) {
          row.addEventListener('click', function () {
            close();
            cb(row.getAttribute('data-pick'));
          });
        });
        wrap.querySelector('[data-x=c]').addEventListener('click', close);
        wrap.querySelector('[data-x=n]').addEventListener('click', function () {
          close();
          cb(null);
        });
      }
    });
  }

  return {
    toast: toast, modal: modal, confirmDialog: confirmDialog,
    cropImage: cropImage, imageUploader: imageUploader, picker: picker,
    itemFormHTML: itemFormHTML, bindFormToggles: bindFormToggles, readItemForm: readItemForm,
    calAddMini: calAddMini, calHint: calHint, calNav: calNav,
    itemCard: itemCard, catsFor: catsFor, kindOfCategory: kindOfCategory, pickRecord: pickRecord, comboManager: comboManager,
    icon: icon, iconOrEmoji: iconOrEmoji, ICON_SIZES: ICON_SIZES,
    bindTagAdd: bindTagAdd, comboBadges: comboBadges,
    sortOptionsFor: sortOptionsFor, sortItems: sortItems, sortDirLabel: sortDirLabel,
    isGameCategory: isGameCategory, usageLogHTML: usageLogHTML, catIcon: catIcon
  };
})();
