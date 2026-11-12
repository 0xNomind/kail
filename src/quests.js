// The daily quest, tickets, the draw, and the two markets.
// Inside the game everything is coins: bait, upgrades, trading fish. Outside it, at the Harbour, everything is NEAR:
// topping up coins, trading tickets, the draw. Nothing gives out coins for free: the quest pays a ticket.
import { FISH, RARE, ITEM_BY_ID, QUEST, DRAW, MARKET, MONEY, DAY_MS } from './config.js';
import { mulberry32, between, intBetween, hash } from './rng.js';

export const dayIndex = (nowMs) => Math.floor(nowMs / DAY_MS);
export const dayFraction = (nowMs) => (nowMs % DAY_MS) / DAY_MS;
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

// The quest of a day, the same for everybody: three kinds of things, different amounts.
// (Kept as a list of one, so the rest of the code can treat "the board" as a list.)
export function questsFor(day) {
  const rnd = mulberry32(hash('quest' + day));
  const upper = pick(rnd, FISH.filter((f) => f.tier <= 2)), deep = pick(rnd, FISH.filter((f) => f.tier === 3));
  const rare = pick(rnd, RARE).id;                       // pearl, gold bar or old crown, each as likely
  const tickets = rare === 'crown' ? QUEST.crownTickets : 1;
  const throws = QUEST.budget * tickets - QUEST.effort[rare];        // what is left for the two fish
  const n = (id, share) => Math.max(1, Math.round((throws * share) / QUEST.effort[id]));
  return [{
    key: 'daily', name: 'Daily quest', tickets, stock: QUEST.stock, goneAt: between(rnd, QUEST.goneAt),
    needs: [{ id: upper.id, n: n(upper.id, QUEST.fishShare[0]) }, { id: deep.id, n: n(deep.id, QUEST.fishShare[1]) }, { id: rare, n: 1 }],
  }];
}
export const neededToday = (day, id) => questsFor(day).some((q) => q.needs.some((x) => x.id === id));

// --- tickets: each one has its own number, like an NFT. player.tickets is always how many are held.
export function mintTickets(player, n, day) {
  for (let i = 0; i < n; i++) {
    player.minted = (player.minted || 0) + 1;
    player.ticketList.push({ id: 10000 + (hash(`${player.id}:${player.minted}`) % 90000), day });
  }
  player.tickets = player.ticketList.length;
}
// Take n tickets out of the hand (the oldest first, or the ones named). Returns the tickets taken.
export function takeTickets(player, n, ids = null) {
  const out = [];
  if (ids) for (const id of ids) { const i = player.ticketList.findIndex((t) => t.id === id); if (i >= 0) out.push(...player.ticketList.splice(i, 1)); }
  else out.push(...player.ticketList.splice(0, Math.max(0, n)));
  player.tickets = player.ticketList.length;
  return out;
}
export function giveTicket(player, ticket) { player.ticketList.push(ticket); player.tickets = player.ticketList.length; }
// An older save only knew how many tickets there were: give them numbers.
export function numberTickets(player, day = 0) {
  player.ticketList ||= [];
  const missing = (player.tickets || 0) - player.ticketList.length;
  if (missing > 0) mintTickets(player, missing, day);
  player.tickets = player.ticketList.length;
}

// Tickets other players have taken from the stock by this point of the day.
export const othersTook = (quest, frac) => Math.min(quest.stock, Math.floor(quest.stock * Math.min(1, frac / quest.goneAt)));
// mine = how many times this player finished the quest today (each time takes quest.tickets from the stock).
// What is left is counted in whole quests' worth: fewer tickets than one quest pays means it is over.
export function stockLeft(quest, frac, mine = 0) {
  const left = quest.stock - othersTook(quest, frac) - mine * quest.tickets;
  return left >= quest.tickets ? left : 0;
}

const key = (day, i) => `${day}:${i}`;
export const progressOf = (player, day, i) => player.quest[key(day, i)] || {};
export const doneCount = (player, day, i) => player.done[key(day, i)] || 0;
// How many more of this thing the quest still needs from this player right now.
export function stillNeeds(player, day, i, id) {
  const need = questsFor(day)[i].needs.find((x) => x.id === id);
  return need ? Math.max(0, need.n - (progressOf(player, day, i)[id] || 0)) : 0;
}

// Hand things from storage to the quest. They stay there as progress. When everything is in, the quest pays
// its ticket (if the day's stock is not gone) and can be started again. Returns { gave, tickets }.
export function giveToQuest(player, day, frac, i, id, n = Infinity) {
  const quest = questsFor(day)[i];
  if (stockLeft(quest, frac, doneCount(player, day, i)) <= 0) return { gave: 0, tickets: 0 };
  const gave = Math.min(n, player.storage[id] || 0, stillNeeds(player, day, i, id));
  if (gave <= 0) return { gave: 0, tickets: 0 };
  player.storage[id] -= gave;
  if (!player.storage[id]) delete player.storage[id];
  const prog = (player.quest[key(day, i)] ||= {});
  prog[id] = (prog[id] || 0) + gave;
  let tickets = 0;
  if (quest.needs.every((x) => (prog[x.id] || 0) >= x.n)) {
    delete player.quest[key(day, i)];
    player.done[key(day, i)] = doneCount(player, day, i) + 1;
    mintTickets(player, quest.tickets, day); tickets = quest.tickets;
  }
  return { gave, tickets };
}
// Everything in storage that the quest still needs.
export function giveAll(player, day, frac) {
  let tickets = 0, gave = 0;
  questsFor(day).forEach((q, i) => { for (const x of q.needs) { const r = giveToQuest(player, day, frac, i, x.id); gave += r.gave; tickets += r.tickets; } });
  return { gave, tickets };
}

// --- the draw
export const drawOf = (day) => {
  const rnd = mulberry32(hash('draw' + day));
  return { prize: Math.round(between(rnd, DRAW.prize)), others: intBetween(rnd, DRAW.othersTickets) };
};
export function enterDraw(player, day, n) {
  n = takeTickets(player, Math.min(n, player.tickets)).length;      // burned: they are gone for good
  if (n <= 0) return 0;
  player.entries[day] = (player.entries[day] || 0) + n;
  return n;
}
// Chance that one ticket wins if this many are in the draw.
export const winChance = (inDraw) => Math.min(1, DRAW.winners / Math.max(1, inDraw));
// Settle every finished day the player entered. Returns what happened, newest last.
export function settleDraws(player, today) {
  const out = [];
  for (const d of Object.keys(player.entries).map(Number).sort((a, b) => a - b)) {
    if (d >= today) continue;
    const mine = player.entries[d], { prize, others } = drawOf(d);
    const rnd = mulberry32(hash(`result${d}:${player.id}`));
    // draw the winning tickets one by one from everything that was entered
    let pool = others + mine, left = mine, slots = Math.min(DRAW.winners, pool), won = 0;
    for (; slots > 0 && left > 0; slots--, pool--) if (rnd() < left / pool) { won++; left--; }
    const each = prize / DRAW.winners, near = won * each;
    player.near = r3(player.near + near);            // won in all
    player.wallet = r3(player.wallet + near);        // and it lands in the wallet
    delete player.entries[d];
    const result = { day: d, tickets: mine, won, near: r3(near), each, inDraw: others + mine };
    player.results = [...(player.results || []), result].slice(-8);
    out.push(result);
  }
  return out;
}

// --- the Harbour: NEAR in, coins out (simulated for now, on chain later). The ticket market is in ticketmarket.js.
const r3 = (n) => Math.round(n * 1000) / 1000;
// A top-up turns NEAR from the wallet into coins. Returns the coins added (0 if the wallet is short).
export function topUp(player, near) {
  if (near <= 0 || player.wallet + 1e-9 < near) return 0;
  player.wallet = r3(player.wallet - near);
  player.coins += near * MONEY.coinsPerNear;
  player.toppedUp = r3((player.toppedUp || 0) + near);
  return near * MONEY.coinsPerNear;
}
// --- the market inside the game, for coins (the other players are simulated for now)
// Things that can be traded here: every fish and every chest item. Tickets trade at the Harbour, for NEAR.
export const TRADABLE = Object.keys(ITEM_BY_ID);
const group = (id) => (ITEM_BY_ID[id].rare ? 'rare' : ITEM_BY_ID[id].tier);
const holds = (player, id) => player.storage[id] || 0;
function move(player, id, n) {      // n may be negative
  player.storage[id] = (player.storage[id] || 0) + n;
  if (player.storage[id] <= 0) delete player.storage[id];
}
// What a thing is worth today. More if the day's quest asks for it.
export function fairPrice(id, day) {
  return Math.max(1, Math.round(ITEM_BY_ID[id].value * (neededToday(day, id) ? MARKET.wantedToday : 1)));
}
const dayKey = (day, kind, id) => `${day}:${kind}:${id}`;

// What other players have for sale today: one offer per thing, { id, price, left }.
export function forSale(player, day) {
  return TRADABLE.map((id) => {
    const rnd = mulberry32(hash(`ask${day}:${id}`));
    const n = intBetween(rnd, MARKET.forSale[group(id)]), price = Math.max(1, Math.round(fairPrice(id, day) * between(rnd, MARKET.ask)));
    return { id, price, left: Math.max(0, n - (player.sold[dayKey(day, 'bought', id)] || 0)) };
  }).filter((o) => o.left > 0);
}
// Buy from another player. room = free boxes in storage (tickets need none). Returns how many were bought.
export function buyFromPlayers(player, day, id, n, room = Infinity) {
  const offer = forSale(player, day).find((o) => o.id === id);
  if (!offer) return 0;
  const take = Math.min(n, offer.left, Math.floor(player.coins / offer.price), room);
  if (take <= 0) return 0;
  player.coins -= take * offer.price;
  move(player, id, take);
  player.sold[dayKey(day, 'bought', id)] = (player.sold[dayKey(day, 'bought', id)] || 0) + take;
  return take;
}
// What other players want to buy today: { id, price, left }. Selling to them is instant.
export function playerBid(id, day) {
  const rnd = mulberry32(hash(`bid${day}:${id}`));
  return Math.max(1, Math.round(fairPrice(id, day) * between(rnd, MARKET.bid)));
}
export const playersStillWant = (player, day, id) => Math.max(0, MARKET.wanted[group(id)] - (player.sold[dayKey(day, 'sold', id)] || 0));
const afterFee = (coins) => coins - Math.ceil(coins * MARKET.fee);
export function sellToPlayers(player, day, id, n) {
  const take = Math.min(n, holds(player, id), playersStillWant(player, day, id));
  if (take <= 0) return 0;
  move(player, id, -take);
  player.sold[dayKey(day, 'sold', id)] = (player.sold[dayKey(day, 'sold', id)] || 0) + take;
  player.coins += afterFee(take * playerBid(id, day));
  return take;
}
export const payout = (id, day, n) => afterFee(n * playerBid(id, day));

// The player's own offers: things put up at a price of the player's choosing. They leave storage while listed.
export function listForSale(player, id, n, price, nowMs) {
  if (!ITEM_BY_ID[id]) return false;
  n = Math.min(n, holds(player, id), MARKET.maxPerListing);
  if (n <= 0 || price < 1 || player.listings.length >= MARKET.maxListings) return false;
  move(player, id, -n);
  player.listings.push({ id, n, price: Math.round(price), at: nowMs, checked: nowMs });
  return true;
}
// Take an offer back. Things only come back if there is room for them.
export function takeBack(player, index, room = Infinity) {
  const l = player.listings[index];
  if (!l || room < l.n) return false;
  move(player, l.id, l.n);
  player.listings.splice(index, 1);
  return true;
}
// Other players look at the player's offers every few seconds and buy a unit if the price is fair enough.
// Works for time away too. Returns what was sold: [{ id, n, coins }].
export function tickMarket(player, nowMs) {
  const sold = [];
  for (let i = player.listings.length - 1; i >= 0; i--) {
    const l = player.listings[i];
    const looks = Math.min(600, Math.floor((nowMs - l.checked) / (MARKET.checkEvery * 1000)));
    if (looks <= 0) continue;
    const rnd = mulberry32(hash(`look${l.at}:${l.checked}:${l.id}`));
    const chance = Math.max(0, MARKET.patience - l.price / fairPrice(l.id, dayIndex(nowMs))) * MARKET.pace;
    let n = 0;
    for (let k = 0; k < looks && l.n > 0; k++) if (rnd() < chance) { n++; l.n--; }
    l.checked += looks * MARKET.checkEvery * 1000;
    if (n) { const coins = afterFee(n * l.price); player.coins += coins; sold.push({ id: l.id, n, coins }); }
    if (l.n <= 0) player.listings.splice(i, 1);
  }
  return sold;
}
export const RARE_IDS = RARE.map((r) => r.id);
