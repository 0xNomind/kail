// Who is playing: a NEAR account, signed in one of two ways.
//   With a wallet: NEAR Connect (@hot-labs/near-connect), packed into one browser file by "npm run vendor".
//   With NEAR Auth: Google, Apple or email, no wallet (src/nearauth.js, loaded only when it is used).
// Only the account's name and the way it signed in are kept here, so every page knows them at once.
import { NETWORK, NET } from './network.js';
export { NETWORK };
/// The public nodes of NEAR to ask, the first one first (src/network.js).
export const NODES = NET.nodes;
const KEY = 'kail.account', KIND = 'kail.signin';

export function account() { try { return localStorage.getItem(KEY) || null; } catch { return null; } }
/// How the account signed in: 'auth' (NEAR Auth) or 'wallet'.
export function signedInWith() { try { return account() && localStorage.getItem(KIND) === 'auth' ? 'auth' : 'wallet'; } catch { return 'wallet'; } }
function remember(id, kind = 'wallet') {
  try {
    if (id) { localStorage.setItem(KEY, id); if (kind === 'auth') localStorage.setItem(KIND, 'auth'); else localStorage.removeItem(KIND); }
    else { localStorage.removeItem(KEY); localStorage.removeItem(KIND); }
  } catch { /* private mode */ }
}
export const signedInWithAuth = () => signedInWith() === 'auth';
/// The NEAR Auth side of the game, loaded when it is first needed (its library is big).
export const nearAuth = () => import('./nearauth.js');
// long account names (a 64-letter one has no readable name) are cut in the middle
export const shortName = (id, max = 22) => (id.length <= max ? id : `${id.slice(0, 8)}…${id.slice(-6)}`);

// The contract the game plays on, and what the game's own key may call there without asking the wallet:
// everything that attaches no NEAR. (Topping up, buying tickets and sending a ticket do go through the wallet.)
export const CONTRACT = NET.contract;
export const GAME_CALLS = ['buy_bait', 'cast', 'upgrade', 'throw_back', 'hand_in', 'list_item', 'want_item', 'cancel_item_order', 'buy_item', 'sell_item',
  'enter_draw', 'claim', 'sell_tickets', 'cancel_order', 'fill_bid'];

// The connector is only loaded when a page needs the wallet. With it comes the plugin that signs with the game's
// key once the account has one.
// Signing in itself only connects the wallet: it costs nothing, so an account with no NEAR in it can sign in too.
// The key is asked for in the game (enableGameKey below), after the game has seen that the account holds the NEAR
// that adding a key costs. (Asking the wallet for the key at sign-in looked simpler, but with too little NEAR
// the wallet just fails, and the game never learns which account it was, so it cannot say what is missing.)
let ready = null;
export function connector() {
  return (ready ||= import('../public/vendor/near.js').then(async ({ NearConnector, createAccessKeyPlugin }) => {
    const providers = { [NETWORK]: NODES };
    const c = new NearConnector({ network: NETWORK, features: NETWORK === 'testnet' ? { testnet: true } : {}, providers });
    await c.use(createAccessKeyPlugin({ network: c.network, providers }));
    return c;
  }));
}
// ---- the game's own key
// A key kept in this browser that may only call the game's small actions on the game's contract, and can never
// attach NEAR. The plugin above signs with it. It is stored where the plugin looks for it.
// (a wallet's key sits where the wallet plugin looks for it; a NEAR Auth account's key has a place of its own)
const keySlot = (id) => (signedInWith() === 'auth' ? `kail.gamekey::${NETWORK}::${id}` : `access_key::plugin::${NETWORK}::${id}`);
/// The game's key for a NEAR Auth account, as text, or nothing.
export function gameKey(id = account()) { try { return JSON.parse(localStorage.getItem(`kail.gamekey::${NETWORK}::${id}`))?.privateKey || null; } catch { return null; } }
/// Does this browser hold the game's key for the account? Without it every call opens the wallet.
export function hasGameKey(id = account()) {
  try { return !!id && !!localStorage.getItem(keySlot(id)); } catch { return false; }
}
async function keyOnChain(id, publicKey) {
  const r = await fetch(NODES[0], { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_access_key', finality: 'optimistic', account_id: id, public_key: publicKey } }) });
  const j = await r.json();
  return !j.error && !j.result?.error;
}
/// Is the game's key in this browser AND known to the account on the chain? (A key the chain does not know is
/// thrown away here, so the game asks for a new one.)
export async function gameKeyWorks(id = account()) {
  if (!hasGameKey(id)) return false;
  try {
    const { KeyPair } = await import('../public/vendor/near.js');
    const stored = JSON.parse(localStorage.getItem(keySlot(id)));
    if (await keyOnChain(id, KeyPair.fromString(stored.privateKey).getPublicKey().toString())) return true;
    localStorage.removeItem(keySlot(id));
    return false;
  } catch { return true; }        // could not ask the chain right now: do not throw a good key away
}
/// Make the game's key and ask the wallet, once, to add it to the account. After that the game's small
/// actions need no wallet window.
export async function enableGameKey(id = account(), tell = () => {}) {
  if (signedInWith() === 'auth') {
    // one approval in NEAR Auth's window adds the key
    const privateKey = await (await nearAuth()).addGameKey(tell, id);
    localStorage.setItem(keySlot(id), JSON.stringify({ privateKey, contractId: CONTRACT, methodNames: GAME_CALLS }));
    return;
  }
  const { KeyPair } = await import('../public/vendor/near.js');
  const pair = KeyPair.fromRandom('ed25519'), publicKey = pair.getPublicKey().toString();
  const wallet = await (await connector()).wallet();
  await wallet.signAndSendTransaction({ receiverId: id, actions: [{ type: 'AddKey', params: { publicKey,
    accessKey: { permission: { receiverId: CONTRACT, methodNames: GAME_CALLS, allowance: '250000000000000000000000' } } } }] });
  // the chain needs a moment before every node knows the new key
  for (let i = 0; i < 20 && !(await keyOnChain(id, publicKey).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 700));
  localStorage.setItem(keySlot(id), JSON.stringify({ privateKey: pair.toString(), contractId: CONTRACT, methodNames: GAME_CALLS }));
}

// Opens the list of wallets, then the wallet itself. Gives back the account's name.
export async function signIn() {
  const c = await connector();
  const wallet = await c.connect();
  const [first] = await wallet.getAccounts();
  if (!first) throw new Error('The wallet gave no account.');
  remember(first.accountId);
  return first.accountId;
}

/// Sign in with NEAR Auth. `tell` gets a line about what is happening. Gives the account's name. (The game's
/// key is asked for in the game itself, once the account holds the NEAR that adding a key costs.)
export async function signInWithAuth(tell = () => {}) {
  const auth = await nearAuth();
  const { account: id } = await auth.signIn(tell);
  remember(id, 'auth');
  return id;
}

export async function signOut() {
  if (signedInWith() === 'auth') { try { await (await nearAuth()).signOut(); } catch { /* was not signed in there */ } remember(null); return; }
  try { const c = await connector(); await c.disconnect(); } catch { /* the wallet was already gone */ }
  remember(null);
}

// Asks the wallet whether the remembered account is still connected. Only a clear "no" forgets the account:
// a wallet list that did not load (no network) is not a reason to sign anybody out.
export async function stillSignedIn() {
  const id = account();
  if (!id) return true;
  // a NEAR Auth account stays signed in here as long as this browser remembers it: NEAR Auth is only asked again
  // when something needs the player's approval
  if (signedInWith() === 'auth') return true;
  try {
    const c = await connector();
    await c.whenManifestLoaded;
    const { accounts } = await c.getConnectedWallet();
    if (accounts.some((a) => a.accountId === id)) return true;
  } catch (e) {
    if (!/No wallet selected|No accounts found/.test(String(e?.message))) return true;
  }
  remember(null);
  return false;
}
