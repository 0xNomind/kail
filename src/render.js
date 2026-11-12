// Draws the sea. Nothing here changes the game.
// The sea is 180 game pixels wide, but the canvas has "k" real pixels for each game pixel.
// Sprites stay chunky; their positions can land between game pixels, so movement is smooth.
import { W, SURF, FLOOR, WORLD_H, BOAT, PIVOT } from './config.js';

// the sky goes on above y = 0, for screens that show more of it (see "sky" in resize)
export const BANDS = [[-200, '#fff6df'], [-20, '#fdedc9'], [0, '#fbe3b4'], [20, '#f8d3a2'], [40, '#f4c194'], [SURF, '#5cb6c6'], [SURF + 4, '#4eaac1'], [120, '#459cb9'], [200, '#3d8eaf'],
  [290, '#367fa3'], [380, '#307096'], [470, '#2b6289'], [560, '#26557c'], [640, '#22496e'], [FLOOR, '#d8c79a'], [FLOOR + 3, '#c4b182'], [WORLD_H + 60, null]];
const FLOOR_ROOM = 14;   // let the view go a little past the floor, so the chest is not glued to the screen edge
const DECOR = [['rock_big', 2, 13], ['seaweed', 30, 22], ['coral', 58, 15], ['seaweed', 82, 22], ['rock_small', 118, 8], ['seaweed', 140, 22], ['coral', 158, 15]];
const SWIM = [0, 1, 2, 1];
const ease = (t) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

const loadImage = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

export async function loadArt() {
  const [img, atlas] = await Promise.all([loadImage('public/sprites/atlas.png'), fetch('public/sprites/atlas.json').then((r) => r.json())]);
  return { img, frames: atlas.frames };
}

// A sprite as a small image, for the menus.
export function iconURL(art, name) {
  const f = art.frames[name].frame;
  const c = document.createElement('canvas');
  c.width = f.w; c.height = f.h;
  c.getContext('2d').drawImage(art.img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
  return { url: c.toDataURL(), w: f.w, h: f.h };
}

export function makeRenderer(canvas, art) {
  const ctx = canvas.getContext('2d');
  let cam = 0, k = 1, VH = 320, SKY = 0;
  const bubbles = [];
  const snap = (v) => Math.round(v * k) / k;   // nearest real pixel

  // viewH = height in game pixels, scale = real pixels per game pixel,
  // sky = how many game pixels of extra sky to show above the boat when the hook is up
  function resize(viewH, scale, sky = 0) {
    cam += SKY - sky; SKY = sky;
    VH = viewH; k = Math.max(1, Math.round(scale));
    canvas.width = W * k; canvas.height = VH * k;
  }

  const sprite = (name, x, y, flip) => {
    const f = art.frames[name].frame;
    x = snap(x); y = snap(y);
    if (y > VH || y + f.h < 0) return;
    if (!flip) { ctx.drawImage(art.img, f.x, f.y, f.w, f.h, x, y, f.w, f.h); return; }
    ctx.save(); ctx.translate(x + f.w, y); ctx.scale(-1, 1);
    ctx.drawImage(art.img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    ctx.restore();
  };
  // a sprite turned around its middle
  const turned = (name, cx, cy, angle, mirror) => {
    const f = art.frames[name].frame;
    ctx.save(); ctx.translate(snap(cx), snap(cy)); ctx.rotate(angle); if (mirror) ctx.scale(-1, 1);
    ctx.drawImage(art.img, f.x, f.y, f.w, f.h, -f.w / 2, -f.h / 2, f.w, f.h);
    ctx.restore();
  };
  const dot = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(snap(x), snap(y), 1, 1); };

  function draw(world, dt, t) {
    const h = world.hook;
    // going down the hook sits a little above the middle (more room to see below); coming up, a little below it
    const anchor = h.state === 'in' ? 0.58 : 0.42;
    const target = h.state === 'idle' ? -SKY : Math.max(-SKY, Math.min(WORLD_H + FLOOR_ROOM - VH, h.y - VH * anchor));
    cam += (target - cam) * (1 - Math.exp(-dt * (h.state === 'idle' ? 6 : 4.5)));
    const cy = snap(cam);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // sky, water and sand, as flat bands
    for (let i = 0; i < BANDS.length - 1; i++) {
      const [y0, c] = BANDS[i], y1 = BANDS[i + 1][0];
      if (y1 - cy < 0 || y0 - cy > VH) continue;
      ctx.fillStyle = c; ctx.fillRect(0, y0 - cy, W, y1 - y0 + 1);
    }
    if (cy < SURF + 4) {
      ctx.fillStyle = '#fff3c8';
      for (let j = -8; j <= 8; j++) { const hw = Math.round(Math.sqrt(64 - j * j)); ctx.fillRect(34 - hw, 36 + j - cy, hw * 2 + 1, 1); }
      sprite('cloud', ((6 + t * 1.2) % (W + 40)) - 36, 8 - cy);
      sprite('cloud', ((120 + t * 0.7) % (W + 40)) - 36, 2 - cy);
      if (SKY) sprite('cloud', ((60 + t * 0.9) % (W + 40)) - 36, -SKY * 0.6 - cy);
      const shift = Math.floor(t * 3) % 4;
      for (let x = 0; x < W; x += 2) dot(x + ((x / 2 + shift) % 2), SURF - cy, '#eefafa');
      for (let x = 3 - shift; x < W; x += 9) dot(x, SURF + 2 - cy, '#93d6e0');
    }
    for (const [name, x, up] of DECOR) sprite(name === 'seaweed' ? `seaweed_${Math.floor(t * 1.5 + x) % 2}` : name, x, FLOOR - up - cy);

    // bubbles
    if (Math.random() < dt * 0.45) bubbles.push({ x: Math.random() * W, y: cy + VH + 4, r: Math.random() < 0.7 ? 1 : 2, v: 8 + Math.random() * 10 });
    if (h.state === 'out' && Math.random() < dt * 14) bubbles.push({ x: h.x + Math.random() * 6 - 3, y: h.y, r: 1, v: 14 });
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y -= b.v * dt;
      if (b.y < SURF + 3 || bubbles.length > 24) { bubbles.splice(i, 1); continue; }
      sprite(`bubble_${b.r}`, b.x + Math.sin(b.y / 7) * 1.5, b.y - cy);
    }

    // fish and junk
    const name = (e) => (e.kind === 'fish' ? `fish_${e.def.id}_${SWIM[((Math.floor(e.anim) % 4) + 4) % 4]}` : e.def.sprite);
    for (const s of world.slots) {
      const e = s.ent;
      if (!e || e.hooked) continue;
      sprite(name(e), e.x, e.y + Math.sin(e.bob) * 1.2 - cy, e.dir > 0);
    }

    // boat, with the part under water tinted
    const bob = Math.round(Math.sin(t * 1.4) * 0.8);
    const by = SURF - BOAT.waterline + 1 + bob;
    sprite('boat', BOAT.x, by - cy);
    if (cy < SURF + 14) { ctx.fillStyle = 'rgba(78,170,193,0.5)'; ctx.fillRect(BOAT.x, SURF + 1 - cy, BOAT.w, 11); }

    // the line: one straight stroke, so it does not shimmer while it moves
    const strain = h.fight ? 1 - Math.max(0, Math.min(1, h.fight.grip)) : 0;      // a weak grip shows on the line
    // the line turns from cream to red as it strains
    ctx.strokeStyle = strain > 0.4 ? `rgb(${246 - 29 * strain | 0}, ${239 - 180 * (strain - 0.4) / 0.6 | 0}, ${216 - 150 * (strain - 0.4) / 0.6 | 0})` : '#f6efd8';
    ctx.lineWidth = Math.max(1 / k, 0.7); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(PIVOT.x + 0.5, PIVOT.y + bob - cy + 0.5); ctx.lineTo(h.x + 0.5, h.y - 9 - cy); ctx.stroke();
    if (h.state === 'idle') {
      const dx = Math.sin(h.ang), dy = Math.cos(h.ang);
      for (let i = 1; i <= 5; i++) dot(h.x + dx * (4 + i * 6), h.y + dy * (4 + i * 6) - cy, i % 2 ? '#fff6c9' : '#f2c14e');
    }
    sprite('hook', h.x - 4, h.y - 10 - cy);

    // whatever hangs on the hook: it swings from where it was grabbed to hanging under the hook
    if (h.catch?.ent && h.grab) {
      const e = h.catch.ent, f = art.frames[name(e)].frame, m = ease(h.pull / 0.28);
      const fish = e.kind === 'fish', mirror = h.grab.dir > 0;
      const fromX = h.grab.x + f.w / 2, fromY = h.grab.y + f.h / 2;
      const toX = h.x, toY = h.y + 1 + (fish ? f.w / 2 : f.h / 2);
      const hang = fish ? (mirror ? -Math.PI / 2 : Math.PI / 2) : 0;      // a fish hangs head up
      const loose = h.fight ? !h.fight.inside : false;      // the icon is outside the box: it thrashes
      const wiggle = Math.sin(t * (loose ? 34 : fish ? 17 : 5)) * (loose ? (fish ? 0.42 : 0.16) : fish ? 0.13 : 0.05) * m;
      turned(name(e), fromX + (toX - fromX) * m, fromY + (toY - fromY) * m - cy, hang * m + wiggle, mirror);
      if (loose && Math.random() < dt * 22) bubbles.push({ x: toX + Math.random() * 10 - 5, y: h.y + 6, r: 1, v: 18 });
    }
    return cy;
  }
  return { draw, resize };
}
