// The other boats, run. What they decide is in npc-rules.js; this file only carries a decision out and asks again.
//
// A fisher here does what a player's browser does, with the same calls: the contract for bait, quest, markets and
// draw, and the game's server for catches. It throws its hook in a sea the server gave it, a robot steers and
// pulls at the pace of the clock, and the moves go to the server to be played again like anybody's. Nothing in
// the contract or in the server knows that these accounts are not people.
//
// Which accounts: NPCS in server/.dev.vars, a list of account names separated by commas ("account=Name" gives an
// account one fisher of npc-rules.js by name; without it they are handed out in order). Each account needs its
// key on this machine, where the NEAR CLI puts it: ~/.near-credentials/<network>/<account>.json (create the
// account with "save-to-legacy-keychain"), or the system keychain (then the NEAR CLI signs, which is slower).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from 'near-api-js';
import { FISHERS, decide } from '../src/npc-rules.js';
import { newWorld, step, cast, release, entities } from '../src/sim.js';
import { TICK, REST_TICKS, makeRecorder, roundX } from '../src/replay.js';
import { makeBot } from '../src/bot.js';

// The node the players' browsers ask first is kept for last: ten boats asking it all day would use up the
// allowance it gives one address, and the game in the browser would be turned away.
// The boats keep to nodes of their own. The public nodes are free and count what each address asks: nine boats on
// the players' nodes (FastNEAR) used up the allowance, and a player's top-up then waited minutes or failed.
// So the boats never ask FastNEAR; when their own nodes say "too many", they all rest a while (see below).
export const BOAT_NODES = { testnet: ['https://near-testnet.drpc.org', 'https://near-testnet.gateway.tatum.io'], mainnet: ['https://near.drpc.org'] };
const NODES = BOAT_NODES;
const tooMany = (e) => /rate.?limit|too many|429/i.test(String(e?.message || e));
const TGAS = 1_000_000_000_000n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (e) => { const t = String(e?.message || e); const m = t.match(/Smart contract panicked: ([^"\\\n]+)/); return (m ? m[1] : t).slice(0, 160); };

// ---- asking the chain (no key needed)
async function rpc(urls, method, params) {
  let last = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j.error || j.result?.error) throw new Error(JSON.stringify(j.error || j.result.error).slice(0, 200));
      return j.result;
    } catch (e) { last = e; }
  }
  throw last;
}
const view = async (urls, contract, method, args) => JSON.parse(Buffer.from((await rpc(urls, 'query', { request_type: 'call_function', finality: 'optimistic', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') })).result).toString());
const walletNear = async (urls, id) => Number(BigInt((await rpc(urls, 'query', { request_type: 'view_account', finality: 'optimistic', account_id: id })).amount) / 10n ** 18n) / 1e6;

const spent = { last: 0 };
// ---- signing as a fisher: with its key file, or through the NEAR CLI when the key sits in the system keychain
function signer(id, env, urls) {
  const network = env.NEAR_NETWORK || 'testnet';
  const file = path.join(os.homedir(), '.near-credentials', network, `${id}.json`);
  if (fs.existsSync(file)) {
    const key = JSON.parse(fs.readFileSync(file, 'utf8')).private_key;
    const account = new Account(id, new FailoverRpcProvider(urls.map((url) => new JsonRpcProvider({ url }))), new KeyPairSigner(KeyPair.fromString(key)));
    return async (method, args, deposit = 0n) => {
      const r = await account.signAndSendTransaction({ receiverId: env.NEAR_CONTRACT, actions: [actions.functionCall(method, args, 100n * TGAS, deposit)] });
      if (r?.status?.Failure) throw new Error(JSON.stringify(r.status.Failure));
      // how much gas the call really used: written down with the step, to know what the game has to ask for
      spent.last = ((r?.transaction_outcome?.outcome?.gas_burnt || 0) + (r?.receipts_outcome || []).reduce((a, o) => a + (o.outcome?.gas_burnt || 0), 0)) / 1e12;
      const value = r?.status?.SuccessValue;
      return value ? JSON.parse(Buffer.from(value, 'base64').toString()) : null;
    };
  }
  const cli = path.join(os.homedir(), '.cargo/bin/near');
  return (method, args, deposit = 0n) => new Promise((resolve, reject) => {
    execFile(cli, ['contract', 'call-function', 'as-transaction', env.NEAR_CONTRACT, method, 'json-args', JSON.stringify(args), 'prepaid-gas', '100 Tgas', 'attached-deposit', `${deposit} yoctoNEAR`,
      'sign-as', id, 'network-config', network, 'sign-with-keychain', 'send'], { encoding: 'utf8' }, (err, stdout, stderr) => {
      const out = `${stdout}\n${stderr}`;
      if (err || /panicked|Failure/.test(out)) return reject(new Error((out.match(/Smart contract panicked[^\n]*/) || [out.slice(-300)])[0]));
      const last = stdout.trim().split('\n').pop();
      try { resolve(last ? JSON.parse(last) : null); } catch { resolve(null); }
    });
  });
}

const world_idle = (s) => s.world.hook.state === 'idle';
// ---- one throw of the hook, played at the pace of the clock and checked by the game's server
async function openSea(n, api) {
  const a = await api('/api/sea', { account: n.account });
  if (a.status !== 200) return null;
  return { world: newWorld(a.seed), moves: makeRecorder(), tick: 0, backTick: -REST_TICKS, base: { ticket: a.ticket, tick: 0 }, player: { bait: 1e9, up: { reel: a.reel, storage: 4 }, storage: {}, stats: { casts: 0, landed: 0 } } };
}
async function throwOnce(n, want, api) {
  const s = n.sea || (n.sea = await openSea(n, api));
  if (!s) return { said: 'the game server gave no sea' };
  // nothing landed for a minute of sea: hand the moves in, so the record stays short
  if (s.tick - s.base.tick > 60 * 240 && world_idle(s)) {
    const a = await api('/api/sea/keep', { ticket: s.base.ticket, ticks: s.tick - s.base.tick, moves: s.moves.cut(s.base.tick, s.tick) });
    if (a.status === 200) { s.base = { ticket: a.ticket, tick: s.tick }; s.moves.forget(s.tick); }
    else if (a.status !== 425) { n.sea = null; return { said: 'the sea was out of step: starting a new one' }; }
  }
  const chest = want === 'chest', bot = makeBot({ wantId: chest ? null : want, wantChest: chest, lag: n.who.lag });
  const { world, player, moves } = s, h = world.hook;
  let clock = Date.now(), owed = 0, drop = false, thrown = null, caught = null, waited = 0, back = false;
  while (!back) {
    await sleep(15);
    const now = Date.now(), dt = Math.min(0.05, (now - clock) / 1000);
    clock = now; owed += dt;
    if (drop) { drop = false; if (release(world)) moves.did(s.tick, 'r'); }
    const wasIdle = h.state === 'idle';
    if (!wasIdle) bot(world, player, dt);
    else if (!thrown && s.tick - s.backTick >= REST_TICKS) {
      // a sensible fisher does not throw while the thing wanted is not in the water; and does not wait for ever
      const there = entities(world).some((e) => (chest ? e.kind === 'chest' : e.def.id === want));
      waited += dt;
      if (there) bot(world, player, dt);
      else if (waited > 25) return { said: `no ${want} in the water for a while` };
    }
    if (wasIdle && h.state === 'out') {
      moves.did(s.tick, 'c');
      const secret = randomBytes(16);
      try { thrown = { secret: secret.toString('base64'), number: String(await n.call('cast', { seal: createHash('sha256').update(secret).digest('base64') })) }; }
      catch (e) { n.sea = null; return { said: `the cast did not reach the chain: ${short(e)}` }; }
      clock = Date.now();      // the sea stood still while the cast went to the chain
    }
    const sinking = h.state === 'out';
    h.steer = sinking ? Math.sign(h.steer) : 0; h.hold = h.state !== 'idle' && !!h.hold; h.targetX = sinking ? roundX(h.targetX) : null;
    moves.hands(s.tick, h.steer, h.hold, h.targetX);
    while (owed >= TICK && !back) {
      owed -= TICK;
      const out = h.state !== 'idle';
      step(world, player, TICK); s.tick += 1;
      if (out && h.state === 'idle') { s.backTick = s.tick; back = !!thrown; }
      for (const ev of world.events.splice(0)) {
        if (ev.type === 'hooked' && ev.kind === 'junk') drop = true;
        if (ev.type === 'landed') caught = { what: ev.chest ? 'chest' : ev.id, end: s.tick };
      }
      player.storage = {};
    }
  }
  if (!caught) return { said: 'the hook came back empty' };
  for (let i = 0; i < 6; i++) {
    const a = await api('/api/land', { account: n.account, cast: thrown.number, secret: thrown.secret, ticket: s.base.ticket, ticks: caught.end - s.base.tick, moves: moves.cut(s.base.tick, caught.end) });
    if (a.status === 425 && a.retry_in_ms) { await sleep(a.retry_in_ms + 200); continue; }
    if (a.status !== 200) { if (a.stale) n.sea = null; return { said: `the catch was not accepted: ${a.error}` }; }
    s.base = { ticket: a.ticket, tick: caught.end }; moves.forget(caught.end);
    return { landed: a.landed, what: caught.what, said: a.landed ? `brought up ${caught.what === 'chest' ? `a chest: ${a.landed}` : `a ${a.landed}`}` : `brought up a ${caught.what}, but the storage was full` };
  }
  return { said: 'the game server kept saying it was too soon' };
}

// ---- the fishers' days
// Ten boats on free public nodes: they take their turns one after another with a pause between (12 to 22 s), ask for their
// wallet only now and then, and no more than three have a hook in the water at once. So the chain and the game's
// server are not crowded, and a player's own catch does not wait behind theirs.
const AT_SEA = 3;
export function startNpcs({ env, api, say = () => {} }) {
  // NPCS is a list of accounts. They get the fishers of npc-rules.js in order; "account=Name" picks one by name.
  const ids = String(env.NPCS || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.split('='));
  const urls = env.NEAR_RPC ? [env.NEAR_RPC] : NODES[env.NEAR_NETWORK || 'testnet'];
  const boats = ids.map(([account, called], i) => ({ account, who: FISHERS.find((f) => f.name === called) || FISHERS[i % FISHERS.length], call: signer(account, env, urls), turns: 0,
    memo: { day: null, quests: 0, topUps: 0, chests: 0, ticketNear: 0, bought: 0, near: 0, now: Date.now(), listed: {} }, doing: 'waking up', why: '', at: Date.now(), log: [], reasons: {}, sea: null }));
  let atSea = 0, quietUntil = 0;
  const QUIET_MS = 120_000;
  const note = (n, step, why, result) => {
    n.doing = step; n.why = why; n.at = Date.now();
    n.log.unshift({ at: n.at, step, why, result }); n.log.length = Math.min(n.log.length, 12);
    say(`${n.who.name} (${n.account}): ${step}${result ? ` -> ${result}` : ''}${spent.last && !['fishing', 'fish', 'rest', 'waiting'].includes(step) ? ` [${spent.last.toFixed(1)} Tgas]` : ''} | ${why}`);
    spent.last = 0;
  };
  const yocto = (price, amount) => BigInt(price) * BigInt(amount), inNear = (y) => Number(y / 10n ** 18n) / 1e6;
  async function turn(n) {
    const S = await view(urls, env.NEAR_CONTRACT, 'state', { account_id: n.account });
    const m = n.memo;
    if (S.quest.day !== m.day) Object.assign(m, { day: S.quest.day, quests: 0, topUps: 0, chests: 0, ticketNear: 0, bought: 0 });
    if (n.turns++ % 6 === 0) m.near = await walletNear(urls, n.account);
    m.now = Date.now();
    // what is remembered about its orders is kept only while they are up; one it did not see go up counts from now
    const up = new Set(S.orders.filter((o) => o.account === n.account).map((o) => o.id));
    for (const id of Object.keys(n.reasons)) if (!up.has(id)) delete n.reasons[id];
    for (const id of Object.keys(m.listed)) if (!up.has(id)) delete m.listed[id];
    for (const o of S.orders) if (o.account === n.account && !o.buying && !m.listed[o.id]) m.listed[o.id] = m.now;
    const d = decide(n.who, n.account, S, m);
    let result = '';
    const put = async (step, args, why) => { const id = await n.call(step, args); if (id != null) { n.reasons[String(id)] = why; if (step === 'list_item') m.listed[String(id)] = Date.now(); } };
    try {
      if (d.step === 'hand_in') { await n.call('hand_in', {}); m.quests += 1; m.chests = 0; result = 'a ticket'; }
      else if (d.step === 'claim') { await n.call('claim', {}); m.near = await walletNear(urls, n.account); }
      else if (d.step === 'enter_draw') await n.call('enter_draw', { amount: d.amount });
      else if (d.step === 'sell_tickets') await n.call('sell_tickets', { amount: d.amount, price: d.price });
      else if (d.step === 'fill_bid') await n.call('fill_bid', { order: d.order, amount: d.amount });
      else if (d.step === 'buy_tickets') { const cost = yocto(d.price, d.amount); await n.call('buy_tickets', { order: d.order, amount: d.amount }, cost); m.ticketNear += inNear(cost); m.bought += d.amount; m.near -= inNear(cost); }
      else if (d.step === 'bid_tickets') { const cost = yocto(d.price, d.amount); await n.call('bid_tickets', { amount: d.amount, price: d.price }, cost); m.ticketNear += inNear(cost); m.bought += d.amount; m.near -= inNear(cost); }
      else if (d.step === 'cancel_bid') await n.call('cancel_order', { order: d.order });
      else if (d.step === 'cancel') await n.call('cancel_item_order', { order: d.order });
      else if (d.step === 'reprice') { await n.call('cancel_item_order', { order: d.order }); await put('list_item', { token_id: d.token_id, amount: d.amount, price: String(d.price) }, d.why); }
      else if (d.step === 'make_room') { await n.call('cancel_item_order', { order: d.order }); await n.call('throw_back', { token_id: d.token_id, amount: d.amount }); }
      else if (d.step === 'sell_item') await n.call('sell_item', { order: d.order, amount: d.amount });
      else if (d.step === 'buy_item') await n.call('buy_item', { order: d.order, amount: d.amount });
      else if (d.step === 'list_item' || d.step === 'want_item') await put(d.step, { token_id: d.token_id, amount: d.amount, price: String(d.price) }, d.why);
      else if (d.step === 'throw_back') await n.call('throw_back', { token_id: d.token_id, amount: d.amount });
      else if (d.step === 'buy_bait') await n.call('buy_bait', { amount: d.amount });
      // better gear changes how the hook pulls: the next throw starts in a sea that knows the new reel
      else if (d.step === 'upgrade') { await n.call('upgrade', { what: d.what }); n.sea = null; }
      else if (d.step === 'top_up') { result = `${await n.call('top_up', {}, BigInt(Math.round(d.near * 1e6)) * 10n ** 18n)} coins`; m.topUps += 1; m.near -= d.near; }
      else if (d.step === 'fish') {
        if (atSea >= AT_SEA) { note(n, 'waiting', 'Three boats have their hooks down already: waits for a place.'); return 6000 + Math.random() * 6000; }
        atSea += 1;
        try { note(n, 'fishing', d.why); const r = await throwOnce(n, d.want, api); result = r.said; if (r.what === 'chest') m.chests += 1; } finally { atSea -= 1; }
      }
    } catch (e) { result = `could not: ${short(e)}`; if (tooMany(e)) quietUntil = Date.now() + QUIET_MS; }
    note(n, d.step, d.why, result);
    return d.step === 'rest' ? 90_000 : 25_000 + Math.random() * 20_000;
  }
  let on = true;
  boats.forEach((n, i) => (async () => {
    await sleep(2000 + i * 4000);
    while (on) {
      let pause = 30_000;
      // a node said "too many": every boat stays in for a while, so the nodes are left to the players
      if (Date.now() < quietUntil) { await sleep(quietUntil - Date.now() + Math.random() * 20_000); continue; }
      try { pause = await turn(n); } catch (e) { if (tooMany(e)) quietUntil = Date.now() + QUIET_MS; note(n, 'waiting', `Could not reach the chain: ${short(e)}`); }
      await sleep(pause);
    }
  })());
  return {
    stop() { on = false; },
    // what the game shows of them: who they are, what each is doing and why, and the reason behind each order
    status: () => boats.map((n) => ({ account: n.account, name: n.who.name, about: n.who.about, doing: n.doing, why: n.why, at: n.at, near: n.memo.near, quests: n.memo.quests, log: n.log.slice(0, 8), reasons: n.reasons })),
  };
}

// (for trying one throw against a server by hand: test/throw-once.mjs)
export { throwOnce, signer };
