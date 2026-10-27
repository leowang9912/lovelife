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

  function enumSel(list, cur, blank) {
    return '<option value="">' + (blank || '（不指定）') + '</option>' +
      (list || []).map(function (v) {
        return '<option value="' + U.escapeHtml(v) + '"' + (String(cur || '') === String(v) ? ' selected' : '') + '>' + U.escapeHtml(v) + '</option>';
      }).join('');
  }

  function chips(name, list, cur) {
    const arr = Array.isArray(cur) ? cur : (cur ? [cur] : []);
    return (list || []).map(function (v) {
      const on = arr.indexOf(v) >= 0;
      return '<label class="chip-check"><input type="checkbox" name="' + name + '" value="' + U.escapeHtml(v) + '"' +
        (on ? ' checked' : '') + '><span>' + U.escapeHtml(v) + '</span></label>';
    }).join('');
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
      '<label><span class="f-label">状态</span><select name="status">' +
      STATUS_OPTS.map(function (s) {
        return '<option value="' + s[0] + '"' + ((item.status || 'in_use') === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
      }).join('') + '</select></label>' +
      '<label><span class="f-label">品牌</span><input name="brand" value="' + U.escapeHtml(item.brand || '') + '"></label>' +
      '<label class="f-full"><span class="f-label">备注</span><input name="notes" value="' + U.escapeHtml(item.notes || '') + '"></label>' +
      '<div class="f-full"><span class="f-label">标签（可多选）</span><div class="chip-row">' +
      chips('tags', (db.categories.tagPresets || []).concat(item.tags || []).filter(function (v, i, a) { return a.indexOf(v) === i; }), item.tags) +
      '</div></div></div></div>';

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
    item.purchaseDate = fd.get('purchaseDate') || '';
    const pp = fd.get('purchasePrice');
    item.purchasePrice = pp === '' || pp === null ? null : Number(pp);
    item.brand = (fd.get('brand') || '').trim();
    item.notes = (fd.get('notes') || '').trim();
    item.channel = (fd.get('channel') || '').trim();
    item.storageLocation = (fd.get('storageLocation') || '').trim();
    item.tags = fd.getAll('tags').filter(Boolean);
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
    const key = (item.kind === 'device' || item.kind === 'game') ? 'digital' : item.kind;
    const list = (db && db.categories && db.categories[key]) || [];
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

  /* ---------- 组合管理（妆容/穿搭通用）：列表 + 新建/编辑 + 范例图 ---------- */
  function comboManager(cfg) {
    // cfg: { title, icon, items, combos, onChange }
    const combos = cfg.combos;
    let editIdx = -1;

    function open() {
      modal({
        title: cfg.title, width: 680,
        bodyHTML:
          (combos.length ? '<div class="combo-list">' + combos.map(function (c, i) {
            return '<div class="mini-row combo-row">' +
              (c.images && c.images[0]
                ? '<img class="combo-thumb" data-path="' + U.escapeHtml(c.images[0]) + '" alt=""/>'
                : '<div class="combo-thumb combo-thumb-empty">' + U.escapeHtml(cfg.icon || '✨') + '</div>') +
              '<span class="flex1"><strong>' + U.escapeHtml(c.name) + '</strong>' +
              '<span class="muted small">（' + (c.itemIds || []).length + ' 件' +
              ((c.images || []).length ? ' · 范例图 ' + c.images.length : '') + '）</span></span>' +
              '<button class="btn-icon" data-edit-combo="' + i + '" title="编辑">✎</button>' +
              '<button class="btn-icon" data-del-combo="' + i + '" title="删除">×</button></div>';
          }).join('') + '</div>' : '<p class="empty-hint">还没有' + U.escapeHtml(cfg.title) + '</p>') +
          '<h4 class="detail-sub">' + (editIdx >= 0 ? '编辑组合' : '新建组合') + '</h4>' +
          '<div class="form-grid"><label class="f-full"><span class="f-label">组合名称</span>' +
          '<input id="combo-name" placeholder="如：日常通勤"></label></div>' +
          '<div id="combo-picker"></div>' +
          '<h4 class="detail-sub">范例图（可多张，便于打卡时对照参考）</h4>' +
          '<div id="combo-imgs"></div>',
        footerHTML: '<button class="btn btn-ghost" data-x="c">关闭</button>' +
          '<button class="btn btn-primary" data-x="s">' + (editIdx >= 0 ? '保存修改' : '保存组合') + '</button>',
        onMount: function (wrap, close) {
          const editing = editIdx >= 0 ? combos[editIdx] : null;
          if (editing) wrap.querySelector('#combo-name').value = editing.name || '';
          let pick = picker(wrap.querySelector('#combo-picker'), cfg.items,
            editing ? (editing.itemIds || []).slice() : [], {});
          const uploader = imageUploader(wrap.querySelector('#combo-imgs'),
            { paths: editing ? (editing.images || []).slice() : [] });
          wrap.querySelectorAll('img[data-path]').forEach(async function (img) {
            const url = await window.Storage.getImageURL(img.getAttribute('data-path'));
            if (url) img.src = url;
          });
          wrap.querySelectorAll('[data-edit-combo]').forEach(function (b) {
            b.addEventListener('click', function () {
              editIdx = Number(b.getAttribute('data-edit-combo'));
              close(); open();
            });
          });
          wrap.querySelectorAll('[data-del-combo]').forEach(function (b) {
            b.addEventListener('click', async function () {
              if (!await confirmDialog('删除组合', '删除该组合？（不影响物品本身）')) return;
              const i = Number(b.getAttribute('data-del-combo'));
              combos.splice(i, 1);
              if (editIdx === i) editIdx = -1;
              cfg.onChange();
              close(); open();
            });
          });
          wrap.querySelector('[data-x=c]').addEventListener('click', function () {
            editIdx = -1; close();
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
              const rec = { id: editing ? editing.id : U.uid(), name: name, itemIds: ids, images: images };
              if (editing) combos[editIdx] = rec; else combos.push(rec);
              cfg.onChange();
              toast(editing ? '已保存' : '组合已保存', 'success');
              editIdx = -1;
              close(); open();
            } catch (e) {
              toast('保存失败：' + e.message, 'error'); btn.disabled = false;
            }
          });
        }
      });
    }
    open();
  }

  /* ---------- 日历多条记录选择器（先选后编辑） ---------- */
  function pickRecord(title, rows, cb) {
    modal({
      title: title, width: 520,
      bodyHTML: rows.map(function (r) {
        return '<div class="pick-rec-row" data-pick="' + r.id + '">' +
          (r.thumbPath ? '<img data-path="' + U.escapeHtml(r.thumbPath) + '" alt=""/>'
            : '<div class="pick-rec-thumb-empty">' + U.escapeHtml(r.icon || '📄') + '</div>') +
          '<div class="flex1"><div>' + r.text + '</div>' +
          (r.sub ? '<div class="muted small">' + r.sub + '</div>' : '') + '</div>' +
          '<span class="muted">›</span></div>';
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
    itemCard: itemCard, catsFor: catsFor, kindOfCategory: kindOfCategory, pickRecord: pickRecord, comboManager: comboManager,
    isGameCategory: isGameCategory, usageLogHTML: usageLogHTML, catIcon: catIcon
  };
})();
