// The contract's rules, written again in JavaScript, so that a week of the game can be played in seconds
// (src/week.js) instead of in a week of real transactions.
//
// This is a MODEL of contract/src, not the contract. It keeps the same books by the same rules: what a coin costs,
// what the quest asks for, how the two markets hold and hand over, how a day's prize is set aside and drawn, who is
// owed what. Each function below carries the name of the contract call it stands for and refuses what the contract
// refuses, in the contract's words. Every call also costs its caller the network's fee, as measured on testnet
// (FEES below). What is left out: the cast's secret (who may land a catch is the server's business; here the
// runner is trusted as the server is there), and that a call the contract refuses still costs a little gas on
// the chain (here it costs nothing).
// What the chain draws from its own randomness (what is in a chest, who wins) is drawn here from a seeded row of
// numbers, so the same seed always plays the same week.
//
// `audit()` adds everything up and says where the books do not close: NEAR (wallets, vault, prizes set aside,
// what is owed, what offers hold), every kind of token (made, destroyed, held, in the market), and every
// storage. test/model.test.mjs holds the model against numbers taken from the contract and its tests, and
// `npm run verify` compares it with the contract on the chain.
import { mulberry32 } from './rng.js';

export const NEAR = 10n ** 24n;
export const UPPER = ['anchovy', 'mackerel', 'clownfish', 'snapper', 'milkfish', 'grouper'], DEEP = ['barracuda', 'tuna', 'shark'], PRIZE_FISH = 'sailfish', CHEST = ['pearl', 'goldbar', 'crown'];
const FISH = new Set([...UPPER, ...DEEP, PRIZE_FISH]), ITEMS = new Set([...FISH, ...CHEST]);
const PRICE_STEP = NEAR / 1_000_000n, LOWEST_COIN_PRICE = NEAR / 100_000n, LOWEST_TICKET_PRICE = NEAR / 10_000n;
const BAIT_PRICE = 2, WELCOME_BAIT = 5, CHEST_EVERY_MS = 20_000;
const STORAGE_CAP = [16, 24, 36, 50, 70], STORAGE_COST = [30, 70, 150, 300], REEL_COST = [40, 90, 200, 400];
const FEE_PERCENT = 5, ITEM_ORDERS_EACH = 5, ITEMS_PER_ORDER = 10, MIN_ITEM_PRICE = 2, TICKET_ORDERS_EACH = 10, TICKETS_PER_ORDER = 1000;
export const MAX_WINNERS = 100, DRAW_CAP = 500, PLAYER_CAP = 10, ONE_IN = 5;
// What a call costs its sender on NEAR: the gas it burned on testnet (Tgas, read from the transactions of the
// computer's boats and of the game's server on 2026-11-13) at the network's gas price, 0.0001 NEAR for a Tgas.
// (Real fees came out up to 5% under this, because part of a call is charged at a slightly lower price.)
// The three marked "like" were not seen on the chain yet and take the number of the call most like them.
export const FEES = { cast: 2.8, buy_bait: 2.9, throw_back: 2.6, upgrade: 2.9, hand_in: 4.7, top_up: 4.0, list_item: 2.7, want_item: 3.0, cancel_item_order: 3.5, buy_item: 5.5, sell_item: 4.7,
  enter_draw: 3.2, claim: 3.2, sell_tickets: 2.9, buy_tickets: 4.1, add_prize: 3.0,
  bid_tickets: 3.0 /* like want_item */, fill_bid: 4.1 /* like buy_tickets */, cancel_order: 3.5 /* like cancel_item_order */,
  // a catch is sent to the contract by the player who made it, with the server's approval of it (3.1 Tgas, with
  // the check of the server's signature in it): the one who fishes pays for their own catch
  land: 3.1,
  // these two are sent, and paid for, by the game's own accounts, not by the player
  settle_draw: 4.6, welcome: 3.0 /* like bid_tickets */ };
const BY_SERVER = new Set(['settle_draw', 'welcome']);
export const SERVER = 'server';
const networkFee = (method) => BigInt(Math.round((FEES[method] || 3) * 10)) * 10n ** 19n;
const feeOf = (total) => Math.ceil((total * FEE_PERCENT) / 100), feeOfNear = (total) => (total * BigInt(FEE_PERCENT) + 99n) / 100n;

// ---- SHA-256, because a day's quest is worked out from the hash of its number (contract/src/quest.rs)
const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export function sha256(text) {
  const src = new TextEncoder().encode(text), len = src.length, total = ((len + 9 + 63) >> 6) << 6, m = new Uint8Array(total);
  m.set(src); m[len] = 0x80;
  new DataView(m.buffer).setUint32(total - 4, len * 8);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), w = new Uint32Array(64), view = new DataView(m.buffer);
  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (w[i - 16] + (rot(a, 7) ^ rot(a, 18) ^ (a >>> 3)) + w[i - 7] + (rot(b, 17) ^ rot(b, 19) ^ (b >>> 10))) >>> 0; }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0, t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32), ov = new DataView(out.buffer);
  h.forEach((x, i) => ov.setUint32(i * 4, x));
  return out;
}

// ---- the quest of a day: an upper fish, a deep fish and a chest find (contract/src/quest.rs, to the digit)
const EFFORT10 = { anchovy: 21, mackerel: 22, clownfish: 27, snapper: 17, milkfish: 17, grouper: 19, barracuda: 31, tuna: 31, shark: 30, pearl: 71, goldbar: 71, crown: 71 };
const BUDGET10 = 240, SHARE = [53, 47];
export function questOf(day) {
  const h = sha256(`kail quest ${day}`), upper = UPPER[h[0] % UPPER.length], deep = DEEP[h[1] % DEEP.length], chest = CHEST[h[2] % CHEST.length];
  const tickets = 1, left = BUDGET10 * tickets - EFFORT10[chest];
  const n = (id, share) => Math.max(1, Math.floor((2 * left * share + EFFORT10[id] * 100) / (2 * EFFORT10[id] * 100)));
  return { needs: [[upper, n(upper, SHARE[0])], [deep, n(deep, SHARE[1])], [chest, 1]], tickets };
}
/// What a coin costs when the day's prize is `prize` (contract/src/lib.rs, `price_for`).
export function priceFor(prize, coinsPerTicket = 44) {
  const raw = prize / (BigInt(DRAW_CAP) * BigInt(coinsPerTicket)), up = ((raw + PRICE_STEP - 1n) / PRICE_STEP) * PRICE_STEP;
  return up > LOWEST_COIN_PRICE ? up : LOWEST_COIN_PRICE;
}

export function newChain({ dayMs = 3_600_000, seed = 1, prizePercent = 20, coinsPerTicket = 44, startMs = null, fees = true } = {}) {
  const rnd = mulberry32(seed), refuse = (words) => { throw new Error(words); }, need = (ok, words) => { if (!ok) refuse(words); };
  // every change is written down so that a call the contract would refuse half-way leaves nothing behind
  let undo = null;
  const set = (map, key, value) => { const had = map.has(key), old = map.get(key); undo?.push(() => (had ? map.set(key, old) : map.delete(key))); if (value === undefined) map.delete(key); else map.set(key, value); };
  const put = (obj, field, value) => { const old = obj[field]; undo?.push(() => { obj[field] = old; }); obj[field] = value; };
  const c = {
    now: startMs ?? dayMs * 1000, dayMs, prizePercent, coinsPerTicket,
    vault: 0n, escrow: 0n, funded: 0n, fees: 0n, serverFees: 0n, repaid: 0n, lastDay: null, coinPrice: null, nextId: 1,
    wallets: new Map(), balances: new Map(), profiles: new Map(), owed: new Map(), toppedUp: new Map(), welcomed: new Map(),
    draws: new Map(), entered: new Map(), questGiven: new Map(), recent: [],
    orders: new Map(), ordersOf: new Map(), ticketOrders: new Map(), ticketOrdersOf: new Map(), ticketTrades: [], itemTrades: [],
    made: new Map(), destroyed: new Map(), inMarket: new Map(),
  };
  const today = () => Math.floor(c.now / c.dayMs);
  const bump = (map, key, by) => set(map, key, (map.get(key) || 0) + by), bumpBig = (map, key, by) => set(map, key, (map.get(key) || 0n) + by);
  const profile = (who) => c.profiles.get(who) || { reel: 0, storage: 0, held: 0, casts: 0, open: false, lastChestAt: -1e15 };
  const save = (who, p) => set(c.profiles, who, p);
  const balance = (who, id) => c.balances.get(`${who}|${id}`) || 0;

  // ---- tokens and storage room (contract/src/mt.rs)
  function takeRoom(who, id, n) { if (!ITEMS.has(id)) return; const p = { ...profile(who) }; p.held += n; need(p.held <= STORAGE_CAP[p.storage], 'Storage is full'); save(who, p); }
  function freeRoom(who, id, n) { if (!ITEMS.has(id)) return; const p = { ...profile(who) }; p.held -= n; save(who, p); }
  const addBalance = (who, id, n) => set(c.balances, `${who}|${id}`, balance(who, id) + n);
  function subBalance(who, id, n) { const have = balance(who, id); need(have >= n, `Not enough ${id}: you have ${have}, this needs ${n}`); set(c.balances, `${who}|${id}`, have === n ? undefined : have - n); }
  const add = (who, id, n) => { takeRoom(who, id, n); addBalance(who, id, n); }, sub = (who, id, n) => { subBalance(who, id, n); freeRoom(who, id, n); };
  const mint = (who, id, n) => { add(who, id, n); bump(c.made, id, n); }, burn = (who, id, n) => { sub(who, id, n); bump(c.destroyed, id, n); };
  const hold = (who, id, n) => { subBalance(who, id, n); bump(c.inMarket, id, n); };                       // listed: out of the balance, room kept
  const giveBack = (who, id, n) => { addBalance(who, id, n); bump(c.inMarket, id, -n); };
  const deliver = (seller, buyer, id, n) => { freeRoom(seller, id, n); add(buyer, id, n); bump(c.inMarket, id, -n); };
  const owe = (who, yocto) => bumpBig(c.owed, who, yocto);

  // ---- the day: its prize is set aside when the day is first touched, and the coin's price with it (contract/src/draw.rs)
  const drawOf = (day) => c.draws.get(day) || { pool: 0n, tickets: 0, entries: [], settled: false, winners: 0, prizeEach: 0n };
  const prizeNow = () => (c.vault * BigInt(c.prizePercent)) / 100n;
  function prizeForecast() {
    let vault = c.vault;
    if (c.lastDay != null && c.lastDay !== today()) { const d = drawOf(c.lastDay); if (!d.settled && d.tickets === 0) vault += d.pool; }
    return (vault * BigInt(c.prizePercent)) / 100n;
  }
  // What a coin costs right now: the price set with today's prize, or more when the vault has grown since (today's
  // price grown as the prize has, in millionths of a NEAR, rounded up): NEAR added to the vault during a day
  // does not leave coins at the old price until the day is over. (contract: coin_price_now)
  function coinPriceNow() {
    if (!(c.coinPrice && c.coinPrice.day === today())) return priceFor(prizeForecast(), c.coinsPerTicket);
    const set = c.coinPrice.price, prize = drawOf(today()).pool, now = prizeNow();
    if (now <= prize) return set;
    if (prize < PRICE_STEP) { const p = priceFor(now, c.coinsPerTicket); return p > set ? p : set; }
    const units = (set / PRICE_STEP) * (now / PRICE_STEP), by = prize / PRICE_STEP;
    return ((units + by - 1n) / by) * PRICE_STEP;
  }
  function startDay() {
    const day = today();
    if (c.lastDay === day) return;
    if (c.lastDay != null) {
      const d = { ...drawOf(c.lastDay) };
      if (!d.settled) {
        if (d.tickets === 0) { put(c, 'vault', c.vault + d.pool); d.pool = 0n; }
        else if (d.pool === 0n) { d.pool = prizeNow(); put(c, 'vault', c.vault - d.pool); }
        set(c.draws, c.lastDay, d);
      }
    }
    const d = { ...drawOf(day) };
    d.pool = prizeNow(); put(c, 'vault', c.vault - d.pool);
    put(c, 'coinPrice', { day, price: priceFor(d.pool, c.coinsPerTicket) });
    set(c.draws, day, d);
    put(c, 'lastDay', day);
  }
  const pay = (who, yocto) => { const has = c.wallets.get(who) || 0n; need(has >= yocto, `Not enough NEAR in the wallet: it holds ${has}, this needs ${yocto}`); set(c.wallets, who, has - yocto); };

  // ---- orders
  function openOrder(book, count, most, who, order) {
    const mine = count.get(who) || 0;
    need(mine < most, `You already have ${most} orders open`);
    set(count, who, mine + 1);
    const id = String(c.nextId); put(c, 'nextId', c.nextId + 1);
    set(book, id, { id, account: who, ...order });
    return id;
  }
  const closeOrder = (book, count, o) => { set(book, o.id, undefined); set(count, o.account, (count.get(o.account) || 1) - 1); };
  const shrink = (book, count, o, by) => (o.amount - by === 0 ? closeOrder(book, count, o) : set(book, o.id, { ...o, amount: o.amount - by }));
  const order = (book, id) => book.get(String(id)) || refuse('That order is gone');
  function settleSale(seller, buyer, amount, total, buyerActed) {
    const fee = feeOfNear(total);
    startDay();
    put(c, 'vault', c.vault + fee);
    owe(seller, total - fee);
    deliver(seller, buyer, 'ticket', amount);
    put(c, 'ticketTrades', [{ at: c.now, seller, buyer, amount, price: (total / BigInt(amount)).toString(), by: buyerActed ? buyer : seller }, ...c.ticketTrades].slice(0, 30));
  }

  // ---- what an account can do: one function for each contract call
  const calls = {
    top_up(who, deposit) {
      startDay();
      const price = coinPriceNow();
      need(deposit >= price, 'That is less than the price of one coin today');
      const coins = deposit / price, paid = coins * price;
      pay(who, paid);
      put(c, 'vault', c.vault + paid);
      bumpBig(c.toppedUp, who, paid);
      mint(who, 'coin', Number(coins));
      return Number(coins);
    },
    buy_bait(who, amount) { need(amount >= 1, 'Buy at least one bait'); need(amount <= 1000, 'That is too much bait for one purchase'); burn(who, 'coin', amount * BAIT_PRICE); mint(who, 'bait', amount); },
    cast(who) {
      const p = { ...profile(who) };
      need(p.held < STORAGE_CAP[p.storage], 'Your storage is full: sell, throw back or upgrade before casting');
      burn(who, 'bait', 1);
      p.casts += 1; p.open = true; save(who, p);
      return p.casts;
    },
    // (the contract takes this from the game's server only, with the cast's secret; here the runner is the server)
    land(who, what) {
      let p = { ...profile(who) };
      need(p.open, 'That cast is not in the water');
      p.open = false; save(who, p);
      let kind = what;
      if (what === 'chest') {
        need(c.now >= p.lastChestAt + CHEST_EVERY_MS, 'The chest has not come back yet');
        p = { ...p, lastChestAt: c.now }; save(who, p);
        kind = CHEST[Math.floor(rnd() * CHEST.length)];
      } else need(FISH.has(what), 'No such fish');
      if (p.held >= STORAGE_CAP[p.storage]) return null;      // storage full: the catch is lost
      mint(who, kind, 1);
      return kind;
    },
    welcome(who) { if (c.welcomed.get(who)) return false; set(c.welcomed, who, true); mint(who, 'bait', WELCOME_BAIT); return true; },
    throw_back(who, id, amount) { need(ITEMS.has(id), 'Only fish and chest finds can be thrown back'); need(amount >= 1, 'Throw back at least one'); burn(who, id, amount); },
    upgrade(who, what) {
      const p = { ...profile(who) }, costs = what === 'reel' ? REEL_COST : what === 'storage' ? STORAGE_COST : refuse('Upgrade the reel or the storage');
      need(p[what] < costs.length, 'That is already the best one');
      burn(who, 'coin', costs[p[what]]);
      save(who, { ...profile(who), [what]: p[what] + 1 });
      return p[what] + 1;
    },
    hand_in(who) {
      const day = today(), q = questOf(day);
      bump(c.questGiven, day, q.tickets);
      for (const [id, n] of q.needs) burn(who, id, n);
      mint(who, 'ticket', q.tickets);
      return q.tickets;
    },
    // the market for fish and chest finds, in coins (contract/src/market.rs)
    list_item(who, id, amount, price) { const order = itemOrder(who, false, id, amount, price); hold(who, id, amount); return order; },
    want_item(who, id, amount, price) { const order = itemOrder(who, true, id, amount, price); hold(who, 'coin', price * amount); takeRoom(who, id, amount); return order; },
    cancel_item_order(who, id) {
      const o = order(c.orders, id);
      need(who === o.account, "That is somebody else's order");
      closeOrder(c.orders, c.ordersOf, o);
      if (o.buying) { giveBack(o.account, 'coin', o.price * o.amount); freeRoom(o.account, o.token_id, o.amount); } else giveBack(o.account, o.token_id, o.amount);
    },
    buy_item(who, id, amount) {
      const o = order(c.orders, id);
      need(!o.buying, 'That order is an offer to buy: sell into it instead'); need(who !== o.account, 'That is your own sale'); need(amount >= 1 && amount <= o.amount, 'Not that many are left in this sale');
      const total = o.price * amount, fee = feeOf(total);
      burn(who, 'coin', fee);
      sub(who, 'coin', total); add(o.account, 'coin', total);
      deliver(o.account, who, o.token_id, amount);
      put(c, 'itemTrades', [...c.itemTrades, { at: c.now, day: today(), seller: o.account, buyer: who, id: o.token_id, amount, price: o.price }]);
      shrink(c.orders, c.ordersOf, o, amount);
    },
    sell_item(who, id, amount) {
      const o = order(c.orders, id);
      need(o.buying, 'That order is a sale: buy from it instead'); need(who !== o.account, 'That is your own offer'); need(amount >= 1 && amount <= o.amount, 'The offer does not want that many');
      const total = o.price * amount, fee = feeOf(total);
      sub(who, o.token_id, amount); addBalance(o.account, o.token_id, amount);      // the buyer's room was set aside when the offer went up
      bump(c.inMarket, 'coin', -total); bump(c.destroyed, 'coin', fee);
      if (total > fee) addBalance(who, 'coin', total - fee);
      put(c, 'itemTrades', [...c.itemTrades, { at: c.now, day: today(), seller: who, buyer: o.account, id: o.token_id, amount, price: o.price }]);
      shrink(c.orders, c.ordersOf, o, amount);
    },
    // the draw (contract/src/draw.rs)
    enter_draw(who, amount) {
      need(amount >= 1, 'Enter at least one ticket');
      startDay();
      const day = today(), d = { ...drawOf(day) }, key = `${day}|${who}`, mine = c.entered.get(key) || 0;
      need(mine + amount <= PLAYER_CAP, `One player can put ${PLAYER_CAP} tickets into a day's draw`);
      need(d.tickets + amount <= DRAW_CAP, "Today's draw is full: keep the ticket for the next one");
      burn(who, 'ticket', amount);
      if (!d.entries.length) put(c, 'recent', [day, ...c.recent].slice(0, 10));
      d.entries = [...d.entries, [who, d.tickets]]; d.tickets += amount;
      set(c.draws, day, d); set(c.entered, key, mine + amount);
    },
    settle_draw(_who, day) {
      startDay();
      need(day < today(), 'That day is not over yet');
      const d = { ...drawOf(day) };
      need(!d.settled, 'That draw has been held already');
      need(d.tickets > 0, "No ticket was in that day's draw");
      d.settled = true;
      const roll = Math.floor(rnd() * ONE_IN), winners = Math.min(Math.floor(d.tickets / ONE_IN) + (roll < d.tickets % ONE_IN ? 1 : 0), MAX_WINNERS);
      d.won = [];
      if (winners === 0) { put(c, 'vault', c.vault + d.pool); d.pool = 0n; }
      else {
        if (d.pool === 0n) { d.pool = prizeNow(); put(c, 'vault', c.vault - d.pool); }
        d.winners = winners; d.prizeEach = d.pool / BigInt(MAX_WINNERS);
        const paid = d.prizeEach * BigInt(winners);
        put(c, 'vault', c.vault + d.pool - paid); d.pool = paid;
        // the winning tickets, drawn without putting any back; a ticket belongs to the entry that starts at or before it
        const moved = new Map();
        for (let i = 0; i < winners; i++) {
          const r = i + Math.floor(rnd() * (d.tickets - i)), picked = moved.get(r) ?? r;
          moved.set(r, moved.get(i) ?? i);
          const holder = [...d.entries].reverse().find(([, from]) => from <= picked)[0];
          owe(holder, d.prizeEach); d.won.push(holder);
        }
      }
      set(c.draws, day, d);
      // the vault pays the game's server back what holding the draw cost it in fees (contract: repay_the_draw)
      if (fees && _who === SERVER) {
        const fee = networkFee('settle_draw');
        if (c.vault >= fee) { put(c, 'vault', c.vault - fee); set(c.wallets, SERVER, (c.wallets.get(SERVER) || 0n) + fee); put(c, 'repaid', c.repaid + fee); }
      }
      return d.winners;
    },
    claim(who) { const amount = c.owed.get(who) || 0n; need(amount > 0n, 'Nothing to collect'); set(c.owed, who, undefined); set(c.wallets, who, (c.wallets.get(who) || 0n) + amount); return amount; },
    add_prize(who, deposit) { startDay(); need(deposit > 0n, 'Attach the NEAR to add'); pay(who, deposit); put(c, 'vault', c.vault + deposit); },
    // the ticket market, in NEAR (contract/src/tickets.rs)
    sell_tickets(who, amount, price) { hold(who, 'ticket', amount); return ticketOrder(who, false, amount, price); },
    bid_tickets(who, amount, price) { const id = ticketOrder(who, true, amount, price); pay(who, price * BigInt(amount)); put(c, 'escrow', c.escrow + price * BigInt(amount)); return id; },
    cancel_order(who, id) {
      const o = order(c.ticketOrders, id);
      need(who === o.account, "That is somebody else's order");
      closeOrder(c.ticketOrders, c.ticketOrdersOf, o);
      if (o.buying) { put(c, 'escrow', c.escrow - o.price * BigInt(o.amount)); owe(o.account, o.price * BigInt(o.amount)); } else giveBack(o.account, 'ticket', o.amount);
    },
    buy_tickets(who, id, amount) {
      const o = order(c.ticketOrders, id);
      need(!o.buying, 'That order is an offer to buy: sell into it instead'); need(who !== o.account, 'That is your own sale'); need(amount >= 1 && amount <= o.amount, 'Not that many are left in this sale');
      const total = o.price * BigInt(amount);
      pay(who, total);
      settleSale(o.account, who, amount, total, true);
      shrink(c.ticketOrders, c.ticketOrdersOf, o, amount);
    },
    fill_bid(who, id, amount) {
      const o = order(c.ticketOrders, id);
      need(o.buying, 'That order is a sale: buy from it instead'); need(who !== o.account, 'That is your own offer'); need(amount >= 1 && amount <= o.amount, 'The offer does not want that many');
      const total = o.price * BigInt(amount);
      hold(who, 'ticket', amount);
      put(c, 'escrow', c.escrow - total);
      settleSale(who, o.account, amount, total, false);
      shrink(c.ticketOrders, c.ticketOrdersOf, o, amount);
    },
  };
  function itemOrder(who, buying, id, amount, price) {
    need(ITEMS.has(id), 'Only fish and chest finds are traded here');
    need(Number.isInteger(amount) && amount >= 1 && amount <= ITEMS_PER_ORDER, 'Between 1 and 10 in one order');
    need(Number.isInteger(price) && price >= MIN_ITEM_PRICE && price <= 1_000_000, 'Name a price of at least 2 coins');
    return openOrder(c.orders, c.ordersOf, ITEM_ORDERS_EACH, who, { buying, token_id: id, amount, price });
  }
  function ticketOrder(who, buying, amount, price) {
    need(Number.isInteger(amount) && amount >= 1 && amount <= TICKETS_PER_ORDER, 'Between 1 and 1000 tickets in one order');
    need(price >= LOWEST_TICKET_PRICE, 'A ticket costs at least 0.0001 NEAR');
    return openOrder(c.ticketOrders, c.ticketOrdersOf, TICKET_ORDERS_EACH, who, { buying, amount, price });
  }

  // ---- what the contract shows (the same shape as its `player` and `state` views, numbers as text where it gives text)
  function player(who) {
    const p = profile(who);
    return {
      coins: String(balance(who, 'coin')), bait: String(balance(who, 'bait')), tickets: String(balance(who, 'ticket')), topped_up: String(c.toppedUp.get(who) || 0n),
      reel: p.reel, storage: p.storage, storage_cap: STORAGE_CAP[p.storage], held: p.held,
      items: [...ITEMS].map((id) => [id, String(balance(who, id))]).filter(([, n]) => n !== '0'),
      open_cast: p.open ? String(p.casts) : null, casts: String(p.casts),
      entered_today: c.entered.get(`${today()}|${who}`) || 0, owed: String(c.owed.get(who) || 0n),
    };
  }
  function drawView(day = today()) {
    const d = drawOf(day), fixed = c.lastDay === day || day < today();
    return { day: String(day), pool: String(fixed ? d.pool : prizeForecast()), fixed, tickets: String(d.tickets), settled: d.settled, winners: d.winners, prize_each: String(d.prizeEach),
      ends_in_ms: String(day === today() ? c.dayMs - (c.now % c.dayMs) : 0), cap: DRAW_CAP, per_player: PLAYER_CAP };
  }
  function state(who = null) {
    const day = today(), q = questOf(day);
    return {
      quest: { day, needs: q.needs, tickets: q.tickets, stock: 0, left: 0, ends_in_ms: c.dayMs - (c.now % c.dayMs) },
      draw: drawView(),
      past_draws: c.recent.filter((d) => d < day).map((d) => { const x = drawOf(d); return { day: String(d), ended_at: String((d + 1) * c.dayMs), pool: String(x.pool), tickets: String(x.tickets), settled: x.settled, winners: x.winners, prize_each: String(x.prizeEach), yours: who ? c.entered.get(`${d}|${who}`) || 0 : 0, tx: null }; }),
      orders: [...c.orders.values()].map((o) => ({ ...o, price: String(o.price) })),
      ticket_orders: [...c.ticketOrders.values()].map((o) => ({ ...o, price: String(o.price) })),
      ticket_trades: c.ticketTrades, vault: String(c.vault), coin_price: String(coinPriceNow()), day_ms: String(c.dayMs),
      me: who ? player(who) : null, events: [],
    };
  }

  // ---- the books: does everything add up?
  function audit() {
    const wrong = [];
    const inWallets = [...c.wallets.values()].reduce((a, x) => a + x, 0n), owedAll = [...c.owed.values()].reduce((a, x) => a + x, 0n);
    const setAside = [...c.draws.values()].filter((d) => !d.settled).reduce((a, d) => a + d.pool, 0n);
    const near = inWallets + c.vault + setAside + owedAll + c.escrow + c.fees + c.serverFees;
    if (near !== c.funded) wrong.push(`NEAR: ${c.funded} was put into wallets, ${near} is accounted for now (wallets ${inWallets}, vault ${c.vault}, prizes set aside ${setAside}, owed ${owedAll}, held for offers ${c.escrow}, fees ${c.fees + c.serverFees})`);
    const offers = [...c.ticketOrders.values()].filter((o) => o.buying).reduce((a, o) => a + o.price * BigInt(o.amount), 0n);
    if (offers !== c.escrow) wrong.push(`NEAR held for ticket offers: ${c.escrow}, the offers add up to ${offers}`);
    const held = new Map();
    for (const [key, n] of c.balances) { const id = key.slice(key.indexOf('|') + 1); held.set(id, (held.get(id) || 0) + n); }
    for (const id of new Set([...c.made.keys(), ...held.keys(), ...c.inMarket.keys()])) {
      const should = (c.made.get(id) || 0) - (c.destroyed.get(id) || 0), is = (held.get(id) || 0) + (c.inMarket.get(id) || 0);
      if (should !== is) wrong.push(`${id}: ${c.made.get(id) || 0} made, ${c.destroyed.get(id) || 0} destroyed, so ${should} should exist; ${held.get(id) || 0} are held and ${c.inMarket.get(id) || 0} are in the market`);
    }
    for (const [who, p] of c.profiles) {
      const own = [...ITEMS].reduce((a, id) => a + balance(who, id), 0), mine = [...c.orders.values()].filter((o) => o.account === who).reduce((a, o) => a + o.amount, 0);
      if (p.held !== own + mine) wrong.push(`${who}'s storage counts ${p.held} boxes; ${own} things on board and ${mine} in orders`);
      if (p.held > STORAGE_CAP[p.storage]) wrong.push(`${who}'s storage holds ${p.held}, more than its ${STORAGE_CAP[p.storage]}`);
    }
    if (c.vault < 0n) wrong.push(`the vault is below nothing: ${c.vault}`);
    return wrong;
  }

  return {
    get now() { return c.now; }, set now(ms) { c.now = ms; },
    get day() { return today(); }, dayMs: c.dayMs, raw: c,
    /// NEAR arrives in an account's wallet from outside the game (a faucet, an exchange).
    fund(who, yocto) { c.wallets.set(who, (c.wallets.get(who) || 0n) + yocto); c.funded += yocto; },
    wallet: (who) => c.wallets.get(who) || 0n,
    /// One call, as the account `who`. All of it happens, or (when the contract would refuse) none of it, and the reason is thrown.
    call(who, method, ...args) {
      const f = calls[method] || refuse(`No such call: ${method}`);
      undo = [];
      try {
        // the network's fee first, from whoever sends the transaction: the player, or the game's server
        if (fees) { const fee = networkFee(method), payer = BY_SERVER.has(method) ? SERVER : who; pay(payer, fee); put(c, BY_SERVER.has(method) ? 'serverFees' : 'fees', (BY_SERVER.has(method) ? c.serverFees : c.fees) + fee); }
        const out = f(who, ...args); undo = null; return out;
      }
      catch (e) { for (const back of undo.reverse()) back(); undo = null; throw e; }
    },
    player, state, draw: drawView, coinPrice: coinPriceNow, audit,
    /// Where all the NEAR is, in yoctoNEAR: what came in from outside, and every place it can be now.
    money() {
      const sum = (it) => [...it].reduce((a, x) => a + x, 0n);
      return { cameIn: c.funded, wallets: sum(c.wallets.values()), owed: sum(c.owed.values()), offers: c.escrow, vault: c.vault,
        setAside: sum([...c.draws.values()].filter((d) => !d.settled).map((d) => d.pool)), fees: c.fees, serverFees: c.serverFees, repaid: c.repaid };
    },
  };
}
