// The other boats' thinking (src/npc-rules.js), tried on made-up states of the game: no chain needed.
// node test/npc.test.mjs
import { FISHERS, decide, worth } from '../src/npc-rules.js';
import { mulberry32 } from '../src/rng.js';

const by = (n) => FISHERS.find((f) => f.name === n);
const darto = by('Old Tom'), sari = by('Maggie'), bayu = by('Finn'), hale = by('Captain Hale'), nora = by('Nora'), ruby = by('Ruby'), jack = by('Jack'), ME = 'npc.testnet';
const NEAR = 10n ** 24n;
function game({ items = {}, coins = 50, bait = 5, tickets = 0, entered = 0, held = null, orders = [], ticketOrders = [], needs = [['anchovy', 4], ['tuna', 3], ['pearl', 1]], inDraw = 0, owed = '0', reel = 4, storage = 4 } = {}) {
  const list = Object.entries(items).map(([id, n]) => [id, String(n)]);
  return {
    quest: { needs, tickets: 1, stock: 0, left: 0, ends_in_ms: 1_800_000 },
    draw: { pool: (NEAR * 77n / 100n).toString(), tickets: String(inDraw), cap: 500, per_player: 10 },
    orders, ticket_orders: ticketOrders, coin_price: '36000000000000000000',
    me: { coins: String(coins), bait: String(bait), tickets: String(tickets), entered_today: entered, items: list, held: held ?? list.reduce((a, [, n]) => a + +n, 0), storage_cap: 16, owed, reel, storage },
  };
}
const NOW = 1_800_000_000_000;
const memo = (m = {}) => ({ quests: 0, topUps: 0, chests: 0, near: 5, ticketNear: 0, bought: 0, now: NOW, listed: {}, ...m });
const VALUE = NEAR * 77n / 100n / 500n;      // what a ticket is worth in these games
const tOrder = (id, account, buying, amount, price) => ({ id: String(id), account, buying, amount, price: String(price) });
const order = (id, account, buying, token_id, amount, price) => ({ id: String(id), account, buying, token_id, amount, price: String(price) });
let failed = 0, n = 0;
// the step is none of these (the fisher went on with something else)
const none = (d, steps) => (steps.includes(d.step) ? d : { ...d, step: 'something else' });
function check(what, got, want) {
  n++;
  const ok = Object.entries(want).every(([k, v]) => got[k] === v) && typeof got.why === 'string' && got.why.length > 10;
  if (!ok) { failed++; console.log(`WRONG: ${what}\n   wanted ${JSON.stringify(want)}\n   got    ${JSON.stringify(got)}`); }
}

check('everything on board: hand in', decide(darto, ME, game({ items: { anchovy: 4, tuna: 3, pearl: 1 } }), memo()), { step: 'hand_in' });
check('a cheap fish for sale is bought', decide(sari, ME, game({ items: { tuna: 3, pearl: 1 }, orders: [order(7, 'p.testnet', false, 'anchovy', 3, 4)] }), memo()), { step: 'buy_item', order: '7', amount: 3 });
check('a dear fish for sale is not bought: the thrifty one fishes', decide(darto, ME, game({ items: { tuna: 3, pearl: 1 }, orders: [order(7, 'p.testnet', false, 'anchovy', 3, 9)] }), memo()), { step: 'fish', want: 'anchovy' });
check('its own listing is not bought', decide(sari, ME, game({ items: { tuna: 3, pearl: 1 }, coins: 0, bait: 5, orders: [order(7, ME, false, 'anchovy', 3, 2)] }), memo()), { step: 'fish', want: 'anchovy' });
check('nothing for sale: the busy one asks the market', decide(sari, ME, game({ items: { tuna: 3, pearl: 1 } }), memo()), { step: 'want_item', token_id: 'anchovy', amount: 4, price: Math.floor(worth('anchovy') * 1.2) });
check('and with the request up, goes fishing', decide(sari, ME, game({ items: { tuna: 3, pearl: 1 }, orders: [order(3, ME, true, 'anchovy', 4, 5)] }), memo()), { step: 'fish', want: 'anchovy' });
check('no bait: buys some', decide(darto, ME, game({ bait: 0, coins: 30 }), memo()), { step: 'buy_bait', amount: 9 });
check('no bait and few coins: buys what the coins allow', decide(darto, ME, game({ bait: 0, coins: 5 }), memo()), { step: 'buy_bait', amount: 2 });
check('no bait, no coins: tops up', decide(darto, ME, game({ bait: 0, coins: 1 }), memo()), { step: 'top_up', near: 0.02 });
check('the day\'s top-ups are used up: rests', decide(darto, ME, game({ bait: 0, coins: 1 }), memo({ topUps: 3 })), { step: 'rest' });
check('the wallet is low: rests', decide(darto, ME, game({ bait: 0, coins: 1 }), memo({ near: 0.4 })), { step: 'rest' });
check('NEAR waiting on the contract is collected first', decide(darto, ME, game({ owed: '5000000000000000000000' }), memo()), { step: 'claim' });
check('a good offer for a ticket is taken', decide(sari, ME, game({ tickets: 2, ticketOrders: [tOrder(4, 'p.testnet', true, 1, VALUE)] }), memo()), { step: 'fill_bid', order: '4', amount: 1 });
check('a poor offer for a ticket is not', decide(sari, ME, game({ tickets: 2, ticketOrders: [tOrder(4, 'p.testnet', true, 1, VALUE / 2n)] }), memo()), { step: 'sell_tickets', amount: 2 });
check('the ticket dealer buys one that is cheap enough', decide(ruby, ME, game({ ticketOrders: [tOrder(8, 'p.testnet', false, 5, VALUE * 75n / 100n)] }), memo()), { step: 'buy_tickets', order: '8', amount: 3 });
check('and leaves one that is dear', decide(ruby, ME, game({ ticketOrders: [tOrder(8, 'p.testnet', false, 5, VALUE)] }), memo()), { step: 'bid_tickets', amount: 2, price: (VALUE * 72n / 100n).toString() });
check('with an offer up already, she goes on with her day', none(decide(ruby, ME, game({ ticketOrders: [tOrder(9, ME, true, 2, VALUE * 72n / 100n)] }), memo()), ['buy_tickets', 'bid_tickets', 'cancel_bid']), { step: 'something else' });
check('an offer that no longer fits the prize comes down', decide(ruby, ME, game({ ticketOrders: [tOrder(9, ME, true, 2, VALUE * 2n)] }), memo()), { step: 'cancel_bid', order: '9' });
check('the day\'s ticket money is spent: no more buying', none(decide(ruby, ME, game({ ticketOrders: [tOrder(8, 'p.testnet', false, 5, VALUE * 75n / 100n)] }), memo({ ticketNear: 0.01 })), ['buy_tickets', 'bid_tickets']), { step: 'something else' });
check('the one who wants five in the draw buys over the worth', decide(jack, ME, game({ entered: 1, ticketOrders: [tOrder(8, 'p.testnet', false, 1, VALUE * 104n / 100n)] }), memo()), { step: 'buy_tickets', order: '8', amount: 1 });
check('with five in already he buys no more', none(decide(jack, ME, game({ entered: 5, ticketOrders: [tOrder(8, 'p.testnet', false, 1, VALUE)] }), memo()), ['buy_tickets', 'bid_tickets']), { step: 'something else' });
check('who never buys tickets does not', decide(darto, ME, game({ ticketOrders: [tOrder(8, 'p.testnet', false, 1, 10n ** 20n)] }), memo()), { step: 'fish' });
check('coins to spare: a better reel', decide(hale, ME, game({ coins: 70, reel: 0, storage: 2 }), memo()), { step: 'upgrade', what: 'reel' });
check('the reel is as good as he wants it: the hold next', decide(hale, ME, game({ coins: 70, reel: 3, storage: 0 }), memo()), { step: 'upgrade', what: 'storage' });
check('not enough coins left for bait after it: no upgrade', decide(hale, ME, game({ coins: 55, reel: 0, storage: 2 }), memo()), { step: 'fish' });
check('who does not care for gear keeps the coins', decide(darto, ME, game({ coins: 500, reel: 0, storage: 1 }), memo()), { step: 'fish' });
check('unsold too long: the price comes down a step', decide(nora, ME, game({ orders: [order(6, ME, false, 'shark', 2, 8)] }), memo({ listed: { 6: NOW - 9 * 60_000 } })), { step: 'reprice', order: '6', token_id: 'shark', amount: 2, price: 6 });
check('not long enough yet: the price stays', decide(nora, ME, game({ orders: [order(6, ME, false, 'shark', 2, 8)] }), memo({ listed: { 6: NOW - 5 * 60_000 } })), { step: 'fish' });
check('never under most of its worth', decide(nora, ME, game({ orders: [order(6, ME, false, 'shark', 2, 4)] }), memo({ listed: { 6: NOW - 60 * 60_000 } })), { step: 'fish' });
check('the gambler puts tickets into the draw', decide(bayu, ME, game({ tickets: 5 }), memo()), { step: 'enter_draw', amount: 3 });
check('never more than the draw lets one player', decide(bayu, ME, game({ tickets: 5, entered: 2 }), memo()), { step: 'enter_draw', amount: 1 });
check('a full draw: the tickets go to the market', decide(bayu, ME, game({ tickets: 2, inDraw: 500 }), memo()), { step: 'sell_tickets', amount: 2 });
check('the one who does not gamble sells her tickets above their worth', decide(sari, ME, game({ tickets: 1 }), memo()), { step: 'sell_tickets', amount: 1, price: (NEAR * 77n / 100n / 500n * 110n / 100n).toString() });
check('a request the quest no longer wants is taken down', decide(sari, ME, game({ orders: [order(3, ME, true, 'shark', 2, 6)] }), memo()), { step: 'cancel', order: '3' });
check('a spare fish goes to whoever asks for it', decide(darto, ME, game({ items: { shark: 2 }, orders: [order(9, 'p.testnet', true, 'shark', 1, 6)] }), memo()), { step: 'sell_item', order: '9', amount: 1 });
check('an offer far under its worth is left alone', decide(darto, ME, game({ items: { shark: 1 }, orders: [order(9, 'p.testnet', true, 'shark', 1, 2)] }), memo()).step !== 'sell_item' ? { step: 'ok', why: 'not sold for a pittance' } : { step: 'sold', why: 'sold for a pittance!' }, { step: 'ok' });
check('two spare of a kind are put up for sale', decide(darto, ME, game({ items: { shark: 2 } }), memo()), { step: 'list_item', token_id: 'shark', amount: 2, price: Math.ceil(worth('shark') * 1.4) });
check('what the quest needs is not sold', decide(darto, ME, game({ items: { anchovy: 4 } }), memo()), { step: 'fish', want: 'tuna' });
check('only what is over the quest\'s need is spare', decide(darto, ME, game({ items: { anchovy: 6 } }), memo()), { step: 'list_item', token_id: 'anchovy', amount: 2 });
check('a nearly full storage: something goes back', decide(darto, ME, game({ items: { shark: 1 }, held: 15, orders: [1, 2, 3, 4, 5].map((i) => order(i, ME, false, 'grouper', 1, 9)) }), memo()), { step: 'throw_back', token_id: 'shark' });
check('the quest\'s fish first, the chest last', decide(darto, ME, game({ items: { anchovy: 4, tuna: 3 } }), memo()), { step: 'fish', want: 'chest' });
check('after a chest without luck: asks the market for the find', decide(darto, ME, game({ items: { anchovy: 4, tuna: 3 } }), memo({ chests: 1 })), { step: 'want_item', token_id: 'pearl', amount: 1 });
check('after many chests: only the market is left', decide(darto, ME, game({ items: { anchovy: 4, tuna: 3 }, orders: [order(4, ME, true, 'pearl', 1, 11)] }), memo({ chests: 4 })), { step: 'rest' });
check('a hold full of unsold things: the cheapest listing comes down and goes back into the sea', decide(darto, ME, game({ held: 16, orders: [order(1, ME, false, 'shark', 4, 9), order(2, ME, false, 'anchovy', 5, 6)] }), memo()), { step: 'make_room', order: '2', token_id: 'anchovy', amount: 3 });
check('a full hold with nothing listed: waits', decide(darto, ME, game({ held: 16 }), memo()), { step: 'rest' });
check('done for today, nothing spare: rests', decide(darto, ME, game(), memo({ quests: 1 })), { step: 'rest' });
check('done for today: sells what is on board', decide(darto, ME, game({ items: { anchovy: 1 } }), memo({ quests: 1 })), { step: 'list_item', token_id: 'anchovy' });

// whatever the game looks like, a fisher names one step it could really take, and says why
const rnd = mulberry32(5), KINDS = ['anchovy', 'mackerel', 'clownfish', 'snapper', 'milkfish', 'grouper', 'barracuda', 'tuna', 'shark', 'pearl', 'goldbar', 'crown'];
const pick = (a) => a[Math.floor(rnd() * a.length)], upTo = (k) => Math.floor(rnd() * (k + 1));
let odd = 0; const seen = {};
for (let i = 0; i < 20000; i++) {
  const items = {}; for (let k = upTo(5); k > 0; k--) items[pick(KINDS)] = 1 + upTo(5);
  const orders = []; for (let k = upTo(6); k > 0; k--) orders.push(order(k, rnd() < 0.4 ? ME : 'p.testnet', rnd() < 0.5, pick(KINDS), 1 + upTo(4), 2 + upTo(20)));
  const S = game({ items, orders, coins: upTo(60), bait: upTo(6), tickets: upTo(4), entered: upTo(10), inDraw: rnd() < 0.1 ? 500 : upTo(200),
    needs: [[pick(KINDS.slice(0, 6)), 3 + upTo(2)], [pick(KINDS.slice(6, 9)), 3], [pick(KINDS.slice(9)), 1]], held: rnd() < 0.2 ? 14 + upTo(2) : null });
  S.me.owed = rnd() < 0.1 ? '3000000000000000000000' : '0'; S.me.reel = upTo(4); S.me.storage = upTo(4);
  for (let k = upTo(4); k > 0; k--) S.ticket_orders.push(tOrder(100 + k, rnd() < 0.4 ? ME : 'p.testnet', rnd() < 0.5, 1 + upTo(3), VALUE * BigInt(40 + upTo(120)) / 100n));
  const listed = Object.fromEntries(orders.filter((o) => o.account === ME && !o.buying).map((o) => [o.id, NOW - upTo(90) * 60_000]));
  const who = pick(FISHERS), m = memo({ quests: upTo(2), topUps: upTo(3), chests: upTo(5), near: rnd() * 3, ticketNear: rnd() < 0.3 ? 0.01 : 0, bought: upTo(3), listed }), p = S.me, coins = +p.coins;
  let d; try { d = decide(who, ME, S, m); } catch (e) { d = { step: 'crash', why: e.message }; }
  seen[d.step] = (seen[d.step] || 0) + 1;
  const o = d.order && S.orders.find((x) => x.id === d.order), t = d.order && S.ticket_orders.find((x) => x.id === d.order), has = (id) => Number(p.items.find(([k]) => k === id)?.[1] || 0);
  const costs = { reel: [40, 90, 200, 400], storage: [30, 70, 150, 300] };
  const fine = typeof d.why === 'string' && d.why.length > 10 && !/undefined|NaN/.test(d.why) && ({
    hand_in: () => S.quest.needs.every(([id, k]) => has(id) >= k),
    enter_draw: () => d.amount >= 1 && d.amount <= +p.tickets && p.entered_today + d.amount <= 10 && +S.draw.tickets + d.amount <= 500,
    sell_tickets: () => d.amount >= 1 && d.amount <= +p.tickets && BigInt(d.price) >= 10n ** 20n,
    cancel: () => o && o.account === ME,
    sell_item: () => o && o.buying && o.account !== ME && d.amount >= 1 && d.amount <= o.amount && has(o.token_id) >= d.amount,
    buy_item: () => o && !o.buying && o.account !== ME && d.amount >= 1 && d.amount <= o.amount && coins >= Number(o.price) * d.amount,
    list_item: () => has(d.token_id) >= d.amount && d.amount >= 1 && d.amount <= 10 && d.price >= 2 && S.orders.filter((x) => x.account === ME).length < 5,
    want_item: () => d.amount >= 1 && d.amount <= 10 && d.price >= 2 && coins >= d.price * d.amount && S.orders.filter((x) => x.account === ME).length < 5,
    throw_back: () => has(d.token_id) >= 1,
    buy_bait: () => d.amount >= 1 && coins >= d.amount * 2,
    top_up: () => m.topUps < 3 && m.near >= 0.5 + d.near,
    fish: () => +p.bait >= 1 && p.held < p.storage_cap && typeof d.want === 'string',
    claim: () => BigInt(p.owed) > 0n,
    fill_bid: () => t && t.buying && t.account !== ME && d.amount >= 1 && d.amount <= t.amount && d.amount <= +p.tickets,
    buy_tickets: () => t && !t.buying && t.account !== ME && d.amount >= 1 && d.amount <= t.amount && d.price === t.price && m.near - 0.5 >= Number(BigInt(t.price) * BigInt(d.amount) / 10n ** 18n) / 1e6 && who.bids > 0,
    bid_tickets: () => d.amount >= 1 && BigInt(d.price) >= 10n ** 20n && who.bids > 0 && !S.ticket_orders.some((x) => x.account === ME && x.buying),
    cancel_bid: () => t && t.buying && t.account === ME,
    reprice: () => o && !o.buying && o.account === ME && d.price < Number(o.price) && d.price >= 2 && d.amount === o.amount,
    make_room: () => o && !o.buying && o.account === ME && o.token_id === d.token_id && d.amount >= 1 && d.amount <= o.amount && p.held >= p.storage_cap,
    upgrade: () => p[d.what] < who[d.what] && coins >= costs[d.what][p[d.what]] + 20,
    rest: () => true,
  }[d.step] || (() => false))();
  if (!fine && ++odd <= 3) console.log('ODD:', JSON.stringify(d), JSON.stringify({ me: S.me, memo: m, orders: S.orders.length }));
}
console.log(`${n - failed} of ${n} situations decided as they should`);
console.log(`20000 made-up games: ${odd === 0 ? 'every step named could be taken, each with its reason' : odd + ' steps could not be taken'}  ${JSON.stringify(seen)}`);
if (failed || odd) process.exit(1);
