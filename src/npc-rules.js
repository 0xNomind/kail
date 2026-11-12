// The other boats: fishers the computer plays.
//
// Each one is a NEAR account like a player's, and can do only what a player can: top up with its own NEAR, buy
// bait, throw the hook (its catches are checked by the server like anybody's, by playing its moves again), hand in
// the quest, trade on the two markets, put tickets into the draw. They are there so that a market has somebody in
// it and a draw has somebody to win against. They get no favours: no free coins, no fish out of thin air.
//
// This file is all of their thinking. `decide` looks at the game as the contract shows it and names ONE next step,
// with the reason in plain words; the runner (server/npc.mjs) carries it out and asks again. Players can read the reason
// in the game. Change a number here and the fishers behave differently; nothing else has to change.
import { QUEST, UPGRADES } from './config.js';

// ---- who they are
// pays:     how much of "what it would cost me to fish it" this fisher offers when buying (1 = the full cost)
// asks:     the same measure for what it wants when selling something it does not need
// patience: minutes a thing may sit unsold before its price comes down
// quests:   how many quests a day it tries to finish
// enters:   how many of its tickets it puts into one day's draw; the rest it offers on the ticket market
// bids:     what it pays for a ticket on the ticket market, as a share of what a ticket is worth (0 = never buys)
// buys:     how many tickets a day it is ready to buy there
// reel, storage: how far it upgrades them (0 = stays as it started)
// lag:      how slowly it reacts with the hook, in seconds (a person is about 0.18)
export const FISHERS = [
  { name: 'Old Tom', about: 'Patient and thrifty. Would rather fish than pay, and keeps his tickets for the draw.', pays: 0.8, asks: 1.4, patience: 40, quests: 1, enters: 2, bids: 0, buys: 0, reel: 0, storage: 1, lag: 0.2 },
  { name: 'Maggie', about: 'Always short of time. Buys what she is missing and sells her tickets.', pays: 1.2, asks: 1.1, patience: 15, quests: 2, enters: 0, bids: 0, buys: 0, reel: 1, storage: 1, lag: 0.16 },
  { name: 'Finn', about: 'Lives for the draw. Fishes fast, pays fair, and every ticket goes in.', pays: 1.0, asks: 1.2, patience: 25, quests: 2, enters: 3, bids: 0.95, buys: 1, reel: 2, storage: 0, lag: 0.12 },
  { name: 'Captain Hale', about: 'The old hand. Best gear in the harbour, three quests before lunch.', pays: 0.9, asks: 1.3, patience: 30, quests: 3, enters: 3, bids: 0, buys: 0, reel: 3, storage: 2, lag: 0.1 },
  { name: 'Nora', about: 'Hunts bargains. Pays little, and marks her own fish down quickly to get them gone.', pays: 0.7, asks: 1.2, patience: 8, quests: 1, enters: 1, bids: 0, buys: 0, reel: 0, storage: 2, lag: 0.18 },
  { name: 'Ruby', about: 'Deals in tickets. Buys them a little under their worth and sells them a little over.', pays: 1.0, asks: 1.2, patience: 20, quests: 1, enters: 0, bids: 0.8, buys: 3, reel: 0, storage: 0, lag: 0.2 },
  { name: 'Silas', about: 'New to the sea. Slow on the reel and pays too much, but he is learning.', pays: 1.3, asks: 1.0, patience: 20, quests: 1, enters: 1, bids: 0, buys: 0, reel: 1, storage: 0, lag: 0.3 },
  { name: 'Wren', about: 'Saves every coin for a bigger hold, and sells whatever the quest does not want.', pays: 0.9, asks: 1.3, patience: 30, quests: 2, enters: 1, bids: 0, buys: 0, reel: 0, storage: 3, lag: 0.17 },
  { name: 'Dolly', about: 'Fishes for the fun of it. One quest a day, and the ticket goes to whoever pays.', pays: 1.1, asks: 1.0, patience: 12, quests: 1, enters: 0, bids: 0, buys: 0, reel: 1, storage: 1, lag: 0.22 },
  { name: 'Jack', about: 'Cannot leave the draw alone. Buys tickets over their worth to have more chances.', pays: 1.1, asks: 1.1, patience: 15, quests: 2, enters: 5, bids: 1.05, buys: 3, reel: 1, storage: 0, lag: 0.14 },
];

// ---- what things are worth to a fisher
export const BAIT_PRICE = 2;                 // coins for one bait
export const FEE = 0.05;                     // the market's fee, paid by whoever takes an order
const MOST_BAIT = 10;                        // never more bait than this in the box
const TOP_UP_NEAR = 0.02;                    // one top-up
export const TOP_UPS_A_DAY = 3;              // and no more than this many a day
const KEEP_NEAR = 0.5;                       // NEAR left alone in the wallet, for gas
const MOST_CHESTS = 4;                       // chests tried for one quest before only the market is left
const SELL_TICKET_AT = 1.1;                  // tickets are offered at this much of what a ticket is worth
const ROOM_LEFT = 2;                         // free boxes kept in storage
const GOOD_BID = 0.95;                       // a ticket is sold into somebody's offer when it pays this much of its worth
const TICKET_NEAR_A_DAY = 0.01;              // NEAR a ticket buyer spends on tickets in a day, at most
const CUT = 0.85, LOWEST = 0.6;              // an unsold thing comes down to 85% of its price, never under 60% of its worth
const COINS_KEPT = 20;                       // coins kept for bait when an upgrade is bought

// Bait a fisher expects to spend to bring up one of a kind: the throws measured with the game's robots, times
// the price of bait. This is what a fish is "worth" to somebody who could also go and catch it.
export const worth = (id) => Math.max(BAIT_PRICE, Math.round(QUEST.effort[id] * BAIT_PRICE));
const withFee = (price, n = 1) => price * n + Math.max(1, Math.ceil(price * n * FEE));
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const NAMES = { anchovy: 'anchovy', mackerel: 'mackerel', clownfish: 'clownfish', snapper: 'snapper', milkfish: 'milkfish', grouper: 'grouper', barracuda: 'barracuda', tuna: 'tuna', shark: 'shark', sailfish: 'sailfish', pearl: 'pearl', goldbar: 'gold bar', crown: 'old crown' };
const name = (id) => NAMES[id] || id;
const CHEST_FINDS = ['pearl', 'goldbar', 'crown'];

// ---- the next step
// who:  one of FISHERS            me: its account id
// S:    the contract's `state` for that account ({ quest, draw, orders, ticket_orders, me, coin_price, ... })
// memo: what the runner remembers for this fisher: today's { quests, topUps, chests, ticketNear (NEAR spent on
//       tickets) }, its wallet `near`, the time `now`, and `listed`: when each of its sales went up ({ id: ms })
// Gives { step, why, ...what the step needs }.
export function decide(who, me, S, memo) {
  const p = S.me, quest = S.quest, draw = S.draw;
  const have = Object.fromEntries(p.items.map(([id, n]) => [id, Number(n)]));
  const coins = Number(p.coins), bait = Number(p.bait), tickets = Number(p.tickets);
  const mine = S.orders.filter((o) => o.account === me), others = S.orders.filter((o) => o.account !== me);
  const needs = quest.needs.map(([id, n]) => ({ id, n, missing: Math.max(0, n - (have[id] || 0)) }));
  const needed = (id) => needs.find((x) => x.id === id)?.n || 0;
  const working = memo.quests < who.quests;      // still after a quest today?
  // a ticket is worth a fifth of what a winning ticket gets (one chance in five at a hundredth of the prize)
  const value = BigInt(draw.pool) / 500n, share = (x) => max(BigInt(Math.round(x * 100)) * value / 100n, 10n ** 20n);
  const sales = S.ticket_orders.filter((o) => !o.buying), offers = S.ticket_orders.filter((o) => o.buying);

  // 1. everything the quest asks for is on board
  if (working && needs.every((x) => x.missing === 0)) return { step: 'hand_in', why: `Has everything today's quest asks for: handing it in for a ticket.` };

  // 2. NEAR waiting on the contract: prizes won, tickets sold, an offer taken down
  if (BigInt(p.owed) > 0n) return { step: 'claim', why: `Collects ${near(p.owed)} NEAR that is waiting: prizes and ticket sales.` };

  // 3. tickets: into the draw, to somebody who offers well for them, or onto the ticket market
  if (tickets > 0) {
    const room = Math.min(who.enters - p.entered_today, draw.per_player - p.entered_today, draw.cap - Number(draw.tickets), tickets);
    if (room > 0) return { step: 'enter_draw', amount: room, why: `Puts ${room} of ${tickets} tickets into today's draw (never more than ${who.enters} a day): one in five wins ${near(BigInt(draw.pool) / 100n)} NEAR.` };
    const reason = who.enters ? `Has ${p.entered_today} in today's draw already` : 'Does not gamble';
    const bid = offers.filter((o) => o.account !== me && BigInt(o.price) >= share(GOOD_BID)).sort((a, b) => (BigInt(b.price) > BigInt(a.price) ? 1 : -1))[0];
    if (bid) {
      const k = Math.min(tickets, bid.amount);
      return { step: 'fill_bid', order: bid.id, amount: k, why: `${reason}. Somebody offers ${near(bid.price)} NEAR for a ticket, and a ticket is worth about ${near(value)}: sells ${k} into that offer.` };
    }
    if (sales.filter((o) => o.account === me).length < 3) {
      const price = share(SELL_TICKET_AT);
      return { step: 'sell_tickets', amount: tickets, price: price.toString(), why: `${reason}: offers ${tickets} ticket${tickets > 1 ? 's' : ''} at ${near(price)} NEAR each. A ticket is worth about ${near(value)} NEAR (one chance in five at ${near(BigInt(draw.pool) / 100n)}).` };
    }
  }

  // 4. buying tickets, for those who do: for more chances in the draw, or to sell on
  if (who.bids > 0) {
    const limit = share(who.bids), own = offers.filter((o) => o.account === me);
    // an offer of its own that no longer fits today's prize comes down (the NEAR goes back, to be collected)
    const off = own.find((o) => BigInt(o.price) > limit * 125n / 100n || BigInt(o.price) < limit * 60n / 100n);
    if (off) return { step: 'cancel_bid', order: off.id, why: `Takes down the offer of ${near(off.price)} NEAR a ticket: today a ticket is worth ${near(value)}.` };
    const left = who.buys - (memo.bought || 0), purse = TICKET_NEAR_A_DAY - (memo.ticketNear || 0);
    const what = who.enters ? `wants ${who.enters} tickets in the draw` : 'buys tickets to sell them on';
    if (left > 0 && (!who.enters || p.entered_today + tickets < who.enters)) {
      const sale = sales.filter((o) => o.account !== me && BigInt(o.price) <= limit).sort((a, b) => (BigInt(a.price) > BigInt(b.price) ? 1 : -1))[0];
      const afford = (price) => Math.min(left, Math.floor(purse * 1e6) > 0 ? Number(BigInt(Math.floor(purse * 1e6)) * 10n ** 18n / BigInt(price)) : 0, Math.floor(Math.max(0, memo.near - KEEP_NEAR) * 1e6) > 0 ? Number(BigInt(Math.floor((memo.near - KEEP_NEAR) * 1e6)) * 10n ** 18n / BigInt(price)) : 0);
      if (sale && afford(sale.price) >= 1) {
        const k = Math.min(afford(sale.price), sale.amount);
        return { step: 'buy_tickets', order: sale.id, amount: k, price: sale.price, why: `${who.name} ${what}. One is for sale at ${near(sale.price)} NEAR; a ticket is worth about ${near(value)}, and ${who.name} pays up to ${near(limit)}.` };
      }
      if (!own.length) {
        const price = share(who.bids * 0.9), k = Math.min(afford(price), 2);
        if (k >= 1) return { step: 'bid_tickets', amount: k, price: price.toString(), why: `${who.name} ${what}. None is for sale at up to ${near(limit)} NEAR, so offers ${near(price)} each for ${k}; a ticket is worth about ${near(value)}.` };
      }
    }
  }

  // 5. orders that make no sense any more: asking for something the quest no longer wants
  const stale = mine.find((o) => o.buying && (!working || needs.every((x) => x.id !== o.token_id || x.missing === 0)));
  if (stale) return { step: 'cancel', order: stale.id, why: `Takes down the request for ${name(stale.token_id)}: not needed any more.` };

  // 6. something has been for sale too long: the price comes down a step, but never under most of its worth
  for (const o of mine.filter((x) => !x.buying)) {
    const since = memo.listed?.[o.id], floor = Math.max(2, Math.ceil(worth(o.token_id) * LOWEST)), lower = Math.max(floor, Math.floor(Number(o.price) * CUT));
    if (since && memo.now - since > who.patience * 60_000 && lower < Number(o.price)) {
      return { step: 'reprice', order: o.id, token_id: o.token_id, amount: o.amount, price: lower, why: `${o.amount} ${name(o.token_id)} unsold for ${Math.round((memo.now - since) / 60_000)} minutes at ${o.price} coins: down to ${lower}. Never under ${floor}, which is most of what the bait for one costs.` };
    }
  }

  // 7. things on board the quest does not need: sell them rather than carry them
  const spare = Object.entries(have).map(([id, n]) => ({ id, n: n - (working ? needed(id) : 0) })).filter((x) => x.n > 0);
  for (const s of spare) {
    const offer = others.filter((o) => o.buying && o.token_id === s.id).sort((a, b) => Number(b.price) - Number(a.price))[0];
    if (offer && Number(offer.price) >= worth(s.id) * 0.6) {
      const n = Math.min(s.n, offer.amount);
      return { step: 'sell_item', order: offer.id, amount: n, why: `Somebody wants ${name(s.id)} for ${offer.price} coins each; ${n} spare on board, so sells into that offer.` };
    }
  }
  const tight = p.held >= p.storage_cap - ROOM_LEFT;
  if (spare.length && mine.length < 5 && (tight || spare.some((s) => s.n >= 2) || !working)) {
    const s = spare.sort((a, b) => b.n - a.n)[0];
    if (!mine.some((o) => !o.buying && o.token_id === s.id)) {
      const price = Math.max(2, Math.ceil(worth(s.id) * who.asks)), n = Math.min(s.n, 10);
      return { step: 'list_item', token_id: s.id, amount: n, price, why: `${n} ${name(s.id)} the quest does not ask for. Fishing one costs about ${worth(s.id)} coins of bait; asks ${price} each.` };
    }
  }
  if (tight && spare.length) {
    const s = spare.sort((a, b) => worth(a.id) - worth(b.id))[0];
    return { step: 'throw_back', token_id: s.id, amount: 1, why: `Storage is nearly full and nobody wants ${name(s.id)}: one goes back into the sea.` };
  }

  // 8. coins to spare: better gear, as far as this fisher cares to go
  for (const [what, to] of [['reel', who.reel], ['storage', who.storage]]) {
    const level = p[what], cost = UPGRADES[what].costs[level];
    if (level < to && cost != null && coins >= cost + COINS_KEPT) {
      return { step: 'upgrade', what, why: what === 'reel'
        ? `Has ${coins} coins. A better reel costs ${cost}: it pulls ${UPGRADES.reel.values[level + 1]} times as fast, so fewer catches get away.`
        : `Has ${coins} coins. A bigger hold costs ${cost}: room for ${UPGRADES.storage.values[level + 1]} instead of ${UPGRADES.storage.values[level]}.` };
    }
  }

  // 9. done for today
  if (!working) return { step: 'rest', why: `Did ${memo.quests} quest${memo.quests === 1 ? '' : 's'} today, as planned. Back when the next one comes, in ${mmss(quest.ends_in_ms)}.` };

  // 10. what is still missing for the quest: buy it when that is cheaper than fishing, otherwise fish
  const missing = needs.filter((x) => x.missing > 0).sort((a, b) => worth(a.id) - worth(b.id));
  for (const m of missing) {
    const limit = worth(m.id) * who.pays;
    const sale = others.filter((o) => !o.buying && o.token_id === m.id).sort((a, b) => Number(a.price) - Number(b.price))[0];
    if (sale && withFee(Number(sale.price)) <= limit * 1.05 && coins >= withFee(Number(sale.price))) {
      const n = Math.min(m.missing, sale.amount, Math.floor(coins / withFee(Number(sale.price))));
      return { step: 'buy_item', order: sale.id, amount: n, why: `Needs ${m.missing} more ${name(m.id)}. One is for sale at ${sale.price} coins; fishing one costs about ${worth(m.id)} coins of bait, so buying is ${Number(sale.price) < worth(m.id) ? 'cheaper' : 'worth the time'}.` };
    }
  }
  const m = missing[0], chest = CHEST_FINDS.includes(m.id);
  // a chest holds one of three finds, so the right one is a matter of luck: after a few chests, ask the market
  const askFor = missing.find((x) => (CHEST_FINDS.includes(x.id) ? memo.chests >= 1 : who.pays >= 1) && !mine.some((o) => o.buying && o.token_id === x.id));
  if (askFor && mine.length < 5) {
    const price = Math.max(2, Math.floor(worth(askFor.id) * who.pays));
    // (an offer to buy sets room aside in storage for what is asked, so it needs that room)
    if (coins >= price * askFor.missing + 2 * BAIT_PRICE && p.held + askFor.missing <= p.storage_cap) return { step: 'want_item', token_id: askFor.id, amount: askFor.missing, price, why: `Needs ${askFor.missing} more ${name(askFor.id)} for the quest. Fishing one costs about ${worth(askFor.id)} coins of bait; offers ${price} to whoever has one to spare.` };
  }
  if (p.held >= p.storage_cap) {
    // full of things that are up for sale and nobody buys: the cheapest of them comes down and goes back into the sea
    const unsold = mine.filter((o) => !o.buying).sort((x, y) => worth(x.token_id) - worth(y.token_id))[0];
    if (unsold) return { step: 'make_room', order: unsold.id, token_id: unsold.token_id, amount: Math.min(unsold.amount, 3), why: `Storage is full, and the ${name(unsold.token_id)} for sale finds no buyer: takes it down and throws ${Math.min(unsold.amount, 3)} back to have room for the quest.` };
    return { step: 'rest', why: 'Storage is full and nothing on board sells: waiting for a buyer.' };
  }
  if (bait === 0) {
    const want = Math.min(MOST_BAIT, Math.max(2, Math.ceil(m.missing * QUEST.effort[m.id]))), can = Math.min(want, Math.floor(coins / BAIT_PRICE));
    if (can >= 1) return { step: 'buy_bait', amount: can, why: `No bait left. ${m.missing} ${name(m.id)} to go takes about ${want} throws: buys ${can} bait for ${can * BAIT_PRICE} coins.` };
    if (memo.topUps >= TOP_UPS_A_DAY) return { step: 'rest', why: `Out of coins, and has topped up ${TOP_UPS_A_DAY} times today already. That is the budget.` };
    if (memo.near < KEEP_NEAR + TOP_UP_NEAR) return { step: 'rest', why: `Out of coins and the wallet is down to ${memo.near.toFixed(2)} NEAR: stays ashore.` };
    return { step: 'top_up', near: TOP_UP_NEAR, why: `Out of coins. Tops up ${TOP_UP_NEAR} NEAR from the wallet (${memo.near.toFixed(2)} NEAR): about ${Math.floor((TOP_UP_NEAR * 1e24) / Number(S.coin_price))} coins at today's price.` };
  }
  if (chest && memo.chests >= MOST_CHESTS) {
    const fish = missing.find((x) => !CHEST_FINDS.includes(x.id));
    if (!fish) return { step: 'rest', why: `Opened ${memo.chests} chests without a ${name(m.id)}. Waits for one on the market instead of spending more bait.` };
    return { step: 'fish', want: fish.id, why: `Still ${fish.missing} ${name(fish.id)} to catch for the quest.` };
  }
  return chest
    ? { step: 'fish', want: 'chest', why: `The quest wants a ${name(m.id)}, and that only comes out of a chest (one find in three). Going down for one.` }
    : { step: 'fish', want: m.id, why: `Needs ${m.missing} more ${name(m.id)} for the quest: about ${Math.ceil(m.missing * QUEST.effort[m.id])} throws.` };
}

const max = (a, b) => (a > b ? a : b);
const near = (yocto) => Number(BigInt(yocto) / 10n ** 18n) / 1e6;
