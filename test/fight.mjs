// How often does a catch get away in the pulling game? node test/fight.mjs
// The robot pushes the box toward the icon but sees it late: quick 0.15 s, average 0.28 s, slow 0.42 s.
import { FISH } from '../src/config.js';
import { play, sum } from './bot.mjs';

const players = [['quick', 0.15], ['average', 0.28], ['slow', 0.42]];
const ids = [...FISH.map((f) => f.id), 'chest'];
for (const [label, lag] of players) {
  for (const reel of [0, 4]) {
    const runs = [];
    for (const seed of [1, 2]) {
      for (const wantTier of [1, 2, 3]) runs.push(play({ seed, minutes: 10, reel, wantTier, lag }));
      runs.push(play({ seed, minutes: 10, reel, wantChest: true, lag }));
    }
    const o = sum(runs);
    const line = ids.map((id) => { const h = o.hooked[id] || 0, s = o.snapped[id] || 0; return `${id} ${h ? Math.round((100 * s) / h) : '-'}%`.padEnd(14); }).join('');
    console.log(`${label.padEnd(8)} reel x${[1, 1.3, 1.7, 2.2, 2.8][reel]}`.padEnd(18), 'got away:', line, `value/min ${(o.value / o.minutes).toFixed(0)}`);
  }
}
