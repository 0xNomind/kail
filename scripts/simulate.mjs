// A week of the game in a few seconds:  npm run simulate
//
//   npm run simulate                              seven days, ten players, 4 NEAR in the vault, luck number 1
//   npm run simulate -- --days 14 --seed 7        another length; another luck number: other dice, a different week
//   npm run simulate -- --vault 50                NEAR in the prize vault before the first day
//   npm run simulate -- --players 40 --join 5     40 players on day 1, 5 more on every later day
//   npm run simulate -- --wallet 10               NEAR every player comes with
//   npm run simulate -- --json                    everything as JSON, for a program to read
//
// The computer's players play by the rules they play by on the chain (src/npc-rules.js), fishing in the real sea
// in its real steps, against a model of the contract (src/model.js) that also charges the network's fee for every
// call, as measured on testnet. It needs no network, no key and no account. The same options always give the same
// week. After every day the model's books are added up; if they do not close, this says where and exits with 1.
import { createHash } from 'node:crypto';
import { playWeek } from '../src/week.js';

const args = process.argv.slice(2), opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const days = Number(opt('days', 7)), seed = Number(opt('seed', 1)), vault = Number(opt('vault', 4)), players = Number(opt('players', 10)), joining = Number(opt('join', 0)), wallet = Number(opt('wallet', 10));
const started = Date.now(), week = playWeek({ days, seed, vault, players, joining, wallet }), took = Date.now() - started;
const print = createHash('sha256').update(JSON.stringify(week)).digest('hex').slice(0, 12);
// (written out in full before leaving: a program reading this through a pipe gets all of it)
const leave = async (text) => { await new Promise((ok) => process.stdout.write(text, ok)); process.exit(week.problems.length ? 1 : 0); };
if (args.includes('--json')) await leave(`${JSON.stringify({ ...week, fingerprint: print }, null, 1)}\n`);

const pad = (v, n) => String(v ?? '-').padStart(n), row = (cells, widths) => cells.map((c, i) => (i ? pad(c, widths[i]) : String(c).padEnd(widths[i]))).join('  ');
console.log(`Kail, ${days} days played in ${(took / 1000).toFixed(1)} s (a model of the contract, not the chain)`);
console.log(`${players} players on day 1${joining ? `, ${joining} more on every later day` : ''}, ${wallet} NEAR each; ${vault} NEAR in the prize vault; luck number ${seed}\n`);
const W = [4, 7, 8, 9, 9, 6, 6, 6, 9, 8, 9, 6, 6, 6, 8];
console.log(row(['day', 'players', 'prize', 'coin', 'bank', 'made', 'in', 'win', 'each', 'paid', 'tix sold', 'fish', 'price', 'casts', 'fees'], W));
for (const d of week.days) console.log(row([d.day, d.players, d.prize, d.coinPrice, d.bankEnd, d.ticketsMade, d.ticketsEntered, d.winners, d.prizeEach, d.paidOut, d.ticketsSold, d.fishSold, d.fishPrice, d.casts, (d.fees + d.serverFees).toFixed(4)], W));
console.log(`
  prize   NEAR a full day's draw can pay (a fifth of the bank when the day began)      coin  NEAR for one coin that day (one bait is 2 coins)
  bank    all prize money in the game at the day's end: the vault and prizes set aside   made  tickets earned with quests
  in      tickets put into that day's draw     win  winning tickets     each  NEAR a winning ticket got     paid  NEAR paid out
  tix sold, fish, price   tickets and fish that changed hands between the players, and the average price of a fish in coins
  fees    NEAR paid to NEAR's network that day, by the players and by the game's server`);
console.log('\nThe quest of each day:');
for (const d of week.days) console.log(`  day ${d.day}: ${d.quest}`);
// with ten players, each of them; with more, the ten characters they are
const B = [22, 8, 10, 9, 8, 8, 8, 8];
if (week.boats.length <= 10) {
  console.log('\nWho ended where (NEAR in the wallet and waiting to be collected, against the start):');
  console.log(row(['player', 'NEAR', 'change', 'coins', 'tickets', 'quests', 'casts', 'caught'], B));
  for (const b of [...week.boats].sort((a, c) => c.change - a.change)) console.log(row([b.name, b.near, (b.change > 0 ? '+' : '') + b.change, b.coins, b.tickets, b.quests, b.casts, b.caught], B));
} else {
  console.log(`\nWho ended where: the ${week.boats.length} players by the ten characters they are (NEAR each: against what a player came with, on average):`);
  console.log(row(['character', 'players', 'NEAR each', 'coins', 'tickets', 'quests', 'casts', 'caught'], B));
  const kinds = [...new Set(week.boats.map((b) => b.character))].map((name) => { const mine = week.boats.filter((b) => b.character === name), sum = (f) => mine.reduce((a, b) => a + f(b), 0); return { name, n: mine.length, each: sum((b) => b.change) / mine.length, sum }; });
  for (const k of kinds.sort((a, c) => c.each - a.each)) console.log(row([k.name, k.n, (k.each > 0 ? '+' : '') + k.each.toFixed(4), k.sum((b) => b.coins), k.sum((b) => b.tickets), k.sum((b) => b.quests), k.sum((b) => b.casts), k.sum((b) => b.caught)], B));
}
console.log('\nWhere all the NEAR is:');
const M = [68, 14], near = (x) => x.toFixed(6);
for (const [k, v] of week.money.cameIn) console.log('  ' + row([k, near(v)], M));
console.log('  ' + row(['ALL THAT CAME INTO THE GAME', near(week.money.total)], M));
for (const [k, v] of week.money.isNow) console.log('  ' + row([k, near(v)], M));
console.log('  ' + row(['ALL THERE IS NOW', near(week.money.totalNow)], M));
const last = week.days[week.days.length - 1];
console.log('\nA few of the last day\'s decisions, with the player\'s own reason:');
for (const s of last.said.filter((x, i, all) => all.findIndex((y) => y.step === x.step) === i).slice(0, 8)) console.log(`  ${s.who}, ${s.step}: ${s.why.slice(0, 150)}`);
const steps = {}; for (const d of week.days) for (const [k, n] of Object.entries(d.steps)) steps[k] = (steps[k] || 0) + n;
console.log(`\nSteps taken in the week: ${Object.entries(steps).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(`Steps the model refused (as the contract would have): ${week.days.reduce((a, d) => a + d.refused, 0)}`);
console.log(week.problems.length ? `\nTHE BOOKS DID NOT CLOSE:\n  ${week.problems.join('\n  ')}` : `\nThe books closed after every day: no NEAR, coin, ticket or fish appeared or vanished without a rule for it.`);
await leave(`Fingerprint of this week: ${print} (the same options give the same one)\n`);
