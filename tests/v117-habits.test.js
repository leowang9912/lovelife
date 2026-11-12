/* v117-habits.test.js — v1.1.7 热力打卡（habits 域）回归锁：
   1) habits 域 CRUD：saveHabitDef 自动补 id/色池色、就地更新、removeHabitDef 连带删 log
   2) toggleHabit 打卡/取消 + 补打历史日期（可补打过去的日子）
   3) 缺省与脏数据防御：缺 habits 域 / 脏 defs / 脏 log（loadAll normHabits）
   4) 统计口径：habitYearCount（当年，补打照计）/ habitCurrentStreak（今天未打不断签）/
      habitLongestStreak（自然日相邻、跨月跨年不断）
   5) persist('habits')/saveHabits 落盘：target=habits，{defs,log} 全量载荷
   6) serve 往返（内嵌 Python）：/api/save 白名单 + habits.json 落盘 + load_db 下发 +
      进盘/出盘类型防御 + 缺文件缺省
   7) 统计栏目 habitHeat：色点/当年打卡数/最长连续 + GitHub 式年热力格
      （列=周 52~53、行=周一~周日、格 11px、打过=习惯色、未打=浅灰 #f2f2f4）
   8) 年份切换：默认今年 → 去年 → 更早年（下限夹紧）→ 翻回今年（上限夹紧）
   9) 栏目体系：SECTION_META 注册 habitHeat（默认开启/可排序/开关/调宽）
   10) 空态引导：无习惯项 → empty-card「管理习惯」跳主页 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeWindow, waitFor, waitMain, assert, DEFAULT_DATA, APP } = require('./helpers/harness');

let cur = '';

function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dayN(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fmt(d);
}

/* 带 habits 域的窗口：harness 默认 /api/db 不下发 habits，这里整段覆盖该路由
   （约定：特殊接口一律用 opts.routes 覆盖，不改共享 harness） */
function dbWindow(opts) {
  opts = opts || {};
  const defaults = DEFAULT_DATA();
  const data = Object.assign({}, defaults, opts.data || {});
  if (opts.data && opts.data.wallet) data.wallet = Object.assign({}, defaults.wallet, opts.data.wallet);
  if (opts.data && opts.data.categories) data.categories = Object.assign({}, defaults.categories, opts.data.categories);
  const routes = Object.assign({}, opts.routes || {});
  routes['api/db'] = function (r) {
    return r.ok(JSON.parse(JSON.stringify({
      ok: true, schemaVersion: 3,
      account: { id: 'me', name: 'Me', icon: 'x' },
      accounts: [{ id: 'me', name: 'Me', icon: 'x' }],
      items: data.items, outfits: data.outfits, events: data.events, food: data.food,
      settings: data.settings, categories: data.categories, wallet: data.wallet,
      habits: data.habits,
      dataRoot: 'm'
    })));
  };
  return makeWindow({
    data: opts.data, routes: routes,
    saved: opts.saved, onSave: opts.onSave, onCall: opts.onCall
  });
}

const PY = new Date().getFullYear() - 1;
const PY2 = new Date().getFullYear() - 2;
const Y = new Date().getFullYear();
const TODAY = fmt(new Date());

/* 数据集 A（栏目渲染/年份切换共用）：
   h1：去年 1/1 + 去年 6/15~6/17（最长连续 3、去年打卡 4 天）+ 今天 1 天
   h2：前年 3/5（撑出年份下限）+ 去年 12/31 + 今年 1/1（跨年连续 2） */
const SET_A = {
  defs: [
    { id: 'h1', name: '运动', color: '#aecbfa' },
    { id: 'h2', name: '阅读', color: '#d7aefb' }
  ],
  log: {
    h1: (function () {
      const m = {};
      m[PY + '-01-01'] = true;
      m[PY + '-06-15'] = true;
      m[PY + '-06-16'] = true;
      m[PY + '-06-17'] = true;
      m[TODAY] = true;
      return m;
    })(),
    h2: (function () {
      const m = {};
      m[PY2 + '-03-05'] = true;
      m[PY + '-12-31'] = true;
      m[Y + '-01-01'] = true;
      return m;
    })()
  }
};

function daysInYear(y) {
  return (new Date(y + 1, 0, 1) - new Date(y, 0, 1)) / 86400000;
}

/* 统一 settings（habitSeeded 兼容旧版主页播种开关，无害）。
   注意：新版主页会向空 habits 纯内存注入预设三例，数据层用例在 waitMain 后
   统一 loadAll() 归零，从确定状态起步 */
const STG = { planSections: [], rememberAccount: true, habitSeeded: true };

async function main() {
  /* ==================== 1）habits 域 CRUD ==================== */
  cur = '1. habits 域 CRUD：saveHabitDef 自动补 id/色池色、就地更新、removeHabitDef 连带删 log';
  {
    const saved = {};
    const w = dbWindow({ saved: saved, data: { settings: STG } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    // 主页 UI 层会在首页渲染时向空 habits 注入预设三例（纯内存）；重新 loadAll 归零，
    // 让数据层用例从确定状态起步（不依赖主页 UI 行为）
    await S.loadAll();
    // 无 id 自动补 id；无颜色从 8 色池第 1 个循环取（与主页 UI 色板一致）
    await S.saveHabitDef({ name: '运动' });
    let defs = S.getDB().habits.defs;
    assert(defs.length === 1 && defs[0].id, 'saveHabitDef 新增应自动补 id');
    assert(defs[0].color === S.HABIT_COLORS[0], '无颜色应取色池第 1 色 #aecbfa，实为 ' + defs[0].color);
    const id = defs[0].id;
    // 就地更新（改名/换色）不产生第二条
    await S.saveHabitDef({ id: id, name: '跑步', color: '#d7aefb' });
    defs = S.getDB().habits.defs;
    assert(defs.length === 1 && defs[0].name === '跑步' && defs[0].color === '#d7aefb', 'saveHabitDef 应就地更新');
    // 删习惯连带删 log
    await S.toggleHabit(id, TODAY);
    assert(S.getDB().habits.log[id][TODAY] === true, 'toggleHabit 应写入打卡');
    await S.removeHabitDef(id);
    assert(S.getDB().habits.defs.length === 0, 'removeHabitDef 应删除习惯定义');
    assert(!S.getDB().habits.log[id], 'removeHabitDef 应连带删除该习惯的打卡记录');
    assert(saved.habits && saved.habits.defs.length === 0 && !saved.habits.log[id],
      '删除后落盘载荷应同步清空 defs/log');
    console.log('PASS ' + cur);
  }

  /* ==================== 2）toggleHabit 打卡/取消 + 补打 ==================== */
  cur = '2. toggleHabit 打卡/取消 + 补打历史日期（点历史格子打/取消）';
  {
    const saved = {};
    const w = dbWindow({ saved: saved, data: { settings: STG } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    await S.loadAll(); // 清掉主页 UI 层注入的预设（纯内存），从确定状态起步
    await S.saveHabitDef({ id: 'hX', name: '早睡', color: '#b7e1c1' });
    await S.toggleHabit('hX'); // 不传日期 = 今天
    assert(S.getDB().habits.log.hX[TODAY] === true, '默认应打今天');
    const past = dayN(10);
    await S.toggleHabit('hX', past); // 补打过去
    assert(S.getDB().habits.log.hX[past] === true, '应可补打过去的日子');
    assert(S.getDB().habits.log.hX[TODAY] === true, '补打不应影响今天');
    await S.toggleHabit('hX', past); // 同键再点 = 取消
    assert(!S.getDB().habits.log.hX[past], '同键再点应取消补打');
    await S.toggleHabit('hX'); // 取消今天
    assert(!((S.getDB().habits.log.hX || {})[TODAY]), '同键再点应取消今天');
    assert(!S.getDB().habits.log.hX, '全取消后不应残留空映射（不留孤儿键）');
    assert(saved.habits && saved.habits.log && !saved.habits.log.hX, '取消后落盘应同步');
    console.log('PASS ' + cur);
  }

  /* ==================== 3）缺省与脏数据防御 ==================== */
  cur = '3. 缺省与脏数据防御：缺 habits 域 / 脏 defs / 脏 log 元素';
  {
    // 缺 habits 域（旧服务端不下发）→ 缺省 {defs:[],log:{}}
    const w0 = makeWindow({ data: { settings: STG } });
    if (!(await waitMain(w0))) throw new Error('no main');
    await w0.Storage.loadAll(); // 重读归零（清掉主页 UI 层注入的纯内存预设）
    const hb0 = w0.Storage.getDB().habits;
    assert(hb0 && Array.isArray(hb0.defs) && hb0.defs.length === 0 && typeof hb0.log === 'object',
      '缺 habits 域应缺省 {defs:[],log:{}}，实为 ' + JSON.stringify(hb0));
    // 脏结构：非对象 defs 元素/缺 id 剔除；log 非法键/非对象值剔除
    const w1 = dbWindow({
      data: {
        habits: {
          defs: ['junk', { name: '缺id' }, { id: 'h_ok', name: '好', color: '#aecbfa' }],
          log: { h_ok: { '2026-01-01': true }, bad: 5, '': { '2026-01-01': true } }
        },
        settings: STG
      }
    });
    if (!(await waitMain(w1))) throw new Error('no main');
    const hb1 = w1.Storage.getDB().habits;
    assert(hb1.defs.length === 1 && hb1.defs[0].id === 'h_ok', '脏 defs 元素应剔除，实为 ' + JSON.stringify(hb1.defs));
    assert(Object.keys(hb1.log).join(',') === 'h_ok', '脏 log 键/值应剔除，实为 ' + JSON.stringify(hb1.log));
    assert(hb1.log.h_ok['2026-01-01'] === true, '合法打卡记录应保留');
    console.log('PASS ' + cur);
  }

  /* ==================== 4）统计口径 ==================== */
  cur = '4. 统计口径：habitYearCount/habitCurrentStreak/habitLongestStreak（跨年不断）';
  {
    const w = dbWindow({ data: { habits: JSON.parse(JSON.stringify(SET_A)), settings: STG } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    // 当年/去年打卡数（补打的历史日子照计）
    assert(S.habitYearCount('h1', PY) === 4, 'h1 去年打卡应 4 天，实为 ' + S.habitYearCount('h1', PY));
    assert(S.habitYearCount('h1', 2000) === 0, '无数据年份应 0');
    assert(S.habitYearCount('h2', PY2) === 1 && S.habitYearCount('h2', Y) === 1 && S.habitYearCount('h2', PY) === 1,
      'h2 三个年份应各 1 天（年份口径不串年）');
    // 最长连续：h1 = 去年 6/15~6/17 的 3 天；h2 = 去年 12/31 + 今年 1/1 跨年连续 2 天
    assert(S.habitLongestStreak('h1') === 3, 'h1 最长连续应 3 天，实为 ' + S.habitLongestStreak('h1'));
    assert(S.habitLongestStreak('h2') === 2, 'h2 跨年连续应 2 天（自然日相邻、跨年不断），实为 ' + S.habitLongestStreak('h2'));
    // 当前连续：h1 今天已打 → 今天数起 1 天（前天有记录但昨天断开）
    assert(S.habitCurrentStreak('h1') === 1, 'h1 当前连续应 1 天（昨天没打），实为 ' + S.habitCurrentStreak('h1'));
    // 今天没打不断签：h2 今天没打（最后一条 1/1）→ 0 天
    assert(S.habitCurrentStreak('h2') === 0, 'h2 当前连续应 0 天，实为 ' + S.habitCurrentStreak('h2'));
    // 构造"今天没打但昨天起连续 3 天"：从昨天往回数（今天不打不断签）
    await S.saveHabitDef({ id: 'h3', name: '喝水', color: '#a8e0e8' });
    await S.toggleHabit('h3', dayN(1));
    await S.toggleHabit('h3', dayN(2));
    await S.toggleHabit('h3', dayN(3));
    assert(S.habitCurrentStreak('h3') === 3, '今天未打应从昨天往回数 3 天，实为 ' + S.habitCurrentStreak('h3'));
    await S.toggleHabit('h3', TODAY);
    assert(S.habitCurrentStreak('h3') === 4, '今天打上应续到 4 天，实为 ' + S.habitCurrentStreak('h3'));
    assert(S.habitLongestStreak('h3') === 4, 'h3 最长连续应 4 天，实为 ' + S.habitLongestStreak('h3'));
    console.log('PASS ' + cur);
  }

  /* ==================== 5）persist('habits') 落盘 ==================== */
  cur = '5. persist/ saveHabits 落盘：target=habits，{defs,log} 全量载荷';
  {
    const saved = {};
    const w = dbWindow({ saved: saved, data: { habits: JSON.parse(JSON.stringify(SET_A)), settings: STG } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    await S.persist('habits');
    assert(saved.habits, 'persist("habits") 应 POST target=habits');
    assert(Array.isArray(saved.habits.defs) && saved.habits.defs.length === 2, '落盘 defs 应全量 2 条');
    assert(saved.habits.log.h1[PY + '-06-15'] === true && saved.habits.log.h2[PY + '-12-31'] === true,
      '落盘 log 应全量（含补打的历史键）');
    // saveHabits：直接改 db 后手动落盘（主页预设播种同路径）
    const snap = JSON.parse(JSON.stringify(saved.habits));
    S.getDB().habits.defs.push({ id: 'h9', name: '背单词', color: '#f7e6a1' });
    await S.saveHabits();
    assert(saved.habits.defs.length === 3 && saved.habits.defs[2].id === 'h9', 'saveHabits 应落盘整个 habits 域');
    assert(JSON.stringify(snap) !== JSON.stringify(saved.habits), 'saveHabits 应产生新载荷');
    console.log('PASS ' + cur);
  }

  /* ==================== 6）serve 往返（内嵌 Python） ==================== */
  cur = '6. serve 往返：/api/save 白名单 + habits.json 落盘 + load_db 下发 + 类型防御 + 缺省';
  {
    const py = [
      '# -*- coding: utf-8 -*-',
      'import json, os, sys, tempfile',
      'APP = sys.argv[1]',
      'if APP not in sys.path: sys.path.insert(0, APP)',
      'import serve',
      'root = tempfile.mkdtemp()',
      'serve.data_root = lambda: root',
      'ACC = [{"id": "me", "name": "Me", "icon": "x"}]',
      'serve.migrate_old_layout = lambda r: list(ACC)',
      'd = serve.acc_dir(root, "me")',
      'serve._read_unisolated.clear()',
      'class FakeHandler:',
      '    def _json(self, obj, code=200):',
      '        self.last = {"__resp": obj, "__code": code}',
      '        return self.last',
      '    def _read_body(self):',
      '        return json.dumps(self.body).encode("utf-8")',
      'def save(target, data):',
      '    h = FakeHandler()',
      '    h.body = {"target": target, "acc": "me", "data": data}',
      '    resp = serve.Handler._handle_save(h)',
      '    return resp["__code"], resp["__resp"]',
      'def read(fn):',
      '    with open(os.path.join(d, fn), encoding="utf-8") as f:',
      '        return json.load(f)',
      '# 1) 往返：save habits -> habits.json -> load_db 原样下发',
      'code, resp = save("habits", {',
      '    "defs": [{"id": "h1", "name": "运动", "color": "#aecbfa"},',
      '             {"id": "h2", "name": "阅读", "color": "#d7aefb"}],',
      '    "log": {"h1": {"2026-11-01": True, "2026-11-02": True}, "h2": {"2025-12-31": True}},',
      '})',
      'assert code == 200 and resp.get("ok"), resp',
      'disk = read("habits.json")',
      'assert [x["id"] for x in disk["defs"]] == ["h1", "h2"], disk',
      'assert disk["log"]["h1"]["2026-11-02"] is True and disk["log"]["h2"]["2025-12-31"] is True, disk',
      'assert disk.get("schemaVersion") == 3, disk',
      'db = serve.load_db("me")',
      'assert set(db["habits"].keys()) == {"defs", "log"}, db["habits"]',
      'assert [x["id"] for x in db["habits"]["defs"]] == ["h1", "h2"], db["habits"]',
      'assert db["habits"]["log"]["h1"]["2026-11-01"] is True, db["habits"]',
      '# 2) 白名单/类型防御：data 非 dict -> 400；log 非 dict 洗成 {}；脏 defs 元素剔除',
      'code, resp = save("habits", ["nope"])',
      'assert code == 400 and "data must be an object" in str(resp), (code, resp)',
      'code, resp = save("habits", {"defs": [{"id": "h1", "name": "运动"}, "junk", {"name": "no-id"}], "log": ["bad"]})',
      'assert code == 200 and resp.get("ok"), resp',
      'assert any("habits.log" in w for w in resp.get("warnings", [])), resp',
      'assert any("habits.defs" in w for w in resp.get("warnings", [])), resp',
      'disk = read("habits.json")',
      'assert [x["id"] for x in disk["defs"]] == ["h1"], disk["defs"]',
      'assert disk["log"] == {}, disk["log"]',
      '# 3) 出盘类型防御：脏 log 键/值剔除计 warnings（/api/db 不炸）',
      'with open(os.path.join(d, "habits.json"), "w", encoding="utf-8") as f:',
      '    json.dump({"schemaVersion": 3,',
      '               "defs": [{"id": "h1", "name": "运动"}, 7, {"name": "x"}],',
      '               "log": {"h1": {"2026-01-01": True}, "": {"2026-01-01": True}, "bad": 5}}, f)',
      'db = serve.load_db("me")',
      'assert [x["id"] for x in db["habits"]["defs"]] == ["h1"], db["habits"]',
      'assert list(db["habits"]["log"].keys()) == ["h1"], db["habits"]["log"]',
      'assert any("habits.defs" in w for w in db["warnings"]), db["warnings"]',
      'assert any("habits.log" in w for w in db["warnings"]), db["warnings"]',
      '# 4) 缺文件缺省 {defs:[], log:{}}',
      'os.remove(os.path.join(d, "habits.json"))',
      'db = serve.load_db("me")',
      'assert db["habits"] == {"defs": [], "log": {}}, db["habits"]',
      'print("SERVE_ROUNDTRIP_OK")'
    ].join('\n');
    const tmp = path.join(os.tmpdir(), 'v117-serve-roundtrip-' + process.pid + '.py');
    fs.writeFileSync(tmp, py, 'utf8');
    let r;
    try {
      r = spawnSync('python', ['-I', tmp, APP], {
        encoding: 'utf8',
        env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' })
      });
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) { /* noop */ }
    }
    assert(r.status === 0, 'serve 往返脚本失败: ' + (r.stdout || '') + (r.stderr || ''));
    assert(String(r.stdout).indexOf('SERVE_ROUNDTRIP_OK') >= 0, 'serve 往返未输出完成标记: ' + r.stdout);
    console.log('PASS ' + cur);
  }

  /* ==================== 7）统计栏目 habitHeat 渲染 ==================== */
  cur = '7. 统计栏目 habitHeat：色点/当年打卡数/最长连续 + GitHub 式年热力格（11px/周一~周日/色板）';
  {
    const w = dbWindow({ data: { habits: JSON.parse(JSON.stringify(SET_A)), settings: STG } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const doc = w.document;
    w.App.go('plan');
    const body = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.innerHTML.length > 50 ? el : null;
    }, { label: '热力打卡栏目未渲染' });
    const text = body.textContent;
    // 习惯块：名称 + 当年打卡数 + 最长连续（口径=Storage 同源）
    assert(text.indexOf('运动') >= 0 && text.indexOf('阅读') >= 0, '应展示全部习惯名');
    assert(text.indexOf('最长连续 3 天') >= 0, 'h1 最长连续应 3 天: ' + text.slice(0, 200));
    const yCount = S.habitYearCount('h1', Y);
    assert(text.indexOf('打卡 ' + yCount + ' 天') >= 0, '当年打卡数应与 Storage.habitYearCount 同源（' + yCount + '）: ' + text.slice(0, 200));
    // 色点（习惯色）进样式
    assert(body.innerHTML.indexOf('background:#aecbfa') >= 0, 'h1 色点应为 #aecbfa');
    assert(body.innerHTML.indexOf('background:#d7aefb') >= 0, 'h2 色点应为 #d7aefb');
    // 月块式年热力图（v1.1.5 定稿）：12 个独立月块（每月 7 列=周一~周日）、格 11px
    const grids = body.querySelectorAll('svg[data-habit-grid]');
    assert(grids.length === 2, '每个习惯一块热力格，实为 ' + grids.length);
    const g1 = grids[0];
    assert(g1.getAttribute('data-months') === '12', '应为 12 个独立月块');
    assert(g1.getAttribute('data-year') === String(Y), '默认展示今年');
    const rects = Array.from(g1.querySelectorAll('rect'));
    // 今年已过去的天数（含今天）= 画出的格数（未来日不画）
    const elapsed = Math.round((new Date(Y, Number(TODAY.slice(5, 7)) - 1, Number(TODAY.slice(8, 10))) -
      new Date(Y, 0, 1)) / 86400000) + 1;
    assert(rects.length === elapsed, '今年热力格应只画到今天（未来日不画），实为 ' + rects.length + ' / ' + elapsed);
    // 每月块内 7 列（周一~周日）：用 1 月的格子验证
    const jan = rects.filter(function (r) { return (r.getAttribute('data-hdate') || '').indexOf(Y + '-01-') === 0; });
    const jx = {};
    jan.forEach(function (r) { jx[r.getAttribute('x')] = 1; });
    assert(Object.keys(jx).length === 7, '每月块应 7 列（周一~周日），实为 ' + Object.keys(jx).length);
    // 格尺寸约 11px（11 + 2px 间隙）
    assert(rects[0].getAttribute('width') === '11' && rects[0].getAttribute('height') === '11', '格应 11px');
    // 打过=习惯色、未打=浅灰 #f2f2f4
    const onRects = rects.filter(function (r) { return r.getAttribute('data-on') === '1'; });
    assert(onRects.length === yCount, '打过格数应=当年打卡数，实为 ' + onRects.length);
    onRects.forEach(function (r) {
      assert(r.getAttribute('fill') === '#aecbfa', '打过格应为习惯色 #aecbfa，实为 ' + r.getAttribute('fill'));
      assert(/^\d{4}-\d{2}-\d{2}$/.test(r.getAttribute('data-hdate')), '格应带 YYYY-MM-DD 日期键');
    });
    const offRects = rects.filter(function (r) { return r.getAttribute('data-on') === '0'; });
    assert(offRects.length > 0 && offRects.every(function (r) { return r.getAttribute('fill') === '#f2f2f4'; }),
      '未打格应浅灰 #f2f2f4');
    // 月标签 12 个（1月~12月）
    const labels = Array.from(g1.querySelectorAll('text')).map(function (t) { return t.textContent; });
    for (let m = 1; m <= 12; m++) {
      assert(labels.indexOf(m + '月') >= 0, '热力格应带月标签 ' + m + '月');
    }
    console.log('PASS ' + cur);
  }

  /* ==================== 8）年份切换 ==================== */
  cur = '8. 年份切换：默认今年 → 去年 → 更早年（下限夹紧）→ 翻回今年（上限夹紧）';
  {
    const w = dbWindow({ data: { habits: JSON.parse(JSON.stringify(SET_A)), settings: STG } });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    w.App.go('plan');
    const body = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('svg[data-habit-grid]') ? el : null;
    }, { label: '热力打卡栏目未渲染' });
    // 默认今年 + 「今年」标签（v1.1.8 导航挪 head 右上：.hh-head-nav，标签/按钮在 panel 内找）
    const nav = doc.querySelector('.plan-sec[data-id=habitHeat]') || body;
    assert(body.querySelector('svg[data-habit-grid]').getAttribute('data-year') === String(Y), '默认应今年');
    assert(nav.textContent.indexOf(Y + ' 年') >= 0 && nav.textContent.indexOf('今年') >= 0, '默认应标注「今年」');
    // 前翻 → 去年（整年格数 = 365/366，「去年」标签，去年打卡数）
    nav.querySelector('[data-hy=prev]').click();
    await waitFor(function () {
      const g = body.querySelector('svg[data-habit-grid]');
      return g && g.getAttribute('data-year') === String(PY) ? g : null;
    }, { label: '未翻到去年' });
    let grid = body.querySelector('svg[data-habit-grid]');
    assert(grid.querySelectorAll('rect').length === daysInYear(PY),
      '去年应画满整年 ' + daysInYear(PY) + ' 格，实为 ' + grid.querySelectorAll('rect').length);
    assert(nav.textContent.indexOf('去年') >= 0, '去年应标注「去年」（标签在 head 导航）');
    assert(body.textContent.indexOf('打卡 4 天') >= 0, '去年打卡应 4 天: ' + body.textContent.slice(0, 200));
    // 再前翻 → 更早年（数据下限 = 前年），年份下限夹紧
    nav.querySelector('[data-hy=prev]').click();
    await waitFor(function () {
      const g = body.querySelector('svg[data-habit-grid]');
      return g && g.getAttribute('data-year') === String(PY2) ? g : null;
    }, { label: '未翻到前年' });
    assert(body.textContent.indexOf('打卡 1 天') >= 0, '前年（h2 数据）应 1 天: ' + body.textContent.slice(0, 200));
    nav.querySelector('[data-hy=prev]').click(); // 已到下限，应不动
    await waitFor(function () {
      return body.querySelector('svg[data-habit-grid]') ? true : null;
    }, { label: '栏目未重绘' });
    assert(body.querySelector('svg[data-habit-grid]').getAttribute('data-year') === String(PY2),
      '翻年应夹紧在数据下限（前年），实为 ' + body.querySelector('svg[data-habit-grid]').getAttribute('data-year'));
    // 后翻回今年；再后翻不超今年（上限夹紧）
    nav.querySelector('[data-hy=next]').click();
    nav.querySelector('[data-hy=next]').click();
    await waitFor(function () {
      const g = body.querySelector('svg[data-habit-grid]');
      return g && g.getAttribute('data-year') === String(Y) ? g : null;
    }, { label: '未翻回今年' });
    nav.querySelector('[data-hy=next]').click();
    await waitFor(function () {
      return body.querySelector('svg[data-habit-grid]') ? true : null;
    }, { label: '栏目未重绘' });
    assert(body.querySelector('svg[data-habit-grid]').getAttribute('data-year') === String(Y),
      '翻年不得翻到未来，实为 ' + body.querySelector('svg[data-habit-grid]').getAttribute('data-year'));
    console.log('PASS ' + cur);
  }

  /* ==================== 9）栏目体系集成 ==================== */
  cur = '9. 栏目体系：SECTION_META 注册 habitHeat（默认开启/可排序/开关/调宽）';
  {
    const saved = {};
    const w = dbWindow({ saved: saved, data: { habits: JSON.parse(JSON.stringify(SET_A)), settings: STG } });
    if (!(await waitMain(w))) throw new Error('no main');
    const S = w.Storage;
    const doc = w.document;
    const meta = w.PlanView.SECTION_META.habitHeat;
    assert(meta && meta.name === '习惯打卡' && meta.block === 'habit' && !meta.fixed,
      'SECTION_META 应注册 habitHeat（v1.1.8 习惯打卡独立类、可排序非固定），实为 ' + JSON.stringify(meta));
    w.App.go('plan');
    await waitFor(function () {
      return doc.querySelector('.plan-sec[data-id=habitHeat]') ? true : null;
    }, { label: 'habitHeat 栏目未出现' });
    // 默认开启 + 宽度档位（size=l）+ 顺序/开关持久进 settings.planSections
    const sec = doc.querySelector('.plan-sec[data-id=habitHeat]');
    assert(sec.getAttribute('data-size') === (meta.size || 'l'), '栏目默认宽度应 ' + meta.size);
    const entry = S.getDB().settings.planSections.filter(function (s) { return s.id === 'habitHeat'; })[0];
    assert(entry && entry.enabled === true, 'habitHeat 应默认开启并写进 planSections');
    // 编辑模式：可拖动排序 + 上下移 + 开关 + 调宽（既有栏目体系能力）
    doc.getElementById('btn-edit-sections').click();
    await waitFor(function () {
      return doc.querySelector('.plan-sec[data-id=habitHeat][draggable]') ? true : null;
    }, { label: '编辑模式未生效' });
    const secE = doc.querySelector('.plan-sec[data-id=habitHeat]');
    assert(secE.querySelectorAll('[data-size-btn]').length === 3, '应有 小/中/大 三档调宽按钮');
    assert(secE.querySelector('[data-move=up]') && secE.querySelector('[data-move=down]'), '应有上移/下移按钮');
    // 开关：隐藏此栏目 → enabled=false 落盘，再开启
    secE.querySelector('[data-toggle]').click();
    await waitFor(function () {
      const e1 = S.getDB().settings.planSections.filter(function (s) { return s.id === 'habitHeat'; })[0];
      return e1 && e1.enabled === false ? true : null;
    }, { label: '隐藏栏目未持久化' });
    await waitFor(function () {
      return doc.querySelector('.plan-sec[data-id=habitHeat].sec-off') ? true : null;
    }, { label: '隐藏栏目未变灰' });
    doc.querySelector('.plan-sec[data-id=habitHeat] [data-toggle]').click();
    await waitFor(function () {
      const e2 = S.getDB().settings.planSections.filter(function (s) { return s.id === 'habitHeat'; })[0];
      return e2 && e2.enabled === true ? true : null;
    }, { label: '恢复栏目未持久化' });
    await waitFor(function () {
      const s2 = doc.querySelector('.plan-sec[data-id=habitHeat]');
      return s2 && !s2.classList.contains('sec-off') ? true : null;
    }, { label: '恢复栏目未重绘' });
    // 调宽
    doc.querySelector('.plan-sec[data-id=habitHeat] [data-size-btn][data-size-val=m]').click();
    await waitFor(function () {
      const e3 = S.getDB().settings.planSections.filter(function (s) { return s.id === 'habitHeat'; })[0];
      return e3 && e3.size === 'm' ? true : null;
    }, { label: '调宽未持久化' });
    console.log('PASS ' + cur);
  }

  /* ==================== 10）空态引导 ==================== */
  cur = '10. 空态引导：无习惯项 → empty-card「管理习惯」跳主页';
  {
    const w = dbWindow({ data: { settings: STG } });
    if (!(await waitMain(w))) throw new Error('no main');
    const doc = w.document;
    await w.Storage.loadAll(); // 清掉主页 UI 层注入的纯内存预设，空态才可见
    w.App.go('plan');
    const body = await waitFor(function () {
      const el = doc.querySelector('[data-body=habitHeat]');
      return el && el.querySelector('.empty-state.empty-card') ? el : null;
    }, { label: '空态卡未渲染' });
    assert(body.textContent.indexOf('还没有习惯项') >= 0, '空态文案应引导添加习惯');
    const btn = body.querySelector('button[data-eg-go=home]');
    assert(btn && btn.textContent.indexOf('管理习惯') >= 0, '应有「管理习惯」按钮跳主页');
    btn.click();
    await waitFor(function () {
      return !doc.getElementById('plan-wrap');
    }, { label: '「管理习惯」未跳转主页' });
    console.log('PASS ' + cur);
  }

  console.log('========== v1.1.7 热力打卡（habits 域）：10 项全部通过 ==========');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FAIL ' + cur + ': ' + ((e && e.message) || e));
  process.exit(1);
});
