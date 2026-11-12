// Shows how a robot player does with the current numbers.
// node test/tune.mjs            (reaction time 0.18 s)
// node test/tune.mjs lag=0.3    (a slower player)
import { HOOK, UPGRADES, BAIT, FISH_BY_ID } from '../src/config.js';
import { play, sum, tierOf } from './bot.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
for (const k of ['sinkSpeed', 'steerSpeed', 'throwSpeed']) if (args[k]) HOOK[k] = +args[k];
const lag = +(args.lag ?? 0.18);
console.log(`sink ${HOOK.sinkSpeed}, steer ${HOOK.steerSpeed}, reaction ${lag}s, bait costs ${BAIT.price}. "value" = plain price.`);
const cases = [[0, 1, false], [0, 2, false], [0, 3, false], [2, 3, false], [4, 3, false], [0, 4, false], [0, 0, true], [2, 0, true], [4, 0, true]];
for (const [reel, wantTier, wantChest] of cases) {
  const o = sum([1, 2, 3].map((seed) => play({ seed, minutes: 15, reel, wantTier, wantChest, lag })));
  const want = Object.entries(o.by).filter(([k]) => (wantChest ? tierOf(k) === 5 : tierOf(k) >= wantTier && tierOf(k) < 5)).reduce((a, [, v]) => a + v, 0);
  console.log(`reel x${String(UPGRADES.reel.values[reel]).padEnd(3)} wants ${wantChest ? 'chest  ' : `tier ${wantTier}+`}`,
    `casts/min ${(o.casts / o.minutes).toFixed(1).padStart(4)}`, `wanted ${(100 * want / Math.max(1, o.casts)).toFixed(0).padStart(3)}%`,
    `other ${(100 * (o.got - want) / Math.max(1, o.casts)).toFixed(0).padStart(3)}%`, `junk ${(100 * o.junk / Math.max(1, o.casts)).toFixed(0).padStart(2)}%`,
    `nothing ${(100 * o.miss / Math.max(1, o.casts)).toFixed(0).padStart(3)}%`,
    `value/cast ${(o.value / Math.max(1, o.casts)).toFixed(1).padStart(6)}`, `value/min ${(o.value / o.minutes).toFixed(0).padStart(4)}`,
    ' ', Object.entries(o.by).sort((a, b) => tierOf(a[0]) - tierOf(b[0])).map(([k, v]) => `${k}:${v}`).join(' '));
}
