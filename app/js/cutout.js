/* cutout.js — 一键抠图：优先 ONNX u2netp，回退为角落泛洪去底 */
window.Cutout = (function () {
  let session = null;
  let tried = false;
  let available = false;

  async function init() {
    if (tried) return available;
    tried = true;
    try {
      if (typeof ort === 'undefined') {
        // 动态加载 vendor/ort.min.js
        await new Promise(function (res, rej) {
          const s = document.createElement('script');
          s.src = 'vendor/ort.min.js';
          s.onload = res;
          s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      ort.env.wasm.wasmPaths = 'vendor/';
      const resp = await fetch('models/u2netp.onnx');
      if (!resp.ok) throw new Error('model missing');
      const buf = await resp.arrayBuffer();
      session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
      available = true;
    } catch (e) {
      console.warn('抠图模型不可用，使用颜色泛洪回退方案', e);
      available = false;
    }
    return available;
  }

  /* u2net 推理 */
  async function runModel(sourceCanvas) {
    const size = 320;
    const tmp = document.createElement('canvas');
    tmp.width = size; tmp.height = size;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size).data;
    const input = new Float32Array(1 * 3 * size * size);
    for (let i = 0, j = 0; i < img.length; i += 4, j++) {
      input[j] = (img[i] / 255 - 0.485) / 0.229;
      input[size * size + j] = (img[i + 1] / 255 - 0.456) / 0.224;
      input[2 * size * size + j] = (img[i + 2] / 255 - 0.406) / 0.225;
    }
    const tensor = new ort.Tensor('float32', input, [1, 3, size, size]);
    const feeds = {};
    feeds[session.inputNames[0]] = tensor;
    const results = await session.run(feeds);
    const out = results[session.outputNames[0]];
    return out.data; // length = size*size（d1 mask）
  }

  /* 回退：四角颜色泛洪去背景（适合白底/纯色底） */
  function floodFillCutout(sourceCanvas, tolerance) {
    tolerance = tolerance || 32;
    const w = sourceCanvas.width, h = sourceCanvas.height;
    const ctx = sourceCanvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const seeds = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
    const visited = new Uint8Array(w * h);
    const stack = [];
    const ref = [];
    seeds.forEach(function (s) {
      const idx = (s[1] * w + s[0]) * 4;
      ref.push([d[idx], d[idx + 1], d[idx + 2]]);
    });
    seeds.forEach(function (s) { stack.push(s); });
    while (stack.length) {
      const p = stack.pop();
      const x = p[0], y = p[1];
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const pi = y * w + x;
      if (visited[pi]) continue;
      const idx = pi * 4;
      let match = false;
      for (let r = 0; r < ref.length; r++) {
        const dist = Math.abs(d[idx] - ref[r][0]) + Math.abs(d[idx + 1] - ref[r][1]) + Math.abs(d[idx + 2] - ref[r][2]);
        if (dist < tolerance * 3) { match = true; break; }
      }
      if (!match) continue;
      visited[pi] = 1;
      d[idx + 3] = 0;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    // 边缘羽化：透明像素周围 1px 降低 alpha
    ctx.putImageData(img, 0, 0);
    return sourceCanvas;
  }

  /**
   * 对源 canvas 抠图，返回透明背景 canvas
   */
  async function cutout(sourceCanvas) {
    const ok = await init();
    const out = document.createElement('canvas');
    out.width = sourceCanvas.width; out.height = sourceCanvas.height;
    const octx = out.getContext('2d');
    octx.drawImage(sourceCanvas, 0, 0);
    if (ok && session) {
      try {
        const mask = await runModel(sourceCanvas);
        const size = 320;
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = size; maskCanvas.height = size;
        const mctx = maskCanvas.getContext('2d');
        const mid = mctx.createImageData(size, size);
        // u2net 输出 d1：0~1，前景高
        for (let i = 0; i < size * size; i++) {
          const v = mask[i] || 0;
          const a = v > 0.5 ? 255 : Math.round(v * 2 * 255);
          mid.data[i * 4] = 255; mid.data[i * 4 + 1] = 255; mid.data[i * 4 + 2] = 255;
          mid.data[i * 4 + 3] = a;
        }
        mctx.putImageData(mid, 0, 0);
        // 将 mask 缩放覆盖到输出
        octx.globalCompositeOperation = 'destination-in';
        octx.drawImage(maskCanvas, 0, 0, out.width, out.height);
        octx.globalCompositeOperation = 'source-over';
        return out;
      } catch (e) {
        console.warn('模型推理失败，回退颜色泛洪', e);
      }
    }
    return floodFillCutout(out);
  }

  return { init: init, cutout: cutout, isModelReady: function () { return available; } };
})();
