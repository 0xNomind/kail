// The game's line to its contract on NEAR.
//   view(...)  reads from the contract: free, no wallet needed.
//   send(...)  changes something: a transaction signed for the player. Calls without NEAR attached are signed
//              by the game's own key in the browser (approved once at sign-in), so no wallet window opens;
//              calls that pay NEAR go through the wallet.
//              For a player who signed in with NEAR Auth there is no wallet: the game signs the small calls
//              itself with that same kind of key, and what pays NEAR is approved in NEAR Auth's window.
import { connector, CONTRACT, NODES, NETWORK, GAME_CALLS, account, signedInWithAuth, gameKey, nearAuth } from './account.js';
import { NET, SIGN_FEE } from './network.js';
export { SIGN_FEE };

export { CONTRACT };
export const YOCTO = 10n ** 24n;
/// NEAR as a short number: 1.5 for 1.5 NEAR
// NEAR amounts are shown and typed to a millionth of a NEAR: a coin and a ticket can be worth very little.
export const near = (yocto) => Number(BigInt(yocto) / 10n ** 18n) / 1e6;
export const toYocto = (n) => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
// One question to a public node. A node that is slow, busy or down is skipped: the next one is asked, twice round.
// What the contract itself answers (also when it says no) comes back as it is.
async function rpc(method, params) {
  let last = null;
  for (let round = 0; round < 2; round++) {
    for (const node of NODES) {
      const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 7000);
      try {
        const r = await fetch(node, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: stop.signal });
        if (!r.ok) throw new Error(`node answered ${r.status}`);
        const j = await r.json();
        // "the node could not handle this" is the node's trouble; anything else is a real answer
        if (j.error && (j.error.name === 'INTERNAL_ERROR' || j.error.cause?.name === 'INTERNAL_ERROR' || j.error.code === -32000 && /timeout|overload|unavailable/i.test(JSON.stringify(j.error)))) throw new Error(j.error.data || j.error.message);
        if (j.error) throw Object.assign(new Error(j.error.data || j.error.message || 'The chain said no'), { final: true });
        return j.result;
      } catch (e) {
        if (e.final) throw e;
        last = e;
      } finally { clearTimeout(timer); }
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`NEAR's public nodes did not answer (${String(last?.message || last).slice(0, 80)})`);
}
export async function view(method, args = {}) {
  const res = await rpc('query', { request_type: 'call_function', finality: 'optimistic', account_id: CONTRACT, method_name: method, args_base64: b64(new TextEncoder().encode(JSON.stringify(args))) });
  if (res.error) throw new Error(res.error);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(res.result)));
}
/// NEAR in an account's own wallet, in yoctoNEAR
export async function walletBalance(accountId) {
  const res = await rpc('query', { request_type: 'view_account', finality: 'optimistic', account_id: accountId });
  return res.amount;
}

// ---- NEAR for the fees
// Every action is a transaction, and its fee is paid by the player's own account. The game gives no NEAR: on the
// test network it is free at the public faucet, which sends it to an account by its name.
export const FAUCET = NET.faucet;
/// NEAR an account should hold before it starts playing (0.02): what one action needs at hand, and a little over.
export const NEAR_TO_START = 20_000_000_000_000_000_000_000n;
/// Did this fail because the account holds too little NEAR?
export const outOfNear = (e) => /NotEnoughBalance|LackBalanceForState|Not enough NEAR/.test(typeof e === 'string' ? e : String(e?.message || JSON.stringify(e) || e));

// what the contract said when it refused, without the wrapping
export function reason(e) {
  const text = typeof e === 'string' ? e : (e?.message || JSON.stringify(e) || String(e));
  const m = text.match(/Smart contract panicked: ([^"\\]+)/) || text.match(/panicked[^:]*: ([^"\\]+)/);
  if (m) return m[1];
  // not enough NEAR in the account for this (what it costs, plus what is held back while it runs)
  const short = text.match(/NotEnoughBalance[^}]*?"balance":"(\d+)","cost":"(\d+)"/);
  if (short) return `Not enough NEAR for that: you hold ${near(short[1])} and it needs ${near(short[2])} at hand (what is not used comes back).${FAUCET ? ' Test NEAR is free at the NEAR faucet.' : ''}`;
  if (/LackBalanceForState/.test(text)) return `Not enough NEAR for that: a little has to stay in the account to keep it open.${FAUCET ? ' Test NEAR is free at the NEAR faucet.' : ''}`;
  if (/reject|cancel|closed|denied/i.test(text)) return 'Nothing was sent.';
  // trouble on the way to the chain, not a "no" from the game's rules
  if (/nodes are busy/i.test(text)) return text;
  if (/json.?rpc|rpc error|failed to fetch|network|timed? ?out|-32000|exceeded \d+ attempts|did not answer|server error|rate.?limit/i.test(text)) {
    return `A public node of NEAR did not answer in time. Wait a moment: the action may still have gone through. (${text.slice(0, 90)})`;
  }
  return text.slice(0, 160);
}

// The hash of the transaction the last call ran in, and where anybody can look a transaction up.
let lastTx = null;
export const lastTransaction = () => lastTx;
export const txUrl = (hash) => `${NET.explorer}/txns/${hash}`;
// One key signs one transaction at a time, so the game's calls wait their turn.
let line = Promise.resolve();
// What the player is waiting for while NEAR Auth is at work ("Approve it in NEAR Auth's window…"): a page can
// show it by setting this.
export const waiting = { tell: () => {} };
// What goes first in every transaction a NEAR Auth player approves on the game's contract: the fee for having it
// signed, paid back to the game's helper that sends the signing request (see SIGN_FEE in src/network.js).
const SIGNING = { call: ['relay_fee', {}, '5000000000000', SIGN_FEE] };
// A NEAR Auth account's call. Without NEAR attached and with the game's key in this browser: signed here, handed
// to the chain, and looked up every second until it is through. Otherwise: approved in NEAR Auth's window.
let own = null;
async function sendAsAuth(method, args, deposit, gas) {
  const id = account(), key = gameKey(id);
  let hash, status;
  if (String(deposit) === '0' && key && GAME_CALLS.includes(method)) {
    const n = await import('../public/vendor/near.js');
    if (!own || own.id !== id || own.key !== key) own = { id, key, account: new n.Account(id, new n.FailoverRpcProvider(NODES.map((url) => new n.JsonRpcProvider({ url }))), new n.KeyPairSigner(n.KeyPair.fromString(key))) };
    const signed = await own.account.createSignedTransaction({ receiverId: CONTRACT, actions: [n.actions.functionCall(method, args, BigInt(gas), 0n)] });
    hash = n.baseEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', n.encodeTransaction(signed.transaction))));
    await own.account.provider.sendTransactionAsync(signed);
    for (let i = 0; i < 45 && !status; i++) {
      await new Promise((r) => setTimeout(r, i < 4 ? 600 : 1000));
      const s = (await rpc('tx', { tx_hash: hash, sender_account_id: id, wait_until: 'NONE' }).catch(() => null))?.status;
      if (s && typeof s === 'object' && ('SuccessValue' in s || 'Failure' in s)) status = s;
    }
    if (!status) throw new Error('A public node of NEAR did not answer in time');
  } else {
    ({ hash, status } = await (await nearAuth()).approve(CONTRACT, [SIGNING, { call: [method, args, gas, String(deposit)] }], (text) => waiting.tell(text), id));
  }
  lastTx = hash;
  if (status.Failure) throw new Error(JSON.stringify(status.Failure));
  return status.SuccessValue ? JSON.parse(atob(status.SuccessValue)) : null;
}
/// Send NEAR out of a NEAR Auth account to another account (a withdrawal). Approved in NEAR Auth's window.
export async function sendNear(to, yocto) {
  const { hash, status } = await (await nearAuth()).approve(to, [{ transfer: String(yocto) }], (text) => waiting.tell(text), account());
  lastTx = hash;
  if (status.Failure) throw new Error(JSON.stringify(status.Failure));
  return hash;
}
// Gas a call may use at most. While a call runs, NEAR holds back about ten times the going price for all of it
// and gives the rest back afterwards: with 30 Tgas that was 0.031 NEAR out of reach for a moment, more than a
// new player's account can spare. The game's calls use 3 to 5.5 Tgas (measured on testnet), so 15 is plenty and
// holds back only about 0.016 NEAR.
export const GAS = '15000000000000';
/// NEAR an account needs at hand for one action to go through (it comes back, but for the fee of about 0.0003).
export const AT_HAND = 16_000_000_000_000_000_000_000n;
export function send(method, args = {}, { deposit = '0', gas = GAS } = {}) {
  const run = async () => {
    if (signedInWithAuth()) return sendAsAuth(method, args, deposit, gas);
    const wallet = await (await connector()).wallet();
    const r = await wallet.signAndSendTransaction({ receiverId: CONTRACT, actions: [{ type: 'FunctionCall', params: { methodName: method, args, gas, deposit: String(deposit) } }] });
    lastTx = r?.transaction?.hash || r?.transaction_outcome?.id || null;
    const failure = r?.status?.Failure;
    if (failure) throw new Error(JSON.stringify(failure));
    const value = r?.status?.SuccessValue;
    return value ? JSON.parse(atob(value)) : null;
  };
  const turn = line.then(run, run);
  line = turn.catch(() => {});
  return turn;
}

/// Several calls to the contract in ONE transaction: all of them go through, or none does. Each is
/// { method, args, deposit, gas }. A NEAR Auth player approves the lot once, in NEAR Auth's window.
export function sendMany(calls) {
  const run = async () => {
    let hash = null, failure = null;
    if (signedInWithAuth()) {
      const r = await (await nearAuth()).approve(CONTRACT, [SIGNING, ...calls.map((c) => ({ call: [c.method, c.args || {}, c.gas || GAS, String(c.deposit || '0')] }))], (text) => waiting.tell(text), account());
      hash = r.hash; failure = r.status.Failure;
    } else {
      const wallet = await (await connector()).wallet();
      const r = await wallet.signAndSendTransaction({ receiverId: CONTRACT, actions: calls.map((c) => ({ type: 'FunctionCall', params: { methodName: c.method, args: c.args || {}, gas: c.gas || GAS, deposit: String(c.deposit || '0') } })) });
      hash = r?.transaction?.hash || r?.transaction_outcome?.id || null; failure = r?.status?.Failure;
    }
    lastTx = hash;
    if (failure) throw new Error(JSON.stringify(failure));
  };
  const turn = line.then(run, run);
  line = turn.catch(() => {});
  return turn;
}

// How long a "day" is comes from the contract. While the game is tried out a day is short, so that a quest and a
// draw come round quickly; the pages say so wherever they talk about a day. Nothing to say when a day is a day.
export function dayNote(dayMs) {
  if (!dayMs || dayMs >= 86400000) return '';
  const min = Math.round(dayMs / 60000), long = min % 60 === 0 ? (min === 60 ? 'one hour' : `${min / 60} hours`) : `${min} minutes`;
  return `On this test network a "day" lasts ${long}, so a new quest and a draw come every ${long === 'one hour' ? 'hour' : long}. In the real game a day will be a full day.`;
}

// Everything the pages show, read with ONE question to the chain (the contract's `state` view). The public
// nodes are shared and turn away a browser that asks too much at once, so one question beats eight.
// `account` may be empty: then only the public part is filled.
export async function load(account) {
  const s = await view('state', { account_id: account || null });
  return { quest: s.quest, draw: s.draw, pastDraws: s.past_draws || [], orders: s.orders, ticketOrders: s.ticket_orders, ticketTrades: s.ticket_trades || [], vault: s.vault, coinPrice: s.coin_price, dayMs: Number(s.day_ms || 86400000), me: s.me, events: s.events, at: Date.now() };
}

// The contract hands out orders a hundred at a time, oldest first. `first` is the hundred that came with `state`;
// when that page was full the rest is fetched, page by page.
export async function allOrders(method, first) {
  const all = [...first];
  for (let from = all.length; all.length === from && from >= 100 && from < 2000; from += 100) {
    const more = await view(method, { from_index: from, limit: 100 });
    all.push(...more);
    if (more.length < 100) break;
  }
  return all;
}
