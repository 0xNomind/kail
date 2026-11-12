// A model of the ticket market with made-up traders, from before the contract existed. Not used by the game
// (see quests.js beside it); the tests still run against it.
// The ticket market, for NEAR. It works like a market for NFTs:
//   - every ticket has its own number;
//   - players list tickets at a price of their choosing, and anyone can buy a listed ticket;
//   - players post offers ("I pay this much for a ticket"), and any holder can sell into an offer;
//   - the seller pays a fee on every sale, which goes to the prize vault.
// The other players are simulated for now. On chain later: the functions here are the ones a contract would have.
import { TICKETS, DRAW, DAY_MS } from '../../src/config.js';
import { mulberry32, between, intBetween, hash } from '../../src/rng.js';
import { drawOf, winChance, dayIndex, dayFraction, takeTickets, giveTicket } from './quests.js';

const r2 = (n) => Math.round(n * 100) / 100, r3 = (n) => Math.round(n * 1000) / 1000;
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
export const FEE = TICKETS.fee;
export const afterFee = (price) => r3(price * (1 - TICKETS.fee));

// What one ticket is worth in a day's draw: its chance of winning times what a winner gets.
export function ticketWorth(day) {
  const d = drawOf(day);
  return r3((winChance(d.others) * d.prize) / DRAW.winners);
}

// Everything other players do on a day: what they list, what they offer, what they trade among themselves.
const days = new Map();
function dayOf(day) {
  if (days.has(day)) return days.get(day);
  const rnd = mulberry32(hash('ticketmarket' + day)), worth = ticketWorth(day);
  const [lo, hi] = TICKETS.listPrice;
  const listings = Array.from({ length: intBetween(rnd, TICKETS.listings) }, (_, i) => {
    const f = lo + (hi - lo) * rnd() ** 2, from = i < 7 ? 0 : rnd() * 0.75;      // most are priced near the low end
    return { key: `L${day}:${i}`, id: 10000 + Math.floor(rnd() * 90000), seller: pick(rnd, TICKETS.names), price: Math.max(0.01, r2(worth * f)),
      from, gone: from + 0.12 + ((f - lo) / (hi - lo)) * 0.9 + rnd() * 0.25, age: 1 + Math.floor(rnd() * 9) };   // cheap ones are bought sooner
  });
  const offers = Array.from({ length: intBetween(rnd, TICKETS.offers) }, (_, i) => {
    const from = i < 3 ? 0 : rnd() * 0.7;
    return { key: `O${day}:${i}`, buyer: pick(rnd, TICKETS.names), price: Math.max(0.01, r2(worth * between(rnd, TICKETS.offerPrice))), qty: intBetween(rnd, TICKETS.offerQty), from, gone: from + 0.3 + rnd() };
  });
  const sales = Array.from({ length: intBetween(rnd, TICKETS.sales) }, () => ({
    at: rnd(), id: 10000 + Math.floor(rnd() * 90000), price: r2(worth * (0.85 + 0.4 * rnd())), buyer: pick(rnd, TICKETS.names), seller: pick(rnd, TICKETS.names),
  }));
  const set = { listings, offers, sales, worth };
  days.set(day, set);
  if (days.size > 6) days.delete(days.keys().next().value);
  return set;
}

// Tickets other players have for sale right now, cheapest first.
export function listings(player, nowMs) {
  const day = dayIndex(nowMs), frac = dayFraction(nowMs);
  return dayOf(day).listings.filter((l) => l.from <= frac && frac < l.gone && !player.sold[l.key]).sort((a, b) => a.price - b.price);
}
// Offers other players have open right now, highest first. left = how many tickets the offer still takes.
export function offers(player, nowMs) {
  const day = dayIndex(nowMs), frac = dayFraction(nowMs);
  return dayOf(day).offers.filter((o) => o.from <= frac && frac < o.gone).map((o) => ({ ...o, left: o.qty - (player.sold[o.key] || 0) })).filter((o) => o.left > 0).sort((a, b) => b.price - a.price);
}
export const floorPrice = (player, nowMs) => listings(player, nowMs)[0]?.price ?? null;
export const bestOffer = (player, nowMs) => offers(player, nowMs)[0]?.price ?? null;

const log = (player, entry) => { player.ticketLog = [entry, ...(player.ticketLog || [])].slice(0, 30); };

// Buy a listed ticket at its price.
export function buyListing(player, nowMs, key) {
  const l = listings(player, nowMs).find((x) => x.key === key);
  if (!l || player.wallet + 1e-9 < l.price) return null;
  player.wallet = r3(player.wallet - l.price);
  player.sold[l.key] = 1;
  giveTicket(player, { id: l.id, day: dayIndex(nowMs) });
  log(player, { type: 'bought', id: l.id, price: l.price, who: l.seller, at: nowMs });
  return l;
}
// Sell tickets into another player's offer. Returns how many were sold.
export function acceptOffer(player, nowMs, key, n = 1, ids = null) {
  const o = offers(player, nowMs).find((x) => x.key === key);
  if (!o) return 0;
  const taken = takeTickets(player, Math.min(n, o.left, player.tickets), ids ? ids.slice(0, o.left) : null);
  if (!taken.length) return 0;
  player.sold[o.key] = (player.sold[o.key] || 0) + taken.length;
  player.wallet = r3(player.wallet + taken.length * afterFee(o.price));
  for (const t of taken) log(player, { type: 'sold', id: t.id, price: o.price, who: o.buyer, at: nowMs });
  return taken.length;
}
// Put tickets up for sale at a price of the player's choosing. They leave the hand while listed.
export function listTickets(player, nowMs, n, price, ids = null) {
  price = r2(price);
  const room = TICKETS.maxListings - player.ticketListings.length;
  if (!(price > 0) || room <= 0) return 0;
  const taken = takeTickets(player, Math.min(n, room, player.tickets), ids ? ids.slice(0, room) : null);
  for (const t of taken) player.ticketListings.push({ ...t, price, at: nowMs, checked: nowMs });
  return taken.length;
}
export function cancelListing(player, id) {
  const i = player.ticketListings.findIndex((l) => l.id === id);
  if (i < 0) return false;
  const [l] = player.ticketListings.splice(i, 1);
  giveTicket(player, { id: l.id, day: l.day });
  return true;
}
// Post an offer: "I pay this much each for up to n tickets". The NEAR is set aside until it is filled or cancelled.
export function placeOffer(player, nowMs, price, n) {
  price = r2(price); n = Math.floor(n);
  const cost = r3(price * n);
  if (!(price > 0) || n < 1 || player.wallet + 1e-9 < cost || player.ticketOffers.length >= TICKETS.maxOffers) return false;
  player.wallet = r3(player.wallet - cost);
  player.ticketOffers.push({ price, n, at: nowMs, checked: nowMs });
  return true;
}
export function cancelOffer(player, index) {
  const o = player.ticketOffers[index];
  if (!o) return 0;
  player.ticketOffers.splice(index, 1);
  const back = r3(o.price * o.n);
  player.wallet = r3(player.wallet + back);
  return back;
}
export const offerEscrow = (player) => r3(player.ticketOffers.reduce((a, o) => a + o.price * o.n, 0));

// Other players look at the player's listings and offers every few seconds. Works for time away too.
// Returns what happened: [{ type: 'sold' | 'filled', id, price }].
export function tickTickets(player, nowMs) {
  const out = [], worth = ticketWorth(dayIndex(nowMs)), every = TICKETS.checkEvery * 1000;
  const chance = (c) => Math.max(0, Math.min(0.6, c));
  for (let i = player.ticketListings.length - 1; i >= 0; i--) {
    const l = player.ticketListings[i], looks = Math.min(600, Math.floor((nowMs - l.checked) / every));
    if (looks <= 0) continue;
    const rnd = mulberry32(hash(`tl${l.id}:${l.checked}`)), p = chance((TICKETS.sellPatience - l.price / worth) * TICKETS.sellPace);
    let sold = false;
    for (let k = 0; k < looks && !sold; k++) sold = rnd() < p;
    l.checked += looks * every;
    if (!sold) continue;
    player.ticketListings.splice(i, 1);
    player.wallet = r3(player.wallet + afterFee(l.price));
    const who = pick(rnd, TICKETS.names);
    log(player, { type: 'sold', id: l.id, price: l.price, who, at: nowMs });
    out.push({ type: 'sold', id: l.id, price: l.price });
  }
  for (let i = player.ticketOffers.length - 1; i >= 0; i--) {
    const o = player.ticketOffers[i], looks = Math.min(600, Math.floor((nowMs - o.checked) / every));
    if (looks <= 0) continue;
    const rnd = mulberry32(hash(`to${o.at}:${o.checked}:${o.n}`)), p = chance((o.price / worth - TICKETS.fillFloor) * TICKETS.fillPace);
    for (let k = 0; k < looks && o.n > 0; k++) if (rnd() < p) {
      const id = 10000 + Math.floor(rnd() * 90000), who = pick(rnd, TICKETS.names);
      o.n -= 1;
      giveTicket(player, { id, day: dayIndex(nowMs) });
      log(player, { type: 'bought', id, price: o.price, who, at: nowMs });
      out.push({ type: 'filled', id, price: o.price });
    }
    o.checked += looks * every;
    if (o.n <= 0) player.ticketOffers.splice(i, 1);
  }
  return out;
}

// What has been traded lately, newest first: the player's own trades and those between other players.
export function activity(player, nowMs, limit = 14) {
  const day = dayIndex(nowMs), frac = dayFraction(nowMs);
  const others = dayOf(day).sales.filter((s) => s.at <= frac).map((s) => ({ type: 'trade', id: s.id, price: s.price, who: `${s.seller} to ${s.buyer}`, at: nowMs - (frac - s.at) * DAY_MS }));
  return [...(player.ticketLog || []), ...others].sort((a, b) => b.at - a.at).slice(0, limit);
}
