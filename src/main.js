// Starts the game: fits the screen, runs the loop, handles taps, and keeps the game in step with its contract.
//
// The sea, the hook and the pulling are played here, in the browser. Everything the player owns is on the
// contract: a cast spends a bait there. What swims in the sea is decided by the game's server; the game writes
// down what the player's hands do, and to land a catch it hands those moves in. The server plays them again
// in the same sea, sees for itself what came up, and has the contract put it in storage (src/replay.js).
import { W, ITEM_BY_ID, JUNK, RARE } from './config.js';
import { newWorld, newPlayer, step, cast, release } from './sim.js';
import { TICK, REST_TICKS, makeRecorder, roundX } from './replay.js';
import { loadArt, makeRenderer, BANDS } from './render.js';
import { makeUI } from './ui.js';
import { account, shortName, gameKeyWorks, enableGameKey, signedInWithAuth } from './account.js';
import { load, send, reason, waiting, near, walletBalance, allOrders, FAUCET, NEAR_TO_START, outOfNear } from './chain.js';
import { describe, news } from './history.js';
import { music } from './music.js';

for (const el of document.querySelectorAll(FAUCET ? '[data-mainnet]' : '[data-testnet]')) el.remove();      // (see src/nav.js)
music(document.getElementById('musicChip'));
const stage = document.getElementById('stage'), canvas = document.getElementById('sea');
const me = account();
// With nobody signed in this is a practice sea: the same sea, hook and pull, played here only. Nothing goes to the
// chain or to the game's server, nothing is kept, and what needs an account (the shop, the market, the quest's
// tickets) says so. It is there so that anybody can see how the game plays before they sign in.
const practice = !me;
const trial = { coins: '0', bait: '10', tickets: '0', items: [], held: 0, storage_cap: 16, reel: 0, storage: 0, casts: '0', open_cast: null, owed: '0', entered_today: 0 };
document.getElementById('who').textContent = me ? shortName(me, 18) : 'Sign in';
// (the practice sea has no coins and no tickets: their places in the top row say "Practice · Sign in" instead)
document.getElementById('practiceNote').classList.toggle('hidden', !practice);
for (const id of ['coinChip', 'ticketChip']) document.getElementById(id).classList.toggle('hidden', practice);

// Portrait first: the sea is always 180 game pixels wide; the height follows the screen.
let view = { h: 320, scale: 2, sky: 0 }, renderer = null, desk = false, ui = null;
function fit() {
  const vw = window.innerWidth, vh = window.innerHeight;
  // A wide window is not a big phone: the sea keeps its tall shape in the middle and the menus sit beside it.
  desk = vw >= 1000 && vw / vh >= 1.2;
  document.body.classList.toggle('desk', desk);
  // On a wide window the counters get a bar of their own across the top, and the sea starts under it.
  // du is the pixel size of that bar and of the side menus: it follows the window's height, within limits.
  const du = Math.max(1.5, Math.min(2.25, vh / 450)), bar = desk ? Math.round(26 * du) : 0;
  const viewH = desk ? 360 : Math.max(300, Math.min(400, Math.round((W * vh) / vw)));
  const u = desk ? (vh - bar) / viewH : Math.min(vw / W, vh / viewH);
  // extra sky above the boat, so it does not sit right under the counters (a wide window has room for more)
  view = { h: viewH, scale: u * (window.devicePixelRatio || 1), sky: desk ? 44 : 28 };
  if (renderer) renderer.resize(view.h, view.scale, view.sky);
  if (ui) ui.setDesk(desk);
  stage.style.width = `${Math.floor(W * u)}px`; stage.style.height = `${Math.floor(viewH * u)}px`;
  const root = document.documentElement.style;
  root.setProperty('--u', `${u}px`); root.setProperty('--du', `${du}px`); root.setProperty('--bar', `${bar}px`); root.setProperty('--sky', view.sky);
  wideSea(u, bar);
}
// On a wide screen the page behind the menus is the same water as in the middle: the same bands of colour at the
// same heights, and it slides with the view when the hook goes down. So the window is one sea, not a phone on a desk.
let seaU = 0, seaY = null, seaTop = 0;
const SKY_TOP = BANDS[0][0];      // the painted sky starts this far above y = 0
function wideSea(u, top) {
  const b = document.body.style;
  seaU = desk ? u : 0; seaY = null; seaTop = top;
  if (!desk) { b.backgroundImage = b.backgroundSize = b.backgroundPositionY = b.backgroundColor = ''; return; }
  const stops = [];
  for (let i = 0; i < BANDS.length - 1; i++) stops.push(`${BANDS[i][1]} ${(BANDS[i][0] - SKY_TOP) * u}px`, `${BANDS[i][1]} ${(BANDS[i + 1][0] - SKY_TOP) * u}px`);
  b.backgroundImage = `linear-gradient(to bottom, ${stops.join(', ')})`;
  b.backgroundSize = `100% ${(BANDS[BANDS.length - 1][0] - SKY_TOP) * u}px`;
  b.backgroundColor = BANDS[BANDS.length - 2][1];
}
function slideSea(cam) {
  if (!seaU || cam === seaY) return;
  seaY = cam;
  document.body.style.backgroundPositionY = `${seaTop - (cam - SKY_TOP) * seaU}px`;
}
fit();
window.addEventListener('resize', fit);

const say = (text) => { const el = document.getElementById('loading'); if (el) el.textContent = text; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (path, data) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
// ---- the player's sea
// The server decides what swims in it: it gives a number to grow the sea from, and a signed ticket for it.
async function askSea() {
  if (practice) return { seed: Math.floor(Math.random() * 2 ** 32), ticket: null, reel: 0 };
  for (;;) {
    let none = false;
    try { const r = await post('api/sea', { account: me }); const a = await r.json(); if (r.ok && a.ticket) return a; none = r.status === 503; } catch { /* asked again below */ }
    say(none ? 'This copy of the game has no game server of its own (no server key). Start it with KAIL_SERVER=<the hosted address> npm start, or sign out to use the practice sea.' : 'Could not reach the game server. Trying again…');
    await wait(3000);
  }
}
const seaAsked = askSea();
const art = await loadArt();
const firstSea = await seaAsked;
const world = newWorld(firstSea.seed);
renderer = makeRenderer(canvas, art);
renderer.resize(view.h, view.scale, view.sky);
// The sea moves in steps of a fixed length, counted in `tick`. `base` is the server's latest ticket for this sea
// and the step it stands at; `moves` holds what the hands did since. A catch hands in the moves from there on.
const moves = makeRecorder();
let tick = 0, backTick = -REST_TICKS, base = { ticket: firstSea.ticket, tick: 0 };
let stale = false, landings = 0, keeping = null;

// ---- the contract's state, and a copy of the player's part of it that the sea plays with
// (the state comes with the first hundred market orders; a fuller market is read to its end)
async function loadAll() {
  const s = await load(me);
  if (practice) { s.me = trial; s.events ||= []; }      // the chain's quest and market, and a player that lives here
  if (s.orders.length >= 100) { try { s.orders = await allOrders('item_orders', s.orders); } catch { /* the first hundred will do */ } }
  return s;
}
let S = null;
while (!S) {
  try { S = await loadAll(); } catch (e) { say(`Could not reach NEAR: ${reason(e)}. Trying again…`); await new Promise((r) => setTimeout(r, 3000)); }
}
const player = newPlayer();
let casting = 0;                       // casts sent to the chain and not confirmed yet
const landing = {};                    // fish brought up here that the chain has not put in storage yet
function mirror() {
  const m = S.me;
  player.coins = +m.coins; player.tickets = +m.tickets;
  player.bait = Math.max(0, +m.bait - casting);
  player.up = { reel: m.reel, storage: m.storage };
  player.storage = Object.fromEntries(m.items.map(([id, n]) => [id, +n]));
  for (const [id, n] of Object.entries(landing)) if (n > 0) player.storage[id] = (player.storage[id] || 0) + n;
}
mirror();

// ---- telling the player what somebody else did: a sale to them, a purchase from them, a prize
// The contract writes a line into each account's history for both sides of every trade, so nothing depends on
// this game having been open. Lines the player has not been told about yet are shown as messages; all of them
// are in the History tab.
function announce() {
  if (practice) return;
  const fresh = news(me, S.events);
  for (const e of fresh.slice(0, 3).reverse()) {
    const { text, pic } = describe(e);
    ui.toast(`${pic ? (ITEM_BY_ID[pic] ? ui.pic(pic, 22, 12) : ui.icon(pic, 0.7)) : ''} ${text}`, 'good', 6500);
  }
  if (fresh.length > 3) ui.toast(`…and ${fresh.length - 3} more in History`, 'good', 6500);
}

// The other boats: fishers the computer plays (server/npc.mjs). The game's server says who they are, what each is
// doing and why; their orders and tickets are on the contract like everybody's.
let boats = [];
async function readBoats() { try { const r = await fetch('api/npcs'); if (r.ok) boats = await r.json(); } catch { /* shown as they were */ } }
readBoats();
const game = {
  account: me,
  get boats() { return boats; },
  get storageFull() { return storageFull(); },
  busy: false,
  get state() { return S; },
  get questEnds() { return S.at + S.quest.ends_in_ms; },
  async refresh() {
    try { [S] = await Promise.all([loadAll(), readBoats()]); mirror(); announce(); ui.refresh(); } catch { /* the next try will do */ }
  },
  // One call to the contract for the player: wait for it, say how it went, and read the state again.
  // A read right after a write can still show the old state, so the state is read once more a little later.
  // `doing` is shown while the call is on its way, so a press is never met with silence.
  async act(call, done, doing = 'Sending to NEAR…') {
    if (practice) { ui.toast('This is a practice sea. Sign in (front page) to buy, trade and earn tickets for real.', '', 4500); return; }
    if (game.busy || firstSteps()) return;
    game.busy = true; ui.refresh();
    const stop = ui.working(doing);
    try { const value = await call(); stop(); const text = done?.(value); if (text) ui.toast(text, 'good', 3200); }
    catch (e) { stop(); ui.toast(reason(e), 'bad', 4500); if (outOfNear(e)) nearFirst(); }
    game.busy = false;
    await new Promise((r) => setTimeout(r, 500));
    await game.refresh();
    setTimeout(game.refresh, 3000);
  },
};
ui = makeUI({ art, player, game });
ui.setDesk(desk);
announce();      // what happened while the game was closed
// a line for what NEAR Auth is waiting for (an approval in its window, the signing)
waiting.tell = (text) => ui.toast(text, '', 4000);
document.getElementById('loading').remove();
// ---- a player's first steps: NEAR for the fees, the 5 bait of welcome, the game's key
// Every action is a transaction that the player's own account pays a tiny fee for, so nothing works without NEAR.
// The game gives none: on the test network it is free at the public faucet. A player whose account holds too
// little is told so before anything else, with the account's name to copy and the way to the faucet; the game
// looks every few seconds and goes on by itself once the NEAR is there.
let nearAsked = null;
// (a balance that cannot be read right now is not a reason to stop anybody)
const nearHeld = async () => { try { return BigInt((await walletBalance(me)) ?? 0); } catch { return null; } };
const tooLittleNear = async () => { const has = await nearHeld(); return has != null && has < NEAR_TO_START; };
function nearFirst() {
  return (nearAsked ||= (async () => {
    const box = document.getElementById('nearAsk'), read = nearHeld;
    let has = await read();
    if (has == null || has >= NEAR_TO_START) return;
    document.getElementById('nearAskId').textContent = me;
    document.getElementById('nearAskNeeds').textContent = near(NEAR_TO_START);
    if (FAUCET) document.getElementById('nearAskOpen').href = FAUCET;
    box.classList.remove('hidden');
    while (has != null && has < NEAR_TO_START) {
      document.getElementById('nearAskHas').textContent = near(has);
      await wait(4000);
      if (document.hidden) continue;
      has = await read();
    }
    box.classList.add('hidden');
    if (has != null) ui.toast(`Your NEAR is here: you hold ${near(has)} NEAR`, 'good', 5000);
  })().finally(() => { nearAsked = null; }));
}
document.getElementById('nearAskCopy').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  try { await navigator.clipboard.writeText(me); b.textContent = 'Copied'; } catch { b.textContent = 'Select the name above and copy it'; }
  setTimeout(() => { b.textContent = "Copy my account's name"; }, 2500);
});
// The 5 bait of welcome, for every new account whichever way it signed in. The game's server has the contract hand
// them over, once per account; this browser remembers that it asked.
async function welcome() {
  const slot = `kail.welcomed.${me}`;
  try { if (localStorage.getItem(slot)) return; } catch { /* asked again next time */ }
  try {
    const r = await post('api/welcome', { account: me }), a = await r.json().catch(() => ({}));
    if (!r.ok) return;
    try { localStorage.setItem(slot, '1'); } catch { /* private mode */ }
    if (a.bait) { ui.toast(`Welcome aboard! ${a.bait} bait are in your box, on the house.`, 'good', 8000); await game.refresh(); setTimeout(game.refresh, 3000); }
  } catch { /* the next visit asks again */ }
}
// The game's own key: one approval, and the game signs its small actions itself. It is asked for once and has to
// be given: without it every cast would open the wallet (or NEAR Auth's window), which is no way to fish.
// While the game waits for the player's NEAR or for this approval, the sea behind the sheet cannot be played.
const firstSteps = () => ['nearAsk', 'keyAsk'].some((id) => !document.getElementById(id).classList.contains('hidden'));
new MutationObserver(() => document.getElementById('askShade').classList.toggle('hidden', !firstSteps()))
  .observe(document.getElementById('stage'), { subtree: true, attributes: true, attributeFilter: ['class'] });
{
  const box = document.getElementById('keyAsk'), tell = document.getElementById('keyAskSay'), yes = document.getElementById('keyAskYes');
  // a player who signed in with NEAR Auth has no wallet: the same approval happens in NEAR Auth's window
  if (signedInWithAuth()) {
    document.getElementById('keyAskTitle').textContent = 'One approval, then no more windows';
    yes.textContent = 'Approve once';
    document.getElementById('keyAskHow').textContent = "That key can only do the game's own actions on the game's contract. It can never send NEAR: topping up and buying tickets still ask you in NEAR Auth's window.";
  }
  if (practice) ui.toast('Practice sea: nothing here is saved or on the chain. Press CAST to try.', 'good', 7000);
  else nearFirst().then(welcome).then(() => gameKeyWorks(me)).then((ok) => { if (!ok) box.classList.remove('hidden'); ui.refresh(); });
  const said = (text) => { tell.textContent = text; tell.hidden = !text; };
  yes.addEventListener('click', async () => {
    yes.disabled = true; said(signedInWithAuth() ? "Waiting for NEAR Auth's window…" : 'Waiting for your wallet…');
    try { await enableGameKey(me, said); box.classList.add('hidden'); said(''); ui.toast('The game signs its small actions itself now', 'good'); ui.refresh(); }
    catch (e) {
      // Whatever the wallet said (wallets word it each in their own way, or just close): look at the account's
      // NEAR. With too little, the way to the faucet is shown first, and this approval comes back after it.
      const low = await tooLittleNear();
      said(low ? 'That did not work: your account holds too little NEAR for the fee.' : `That did not work: ${reason(e)}`);
      if (low) { box.classList.add('hidden'); await nearFirst(); said(''); box.classList.remove('hidden'); }
    }
    yes.disabled = false;
  });
}
// other players change the market and the quest's stock: look again now and then, and when the day turns
setInterval(() => { if (!document.hidden && !game.busy) game.refresh(); }, 15000);
setInterval(() => { if (Date.now() > game.questEnds + 1500 && !game.busy) game.refresh(); }, 2000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) game.refresh(); });

// ---- casting and landing
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const JUNK_NAME = Object.fromEntries(JUNK.map((j) => [j.id, j.name]));
let throwNow = null;                   // the cast that is in the water: { secret, number }
let lastLanding = Promise.resolve();   // a new cast waits for the catch before it, so it cannot replace it on the chain
let hints = 0, pullHints = 0;

// The hook is thrown with the CAST button or Space, never by a tap on the sea: while pulling a catch up the
// player is pressing and letting go all the time, and one press too many must not throw the hook again.
// For the same reason a throw waits a moment after the hook is back (REST_TICKS: the server holds to it too).
// How full the storage is right now: what the sea here has brought up (also what is still on its way to the
// chain) plus the boxes the market holds.
const boxesUsed = () => Object.values(player.storage).reduce((a, n) => a + n, 0) + Math.max(0, S.me.held - S.me.items.reduce((a, [, n]) => a + +n, 0));
const storageFull = () => boxesUsed() >= S.me.storage_cap;
function tryCast() {
  if (world.hook.state !== 'idle' || tick - backTick < REST_TICKS || firstSteps()) return;
  if (stale) { ui.toast('One moment: bringing your sea back in step…', '', 2500); return; }
  // no room for a catch: do not throw (the contract would refuse it too)
  if (storageFull()) { ui.toast('Storage is full. Sell something, throw it back, or get more room first.', 'bad', 3500); return; }
  if (player.bait <= 0) { ui.toast(player.coins >= 2 ? 'No bait left. Buy some in the Shop.' : 'No bait and no coins. Top up at the Harbour.', 'bad'); return; }
  if (!cast(world, player)) return;
  moves.did(tick, 'c');
  ui.close();
  // The cast goes to the chain while the hook sinks. It is sealed with the hash of a secret made up here;
  // landing it needs that secret, so only this game can have this cast landed.
  const secret = crypto.getRandomValues(new Uint8Array(16));
  casting += 1;
  const number = practice ? Promise.resolve(practiceCast())
    : lastLanding.then(async () => String(await send('cast', { seal: b64(new Uint8Array(await crypto.subtle.digest('SHA-256', secret))) })));
  // a throw the chain never saw is in this sea all the same: the sea is out of step and has to be started anew
  number.then(() => {}, (e) => { stale = true; ui.toast(`The cast did not reach the chain: ${reason(e)}`, 'bad'); if (outOfNear(e)) nearFirst(); }).finally(() => { casting -= 1; setTimeout(game.refresh, 800); });
  throwNow = { secret: b64(secret), number };
  if (hints++ < 2) ui.toast(matchMedia('(pointer: coarse)').matches ? 'Drag left or right to steer' : 'Move the mouse or press ← → to steer');
}
document.getElementById('btnCast').addEventListener('click', tryCast);
// "Drop" throws the catch away. It does nothing in its first half second, so a press that was already on its
// way when the button appeared cannot cost a catch.
document.getElementById('btnRelease').addEventListener('click', (e) => {
  if (performance.now() - (+e.currentTarget.dataset.since || 0) < 500) return;
  drop();
});
function drop() { if (release(world)) moves.did(tick, 'r'); }

// Hand in the moves up to this catch. The server plays them again and answers with what went into storage (for
// a chest: what was inside), or with nothing when the storage was full; and with a ticket for the sea as it is now.
// In the practice sea a throw costs one of ten bait that fill up again by themselves, and a catch goes into a
// storage that only this page knows (a chest holds one of its three finds, each as likely as the others).
function practiceCast() {
  trial.bait = String(+trial.bait - 1); trial.casts = String(+trial.casts + 1);
  if (+trial.bait < 1) { trial.bait = '10'; ui.toast('Practice bait is free: ten more.', '', 3000); }
  return trial.casts;
}
function practiceLand(ev) {
  const kind = ev.chest ? RARE[Math.floor(Math.random() * RARE.length)].id : ev.id, had = trial.items.reduce((a, [, n]) => a + +n, 0);
  if (had >= trial.storage_cap) return null;
  const row = trial.items.find(([id]) => id === kind);
  if (row) row[1] = String(+row[1] + 1); else trial.items.push([kind, '1']);
  trial.held = had + 1;
  return kind;
}
async function land(thrown, endTick, ev) {
  landings += 1;
  try {
    if (practice) { await wait(300); return practiceLand(ev); }
    const castNumber = await thrown.number;
    if (keeping) await keeping;
    for (let tries = 0; tries < 6; tries++) {
      const r = await post('api/land', { account: me, cast: castNumber, secret: thrown.secret, ticket: base.ticket, ticks: endTick - base.tick, moves: moves.cut(base.tick, endTick) });
      const answer = await r.json().catch(() => ({}));
      if (r.status === 425 && answer.retry_in_ms) { await wait(answer.retry_in_ms + 200); continue; }
      if (!r.ok) { if (answer.stale) stale = true; throw new Error(answer.error || 'The game server did not answer'); }
      base = { ticket: answer.ticket, tick: endTick };
      moves.forget(endTick);
      return answer.landed;
    }
    throw new Error('The game server kept saying it was too soon');
  } finally { landings -= 1; }
}
// Nothing caught for a while: hand the moves in anyway, so that no record grows long. After 45 seconds when the
// player has been throwing (and missing), after two and a half minutes when the sea was only watched.
const KEEP_BUSY = 45 * 240, KEEP_QUIET = 150 * 240;
function keepSea() {
  if (practice || keeping || stale || landings || casting || world.hook.state !== 'idle') return;
  const played = tick - base.tick;
  if (played < KEEP_BUSY || (played < KEEP_QUIET && moves.since(base.tick) < 2)) return;
  const end = tick;
  keeping = (async () => {
    const r = await post('api/sea/keep', { ticket: base.ticket, ticks: end - base.tick, moves: moves.cut(base.tick, end) });
    const answer = await r.json().catch(() => ({}));
    if (r.ok && answer.ticket) { base = { ticket: answer.ticket, tick: end }; moves.forget(end); }
    else if (answer.stale) stale = true;
  })().catch(() => {}).finally(() => { keeping = null; });
}
// The sea here and the chain have lost step (a cast that never arrived, a second window, a lost answer): when
// the hook is home and nothing is on its way, start a new sea from the server.
let mending = false;
async function mendSea() {
  if (mending || !stale) return;
  mending = true;
  while (world.hook.state !== 'idle' || landings || casting || keeping) await wait(250);
  const fresh = await askSea();
  Object.assign(world, newWorld(fresh.seed));
  moves.reset(); tick = 0; backTick = -REST_TICKS; base = { ticket: fresh.ticket, tick: 0 }; reelSeen = fresh.reel;
  stale = false; mending = false;
}
setInterval(() => { if (stale) mendSea(); else keepSea(); }, 3000);

// Steering: the hook follows the finger (or the mouse) left and right while it sinks. Arrow keys work too.
let pointerX = null, keyDir = 0, pressed = false, spaceHeld = false;
const keys = new Set();
const gameX = (e) => { const r = canvas.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * W; };
canvas.addEventListener('pointerdown', (e) => {
  if (ui.open) { ui.close(); return; }
  pointerX = gameX(e);
  pressed = true;
  if (e.pointerType !== 'mouse') { try { canvas.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ } }
});
canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.pressure > 0) pointerX = gameX(e); });
for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, (e) => { pressed = false; if (e.pointerType !== 'mouse') pointerX = null; });
window.addEventListener('pointerup', () => { pressed = false; });
canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') pointerX = null; });
const DIRS = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };
const readKeys = () => { keyDir = [...keys].reduce((a, k) => a + DIRS[k], 0); };
window.addEventListener('keydown', (e) => {
  if (e.code in DIRS) { e.preventDefault(); keys.add(e.code); readKeys(); }
  if (e.code === 'Space') { e.preventDefault(); spaceHeld = true; if (!e.repeat) tryCast(); }
  if (e.code === 'KeyX') drop();
  if (e.code === 'Escape') ui.close();
});
window.addEventListener('keyup', (e) => { if (e.code in DIRS) { keys.delete(e.code); readKeys(); } if (e.code === 'Space') spaceHeld = false; });
window.addEventListener('blur', () => { keys.clear(); readKeys(); pointerX = null; pressed = false; spaceHeld = false; });

function handle(ev) {
  if (ev.type === 'landed') {
    const thrown = throwNow, name = ITEM_BY_ID[ev.id].name;
    if (ev.chest) {
      // the sea here only knows that it was a chest: what is inside is decided on the chain
      player.storage[ev.id] -= 1; if (!player.storage[ev.id]) delete player.storage[ev.id];
      ui.toast('A chest! Opening it…', 'good');
    } else {
      landing[ev.id] = (landing[ev.id] || 0) + 1;
      ui.toast(`${ui.pic(ev.id, 22, 12)} ${name}!`, 'good');
    }
    lastLanding = land(thrown, tick, ev).then((kind) => {
      if (ev.chest) ui.toast(kind ? `${ui.pic(kind, 22, 12)} Chest: ${ITEM_BY_ID[kind].name}!` : 'Storage was full: the chest find is lost.', kind ? 'good' : 'bad');
      else if (!kind) ui.toast(`Storage was full: the ${name.toLowerCase()} is lost.`, 'bad');
    }, (e) => ui.toast(`The ${ev.chest ? 'chest' : name.toLowerCase()} is lost: ${reason(e)}`, 'bad')).finally(() => {
      if (!ev.chest) landing[ev.id] -= 1;
      return game.refresh();
    });
  }
  else if (ev.type === 'junk') ui.toast(`Just a ${JUNK_NAME[ev.id].toLowerCase()}…`, 'bad');
  else if (ev.type === 'full') ui.toast(`Storage full. The ${ITEM_BY_ID[ev.id].name.toLowerCase()} is lost.`, 'bad');
  else if (ev.type === 'miss') ui.toast('Sea floor, nothing here', '');
  else if (ev.type === 'snapped') ui.toast(ev.kind === 'chest' ? 'The chest slipped back to the bottom.' : `The ${ITEM_BY_ID[ev.id].name.toLowerCase()} got away!`, 'bad');
  else if (ev.type === 'hooked' && pullHints < 3) {
    pullHints += 1;
    const press = matchMedia('(pointer: coarse)').matches ? 'Hold the screen' : 'Hold the mouse button or Space';
    if (ev.kind !== 'junk') ui.toast(`${press}: the box goes right. Let go: it slides left. Keep the catch inside!`);
  }
  if (ev.type !== 'hooked') ui.refresh();
}

let last = performance.now(), t = 0, owed = 0, reelSeen = firstSea.reel;
function frame(now) {
  requestAnimationFrame(frame);          // ask for the next frame first, so one bad frame cannot stop the game
  // the first frame's clock can be a hair earlier than "last": never let time run backwards
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now; t += dt; owed += dt;
  // The hands, as they are for this frame. Only what matters is passed on (and written down): steering while
  // the hook sinks, holding while it is out.
  const h = world.hook, sinking = h.state === 'out';
  h.steer = sinking ? Math.sign(keyDir) : 0;
  h.hold = h.state !== 'idle' && (pressed || spaceHeld);
  h.targetX = sinking && !keyDir ? roundX(pointerX) : null;
  moves.hands(tick, h.steer, h.hold, h.targetX);
  if (player.up.reel !== reelSeen) { reelSeen = player.up.reel; moves.did(tick, 'u', reelSeen); }
  // the sea moves in whole steps; what is left of the frame's time is kept for the next frame
  while (owed >= TICK) {
    owed -= TICK;
    const out = h.state !== 'idle';
    step(world, player, TICK); tick += 1;
    if (out && h.state === 'idle') backTick = tick;      // the hook is back at the boat: the CAST button rests for a moment
    for (const ev of world.events.splice(0)) handle(ev);
  }
  slideSea(renderer.draw(world, dt, t));
  ui.hud(world);
}
requestAnimationFrame(frame);

// for looking at the game from the browser console
window.kail = { world, player, game, ui, announce, sea: { get tick() { return tick; }, get base() { return base; }, get stale() { return stale; }, set stale(v) { stale = v; }, moves } };
