// A week of the game in a few seconds:  npm run simulate
//
//   npm run simulate                          seven days, seed 1
//   npm run simulate -- --days 14 --seed 7    another length, another week
//   npm run simulate -- --newcomers 3:10      ten more fishers arrive on day 3
//   npm run simulate -- --json                everything as JSON, for a program to read
//
// The computer's boats play by the rules they play by on the chain (src/npc-rules.js), fishing in the real sea,
// against a model of the contract (src/model.js). It needs no network, no key and no account. The same seed
// always gives the same week. After every day the model's books are added up; if they do not close, this says
// where and exits with 1.
import { createHash } from 'node:crypto';
import { playWeek } from '../src/week.js';

const args = process.argv.slice(2), opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const days = Number(opt('days', 7)), seed = Number(opt('seed', 1));
const newcomers = String(opt('newcomers', '')).split(',').filter(Boolean).map((x) => { const [day, count] = x.split(':').map(Number); return { day, count }; });
const started = Date.now(), week = playWeek({ days, seed, newcomers }), took = Date.now() - started;
const print = createHash('sha256').update(JSON.stringify(week)).digest('hex').slice(0, 12);
if (args.includes('--json')) { console.log(JSON.stringify({ ...week, fingerprint: print }, null, 1)); process.exit(week.problems.length ? 1 : 0); }

const pad = (v, n) => String(v ?? '-').padStart(n), row = (cells, widths) => cells.map((c, i) => (i ? pad(c, widths[i]) : String(c).padEnd(widths[i]))).join('  ');
console.log(`Kail, ${days} days played in ${(took / 1000).toFixed(1)} s (seed ${seed}; a model of the contract, not the chain)\n`);
const W = [4, 8, 9, 9, 6, 6, 6, 9, 8, 9, 6, 6, 6, 6];
console.log(row(['day', 'prize', 'coin', 'bank', 'made', 'in', 'win', 'each', 'paid', 'tix sold', 'fish', 'price', 'casts', 'boats'], W));
for (const d of week.days) console.log(row([d.day, d.prize, d.coinPrice, d.bankEnd, d.ticketsMade, d.ticketsEntered, d.winners, d.prizeEach, d.paidOut, d.ticketsSold, d.fishSold, d.fishPrice, d.casts, d.boats], W));
console.log(`
  prize   NEAR a full day's draw can pay (a fifth of the bank when the day began)      coin  what a coin cost that day, in NEAR
  bank    all prize money in the game at the day's end: the vault and prizes set aside   made  tickets earned with quests
  in      tickets put into that day's draw     win  winning tickets     each  NEAR a winning ticket got     paid  NEAR paid out
  tix sold, fish, price   tickets and fish that changed hands between the boats, and the average price of a fish in coins`);
console.log('\nThe quest of each day:');
for (const d of week.days) console.log(`  day ${d.day}: ${d.quest}`);
console.log('\nWho ended where (NEAR in the wallet and waiting to be collected, against the start):');
const B = [22, 9, 9, 7, 7, 7, 7, 6];
console.log(row(['boat', 'NEAR', 'change', 'coins', 'tickets', 'quests', 'casts', 'caught'], B));
for (const b of [...week.boats].sort((a, c) => c.change - a.change)) console.log(row([b.name, b.near, (b.change > 0 ? '+' : '') + b.change, b.coins, b.tickets, b.quests, b.casts, b.caught], B));
const last = week.days[week.days.length - 1];
console.log('\nA few of the last day\'s decisions, with the boat\'s own reason:');
for (const s of last.said.filter((x, i, all) => all.findIndex((y) => y.step === x.step) === i).slice(0, 8)) console.log(`  ${s.who}, ${s.step}: ${s.why.slice(0, 150)}`);
const steps = {}; for (const d of week.days) for (const [k, n] of Object.entries(d.steps)) steps[k] = (steps[k] || 0) + n;
console.log(`\nSteps taken in the week: ${Object.entries(steps).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(`Steps the model refused (as the contract would have): ${week.days.reduce((a, d) => a + d.refused, 0)}`);
console.log(week.problems.length ? `\nTHE BOOKS DID NOT CLOSE:\n  ${week.problems.join('\n  ')}` : `\nThe books closed after every day: no NEAR, coin, ticket or fish appeared or vanished without a rule for it.`);
console.log(`Fingerprint of this week: ${print} (the same seed and options give the same one)`);
process.exit(week.problems.length ? 1 : 0);
