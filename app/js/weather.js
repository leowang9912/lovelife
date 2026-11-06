/* weather.js — 目标日温度区间（当日锁定）+ 穿搭推荐（v1.0.8）
 *
 * 设计要点：
 * - 坐标来自浏览器定位（带缓存）；天气预报只需坐标，不需要地名
 * - 温度一律是区间（当日最低~最高），不是单值
 * - fetchedAt 仅在数据真正获取/设定成功时更新——保证"刷新时间"可信
 * - 每天首次获取成功后锁定；手动刷新强制重取，失败保留上次数据
 * - 当天已打卡 → 推荐目标改为次日
 */
window.Weather = (function () {
  const U = window.Utils;

  // WMO 天气码 → 中文 + lucide 图标名（规范见 docs/UI-ICON-GUIDE.md §4.4）
  const WMO = {
    0: ['晴', 'sun'], 1: ['大部晴', 'cloud-sun'], 2: ['多云', 'cloud'], 3: ['阴', 'cloudy'],
    45: ['雾', 'cloud-fog'], 48: ['雾凇', 'cloud-fog'],
    51: ['毛毛雨', 'cloud-drizzle'], 53: ['毛毛雨', 'cloud-drizzle'], 55: ['毛毛雨', 'cloud-drizzle'],
    61: ['小雨', 'cloud-drizzle'], 63: ['中雨', 'cloud-rain'], 65: ['大雨', 'cloud-rain-wind'],
    66: ['冻雨', 'cloud-hail'], 67: ['冻雨', 'cloud-hail'],
    71: ['小雪', 'cloud-snow'], 73: ['中雪', 'cloud-snow'], 75: ['大雪', 'snowflake'], 77: ['雪粒', 'snowflake'],
    80: ['阵雨', 'cloud-sun-rain'], 81: ['阵雨', 'cloud-sun-rain'], 82: ['强阵雨', 'cloud-lightning'],
    85: ['阵雪', 'cloud-snow'], 86: ['阵雪', 'cloud-snow'],
    95: ['雷雨', 'cloud-lightning'], 96: ['雷雨冰雹', 'cloud-lightning'], 99: ['雷雨冰雹', 'cloud-lightning']
  };

  const GEO_KEY = 'lovelife-geo';    // {lat, lon}
  const WX_PREFIX = 'lovelife-wx-';  // 按日期锁定的天气记录

  // 缓存键加账号前缀（乙4）：天气/定位缓存不跨账号共享（与钱袋「最近分类」同口径）
  function accKey(base) {
    let acc = '';
    try { acc = String((window.Storage && window.Storage.accId && window.Storage.accId()) || ''); } catch (e) {}
    return acc ? acc + ':' + base : base;
  }

  function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(accKey(key)) || 'null'); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(accKey(key), JSON.stringify(val)); } catch (e) {}
  }

  /* 数据时间戳：只在数据真正获取/设定成功时记录 */
  function nowStamp() {
    const n = new Date();
    return (n.getMonth() + 1) + '-' + n.getDate() + ' ' +
      String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  }

  /* 带超时的 JSON 请求，绝不干等 */
  function fetchJson(url, ms) {
    return new Promise(function (resolve, reject) {
      const ac = new AbortController();
      const timer = setTimeout(function () { ac.abort(); }, ms || 6000);
      fetch(url, { signal: ac.signal }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      }).then(function (j) {
        clearTimeout(timer); resolve(j);
      }, function (e) { clearTimeout(timer); reject(e); });
    });
  }

  /* 坐标：浏览器定位（带缓存）；拿不到返回 null（可手动填温度区间） */
  function browserGeo() {
    return new Promise(function (resolve) {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
      let done = false;
      const finish = function (g) { if (!done) { done = true; resolve(g); } };
      try {
        navigator.geolocation.getCurrentPosition(function (pos) {
          finish({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        }, function () { finish(null); }, { timeout: 8000, maximumAge: 6 * 3600 * 1000 });
      } catch (e) { finish(null); }
    });
  }

  async function getCoords() {
    const c = lsGet(GEO_KEY);
    if (c && c.lat != null && c.lon != null) return c;
    const g = await browserGeo();
    if (!g) return null;
    const saved = { lat: g.lat, lon: g.lon };
    lsSet(GEO_KEY, saved);
    return saved;
  }

  /* 天气预报：目标日温度区间（成功才带 fetchedAt） */
  async function fetchForecast(lat, lon) {
    const j = await fetchJson('https://api.open-meteo.com/v1/forecast?latitude=' + lat +
      '&longitude=' + lon + '&daily=temperature_2m_min,temperature_2m_max,weather_code' +
      '&timezone=auto&forecast_days=2', 8000);
    const d = j.daily || {};
    const out = {};
    const stamp = nowStamp();
    const seq = Date.now(); // 数据序号：用于判定"本次是否真的取到新数据"（分钟级时间戳不够用）
    (d.time || []).forEach(function (date, i) {
      const w = WMO[(d.weather_code || [])[i]] || ['未知', 'cloud'];
      out[date] = {
        min: Math.round(Number((d.temperature_2m_min || [])[i])),
        max: Math.round(Number((d.temperature_2m_max || [])[i])),
        desc: w[0], icon: w[1], source: 'auto', fetchedAt: stamp, seq: seq
      };
    });
    return out;
  }

  /* 失败原因（甲18-③）：'' / 'geo'=定位失败 / 'net'=网络失败，调用方据此给不同提示 */
  let lastFail = '';
  function failReason() { return lastFail; }

  /* 清定位缓存（甲18-①）：「重新定位」按钮用，下次取坐标重新走浏览器定位 */
  function clearGeo() {
    try { localStorage.removeItem(accKey(GEO_KEY)); } catch (e) {}
  }

  /**
   * 取目标日温度区间 {min,max,desc,icon,source,fetchedAt}
   * - 当日首次获取成功后锁定，不反复请求；手动设定值当日优先（source=manual）
   * - force=true 强制重取（手动刷新）；失败保留上次数据、fetchedAt 不变
   */
  async function dayRange(dateStr, force) {
    lastFail = '';
    const key = WX_PREFIX + dateStr;
    const hit = lsGet(key);
    const locked = hit && hit.min != null && hit.fetchedAt ? hit : null;
    if (!force && locked) return locked;
    const geo = await getCoords();
    if (!geo) { lastFail = 'geo'; return locked; }
    try {
      const fc = await fetchForecast(geo.lat, geo.lon);
      const rec = fc[dateStr];
      if (!rec) return locked;
      lsSet(key, rec);
      return rec;
    } catch (e) {
      console.warn('天气获取失败', e);
      lastFail = 'net';
      return locked;
    }
  }

  /* 只取不存（甲18-②）：刷新/重新定位用——拿到的自动数据先给调用方，
     确认覆盖手动设定后才 applyAuto 落盘，杜绝"手动温度点刷新被静默覆盖" */
  async function fetchAuto(dateStr) {
    lastFail = '';
    const geo = await getCoords();
    if (!geo) { lastFail = 'geo'; return null; }
    try {
      const fc = await fetchForecast(geo.lat, geo.lon);
      const rec = fc[dateStr];
      if (!rec) { lastFail = 'net'; return null; }
      return rec;
    } catch (e) {
      console.warn('天气获取失败', e);
      lastFail = 'net';
      return null;
    }
  }

  function applyAuto(dateStr, rec) {
    if (!rec) return null;
    lsSet(WX_PREFIX + dateStr, rec);
    return rec;
  }

  /* 手动填入温度区间（仅该日有效，覆盖自动；fetchedAt=填入时刻） */
  function setManual(dateStr, min, max) {
    const rec = {
      min: Math.round(Number(min)), max: Math.round(Number(max)),
      desc: '手动设定', icon: 'pencil-line', source: 'manual', fetchedAt: nowStamp(), seq: Date.now()
    };
    lsSet(WX_PREFIX + dateStr, rec);
    return rec;
  }

  /* 推荐目标日：当天已有打卡 → 次日 */
  function targetDate(db) {
    const today = U.todayStr();
    const doneToday = (db.outfits || []).some(function (o) { return o.date === today; });
    if (doneToday) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return { date: U.todayStr(d), doneToday: true };
    }
    return { date: today, doneToday: false };
  }

  /* 穿搭记录的温度区间：优先 tempMin/tempMax，兼容旧的单值 temperature */
  function outfitRange(o) {
    if (o.tempMin != null || o.tempMax != null) {
      const a = Number(o.tempMin != null ? o.tempMin : o.tempMax);
      const b = Number(o.tempMax != null ? o.tempMax : o.tempMin);
      return { min: Math.min(a, b), max: Math.max(a, b) };
    }
    if (o.temperature != null && !isNaN(Number(o.temperature))) {
      const t = Number(o.temperature);
      return { min: t, max: t };
    }
    return null;
  }
  /* 两温度区间距离：0=有重叠，>0=区间之间的空隙 */
  function rangeDist(a, b) {
    if (a.max < b.min) return b.min - a.max;
    if (a.min > b.max) return a.min - b.max;
    return 0;
  }

  /* 穿搭推荐：目标日温度区间 → 温度相近的历史穿搭 + 区间重叠/同季的组合 */
  function recommend(db, range, dateStr) {
    const season = U.monthSeason(dateStr);
    const scored = [];
    (db.outfits || []).forEach(function (o) {
      if (o.date === dateStr) return;
      let score = null;
      const or = outfitRange(o);
      if (range && range.min != null && or) {
        const dist = rangeDist(or, range);
        if (dist === 0) score = 0;        // 温度区间有重叠：最优先
        else if (dist <= 3) score = dist;  // 相差 3℃ 以内：次优先，越近越靠前
      }
      if (score == null && o.date && U.monthSeason(o.date) === season) score = 10;
      if (score != null) scored.push({ rec: o, score: score });
    });
    scored.sort(function (a, b) {
      return a.score - b.score || String(b.rec.date || '').localeCompare(String(a.rec.date || ''));
    });
    const combos = [];
    (db.settings.outfitLooks || []).forEach(function (c) {
      const tHit = U.tempOverlap(c.tempRanges, range);
      const sHit = (c.seasons || []).indexOf(season) >= 0;
      if (tHit || sHit) combos.push({ combo: c, rank: tHit ? 0 : 1 });
    });
    combos.sort(function (a, b) { return a.rank - b.rank; });
    return {
      outfits: scored.slice(0, 4).map(function (x) { return x.rec; }),
      combos: combos.slice(0, 4).map(function (x) { return x.combo; }),
      season: season
    };
  }

  return {
    dayRange: dayRange, setManual: setManual,
    targetDate: targetDate, recommend: recommend,
    fetchAuto: fetchAuto, applyAuto: applyAuto,
    clearGeo: clearGeo, failReason: failReason
  };
})();
