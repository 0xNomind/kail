// The fast model of the contract (src/model.js) held against the contract: numbers read from the chain, the rules
// the contract's own tests check (contract/src/tests.rs), and the week played fast (src/week.js).
//   node test/model.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { newChain, questOf, priceFor, sha256, NEAR } from '../src/model.js';
import { playWeek } from '../src/week.js';

let checks = 0;
const ok = (name, f) => { f(); checks += 1; };
const refused = (f, words) => { try { f(); } catch (e) { assert.match(e.message, words); return; } assert.fail(`was not refused: ${words}`); };

ok('SHA-256 is SHA-256', () => { for (const t of ['', 'abc', 'kail quest 498473', 'x'.repeat(200)]) assert.equal(Buffer.from(sha256(t)).toString('hex'), createHash('sha256').update(t).digest('hex')); });
// read from kail-game.testnet on 2026-11-13: the quest of day 498473, and the coin's price on a day with that prize
ok('the quest of a day is the contract\'s', () => assert.deepEqual(questOf(498473).needs, [['clownfish', 3], ['barracuda', 3], ['goldbar', 1]]));
ok('the price of a coin is the contract\'s', () => {
  assert.equal(priceFor(792631529046411492258488n), 37000000000000000000n);
  assert.equal(priceFor(0n), NEAR / 100_000n);                       // never under a hundred-thousandth of a NEAR
  assert.equal(priceFor(NEAR * 22000n), NEAR);                        // prize / (500 tickets x 44 coins)
});

const game = () => { const c = newChain({ seed: 3 }); for (const who of ['a', 'b', 'c']) c.fund(who, 10n * NEAR); c.fund('makers', 100n * NEAR); c.now -= c.dayMs; c.call('makers', 'add_prize', 100n * NEAR); c.now += c.dayMs; return c; };
ok('a top-up buys whole coins at the day\'s price and fills the vault', () => {
  const c = game(), price = c.coinPrice(), before = c.wallet('a');
  assert.equal(c.call('a', 'top_up', price * 7n + 5n), 7);
  assert.equal(before - c.wallet('a'), price * 7n);                  // what is less than a coin's price stays in the wallet
  refused(() => c.call('a', 'top_up', price - 1n), /less than the price of one coin/);
  assert.deepEqual(c.audit(), []);
});
ok('bait, a cast, a catch, storage', () => {
  const c = game();
  c.call('a', 'top_up', c.coinPrice() * 100n); c.call('a', 'buy_bait', 3);
  assert.equal(c.player('a').coins, '94');
  refused(() => c.call('a', 'land', 'anchovy'), /not in the water/);
  c.call('a', 'cast'); assert.equal(c.call('a', 'land', 'anchovy'), 'anchovy');
  assert.equal(c.player('a').held, 1);
  refused(() => c.call('b', 'cast'), /Not enough bait/);
  assert.deepEqual(c.audit(), []);
});
ok('a refused call leaves nothing behind', () => {
  const c = game();
  c.call('a', 'top_up', c.coinPrice() * 50n); c.call('a', 'buy_bait', 1); c.call('a', 'cast'); c.call('a', 'land', 'anchovy');
  const before = JSON.stringify(c.state('a'));
  refused(() => c.call('a', 'hand_in'), /Not enough/);              // burns the first thing asked for before it finds the second missing
  refused(() => c.call('a', 'buy_item', '999', 1), /order is gone/);
  assert.equal(JSON.stringify(c.state('a')), before);
  assert.deepEqual(c.audit(), []);
});
ok('the fish market: who pays the fee, and whose room is used', () => {
  const c = game();
  for (const who of ['a', 'b']) { c.call(who, 'top_up', c.coinPrice() * 100n); c.call(who, 'buy_bait', 2); }
  c.call('a', 'cast'); c.call('a', 'land', 'snapper');
  const sale = c.call('a', 'list_item', 'snapper', 1, 3);
  assert.equal(c.player('a').held, 1);                               // a listed fish still takes its box
  refused(() => c.call('a', 'buy_item', sale, 1), /your own sale/);
  c.call('b', 'buy_item', sale, 1);                                   // 3 coins to the seller, 1 coin of fee (5%, at least 1) destroyed
  assert.equal(c.player('b').coins, String(100 - 4 - 3 - 1)); assert.equal(c.player('a').coins, String(100 - 4 + 3));
  assert.equal(c.player('a').held, 0); assert.equal(c.player('b').held, 1);
  const want = c.call('a', 'want_item', 'snapper', 1, 10);            // coins and a box are set aside
  assert.equal(c.player('a').held, 1);
  c.call('b', 'sell_item', want, 1);                                  // the seller gets 10 less the fee of 1
  assert.equal(c.player('b').coins, String(92 + 9)); assert.deepEqual(c.player('a').items, [['snapper', '1']]);
  assert.deepEqual(c.audit(), []);
});
ok('the draw: limits, one in five, a hundredth of the prize each, the rest back to the vault', () => {
  const c = game(), day = c.day;
  c.call('a', 'top_up', c.coinPrice());                               // the day begins: its prize is set aside
  const pool = BigInt(c.draw().pool);
  assert.equal(pool, 20n * NEAR);                                     // a fifth of the vault
  c.raw.balances.set('a|ticket', 30); c.raw.made.set('ticket', 30);   // (tickets out of thin air, for the test only)
  c.call('a', 'enter_draw', 10);
  refused(() => c.call('a', 'enter_draw', 1), /One player can put 10/);
  refused(() => c.call('x', 'settle_draw', day), /not over yet/);
  c.now += c.dayMs;
  const winners = c.call('server', 'settle_draw', day), d = c.draw(day);
  assert.equal(winners, 2);                                           // ten tickets: two win
  assert.equal(BigInt(d.prize_each), pool / 100n); assert.equal(BigInt(d.pool), (pool / 100n) * 2n);
  assert.equal(BigInt(c.player('a').owed), (pool / 100n) * 2n);
  refused(() => c.call('server', 'settle_draw', day), /held already/);
  const before = c.wallet('a'); c.call('a', 'claim'); assert.equal(c.wallet('a') - before, (pool / 100n) * 2n);
  assert.deepEqual(c.audit(), []);
});
ok('the ticket market: NEAR for a ticket, 5% to the vault', () => {
  const c = game();
  c.raw.balances.set('a|ticket', 2); c.raw.made.set('ticket', 2);
  const sale = c.call('a', 'sell_tickets', 2, NEAR / 100n);
  refused(() => c.call('b', 'sell_tickets', 1, 1n), /Not enough ticket/);
  c.call('b', 'buy_tickets', sale, 1);
  assert.equal(BigInt(c.player('a').owed), NEAR / 100n - NEAR / 2000n); assert.equal(c.player('b').tickets, '1');
  const bid = c.call('c', 'bid_tickets', 1, NEAR / 50n);
  c.call('b', 'fill_bid', bid, 1);
  assert.equal(c.player('c').tickets, '1'); assert.equal(BigInt(c.player('b').owed), NEAR / 50n - NEAR / 1000n);
  c.call('a', 'cancel_order', sale);
  assert.equal(c.player('a').tickets, '1');
  assert.deepEqual(c.audit(), []);
});

const hash = (w) => createHash('sha256').update(JSON.stringify(w)).digest('hex');
const week = playWeek({ days: 7, seed: 1 });
ok('a week played fast: the books close every day', () => assert.deepEqual(week.problems, []));
ok('the same seed plays the same week, another seed another', () => { assert.equal(hash(playWeek({ days: 7, seed: 1 })), hash(week)); assert.notEqual(hash(playWeek({ days: 7, seed: 2 })), hash(week)); });
ok('the boats do what the game is about', () => {
  const sum = (f) => week.days.reduce((a, d) => a + f(d), 0);
  assert.ok(sum((d) => d.ticketsMade) >= 20, 'quests are finished'); assert.ok(sum((d) => d.ticketsEntered) >= 10, 'tickets go into draws');
  assert.ok(sum((d) => d.winners) >= 1, 'somebody wins'); assert.ok(sum((d) => d.fishSold) >= 10, 'fish are traded');
  assert.equal(sum((d) => d.refused), 0, 'the rules never ask for a step the contract would refuse');
});
console.log(`the model against the contract: ${checks} checks passed`);
