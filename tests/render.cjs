'use strict';
/* 三维俄罗斯方块 · 渲染检查
 * 把游戏真实的绘制指令录下来，自行做扫描线光栅化并写出 PNG，用于目视核对三维渲染。
 * 用法：node tests/render.cjs [宽] [高] [输出.png] [--next]
 */
const fs = require('fs');
const vm = require('vm');
const zlib = require('zlib');
const path = require('path');

const args = process.argv.slice(2);
const NEXT = args.includes('--next');
const SPAWN = args.includes('--spawn');
const SIZE = (args.find(a => a.startsWith('--size=')) || '--size=normal').split('=')[1];
const rest = args.filter(a => !a.startsWith('--'));
const VW = Number(rest[0] || 600), VH = Number(rest[1] || 620);
const OUT = rest[2] || path.join(__dirname, NEXT ? '下一块预览.png' : '画面预览.png');

/* ---------------- 从 HTML 中取出脚本，并追加导出 ---------------- */
const html = fs.readFileSync(path.join(__dirname, '..', '三维俄罗斯方块.html'), 'utf8');
let src = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const EXPORT = `
globalThis.__T = {
  render, drawNext, resize, startGame, normalize, bbox, PIECES, idx, applySize, cam,
  get W(){return W}, get D(){return D}, get H(){return H},
  get grid(){return grid}, set grid(v){grid=v},
  get cur(){return cur}, set cur(v){cur=v},
  get state(){return state}, set state(v){state=v},
};
`;
const marker = 'requestAnimationFrame(frame);\n})();';
if (src.indexOf(marker) < 0) { console.error('未找到导出插入点'); process.exit(1); }
src = src.replace(marker, EXPORT + '\n' + marker);

/* ---------------- 记录型 Canvas ---------------- */
class Path2D {
  constructor() { this.subpaths = []; }
  moveTo(x, y) { this.subpaths.push([[x, y]]); }
  lineTo(x, y) { this.subpaths[this.subpaths.length - 1].push([x, y]); }
  closePath() {}
}
function makeCtx() {
  const mine = [];
  function pick(p) { return p && p.subpaths && p.subpaths.length ? p.subpaths : this._cur; }
  return {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, _cur: [],
    get ops() { return mine; },
    setTransform() {}, save() {}, restore() {}, setLineDash() {},
    clearRect() { mine.length = 0; },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
    beginPath() { this._cur = []; },
    moveTo(x, y) { this._cur.push([[x, y]]); },
    lineTo(x, y) { this._cur[this._cur.length - 1].push([x, y]); },
    closePath() {},
    arc(x, y, r, a0, a1) {
      const p = [];
      for (let i = 0; i <= 16; i++) { const a = a0 + (a1 - a0) * i / 16; p.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
      this._cur.push(p);
    },
    fill(p) { mine.push({ t: 'fill', paths: pick.call(this, p), style: this.fillStyle, alpha: this.globalAlpha }); },
    stroke(p) { mine.push({ t: 'stroke', paths: pick.call(this, p), style: this.strokeStyle, alpha: this.globalAlpha, w: this.lineWidth }); },
    fillRect(x, y, w, h) { mine.push({ t: 'fill', paths: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]], style: this.fillStyle, alpha: this.globalAlpha }); },
    measureText() { return { width: 0 }; },
  };
}
const ctxScene = makeCtx(), ctxNext = makeCtx();
const els = {}, docL = {}, store = {};
function makeEl(id) {
  const L = {};
  return {
    id, textContent: '', innerHTML: '', hidden: false, dataset: {}, style: {}, width: 150, height: 140,
    classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); } },
    setAttribute() {}, getAttribute() {}, blur() {}, focus() {}, setPointerCapture() {}, releasePointerCapture() {},
    addEventListener(t, f) { (L[t] = L[t] || []).push(f); }, removeEventListener() {},
    getBoundingClientRect() { return id === 'next' ? { width: 150, height: 140, top: 0, left: 0 } : { width: VW, height: VH, top: 0, left: 0 }; },
    getContext() { return id === 'scene' ? ctxScene : ctxNext; },
  };
}
const sandbox = {
  console, Path2D, Math, Date, JSON, Number, String, Array, Object, Set, Map, Uint8Array, Error,
  performance: { now: () => 0 },
  requestAnimationFrame() { return 1; },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  document: { getElementById(id) { return els[id] || (els[id] = makeEl(id)); }, querySelectorAll() { return []; }, addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); }, hidden: false },
  window: { devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), addEventListener() {} },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.js' });
const T = sandbox.__T;

/* ---------------- 造一个中局局面 ---------------- */
T.applySize(SIZE);
T.startGame();
if (SPAWN) {
  T.resize();
  T.render();                      // 开局瞬间：方块还在井口上方
} else if (!NEXT) {
  const g = new Uint8Array(T.W * T.D * T.H);
  const put = (x, y, z, c) => { if (x >= 0 && x < T.W && y >= 0 && y < T.H && z >= 0 && z < T.D) g[T.idx(x, y, z)] = c; };
  const { W, D, H } = T;
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) put(x, 0, z, 1 + ((x + z) % 6));
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++)
    if (!((x === W - 2 && z === D - 3) || (x === 0 && z === D - 1))) put(x, 1, z, 4 + ((x * 2 + z) % 4));
  for (let y = 2; y < Math.min(H, 5); y++)
    for (let z = 1; z < Math.min(D, 4); z++)
      for (let x = 0; x < Math.min(W, 3); x++) if ((x + y + z) % 3) put(x, y, z, 7);
  put(W - 1, 2, 0, 9); put(W - 1, 3, 0, 10); put(W - 1, 2, 1, 11); put(1, 2, D - 1, 8);
  T.grid = g;
  T.cur = { cells: T.normalize(T.PIECES[8].cells), color: T.PIECES[8].c, x: 1, y: Math.round(H * 0.45), z: 0 };
  T.state = 'playing';
  T.resize();
  T.render();
} else {
  T.drawNext();
}
const ops = NEXT ? ctxNext.ops : ctxScene.ops;
const LW = NEXT ? 150 : VW, LH = NEXT ? 140 : VH;

/* ---------------- 光栅化 ---------------- */
const SS = 2, W = LW * SS, H = LH * SS;
const buf = new Float32Array(W * H * 3);
function tint(s) {
  if (typeof s !== 'string') return [16, 22, 19, 1];
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) { const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 1]; }
  m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; }
  return [16, 22, 19, 1];
}
function blend(o, col, a) {
  buf[o] += (col[0] - buf[o]) * a;
  buf[o + 1] += (col[1] - buf[o + 1]) * a;
  buf[o + 2] += (col[2] - buf[o + 2]) * a;
}
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {          // 背景：径向渐变
  const dx = (x - W * 0.5) / (W * 0.62), dy = (y - H * 0.42) / (H * 0.7);
  const d = Math.min(1, Math.hypot(dx, dy)), o = (y * W + x) * 3;
  buf[o] = 22 * (1 - d) + 8 * d; buf[o + 1] = 32 * (1 - d) + 11 * d; buf[o + 2] = 27 * (1 - d) + 10 * d;
}
function fillPoly(pts, col, alpha) {
  const p = pts.map(q => [q[0] * SS, q[1] * SS]);
  const ys = p.map(q => q[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.round(xs[i])), xb = Math.min(W - 1, Math.round(xs[i + 1]) - 1);
      for (let x = xa; x <= xb; x++) blend((y * W + x) * 3, col, alpha);
    }
  }
}
function drawLine(a, b, col, alpha, w) {
  const A = [a[0] * SS, a[1] * SS], B = [b[0] * SS, b[1] * SS];
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const steps = Math.max(1, Math.ceil(len)), r = Math.max(0.6, w * SS / 2);
  for (let i = 0; i <= steps; i++) {
    const x = A[0] + (B[0] - A[0]) * i / steps, y = A[1] + (B[1] - A[1]) * i / steps;
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.ceil(y + r));
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++)
      if (Math.hypot(px + 0.5 - x, py + 0.5 - y) <= r) blend((py * W + px) * 3, col, alpha);
  }
}
for (const op of ops) {
  const col = tint(op.style);
  const a = op.alpha * (col[3] === undefined ? 1 : col[3]);
  if (op.t === 'stroke') {
    for (const sp of op.paths) for (let i = 0; i + 1 < sp.length; i++) drawLine(sp[i], sp[i + 1], col, a, op.w || 1);
  } else if (op.t === 'fill') {
    for (const sp of op.paths) if (sp.length > 2) fillPoly(sp, col, a);
  }
}

/* ---------------- 降采样 + 写 PNG ---------------- */
const rgb = Buffer.alloc(LW * LH * 3);
for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
  let r = 0, g = 0, b = 0;
  for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
    const o = ((y * SS + sy) * W + (x * SS + sx)) * 3;
    r += buf[o]; g += buf[o + 1]; b += buf[o + 2];
  }
  const n = SS * SS, o2 = (y * LW + x) * 3;
  rgb[o2] = Math.min(255, Math.round(r / n));
  rgb[o2 + 1] = Math.min(255, Math.round(g / n));
  rgb[o2 + 2] = Math.min(255, Math.round(b / n));
}
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return b => { let c = -1; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}
const raw = Buffer.alloc(LH * (LW * 3 + 1));
for (let y = 0; y < LH; y++) { raw[y * (LW * 3 + 1)] = 0; rgb.copy(raw, y * (LW * 3 + 1) + 1, y * LW * 3, (y + 1) * LW * 3); }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(LW, 0); ihdr.writeUInt32BE(LH, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(OUT, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]));
console.log(`${NEXT ? '下一块面板' : '游戏画面'} 井 ${T.W}×${T.D}×${T.H} ${LW}×${LH}｜绘制指令 ${ops.length} 条｜自动机位 dist=${T.cam.dist.toFixed(2)} → ${OUT}`);
