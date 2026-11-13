// What does one of each thing cost to bring up? Counted in throws (= bait) and in seconds.
// The robot goes for one kind only and waits for a throw until one is in the water.
// node test/effort.mjs
import { FISH, RARE } from '../src/config.js';
import { newWorld, newPlayer, step, release, entities } from '../src/sim.js';
import { makeBot } from './bot.mjs';

const DT = 1 / 60;
export function effort({ id, lag, reel = 0, minutes = 30, seed = 1 }) {
  const chest = id === 'chest';
  const world = newWorld(seed), p = newPlayer();
  p.up.reel = reel; p.up.storage = 4; p.bait = 1e9;
  const bot = makeBot({ wantId: chest ? null : id, wantChest: chest, lag });
  const o = { casts: 0, got: 0, other: 0, lost: 0, junk: 0, nothing: 0, rare: {} };
  for (let t = 0; t < minutes * 60; t += DT) {
    // a sensible player does not throw while the thing wanted is not there
    const there = entities(world).some((e) => (chest ? e.kind === 'chest' : e.def.id === id));
    if (world.hook.state !== 'idle' || there) { if (bot(world, p, DT)) o.casts++; }
    step(world, p, DT);
    for (const ev of world.events.splice(0)) {
      if (ev.type === 'hooked' && ev.kind === 'junk') release(world);
      if (ev.type === 'released') o.junk++;
      if (ev.type === 'miss') o.nothing++;
      if (ev.type === 'snapped') o.lost++;
      if (ev.type === 'landed') { if (ev.chest) { o.got++; o.rare[ev.id] = (o.rare[ev.id] || 0) + 1; } else if (ev.id === id) o.got++; else o.other++; }
    }
    p.storage = {};
  }
  o.perItem = o.casts / Math.max(1, o.got); o.secPerItem = (minutes * 60) / Math.max(1, o.got);
  return o;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const players = [['quick', 0.15], ['average', 0.28], ['slow', 0.42]];
  console.log('throws per one landed (and seconds per one), reel level 1. "other" = share of throws that brought up a different fish.');
  console.log('thing'.padEnd(10), players.map(([l]) => l.padStart(18)).join(''), '   other  lost  (average player)');
  for (const id of [...FISH.map((f) => f.id), 'chest']) {
    const rows = players.map(([, lag]) => [1, 2].map((seed) => effort({ id, lag, seed })).reduce((a, r) => ({ casts: a.casts + r.casts, got: a.got + r.got, other: a.other + r.other, lost: a.lost + r.lost }), { casts: 0, got: 0, other: 0, lost: 0 }));
    const cell = (r) => `${(r.casts / Math.max(1, r.got)).toFixed(2)} (${((2 * 30 * 60) / Math.max(1, r.got)).toFixed(0)}s)`.padStart(18);
    const a = rows[1];
    console.log(id.padEnd(10), rows.map(cell).join(''), `   ${(100 * a.other / a.casts).toFixed(0).padStart(3)}%  ${(100 * a.lost / a.casts).toFixed(0).padStart(3)}%`);
  }
  const odds = RARE.reduce((a, r) => a + r.odds, 0);
  console.log('\na chest holds:', RARE.map((r) => `${r.id} ${(100 * r.odds / odds).toFixed(0)}%`).join(', '));
}
