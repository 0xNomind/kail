// A week of the game, played fast: the computer's boats, with the very rules they play by on the chain
// (src/npc-rules.js), fishing in the real sea (src/sim.js, with the robot of src/bot.js at the reel), against a
// model of the contract (src/model.js) instead of the contract itself. What takes a week of transactions on
// NEAR takes a few seconds here, so the economy can be watched moving: the vault, the day's prize, what a coin
// costs, tickets made and drawn, what fish go for, who gets richer.
//
// Nothing here is random by the clock: the same seed plays the same week, to the last coin. After every day the
// model's books are added up (`audit`); a week whose books do not close is a bug, and is said to be one.
//
// Used by scripts/simulate.mjs (`npm run simulate`) and by the page week.html.
import { newChain, NEAR } from './model.js';
import { FISHERS, decide } from './npc-rules.js';
import { newWorld, newPlayer, step, release, entities } from './sim.js';
import { makeBot } from './bot.js';
import { mulberry32 } from './rng.js';

const yocto = (near) => BigInt(Math.round(near * 1e6)) * 10n ** 18n;
const inNear = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6;
const slug = (name) => name.toLowerCase().replace(/[^a-z]+/g, '-');
const DT = 1 / 60;

// `vault`: NEAR the game's makers put into the prize vault before the first day. `wallet`: NEAR each boat starts with.
// `newcomers`: [{ day, count }] more fishers who arrive on that day of the week (the same ten characters again).
export function makeWeek({ seed = 1, dayMs = 3_600_000, vault = 4, wallet = 10, fishers = FISHERS, newcomers = [] } = {}) {
  const chain = newChain({ dayMs, seed }), rnd = mulberry32((seed * 2654435761) >>> 0);
  const firstDay = chain.day, start = chain.now;
  // the makers filled the vault the day before the week begins, as on the chain, where it has been there a while
  chain.fund('makers', yocto(vault));
  chain.now = start - dayMs;
  if (vault > 0) chain.call('makers', 'add_prize', yocto(vault));
  chain.now = start;
  // all the prize money in the game: the vault, and the prizes of days not drawn yet that were set aside from it
  const bank = () => chain.raw.vault + [...chain.raw.draws.values()].filter((d) => !d.settled).reduce((a, d) => a + d.pool, 0n);
  const boats = [];
  function arrive(who, at) {
    const n = boats.filter((b) => b.who === who).length, id = `${slug(who.name)}${n ? `-${n + 1}` : ''}.boat`;
    chain.fund(id, yocto(wallet));
    chain.call(id, 'welcome');
    boats.push({ id, name: n ? `${who.name} ${n + 1}` : who.name, who, at, started: yocto(wallet), world: newWorld(((seed * 7919) ^ (boats.length * 104729)) >>> 0), sea: newPlayer(),
      memo: { day: null, quests: 0, topUps: 0, chests: 0, ticketNear: 0, bought: 0, near: 0, now: 0, listed: {} }, quests: 0, casts: 0, caught: 0, doing: '', why: '' });
  }
  fishers.forEach((who, i) => arrive(who, start + 2000 + i * 4000));
  let today = null;      // what is counted for the day being played
  const fresh = () => ({ steps: {}, quests: 0, entered: 0, casts: 0, caught: 0, fishSold: 0, fishCoins: 0, ticketsSold: 0, ticketNear: 0n, toppedUp: 0n, refused: 0, said: [] });

  // ---- one throw of the hook: the real sea, the robot at the reel; the cast and the catch go to the model
  function throwOnce(b, want) {
    const chest = want === 'chest', bot = makeBot({ wantId: chest ? null : want, wantChest: chest, lag: b.who.lag }), w = b.world, h = w.hook, p = b.sea, t0 = chain.now;
    p.up.reel = chain.player(b.id).reel; p.up.storage = 4; p.bait = 1e9;
    let t = 0, thrown = false, caught = null, waited = 0, drop = false;
    const at = () => { chain.now = t0 + Math.round(t * 1000); };
    while (t < 240) {
      if (drop) { drop = false; release(w); }
      const idle = h.state === 'idle';
      if (!idle) bot(w, p, DT);
      else if (!thrown) {
        // a sensible fisher does not throw while the thing wanted is not in the water; and does not wait for ever
        waited += DT;
        if (entities(w).some((e) => (chest ? e.kind === 'chest' : e.def.id === want))) bot(w, p, DT);
        else if (waited > 25) { at(); return { said: `no ${want} in the water for a while` }; }
      }
      if (idle && h.state === 'out') {
        at();
        try { chain.call(b.id, 'cast'); } catch (e) { h.state = 'idle'; return { said: `the cast was refused: ${e.message}` }; }
        thrown = true; b.casts += 1; today.casts += 1;
      }
      step(w, p, DT); t += DT;
      for (const ev of w.events.splice(0)) {
        if (ev.type === 'hooked' && ev.kind === 'junk') drop = true;
        if (ev.type === 'landed') caught = ev.chest ? 'chest' : ev.id;
      }
      p.storage = {};
      if (thrown && h.state === 'idle') break;
    }
    at();
    if (!thrown) return { said: 'did not get to throw' };
    if (!caught) { chain.raw.profiles.get(b.id).open = false; return { said: 'the hook came back empty' }; }
    const landed = chain.call(b.id, 'land', caught);
    if (landed) { b.caught += 1; today.caught += 1; }
    return { what: caught, landed, said: landed ? `brought up ${caught === 'chest' ? `a chest: ${landed}` : `a ${landed}`}` : `brought up a ${caught}, but the storage was full` };
  }

  // ---- one turn of one boat: ask the rules for the next step, carry it out (the same steps as server/npc.mjs)
  function turn(b) {
    const S = chain.state(b.id), m = b.memo, me = b.id;
    if (S.quest.day !== m.day) Object.assign(m, { day: S.quest.day, quests: 0, topUps: 0, chests: 0, ticketNear: 0, bought: 0 });
    m.near = inNear(chain.wallet(me)); m.now = chain.now;
    const up = new Set(S.orders.filter((o) => o.account === me).map((o) => o.id));
    for (const id of Object.keys(m.listed)) if (!up.has(id)) delete m.listed[id];
    for (const o of S.orders) if (o.account === me && !o.buying && !m.listed[o.id]) m.listed[o.id] = m.now;
    const d = decide(b.who, me, S, m), call = (method, ...args) => chain.call(me, method, ...args);
    let result = '';
    try {
      if (d.step === 'hand_in') { call('hand_in'); m.quests += 1; m.chests = 0; b.quests += 1; today.quests += 1; result = 'a ticket'; }
      else if (d.step === 'claim') call('claim');
      else if (d.step === 'enter_draw') { call('enter_draw', d.amount); today.entered += d.amount; }
      else if (d.step === 'sell_tickets') call('sell_tickets', d.amount, BigInt(d.price));
      else if (d.step === 'fill_bid') { const o = S.ticket_orders.find((x) => x.id === d.order); call('fill_bid', d.order, d.amount); today.ticketsSold += d.amount; today.ticketNear += BigInt(o.price) * BigInt(d.amount); }
      else if (d.step === 'buy_tickets') { const cost = BigInt(d.price) * BigInt(d.amount); call('buy_tickets', d.order, d.amount); m.ticketNear += inNear(cost); m.bought += d.amount; today.ticketsSold += d.amount; today.ticketNear += cost; }
      else if (d.step === 'bid_tickets') { const cost = BigInt(d.price) * BigInt(d.amount); call('bid_tickets', d.amount, BigInt(d.price)); m.ticketNear += inNear(cost); m.bought += d.amount; }
      else if (d.step === 'cancel_bid') call('cancel_order', d.order);
      else if (d.step === 'cancel') call('cancel_item_order', d.order);
      else if (d.step === 'reprice') { call('cancel_item_order', d.order); m.listed[call('list_item', d.token_id, d.amount, d.price)] = chain.now; }
      else if (d.step === 'make_room') { call('cancel_item_order', d.order); call('throw_back', d.token_id, d.amount); }
      else if (d.step === 'sell_item' || d.step === 'buy_item') { const o = S.orders.find((x) => x.id === d.order); call(d.step, d.order, d.amount); today.fishSold += d.amount; today.fishCoins += Number(o.price) * d.amount; }
      else if (d.step === 'list_item') m.listed[call('list_item', d.token_id, d.amount, d.price)] = chain.now;
      else if (d.step === 'want_item') call('want_item', d.token_id, d.amount, d.price);
      else if (d.step === 'throw_back') call('throw_back', d.token_id, d.amount);
      else if (d.step === 'buy_bait') call('buy_bait', d.amount);
      else if (d.step === 'upgrade') call('upgrade', d.what);
      else if (d.step === 'top_up') { const before = chain.wallet(me); result = `${call('top_up', yocto(d.near))} coins`; m.topUps += 1; today.toppedUp += before - chain.wallet(me); }
      else if (d.step === 'fish') { const r = throwOnce(b, d.want); result = r.said; if (r.what === 'chest') m.chests += 1; }
    } catch (e) { result = `could not: ${e.message}`; today.refused += 1; }
    today.steps[d.step] = (today.steps[d.step] || 0) + 1;
    b.doing = d.step; b.why = d.why;
    // a few of the day's decisions are kept to be read: the ones that are about money or the market
    if (!['fish', 'rest', 'buy_bait'].includes(d.step) && today.said.length < 60) today.said.push({ at: chain.now, who: b.name, step: d.step, why: d.why, result });
    return d.step === 'rest' ? 90_000 : 25_000 + rnd() * 20_000;
  }

  // ---- one day: every boat takes its turns until the day is over, then the server holds the draw
  function playDay() {
    const day = chain.day, n = day - firstDay + 1, end = (day + 1) * dayMs;
    for (const x of newcomers.filter((x) => x.day === n)) for (let i = 0; i < x.count; i++) arrive(fishers[i % fishers.length], chain.now + 5000 + i * 3000);
    today = fresh();
    chain.now = Math.max(chain.now, day * dayMs);
    const bankAtStart = bank();
    for (;;) {
      const b = boats.reduce((a, x) => (x.at < a.at ? x : a));
      if (b.at >= end) break;
      chain.now = Math.max(chain.now, b.at);
      const pause = turn(b);
      b.at = chain.now + pause;
    }
    chain.now = Math.max(chain.now, end - 1);
    const t = today, before = chain.draw(day), entered = Number(before.tickets), q = chain.state().quest, coin = chain.coinPrice();
    chain.now = end + 60_000;      // the server looks every minute for a day to hold
    const winners = chain.call('server', 'settle_draw', day), held = chain.draw(day), books = chain.audit();
    return {
      day: n, quest: q.needs.map(([id, k]) => `${k} ${id}`).join(', '),
      prize: inNear(winners ? BigInt(held.prize_each) * 100n : before.pool), coinPrice: inNear(coin),
      bankStart: inNear(bankAtStart), bankEnd: inNear(bank()),
      toppedUp: inNear(t.toppedUp), ticketsMade: t.quests, ticketsEntered: entered, winners, prizeEach: inNear(held.prize_each), paidOut: inNear(held.pool),
      ticketsSold: t.ticketsSold, ticketPrice: t.ticketsSold ? inNear(t.ticketNear / BigInt(t.ticketsSold)) : null,
      fishSold: t.fishSold, fishPrice: t.fishSold ? Math.round((t.fishCoins / t.fishSold) * 10) / 10 : null,
      casts: t.casts, caught: t.caught, boats: boats.length, steps: t.steps, refused: t.refused, said: t.said, books,
    };
  }
  /// Where every boat stands: NEAR (wallet and what it is owed, against what it came with), coins, tickets, catches.
  function standing() {
    return boats.map((b) => {
      const p = chain.player(b.id), near = inNear(chain.wallet(b.id) + BigInt(p.owed));
      return { name: b.name, about: b.who.about, near, change: Math.round((near - inNear(b.started)) * 1e6) / 1e6, coins: Number(p.coins), bait: Number(p.bait), tickets: Number(p.tickets),
        things: p.items.reduce((a, [, k]) => a + Number(k), 0), reel: p.reel, storage: p.storage, quests: b.quests, casts: b.casts, caught: b.caught, doing: b.doing, why: b.why };
    });
  }
  return { chain, playDay, standing, market: () => chain.state() };
}

/// The whole week at once: every day's numbers, where everybody stands at the end, and whether the books closed.
export function playWeek({ days = 7, ...options } = {}) {
  const week = makeWeek(options), out = [];
  for (let i = 0; i < days; i++) out.push(week.playDay());
  const problems = out.flatMap((d) => d.books.map((b) => `day ${d.day}: ${b}`));
  return { seed: options.seed ?? 1, days: out, boats: week.standing(), problems };
}
