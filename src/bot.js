// A robot player: for the tests, for the computer's boats, and for the week played fast (src/week.js). It throws, picks a target below the hook, steers to it,
// and steers around whatever is in the way. "lag" is how slowly it reacts, like a person.
import { W, PIVOT, HOOK, FISH_BY_ID, ITEM_BY_ID } from './config.js';
import { newWorld, newPlayer, step, cast, release, entities } from './sim.js';

// wantId: go for one kind of fish only (for measuring what one of them costs to catch)
export function makeBot({ wantTier = 1, wantChest = false, wantId = null, lag = 0.18, dropJunk = true } = {}) {
  let think = 0, plan = null;
  const past = [];
  const wanted = (e) => (wantId ? e.def.id === wantId : e.kind === 'chest' ? wantChest : e.kind === 'fish' && e.def.tier >= wantTier && !wantChest);
  return function bot(world, player, dt) {
    const h = world.hook;
    if (h.state === 'idle') { plan = null; think = 0; h.targetX = null; return cast(world, player); }
    if (h.state !== 'out') {
      h.targetX = null;
      // pulling: the robot sees the icon "lag" seconds late and pushes the box toward where it saw it
      if (h.fight) {
        const g = h.fight;
        past.push([world.t, g.icon]);
        while (past.length > 2 && past[1][0] <= world.t - lag) past.shift();
        const seenIcon = past[0][1];
        h.hold = g.box + g.w / 2 + g.v * 0.22 < seenIcon;
      } else { past.length = 0; h.hold = false; }
      return false;
    }
    think -= dt;
    if (think > 0) { h.targetX = plan; return false; }
    think = lag;
    const sink = HOOK.sinkSpeed;
    const all = entities(world).filter((e) => !e.hooked && e.y + e.def.h > h.y);
    const eta = (e) => Math.max(0, (e.y + e.def.h / 2 - h.y) / sink);
    const xAt = (e, t) => e.x + e.def.w / 2 + e.speed * e.dir * t;
    // nearest wanted thing below that the hook can still get to
    const target = all.filter(wanted).filter((e) => {
      const t = eta(e), x = Math.max(6, Math.min(W - 6, xAt(e, t)));
      return Math.abs(x - h.x) <= HOOK.steerSpeed * t + e.def.w * 0.3 && xAt(e, t) > 4 && xAt(e, t) < W - 4;
    }).sort((a, b) => a.y - b.y)[0];
    let goal = target ? Math.max(6, Math.min(W - 6, xAt(target, eta(target)))) : h.x;
    // anything else about to cross the hook's path? go around the nearer side
    for (const o of all.sort((a, b) => a.y - b.y)) {
      if (o === target) continue;
      if (target && o.y > target.y + target.def.h / 2) break;
      const t1 = Math.max(0, (o.y - 2 - h.y) / sink), t2 = Math.max(0, (o.y + o.def.h + 2 - h.y) / sink);
      if (t1 > 1.1) break;
      const lo = Math.min(o.x + o.speed * o.dir * t1, o.x + o.speed * o.dir * t2) - 5;
      const hi = Math.max(o.x + o.speed * o.dir * t1, o.x + o.speed * o.dir * t2) + o.def.w + 5;
      const step1 = Math.sign(goal - h.x) * Math.min(Math.abs(goal - h.x), HOOK.steerSpeed * t1);
      const hx = h.x + step1;
      if (hx > lo && hx < hi) {
        const left = lo - 3, right = hi + 3;
        const okL = left > 5, okR = right < W - 5;
        goal = okL && (!okR || Math.abs(left - h.x) <= Math.abs(right - h.x)) ? left : okR ? right : goal;
        break;
      }
    }
    plan = goal; h.targetX = goal;
    return false;
  };
}

// Play for some minutes and count what came up.
export function play({ seed = 1, minutes = 10, reel = 0, check = null, ...botOpts }) {
  const DT = 1 / 60;
  const world = newWorld(seed), player = newPlayer();
  Object.assign(player.up, { reel, storage: 4 }); player.bait = 1e9;
  const bot = makeBot(botOpts);
  const out = { casts: 0, got: 0, junk: 0, miss: 0, value: 0, by: {}, hooked: {}, snapped: {}, minutes };
  for (let t = 0; t < minutes * 60; t += DT) {
    if (bot(world, player, DT)) out.casts++;
    step(world, player, DT);
    for (const ev of world.events.splice(0)) {
      if (ev.type === 'hooked' && ev.kind === 'junk' && botOpts.dropJunk !== false) release(world);
      if (ev.type === 'hooked' && ev.kind !== 'junk') out.hooked[ev.id] = (out.hooked[ev.id] || 0) + 1;
      if (ev.type === 'snapped') out.snapped[ev.id] = (out.snapped[ev.id] || 0) + 1;
      if (ev.type === 'landed') { out.got++; out.value += ITEM_BY_ID[ev.id].value; out.by[ev.id] = (out.by[ev.id] || 0) + 1; }
      if (ev.type === 'junk' || ev.type === 'released') out.junk++;
      if (ev.type === 'miss') out.miss++;
    }
    if (check) check(world, player);
    player.storage = {};
  }
  return out;
}

export function sum(runs) {
  const o = { casts: 0, got: 0, junk: 0, miss: 0, value: 0, by: {}, hooked: {}, snapped: {}, minutes: 0 };
  for (const r of runs) { for (const k of ['casts', 'got', 'junk', 'miss', 'value', 'minutes']) o[k] += r[k]; for (const g of ['by', 'hooked', 'snapped']) for (const [k, v] of Object.entries(r[g])) o[g][k] = (o[g][k] || 0) + v; }
  return o;
}
export const tierOf = (id) => (FISH_BY_ID[id] ? FISH_BY_ID[id].tier : 5);
