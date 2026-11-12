// Lays sprites out on a labelled sheet so they can be looked at.
import fs from 'node:fs';
import { Pix, text } from './canvas.mjs';
import { encodePNG } from './png.mjs';

// rows: [{ label, sprites: [Pix, ...] }]
export function sheet(rows, { k = 5, bg = '#2f6f97', pad = 4, labelW = 40 } = {}) {
  const rowH = rows.map((r) => Math.max(7, ...r.sprites.map((s) => s.h)) + pad);
  const rowW = rows.map((r) => labelW + r.sprites.reduce((a, s) => a + s.w + pad, 0));
  const W = Math.max(...rowW) + pad, H = rowH.reduce((a, b) => a + b, 0) + pad;
  const p = new Pix(W, H);
  p.rect(0, 0, W, H, bg);
  let y = pad;
  rows.forEach((r, i) => {
    text(p, pad, y + Math.floor((rowH[i] - pad - 5) / 2), r.label, '#f6efd8');
    let x = labelW;
    for (const s of r.sprites) { p.blit(s, x, y + Math.floor((rowH[i] - pad - s.h) / 2)); x += s.w + pad; }
    y += rowH[i];
  });
  return p.scaled(k);
}
export const save = (file, p) => fs.writeFileSync(file, encodePNG(p.w, p.h, p.d));
