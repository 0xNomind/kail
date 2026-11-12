// The computer's boats, run by themselves:  node server/boats.mjs
//
// For when the game is hosted on Cloudflare. A Worker cannot keep ten boats going (it only lives for the length of a
// request), so the boats run here, on any machine that stays up, and play through the hosted game's server like
// players do: they ask it for a sea, sign their own casts and trades with their own keys, and hand their catches
// in to be checked. This machine needs the boats' keys and nothing else: not the game's key, not the helper's.
//
// Settings, from the environment or from server/.dev.vars:
//   KAIL_SERVER    the hosted game's address, e.g. https://kail.example.workers.dev
//   NPCS           the boats: account=Name, separated by commas (their keys: ~/.near-credentials/<network>/<account>.json)
//   BOATS_TOKEN    a password shared with the hosted server, so that it believes this runner when it tells who the
//                  boats are, what each is doing and why (the game shows that beside their orders). Optional.
//   NEAR_NETWORK, NEAR_CONTRACT, NEAR_RPC   as for the server
// One runner at a time: two would sign with the same keys and trip over each other.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startNpcs } from './npc.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = { NEAR_NETWORK: 'testnet', NEAR_CONTRACT: 'kail-game.testnet' };
try {
  for (const line of fs.readFileSync(path.join(here, '.dev.vars'), 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
} catch { /* no settings file: the environment has them */ }
for (const name of ['KAIL_SERVER', 'NPCS', 'BOATS_TOKEN', 'NEAR_NETWORK', 'NEAR_CONTRACT', 'NEAR_RPC']) if (process.env[name]) env[name] = process.env[name];

const server = String(env.KAIL_SERVER || '').replace(/\/$/, '');
if (!server || !env.NPCS) { console.log('Set KAIL_SERVER (the hosted game\'s address) and NPCS (account=Name,…). See the top of server/boats.mjs.'); process.exit(1); }

const post = (address, body, headers = {}) => fetch(server + address, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
const api = async (address, body) => { const r = await post(address, body); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const clock = () => new Date().toISOString().slice(11, 19);
const boats = startNpcs({ env, api, say: (line) => console.log(clock(), line) });
console.log(`${env.NPCS.split(',').length} boats are out, playing through ${server}`);

// The hosted game is told who the boats are, what each is doing and why, every two minutes.
let said = '';
async function tell() {
  if (!env.BOATS_TOKEN) return;
  let now = '';
  try { const r = await post('/api/npcs', boats.status(), { authorization: `Bearer ${env.BOATS_TOKEN}` }); now = r.ok ? '' : `the game's server did not take the boats' news (${r.status})`; }
  catch (e) { now = `could not reach the game's server with the boats' news: ${String(e?.message || e).slice(0, 80)}`; }
  if (now !== said) { said = now; console.log(clock(), now || "the game's server has the boats' news again"); }
}
if (env.BOATS_TOKEN) { setTimeout(tell, 20_000); setInterval(tell, 120_000); } else console.log('(no BOATS_TOKEN: the hosted game will name the boats but not say what they are doing or why)');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { boats.stop(); process.exit(0); });
