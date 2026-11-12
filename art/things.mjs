// Everything that is not a fish: boat, hook, junk, sea decoration, icons.
import { Pix, INK, darken, lighten } from './canvas.mjs';

// Wooden boat with a curved hull, a thatched shelter, and the fisher sitting at the bow.
export function boat() {
  const W = 84, H = 50;
  const p = new Pix(W, H);
  const hy = 34;            // deck line in the middle of the boat
  const x0 = 4, x1 = 79, cx = 42, half = 38;
  const top = (x) => { const t = (x - cx) / half; return hy - Math.round(t < 0 ? 8 * (-t) ** 2.3 : 5 * t ** 2.6); };
  const depth = (x) => { const t = Math.abs((x - cx) / half); return Math.max(1, Math.round(11 * (1 - t ** 3.2) ** 0.75)); };
  const paint = ['#f3cf98', '#fbf4e2', '#fbf4e2', '#d9534f', '#2f8f9c', '#b0733f', '#b0733f', '#99602f', '#99602f', '#7d4a26', '#6a3d20'];
  for (let x = x0; x <= x1; x++) {
    const yt = top(x), d = depth(x);
    for (let j = 0; j < d; j++) p.set(x, yt + j, j === d - 1 && d > 3 ? '#6a3d20' : paint[Math.min(j, paint.length - 1)]);
    if (d > 6 && x % 9 === 4) { p.set(x, yt + 6, '#7d4a26'); p.set(x, yt + 7, '#7d4a26'); }
  }
  // upturned prow and stern post
  p.rect(x0 - 1, top(x0) - 2, 2, 2, '#f3cf98'); p.rect(x0 - 2, top(x0) - 4, 2, 2, '#d9534f'); p.set(x0 - 2, top(x0) - 5, '#f3cf98');
  p.rect(x1, top(x1) - 2, 2, 2, '#f3cf98'); p.set(x1 + 1, top(x1) - 3, '#d9534f');

  // shelter: two posts and a thatched roof
  const ry = hy - 17;
  p.rect(48, ry + 3, 1, 14, '#7d4a26'); p.rect(66, ry + 4, 1, 13, '#7d4a26');
  for (let r = 0; r < 4; r++) {
    const xa = 45 - r + (r === 0 ? 3 : 0), xb = 69 + r - (r === 0 ? 3 : 0);
    for (let x = xa; x <= xb; x++) p.set(x, ry + r, r === 3 ? '#b98a3e' : (x + r) % 4 === 0 ? '#d3a652' : '#ecc873');
  }
  p.rect(47, ry - 1, 21, 1, '#f6dc94');
  // lantern hanging under the roof
  p.set(63, ry + 4, '#5a3e2a'); p.rect(62, ry + 5, 3, 1, '#5a3e2a'); p.rect(62, ry + 6, 3, 3, '#ffd86b'); p.set(63, ry + 7, '#fff8d4'); p.rect(62, ry + 9, 3, 1, '#5a3e2a');
  // crate and basket of fish under the shelter
  p.rect(51, hy - 7, 7, 6, '#c98d51'); p.rect(51, hy - 7, 7, 1, '#e4b47e'); p.rect(51, hy - 4, 7, 1, '#a86d3c'); p.rect(51, hy - 2, 7, 1, '#8b5631');
  p.rect(59, hy - 5, 6, 4, '#d3aa68'); for (let y = hy - 4; y < hy - 1; y++) for (let x = 59; x < 65; x++) if ((x + y) % 2 === 0) p.set(x, y, '#b98b4b');
  p.rect(59, hy - 5, 6, 1, '#ecd09a'); p.set(60, hy - 6, '#9fc3d6'); p.set(61, hy - 7, '#cfe0ea'); p.set(62, hy - 6, '#9fc3d6'); p.set(63, hy - 6, '#e36a6c');
  // coiled rope at the stern
  p.rect(71, hy - 4, 4, 2, '#e9d7a8'); p.set(72, hy - 4, '#c9b27a'); p.set(74, hy - 3, '#c9b27a');

  // fisher, sitting near the bow and facing left
  const fx = 19, fy = hy - 21;
  p.grid(fx, fy, [
    '.....HH......',
    '....HHHH.....',
    '...HHHHHH....',
    '..HHhHHHHH...',
    '.HHHHHhHHHHH.',
    'bbbbbbbbbbbbb',
    '...ssssskk...',
    '...sesssk....',
    '..ssrsssk....',
    '...sssss.....',
    '...nnnTTT....',
    '..TTnTTTTt...',
    '.aaaaTTTTt...',
    'ssaaTTTTTt...',
    '...TTTTTTt...',
    '...TTTTTTt...',
    '...pppppppp..',
    '..pppppppppp.',
    '..ppp...oo...',
  ], {
    H: '#f3dc8e', h: '#d6b862', b: '#b8964a', k: '#3a2a2e', s: '#f5cfa8', e: INK, r: '#ee9c8c',
    n: '#d9534f', T: '#4d8fd1', t: '#3970b0', a: '#6aa9e6', p: '#5b4d74', o: '#3a2a2e',
  });
  const o = p.outlined();
  // rod, reel and tip last so they stay thin
  const hand = { x: fx, y: fy + 13 }, tip = { x: 2, y: fy - 9 };
  o.line(hand.x + 3, hand.y + 2, tip.x, tip.y, '#5a3e2a');
  o.rect(hand.x, hand.y, 2, 1, '#f5cfa8');
  o.set(hand.x + 3, hand.y + 3, '#c9d2d9'); o.set(tip.x, tip.y, '#f6e3a6');
  return { pix: o, anchors: { rodTip: tip, waterline: hy + 6 } };
}

export function hook() {
  const p = new Pix(9, 13);
  const S = '#cfd8de', D = '#9aa7b1', H = '#f4f8fa';
  p.rect(4, 1, 2, 2, S); p.set(4, 1, H);            // eye
  p.rect(5, 3, 1, 6, S);                              // shank
  p.set(5, 9, D); p.set(4, 10, D); p.set(3, 10, D); p.set(2, 9, S); p.set(2, 8, S); p.set(2, 7, H); // bend
  p.set(3, 7, D);                                     // barb
  return p.outlined(0.7);
}

export function sandal() {
  const p = new Pix(18, 10);
  p.ellipse(8.5, 4.5, 7, 3.2, '#9b7bd8');
  p.ellipse(12, 4.5, 3.4, 2.6, '#8767c6');
  for (let x = 3; x <= 13; x++) p.set(x, 7, '#7558b3');
  p.line(5, 4, 10, 2, '#f2c94c'); p.line(5, 5, 10, 7, '#f2c94c'); p.set(5, 4, '#fff1a8'); p.set(4, 4, '#f2c94c'); p.set(4, 5, '#f2c94c');
  return p.outlined();
}

export function can() {
  const p = new Pix(10, 14);
  p.rect(2, 2, 6, 10, '#c3ccd3');
  p.rect(2, 5, 6, 4, '#d9534f'); p.rect(2, 6, 6, 1, '#f1e9d2');
  p.rect(2, 2, 6, 1, '#e7edf1'); p.rect(7, 2, 1, 10, '#98a4ad'); p.rect(7, 5, 1, 4, '#b23f3c');
  p.set(4, 10, '#98a4ad'); p.set(3, 9, '#b23f3c'); // dent
  p.rect(3, 1, 4, 1, '#98a4ad');
  return p.outlined();
}

export function tire() {
  const p = new Pix(17, 17);
  p.ellipse(8, 8, 6.6, 6.6, '#3d3b4a');
  for (let y = 0; y < 17; y++) for (let x = 0; x < 17; x++) {
    const d = Math.hypot(x - 8, y - 8);
    if (d <= 2.6) p.clear(x, y);
    else if (d <= 3.6) p.set(x, y, '#2b2936');
    else if (d > 5.6 && d <= 6.6 && (x + y) % 3 === 0) p.set(x, y, '#56546a');
  }
  p.set(5, 4, '#6b6982'); p.set(4, 5, '#6b6982'); p.set(6, 3, '#6b6982');
  return p.outlined();
}

export function rock(big) {
  const p = big ? new Pix(26, 15) : new Pix(15, 10);
  const base = '#6d6887', top = '#8d88a8', moss = '#5fae7d';
  if (big) {
    p.ellipse(9, 9.5, 8, 4.6, base); p.ellipse(17, 10, 7, 4, base); p.ellipse(13, 7, 6, 4.5, base);
    p.ellipse(12, 5.5, 4, 1.6, top); p.ellipse(7, 7.5, 3, 1.2, top); p.rect(15, 4, 4, 1, moss); p.rect(16, 5, 4, 1, moss); p.set(19, 6, moss);
    p.rect(2, 13, 22, 2, base);
  } else {
    p.ellipse(7, 6, 6, 3.6, base); p.ellipse(6, 4.5, 3, 1.3, top); p.rect(2, 8, 11, 1, base); p.rect(8, 3, 3, 1, moss);
  }
  return p.outlined();
}

export function seaweed(frame) {
  const p = new Pix(13, 24);
  const strand = (bx, hgt, ph, c) => {
    for (let i = 0; i < hgt; i++) {
      const y = 22 - i;
      const x = bx + Math.round(Math.sin((i + ph) / 2.4 + frame * 1.2) * (0.4 + i / hgt) * 1.5);
      p.set(x, y, c); if (i < hgt - 2) p.set(x + 1, y, darken(c, 0.15));
      if (i % 5 === 3 && i < hgt - 3) p.set(x + 2, y - 1, lighten(c, 0.1));
    }
  };
  strand(3, 16, 0, '#3f9d6c'); strand(8, 21, 2, '#57b97a');
  return p.outlined();
}

export function coral() {
  const p = new Pix(19, 17);
  const c = '#e98aa2', tip = '#f8bdc8';
  const branch = (x0, y0, x1, y1) => { p.line(x0, y0, x1, y1, c); p.line(x0 + 1, y0, x1 + 1, y1, c); p.set(x1, y1, tip); p.set(x1 + 1, y1, tip); };
  branch(9, 15, 9, 6); branch(9, 11, 4, 6); branch(4, 8, 2, 4); branch(9, 9, 14, 5); branch(14, 7, 16, 3); branch(9, 6, 7, 2); branch(9, 7, 11, 2);
  p.rect(7, 14, 6, 2, '#d0708a');
  return p.outlined();
}

export function bubble(r) {
  const s = r * 2 + 1, p = new Pix(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.hypot(x - r, y - r);
    if (d <= r + 0.3 && d > r - 0.8) p.set(x, y, '#cdeaf4');
  }
  if (r >= 2) p.set(r - Math.ceil(r / 2), r - Math.ceil(r / 2), '#ffffff');
  return p;
}

export function cloud() {
  const p = new Pix(34, 14);
  const w = '#fdf8ec', sh = '#e6dcc6';
  p.ellipse(10, 8, 7, 4, w); p.ellipse(18, 6, 8, 5, w); p.ellipse(25, 9, 6, 3.4, w); p.rect(5, 9, 24, 3, w);
  p.rect(6, 11, 22, 1, sh); p.rect(9, 12, 16, 1, sh);
  return p;
}

// 12x12 icons
export function coin() {
  const p = new Pix(13, 13);
  p.ellipse(6, 6, 5, 5, '#f2c14e');
  for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) { const d = Math.hypot(x - 6, y - 6); if (d > 4 && d <= 5.2) p.set(x, y, '#c98f2b'); }
  p.rect(5, 4, 3, 5, '#e0a93a'); p.rect(4, 5, 5, 3, '#e0a93a'); p.set(4, 3, '#fff1b8'); p.set(3, 4, '#fff1b8'); p.set(5, 3, '#fff1b8');
  return p.outlined();
}
export function bait() {
  const p = new Pix(13, 13);
  const c = '#ef8fa2', d = '#d96f86';
  const pts = [[9, 2], [8, 2], [7, 3], [6, 4], [6, 5], [7, 6], [8, 7], [8, 8], [7, 9], [6, 10], [5, 10], [4, 9]];
  pts.forEach(([x, y], i) => { p.set(x, y, i % 3 === 2 ? d : c); p.set(x, y + 1, i % 3 === 2 ? d : c); });
  p.set(9, 2, '#fbc4cf'); p.set(10, 2, c); p.set(10, 3, c);
  return p.outlined();
}
export function crate() {
  const p = new Pix(13, 13);
  p.rect(1, 2, 11, 9, '#c98d51'); p.rect(1, 2, 11, 1, '#e4b47e'); p.rect(1, 10, 11, 1, '#8b5631');
  p.rect(1, 2, 1, 9, '#8b5631'); p.rect(11, 2, 1, 9, '#8b5631'); p.rect(1, 5, 11, 1, '#a86d3c'); p.rect(1, 8, 11, 1, '#a86d3c');
  p.line(2, 9, 10, 3, '#8b5631');
  return p.outlined();
}
export function hut() {
  const p = new Pix(15, 14);
  p.rect(3, 7, 9, 6, '#ecdcb4'); p.rect(11, 7, 1, 6, '#cdbb90');
  for (let r = 0; r < 5; r++) p.rect(1 + r, 6 - r, 13 - r * 2, 1, r % 2 ? '#c2604a' : '#a84c3b');
  p.rect(6, 9, 3, 4, '#6b4a2f'); p.set(8, 11, '#ffd86b'); p.rect(4, 8, 1, 2, '#9fd3e6');
  return p.outlined();
}

// Treasure chest on the sea floor, and what can be inside it.
export function chest() {
  const p = new Pix(22, 18);
  p.rect(2, 7, 18, 9, '#9a5f33'); p.rect(2, 3, 18, 4, '#b0733f'); p.rect(3, 2, 16, 1, '#c98d51');
  p.rect(2, 7, 18, 1, '#6a3d20'); p.rect(2, 15, 18, 1, '#7d4a26');
  for (const x of [4, 15]) { p.rect(x, 2, 2, 14, '#f2c14e'); p.rect(x, 2, 1, 14, '#ffe08a'); p.rect(x, 7, 2, 1, '#c98f2b'); }
  for (let x = 7; x <= 13; x += 3) p.set(x, 11, '#7d4a26');
  p.rect(10, 6, 3, 4, '#ffd86b'); p.set(11, 8, INK); p.set(10, 6, '#fff3b8');
  return p.outlined();
}
export function pearl() {
  const p = new Pix(13, 13);
  p.ellipse(6, 6, 4.2, 4.2, '#f7f1ea');
  for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) if (p.a(x, y) && x + y > 14) p.set(x, y, '#d3c9e0');
  p.set(4, 4, '#ffffff'); p.set(5, 4, '#ffffff'); p.set(4, 5, '#ffffff'); p.set(8, 8, '#e9dff0');
  return p.outlined();
}
export function goldbar() {
  const p = new Pix(15, 12);
  for (let r = 0; r < 3; r++) p.rect(4 - r, 2 + r, 8 + r, 1, '#ffe08a');
  p.rect(2, 5, 11, 4, '#f2c14e'); p.rect(2, 8, 11, 1, '#c98f2b'); p.rect(12, 3, 1, 6, '#c98f2b'); p.rect(11, 2, 1, 1, '#c98f2b');
  p.rect(5, 6, 4, 1, '#d9a53a'); p.set(4, 3, '#fff6c9'); p.set(5, 3, '#fff6c9');
  return p.outlined();
}
export function crown() {
  const p = new Pix(15, 13);
  p.rect(2, 7, 11, 4, '#f2c14e'); p.rect(2, 10, 11, 1, '#c98f2b'); p.rect(2, 7, 11, 1, '#ffe08a');
  for (const [x, top] of [[2, 4], [7, 2], [12, 4]]) { for (let y = top; y < 7; y++) p.set(x, y, '#f2c14e'); p.set(x, top, '#ffe08a'); }
  for (const x of [3, 4, 5, 6, 8, 9, 10, 11]) { const d = Math.min(Math.abs(x - 2), Math.abs(x - 7), Math.abs(x - 12)); for (let y = 4 + d; y < 7; y++) p.set(x, Math.max(y, 3 + d), '#f2c14e'); }
  p.set(4, 9, '#d9534f'); p.set(7, 9, '#4d8fd1'); p.set(10, 9, '#d9534f'); p.set(7, 1, '#d9534f');
  return p.outlined();
}

export function ticket() {
  const p = new Pix(15, 11);
  p.rect(1, 2, 13, 7, '#f6d77a'); p.rect(1, 2, 13, 1, '#fff1b8'); p.rect(1, 8, 13, 1, '#d9a53a');
  p.clear(1, 5); p.clear(13, 5);                                   // the two notches
  for (let y = 3; y <= 7; y += 2) p.set(5, y, '#c98f2b');         // tear line
  p.rect(7, 4, 5, 1, '#d9534f'); p.rect(7, 6, 4, 1, '#d9534f'); p.set(3, 5, '#d9534f');
  return p.outlined();
}

export const THINGS = () => {
  const b = boat();
  return {
    anchors: { boat: b.anchors },
    sprites: {
      boat: b.pix, hook: hook(),
      junk_flipflop: sandal(), junk_can: can(), junk_tire: tire(),
      rock_small: rock(false), rock_big: rock(true), seaweed_0: seaweed(0), seaweed_1: seaweed(1), coral: coral(),
      bubble_1: bubble(1), bubble_2: bubble(2), bubble_3: bubble(3), cloud: cloud(),
      icon_coin: coin(), icon_bait: bait(), icon_hold: crate(), icon_storage: hut(),
      chest: chest(), item_pearl: pearl(), item_goldbar: goldbar(), item_crown: crown(), icon_ticket: ticket(),
    },
  };
};
