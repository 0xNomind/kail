// Checks what the README says against the chain, read-only: no key, no wallet, no sign-in, nothing is changed.
//
//   npm run verify                              the contract and the computer's boats, on NEAR testnet
//   npm run verify -- --server <address>        also a running game server (the hosted one, or http://localhost:3000)
//   npm run verify -- --json                    the same as JSON, for a program to read
//
// Every line is one claim, how it was checked, and what was found. It ends with a count and exits with 1 if a
// claim did not hold. A claim that needs something this machine does not have is marked SKIP, with the reason.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NET, NETWORK } from '../src/network.js';
import { questOf, priceFor } from '../src/model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), asJson = args.includes('--json');
const server = (args[args.indexOf('--server') + 1] && args.includes('--server') ? args[args.indexOf('--server') + 1] : process.env.KAIL_SERVER || '').replace(/\/$/, '');
const CONTRACT = NET.contract, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (yocto) => `${(Number(BigInt(yocto) / 10n ** 18n) / 1e6).toString()} NEAR`;

// ---- asking the chain: the public nodes in turn, a little patience when one says "too many"
async function rpc(method, params) {
  let last = null;
  for (let round = 0; round < 3; round++) {
    for (const url of NET.nodes) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
        const j = await r.json();
        if (j.error && /rate|limit|429/i.test(JSON.stringify(j.error))) { last = new Error('the node said: too many requests'); continue; }
        return j;
      } catch (e) { last = e; }
    }
    await sleep(1500);
  }
  throw last;
}
async function view(method, a = {}) {
  const j = await rpc('query', { request_type: 'call_function', finality: 'optimistic', account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') });
  if (!j.result?.result) throw new Error(`${method}: ${JSON.stringify(j.error || j.result).slice(0, 160)}`);
  return JSON.parse(Buffer.from(j.result.result).toString());
}
const account = async (id) => (await rpc('query', { request_type: 'view_account', finality: 'optimistic', account_id: id })).result || null;

// ---- the list of claims
const lines = [];
const say = (status, claim, found) => { lines.push({ status, claim, found }); if (!asJson) console.log(`${status.padEnd(4)}  ${claim}\n      ${found}`); };
async function check(claim, work) {
  try { const r = await work(); say(r?.skip ? 'SKIP' : r?.fail ? 'FAIL' : 'PASS', claim, r?.skip || r?.fail || r); }
  catch (e) { say('FAIL', claim, `could not be checked: ${String(e?.message || e).slice(0, 200)}`); }
  await sleep(250);
}
if (!asJson) console.log(`Kail on NEAR ${NETWORK}: contract ${CONTRACT}\n`);

let S = null;
await check('The contract is deployed', async () => {
  const a = await account(CONTRACT);
  if (!a || /^1+$/.test(a.code_hash)) return { fail: `${CONTRACT} has no contract code` };
  return `${CONTRACT} holds code ${a.code_hash.slice(0, 12)}…, ${a.storage_usage} bytes of state, ${near(a.amount)}  (${NET.explorer}/address/${CONTRACT})`;
});
await check('Everything a player owns is a token of this one contract (NEP-245 read methods answer)', async () => {
  const [coin, bait, ticket, fish] = [await view('mt_supply', { token_id: 'coin' }), await view('mt_supply', { token_id: 'bait' }), await view('mt_supply', { token_id: 'ticket' }), await view('mt_supply', { token_id: 'anchovy' })];
  const tokens = await view('mt_token', { token_ids: ['coin', 'bait', 'ticket', 'anchovy'] });
  if (!Array.isArray(tokens) || tokens.some((t) => !t)) return { fail: `mt_token did not know every kind: ${JSON.stringify(tokens).slice(0, 120)}` };
  return `mt_supply: ${coin} coins, ${bait} bait, ${ticket} tickets, ${fish} anchovy in existence; mt_token knows coin, bait, ticket, anchovy`;
});
await check('Every kind of token has a name and can be listed (NEP-245 metadata and enumeration)', async () => {
  const about = await view('mt_metadata_contract', {}), all = await view('mt_tokens', {});
  if (about?.spec !== 'mt-1.0.0') return { fail: `mt_metadata_contract gave ${JSON.stringify(about).slice(0, 80)}` };
  if (!Array.isArray(all) || all.length !== 16 || all.some((t) => !t.token_metadata?.title || !t.token_metadata?.description)) return { fail: `mt_tokens gave ${Array.isArray(all) ? all.length : 'no'} kinds, or one without a name` };
  // what is up for sale is held by the contract, and its balance says so
  const orders = await view('ticket_orders', { limit: 100 }), onSale = orders.filter((o) => !o.buying).reduce((a, o) => a + o.amount, 0);
  const held = Number(await view('mt_balance_of', { account_id: CONTRACT, token_id: 'ticket' }));
  if (orders.length < 100 && held < onSale) return { fail: `${onSale} tickets are up for sale but the contract's balance shows ${held}` };
  return `"${about.name}", ${about.spec}: ${all.map((t) => t.token_metadata.title).join(', ')}. The contract's own balance shows the ${onSale} tickets it holds for sellers`;
});
await check("Where NEAR Auth's shared testnet sign-in lets people in (why Google or email sign-in is closed on the hosted address)", async () => {
  const { clientId, onlyAt } = NET.auth || {};
  if (NETWORK !== 'testnet' || !clientId || !onlyAt) return { skip: 'only about the shared sign-in of the test network' };
  // the first step of a sign-in, without signing in: NEAR Auth's server passes it on to its sign-in page (302)
  // when the address to come back to is on the shared client's list, and refuses it (403) when it is not
  const asked = async (back) => {
    const q = new URLSearchParams({ client_id: clientId, response_type: 'code', scope: 'openid', redirect_uri: back, code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256', state: 'x' });
    const r = await fetch(`https://login.testnet.fast-auth.com/authorize?${q}`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    return { status: r.status, said: r.status === 403 && /callback url mismatch/i.test(await r.text()) ? ' "Callback URL mismatch"' : '' };
  };
  let local, hosted, demo;
  try { [local, hosted, demo] = [await asked(onlyAt), await asked(NET.hosted), await asked('https://example.fast-auth.com')]; }
  catch (e) { return { skip: `NEAR Auth's sign-in server did not answer (${String(e?.message || e).slice(0, 80)})` }; }
  const line = `login.testnet.fast-auth.com, shared client: ${onlyAt} ${local.status}${local.said}; NEAR Auth's own demo https://example.fast-auth.com ${demo.status}${demo.said}; ${NET.hosted} ${hosted.status}${hosted.said}`;
  if (local.status !== 302) return { fail: `${line}. It should pass ${onlyAt} on to its sign-in page` };
  return hosted.status === 302 ? `${line}. The hosted address is on the list now: NEAR Auth can be opened there (onlyAt in src/network.js)` : `${line}. So NEAR Auth signs players in at ${onlyAt} only, and the hosted game offers the wallet`;
});
await check('One read gives the quest, the draw, both markets, the vault and the coin price', async () => {
  S = await view('state', { account_id: null });
  const q = S.quest.needs.map(([id, n]) => `${n} ${id}`).join(', ');
  return `today's quest: ${q} for ${S.quest.tickets} ticket; vault ${near(S.vault)}; a day lasts ${Math.round(Number(S.day_ms) / 60000)} minutes here`;
});
await check('A draw takes at most 500 tickets, 10 per account', async () => (S.draw.cap === 500 && S.draw.per_player === 10 ? `today's draw: cap ${S.draw.cap}, per account ${S.draw.per_player}, ${S.draw.tickets} tickets in, prize ${near(S.draw.pool)}` : { fail: `cap ${S.draw.cap}, per account ${S.draw.per_player}` }));
await check("The price of a coin is worked out from the day's prize: prize / (500 tickets x 44 coins), rounded up; more when the vault has grown since", async () => {
  if (!S.draw.fixed) return { skip: "today's prize is not set aside yet (nothing touched the contract today), so today's price cannot be compared" };
  const step = 10n ** 18n, low = 10n ** 19n, raw = BigInt(S.draw.pool) / (500n * 44n), up = ((raw + step - 1n) / step) * step, set = up < low ? low : up;
  // the vault may have grown since the day began (top-ups, NEAR added): then a coin costs as much more as the prize would be bigger
  const prize = BigInt(S.draw.pool), now = BigInt(S.vault) / 5n;
  const expected = now <= prize ? set : prize < step ? (((now / (500n * 44n) + step - 1n) / step) * step > set ? ((now / (500n * 44n) + step - 1n) / step) * step : set) : (((set / step) * (now / step) + prize / step - 1n) / (prize / step)) * step;
  return BigInt(S.coin_price) === expected ? `prize ${near(S.draw.pool)} gives ${near(set)} a coin${expected > set ? `; the vault has grown to ${near(S.vault)} since, so now ${near(expected)}` : ''}, and the contract says ${near(S.coin_price)}` : { fail: `expected ${expected}, the contract says ${S.coin_price}` };
});
await check('The week played fast (npm run simulate) uses the contract\'s own rules: its quest and its coin price are the chain\'s', async () => {
  const mine = JSON.stringify(questOf(S.quest.day).needs), theirs = JSON.stringify(S.quest.needs);
  if (mine !== theirs) return { fail: `for day ${S.quest.day} the model says ${mine}, the contract ${theirs}` };
  if (!S.draw.fixed) return `quest of day ${S.quest.day}: both say ${theirs} (today's prize is not set aside yet, so the coin price was not compared)`;
  const price = priceFor(BigInt(S.draw.pool));
  // (when the vault has grown since the day began a coin costs more than the day's own price: the check above covers that)
  if (BigInt(S.vault) / 5n > BigInt(S.draw.pool)) return `quest of day ${S.quest.day}: both say ${theirs}; coin price for today's prize: the model says ${near(price)} (the vault has grown since, so the contract asks ${near(S.coin_price)} now)`;
  return price === BigInt(S.coin_price) ? `quest of day ${S.quest.day}: both say ${theirs}; coin price for today's prize: both say ${near(price)}` : { fail: `coin price: the model says ${price}, the contract ${S.coin_price}` };
});
await check('Draws are held on the chain; one ticket in five wins; each is kept with the transaction that held it', async () => {
  const past = S.past_draws.filter((d) => d.settled);
  if (!past.length) return { skip: 'no draw with tickets in it has been held yet' };
  const wrong = past.filter((d) => { const t = Number(d.tickets), w = d.winners; return !(w === Math.floor(t / 5) || w === Math.floor(t / 5) + 1) || w > 100; });
  if (wrong.length) return { fail: `winners do not fit the rule in ${wrong.length} draws: ${JSON.stringify(wrong[0])}` };
  const d = past.find((x) => x.tx) || past[0];
  let onChain = 'no transaction recorded for it';
  if (d.tx) { const t = await rpc('tx', { tx_hash: d.tx, sender_account_id: CONTRACT, wait_until: 'EXECUTED_OPTIMISTIC' }); onChain = t.result?.status?.SuccessValue != null ? `its transaction succeeded: ${NET.explorer}/txns/${d.tx}` : `its transaction ${d.tx} could not be read`; }
  return `${past.length} earlier draws kept; the latest had ${d.tickets} tickets, ${d.winners} won ${near(d.prize_each)} each; ${onChain}`;
});
await check('A helper account (the greeter) may give a new account its 5 bait', async () => {
  const g = await view('greeter');
  if (!g) return { fail: 'no greeter is named' };
  const a = await account(g);
  return a ? `greeter is ${g}, an account with ${near(a.amount)}` : { fail: `greeter ${g} is not on the chain` };
});

// ---- the computer's boats: named (without keys) in server/wrangler.toml
const named = (fs.readFileSync(path.join(root, 'server/wrangler.toml'), 'utf8').match(/^NPCS\s*=\s*"([^"]*)"/m) || [])[1] || '';
const boats = named.split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.split('='));
await check(`The computer's boats are ordinary accounts with their own NEAR, coins and fish (${boats.length} named in server/wrangler.toml)`, async () => {
  if (!boats.length) return { fail: 'no boats are named' };
  const rows = [];
  for (const [id, name] of boats) {
    const a = await account(id); await sleep(150);
    if (!a) { rows.push(`${name}: ${id} is NOT on the chain`); continue; }
    const p = await view('player', { account_id: id }); await sleep(150);
    rows.push(`${name} (${id}): ${near(a.amount)}, ${p.coins} coins, ${p.bait} bait, ${p.tickets} tickets, ${p.items.reduce((n, [, k]) => n + Number(k), 0)} fish and finds, ${p.casts} casts so far`);
  }
  const missing = rows.filter((r) => r.includes('NOT on the chain')).length, fished = rows.filter((r) => !/ 0 casts so far/.test(r)).length - missing;
  const text = rows.join('\n      ');
  return missing || fished < Math.ceil(boats.length / 2) ? { fail: `${missing} missing, ${fished} have fished\n      ${text}` } : `${fished} of ${boats.length} have thrown the hook\n      ${text}`;
});
await check('The boats trade on the same markets as players', async () => {
  const ids = new Set(boats.map(([id]) => id)), items = S.orders.filter((o) => ids.has(o.account)), tickets = S.ticket_orders.filter((o) => ids.has(o.account));
  const sales = (S.ticket_trades || []).filter((t) => ids.has(t.seller) || ids.has(t.buyer)).length;
  if (!items.length && !tickets.length && !sales) return { fail: 'no order and no sale by a boat is on the contract right now' };
  const one = items[0] ? `e.g. order ${items[0].id}: ${items[0].account} ${items[0].buying ? 'wants' : 'sells'} ${items[0].amount} ${items[0].token_id} at ${items[0].price} coins` : '';
  return `${items.length} of ${S.orders.length} fish orders and ${tickets.length} of ${S.ticket_orders.length} ticket orders are theirs; ${sales} of the last ${(S.ticket_trades || []).length} ticket sales involved a boat. ${one}`;
});

await check('A player lands their own catch and pays its fee; the contract takes it only with the server\'s signature', async () => {
  const key = await view('server_key');
  if (!key || Buffer.from(key, 'base64').length !== 32) return { fail: 'the contract has no server key named: only the server\'s own account could land a catch' };
  const minter = await view('minter');
  // the last catches on the chain: who sent them? (from a public explorer; left out when it does not answer)
  let seen = '';
  try {
    const list = (await (await fetch(`https://api${NETWORK === 'mainnet' ? '' : '-testnet'}.nearblocks.io/v3/accounts/${CONTRACT}/txns?limit=100`, { signal: AbortSignal.timeout(10_000) })).json()).data || [];
    const lands = list.filter((t) => t.actions?.[0]?.method === 'land'), own = lands.filter((t) => t.signer_account_id !== minter);
    if (lands.length) seen = ` Of the last ${lands.length} catches on the chain, ${own.length} were sent by the player's own account${own[0] ? `, e.g. ${own[0].signer_account_id} in ${own[0].transaction_hash}` : ''}.`;
  } catch { /* the explorer did not answer: the claim stands on the key and the contract's tests */ }
  return `the contract checks a catch against the server's key ${key.slice(0, 12)}… (contract/src/game.rs, land; refusals in npm run test:contract).${seen}`;
});
await check('The server signs as an account of its own: the account with the prize vault pays no fees', async () => {
  const minter = await view('minter');
  if (minter === CONTRACT) return { fail: `the contract's server is the contract's own account (${CONTRACT}): its fees come out of the account that holds the vault (npm run server-account)` };
  const j = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: minter });
  if (j.result?.amount == null) return { fail: `the contract names ${minter} as its server, and there is no such account` };
  return `the contract's server is ${minter}; it holds ${Number(BigInt(j.result.amount) / 10n ** 21n) / 1000} NEAR, and the vault pays it back what each draw costs (contract/src/draw.rs, repay_the_draw)`;
});

// ---- a running game server, if one is named
const ask = async (address, init) => { const r = await fetch(server + address, { signal: AbortSignal.timeout(20_000), ...init }); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = (address, body) => ask(address, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const noServer = { skip: 'no server named: pass --server <address> (the hosted game, or http://localhost:3000 with npm start running)' };
await check('The game server is up and plays on this contract', async () => {
  if (!server) return noServer;
  const a = await ask('/api/status');
  if (a.status === 503) return { skip: `${server} runs without a server key (the pages work, catches cannot be landed there)` };
  if (a.status !== 200 || a.body?.contract !== CONTRACT) return { fail: `${a.status} ${JSON.stringify(a.body).slice(0, 120)}` };
  const minter = await view('minter');
  if (a.body.account !== minter) return { fail: `that server signs as ${a.body.account}, but the contract's server is ${minter}` };
  // a catch reaches the contract with the server's approval: the contract must know the key that server signs with
  const known = await view('server_key');
  if (a.body.approves_with !== known) return { fail: `that server signs its approvals of catches with a key the contract does not know (${String(a.body.approves_with).slice(0, 12)}… against ${String(known).slice(0, 12)}…): players could not land a catch` };
  if (a.body.near != null && a.body.near < 0.5) return { fail: `the server's account ${a.body.account} is down to ${a.body.near} NEAR: catches will stop being landed` };
  return `${server}/api/status: ${JSON.stringify(a.body)}`;
});
await check('The server decides the sea: it hands out a seed with a ticket it signed', async () => {
  if (!server) return noServer;
  const a = await post('/api/sea', { account: boats[0]?.[0] || CONTRACT });
  if (a.status === 503) return { skip: 'that server has no key' };
  return a.status === 200 && a.body?.ticket && Number.isInteger(a.body.seed) ? `/api/sea gave seed ${a.body.seed} and a signed ticket of ${JSON.stringify(a.body.ticket).length} characters` : { fail: `${a.status} ${JSON.stringify(a.body).slice(0, 120)}` };
});
await check('A catch that was not played is refused', async () => {
  if (!server) return noServer;
  const a = await post('/api/land', { account: boats[0]?.[0] || CONTRACT, cast: '1', secret: 'bm90IGEgc2VjcmV0', ticket: { body: '{}', sig: 'x' }, ticks: 10, moves: [] });
  if (a.status === 503) return { skip: 'that server has no key' };
  return a.status >= 400 && a.status < 500 ? `/api/land with a made-up ticket: ${a.status} "${a.body?.error}"` : { fail: `a made-up catch was answered with ${a.status} ${JSON.stringify(a.body).slice(0, 100)}` };
});
await check("The server's settings and code are not handed out as files", async () => {
  if (!server) return noServer;
  const got = [];
  for (const p of ['/server/.dev.vars', '/serve.mjs', '/package.json']) got.push(`${p} ${(await fetch(server + p, { signal: AbortSignal.timeout(15_000) })).status}`);
  return got.every((g) => g.endsWith('404')) ? got.join(', ') : { fail: got.join(', ') };
});
await check('The server tells the game which accounts are computer boats', async () => {
  if (!server) return noServer;
  const a = await ask('/api/npcs');
  if (a.status !== 200 || !Array.isArray(a.body)) return { fail: `${a.status}` };
  if (!a.body.length) return { skip: 'that server runs no boats and names none (a local copy without keys does not)' };
  const live = a.body.filter((b) => b.doing).length;
  return `${a.body.length} boats named${live ? `; ${live} report what they are doing, e.g. ${a.body.find((b) => b.doing).name}: "${a.body.find((b) => b.doing).why}"` : ' (no runner is reporting what they do right now)'}`;
});

const count = (s) => lines.filter((l) => l.status === s).length;
if (asJson) console.log(JSON.stringify({ network: NETWORK, contract: CONTRACT, server: server || null, pass: count('PASS'), fail: count('FAIL'), skip: count('SKIP'), checks: lines }, null, 2));
else console.log(`\n${count('PASS')} held, ${count('FAIL')} did not, ${count('SKIP')} skipped.`);
process.exit(count('FAIL') ? 1 : 0);
