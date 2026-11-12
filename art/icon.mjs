// node icon.mjs  ->  the site's icons, drawn from the game's own sprites:
//   ../favicon.ico                        what a browser asks for by itself (32 px)
//   ../public/icons/icon-32.png, icon-192.png, icon-512.png
//   ../public/icons/apple-touch-icon.png  for a phone's home screen (180 px, no rounded corners: the phone cuts them)
// The picture is 32 by 32 game pixels: the hook on its line, a clownfish coming for it, in the sea of the game.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pix, INK } from './canvas.mjs';
import { FISH, fishFrames } from './fish.mjs';
import { THINGS } from './things.mjs';
import { encodePNG } from './png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..');
const SEA = '#3d86ad', DEEP = '#2f6f97', SKY = '#f6d9a2', FOAM = '#e8f4f2';
const things = THINGS().sprites, fish = fishFrames(FISH.find((f) => f.id === 'clownfish'))[0].flipX();

// `round`: corners cut and an ink edge (a browser tab); without, the colour runs to the edge (a phone cuts its own)
function picture(round) {
  const p = new Pix(32, 32);
  p.rect(0, 0, 32, 32, SEA);
  p.rect(0, 0, 32, 7, SKY);                       // a strip of evening sky
  for (let x = 0; x < 32; x++) p.set(x, 7 + ((x >> 1) & 1), FOAM);      // the water's edge
  p.rect(0, 22, 32, 10, DEEP);                    // deeper water below
  for (let x = 0; x < 32; x += 4) p.set(x + 1, 22, SEA);
  // the line comes down from above, the hook on its end
  const hx = 20, hy = 9;
  p.line(hx + 4, 0, hx + 4, hy, INK);
  p.blit(things.hook, hx, hy);
  // the fish, coming from the left
  p.blit(fish, 2, 12);
  p.blit(things.bubble_1, 5, 25); p.blit(things.bubble_2, 24, 24);
  if (round) {
    for (let i = 0; i < 32; i++) { p.set(i, 0, INK); p.set(i, 31, INK); p.set(0, i, INK); p.set(31, i, INK); }
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [31, 0], [30, 0], [31, 1], [0, 31], [1, 31], [0, 30], [31, 31], [30, 31], [31, 30]]) p.clear(x, y);
    for (const [x, y] of [[1, 1], [30, 1], [1, 30], [30, 30]]) p.set(x, y, INK);
  }
  return p;
}
const png = (p) => encodePNG(p.w, p.h, p.d);
// a square of `size` with the picture `k` times enlarged in its middle, the rest filled with the picture's own edges
function onSquare(size, k) {
  const big = picture(false).scaled(k), p = new Pix(size, size), off = Math.floor((size - big.w) / 2);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) p.set(x, y, big.get(Math.min(big.w - 1, Math.max(0, x - off)), Math.min(big.h - 1, Math.max(0, y - off))));
  return p;
}
// An .ico file that holds one PNG: a header, one entry, the picture.
function ico(pngBytes, size) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head.writeUInt8(size, 6); head.writeUInt8(size, 7); head.writeUInt8(0, 8); head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); head.writeUInt32LE(pngBytes.length, 14); head.writeUInt32LE(22, 18);
  return Buffer.concat([head, Buffer.from(pngBytes)]);
}

const icons = path.join(root, 'public/icons');
fs.mkdirSync(icons, { recursive: true });
const small = png(picture(true));
fs.writeFileSync(path.join(root, 'favicon.ico'), ico(small, 32));
fs.writeFileSync(path.join(icons, 'icon-32.png'), small);
fs.writeFileSync(path.join(icons, 'icon-192.png'), png(picture(true).scaled(6)));
fs.writeFileSync(path.join(icons, 'icon-512.png'), png(picture(true).scaled(16)));
fs.writeFileSync(path.join(icons, 'apple-touch-icon.png'), png(onSquare(180, 5)));
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out/icon-preview.png'), png(picture(true).scaled(10)));
console.log('favicon.ico, public/icons/icon-32.png, icon-192.png, icon-512.png, apple-touch-icon.png');
