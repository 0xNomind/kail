// What does the Reel upgrade buy? Bait per ticket, minutes per ticket and catches lost, at each reel level.
// node test/reel.mjs
import { UPGRADES } from '../src/config.js';
import { ticketCost } from './economy.mjs';

const days = [2, 4, 8];        // a pearl day, a gold bar day, a pearl day
for (const [label, lag] of [['average', 0.28], ['slow', 0.42]]) {
  for (const reel of [0, 2, 4]) {
    const r = days.map((day) => ticketCost({ lag, day, minutes: 40, reel })), tk = r.reduce((a, x) => a + x.tickets, 0);
    console.log(label.padEnd(8), `reel level ${reel + 1} (${UPGRADES.reel.values[reel]}x)`.padEnd(22),
      `${(r.reduce((a, x) => a + x.bait, 0) / Math.max(1, tk)).toFixed(0)} coins per ticket`.padStart(22),
      `${(r.reduce((a, x) => a + x.minutes, 0) / Math.max(1, tk)).toFixed(1)} min per ticket`.padStart(20),
      `${(100 * r.reduce((a, x) => a + x.lost, 0) / r.reduce((a, x) => a + x.casts, 0)).toFixed(0)}% of throws lost a catch`.padStart(30));
  }
}
