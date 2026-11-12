// The records of test/replay.mjs played again in another JavaScript engine (Safari's, from the command line):
//   node test/replay.mjs export && jsc -m test/replay-other-engine.mjs
import { recheck } from './replay.mjs';
import checks from './replay-log.mjs';
const r = recheck(checks);
(typeof print === 'function' ? print : console.log)(r.wrong === 0 ? `all ${checks.length} records came out the same in this engine` : `${r.wrong} of ${checks.length} records came out different`);
