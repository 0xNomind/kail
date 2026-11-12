// Fish drawn from a few numbers: body length and height, tail, fins, colours, pattern.
// Every fish faces left. Frames -1, 0, 1 bend the rear of the body so it swims.
import { Pix, INK, darken, lighten } from './canvas.mjs';

const finHeight = (shape, u, h) => {
  switch (shape) {
    case 'tri': return h * (u < 0.3 ? u / 0.3 : 1 - (u - 0.3) / 0.7);
    case 'shark': return h * (u < 0.4 ? u / 0.4 : (1 - (u - 0.4) / 0.6) ** 1.6);
    case 'sail': return h * Math.sin(Math.PI * Math.min(1, u * 1.08)) ** 0.45;
    case 'low': return h * (0.55 + 0.45 * Math.sin(Math.PI * u));
    default: return h * Math.sin(Math.PI * u);
  }
};

export function drawFish(s, frame = 0) {
  const L = s.len, H = s.h, bill = s.bill || 0;
  const tail = s.tail, tl = tail.len;
  const sway = s.sway ?? (L > 30 ? 2 : 1);
  const fins = s.fins || [];
  const topFin = Math.max(0, ...fins.filter((f) => f.side === 'top').map((f) => f.h));
  const botFin = Math.max(0, ...fins.filter((f) => f.side === 'bottom').map((f) => f.h));
  const up = Math.max(topFin, Math.ceil((tail.h * (tail.upper ?? 1) - H) / 2)) + sway + 2;
  const down = Math.max(botFin, Math.ceil((tail.h * (tail.lower ?? 1) - H) / 2)) + sway + 2;
  const p = new Pix(bill + L + tl + 4, H + up + down);
  const x0 = 2 + bill;
  const cy0 = up + H / 2;
  const total = L + tl;
  const shiftAt = (dist) => Math.round(frame * sway * Math.max(0, (dist / total - 0.55) / 0.45) ** 1.4);

  const pk = s.peak ?? 0.35, ped = s.ped ?? 0.25, taper = s.taper ?? 1.3, blunt = s.blunt ?? 0.2;
  const prof = (t) => (t < pk
    ? Math.max(blunt, Math.sqrt(Math.max(0, 1 - ((pk - t) / pk) ** 2)))
    : 1 - (1 - ped) * ((t - pk) / (1 - pk)) ** taper);

  // body
  const cols = [];
  for (let i = 0; i < L; i++) {
    const t = i / (L - 1);
    const cy = cy0 + shiftAt(i);
    const hh = Math.max(0.5, (H / 2) * prof(t));
    const yt = Math.round(cy - hh);
    const yb = Math.max(yt, Math.round(cy + hh) - 1);
    cols[i] = [yt, yb, cy];
    for (let y = yt; y <= yb; y++) {
      const rel = (y + 0.5 - (cy - H / 2)) / H;
      const c = rel < (s.backFrac ?? 0.38) ? s.back : rel > 1 - (s.bellyFrac ?? 0.3) ? s.belly : s.side;
      p.set(x0 + i, y, c);
    }
    if (yb - yt >= 4) {
      p.set(x0 + i, yt, lighten(s.back, 0.22));
      p.set(x0 + i, yb, darken(s.belly, 0.12));
    }
  }
  const inBody = (i, y) => i >= 0 && i < L && y >= cols[i][0] && y <= cols[i][1];

  // patterns
  if (s.bands) for (const b of s.bands) {
    const a = Math.round(b.t * (L - 1));
    for (let i = a; i < a + b.w && i < L; i++) for (let y = cols[i][0]; y <= cols[i][1]; y++) p.set(x0 + i, y, b.color);
  }
  if (s.bars) {
    const b = s.bars;
    for (let i = 0; i < L; i++) {
      const t = i / (L - 1);
      if (t < b.from || t > b.to || (i % b.gap) >= b.w) continue;
      const n = Math.max(1, Math.round((cols[i][1] - cols[i][0] + 1) * b.depth));
      for (let y = cols[i][0] + (b.skipTop ? 1 : 0); y < cols[i][0] + n; y++) p.set(x0 + i, y, b.color);
    }
  }
  if (s.lateral) {
    const l = s.lateral;
    for (let i = Math.round(l.from * L); i < Math.round(l.to * L); i++) {
      const y = Math.round(cols[i][2] + (l.dy || 0) - 0.5);
      if (inBody(i, y)) p.set(x0 + i, y, l.color);
    }
  }
  if (s.spots) {
    let seed = s.spots.seed || 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let n = 0; n < s.spots.n; n++) {
      const i = Math.round((0.28 + rnd() * 0.66) * (L - 1));
      const y = cols[i][0] + 1 + Math.floor(rnd() * Math.max(1, (cols[i][1] - cols[i][0]) * 0.62));
      if (inBody(i, y)) p.set(x0 + i, y, s.spots.color);
      if (s.spots.big && inBody(i + 1, y)) p.set(x0 + i + 1, y, s.spots.color);
    }
  }
  if (s.gill) {
    const i = Math.round(L * s.gill);
    for (let y = Math.round(cols[i][2] - H * 0.26); y <= Math.round(cols[i][2] + H * 0.18); y++) {
      const ii = Math.abs(y - cols[i][2]) < H * 0.12 ? i + 1 : i;
      if (inBody(ii, y)) p.set(x0 + ii, y, darken(p.get(x0 + ii, y), 0.28));
    }
  }
  if (s.slits) for (let k = 0; k < 3; k++) {
    const i = Math.round(L * s.slits) + k * 2;
    for (let y = Math.round(cols[i][2] - 1); y <= Math.round(cols[i][2] + 1); y++) if (inBody(i, y)) p.set(x0 + i, y, darken(p.get(x0 + i, y), 0.35));
  }

  // fins on the body edge
  for (const f of fins) {
    const a = Math.round(f.from * (L - 1)), b = Math.round(f.to * (L - 1));
    for (let i = a; i <= b; i++) {
      const u = (i - a) / Math.max(1, b - a);
      let fh = Math.round(finHeight(f.shape, u, f.h));
      if (f.spiky && i % 2 === 1) fh -= 1;
      for (let j = 1; j <= fh; j++) {
        const y = f.side === 'top' ? cols[i][0] - j : cols[i][1] + j;
        let c = f.color;
        if (f.rays && (i - a) % f.rays === 0) c = darken(f.color, 0.22);
        if (j === fh && fh > 2) c = lighten(f.color, 0.2);
        p.set(x0 + i, y, c);
      }
    }
  }

  // tail
  const pedHalf = Math.max(0.5, (H / 2) * prof(1));
  const upper = tail.upper ?? 1, lower = tail.lower ?? 1, curve = tail.curve ?? 1;
  const ns = tail.notchAt ?? 0.3, nd = tail.notch ?? 0;
  for (let i = 0; i < tl; i++) {
    const u = (i + 1) / tl;
    const cy = cy0 + shiftAt(L + i);
    const hu = pedHalf + ((tail.h / 2) * upper - pedHalf) * u ** curve;
    const hl = pedHalf + ((tail.h / 2) * lower - pedHalf) * u ** curve;
    const gap = u > ns ? ((u - ns) / (1 - ns)) * (tail.h / 2) * nd : 0;
    const ra = tail.roundAt ?? 0.7;
    const rnd = tail.round && u > ra ? Math.sqrt(Math.max(0.3, 1 - ((u - ra) / (1 - ra)) ** 2)) : 1;
    for (let y = Math.floor(cy - hu - 1); y <= Math.ceil(cy + hl + 1); y++) {
      const d = y + 0.5 - cy;
      const inside = d < 0 ? -d <= hu * rnd && -d >= gap * upper : d <= hl * rnd && d >= gap * lower;
      if (!inside) continue;
      let c = tail.color || s.fin;
      if (tail.rays && i % tail.rays === tail.rays - 1) c = darken(c, 0.18);
      if (i === tl - 1) c = lighten(c, 0.18);
      p.set(x0 + L + i, y, c);
    }
  }

  // bill, pectoral fin, mouth, eye
  if (bill) for (let j = 1; j <= bill; j++) {
    const y = Math.round(cy0 - H * 0.06 - 0.5);
    p.set(x0 - j, y, darken(s.back, 0.1));
    if (j <= bill * 0.35) p.set(x0 - j, y + 1, s.side);
  }
  if (s.pect) {
    const px = x0 + Math.round(L * s.pect.t), py = Math.round(cy0 + H * (s.pect.y ?? 0.1));
    for (let j = 0; j < s.pect.len; j++) {
      p.set(px + j, py + Math.ceil(j / 2), s.pect.color);
      if (s.pect.wide && j > 0) p.set(px + j, py + Math.ceil(j / 2) - 1, s.pect.color);
    }
  }
  if (s.mouth) {
    const my = Math.round(cy0 + H * (s.mouth.y ?? 0.14));
    for (let j = 0; j < s.mouth.len; j++) if (inBody(j, my)) p.set(x0 + j, my, darken(s.side, 0.6));
  }
  const ex = x0 + Math.max(1, Math.round(L * (s.eyeT ?? 0.14)));
  const ey = Math.round(cy0 - H * (s.eyeY ?? 0.14) - 0.5);
  const eye = s.eye ?? 1;
  if (eye === 1) p.set(ex, ey, INK);
  else if (eye === 2) { p.rect(ex, ey, 2, 2, INK); p.set(ex, ey, '#ffffff'); }
  else { p.rect(ex - 1, ey - 1, 3, 3, '#fdfaf0'); p.rect(ex - 1, ey, 2, 2, INK); p.set(ex - 1, ey - 1, '#fdfaf0'); }

  return p.outlined();
}

// tier: 1 shallow, 2 middle, 3 deep, 4 trophy
export const FISH = [
  { id: 'anchovy', label: 'ANCHOVY', tier: 1, len: 11, h: 4, peak: 0.3, ped: 0.3, blunt: 0.4,
    back: '#5f8fb5', side: '#cfe0ea', belly: '#f4f8f8', fin: '#86a9c2', backFrac: 0.3, bellyFrac: 0.25,
    tail: { len: 4, h: 6, notch: 0.5, notchAt: 0.35 }, eye: 1, eyeT: 0.18, eyeY: 0.1 },
  { id: 'mackerel', label: 'MACKEREL', tier: 1, len: 15, h: 6, peak: 0.34, ped: 0.22, blunt: 0.3,
    back: '#2f8a86', side: '#a9d6c8', belly: '#f3f5e4', fin: '#8fb38f',
    bars: { color: '#1e5a60', gap: 3, w: 1, from: 0.28, to: 0.92, depth: 0.42 },
    fins: [{ side: 'top', from: 0.34, to: 0.56, h: 2, shape: 'tri', color: '#6fae9e' }, { side: 'bottom', from: 0.58, to: 0.76, h: 1, shape: 'tri', color: '#cfd9a8' }],
    tail: { len: 5, h: 8, notch: 0.55, notchAt: 0.3, color: '#b9c98a' }, eye: 1 },
  { id: 'clownfish', label: 'CLOWNFISH', tier: 1, len: 12, h: 8, peak: 0.42, ped: 0.42, blunt: 0.45, taper: 1.6,
    back: '#ea7a2e', side: '#f39a3f', belly: '#f8b560', fin: '#ea7a2e',
    bands: [{ t: 0.26, w: 2, color: '#fdf6ea' }, { t: 0.6, w: 2, color: '#fdf6ea' }],
    fins: [{ side: 'top', from: 0.3, to: 0.82, h: 2, shape: 'low', color: '#d9651f' }, { side: 'bottom', from: 0.48, to: 0.76, h: 2, shape: 'tri', color: '#d9651f' }],
    tail: { len: 4, h: 8, curve: 0.75, round: true, color: '#f39a3f' }, eye: 1, eyeT: 0.12 },

  { id: 'snapper', label: 'SNAPPER', tier: 2, len: 22, h: 11, peak: 0.36, ped: 0.26, blunt: 0.3, taper: 1.4,
    back: '#c5434c', side: '#e36a6c', belly: '#f6c2b6', fin: '#b23540', gill: 0.24,
    fins: [{ side: 'top', from: 0.26, to: 0.84, h: 3, shape: 'low', color: '#b23540', spiky: true }, { side: 'bottom', from: 0.56, to: 0.78, h: 3, shape: 'tri', color: '#c9505a' }],
    pect: { t: 0.3, len: 4, color: '#f3a59a' }, mouth: { len: 3 },
    tail: { len: 7, h: 12, notch: 0.45, notchAt: 0.35, curve: 0.8, rays: 2 }, eye: 2 },
  { id: 'milkfish', label: 'MILKFISH', tier: 2, len: 24, h: 8, peak: 0.34, ped: 0.18, blunt: 0.25,
    back: '#7397b0', side: '#d2e0e7', belly: '#f8fafa', fin: '#8aa5b8', gill: 0.2,
    lateral: { color: '#aac3d0', from: 0.24, to: 0.95 },
    fins: [{ side: 'top', from: 0.42, to: 0.58, h: 3, shape: 'tri', color: '#8aa5b8' }, { side: 'bottom', from: 0.6, to: 0.72, h: 2, shape: 'tri', color: '#b8cad6' }],
    pect: { t: 0.27, len: 3, color: '#a9c0cf' },
    tail: { len: 9, h: 14, notch: 0.7, notchAt: 0.25, curve: 0.9 }, eye: 2 },
  { id: 'grouper', label: 'GROUPER', tier: 2, len: 22, h: 12, peak: 0.4, ped: 0.4, blunt: 0.42, taper: 1.5,
    back: '#7b5b45', side: '#a47f5c', belly: '#dcc4a2', fin: '#6b4b39', gill: 0.26,
    spots: { color: '#5a3d2e', n: 16, seed: 11 },
    fins: [{ side: 'top', from: 0.28, to: 0.9, h: 3, shape: 'low', color: '#6b4b39', spiky: true }, { side: 'bottom', from: 0.6, to: 0.84, h: 2, shape: 'low', color: '#6b4b39' }],
    pect: { t: 0.32, len: 4, color: '#8a6a4e', wide: true }, mouth: { len: 4, y: 0.2 },
    tail: { len: 6, h: 11, curve: 0.75, round: true, rays: 2 }, eye: 2, eyeT: 0.16 },

  { id: 'barracuda', label: 'BARRACUDA', tier: 3, len: 38, h: 7, peak: 0.3, ped: 0.26, blunt: 0.22, taper: 1.2,
    back: '#5c7c8e', side: '#bccbd1', belly: '#f0f4f3', fin: '#6f8a99', gill: 0.2,
    bars: { color: '#44606f', gap: 5, w: 2, from: 0.3, to: 0.94, depth: 0.5, skipTop: true },
    fins: [{ side: 'top', from: 0.4, to: 0.5, h: 3, shape: 'tri', color: '#6f8a99' }, { side: 'top', from: 0.72, to: 0.82, h: 2, shape: 'tri', color: '#6f8a99' }, { side: 'bottom', from: 0.72, to: 0.82, h: 2, shape: 'tri', color: '#8ea3ae' }],
    mouth: { len: 6, y: 0.16 }, pect: { t: 0.24, len: 3, color: '#9db1bb' },
    tail: { len: 8, h: 12, notch: 0.6, notchAt: 0.3 }, eye: 2, eyeT: 0.12 },
  { id: 'tuna', label: 'TUNA', tier: 3, len: 40, h: 16, peak: 0.36, ped: 0.1, blunt: 0.2, taper: 1.5,
    back: '#243f69', side: '#7c9bb8', belly: '#eef2f4', fin: '#e6c145', backFrac: 0.4, gill: 0.2,
    lateral: { color: '#a9c0d4', from: 0.24, to: 0.9, dy: -1 },
    fins: [{ side: 'top', from: 0.34, to: 0.48, h: 5, shape: 'shark', color: '#2c4a78' }, { side: 'top', from: 0.56, to: 0.66, h: 5, shape: 'shark', color: '#e6c145' },
      { side: 'bottom', from: 0.6, to: 0.7, h: 5, shape: 'shark', color: '#e6c145' }, { side: 'top', from: 0.72, to: 0.96, h: 1, shape: 'low', color: '#e6c145', spiky: true }, { side: 'bottom', from: 0.76, to: 0.96, h: 1, shape: 'low', color: '#e6c145', spiky: true }],
    pect: { t: 0.27, len: 7, color: '#2c4a78' }, mouth: { len: 4 },
    tail: { len: 9, h: 22, notch: 0.8, notchAt: 0.1, curve: 0.5, color: '#2c4a78' }, eye: 3, eyeT: 0.12 },
  { id: 'shark', label: 'SHARK', tier: 3, len: 46, h: 13, peak: 0.32, ped: 0.14, blunt: 0.08, taper: 1.25,
    back: '#66788c', side: '#8898aa', belly: '#ecf0f1', fin: '#5a6c80', backFrac: 0.42, bellyFrac: 0.3, slits: 0.25,
    fins: [{ side: 'top', from: 0.34, to: 0.5, h: 8, shape: 'shark', color: '#5a6c80' }, { side: 'top', from: 0.76, to: 0.84, h: 2, shape: 'shark', color: '#5a6c80' },
      { side: 'bottom', from: 0.3, to: 0.44, h: 4, shape: 'tri', color: '#74879a' }, { side: 'bottom', from: 0.66, to: 0.76, h: 3, shape: 'shark', color: '#74879a' }],
    mouth: { len: 6, y: 0.24 },
    tail: { len: 12, h: 24, upper: 1, lower: 0.5, notch: 0.75, notchAt: 0.25, curve: 0.8, color: '#5a6c80' }, eye: 1, eyeT: 0.1, eyeY: 0.06 },

  { id: 'sailfish', label: 'SAILFISH', tier: 4, len: 50, h: 12, bill: 13, peak: 0.3, ped: 0.1, blunt: 0.16, taper: 1.3,
    back: '#28407f', side: '#6f8fca', belly: '#e6eef6', fin: '#3a52ad', gill: 0.17,
    bars: { color: '#9fc0ee', gap: 5, w: 1, from: 0.3, to: 0.86, depth: 0.7, skipTop: true },
    fins: [{ side: 'top', from: 0.14, to: 0.72, h: 13, shape: 'sail', color: '#3a52ad', rays: 3 }, { side: 'bottom', from: 0.24, to: 0.3, h: 6, shape: 'shark', color: '#2f448f' },
      { side: 'bottom', from: 0.66, to: 0.76, h: 3, shape: 'shark', color: '#2f448f' }],
    pect: { t: 0.24, len: 6, color: '#2f448f' },
    tail: { len: 11, h: 24, notch: 0.82, notchAt: 0.1, curve: 0.5, color: '#2f448f' }, eye: 2, eyeT: 0.08 },
];

export const fishFrames = (spec) => [-1, 0, 1].map((f) => drawFish(spec, f));
