// Plays the game without a screen, to check the rules hold and to see the numbers.
// node test/sim.test.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { W, FLOOR, PIVOT, HOOK, PULL, FISH, JUNK, CHEST, RARE, UPGRADES, BAIT, START_COINS, MONEY, QUEST, DRAW, MARKET, WALLET, TICKETS, FISH_BY_ID, ITEM_BY_ID } from '../src/config.js';
import { play } from './bot.mjs';
import { newWorld, newPlayer, step, cast, release, entities, storageUsed, storageCap, buyBait, buyUpgrade, reelSpeed } from '../src/sim.js';
import { questsFor, othersTook, stockLeft, giveToQuest, giveAll, stillNeeds, doneCount, enterDraw, settleDraws, drawOf, winChance, topUp, fairPrice, neededToday,
  forSale, buyFromPlayers, playerBid, playersStillWant, sellToPlayers, payout, listForSale, takeBack, tickMarket, mintTickets, numberTickets } from './model/quests.js';
import { ticketWorth, listings, offers, floorPrice, bestOffer, buyListing, acceptOffer, listTickets, cancelListing, placeOffer, cancelOffer, offerEscrow, tickTickets, activity, afterFee } from './model/ticketmarket.js';

const DT = 1 / 60;

// --- art and rules agree on sizes
const art = JSON.parse(fs.readFileSync(new URL('../public/sprites/art.json', import.meta.url)));
const atlas = JSON.parse(fs.readFileSync(new URL('../public/sprites/atlas.json', import.meta.url)));
for (const f of FISH) {
  const a = art.fish.find((x) => x.id === f.id);
  assert.ok(a, `no art for ${f.id}`);
  assert.equal(`${a.w}x${a.h}`, `${f.w}x${f.h}`, `size of ${f.id}`);
  for (const i of [0, 1, 2]) assert.ok(atlas.frames[`fish_${f.id}_${i}`], `frame fish_${f.id}_${i}`);
}
for (const j of JUNK) {
  const fr = atlas.frames[j.sprite];
  assert.ok(fr, `no art for ${j.id}`);
  assert.equal(`${fr.frame.w}x${fr.frame.h}`, `${j.w}x${j.h}`, `size of ${j.id}`);
}
assert.deepEqual(art.anchors.boat.rodTip, { x: 2, y: 4 });
assert.equal(`${atlas.frames.chest.frame.w}x${atlas.frames.chest.frame.h}`, `${CHEST.w}x${CHEST.h}`, 'size of chest');
for (const r of RARE) assert.ok(atlas.frames[r.sprite], `no art for ${r.id}`);

// --- a robot plays; the hook must always stay inside the sea and come back
for (const [wantTier, wantChest] of [[1, false], [3, false], [0, true]]) {
  const o = play({ seed: 3, minutes: 6, reel: 2, wantTier, wantChest, check: (world) => {
    const h = world.hook;
    assert.ok(Number.isFinite(h.x) && Number.isFinite(h.y), 'hook position is a number');
    assert.ok(h.x >= 3.9 && h.x <= W - 3.9 && h.y <= FLOOR + 1 && h.y >= PIVOT.y, 'hook stays in the sea');
  } });
  assert.ok(o.casts > 10 && o.got > 0, 'the robot catches something');
  console.log(`robot wants ${wantChest ? 'chest' : 'tier ' + wantTier + '+'}: ${o.casts} casts, ${o.got} landed, ${o.junk} junk, ${o.miss} nothing`, JSON.stringify(o.by));
}

// --- a step of zero or negative time must not break anything (the browser's first frame can do that)
{
  const world = newWorld(2), p = newPlayer();
  for (const dt of [0, -0.004, 0, 1 / 60]) step(world, p, dt);
  for (const e of entities(world)) assert.ok(Number.isFinite(e.anim) && Number.isFinite(e.x), 'entities stay sane');
}

// --- steering: holding left moves the hook left, holding right moves it right
for (const dir of [-1, 1]) {
  const world = newWorld(4), p = newPlayer();
  world.slots.forEach((s) => { s.ent = null; s.timer = 1e9; });     // empty sea
  world.hook.phase = 0; step(world, p, DT);
  cast(world, p); world.hook.steer = dir;
  const x0 = world.hook.x;
  for (let i = 0; i < 60; i++) step(world, p, DT);
  assert.ok(dir * (world.hook.x - x0) > 40, `steering ${dir > 0 ? 'right' : 'left'} moves the hook`);
  assert.equal(world.hook.state, 'out');
}
// a finger position pulls the hook to that x
{
  const world = newWorld(4), p = newPlayer();
  world.slots.forEach((s) => { s.ent = null; s.timer = 1e9; });
  cast(world, p); world.hook.targetX = 30;
  for (let i = 0; i < 120; i++) step(world, p, DT);
  assert.ok(Math.abs(world.hook.x - 30) < 2, 'the hook follows the finger');
  // with an empty sea it reaches the floor from the very first throw, and comes back
  let floor = false;
  for (let i = 0; i < 60 * 30 && world.hook.state !== 'idle'; i++) { step(world, p, DT); for (const ev of world.events.splice(0)) if (ev.type === 'miss' && ev.why === 'floor') floor = true; }
  assert.ok(floor, 'the hook reaches the sea floor'); assert.equal(world.hook.state, 'idle');
}
// --- the pull: hook one fish of a kind in an otherwise empty sea, then pull by a rule
function hookOne(id, seed = 6) {
  const world = newWorld(seed), p = newPlayer();
  const slot = world.slots.find((s) => s.def.id === id);
  world.slots.forEach((s) => { if (s !== slot) { s.ent = null; s.timer = 1e9; } });
  if (!slot.ent) { slot.timer = 0; while (!slot.ent) step(world, p, DT); }
  slot.ent.speed = 0; slot.ent.x = PIVOT.x - slot.def.w / 2;      // park it right under the rod
  world.hook.phase = 0; world.hook.targetX = PIVOT.x;
  cast(world, p);
  for (let i = 0; i < 60 * 20 && world.hook.state === 'out'; i++) step(world, p, DT);
  world.events.length = 0;
  assert.equal(world.hook.catch, slot, `hooked the ${id}`);
  return { world, p };
}
function pull({ world, p }, rule, seconds = 120) {
  for (let i = 0; i < 60 * seconds && world.hook.state === 'in'; i++) {
    world.hook.hold = rule(world.hook.fight);
    step(world, p, DT);
    for (const ev of world.events.splice(0)) if (ev.type === 'snapped' || ev.type === 'landed') return ev.type;
  }
  return world.hook.state === 'idle' ? 'landed' : 'still pulling';
}
// a player who keeps the box on the icon: push right when the box is left of it
const follow = (g) => g.box + g.w / 2 + g.v * 0.2 < g.icon;
for (const id of ['anchovy', 'grouper', 'tuna']) assert.equal(pull(hookOne(id), follow), 'landed', `keeping the icon in the box lands the ${id}`);
// never touching, or never letting go, loses a big fish: the box sits at one end and the icon is elsewhere
assert.equal(pull(hookOne('shark'), () => false), 'snapped', 'not playing loses the shark');
assert.equal(pull(hookOne('shark'), () => true), 'snapped', 'holding all the time loses the shark');
// the box obeys: holding moves it right, letting go moves it left, and it stays on the track
{
  const s = hookOne('snapper'), g = s.world.hook.fight, start = g.box;
  for (let i = 0; i < 20; i++) { s.world.hook.hold = true; step(s.world, s.p, DT); }
  assert.ok(g.box > start, 'holding pushes the box right');
  const mid = g.box;
  for (let i = 0; i < 60; i++) { s.world.hook.hold = false; step(s.world, s.p, DT); }
  assert.ok(s.world.hook.fight === null || s.world.hook.fight.box < mid, 'letting go lets it fall left');
  if (s.world.hook.fight) assert.ok(g.box >= 0 && g.box <= 1 - g.w && g.icon >= 0 && g.icon <= 1, 'box and icon stay on the track');
}
// a better reel gives a wider box for the same fish
{
  const plain = hookOne('tuna').world.hook.fight.w;
  const s = (() => { const world = newWorld(6), p = newPlayer(); p.up.reel = 4; const slot = world.slots.find((x) => x.def.id === 'tuna'); world.slots.forEach((x) => { if (x !== slot) { x.ent = null; x.timer = 1e9; } });
    if (!slot.ent) { slot.timer = 0; while (!slot.ent) step(world, p, DT); } slot.ent.speed = 0; slot.ent.x = PIVOT.x - slot.def.w / 2; world.hook.phase = 0; world.hook.targetX = PIVOT.x; cast(world, p);
    for (let i = 0; i < 60 * 20 && world.hook.state === 'out'; i++) step(world, p, DT); return world.hook.fight; })();
  assert.ok(Math.abs(s.w - (plain + 4 * PULL.reelBox)) < 1e-9, `the best reel widens the box (${plain} to ${s.w})`); assert.ok(s.w <= PULL.maxBox);
}
// while the icon is outside the box nothing comes up
{
  const s = hookOne('tuna'), len = s.world.hook.len;
  for (let i = 0; i < 90 && s.world.hook.fight; i++) { s.world.hook.hold = true; step(s.world, s.p, DT); }
  if (s.world.hook.fight && !s.world.hook.fight.inside) assert.ok(s.world.hook.len >= len - 40, 'no free progress outside the box');
}
// a catch that got away is free again and the bait is gone
{
  const s = hookOne('tuna'), bait = s.p.bait;
  assert.equal(pull(s, () => true), 'snapped');
  const slot = s.world.slots.find((x) => x.def.id === 'tuna');
  assert.ok(slot.ent && !slot.ent.hooked && s.world.hook.catch === null, 'the tuna swims free');
  assert.equal(s.p.bait, bait, 'no bait comes back'); assert.equal(storageUsed(s.p), 0);
}
// junk needs no skill: it comes up even untouched
assert.equal(pull(hookOne('can'), () => false), 'landed', 'junk comes up on its own');

// the chest gives a rare thing
{
  const world = newWorld(8), p = newPlayer(); p.up.reel = 4;
  const chest = world.slots.find((s) => s.kind === 'chest');
  assert.ok(chest.ent, 'there is a chest on the floor');
  world.slots.forEach((s) => { if (s !== chest) { s.ent = null; s.timer = 1e9; } });
  cast(world, p); world.hook.targetX = chest.ent.x + CHEST.w / 2;
  let got = null;
  for (let i = 0; i < 60 * 90 && !got; i++) { if (world.hook.fight) world.hook.hold = follow(world.hook.fight); step(world, p, DT); for (const ev of world.events.splice(0)) if (ev.type === 'landed') got = ev; }
  assert.ok(got && got.chest && RARE.some((r) => r.id === got.id), 'opening the chest gives a rare thing');
  assert.equal(p.storage[got.id], 1);
  assert.ok(playerBid(got.id, 77) >= 1 && playerBid(got.id, 77) <= fairPrice(got.id, 77), 'other players bid below the fair price');
}

// --- how long the big ones take to bring up
console.log('seconds to reel in from the middle of its zone (reel level 0 / 4):');
for (const f of FISH) {
  const depth = (f.zone[0] + f.zone[1]) / 2 - PIVOT.y - HOOK.rest;
  const p0 = newPlayer(), p4 = newPlayer(); p4.up.reel = 4;
  console.log(' ', f.id.padEnd(10), (depth / reelSpeed(p0, f.weight)).toFixed(1).padStart(5), '/', (depth / reelSpeed(p4, f.weight)).toFixed(1).padStart(5));
}

// --- storage, shop, orders
{
  const world = newWorld(5), p = newPlayer();
  assert.equal(p.bait, BAIT.start);
  p.bait = 0; assert.equal(cast(world, p), false, 'no bait, no cast');
  assert.equal(buyBait(p, 5), true); assert.equal(p.coins, START_COINS - 5 * BAIT.price); assert.equal(p.bait, 5);
  assert.equal(buyBait(p, 100), false, 'cannot overspend');
  p.coins = 5; assert.equal(buyUpgrade(p, 'storage'), false, 'cannot afford storage yet');
  p.coins = 1000; assert.equal(buyUpgrade(p, 'storage'), true); assert.equal(storageCap(p), UPGRADES.storage.values[1]);
  assert.equal(buyUpgrade(p, 'line'), false, 'there is no line upgrade any more');
  p.coins = 1e6; for (let i = 0; i < 10; i++) buyUpgrade(p, 'reel'); assert.equal(p.up.reel, 4, 'upgrades stop at the top');

  // --- the quest: one a day, the same for everyone, three kinds of things, and all it pays is a ticket
  const day = 1234, quests = questsFor(day);
  assert.equal(quests.length, 1, 'one quest a day'); assert.deepEqual(questsFor(day), quests, 'same day, same quest');
  const q0 = quests[0];
  assert.equal(q0.needs.length, 3, 'three kinds of things'); assert.equal(new Set(q0.needs.map((x) => x.id)).size, 3);
  for (const need of q0.needs) assert.ok(need.n >= 1 && ITEM_BY_ID[need.id], 'the quest asks for real things');
  assert.ok(FISH_BY_ID[q0.needs[0].id].tier <= 2 && FISH_BY_ID[q0.needs[1].id].tier === 3 && ITEM_BY_ID[q0.needs[2].id].rare, 'an upper fish, a deep fish, a chest item');
  { // over many days: different amounts, all three chest items turn up, a crown day pays double, and a ticket costs about the same throws
    const seen = {};
    for (let d = 0; d < 300; d++) {
      const x = questsFor(d)[0], n = x.needs.map((y) => y.n);
      assert.ok(new Set(n).size >= 2, 'different amounts');
      seen[x.needs[2].id] = (seen[x.needs[2].id] || 0) + 1;
      assert.equal(x.tickets, x.needs[2].id === 'crown' ? QUEST.crownTickets : 1);
      const throws = x.needs.reduce((a, y) => a + y.n * QUEST.effort[y.id], 0) / x.tickets;
      assert.ok(Math.abs(throws - QUEST.budget) / QUEST.budget < 0.12, `a ticket costs about the same on any day (${throws.toFixed(1)} throws)`);
    }
    for (const r of RARE) assert.ok(seen[r.id] > 60, `${r.id} is asked for on about a third of the days (${seen[r.id]})`);
  }
  assert.equal(othersTook(q0, 0), 0); assert.equal(othersTook(q0, 1), q0.stock);
  const [a, b, c] = q0.needs;
  const q = newPlayer(); const coins = q.coins;
  q.storage[a.id] = a.n + 3; q.storage[b.id] = b.n - 1; q.storage[c.id] = c.n;
  let r = giveToQuest(q, day, 0, 0, a.id);
  assert.equal(r.gave, a.n, 'the quest takes only what it needs'); assert.equal(q.storage[a.id], 3); assert.equal(r.tickets, 0);
  r = giveAll(q, day, 0); assert.equal(r.tickets, 0, 'not complete yet: no ticket'); assert.equal(stillNeeds(q, day, 0, b.id), 1); assert.equal(stillNeeds(q, day, 0, c.id), 0);
  q.storage[b.id] = 1; r = giveToQuest(q, day, 0, 0, b.id);
  assert.equal(r.tickets, q0.tickets, 'the finished quest pays its ticket'); assert.equal(q.tickets, q0.tickets); assert.equal(doneCount(q, day, 0), 1);
  assert.equal(q.coins, coins, 'the quest never pays coins');
  assert.equal(stillNeeds(q, day, 0, a.id), a.n, 'it can be done again');
  const late = newPlayer(); late.storage[a.id] = 50;
  assert.deepEqual(giveToQuest(late, day, 0.999, 0, a.id), { gave: 0, tickets: 0 }, 'too late: the tickets are gone');
  assert.equal(late.storage[a.id], 50, 'and nothing is taken');
  assert.equal(stockLeft(q0, 0, q0.stock / q0.tickets), 0, 'the stock counts what this player already took');

  // --- the market between players
  assert.ok(neededToday(day, a.id)); assert.ok(fairPrice(a.id, day) > ITEM_BY_ID[a.id].value, 'what the quest asks for is worth more that day');
  // selling to players who want it: only so many a day, and a fee comes off
  const before = late.coins, want = playersStillWant(late, day, a.id);
  assert.equal(sellToPlayers(late, day, a.id, 50), want, 'other players buy only so many a day');
  assert.equal(late.coins, before + payout(a.id, day, want)); assert.ok(payout(a.id, day, want) < want * playerBid(a.id, day), 'the fee comes off');
  assert.equal(sellToPlayers(late, day, a.id, 50), 0);
  // buying from players: costs coins, limited, needs room
  const buyer = newPlayer(); buyer.coins = 1000;
  const offer = forSale(buyer, day)[0];
  assert.ok(offer && offer.price >= fairPrice(offer.id, day), 'other players ask at least the fair price');
  assert.equal(buyFromPlayers(buyer, day, offer.id, 99, 0), 0, 'no room, no purchase');
  const fresh = newPlayer(); fresh.coins = 1000;
  const got1 = buyFromPlayers(fresh, day, offer.id, 99, 99);
  assert.equal(got1, offer.left, 'cannot buy more than is offered'); assert.equal(fresh.coins, 1000 - got1 * offer.price);
  assert.equal(buyFromPlayers(fresh, day, offer.id, 1, 99), 0, 'sold out');
  const poor = newPlayer(); poor.coins = 0; assert.equal(buyFromPlayers(poor, day, offer.id, 1, 99), 0, 'no coins, no purchase');
  // putting things up at your own price: they leave storage, sell over time if the price is fair, never if it is silly
  const s1 = newPlayer(); s1.storage.tuna = 6; const t0 = day * 300000 + 1000, fair = fairPrice('tuna', day);
  assert.equal(listForSale(s1, 'tuna', 4, fair, t0), true); assert.equal(s1.storage.tuna, 2); assert.equal(s1.listings.length, 1);
  const c1 = s1.coins; const soldNow = tickMarket(s1, t0 + 10 * 60 * 1000);
  assert.ok(soldNow.length === 1 && soldNow[0].n === 4, 'a fair price sells out in ten minutes'); assert.ok(s1.coins > c1 && s1.coins < c1 + 4 * fair, 'paid, minus the fee');
  assert.equal(s1.listings.length, 0);
  assert.equal(listForSale(s1, 'tuna', 2, fair * 3, t0), true);
  assert.deepEqual(tickMarket(s1, t0 + 60 * 60 * 1000), [], 'a silly price never sells'); assert.equal(s1.listings[0].n, 2);
  assert.equal(takeBack(s1, 0, 0), false, 'no room to take it back'); assert.equal(takeBack(s1, 0, 5), true); assert.equal(s1.storage.tuna, 2);
  for (let i = 0; i < MARKET.maxListings; i++) { s1.storage.anchovy = 1; assert.equal(listForSale(s1, 'anchovy', 1, 5, t0), true); }
  s1.storage.anchovy = 1; assert.equal(listForSale(s1, 'anchovy', 1, 5, t0), false, 'only so many offers at once');
  // tickets do not trade for coins: they are not on the coin market at all
  assert.ok(!forSale(buyer, day).some((o) => o.id === 'ticket')); assert.equal(listForSale(newPlayer(), 'ticket', 1, 50, t0), false);

  // --- the Harbour: NEAR. A top-up moves NEAR from the wallet into coins, and fails if the wallet is short
  const t = newPlayer(); const c0 = t.coins;
  assert.equal(t.wallet, WALLET.demoNear);
  assert.equal(topUp(t, 2), 2 * MONEY.coinsPerNear); assert.equal(t.coins, c0 + 2 * MONEY.coinsPerNear); assert.equal(t.wallet, WALLET.demoNear - 2); assert.equal(t.toppedUp, 3);
  assert.equal(topUp(t, 999), 0, 'cannot top up more than the wallet holds'); assert.equal(t.wallet, WALLET.demoNear - 2);
  // --- the ticket market, for NEAR, like a market for NFTs
  const now = day * 300000 + 90000;                 // a moment early in that day
  {
    // every ticket has its own number, and the count always matches the list
    const m = newPlayer(); mintTickets(m, 3, day);
    assert.equal(m.tickets, 3); assert.equal(new Set(m.ticketList.map((x) => x.id)).size, 3, 'each ticket has its own number');
    const old = newPlayer(); old.tickets = 4; old.ticketList = []; numberTickets(old); assert.equal(old.ticketList.length, 4, 'an older save gets numbers for its tickets');
    // what others list and offer: listings cheapest first, offers highest first, and selling into an offer never beats buying the floor
    const ls = listings(m, now), os = offers(m, now), worth = ticketWorth(day);
    assert.ok(ls.length >= 5 && os.length >= 2 && worth > 0);
    assert.deepEqual(ls.map((l) => l.price), [...ls.map((l) => l.price)].sort((x, y) => x - y)); assert.equal(floorPrice(m, now), ls[0].price);
    assert.deepEqual(os.map((o) => o.price), [...os.map((o) => o.price)].sort((x, y) => y - x)); assert.equal(bestOffer(m, now), os[0].price);
    for (let d = 0; d < 200; d++) { const t0 = d * 300000 + 60000, f = floorPrice(m, t0), o = bestOffer(m, t0); if (f != null && o != null) assert.ok(afterFee(o) < f, 'no free money between the best offer and the floor'); }
    // buying a listed ticket: costs its price in NEAR, the very ticket arrives, and it is gone from the list
    const w = m.wallet, first = ls[0];
    assert.equal(buyListing(m, now, first.key).id, first.id); assert.ok(Math.abs(m.wallet - (w - first.price)) < 0.002);
    assert.ok(m.ticketList.some((x) => x.id === first.id)); assert.equal(m.tickets, 4);
    assert.ok(!listings(m, now).some((l) => l.key === first.key)); assert.equal(buyListing(m, now, first.key), null, 'a ticket sells once');
    const poor = newPlayer(); poor.wallet = 0; assert.equal(buyListing(poor, now, ls[1].key), null, 'no NEAR, no ticket');
    assert.equal(m.coins, START_COINS, 'ticket trades never touch coins');
    // selling into an offer: pays the offer minus the vault fee, only as many as the offer takes
    const o0 = os[0], w1 = m.wallet, n0 = acceptOffer(m, now, o0.key, 99);
    assert.equal(n0, Math.min(o0.left, 4)); assert.ok(Math.abs(m.wallet - (w1 + n0 * afterFee(o0.price))) < 0.003); assert.ok(afterFee(o0.price) < o0.price, 'the fee comes off');
    assert.equal(m.tickets, 4 - n0);
    // listing at your own price: the ticket leaves the hand, sells in time at a fair price, never at a silly one, and can be taken back
    const s1 = newPlayer(); mintTickets(s1, 3, day);
    const mine = s1.ticketList[0].id;
    assert.equal(listTickets(s1, now, 1, worth, [mine]), 1); assert.equal(s1.tickets, 2); assert.equal(s1.ticketListings[0].id, mine);
    const w2 = s1.wallet, ev = tickTickets(s1, now + 20 * 60 * 1000);
    assert.ok(ev.length === 1 && ev[0].type === 'sold' && ev[0].id === mine, 'a fairly priced ticket sells'); assert.ok(Math.abs(s1.wallet - (w2 + afterFee(worth))) < 0.01);
    assert.equal(listTickets(s1, now, 1, worth * 5), 1);
    assert.deepEqual(tickTickets(s1, now + 60 * 60 * 1000), [], 'a silly price never sells');
    const stuck = s1.ticketListings[0].id; assert.equal(cancelListing(s1, stuck), true); assert.ok(s1.ticketList.some((x) => x.id === stuck)); assert.equal(s1.tickets, 2);
    // an offer of your own: the NEAR is set aside, a fair offer gets filled in time, a cancelled one gives the rest back
    const b1 = newPlayer(), w3 = b1.wallet;
    assert.equal(placeOffer(b1, now, 999, 1), false, 'cannot offer more NEAR than the wallet holds');
    assert.equal(placeOffer(b1, now, worth, 2), true); assert.ok(Math.abs(b1.wallet - (w3 - 2 * Math.round(worth * 100) / 100)) < 0.003); assert.ok(offerEscrow(b1) > 0);
    const got2 = tickTickets(b1, now + 30 * 60 * 1000).filter((x) => x.type === 'filled').length;
    assert.equal(got2, 2, 'a fair offer gets its tickets'); assert.equal(b1.tickets, 2); assert.equal(b1.ticketOffers.length, 0);
    const b2 = newPlayer(), w4 = b2.wallet; assert.equal(placeOffer(b2, now, 0.01, 3), true);
    assert.deepEqual(tickTickets(b2, now + 60 * 60 * 1000), [], 'an offer far too low is never filled');
    assert.ok(Math.abs(cancelOffer(b2, 0) - 0.03) < 0.001); assert.ok(Math.abs(b2.wallet - w4) < 0.001, 'a cancelled offer gives the NEAR back');
    // the activity list has the player's own trades and others', newest first
    const act = activity(m, now); assert.ok(act.length >= 2); assert.ok(act.some((x) => x.type === 'bought' && x.id === first.id));
    for (let i = 1; i < act.length; i++) assert.ok(act[i - 1].at >= act[i].at);
  }

  // --- the draw: tickets go in, a finished day is settled once, the prize is an equal share
  mintTickets(t, 5, day); const walletBefore = t.wallet; assert.equal(enterDraw(t, day, 3), 3); assert.equal(t.tickets, 2); assert.equal(enterDraw(t, day, 99), 2);
  assert.deepEqual(settleDraws(t, day), [], 'today is not settled yet');
  const res = settleDraws(t, day + 1);
  assert.equal(res.length, 1); assert.equal(res[0].tickets, 5); assert.ok(res[0].won >= 0 && res[0].won <= 5);
  assert.ok(Math.abs(t.near - res[0].won * drawOf(day).prize / DRAW.winners) < 0.01); assert.deepEqual(settleDraws(t, day + 1), [], 'settled only once');
  assert.ok(Math.abs(t.wallet - (walletBefore + t.near)) < 0.002, 'a prize lands in the wallet'); assert.equal(t.results.length, 1, 'and the draw is remembered');
  { // over many days a ticket wins about as often as the odds say
    const m = newPlayer(); let won = 0, expect = 0;
    for (let d = 0; d < 400; d++) { mintTickets(m, 4, d); enterDraw(m, d, 4); expect += 4 * winChance(drawOf(d).others + 4); }
    for (const x of settleDraws(m, 1000)) won += x.won;
    assert.ok(Math.abs(won - expect) / expect < 0.12, `tickets win as often as the odds say (${won} vs ${expect.toFixed(0)})`);
  }

  // storage cap: landing more than fits is refused
  const w2 = newWorld(9), full = newPlayer(); full.bait = 1e6;
  full.storage.anchovy = storageCap(full);
  let refused = 0;
  for (let t = 0; t < 600 && !refused; t += DT) {
    if (w2.hook.state === 'idle') cast(w2, full);
    if (w2.hook.fight) w2.hook.hold = follow(w2.hook.fight);
    step(w2, full, DT);
    for (const ev of w2.events.splice(0)) if (ev.type === 'full') refused++;
  }
  assert.ok(refused > 0, 'a full storage refuses fish'); assert.equal(storageUsed(full), storageCap(full));
}

// --- a few boards, to see what a day asks for and pays
console.log('\nthree example boards:');
for (const d of [100, 101, 102]) console.log(' ', questsFor(d)[0].needs.map((n) => `${n.n} ${n.id}`).join(' + '));
console.log('\nall checks passed');
