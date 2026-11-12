// Can a throw be checked by playing it again? A robot plays the way the game runs: frames of uneven length,
// the sea moving in fixed steps, the hands written down as moves. At every catch the record since the last
// check is played again from the sea written down then (src/replay.js), and must give the same catch and
// leave the very same sea, to the last digit. Records that were tampered with must be turned away.
//   node test/replay.mjs            the test
//   node test/replay.mjs export     also writes test/replay-log.mjs for another engine (see replay-other-engine.mjs)
import { newWorld, step, cast, release } from '../src/sim.js';
import { mulberry32 } from '../src/rng.js';
import { TICK, REST_TICKS, makeRecorder, writeSea, rerun, roundX } from '../src/replay.js';
import { makeBot } from './bot.mjs';

const text = (x) => JSON.stringify(x);

// One sitting at the game. Gives every check that was made: the record, and what the game itself saw.
export function sitting({ seed = 7, minutes = 10, lag = 0.18, keepEvery = 120 } = {}) {
  const world = newWorld(seed), player = { bait: 1e9, up: { reel: 0, storage: 4 }, storage: {}, stats: { casts: 0, landed: 0 } };
  const bot = makeBot({ lag }), rec = makeRecorder(), jitter = mulberry32(seed + 99), h = world.hook;
  let tick = 0, acc = 0, backTick = -REST_TICKS, throws = 0, drop = false;
  let base = { start: { seed, back: -REST_TICKS }, tick: 0 };
  const checks = [];
  const check = (caught) => {
    const record = { start: base.start, ticks: tick - base.tick, moves: JSON.parse(text(rec.cut(base.tick, tick))), reel: 0 };
    checks.push({ record, throws, caught, sea: text(writeSea(world)), back: Math.max(-REST_TICKS, backTick - tick) });
    base = { start: { sea: JSON.parse(text(writeSea(world))), back: Math.max(-REST_TICKS, backTick - tick) }, tick };
    rec.forget(tick); throws = 0;
  };
  for (let t = 0; t < minutes * 60;) {
    // frame lengths as on real screens: mostly 60 a second, some 120, now and then a long one
    const r = jitter(), dt = r < 0.7 ? 1 / 60 + (jitter() - 0.5) * 0.004 : r < 0.9 ? 1 / 120 + (jitter() - 0.5) * 0.002 : 0.02 + jitter() * 0.03;
    t += dt; acc += dt;
    // between frames: the hands
    if (drop) { drop = false; if (release(world)) rec.did(tick, 'r'); }
    const wasIdle = h.state === 'idle';
    if (!wasIdle || tick - backTick >= REST_TICKS) bot(world, player, dt);
    if (wasIdle && h.state === 'out') { rec.did(tick, 'c'); throws++; }
    const live = h.state !== 'idle';
    h.steer = live ? Math.sign(h.steer) : 0; h.hold = live && !!h.hold; h.targetX = live ? roundX(h.targetX) : null;
    rec.hands(tick, h.steer, h.hold, h.targetX);
    // the sea moves in whole steps
    while (acc >= TICK) {
      acc -= TICK;
      const out = h.state !== 'idle';
      step(world, player, TICK); tick++;
      if (out && h.state === 'idle') backTick = tick;
      for (const ev of world.events.splice(0)) {
        if (ev.type === 'hooked' && ev.kind === 'junk') drop = true;
        if (ev.type === 'landed') check(ev.chest ? 'chest' : ev.id);
      }
      player.storage = {};
    }
    // nothing caught for a while: hand in what there is, to keep records short
    if (h.state === 'idle' && tick - base.tick > keepEvery * 240) check(null);
  }
  return checks;
}

// Play every record of a sitting again. Gives how many came out wrong.
export function recheck(checks) {
  let wrong = 0, ms = 0, longest = 0;
  for (const c of checks) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    let got = null;
    try { got = rerun(c.record.start, c.record.ticks, c.record.moves, c.record.reel); } catch (e) { got = { error: String(e.message) }; }
    const took = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    ms += took; longest = Math.max(longest, took);
    const same = !got.error && got.throws === c.throws && (got.caught?.what ?? null) === c.caught && (!c.caught || got.caught.tick === c.record.ticks - 1)
      && got.idle && got.back === c.back && text(writeSea(got.world)) === c.sea;
    if (!same) { wrong++; if (wrong === 1) console.log('  first wrong one:', got.error || text({ throws: [got.throws, c.throws], caught: [got.caught, c.caught], back: [got.back, c.back] })); }
  }
  return { wrong, ms, longest };
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('replay.mjs')) {
  let all = 0, wrong = 0, catches = 0, bytes = 0, ticks = 0, ms = 0, longest = 0, biggest = 0, moves = 0;
  const out = [];
  for (let seed = 1; seed <= 20; seed++) {
    const checks = sitting({ seed, minutes: 10, lag: seed % 2 ? 0.18 : 0.05 });
    const r = recheck(checks);
    all += checks.length; wrong += r.wrong; ms += r.ms; longest = Math.max(longest, r.longest);
    for (const c of checks) { const size = text(c.record.moves).length; bytes += size; biggest = Math.max(biggest, size); ticks += c.record.ticks; moves += c.record.moves.length; if (c.caught) catches++; }
    if (seed <= 4) out.push(...checks);
  }
  console.log(`20 sittings of 10 minutes: ${all} records checked (${catches} catches), ${wrong === 0 ? 'every one came out the same' : wrong + ' CAME OUT DIFFERENT'}`);
  console.log(`a record: ${(bytes / all / 1024).toFixed(2)} KB of moves on average (${Math.round(moves / all)} moves), ${(biggest / 1024).toFixed(1)} KB the biggest, ${(ticks / all / 240).toFixed(1)} s of play`);
  console.log(`playing one again: ${(ms / all).toFixed(2)} ms on average, ${longest.toFixed(1)} ms the slowest; ${(ms / (ticks / 240) ).toFixed(3)} ms per second of play`);

  // Records that were made up. A record can only ever give what the sea gives when it is played: so a changed
  // record is either turned away, or it is simply another way of playing (and its catch is what that play brings).
  const good = sitting({ seed: 3, minutes: 3 }).filter((c) => c.caught && c.record.moves.length > 6).slice(0, 12);
  let held = 0, tried = 0;
  const made = (name, change, ok) => {
    for (const c of good) {
      const rec = JSON.parse(text(c.record)); change(rec);
      let got; try { got = rerun(rec.start, rec.ticks, rec.moves, rec.reel); } catch (e) { got = { error: e.message }; }
      tried++;
      if (ok(got, c, rec)) held++; else console.log(`  WRONG: ${name}:`, text({ error: got.error, caught: got.caught, throws: got.throws }));
    }
  };
  made('an honest record gives its catch', () => {}, (g, c, r) => g.caught?.what === c.caught && g.caught.tick === r.ticks - 1);
  made('no throw, no catch', (r) => { r.moves = r.moves.filter((m) => m[1] !== 'c'); }, (g) => !g.error && g.throws === 0 && !g.caught);
  made('a throw before the hook has rested is turned away', (r) => { const m = r.moves.findLast((x) => x[1] === 'c'); r.moves.push([m[0] + 1, 'c']); r.moves.sort((a, b) => a[0] - b[0]); }, (g) => !!g.error);
  made('a record cut short has no catch at its end', (r) => { r.ticks = Math.max(1, r.ticks - 30); r.moves = r.moves.filter((m) => m[0] < r.ticks); }, (g, c, r) => !g.error && !(g.caught && g.caught.tick === r.ticks - 1));
  made('moves out of order are turned away', (r) => { r.moves.reverse(); }, (g) => !!g.error);
  made('moves after the end are turned away', (r) => { r.moves.push([r.ticks + 5, 0, 0, null]); }, (g) => !!g.error);
  made('a hand that cannot be is turned away', (r) => { r.moves.push([r.ticks - 1, 3, 0, null]); }, (g) => !!g.error);
  made('a reel that does not exist is turned away', (r) => { r.moves.unshift([0, 'u', 9]); }, (g) => !!g.error);
  made('a record that is too long is turned away', (r) => { r.ticks = 5 * 60 * 240 + 1; }, (g) => !!g.error);
  console.log(`made-up records: ${held} of ${tried} came out as they should`);
  if (held !== tried) wrong++;

  if (process.argv[2] === 'export') {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(new URL('./replay-log.mjs', import.meta.url), `export default ${text(out)};\n`);
    console.log(`wrote ${out.length} records for another engine`);
  }
  if (wrong) process.exit(1);
}
