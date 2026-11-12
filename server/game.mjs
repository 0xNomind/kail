// Kail's server. It has two jobs, and holds one key that may do only these two things on the contract:
//   1. landing a catch: a player's game hands in what the player's hands did; the server plays those moves
//      again in the same sea, sees for itself what came up, and tells the contract (`land`);
//   2. holding the draw of every day that is over (`settle_draw`).
// It keeps nothing itself. What it needs to know is read from the contract, or comes back from the game with
// the server's own signature on it (a player's sea, see "the sea" below).
// Written in the shape of a Cloudflare Worker (`fetch` and `scheduled`). `serve.mjs` runs the same code on
// this machine.
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from 'near-api-js';
import { TICKS_PER_SECOND, REST_TICKS, MAX_TICKS, MAX_MOVES, rerun, writeSea } from '../src/replay.js';

// Public nodes of NEAR. They are free and shared, so now and then one is slow or says no: then the next is asked.
const NODES = {
  testnet: ['https://test.rpc.fastnear.com', 'https://rpc.testnet.fastnear.com', 'https://near-testnet.drpc.org'],
  mainnet: ['https://free.rpc.fastnear.com', 'https://near.drpc.org'],
};
// (The computer's boats land their catches through this server too, with the same key. Sending theirs by other
// nodes than the players' was tried and lost players' catches: a node that had not yet seen the last transaction
// handed out a number that was already used, "InvalidNonce". One key, one line, one list of nodes.)
const TGAS = 1_000_000_000_000n;
// A throw is counted from the moment the chain saw it, which is a few seconds after the hook went in; and the
// game's clock and this one are never quite the same. So much slack is given, no more.
const GRACE_MS = 5000;
const MAX_BODY = 96 * 1024;

// ---- the chain
let chain = null;
function connect(env) {
  if (chain && chain.key === env.NEAR_KEY) return chain;
  const urls = env.NEAR_RPC ? [env.NEAR_RPC] : NODES[env.NEAR_NETWORK || 'testnet'];
  const provider = new FailoverRpcProvider(urls.map((url) => new JsonRpcProvider({ url })));
  const account = new Account(env.NEAR_ACCOUNT, provider, new KeyPairSigner(KeyPair.fromString(env.NEAR_KEY)));
  chain = { key: env.NEAR_KEY, provider, account, contract: env.NEAR_CONTRACT, busy: Promise.resolve() };
  return chain;
}
const view = (c, method, args = {}) => c.provider.callFunction({ contractId: c.contract, method, args });
// the hash of the transaction the last call ran in
let lastHash = null;
// One key signs one transaction at a time (each needs the next number in a row), so calls wait their turn.
function call(c, method, args, gas = 30n * TGAS) {
  const run = async () => {
    const r = await c.account.signAndSendTransaction({ receiverId: c.contract, actions: [actions.functionCall(method, args, gas, 0n)] });
    const value = r?.status?.SuccessValue;
    lastHash = r?.transaction?.hash || r?.transaction_outcome?.id || null;
    return value ? JSON.parse(atob(value)) : null;
  };
  const turn = c.busy.then(run, run);
  c.busy = turn.catch(() => {});
  return turn;
}
// what the contract said when it refused, without the wrapping
const reason = (e) => {
  const text = String(e?.message || e);
  const m = text.match(/Smart contract panicked: ([^"\\]+)/) || text.match(/panicked[^:]*: ([^"\\]+)/);
  return (m ? m[1] : text).slice(0, 200);
};

// ---- answers
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
});

// ---- the sea
// Every player fishes in a sea of their own, and the server decides what swims in it: a new sea is grown from a
// number only the server can work out (from the account, its count of casts and its last catch). The game
// plays in that sea and writes down the player's moves. To have a catch landed it hands the moves in; the
// server plays them again and sees what really came up.
//
// The server remembers nothing between two requests. Instead it hands the game a "ticket" for its sea: the sea
// written down, signed. The game brings the ticket back with its next moves. What a ticket says:
//   a     the account                c    how many casts the sea has seen (the chain counts them too)
//   r     the mark the contract holds for this account's sea: it changes with every catch landed, so a
//         ticket from before a catch is worth nothing afterwards (that fish cannot be caught twice)
//   t0,n  when this line of seas began (server clock) and how many steps it has been played since: the sea
//         can never have been played for longer than the time that has really passed
//   reel, top   the reel level now, and the best one claimed since the chain was last asked
//   back  how many steps ago the hook came back to the boat
//   seed  or  sea    a new sea's number, or a sea written down
const enc = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
let signer = null;
async function seaKey(env) {
  if (signer && signer.of === env.NEAR_KEY) return signer.key;
  // a key of its own when one is set; otherwise one worked out from the server's NEAR key (never the key itself)
  const raw = env.SEA_KEY ? enc.encode(env.SEA_KEY) : await crypto.subtle.digest('SHA-256', enc.encode(`kail sea ${env.NEAR_KEY}`));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  signer = { of: env.NEAR_KEY, key };
  return key;
}
async function ticket(env, says) {
  const body = JSON.stringify(says);
  return { body, sig: b64(await crypto.subtle.sign('HMAC', await seaKey(env), enc.encode(body))) };
}
// Gives what a ticket says, or nothing when it is not one of ours.
async function readTicket(env, t) {
  if (!t || typeof t.body !== 'string' || typeof t.sig !== 'string' || t.body.length > 16000 || t.sig.length > 64) return null;
  let sig;
  try { sig = Uint8Array.from(atob(t.sig), (ch) => ch.charCodeAt(0)); } catch { return null; }
  if (!(await crypto.subtle.verify('HMAC', await seaKey(env), sig, enc.encode(t.body)))) return null;
  return JSON.parse(t.body);
}
const startOf = (says) => (says.sea ? { sea: says.sea, back: says.back } : { seed: says.seed, back: says.back });
const goodAccount = (a) => typeof a === 'string' && a.length <= 64 && /^[a-z0-9._-]+$/.test(a);
async function body(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { return JSON.parse(text); } catch { return null; }
}
// the moves of a record, played again; gives { error } when no game could have written them
function replay(says, ticks, moves) {
  if (!Number.isInteger(ticks) || ticks < 0 || ticks > MAX_TICKS || !Array.isArray(moves) || moves.length > MAX_MOVES) return { error: 'That record is too long' };
  try { return rerun(startOf(says), ticks, moves, says.reel); } catch (e) { return { error: String(e.message) }; }
}
// has the sea been played for longer than the time that really passed? (milliseconds too many, or 0)
const tooFast = (says, ticks, now) => Math.max(0, Math.ceil(((says.n + ticks) / TICKS_PER_SECOND) * 1000 - (now - says.t0) - GRACE_MS));

// A new sea for an account: at the start of a sitting, or when the game and the chain have lost step.
async function newSea(request, env) {
  const now = Date.now(), { account } = (await body(request)) || {};
  if (!goodAccount(account)) return json({ error: 'No such account' }, 400);
  const c = connect(env);
  const player = await view(c, 'player', { account_id: account });
  // the same account with the same casts and the same last catch always gets the same sea: asking again
  // is not a way to look for a better one
  const grown = await crypto.subtle.sign('HMAC', await seaKey(env), enc.encode(`seed ${account} ${player.casts} ${player.sea || ''}`));
  const seed = new DataView(grown).getUint32(0);
  return json({ ticket: await ticket(env, { v: 1, a: account, c: Number(player.casts), r: player.sea || '', t0: now, n: 0, reel: player.reel, top: player.reel, back: -REST_TICKS, seed }), seed, reel: player.reel });
}

// Nothing caught for a while: the game hands in its moves anyway and gets a ticket for the sea as it is now,
// so that no record ever grows long. The chain is not asked: what this ticket claims is checked with the next catch.
async function keepSea(request, env) {
  const now = Date.now(), { ticket: t, ticks, moves } = (await body(request)) || {};
  const says = await readTicket(env, t);
  if (!says) return json({ error: 'That is not a ticket of this server', stale: true }, 409);
  const late = tooFast(says, ticks, now);
  if (late) return json({ error: 'Too soon', retry_in_ms: late }, 425);
  const got = replay(says, ticks, moves);
  if (got.error) return json({ error: got.error, stale: true }, 409);
  if (!got.idle) return json({ error: 'The hook is still out' }, 409);
  return json({ ticket: await ticket(env, { ...says, seed: undefined, c: says.c + got.throws, n: says.n + ticks, reel: got.reel, top: Math.max(says.top, got.topReel), back: got.back, sea: writeSea(got.world) }) });
}

// A catch: the game hands in the moves since its ticket. Answers with what went into storage (for a chest:
// what was inside; nothing when the storage was full) and a ticket for the sea as it is now.
// `stale: true` tells the game that its sea is of no use any more and it has to ask for a new one.
async function land(request, env) {
  const now = Date.now(), { account, cast, secret, ticket: t, ticks, moves } = (await body(request)) || {};
  if (!goodAccount(account)) return json({ error: 'No such account' }, 400);
  if (!/^\d{1,20}$/.test(String(cast))) return json({ error: 'No such cast' }, 400);
  if (typeof secret !== 'string' || secret.length > 200) return json({ error: 'The secret of the cast is missing' }, 400);
  const says = await readTicket(env, t);
  if (!says || says.a !== account) return json({ error: 'That is not a ticket for this sea', stale: true }, 409);

  const c = connect(env);
  const player = await view(c, 'player', { account_id: account });
  if (player.open_cast !== String(cast)) return json({ error: 'That cast is not in the water' }, 409);
  if ((player.sea || '') !== says.r) return json({ error: 'This sea is from before your last catch', stale: true }, 409);

  const got = replay(says, ticks, moves);
  if (got.error) return json({ error: got.error, stale: true }, 409);
  // every throw in the record is a cast on the chain, and the last of them is the one being landed
  if (says.c + got.throws !== Number(cast)) return json({ error: 'The throws here and the casts on the chain do not match', stale: true }, 409);
  if (!got.caught || got.caught.tick !== ticks - 1 || !got.idle) return json({ error: 'Played again, that throw brought nothing up', stale: true }, 409);
  if (Math.max(says.top, got.topReel) > player.reel) return json({ error: 'That reel is better than the one you have', stale: true }, 409);
  // time: the whole sea, and this throw since the chain saw its cast
  const flight = Math.ceil(((ticks - got.lastThrow) / TICKS_PER_SECOND) * 1000 - (now - Number(player.cast_at)) - GRACE_MS);
  const late = Math.max(tooFast(says, ticks, now), flight);
  if (late > 0) return json({ error: 'Too soon for that catch', retry_in_ms: late }, 425);

  const mark = b64(crypto.getRandomValues(new Uint8Array(12)));
  let landed;
  try { landed = await call(c, 'land', { player: account, cast: String(cast), what: got.caught.what, secret, sea: mark }); }
  catch (e) { return json({ error: reason(e) }, 409); }
  // the kind that went into storage, or null when the storage was full; and the transaction that put it there
  return json({ landed, what: got.caught.what, tx: lastHash,
    ticket: await ticket(env, { v: 1, a: account, c: Number(cast), r: mark, t0: says.t0, n: says.n + ticks, reel: got.reel, top: got.reel, back: got.back, sea: writeSea(got.world) }) });
}

// Hold the draw of the days that are over and have tickets in them (the last three, in case a run was missed).
export async function holdDraws(env) {
  const c = connect(env);
  const today = BigInt((await view(c, 'draw')).day);
  const held = [];
  for (let back = 3n; back >= 1n; back--) {
    const day = today - back;
    if (day < 0n) continue;
    const d = await view(c, 'draw', { day: String(day) });
    if (d.settled || d.tickets === '0') continue;
    try {
      const winners = await call(c, 'settle_draw', { day: String(day) }, 300n * TGAS), tx = lastHash;
      // the contract cannot know the hash of its own transaction: tell it, so the Harbour can link to the draw
      if (tx) await call(c, 'settle_draw', { day: String(day), tx }).catch(() => {});
      held.push({ day: String(day), winners, tx });
    } catch (e) { held.push({ day: String(day), error: reason(e) }); }
  }
  return held;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, GET' } });
    if (!env.NEAR_KEY || !env.NEAR_ACCOUNT || !env.NEAR_CONTRACT) return json({ error: 'The server has no key yet (server/.dev.vars)' }, 503);
    try {
      if (url.pathname === '/api/land' && request.method === 'POST') return await land(request, env);
      if (url.pathname === '/api/sea' && request.method === 'POST') return await newSea(request, env);
      if (url.pathname === '/api/sea/keep' && request.method === 'POST') return await keepSea(request, env);
      if (url.pathname === '/api/status') return json({ network: env.NEAR_NETWORK || 'testnet', contract: env.NEAR_CONTRACT, account: env.NEAR_ACCOUNT });
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: reason(e) }, 502);
    }
  },
  // Cloudflare calls this on the schedule set for the Worker
  async scheduled(_event, env) {
    await holdDraws(env);
  },
};
