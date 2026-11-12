// Signing in with NEAR Auth: Google, Apple or email instead of a wallet.
//
// The player's key is held by NEAR's MPC network and derived from their sign-in, so the same sign-in is always
// the same account, and nobody (not this game either) can sign for them. Anything that needs that key opens NEAR
// Auth's own window for the player to approve. The game asks for it rarely:
//   once, to add the game's own key to the account (after that, casting and trading need no window);
//   and each time NEAR itself moves: a top-up, buying tickets, sending NEAR out.
// A new player has no account on the chain yet: the game's server makes it at the first sign-in (server/relay.mjs),
// with nothing in it. The player gets their NEAR themselves; the game shows how. The same server carries each
// approval to NEAR Auth's contract, which checks it on the chain before the MPC network signs.
//
// This file is only loaded when somebody uses NEAR Auth: its library is big (public/vendor/nearauth.js).
import { FastAuthClient, FastAuthSignature, JavascriptProvider, connect, transactions, utils, KeyPair } from '../public/vendor/nearauth.js';
import { CONTRACT, GAME_CALLS, NODES, NETWORK } from './account.js';
import { NET } from './network.js';

// NEAR Auth's contracts and sign-in for the network the game is on (src/network.js). On the test network the
// sign-in client is one shared by everybody who tries NEAR Auth out, and it only signs people in on a site at
// one address (NET.auth.onlyAt).
const AUTH = { fastAuthContractId: NET.auth.contract, mpcContractId: NET.auth.mpc };
export const worksHere = () => !!NET.auth.clientId && (!NET.auth.onlyAt || location.origin === NET.auth.onlyAt);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ready = null;
function start() {
  return (ready ||= (async () => {
    const { clientId, domain, signingAudience } = NET.auth;
    const provider = new JavascriptProvider({ network: NETWORK, clientId, ...(domain ? { domain } : {}), ...(signingAudience ? { signingAudience } : {}) });
    const near = await connect({ networkId: NETWORK, nodeUrl: NODES[0] });
    return { provider, client: new FastAuthClient(provider, near.connection, AUTH) };
  })());
}
// a question to a NEAR node, the next node when one does not answer
async function ask(method, params) {
  let last = null;
  for (const url of NODES) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.error && /rate|limit|429/i.test(JSON.stringify(j.error))) { last = new Error('rate limit'); continue; }
      return j;
    } catch (e) { last = e; }
  }
  throw last;
}
const server = async (path, body) => {
  const r = await fetch(`api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const answer = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(answer.error || `The game's server said ${r.status}`);
  return answer;
};
export async function exists(id) {
  const j = await ask('query', { request_type: 'view_account', finality: 'optimistic', account_id: id });
  return j.result?.amount != null;
}

// Who is signed in: the signer and the sign-in's key. The account is a named one, "kail-" and the first letters
// of the key (made by the game's server at the first sign-in, see server/relay.mjs): readable, taken by faucets
// and exchanges, and found again from the key alone. It cannot be renamed later; no NEAR account can.
let me = null;
const TOP = NET.top;
const holdsKey = async (id, key) => (await ask('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: id, public_key: key }).catch(() => null))?.result?.nonce != null;
/// The account that belongs to the sign-in's key, or nothing when there is none yet.
async function accountOf(m) {
  for (const letters of [10, 20, 40]) {
    const id = `kail-${m.hex.slice(0, letters)}.${TOP}`;
    if (await holdsKey(id, m.publicKey.toString())) return id;
  }
  return null;
}
async function who() {
  if (me) return me;
  const { client, provider } = await start();
  // a new page does not know the sign-in yet: NEAR Auth is asked quietly, and only if that fails, with its window
  if (!(await provider.isLoggedIn().catch(() => false))) await client.login();
  const signer = await client.getSigner();
  const publicKey = utils.PublicKey.fromString(String(await signer.getPublicKey()));
  me = { signer, publicKey, hex: [...publicKey.data].map((b) => b.toString(16).padStart(2, '0')).join(''), account: null };
  return me;
}

// Have the player approve a transaction from their account in NEAR Auth's window, get it signed, and send it.
// `list` holds what it does: { call: [method, args, gas, deposit] } on the receiver, { transfer: yocto }, or
// { addKey: publicKey } for the game's key. Gives the transaction's hash and how it ended.
export async function approve(receiverId, list, tell = () => {}, expected = null) {
  const m = await who();
  // the account this page plays as has to be the one of the sign-in in NEAR Auth's window
  if (expected ? !(await holdsKey(expected, m.publicKey.toString())) : !(m.account ||= await accountOf(m))) { me = null; throw new Error(expected ? 'NEAR Auth is signed in as somebody else. Sign out here and sign in again.' : 'Your account is not on the chain yet'); }
  if (expected) m.account = expected;
  const actions = list.map((a) => (a.call ? transactions.functionCall(a.call[0], a.call[1], BigInt(a.call[2] || '15000000000000'), BigInt(a.call[3] || '0'))
    : a.transfer != null ? transactions.transfer(BigInt(a.transfer))
      : transactions.addKey(a.addKey, transactions.functionCallAccessKey(CONTRACT, GAME_CALLS, 250000000000000000000000n))));
  const key = (await ask('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: m.account, public_key: m.publicKey.toString() })).result;
  if (key?.nonce == null) throw new Error('Your account is not on the chain yet');
  const block = (await ask('block', { finality: 'final' })).result;
  const transaction = transactions.createTransaction(m.account, m.publicKey, receiverId, BigInt(key.nonce) + 1n, actions, utils.serialize.base_decode(block.header.hash));
  tell("Approve it in NEAR Auth's window…");
  await m.signer.requestTransactionSignature({ transaction });
  const { signatureRequest } = await m.signer.getSignatureRequest();
  tell('Approved. Signing takes about ten seconds…');
  const signed = await server('/sign', { guard_id: signatureRequest.guardId, verify_payload: signatureRequest.verifyPayload, sign_payload: signatureRequest.signPayload, algorithm: 'eddsa' });
  const value = signed?.result?.status?.SuccessValue;
  if (!value) throw new Error('NEAR Auth did not sign it');
  tell('Signed. Sending…');
  // a signed transaction: its bytes, one byte for the kind of key (0 = ed25519), the 64 bytes of the signature
  const body = transactions.encodeTransaction(transaction), signature = FastAuthSignature.fromBase64(value).recover('ed25519');
  const bytes = new Uint8Array(body.length + 65);
  bytes.set(body, 0); bytes[body.length] = 0; bytes.set(signature, body.length + 1);
  const hash = utils.serialize.base_encode(new Uint8Array(await crypto.subtle.digest('SHA-256', body)));
  let text = ''; for (const b of bytes) text += String.fromCharCode(b);
  const sent = await ask('send_tx', { signed_tx_base64: btoa(text), wait_until: 'NONE' });
  // the chain's own words go along ("NotEnoughBalance" and the like), so the page can say what is wrong
  if (sent.error) throw new Error(JSON.stringify(sent.error.data || sent.error).slice(0, 400));
  for (let i = 0; i < 60; i++) {
    await wait(1000);
    const status = (await ask('tx', { tx_hash: hash, sender_account_id: m.account, wait_until: 'NONE' }).catch(() => null))?.result?.status;
    if (status && typeof status === 'object' && ('SuccessValue' in status || 'Failure' in status)) return { hash, status };
  }
  throw new Error('The chain did not answer in a minute');
}

// The game's own key for this account, made here and added with one approval. Gives the key as text to keep.
export async function addGameKey(tell = () => {}, expected = null) {
  const pair = KeyPair.fromRandom('ed25519'), m = await who();
  const id = expected || m.account || await accountOf(m);
  if (!id) throw new Error('Your account is not on the chain yet');
  const done = await approve(id, [{ addKey: pair.getPublicKey() }], tell, id);
  if (done.status.Failure) throw new Error(JSON.stringify(done.status.Failure).slice(0, 300));
  return pair.toString();
}

// Sign in. Opens NEAR Auth's window; then makes sure the account exists (the game's server makes it at the first
// sign-in, with nothing in it) and gives its name. `made` tells whether it was made just now.
export async function signIn(tell = () => {}) {
  const { client, provider } = await start();
  me = null;
  tell("Sign in in NEAR Auth's window…");
  await client.login();
  const m = await who();
  tell('Signed in. Finding your account…');
  const token = (await provider.client.getIdTokenClaims())?.__raw;
  let opened = {};
  try { opened = await server('/open', { token }); } catch (e) { opened = { error: String(e.message || e) }; }
  for (let i = 0; i < 12 && !m.account; i++) {
    if (opened.address && await holdsKey(opened.address, m.publicKey.toString())) m.account = opened.address; else m.account = await accountOf(m);
    if (!m.account) await wait(1000);
  }
  if (!m.account) throw new Error(`Your account could not be made${opened.error ? `: ${opened.error}` : ''}. Try again in a moment.`);
  return { account: m.account, made: !!opened.made };
}
export async function signOut() {
  try { const { client } = await start(); me = null; await client.logout({ openUrl: false }); } catch { /* was not signed in */ }
}
export async function signedIn() {
  try { const { provider } = await start(); return await provider.isLoggedIn(); } catch { return false; }
}
