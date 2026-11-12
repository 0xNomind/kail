// What does one ticket cost? A robot works the quest board and every coin and minute is counted.
// node test/economy.mjs
import { BAIT, MONEY, QUEST, UPGRADES, ITEM_BY_ID, DRAW } from '../src/config.js';
import { newWorld, newPlayer, step, release, entities, storageUsed, storageCap, buyBait, buyUpgrade, upgradeCost } from '../src/sim.js';
import { questsFor, giveToQuest, stillNeeds, stockLeft, doneCount, sellToPlayers, playerBid, winChance } from './model/quests.js';
import { makeBot } from './bot.mjs';

const DT = 1 / 60;

// only: work one quest ('common' | 'big' | 'treasure') or null for the whole board.
// The clock of the day is frozen at "frac" so other players do not use up the stock while we measure.
export function ticketCost({ only = null, lag = 0.28, minutes = 60, seed = 1, reel = 0, storage = 0, day = 7, frac = 0, sell = false }) {
  const world = newWorld(seed), p = newPlayer();
  p.up.reel = reel; p.up.storage = storage; p.coins = 1e9; p.bait = 0;
  const bots = {};
  const botFor = (id) => (bots[id] ||= makeBot(id === 'chest' ? { wantChest: true, lag } : { wantId: id, lag }));
  const o = { tickets: 0, bait: 0, casts: 0, lost: 0, thrownBack: 0, soldCoins: 0, minutes, byQuest: {} };
  const quests = questsFor(day);
  let bot = null;
  for (let t = 0; t < minutes * 60; t += DT) {
    const h = world.hook;
    if (h.state === 'idle') {
      const before = p.tickets;
      quests.forEach((q, i) => { if (!only || q.key === only) for (const x of q.needs) { const d0 = doneCount(p, day, i); giveAllOne(p, day, frac, i, x.id); if (doneCount(p, day, i) > d0) o.byQuest[q.key] = (o.byQuest[q.key] || 0) + 1; } });
      o.tickets += p.tickets - before;
      // what is still needed, and is one of them in the water right now?
      const needs = [];
      quests.forEach((q, i) => { if ((!only || q.key === only) && stockLeft(q, frac, doneCount(p, day, i)) > 0) for (const x of q.needs) if (stillNeeds(p, day, i, x.id) - (p.storage[x.id] || 0) > 0) needs.push(x.id); });
      const here = new Set(entities(world).map((e) => (e.kind === 'chest' ? 'chest' : e.def.id)));
      const target = needs.map((id) => (ITEM_BY_ID[id].rare ? 'chest' : id)).find((id) => here.has(id));
      // room: sell what nobody on the board needs, or throw the cheapest back
      while (storageUsed(p) >= storageCap(p)) {
        const spare = Object.keys(p.storage).filter((id) => !needs.includes(id)).sort((a, b) => ITEM_BY_ID[a].value - ITEM_BY_ID[b].value)[0] || Object.keys(p.storage)[0];
        const got = sell ? sellToPlayers(p, day, spare, 1) : 0;
        if (got) o.soldCoins += playerBid(spare, day); else { p.storage[spare] -= 1; if (!p.storage[spare]) delete p.storage[spare]; o.thrownBack++; }
      }
      if (!target) { step(world, p, DT); world.events.length = 0; continue; }     // wait for the right fish
      if (p.bait < 1) { buyBait(p, 10); o.bait += 10 * BAIT.price; }
      bot = botFor(target);
    }
    if (bot && bot(world, p, DT)) o.casts++;
    step(world, p, DT);
    for (const ev of world.events.splice(0)) {
      if (ev.type === 'hooked' && ev.kind === 'junk') release(world);
      if (ev.type === 'snapped') o.lost++;
    }
  }
  o.bait -= p.bait * BAIT.price;      // bait still in the box was not used
  return o;
}
const giveAllOne = (p, day, frac, i, id) => giveToQuest(p, day, frac, i, id);

if (import.meta.url === `file://${process.argv[1]}`) {
  const players = [['quick', 0.15], ['average', 0.28], ['slow', 0.42]];
  // two days for each chest item
  const byRare = { pearl: [], goldbar: [], crown: [] };
  for (let d = 1; Object.values(byRare).some((l) => l.length < 2); d++) { const r = questsFor(d)[0].needs[2].id; if (byRare[r].length < 2) byRare[r].push(d); }
  const days = Object.values(byRare).flat();
  console.log(`bait ${BAIT.price} coins, 1 NEAR = ${MONEY.coinsPerNear} coins. A ticket is sized for about ${QUEST.budget} throws (${QUEST.budget * BAIT.price} coins).`);
  console.log('\ncoins of bait for one ticket and minutes for one ticket, by what the quest asks from the chest:');
  const cells = [];
  for (const [rare, ds] of Object.entries(byRare)) {
    console.log(`  ${rare} days, e.g. ${questsFor(ds[0])[0].needs.map((n) => `${n.n} ${n.id}`).join(' + ')} -> ${questsFor(ds[0])[0].tickets} ticket(s)`);
    for (const [label, lag] of players) {
      const r = ds.map((day) => ticketCost({ lag, day, minutes: 90 })), tk = r.reduce((a, x) => a + x.tickets, 0);
      const c = { rare, label, coins: r.reduce((a, x) => a + x.bait, 0) / Math.max(1, tk), min: r.reduce((a, x) => a + x.minutes, 0) / Math.max(1, tk), tk };
      cells.push(c);
      console.log('   ', label.padEnd(8), `${c.coins.toFixed(0)} coins`.padStart(10), `${c.min.toFixed(1)} min`.padStart(9), `  (${tk} tickets in ${ds.length * 90} min)`);
    }
  }
  const avgOf = (label) => { const l = cells.filter((c) => c.label === label); return l.reduce((a, c) => a + c.coins, 0) / l.length; };
  console.log(`  over all days: quick ${avgOf('quick').toFixed(0)}, average ${avgOf('average').toFixed(0)}, slow ${avgOf('slow').toFixed(0)} coins. A slow player pays ${(avgOf('slow') / avgOf('quick')).toFixed(2)}x what a quick one pays`);
  console.log('\nwhat the upgrades change for an average player:');
  for (const [label, o] of [['no upgrades', {}], ['best reel', { reel: 4 }], ['best storage', { storage: 4 }], ['both', { reel: 4, storage: 4 }]]) {
    const f = days.map((day) => ticketCost({ lag: 0.28, day, minutes: 60, ...o })), tk = f.reduce((a, x) => a + x.tickets, 0);
    console.log(' ', label.padEnd(14), `${(f.reduce((a, x) => a + x.bait, 0) / tk).toFixed(0)} coins per ticket, ${(f.reduce((a, x) => a + x.minutes, 0) / tk).toFixed(1)} min per ticket, thrown back ${f.reduce((a, x) => a + x.thrownBack, 0)}`);
  }
  const all = Object.values(UPGRADES).reduce((a, u) => a + u.costs.reduce((x, y) => x + y, 0), 0);
  console.log(`  all upgrades cost ${all} coins = ${(all / MONEY.coinsPerNear).toFixed(1)} NEAR`);
  const avgPrize = (DRAW.prize[0] + DRAW.prize[1]) / 2, avgOthers = (DRAW.othersTickets[0] + DRAW.othersTickets[1]) / 2;
  const coins = avgOf('average');
  console.log(`\nthe draw (demo numbers): prize about ${avgPrize} NEAR a day, about ${avgOthers} tickets in it.`);
  console.log(`  one ticket wins ${(100 * winChance(avgOthers)).toFixed(0)}% of the time and then pays ${(avgPrize / DRAW.winners).toFixed(2)} NEAR: worth ${(winChance(avgOthers) * avgPrize / DRAW.winners).toFixed(2)} NEAR on average.`);
  console.log(`  an average player pays ${(coins / MONEY.coinsPerNear).toFixed(2)} NEAR of bait for it. So a ticket returns ${(100 * winChance(avgOthers) * avgPrize / DRAW.winners / (coins / MONEY.coinsPerNear)).toFixed(0)}% of its cost.`);
}
