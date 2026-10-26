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
      '<button class="modal-close" title="关闭">×</button></div>' +
      '<div class="modal-body">' + (opts.bodyHTML || '') + '</div>' +
      (opts.footerHTML ? '<div class="modal-foot">' + opts.footerHTML + '</div>' : '') +
      '</div>';
    document.body.appendChild(wrap);
    requestAnimationFrame(function () { wrap.classList.add('show'); });
    function close() {
      wrap.classList.remove('show');
      setTimeout(function () { wrap.remove(); }, 220);
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
      modal({
        title: title,
        bodyHTML: '<p class="confirm-text">' + U.escapeHtml(text) + '</p>',
        footerHTML: '<button class="btn btn-ghost" data-act="no">取消</button><button class="btn btn-danger" data-act="yes">确认</button>',
        onMount: function (wrap, close) {
          wrap.querySelector('[data-act=no]').addEventListener('click', function () { close(); resolve(false); });
          wrap.querySelector('[data-act=yes]').addEventListener('click', function () { close(); resolve(true); });
        }
      });
    });
  }

  /* ---------- 图片裁切弹窗（1:1）+ 一键抠图 ---------- */
  function cropImage(file) {
    return new Promise(function (resolve, reject) {
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
            '<label class="f-label">缩放</label>' +
            '<input type="range" id="crop-zoom" min="100" max="300" value="100">' +
            '<div class="crop-actions">' +
            '<button class="btn btn-ghost btn-sm" id="crop-cutout">✂️ 一键抠图</button>' +
            '<span class="muted small" id="crop-tip">拖动图片调整位置</span>' +
            '</div></div>',
          footerHTML:
            '<button class="btn btn-ghost" data-act="origin">使用原图</button>' +
            '<button class="btn btn-primary" data-act="ok">确认裁切</button>',
          onMount: function (wrap, close) {
            const canvas = wrap.querySelector('#crop-canvas');
            const ctx = canvas.getContext('2d');
            let cutoutCanvas = null;

            function fit() {
              const base = Math.max(frame / img.width, frame / img.height);
              scale = base * (Number(wrap.querySelector('#crop-zoom').value) / 100);
            }
            function draw() {
              ctx.clearRect(0, 0, frame, frame);
              ctx.fillStyle = '#f2f2f4';
              ctx.fillRect(0, 0, frame, frame);
              const w = img.width * scale, h = img.height * scale;
              const maxX = Math.max(0, (w - frame) / 2), maxY = Math.max(0, (h - frame) / 2);
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
                wrap.querySelector('#crop-tip').textContent = '抠图完成，可继续调整';
                btn.textContent = '✓ 已抠图';
              } catch (e) {
                wrap.querySelector('#crop-tip').textContent = '抠图失败：' + e.message;
                btn.textContent = '✂️ 一键抠图';
                btn.disabled = false;
              }
            });

            wrap.querySelector('[data-act=origin]').addEventListener('click', async function () {
              close();
              resolve({ blob: file, isCutout: false });
            });
            wrap.querySelector('[data-act=ok]').addEventListener('click', async function () {
              const out = cutoutCanvas || canvas;
              let blob;
              if (cutoutCanvas) {
                blob = await new Promise(function (res) { cutoutCanvas.toBlob(res, 'image/png'); });
              } else {
                blob = await new Promise(function (res) { canvas.toBlob(res, 'image/webp', 0.88); });
              }
              close();
              resolve({ blob: blob, isCutout: !!cutoutCanvas });
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
    const Storage = window.Storage;

    function render() {
      container.className = 'img-uploader';
      let html = '';
      paths.forEach(function (p, i) {
        html += '<div class="img-thumb" data-idx="' + i + '"><img data-path="' + U.escapeHtml(p) + '" alt=""/>' +
          '<button class="img-del" title="删除">×</button></div>';
      });
      pendingBlobs.forEach(function (b, i) {
        html += '<div class="img-thumb" data-pidx="' + i + '"><img data-fidx="' + i + '" alt=""/>' +
          '<button class="img-del" title="移除">×</button></div>';
      });
      html += '<label class="img-add"><span>＋<br>添加图片</span><input type="file" accept="image/*" multiple hidden></label>';
      container.innerHTML = html;

      container.querySelectorAll('img[data-path]').forEach(async function (img) {
        const url = await Storage.getImageURL(img.getAttribute('data-path'));
        if (url) img.src = url;
      });
      container.querySelectorAll('img[data-fidx]').forEach(function (img) {
        const f = pendingBlobs[Number(img.getAttribute('data-fidx'))];
        if (f) img.src = URL.createObjectURL(f.blob || f);
      });

      container.querySelector('input[type=file]').addEventListener('change', async function (e) {
        const files = Array.from(e.target.files || []);
        for (const f of files) {
          if (!f.type.startsWith('image/')) continue;
          try {
            const result = await cropImage(f);
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
  function catsFor(db, kind) {
    if (kind === 'digital') {
      return (db.categories.device || []).map(function (c) { return Object.assign({}, c, { _kind: 'device' }); })
        .concat((db.categories.game || []).map(function (c) { return Object.assign({}, c, { _kind: 'game' }); }));
    }
    return (db.categories[kind] || []).map(function (c) { return Object.assign({}, c, { _kind: kind }); });
  }

  function kindOfCategory(db, kind, categoryId) {
    if (kind !== 'digital') return kind;
    return (db.categories.game || []).some(function (c) { return c.id === categoryId; }) ? 'game' : 'device';
  }

  function isGameCategory(db, categoryId) {
    return (db.categories.game || []).some(function (c) { return c.id === categoryId; });
  }

  function lab(req, key, text) {
    return text + (req[key] !== false ? '<span class="req-star"> *</span>' : '');
  }

  function itemFormHTML(db, item, kind) {
    const req = db.settings.requiredFields || {};
    const cats = catsFor(db, kind);
    const catOpts = cats.map(function (c) {
      return '<option value="' + c.id + '"' + (item.categoryId === c.id ? ' selected' : '') + '>' + U.escapeHtml(c.name) + '</option>';
    }).join('');
    const statusOpts = [
      ['in_use', '在用'], ['idle', '闲置'], ['empty', '已用完'], ['sold', '已出售'],
      ['gifted', '已转赠'], ['broken', '已损坏'], ['collected', '收藏'], ['dropped', '丢弃']
    ].map(function (s) {
      return '<option value="' + s[0] + '"' + ((item.status || 'in_use') === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
    }).join('');

    let html = '<div class="form-grid">' +
      '<label class="f-full"><span class="f-label">' + lab(req, 'name', '名称') + '</span>' +
      '<input name="name" value="' + U.escapeHtml(item.name || '') + '"></label>' +
      '<label><span class="f-label">' + lab(req, 'category', '种类') + '</span>' +
      '<select name="categoryId" id="f-cat"><option value="">请选择</option>' + catOpts + '</select></label>';

    if (kind === 'life') {
      const l1 = (db.categories.life || []).find(function (c) { return c.id === item.categoryId; });
      const children = (l1 && l1.children) || [];
      html += '<label><span class="f-label">子分类</span><select name="subCategoryId" id="f-sub"><option value="">（可选）</option>' +
        children.map(function (c) {
          return '<option value="' + c.id + '"' + (item.subCategoryId === c.id ? ' selected' : '') + '>' + U.escapeHtml(c.name) + '</option>';
        }).join('') + '</select></label>';
    }

    html += '<label><span class="f-label">状态</span><select name="status">' + statusOpts + '</select></label>' +
      '<label><span class="f-label">' + lab(req, 'purchaseDate', '购买日期') + '</span>' +
      '<input type="date" name="purchaseDate" value="' + U.escapeHtml(item.purchaseDate || '') + '"></label>' +
      '<label><span class="f-label">' + lab(req, 'purchasePrice', '购买价格') + '</span>' +
      '<input type="number" step="0.01" name="purchasePrice" value="' +
      (item.purchasePrice !== null && item.purchasePrice !== undefined ? item.purchasePrice : '') + '"></label>' +
      '<label><span class="f-label">品牌</span><input name="brand" value="' + U.escapeHtml(item.brand || '') + '"></label>' +
      '<label><span class="f-label">型号/规格</span><input name="model" value="' + U.escapeHtml(item.model || '') + '"></label>' +
      '<label><span class="f-label">备注</span><input name="notes" value="' + U.escapeHtml(item.notes || '') + '"></label>';

    if (kind === 'digital' || kind === 'device' || kind === 'game') {
      const deviceOpts = '<option value="">（无）</option>' + db.items.filter(function (i) {
        return (i.kind === 'device' || i.kind === 'game') && i.id !== item.id;
      }).map(function (i) {
        return '<option value="' + i.id + '"' + (item.parentItemId === i.id ? ' selected' : '') + '>' + U.escapeHtml(i.name) + '</option>';
      }).join('');
      html += '<label><span class="f-label">序列号</span><input name="serialNumber" value="' + U.escapeHtml(item.serialNumber || '') + '"></label>';
      html += '<label><span class="f-label">保修到期</span><input type="date" name="warrantyEnd" value="' + U.escapeHtml(item.warrantyEnd || '') + '"></label>';
      html += '<label><span class="f-label">购买渠道</span><input name="channel" value="' + U.escapeHtml(item.channel || '') + '"></label>';
      html += '<label><span class="f-label">归属主机</span><select name="parentItemId">' + deviceOpts + '</select></label>';
      html += '<label><span class="f-label">预估寿命（年）</span><input type="number" step="0.5" name="estimatedLifeYears" value="' + (item.estimatedLifeYears || '') + '"></label>';
      html += '<label><span class="f-label">残值率</span><input type="number" step="0.01" name="residualRate" value="' +
        (item.residualRate !== null && item.residualRate !== undefined ? item.residualRate : '') + '"></label>';
      html += '<label><span class="f-label">预估二手价</span><input type="number" step="0.01" name="estimatedResalePrice" value="' + (item.estimatedResalePrice || '') + '"></label>';
      html += '<label><span class="f-label">最近使用日期</span><input type="date" name="lastUsedDate" value="' + U.escapeHtml(item.lastUsedDate || '') + '"></label>';
      html += '<label class="game-only"><span class="f-label">游玩状态</span><select name="gameStatus">' +
        [['unopened', '未开坑'], ['playing', '在玩'], ['finished', '已通关'], ['dropped', '弃坑']].map(function (s) {
          return '<option value="' + s[0] + '"' + ((item.gameStatus || 'unopened') === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
        }).join('') + '</select></label>';
      html += '<label class="game-only"><span class="f-label">游玩时长（小时）</span><input type="number" step="0.1" name="playHours" value="' + (item.playHours || '') + '"></label>';
    }

    if (kind === 'life') {
      html += '<label><span class="f-label">色号/色名</span><input name="shade" value="' + U.escapeHtml(item.shade || '') + '"></label>';
      html += '<label><span class="f-label">规格（ml/g）</span><input name="spec" value="' + U.escapeHtml(item.spec || '') + '"></label>';
      html += '<label><span class="f-label">开封日期</span><input type="date" name="openedDate" value="' + U.escapeHtml(item.openedDate || '') + '"></label>';
      html += '<label><span class="f-label">开封后可用（PAO）</span><select name="paoMonths">' +
        [['', '不限'], ['3', '3 个月'], ['6', '6 个月'], ['12', '12 个月'], ['18', '18 个月'], ['24', '24 个月'], ['36', '36 个月']].map(function (s) {
          return '<option value="' + s[0] + '"' + (String(item.paoMonths || '') === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
        }).join('') + '</select></label>';
      html += '<label><span class="f-label">用完日期（空瓶）</span><input type="date" name="emptyDate" value="' + U.escapeHtml(item.emptyDate || '') + '"></label>';
      html += '<label><span class="f-label">使用次数</span><input type="number" name="useCount" id="f-use" value="' + (item.useCount || 0) + '"></label>';
      html += '<div class="f-full"><label class="chip-check"><input type="checkbox" name="repurchase"' +
        (item.repurchase ? ' checked' : '') + '><span>加入回购清单</span></label></div>';
    }

    if (kind === 'clothing') {
      html += '<label><span class="f-label">颜色</span><input name="color" value="' + U.escapeHtml(item.color || '') + '"></label>';
      html += '<label><span class="f-label">尺码</span><input name="size" value="' + U.escapeHtml(item.size || '') + '"></label>';
      html += '<label><span class="f-label">材质</span><input name="material" value="' + U.escapeHtml(item.material || '') + '"></label>';
      html += '<label><span class="f-label">手动穿着次数</span><input type="number" name="manualWearCount" value="' + (item.manualWearCount || 0) + '"></label>';
      const seasonList = db.categories.season || [];
      const occasionList = db.categories.occasion || [];
      html += '<div class="f-full"><span class="f-label">适用季节</span><div class="chip-row">' +
        seasonList.map(function (s) {
          const on = (item.season || []).indexOf(s) >= 0;
          return '<label class="chip-check"><input type="checkbox" name="season" value="' + U.escapeHtml(s) + '"' + (on ? ' checked' : '') + '><span>' + U.escapeHtml(s) + '</span></label>';
        }).join('') + '</div></div>';
      html += '<div class="f-full"><span class="f-label">场合标签</span><div class="chip-row">' +
        occasionList.map(function (s) {
          const on = (item.occasion || []).indexOf(s) >= 0;
          return '<label class="chip-check"><input type="checkbox" name="occasion" value="' + U.escapeHtml(s) + '"' + (on ? ' checked' : '') + '><span>' + U.escapeHtml(s) + '</span></label>';
        }).join('') + '</div></div>';
    }

    html += '<div class="f-full"><span class="f-label">图片（上传时可裁切/抠图）</span><div id="form-img-uploader"></div></div></div>';
    return html;
  }

  function bindFormToggles(formEl, db, kind) {
    const sel = formEl.querySelector('[name=categoryId]');
    if (!sel) return;
    function update() {
      if (kind === 'digital') {
        const isGame = isGameCategory(db, sel.value);
        formEl.querySelectorAll('.game-only').forEach(function (el) {
          el.style.display = isGame ? '' : 'none';
        });
      }
      if (kind === 'life') {
        const l1 = (db.categories.life || []).find(function (c) { return c.id === sel.value; });
        const sub = formEl.querySelector('#f-sub');
        if (sub) {
          sub.innerHTML = '<option value="">（可选）</option>' + ((l1 && l1.children) || []).map(function (c) {
            return '<option value="' + c.id + '">' + U.escapeHtml(c.name) + '</option>';
          }).join('');
        }
      }
    }
    sel.addEventListener('change', update);
    update();
  }

  function readItemForm(formEl, baseItem, kind) {
    const fd = new FormData(formEl);
    const item = Object.assign({}, baseItem);
    const db = window.Storage.getDB();
    item.categoryId = fd.get('categoryId') || '';
    item.name = (fd.get('name') || '').trim();
    item.status = fd.get('status') || 'in_use';
    item.purchaseDate = fd.get('purchaseDate') || '';
    const pp = fd.get('purchasePrice');
    item.purchasePrice = pp === '' || pp === null ? null : Number(pp);
    item.brand = (fd.get('brand') || '').trim();
    item.model = (fd.get('model') || '').trim();
    item.notes = (fd.get('notes') || '').trim();
    item.kind = kind === 'digital' ? (kindOfCategory(db, 'digital', item.categoryId) || 'device') : kind;

    if (item.kind === 'device' || item.kind === 'game') {
      item.serialNumber = (fd.get('serialNumber') || '').trim();
      item.warrantyEnd = fd.get('warrantyEnd') || '';
      item.channel = (fd.get('channel') || '').trim();
      item.parentItemId = fd.get('parentItemId') || '';
      const el = fd.get('estimatedLifeYears');
      item.estimatedLifeYears = el === '' ? null : Number(el);
      const rr = fd.get('residualRate');
      item.residualRate = rr === '' ? null : Number(rr);
      const er = fd.get('estimatedResalePrice');
      item.estimatedResalePrice = er === '' ? null : Number(er);
      item.lastUsedDate = fd.get('lastUsedDate') || '';
    }
    if (item.kind === 'game') {
      item.gameStatus = fd.get('gameStatus') || 'unopened';
      const ph = fd.get('playHours');
      item.playHours = ph === '' ? null : Number(ph);
    }
    if (item.kind === 'life') {
      item.subCategoryId = fd.get('subCategoryId') || '';
      item.shade = (fd.get('shade') || '').trim();
      item.spec = (fd.get('spec') || '').trim();
      item.openedDate = fd.get('openedDate') || '';
      const pao = fd.get('paoMonths');
      item.paoMonths = pao === '' ? null : Number(pao);
      item.emptyDate = fd.get('emptyDate') || '';
      item.useCount = Number(fd.get('useCount')) || 0;
      item.repurchase = fd.get('repurchase') === 'on';
    }
    if (item.kind === 'clothing') {
      item.color = (fd.get('color') || '').trim();
      item.size = (fd.get('size') || '').trim();
      item.material = (fd.get('material') || '').trim();
      item.manualWearCount = Number(fd.get('manualWearCount')) || 0;
      item.season = fd.getAll('season').filter(Boolean);
      item.occasion = fd.getAll('occasion').filter(Boolean);
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
            (i.thumb
              ? '<img src="' + i.thumb + '"/>'
              : '<div class="pick-noimg">' + (opts.icon || '📦') + '</div>') +
            '<div class="pick-name">' + U.escapeHtml(i.name) + '</div>' +
            (on ? '<div class="pick-check">✓</div>' : '') +
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
    return {
      getSelected: function () { return Array.from(selected); },
      setSelected: function (ids) { selected.clear(); (ids || []).forEach(function (i) { selected.add(i); }); render(); }
    };
  }

  /* ---------- 卡片 ---------- */
  function catIcon(db, item) {
    const list = (db && db.categories && db.categories[item.kind]) || [];
    const cat = list.find(function (c) { return c.id === item.categoryId; });
    if (cat && cat.icon) return cat.icon;
    if (cat && cat.children) {
      const sub = cat.children.find(function (c) { return c.id === item.subCategoryId; });
      if (sub && sub.icon) return sub.icon;
    }
    return { device: '🎮', game: '💿', clothing: '👕', life: '💄' }[item.kind] || '📦';
  }

  function itemCard(item, opts) {
    opts = opts || {};
    const cost = item.cost || {};
    const img = (item.images && item.images[0]) ? item.images[0] : '';
    const db = window.Storage.getDB();
    let badges = '';
    if (item.status === 'sold') badges += '<span class="badge badge-sold">已售</span>';
    else if (item.status === 'empty') badges += '<span class="badge badge-empty">空瓶</span>';
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
        : '<div class="item-noimg">' + catIcon(db, item) + '</div>') +
      '<div class="item-badges">' + badges + '</div>' +
      (opts.quickAdd ? '<button class="quick-add" data-quick="' + item.id + '" title="使用 +1">＋1</button>' : '') +
      '</div>' +
      '<div class="item-info">' +
      '<div class="item-name" title="' + U.escapeHtml(item.name) + '">' + U.escapeHtml(item.name) + '</div>' +
      '<div class="item-meta">' + U.escapeHtml(item.brand || '') + (item.shade ? ' · ' + U.escapeHtml(item.shade) : '') + '</div>' +
      '<div class="item-cost">' + costLine + '</div></div></div>';
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
          '<span class="tag">' + (sourceLabel[l.source] || l.source || '手动') + '</span>' +
          '<span class="flex1">' + U.escapeHtml(l.note || '') + '</span>' +
          '<button class="btn-icon" data-del-log="' + l.id + '" title="删除此条">×</button>' +
          '</div>';
      }).join('')
      : '<p class="empty-hint">暂无使用记录</p>';
  }

  return {
    toast: toast, modal: modal, confirmDialog: confirmDialog,
    cropImage: cropImage, imageUploader: imageUploader, picker: picker,
    itemFormHTML: itemFormHTML, bindFormToggles: bindFormToggles, readItemForm: readItemForm,
    itemCard: itemCard, catsFor: catsFor, kindOfCategory: kindOfCategory,
    isGameCategory: isGameCategory, usageLogHTML: usageLogHTML, catIcon: catIcon
  };
})();
