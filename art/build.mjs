// node build.mjs  ->  ../public/sprites/atlas.png + atlas.json, and preview sheets in ./out
import fs from 'node:fs';
import { Pix, text } from './canvas.mjs';
import { FISH, fishFrames } from './fish.mjs';
import { THINGS } from './things.mjs';
import { sheet, save } from './sheet.mjs';

const things = THINGS();
const frames = []; // { name, pix }
const animations = {};
for (const f of FISH) {
  const fr = fishFrames(f);
  fr.forEach((pix, i) => frames.push({ name: `fish_${f.id}_${i}`, pix }));
  animations[`fish_${f.id}`] = [0, 1, 2, 1].map((i) => `fish_${f.id}_${i}`);
}
for (const [name, pix] of Object.entries(things.sprites)) frames.push({ name, pix });
animations.seaweed = ['seaweed_0', 'seaweed_1'];

// shelf packing, tallest first
const W = 256;
let x = 1, y = 1, rowH = 0;
const placed = {};
for (const f of [...frames].sort((a, b) => b.pix.h - a.pix.h)) {
  if (x + f.pix.w + 1 > W) { x = 1; y += rowH + 1; rowH = 0; }
  placed[f.name] = { x, y, w: f.pix.w, h: f.pix.h };
  x += f.pix.w + 1; rowH = Math.max(rowH, f.pix.h);
}
const H = y + rowH + 1;
const atlas = new Pix(W, H);
for (const f of frames) atlas.blit(f.pix, placed[f.name].x, placed[f.name].y);

const out = new URL('../public/sprites/', import.meta.url);
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
fs.mkdirSync(out, { recursive: true });
save(new URL('atlas.png', out), atlas);
const json = {
  frames: Object.fromEntries(frames.map((f) => [f.name, {
    frame: placed[f.name], rotated: false, trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: f.pix.w, h: f.pix.h }, sourceSize: { w: f.pix.w, h: f.pix.h },
  }])),
  animations,
  meta: { app: 'kail/art', image: 'atlas.png', format: 'RGBA8888', size: { w: W, h: H }, scale: '1' },
};
fs.writeFileSync(new URL('atlas.json', out), JSON.stringify(json, null, 1));
fs.writeFileSync(new URL('art.json', out), JSON.stringify({
  anchors: things.anchors,
  fish: FISH.map((f) => ({ id: f.id, label: f.label, tier: f.tier, w: fishFrames(f)[1].w, h: fishFrames(f)[1].h })),
}, null, 1));

// preview: every sprite, labelled
const byName = Object.fromEntries(frames.map((f) => [f.name, f.pix]));
const T = things.sprites;
const outFile = (n) => new URL(`./out/${n}`, import.meta.url);
save(outFile('catalog.png'), sheet([
  ...FISH.map((f) => ({ label: f.label, sprites: fishFrames(f) })),
  { label: 'BOAT', sprites: [T.boat, T.hook] },
  { label: 'JUNK', sprites: [T.junk_flipflop, T.junk_can, T.junk_tire] },
  { label: 'DECOR', sprites: [T.rock_small, T.rock_big, T.seaweed_0, T.seaweed_1, T.coral, T.bubble_1, T.bubble_2, T.bubble_3, T.cloud] },
  { label: 'ICONS', sprites: [T.icon_coin, T.icon_bait, T.icon_hold, T.icon_storage] },
  { label: 'CHEST', sprites: [T.chest, T.item_pearl, T.item_goldbar, T.item_crown, T.icon_ticket] },
], { k: 4, labelW: 44 }));

// preview: the whole sea as one tall column, 180 game pixels wide (portrait, phone first)
const GW = 180, SURF = 60, FLOOR = 700, GH = FLOOR + 12;
const sea = new Pix(GW, GH);
const stops = [[0, '#fbe3b4'], [20, '#f8d3a2'], [40, '#f4c194'], [SURF, '#5cb6c6'], [SURF + 4, '#4eaac1'], [120, '#459cb9'], [200, '#3d8eaf'],
  [290, '#367fa3'], [380, '#307096'], [470, '#2b6289'], [560, '#26557c'], [640, '#22496e'], [FLOOR, '#d8c79a'], [FLOOR + 3, '#c4b182']];
stops.forEach(([y0, c], i) => sea.rect(0, y0, GW, (stops[i + 1]?.[0] ?? GH) - y0, c));
for (let i = 0; i < GW; i += 2) sea.set(i + ((i / 2) % 2), SURF, '#eefafa');
for (let i = 3; i < GW; i += 9) sea.set(i, SURF + 2, '#93d6e0');
sea.blit(T.cloud, 6, 8); sea.blit(T.cloud, 96, 2);
sea.ellipse(34, 36, 8, 8, '#fff3c8');
const put = (name, px, py, flip) => sea.blit(flip ? byName[name].flipX() : byName[name], px, py);
// sea floor
put('rock_big', 2, FLOOR - 13); put('seaweed_0', 30, FLOOR - 22); put('coral', 58, FLOOR - 15); put('seaweed_1', 82, FLOOR - 22);
put('rock_small', 118, FLOOR - 8); put('seaweed_0', 140, FLOOR - 22); put('coral', 158, FLOOR - 15);
// shallow
put('fish_anchovy_1', 12, 78); put('fish_anchovy_0', 30, 86); put('fish_anchovy_2', 20, 96); put('fish_anchovy_1', 134, 122, true); put('fish_anchovy_0', 150, 130, true);
put('fish_mackerel_1', 112, 90, true); put('fish_mackerel_0', 38, 146); put('fish_mackerel_2', 96, 176, true);
put('fish_clownfish_1', 148, 152); put('fish_clownfish_2', 58, 196); put('junk_flipflop', 126, 204);
// middle
put('fish_snapper_1', 18, 238, true); put('fish_milkfish_0', 104, 254); put('fish_grouper_1', 66, 290); put('fish_snapper_2', 124, 312);
put('fish_milkfish_1', 12, 336, true); put('junk_can', 92, 346); put('fish_grouper_0', 128, 366, true);
// deep
put('fish_barracuda_1', 104, 416, true); put('fish_tuna_1', 12, 440, true); put('fish_shark_0', 92, 478); put('fish_barracuda_0', 8, 512);
put('fish_tuna_2', 114, 528); put('junk_tire', 66, 556);
// bottom
put('fish_sailfish_1', 52, 596); put('fish_shark_1', 14, 646, true);
[[70, 108, 2], [74, 100, 1], [150, 180, 3], [30, 270, 1], [100, 330, 2], [60, 430, 1], [150, 470, 3], [40, 600, 2], [130, 650, 1]].forEach(([x, y, r]) => put(`bubble_${r}`, x, y));
// boat on the right so the rod tip sits over the middle of the screen
const bx = 88, by = SURF - things.anchors.boat.waterline + 1;
sea.blit(T.boat, bx, by);
const tip = { x: bx + things.anchors.boat.rodTip.x, y: by + things.anchors.boat.rodTip.y };
const hk = { x: 60, y: 128 };
sea.line(tip.x, tip.y, hk.x + 5, hk.y, '#f6efd8');
sea.blit(T.hook, hk.x, hk.y);

// what the phone shows at the start: the top 320 game pixels plus a rough HUD
const PH = 320;
const phone = sea.crop({ x: 0, y: 0, w: GW, h: PH });
const panel = (x, y, w, h) => { phone.rect(x, y, w, h, '#3a2a2e'); phone.rect(x + 1, y + 1, w - 2, h - 3, '#fbf4e2'); phone.rect(x + 1, y + h - 2, w - 2, 1, '#d9c9a3'); };
panel(4, 4, 44, 17); phone.blit(T.icon_coin, 6, 6); text(phone, 22, 10, '120', '#3a2a2e');
panel(52, 4, 36, 17); phone.blit(T.icon_bait, 54, 6); text(phone, 70, 10, '8', '#3a2a2e');
panel(132, 4, 44, 17); text(phone, 138, 10, '0 M', '#3a2a2e');
panel(58, PH - 28, 64, 22); text(phone, 72, PH - 22, 'CAST', '#3a2a2e', 2);
panel(6, PH - 26, 20, 20); phone.blit(T.icon_bait, 9, PH - 23);
panel(154, PH - 26, 20, 20); phone.blit(T.icon_hold, 157, PH - 23);
save(outFile('scene-phone.png'), phone.scaled(3));

// the whole column, with the depth zones and one phone screen marked
const col = new Pix(GW + 46, GH);
col.rect(0, 0, col.w, col.h, '#2a2238');
col.blit(sea, 0, 0);
[[SURF, 'SHALLOW'], [220, 'MIDDLE'], [400, 'DEEP'], [580, 'BOTTOM']].forEach(([y, label]) => {
  for (let x = 0; x < GW; x += 4) col.rect(x, y, 2, 1, '#f6efd8');
  text(col, GW + 4, y + 3, label, '#f6efd8');
});
col.rect(GW + 2, 0, 1, PH, '#ffd86b'); text(col, GW + 4, PH - 14, 'ONE', '#ffd86b'); text(col, GW + 4, PH - 7, 'SCREEN', '#ffd86b');
save(outFile('scene-depth.png'), col.scaled(2));
console.log(`atlas ${W}x${H}, ${frames.length} frames`);
