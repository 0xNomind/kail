// The game's helper for new players, and for players who sign in with NEAR Auth (Google, Apple, email).
//
// One account of the game's, the "welcome" account, does three small things:
//   open   for a NEAR Auth sign-in: makes the player's account (a named one, kail-….testnet, with the sign-in's
//          key as its key). The player shows the token NEAR Auth gave them; the server checks NEAR Auth's signature
//          on it and works out the key that belongs to that sign-in. No NEAR is put into the account: the player
//          gets their NEAR themselves (on the test network from the public faucet), the game shows how.
//   bait   for any account, however it signed in: has the contract give its 5 bait of welcome, once. The account
//          has to hold a little NEAR first, as it cannot play without.
//   sign   carries a NEAR Auth player's approval (a signed token from NEAR Auth's sign-in window) to NEAR Auth's
//          contract, which checks it on the chain and has the MPC network sign what the player approved.
//          The player pays for it: what they approved has to carry the signing fee (the contract's `relay_fee`,
//          which is owed to this account), or be one of the few kinds that cannot (the game's key, sending NEAR
//          out), of which an account gets a handful a day.
// It cannot sign anything for a player by itself: the contract only signs what the player's own token names.
// All three cost the welcome account a little NEAR in fees, so they are counted and limited.
//
// Which account: WELCOME in the server's settings, and its key in WELCOME_KEY. (On a developer's machine serve.mjs
// reads the key from where the NEAR CLI keeps it, ~/.near-credentials/<network>/<account>.json;
// scripts/welcome-account.mjs makes the account.)
// Nothing here needs Node: it runs the same inside a Cloudflare Worker (server/worker.mjs).
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner, actions, baseDecode, baseEncode, decodeTransaction, encodeTransaction } from 'near-api-js';

// The players' nodes. The computer's boats keep to others (server/npc.mjs), so these are not used up by them.
// (the node the players' browsers ask first is kept for last here)
const NODES = { testnet: ['https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org', 'https://test.rpc.fastnear.com'], mainnet: ['https://free.rpc.fastnear.com', 'https://near.drpc.org'] };
const AUTH_CONTRACT = { testnet: 'fast-auth.testnet', mainnet: 'fast-auth.near' };
// NEAR Auth's sign-in on each network: who issues the tokens, for which client, and the MPC contract that knows
// which key belongs to a sign-in (docs.auth.near.org/resources)
const SIGN_IN = {
  testnet: { issuer: 'https://login.testnet.fast-auth.com/', client: 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl', mpc: 'v1.signer-prod.testnet' },
  mainnet: { issuer: 'https://login.auth.near.org/', client: '', mpc: 'v1.signer' },
};
// bytes and text, with what every JavaScript runtime has
const unb64 = (t) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const text = (bytes) => new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
const b64 = (s) => { const b = new TextEncoder().encode(s); let t = ''; for (const x of b) t += String.fromCharCode(x); return btoa(t); };
const hex = (bytes) => [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
const TGAS = 1_000_000_000_000n;
// A new account gets no NEAR from the game. An account this small needs none to exist (NEAR keeps accounts
// under 770 bytes for free). Should the registrar refuse to make one with nothing in it, the least is put in.
const SEED = 2_000_000_000_000_000_000_000n;      // 0.002 NEAR, only if making it with nothing does not work
// the 5 bait go to an account that holds at least this much NEAR (0.01): one that cannot pay a fee cannot play
const BAIT_NEEDS = 10_000_000_000_000_000_000_000n;
const OPENS_AN_HOUR = 30, BAITS_AN_HOUR = 60, SIGNS_AN_HOUR = 120;
// Approvals that cannot carry the fee (adding the game's key, sending NEAR out): so many per account in a day.
const FREE_A_DAY = 6, UNREAD_AN_HOUR = 20;
// The fee a paid approval has to carry (RELAY_FEE in the settings; the pages' SIGN_FEE in src/network.js): 0.005 NEAR.
const FEE = 5_000_000_000_000_000_000_000n;
// After so many paid approvals the fees waiting in the contract are collected.
const COLLECT_EVERY = 20;

export function makeRelay(env) {
  const network = env.NEAR_NETWORK || 'testnet', id = String(env.WELCOME || '').trim();
  const secret = env.WELCOME_KEY;
  if (!id || !secret) return null;
  const urls = env.NEAR_RPC ? [env.NEAR_RPC] : NODES[network];
  const provider = new FailoverRpcProvider(urls.map((url) => new JsonRpcProvider({ url })));
  const account = new Account(id, provider, new KeyPairSigner(KeyPair.fromString(secret)));
  // one key signs one transaction at a time
  let line = Promise.resolve();
  const ask = async (method, params) => {
    let last = null;
    for (const url of urls) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
        return await r.json();
      } catch (e) { last = e; }
    }
    throw last;
  };
  // Hand a transaction to the chain and look every second whether it is through. (Asking a node to hold the line
  // until it is done looked simpler, but the nodes hang up on a call that takes a few seconds, and the library
  // then waited minutes before asking again: an approval that took 8.5 seconds on the chain took minutes here.)
  async function sendAndWatch(receiverId, list) {
    const signed = await account.createSignedTransaction({ receiverId, actions: list });
    const hash = baseEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', encodeTransaction(signed.transaction))));
    await provider.sendTransactionAsync(signed);
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, i < 3 ? 700 : 1000));
      const j = await ask('tx', { tx_hash: hash, sender_account_id: id, wait_until: 'NONE' }).catch(() => null);
      const status = j?.result?.status;
      if (status && typeof status === 'object' && ('SuccessValue' in status || 'Failure' in status)) return { transaction: { hash }, status };
    }
    throw new Error(`The chain did not finish ${hash} in a minute and a half`);
  }
  // A player is waiting for this. When the nodes are busy the library tries again and again for minutes: after
  // 45 seconds the player is told so instead, and can try again.
  const inTime = (work) => Promise.race([work, new Promise((_, no) => setTimeout(() => no(new Error("NEAR's public nodes are busy right now. Try again in a moment.")), 45_000))]);
  const send = (receiverId, list) => { const turn = line.then(() => inTime(sendAndWatch(receiverId, list))); line = turn.catch(() => {}); return turn; };
  // so many in the last hour, and no more
  const counted = { open: [], bait: [], sign: [], unread: [] };
  const fee = env.RELAY_FEE ? BigInt(env.RELAY_FEE) : FEE;
  const free = new Map();      // account -> when its free approvals of the last day were
  let paid = 0;
  const room = (kind, most) => { const now = Date.now(); counted[kind] = counted[kind].filter((t) => now - t < 3_600_000); if (counted[kind].length >= most) return false; counted[kind].push(now); return true; };
  // Is there such an account? Asked plainly, node after node, because "no such account" and "no answer" must not be mixed up.
  const exists = async (who) => {
    for (const url of urls) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000),
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'optimistic', account_id: who } }) });
        const j = await r.json();
        if (j.result?.amount != null) return true;
        if (/UNKNOWN_ACCOUNT|does not exist/i.test(JSON.stringify(j.error || j.result || ''))) return false;
      } catch { /* the next node */ }
    }
    throw new Error('No NEAR node answered');
  };
  const says = (e) => String(e?.message || e).slice(0, 300);
  // a question to a contract that changes nothing
  const call = async (contract, method, args) => {
    const j = await ask('query', { request_type: 'call_function', finality: 'optimistic', account_id: contract, method_name: method, args_base64: b64(JSON.stringify(args)) });
    if (!j?.result?.result) throw new Error(JSON.stringify(j?.error || j?.result || 'no answer').slice(0, 200));
    return JSON.parse(text(j.result.result));
  };
  // Whose sign-in is this token? NEAR Auth signs its tokens (RS256); its public keys are fetched from NEAR Auth and
  // kept for an hour. Gives the subject: the name NEAR Auth has for that Google, Apple or email identity.
  const signIn = { ...SIGN_IN[network], ...(env.NEAR_AUTH_ISSUER ? { issuer: env.NEAR_AUTH_ISSUER } : {}), ...(env.NEAR_AUTH_CLIENT ? { client: env.NEAR_AUTH_CLIENT } : {}) };
  let keys = { at: 0, list: [] };
  async function whoSigned(token) {
    if (typeof token !== 'string' || token.length > 8000 || token.split('.').length !== 3) throw new Error('no token');
    const [h, p, sig] = token.split('.'), head = JSON.parse(text(unb64(h))), claims = JSON.parse(text(unb64(p)));
    if (head.alg !== 'RS256') throw new Error('not signed the way NEAR Auth signs');
    if (Date.now() - keys.at > 3_600_000 || !keys.list.some((k) => k.kid === head.kid)) {
      const r = await fetch(`${signIn.issuer}.well-known/jwks.json`, { signal: AbortSignal.timeout(8000) });
      keys = { at: Date.now(), list: (await r.json()).keys || [] };
    }
    const jwk = keys.list.find((k) => k.kid === head.kid);
    if (!jwk) throw new Error('signed with a key NEAR Auth does not have');
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64(sig), new TextEncoder().encode(`${h}.${p}`)))) throw new Error('the signature is not NEAR Auth\'s');
    const forUs = Array.isArray(claims.aud) ? claims.aud.includes(signIn.client) : claims.aud === signIn.client;
    if (claims.iss !== signIn.issuer || !forUs) throw new Error('made for another sign-in');
    if (!(claims.exp * 1000 > Date.now())) throw new Error('it has run out: sign in again');
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.includes('#')) throw new Error('it names nobody');
    return claims.sub;
  }
  // The key of a sign-in: the MPC contract tells which ed25519 key belongs to it.
  async function keyOf(sub) {
    const key = String(await call(signIn.mpc, 'derived_public_key', { path: `jwt#${signIn.issuer}#${sub}`, predecessor: AUTH_CONTRACT[network], domain_id: 1 }));
    if (baseDecode(key.split(':')[1]).length !== 32) throw new Error('the sign-in has no ed25519 key');
    return key;
  }
  // The account of a sign-in. A key by itself is an account too, but one named by 64 letters, which no faucet
  // or exchange takes and nobody can read. So every sign-in gets a named account, "kail-" and the first letters
  // of its key: the same sign-in always finds the same account, with nothing to remember. A NEAR account cannot be
  // renamed afterwards, so the name is made here once and for all. Should somebody else hold that name, more
  // letters of the key are used.
  // Gives { id, key, there }: `there` tells whether the account exists already.
  const TOP = network === 'mainnet' ? 'near' : 'testnet';
  async function accountOf(sub) {
    const key = await keyOf(sub), all = hex(baseDecode(key.split(':')[1]));
    for (const letters of [10, 20, 40]) {
      const id = `kail-${all.slice(0, letters)}.${TOP}`;
      if (!(await exists(id))) return { id, key, there: false };
      const mine = await ask('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: id, public_key: key });
      if (mine?.result?.nonce != null) return { id, key, there: true };
    }
    throw new Error('no free name for this sign-in');
  }

  return {
    account: id,
    // { token }: the identity token NEAR Auth's sign-in gave the player. Works out the player's account and makes
    // it if there is no such account yet. Answers { address, made }.
    async open({ token }) {
      let who;
      try { who = await accountOf(await whoSigned(token)); } catch (e) { return [401, { error: `That is not a sign-in from NEAR Auth: ${says(e)}` }]; }
      const address = who.id;
      if (who.there) return [200, { address, made: false }];
      try {
        if (!room('open', OPENS_AN_HOUR)) return [429, { error: 'Many new players this hour. Try again a little later.', address }];
        // the network's own registrar makes the named account, with the sign-in's key as its key
        let hash = null;
        for (const put of [0n, SEED]) {
          const r = await send(TOP, [actions.functionCall('create_account', { new_account_id: address, new_public_key: who.key }, 30n * TGAS, put)]);
          hash = r.transaction.hash;
          // (a node may need a moment before it knows the new account)
          for (let i = 0; i < 4 && !r.status.Failure; i++) { if (await exists(address)) return [200, { address, made: true, hash }]; await new Promise((ok) => setTimeout(ok, 700)); }
        }
        return [502, { error: 'The account could not be made', address, hash }];
      } catch (e) { return [502, { error: says(e), address }]; }
    },
    // { account }: the 5 bait of welcome for an account, whichever way it signed in. Once per account (the
    // contract keeps count), and only for an account that is on the chain and holds a little NEAR.
    // Answers { bait: 5 } when they were given now, { bait: 0, already: true } when they were given before.
    async bait({ account: who }) {
      if (typeof who !== 'string' || !/^(?=.{2,64}$)[a-z0-9]+([._-][a-z0-9]+)*$/.test(who)) return [400, { error: 'Name the account' }];
      try {
        const j = await ask('query', { request_type: 'view_account', finality: 'optimistic', account_id: who });
        if (j?.result?.amount == null) return [409, { error: 'That account is not on the chain yet' }];
        if (await call(env.NEAR_CONTRACT, 'welcomed', { account_id: who })) return [200, { bait: 0, already: true }];
        if (BigInt(j.result.amount) < BAIT_NEEDS) return [409, { error: 'The account needs a little NEAR first' }];
        if (!room('bait', BAITS_AN_HOUR)) return [429, { error: 'Many new players this hour. Try again a little later.' }];
        const r = await send(env.NEAR_CONTRACT, [actions.functionCall('welcome', { player: who }, 30n * TGAS, 0n)]);
        if (r.status.Failure) return [502, { error: JSON.stringify(r.status.Failure).slice(0, 300) }];
        return [200, { bait: 5, hash: r.transaction.hash }];
      } catch (e) { return [502, { error: says(e) }]; }
    },
    // What NEAR Auth's sign-in window gave the player, carried to NEAR Auth's contract. Answers with the call's
    // outcome: on success its value is the MPC network's signature.
    async sign({ guard_id, verify_payload, sign_payload, algorithm = 'eddsa' }) {
      // (a NEAR account's key is ed25519: no other kind of signature is carried)
      if (typeof guard_id !== 'string' || guard_id.length > 200 || typeof verify_payload !== 'string' || verify_payload.length > 12000 || sign_payload == null || algorithm !== 'eddsa') return [400, { error: 'That is not an approval from NEAR Auth' }];
      // What is to be signed is the transaction itself. Who pays for the signing is read from it.
      let tx = null;
      try { tx = decodeTransaction(Uint8Array.from(Array.isArray(sign_payload) ? sign_payload : Object.values(sign_payload))); } catch { /* not a transaction this server can read */ }
      const acts = tx?.actions || [], first = acts[0]?.functionCall;
      const pays = !!tx && tx.receiverId === env.NEAR_CONTRACT && first?.methodName === 'relay_fee' && BigInt(first.deposit) >= fee;
      if (tx && !pays) {
        // the kinds that cannot carry the fee: a key added to the player's own account, NEAR sent out
        const keyOnly = tx.receiverId === tx.signerId && acts.length > 0 && acts.every((a) => a.addKey), sendsOut = acts.length > 0 && acts.every((a) => a.transfer);
        if (!keyOnly && !sendsOut) return [402, { error: 'This approval has to carry the signing fee. Load the page again and try once more.' }];
        // the name the allowance is counted under has to be a NEAR account's name: nothing longer is ever kept
        if (typeof tx.signerId !== 'string' || tx.signerId.length > 64 || !/^[a-z0-9._-]+$/.test(tx.signerId)) return [400, { error: 'That is not an approval of a NEAR account' }];
        const day = (free.get(tx.signerId) || []).filter((t) => Date.now() - t < 86_400_000);
        if (day.length >= FREE_A_DAY) return [429, { error: 'That is all the free approvals for today (sending NEAR out, the game key). Try again tomorrow.' }];
      }
      // (should the payload ever not read as a transaction, it is still carried, a few an hour, and the log says so)
      if (!tx && !room('unread', UNREAD_AN_HOUR)) return [429, { error: 'Too many approvals this hour. Try again a little later.' }];
      if (!room('sign', SIGNS_AN_HOUR)) return [429, { error: 'Too many approvals this hour. Try again a little later.' }];
      // a free one is counted only now that it is really carried; names not seen for a day are forgotten
      if (tx && !pays) {
        const now = Date.now();
        free.set(tx.signerId, [...(free.get(tx.signerId) || []).filter((t) => now - t < 86_400_000), now]);
        if (free.size > 5000) for (const [who, times] of free) if (!times.some((t) => now - t < 86_400_000)) free.delete(who);
      }
      try {
        // 1 yoctoNEAR goes along for the MPC network and comes back; 300 Tgas is what NEAR Auth's own tools attach
        const r = await send(AUTH_CONTRACT[network], [actions.functionCall('sign', { guard_id, verify_payload, sign_payload, algorithm }, 300n * TGAS, 1n)]);
        // the fees players paid wait in the contract: collected now and then, so this account does not run dry
        if (pays && !r?.status?.Failure && ++paid % COLLECT_EVERY === 0) send(env.NEAR_CONTRACT, [actions.functionCall('claim', {}, 30n * TGAS, 0n)]).catch(() => {});
        return [200, { hash: r?.transaction?.hash || null, kind: !tx ? 'unread' : pays ? 'paid' : 'free', result: { status: r?.status } }];
      } catch (e) { return [502, { error: says(e) }]; }
    },
  };
}
