// The sea and the hook. No drawing here, so it can run without a screen (see test/).
import { W, FLOOR, PIVOT, HOOK, PULL, UPGRADES, FISH, JUNK, CHEST, RARE, BAIT, START_COINS, WALLET } from './config.js';
import { mulberry32, between } from './rng.js';
// the sea's own sine, cosine and powers: the same digits in every browser and on a server (see dmath.js)
import { sin, cos, exp, atan2, asin, hypot, pow } from './dmath.js';

const RAD = Math.PI / 180;

export function newPlayer() {
  return {
    id: Math.random().toString(36).slice(2, 10),
    coins: START_COINS, bait: BAIT.start, storage: {}, up: { reel: 0, storage: 0 },
    name: '',
    wallet: WALLET.demoNear,                 // NEAR in the wallet (pretend NEAR until this is on chain)
    tickets: 0, near: 0, toppedUp: 1,        // tickets held, NEAR won in draws, NEAR topped up so far (the demo's first one)
    results: [],                             // the last few draws the player was in
    ticketList: [], minted: 0,               // the tickets held, each with its own number: { id, day }
    ticketListings: [], ticketOffers: [], ticketLog: [],   // on the ticket market: tickets up for sale, offers posted, own trades
    quest: {}, done: {}, entries: {}, sold: {},   // per day: quest progress, quests finished, tickets in the draw, things bought and sold
    listings: [],                                 // what the player has put up for sale: { id, n, price, at, checked }
    stats: { casts: 0, landed: 0 },
  };
}
export const storageUsed = (p) => Object.values(p.storage).reduce((a, b) => a + b, 0);
export const storageCap = (p) => UPGRADES.storage.values[p.up.storage];

export function newWorld(seed = 1) {
  const rnd = mulberry32(seed);
  const world = {
    t: 0, rnd, slots: [], events: [],
    // steer: -1, 0 or 1 from keys. targetX: where a finger or the mouse wants the hook, or null.
    // pull: seconds since the hook turned back. grab: where the catch was when the hook touched it (for drawing).
    // hold: is the player pressing right now. fight: the pulling game (box and icon positions 0..1, grip 0..1).
    hook: { state: 'idle', phase: 0, ang: 0, len: HOOK.rest, x: PIVOT.x, y: PIVOT.y + HOOK.rest, vx: 0, steer: 0, targetX: null, catch: null, pull: 0, grab: null, hold: false, fight: null },
  };
  for (const def of FISH) for (let i = 0; i < def.count; i++) world.slots.push({ def, kind: 'fish', ent: null, timer: 0 });
  for (const def of JUNK) for (let i = 0; i < def.count; i++) world.slots.push({ def, kind: 'junk', ent: null, timer: 0 });
  world.slots.push({ def: CHEST, kind: 'chest', ent: null, timer: 0 });
  for (const s of world.slots) if (!s.def.chance || rnd() < s.def.chance) s.ent = spawn(world, s, true);
  placeHook(world.hook);
  return world;
}

function spawn(world, slot, anywhere) {
  const { def } = slot, rnd = world.rnd;
  const dir = rnd() < 0.5 ? -1 : 1;
  const still = slot.kind === 'chest';
  return {
    def, kind: slot.kind, dir: still ? -1 : dir,
    x: still ? 8 + rnd() * (W - def.w - 16) : anywhere ? rnd() * (W - def.w) : dir > 0 ? -def.w - 2 : W + 2,
    y: still ? FLOOR - def.h + 1 : between(rnd, [def.zone[0], def.zone[1] - def.h]),
    speed: between(rnd, def.speed), bob: rnd() * 6.28, hooked: false, anim: rnd() * 4,
  };
}

function placeHook(h) {
  h.x = PIVOT.x + sin(h.ang) * h.len;
  h.y = PIVOT.y + cos(h.ang) * h.len;
}

export const entities = (world) => world.slots.filter((s) => s.ent).map((s) => s.ent);

// What the hook would touch at its current spot, if anything.
function touching(world) {
  const h = world.hook;
  for (const s of world.slots) {
    const e = s.ent;
    if (!e || e.hooked) continue;
    if (h.x >= e.x + 2 && h.x <= e.x + e.def.w - 2 && h.y >= e.y + 2 && h.y <= e.y + e.def.h - 2) return s;
  }
  return null;
}

export function cast(world, player) {
  const h = world.hook;
  if (h.state !== 'idle' || player.bait <= 0) return false;
  player.bait -= 1;
  player.stats.casts += 1;
  h.state = 'out';
  h.vx = sin(h.ang) * HOOK.throwSpeed;   // the swing throws the hook a little to that side
  world.events.push({ type: 'cast' });
  return true;
}

// Let go of whatever is on the hook, to save time.
export function release(world) {
  const h = world.hook;
  if (h.state !== 'in' || !h.catch) return false;
  const slot = h.catch;
  slot.ent.hooked = false;
  if (slot.kind === 'chest') slot.ent.y = FLOOR - slot.def.h + 1;   // a dropped chest sinks back
  h.catch = null; h.fight = null;
  world.events.push({ type: 'released', id: slot.def.id });
  return true;
}

export function reelSpeed(player, weight) {
  return Math.max(HOOK.minReel, (HOOK.reelBase * UPGRADES.reel.values[player.up.reel]) / pow(weight, 0.8));
}

// Turn the hook around: from here it is pulled straight back to the rod.
function pullBack(h) {
  h.state = 'in';
  h.pull = 0;
  h.ang = atan2(h.x - PIVOT.x, h.y - PIVOT.y);
  h.len = hypot(h.x - PIVOT.x, h.y - PIVOT.y);
}

export function step(world, player, dt) {
  world.t += dt;
  const rnd = world.rnd, h = world.hook;

  // fish and junk drift left and right; when one swims off, a new one comes later
  for (const s of world.slots) {
    const e = s.ent;
    if (!e) {
      s.timer -= dt;
      if (s.timer <= 0) {
        if (!s.def.chance || rnd() < s.def.chance) s.ent = spawn(world, s, false);
        else s.timer = between(rnd, s.def.respawn);
      }
      continue;
    }
    e.anim += dt * (e.hooked ? 14 : 4 + e.speed * 0.12);
    if (e.hooked) continue;
    e.x += e.speed * e.dir * dt;
    e.bob += dt * 1.6;
    if (e.x > W + 4 || e.x + e.def.w < -4) { s.ent = null; s.timer = between(rnd, s.def.respawn) * 0.5; }
  }

  if (h.state === 'idle') {
    h.phase += dt;
    h.ang = HOOK.swingDeg * RAD * sin((h.phase * 2 * Math.PI) / HOOK.swingPeriod);
    h.len = HOOK.rest;
    placeHook(h);
  } else if (h.state === 'out') {
    // The hook sinks at a steady speed. The player moves it left and right to pick a target and dodge the rest.
    let left = dt;
    while (left > 0 && h.state === 'out') {
      const d = Math.min(1 / 120, left);
      left -= d;
      let want = null;
      if (h.targetX != null) want = Math.max(-HOOK.steerSpeed, Math.min(HOOK.steerSpeed, (h.targetX - h.x) * 8));
      else if (h.steer) want = h.steer * HOOK.steerSpeed;
      if (want == null) h.vx *= exp(-d * HOOK.drift);
      else h.vx += (want - h.vx) * Math.min(1, d * 10);
      h.x = Math.max(4, Math.min(W - 4, h.x + h.vx * d));
      h.y += HOOK.sinkSpeed * d;
      const hit = touching(world);
      if (hit) {
        hit.ent.hooked = true;
        h.catch = hit;
        h.grab = { x: hit.ent.x, y: hit.ent.y, dir: hit.ent.dir };
        pullBack(h);
        const kind = PULL.kinds[hit.kind === 'fish' ? hit.def.tier : hit.kind];
        // a better reel gives a wider box: w is the width of the box for this catch
        const w = Math.min(PULL.maxBox, kind.box + player.up.reel * PULL.reelBox);
        h.fight = { kind, w, box: 0.5 - w / 2, v: 0, icon: 0.5, target: 0.5, timer: between(rnd, kind.rest) * 0.6, grip: PULL.gripStart, inside: true, deepest: h.len };
        world.events.push({ type: 'hooked', id: hit.def.id, kind: hit.kind });
      } else if (h.y > FLOOR - 3) {
        world.events.push({ type: 'miss', why: 'floor' });
        pullBack(h);
      }
    }
  } else if (h.state === 'in') {
    // the pull starts with a short tug and then picks up speed, so the turn is not a hard snap
    h.pull += dt;
    const ramp = Math.min(1, 0.15 + h.pull * 2.8);
    if (!h.catch) h.len -= HOOK.backSpeed * ramp * dt;
    else {
      const c = h.catch, g = h.fight, kd = g.kind;
      // the icon darts to a new spot every now and then
      g.timer -= dt;
      if (g.timer <= 0) { g.target = Math.max(0.06, Math.min(0.94, g.icon + (rnd() * 2 - 1) * kd.jump)); g.timer = between(rnd, kd.rest); }
      const d = g.target - g.icon;
      g.icon += Math.sign(d) * Math.min(Math.abs(d), kd.dart * dt);
      // the box: pushed right while holding, falling left when let go
      g.v = Math.max(-PULL.maxSpeed, Math.min(PULL.maxSpeed, g.v + (h.hold ? PULL.push : -PULL.fall) * dt));
      g.box += g.v * dt;
      if (g.box < 0) { g.box = 0; g.v = -g.v * PULL.bounce; }
      if (g.box > 1 - g.w) { g.box = 1 - g.w; g.v = -g.v * PULL.bounce; }
      g.inside = g.icon >= g.box && g.icon <= g.box + g.w;
      if (g.inside) { g.grip = Math.min(1, g.grip + PULL.gripGain * dt); h.len -= reelSpeed(player, c.def.weight) * ramp * dt; }
      else { g.grip -= kd.loss * dt; h.len = Math.min(g.deepest, h.len + PULL.slip * dt); }
      if (g.grip <= 0) {
        // it got away: the catch is free again, the hook comes back empty
        c.ent.hooked = false;
        if (c.kind === 'chest') c.ent.y = FLOOR - c.def.h + 1;
        h.catch = null; h.fight = null; h.pull = 0;
        world.events.push({ type: 'snapped', id: c.def.id, kind: c.kind });
      }
    }
    if (h.len <= HOOK.rest) {
      h.len = HOOK.rest;
      if (h.catch) land(world, player, h.catch);
      h.catch = null; h.fight = null;
      h.state = 'idle';
      h.vx = 0;
      // keep swinging from where the hook came back
      const a = Math.max(-1, Math.min(1, h.ang / (HOOK.swingDeg * RAD)));
      h.phase = (asin(a) * HOOK.swingPeriod) / (2 * Math.PI);
    }
    placeHook(h);
    if (h.catch) { const e = h.catch.ent; e.x = h.x - e.def.w / 2; e.y = h.y + 2; }
  }
}

function land(world, player, slot) {
  const { def, kind } = slot;
  slot.ent = null;
  slot.timer = between(world.rnd, def.respawn);
  if (kind === 'junk') { world.events.push({ type: 'junk', id: def.id }); return; }
  let id = def.id;
  if (kind === 'chest') {
    // open it: one rare thing, by its odds
    let roll = world.rnd() * RARE.reduce((a, r) => a + r.odds, 0);
    id = RARE.find((r) => (roll -= r.odds) < 0).id;
  }
  if (storageUsed(player) >= storageCap(player)) { world.events.push({ type: 'full', id, chest: kind === 'chest' }); return; }
  player.storage[id] = (player.storage[id] || 0) + 1;
  player.stats.landed += 1;
  world.events.push({ type: 'landed', id, chest: kind === 'chest' });
}

// Shop
export function buyBait(player, n) {
  const cost = n * BAIT.price;
  if (player.coins < cost) return false;
  player.coins -= cost; player.bait += n;
  return true;
}
export function upgradeCost(player, key) {
  return UPGRADES[key]?.costs[player.up[key]] ?? null;
}
export function buyUpgrade(player, key) {
  const cost = upgradeCost(player, key);
  if (cost == null || player.coins < cost) return false;
  player.coins -= cost; player.up[key] += 1;
  return true;
}
