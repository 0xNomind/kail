// One throw of the hook by one account, through a running game server, start to finish: the cast goes to the chain,
// the pull is played here at the pace of the clock, the server is asked to approve the catch (it plays the moves
// again), and the account sends the approved catch to the contract itself. For checking a server by hand, also a
// hosted one:
//
//   node test/throw-once.mjs <account> [server address] [fish wanted]
//   node test/throw-once.mjs kail-welcome.testnet http://localhost:8787 anchovy
//
// The account's key is read from where the NEAR CLI keeps it; it needs a bait and room in storage.
import { throwOnce, signer, spent, BOAT_NODES } from '../server/npc.mjs';
import { FISHERS } from '../src/npc-rules.js';

const [account, server = 'http://localhost:3000', want = 'anchovy'] = process.argv.slice(2);
if (!account) { console.log('usage: node test/throw-once.mjs <account> [server address] [fish wanted]'); process.exit(1); }
const env = { NEAR_NETWORK: 'testnet', NEAR_CONTRACT: 'kail-game.testnet' };
const api = async (path, body) => {
  const r = await fetch(server + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const boat = { account, who: FISHERS[0], call: signer(account, env, BOAT_NODES.testnet), sea: null };
const started = Date.now();
for (let i = 1; i <= 3; i++) {
  const r = await throwOnce(boat, want, api);
  console.log(`throw ${i}: ${r.said} (${Math.round((Date.now() - started) / 1000)} s in all)`);
  if (r.landed) console.log(`the account's own transaction for the catch used ${spent.last.toFixed(1)} Tgas: about ${(spent.last * 0.0001).toFixed(6)} NEAR`);
  if (r.landed || /cast did not reach|not accepted|no sea/.test(r.said)) break;
}
process.exit(0);
