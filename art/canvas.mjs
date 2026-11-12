// Tiny pixel canvas for drawing sprites in code.
export const INK = '#2a2238';

export const rgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
};
export const toC = (c) => (typeof c === 'string' ? rgb(c) : c);
export const mix = (a, b, t) => {
  a = toC(a); b = toC(b);
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)).concat(255);
};
// Shade toward a cool dark and a warm light: the usual "cozy" pixel ramp.
export const darken = (c, t) => mix(c, '#1d1a2b', t);
export const lighten = (c, t) => mix(c, '#fff6e0', t);

export class Pix {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  set(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (!c || !this.in(x, y)) return;
    const [r, g, b, a] = toC(c);
    const i = (y * this.w + x) * 4;
    this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = a;
  }
  clear(x, y) { if (this.in(x, y)) this.d[(y * this.w + x) * 4 + 3] = 0; }
  get(x, y) {
    if (!this.in(x, y)) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  a(x, y) { return this.in(x, y) ? this.d[(y * this.w + x) * 4 + 3] : 0; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.set(x, y, c);
  }
  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  // rows: array of strings, map: char -> colour ('.' or ' ' = empty)
  grid(x, y, rows, map) {
    rows.forEach((row, j) => [...row].forEach((ch, i) => { if (map[ch]) this.set(x + i, y + j, map[ch]); }));
  }
  blit(src, dx, dy) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) if (src.a(x, y) > 0) this.set(dx + x, dy + y, src.get(x, y));
  }
  flipX() {
    const o = new Pix(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.a(x, y) > 0) o.set(this.w - 1 - x, y, this.get(x, y));
    return o;
  }
  scaled(k) {
    const o = new Pix(this.w * k, this.h * k);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.a(x, y) > 0) o.rect(x * k, y * k, k, k, this.get(x, y));
    return o;
  }
  // Coloured outline: each empty pixel touching the sprite takes a dark version of its neighbour.
  outlined(tint = 0.5) {
    const o = new Pix(this.w, this.h);
    o.d.set(this.d);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.a(x, y) > 0) continue;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        if (this.a(x + dx, y + dy) > 0) { o.set(x, y, mix(darken(this.get(x + dx, y + dy), 0.55), INK, tint)); break; }
      }
    }
    return o;
  }
  bounds() {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.a(x, y) > 0) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  crop(b) {
    const o = new Pix(b.w, b.h);
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (this.a(b.x + x, b.y + y) > 0) o.set(x, y, this.get(b.x + x, b.y + y));
    return o;
  }
}

// 3x5 pixel letters, only for labels on the preview sheets.
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111',
};
export function text(p, x, y, str, c, k = 1) {
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const g = FONT[ch];
    if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') p.rect(cx + (i % 3) * k, y + Math.floor(i / 3) * k, k, k, c);
    cx += 4 * k;
  }
}
