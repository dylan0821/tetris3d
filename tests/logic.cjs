'use strict';
/* 三维俄罗斯方块 · 逻辑校验
 * 抽出 HTML 内的脚本，套一个假 DOM 在 Node 里跑：既测纯函数（旋转 / 碰撞 / 消层 / 计分），
 * 也真跑 requestAnimationFrame 主循环做随机操作模糊测试。
 * 用法：node tests/logic.cjs
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const file = path.join(__dirname, '..', '三维俄罗斯方块.html');
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('未找到 <script>'); process.exit(1); }
let src = m[1];

const EXPORT = `
globalThis.__T = {
  rotateCells, normalize, bbox, collides, landingY, layerFull, idx, applySize,
  get W(){return W}, get D(){return D}, get H(){return H},
  PIECES, PALETTE, BAG, randomPiece, tryMove, tryRotate, act, spawn, lock, advanceClear,
  get grid(){return grid}, set grid(v){grid=v},
  get cur(){return cur}, set cur(v){cur=v},
  get state(){return state}, set state(v){state=v},
  get score(){return score}, set score(v){score=v},
  get layers(){return layers}, set layers(v){layers=v},
  get level(){return level}, set level(v){level=v},
  get clearAnim(){return clearAnim}, set clearAnim(v){clearAnim=v},
  startGame,
};
`;
const marker = 'requestAnimationFrame(frame);\n})();';
if (src.indexOf(marker) < 0) { console.error('未找到导出插入点'); process.exit(1); }
src = src.replace(marker, EXPORT + '\n' + marker);

/* ---------------- 假 DOM ---------------- */
let rafQueue = [];
class Path2D { moveTo(){} lineTo(){} closePath(){} }
const gradient = { addColorStop(){} };
const fakeCtx = new Proxy({}, {
  get(t, k) {
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => gradient;
    if (k === 'measureText') return () => ({ width: 0 });
    if (k in t) return t[k];
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; },
});
function makeEl(id) {
  const L = {};
  return {
    id, textContent: '', innerHTML: '', hidden: false, dataset: {}, style: {}, width: 150, height: 140,
    classList: { s: new Set(), add(c){this.s.add(c)}, remove(c){this.s.delete(c)}, contains(c){return this.s.has(c)} },
    setAttribute(){}, getAttribute(){}, blur(){}, focus(){}, setPointerCapture(){}, releasePointerCapture(){},
    addEventListener(t, f){ (L[t] = L[t] || []).push(f); },
    removeEventListener(){},
    fire(t, e){ (L[t] || []).forEach(f => f(e || {})); },
    getBoundingClientRect(){ return { width: 600, height: 600, top: 0, left: 0 }; },
    getContext(){ return fakeCtx; },
  };
}
const els = {};
const docL = {};
const store = {};
const sandbox = {
  console, Path2D, Math, Date, JSON, Number, String, Array, Object, Set, Map, Uint8Array, Error,
  performance: { now: () => nowMs },
  requestAnimationFrame(cb) { rafQueue.push(cb); return rafQueue.length; },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  document: {
    getElementById(id) { return els[id] || (els[id] = makeEl(id)); },
    querySelectorAll() { return []; },
    addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); },
    hidden: false,
  },
  window: {
    devicePixelRatio: 2,
    matchMedia: () => ({ matches: false, addEventListener(){}, addListener(){} }),
    addEventListener(){},
    AudioContext: undefined,
  },
};
sandbox.window.AudioContext = undefined;
sandbox.globalThis = sandbox;
let nowMs = 0;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.js' });
const T = sandbox.__T;

/* ---------------- 断言 ---------------- */
let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ ' + label); }
}
function key(set) { return JSON.stringify(set.slice().sort()); }

/* 1. 旋转不变量：任意方块绕任意轴转 4 次回到原状 */
for (let i = 0; i < T.PIECES.length; i++) {
  const base = T.normalize(T.PIECES[i].cells);
  for (const axis of ['x', 'y', 'z']) {
    let c = base;
    for (let k = 0; k < 4; k++) c = T.rotateCells(c, axis, 1);
    ok(key(c) === key(base), `旋转 4 次复原 piece#${i} axis=${axis}`);
    const inv = T.rotateCells(T.rotateCells(base, axis, 1), axis, -1);
    ok(key(inv) === key(base), `正反旋转抵消 piece#${i} axis=${axis}`);
  }
}
/* 2. 旋转保持格子数与包围盒体积 */
for (const p of T.PIECES) {
  const r = T.rotateCells(p.cells, 'y', 1);
  ok(r.length === p.cells.length, '旋转不改变格子数');
  const bb = T.bbox(r);
  ok(bb.a.every(v => v === 0), '旋转后归一化到原点');
}
/* 3. 碰撞：边界、井口以上、堆叠 */
T.grid = new Uint8Array(T.W * T.D * T.H);
ok(T.collides(-1, 5, 0, [[0,0,0]]) === true, '左侧越界判定碰撞');
ok(T.collides(T.W, 5, 0, [[0,0,0]]) === true, '右侧越界判定碰撞');
ok(T.collides(0, 5, -1, [[0,0,0]]) === true, '前方越界判定碰撞');
ok(T.collides(0, -1, 0, [[0,0,0]]) === true, '穿底判定碰撞');
ok(T.collides(0, T.H, 0, [[0,0,0]]) === false, '井口以上可容纳');
ok(T.collides(0, 0, 0, [[0,0,0]]) === false, '空井不碰撞');
T.grid[T.idx(2, 3, 2)] = 1;
ok(T.collides(2, 3, 2, [[0,0,0]]) === true, '与已固定方块重叠判定碰撞');

/* 4. 填满整层 → 消层、计分、上层下落 */
T.grid = new Uint8Array(T.W * T.D * T.H);
for (let z = 0; z < T.D; z++) for (let x = 0; x < T.W; x++) T.grid[T.idx(x, 0, z)] = 2;
T.grid[T.idx(4, 3, 4)] = 5;                       // 高处放一块做下落标记
T.grid[T.idx(0, 0, 0)] = 0;                       // 留一个洞
T.score = 0;
T.cur = { cells: [[0,0,0]], color: 0, x: 0, y: 0, z: 0 };
T.lock();
ok(T.score === 100, '消一层得 100 分（实得 ' + T.score + '）');
ok(T.layers === 1, '消层计数 +1');
ok(T.clearAnim !== null, '触发消层动画');
T.advanceClear(1000);
ok(T.grid[T.idx(0, 0, 0)] === 0, '满层已被移除');
ok(T.grid[T.idx(4, 2, 4)] === 5, '上方方块随之下落一层');
ok(T.grid[T.idx(4, 3, 4)] === 0, '原位置已清空');

/* 5. 等级：每 5 层升 1 级，速度随之加快 */
T.grid = new Uint8Array(T.W * T.D * T.H);
T.score = 0; T.layers = 0; T.level = 1;
for (let n = 0; n < 5; n++) {
  const g = new Uint8Array(T.W * T.D * T.H);
  for (let z = 0; z < T.D; z++) for (let x = 0; x < T.W; x++) g[T.idx(x, 0, z)] = 1;
  g[T.idx(0, 0, 0)] = 0;
  T.grid = g;
  T.cur = { cells: [[0,0,0]], color: 0, x: 0, y: 0, z: 0 };
  T.lock();
  T.advanceClear(1000);
}
ok(T.layers === 5, '累计消层 5');
ok(T.level === 2, '每 5 层升 1 级（实为 ' + T.level + '）');
ok(T.score === 500, '首级每层 100 分（实为 ' + T.score + '）');

/* 6. 井满 → 落定即结束（跑真实主循环，不手动调用内部函数） */
T.grid = new Uint8Array(T.W * T.D * T.H).fill(1);
T.state = 'ready';
T.startGame();
T.grid = new Uint8Array(T.W * T.D * T.H).fill(1);   // startGame 会清空，这里重新灌满
for (let i = 0; i < 200 && T.state !== 'over'; i++) {
  nowMs += 60;
  const q = rafQueue; rafQueue = [];
  for (const cb of q) cb(nowMs);
}
ok(T.state === 'over', '井满后落定即结束游戏（实为 ' + T.state + '）');

/* 7. 完整主循环模糊测试：真跑 frame()，随机操作 */
T.grid = new Uint8Array(T.W * T.D * T.H);
T.state = 'ready';
T.startGame();
ok(T.state === 'playing', '开始游戏进入 playing');
const acts = ['x-','x+','z-','z+','ry','ry-','rx','rx-','rz','rz-','drop'];
let maxCells = 0, bad = 0;
for (let i = 0; i < 1500; i++) {
  if (i % 3 === 0) {
    try { T.act(acts[(Math.random() * acts.length) | 0]); } catch (e) { bad++; console.log('  act 异常: ' + e.message); }
  }
  nowMs += 60;
  const q = rafQueue; rafQueue = [];
  for (const cb of q) { try { cb(nowMs); } catch (e) { bad++; console.log('  frame 异常: ' + e.message); } }
  let n = 0;
  for (let k = 0; k < T.grid.length; k++) if (T.grid[k]) n++;
  maxCells = Math.max(maxCells, n);
  if (n > T.W * T.D * T.H) bad++;
  if (T.state === 'over') { T.startGame(); }
}
ok(bad === 0, '1500 帧无异常写入');
ok(maxCells <= T.W * T.D * T.H, '已固定格子数不超过井容量');
ok(T.grid.length === T.W * T.D * T.H, '网格尺寸稳定');
ok(Number.isFinite(T.score) && T.score >= 0, '分数始终有效');

/* 8. 落地幻影位置合法 */
T.grid = new Uint8Array(T.W * T.D * T.H);
for (let z = 0; z < T.D; z++) for (let x = 0; x < T.W; x++) T.grid[T.idx(x, 0, z)] = 1;
T.cur = { cells: [[0,0,0],[1,0,0]], color: 3, x: 0, y: 6, z: 2 };
const ly = T.landingY();
ok(ly === 1, '幻影落点停在堆叠之上（实为 ' + ly + '）');
ok(T.collides(T.cur.x, ly, T.cur.z, T.cur.cells) === false, '落点本身不碰撞');
ok(T.collides(T.cur.x, ly - 1, T.cur.z, T.cur.cells) === true, '落点再下一格即碰撞');

/* 9. 切换井的大小：几何、网格、索引都要跟着换 */
const before = [T.W, T.D, T.H];
T.applySize('roomy');
ok(T.W === 7 && T.D === 7 && T.H === 20, '「大」为 7 × 7 × 20（实为 ' + T.W + '×' + T.D + '×' + T.H + '）');
ok(T.grid.length === 7 * 7 * 20, '切换后网格容量正确');
ok(T.idx(6, 19, 6) === 7 * 7 * 20 - 1, '切换后索引函数指向新容量');
ok(T.collides(6, 5, 6, [[0,0,0]]) === false && T.collides(7, 5, 6, [[0,0,0]]) === true, '新边界生效');
T.applySize('compact');
ok(T.W === 5 && T.D === 5 && T.H === 12, '「小」为 5 × 5 × 12');
ok(T.collides(5, 5, 0, [[0,0,0]]) === true, '缩小后旧坐标越界');
T.applySize(before[0] === 5 ? 'compact' : 'normal');
ok(T.grid.length === T.W * T.D * T.H, '切回后网格容量与尺寸一致');
ok(T.grid.every(v => v === 0), '切换尺寸会清空棋盘');

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
