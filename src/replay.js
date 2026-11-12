// Playing a throw again, to check it.
//
// The sea runs in steps of a fixed length (TICK), so what happens depends only on the sea it started from and on
// what the player's hands did at which step. The game writes those moves down (`makeRecorder`); the server
// starts the same sea and plays the moves again (`rerun`). What comes up there is what the player really caught.
// Nothing here draws or talks to anybody, so the browser and the server run the very same code.
import { HOOK, UPGRADES } from './config.js';
import { newWorld, step, cast, release } from './sim.js';

export const TICK = 1 / 240;
export const TICKS_PER_SECOND = 240;
// The hook rests at the boat for a moment before it can be thrown again (0.9 s).
export const REST_TICKS = 216;
// A record is never longer than this (5 minutes): the game hands in a shorter one long before.
export const MAX_TICKS = 5 * 60 * TICKS_PER_SECOND;
export const MAX_MOVES = 6000;
const TOP_REEL = UPGRADES.reel.values.length - 1;

// The pointer's place is kept to a tenth of a game pixel: fine enough to steer, short to write down.
export const roundX = (x) => (x == null ? null : Math.round(x * 10) / 10);

// ---- the game's side: writing down what the hands do
// A move is [step, steer, hold, targetX] (the hands changed), [step, 'c'] (a throw), [step, 'r'] (let the catch
// go) or [step, 'u', level] (a better reel). Steps count from the start of this sea.
export function makeRecorder() {
  let moves = [], hands = [0, 0, null];
  return {
    hands(tick, steer, hold, targetX) {
      const h = hold ? 1 : 0;
      if (steer === hands[0] && h === hands[1] && targetX === hands[2]) return;
      hands = [steer, h, targetX];
      moves.push([tick, steer, h, targetX]);
    },
    did(tick, what, value) { moves.push(value === undefined ? [tick, what] : [tick, what, value]); },
    // the moves from step `from` up to (not with) step `to`, counted from `from`; the hands as they were at `from` come first
    cut(from, to) {
      let before = [0, 0, null];
      const out = [];
      for (const m of moves) {
        if (m[0] < from) { if (typeof m[1] === 'number') before = [m[1], m[2], m[3]]; continue; }
        if (m[0] >= to) break;
        out.push([m[0] - from, ...m.slice(1)]);
      }
      if (before[0] || before[1] || before[2] != null) out.unshift([0, ...before]);
      return out;
    },
    // forget what is older than step `from`, but remember how the hands were then
    forget(from) {
      let before = null;
      const keep = [];
      for (const m of moves) { if (m[0] < from) { if (typeof m[1] === 'number') before = m; } else keep.push(m); }
      if (before) keep.unshift([from, before[1], before[2], before[3]]);
      moves = keep;
    },
    // how many moves were written down from step `from` on
    since(from) { let n = 0; for (const m of moves) if (m[0] >= from) n++; return n; },
    reset() { moves = []; hands = [0, 0, null]; },
  };
}

// ---- a sea written down, and picked up again
// Only taken while the hook hangs at the boat: then the hook is told by one number (where it is in its swing).
export function writeSea(world) {
  if (world.hook.state !== 'idle') throw new Error('The sea is only written down while the hook is at the boat');
  return {
    rnd: world.rnd.at(), phase: world.hook.phase,
    slots: world.slots.map((s) => (s.ent ? [s.ent.x, s.ent.y, s.ent.speed, s.ent.dir] : [s.timer])),
  };
}
export function readSea(sea) {
  const world = newWorld(1);
  if (!sea || !Array.isArray(sea.slots) || sea.slots.length !== world.slots.length) throw new Error('That is not a sea');
  world.slots.forEach((s, i) => {
    const w = sea.slots[i];
    if (w.length === 1) { s.ent = null; s.timer = w[0]; }
    else s.ent = { def: s.def, kind: s.kind, x: w[0], y: w[1], speed: w[2], dir: w[3], bob: 0, hooked: false, anim: 0 };
  });
  world.rnd.from(sea.rnd);
  Object.assign(world.hook, { state: 'idle', phase: sea.phase, vx: 0, catch: null, fight: null, steer: 0, hold: false, targetX: null });
  return world;
}

// ---- the server's side: playing a record again
// `start` is { seed } (a new sea) or { sea } (one written down), with `back`: how many steps ago the hook came
// back to the boat (0 or less). `reel` is the reel level at the start.
// Gives what happened: how many throws, what the last throw brought up, when it was thrown.
// Throws an Error when the record is not something a game could have written.
export function rerun(start, ticks, moves, reel = 0) {
  if (!Number.isInteger(ticks) || ticks < 0 || ticks > MAX_TICKS) throw new Error('The record is too long');
  if (!Array.isArray(moves) || moves.length > MAX_MOVES) throw new Error('The record has too many moves');
  if (!Number.isInteger(reel) || reel < 0 || reel > TOP_REEL) throw new Error('No such reel');
  const world = start.sea ? readSea(start.sea) : newWorld(start.seed >>> 0);
  const player = { bait: 1e9, up: { reel, storage: UPGRADES.storage.values.length - 1 }, storage: {}, stats: { casts: 0, landed: 0 } };
  const h = world.hook;
  let throws = 0, lastThrow = -1, caught = null, topReel = reel, i = 0;
  let backAt = Number.isInteger(start.back) ? Math.max(-REST_TICKS, Math.min(0, start.back)) : -REST_TICKS;
  for (let tick = 0; tick < ticks; tick++) {
    for (; i < moves.length; i++) {
      const m = moves[i];
      if (!Array.isArray(m) || !Number.isInteger(m[0]) || m[0] < tick) throw new Error('The moves are out of order');
      if (m[0] > tick) break;
      if (m[1] === 'c') {
        if (tick - backAt < REST_TICKS || !cast(world, player)) throw new Error('A throw that could not have been made');
        throws++; lastThrow = tick; caught = null;
      } else if (m[1] === 'r') release(world);
      else if (m[1] === 'u') {
        if (!Number.isInteger(m[2]) || m[2] < player.up.reel || m[2] > TOP_REEL) throw new Error('No such reel');
        player.up.reel = m[2]; topReel = m[2];
      } else {
        const [, steer, hold, x] = m;
        if (![-1, 0, 1].includes(steer) || ![0, 1].includes(hold) || !(x === null || (typeof x === 'number' && x > -1e4 && x < 1e4))) throw new Error('A move no hand could make');
        h.steer = steer; h.hold = !!hold; h.targetX = x;
      }
    }
    const wasOut = h.state !== 'idle';
    step(world, player, TICK);
    if (wasOut && h.state === 'idle') backAt = tick + 1;
    for (const ev of world.events.splice(0)) if (ev.type === 'landed') caught = { tick, what: ev.chest ? 'chest' : ev.id };
    player.storage = {};
  }
  if (i < moves.length) throw new Error('The moves go on after the record ends');
  return { world, throws, lastThrow, caught, topReel, reel: player.up.reel, idle: h.state === 'idle', back: Math.max(-REST_TICKS, backAt - ticks) };
}

// How long a catch takes at the very least, for a first look before anything is replayed.
export function leastSeconds(depth, reelLevel) {
  const way = depth - HOOK.rest;
  return way / Math.max(HOOK.sinkSpeed, HOOK.throwSpeed) + way / (HOOK.reelBase * UPGRADES.reel.values[Math.min(reelLevel, TOP_REEL)]);
}
