// What the pages outside the game share: the account's corner of the top bar ("Connect wallet", or the
// account's name and "Sign out"), and for the Harbour and the ticket market the contract's state and a way to
// send it a call and say how that went.
import { account, signIn, signInWithAuth, signedInWithAuth, signOut, stillSignedIn, shortName, NETWORK } from './account.js';
import { load, reason, lastTransaction, txUrl, waiting, near, FAUCET, SIGN_FEE, outOfNear } from './chain.js';
import { NET } from './network.js';

// A page says some things that are only true on a test network (free NEAR, a faucet) and some only on the main
// one: they are marked data-testnet / data-mainnet, and the ones of the other network are taken out here.
for (const el of document.querySelectorAll(NETWORK === 'testnet' ? '[data-mainnet]' : '[data-testnet]')) el.remove();

// Connect a wallet and go on as that player: from the front page into the game, anywhere else the same page
// again. "say" shows a line of text when the wallet says no. (Connecting costs nothing. The game itself then sees
// to the NEAR, the 5 bait and the game's key, as for a NEAR Auth player.)
export async function connectWallet(say = () => {}) {
  try { await signIn(); if (document.getElementById('signin')) location.href = 'play'; else location.reload(); }
  catch (e) { say(/reject|cancel|closed|denied/i.test(String(e?.message)) ? 'Nothing was connected.' : `The wallet did not connect: ${e?.message || 'unknown reason'}`); }
}
// Sign in with NEAR Auth (Google, Apple, email) and go on to the game as that player. "say" shows what is going
// on: the sign-in window, the account. (The game itself then sees to the NEAR, the 5 bait and the game's key.)
export async function connectAuth(say = () => {}) {
  try {
    await signInWithAuth(say);
    location.href = 'play';
  } catch (e) {
    const text = String(e?.message || e);
    say(/popup|closed|cancel|denied|timeout/i.test(text) ? 'Nothing was signed in. (If no window opened, allow pop-ups for this site and try again.)' : `Signing in did not work: ${text.slice(0, 240)}`);
  }
}
export async function disconnectWallet() {
  await signOut();
  location.reload();
}

// ---- signing in
// One "Sign in" button everywhere. It opens a box with the two ways: NEAR Auth (Google, Apple or email, no wallet)
// and a NEAR wallet. What happens while signing in is said in the box.
let signBox = null;
// NEAR Auth signs people in only on the addresses it has been told about (src/network.js)
export const authOpen = !!NET.auth.clientId && (!NET.auth.onlyAt || location.origin === NET.auth.onlyAt);
export function openSignIn() {
  if (!signBox) {
    signBox = document.createElement('div');
    signBox.className = 'txbox signbox'; signBox.hidden = true;
    signBox.innerHTML = `<div class="txpanel" role="dialog" aria-modal="true" aria-labelledby="signTitle">
        <div class="signhead"><h2 id="signTitle">Sign in</h2><button class="btn small" type="button" data-sign="close" aria-label="Close">Close</button></div>
        <p class="signlead">Kail is played with an account on NEAR${NETWORK === 'testnet' ? ' (test network)' : ''}. Choose how you sign in:</p>
        <div class="signways">
          <button type="button" class="signway" data-sign="auth"${authOpen ? '' : ' disabled'}>
            <b>NEAR Auth</b><span>Sign in with Google, Apple or email.</span>
            <ul><li>An account is made for you, no wallet needed</li><li>Your NEAR is kept in the game: put it in or send it out at the Harbour</li><li>A top-up or a ticket buy costs ${near(SIGN_FEE)} NEAR on top, for the signing</li></ul>
          </button>
          ${authOpen ? '' : `<p class="signoff"><b>Not available at this address.</b> On the test network NEAR Auth's shared sign-in sends people back only to a game running at http://localhost:3000, not to a hosted address. Use a NEAR wallet here.</p>`}
          <button type="button" class="signway" data-sign="wallet">
            <b>NEAR wallet</b><span>Sign in with Meteor or another NEAR wallet.</span>
            <ul><li>You play as the account you already have</li><li>Your NEAR stays in your wallet: top-ups and ticket buys are approved there</li></ul>
          </button>
        </div>
        <p class="signnote"><b>Either way you start with 5 free bait.</b> Every action costs a tiny fee in NEAR, paid by your account${FAUCET ? `. On the test network NEAR is free at <a href="${FAUCET}" target="_blank" rel="noopener">the NEAR faucet</a>. No NEAR yet? Sign in anyway: the game checks your account and shows you how to get it` : ''}.</p>
        <p class="signsay" role="status" aria-live="polite"></p>
      </div>`;
    document.body.append(signBox);
    const tell = (text) => { signBox.querySelector('.signsay').textContent = text; };
    let busy = false;
    const close = () => { if (!busy) signBox.hidden = true; };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !signBox.hidden) close(); });
    signBox.addEventListener('click', async (e) => {
      if (e.target === signBox) return close();
      const b = e.target.closest('[data-sign]');
      if (!b || busy) return;
      if (b.dataset.sign === 'close') return close();
      busy = true; signBox.querySelectorAll('.signway').forEach((x) => { x.disabled = true; });
      if (b.dataset.sign === 'auth') await connectAuth(tell);
      else { signBox.hidden = true; await connectWallet(tell); signBox.hidden = false; }      // the wallets' own list opens in between
      busy = false; signBox.querySelectorAll('.signway').forEach((x) => { x.disabled = x.dataset.sign === 'auth' && !authOpen; });
    });
  }
  signBox.querySelector('.signsay').textContent = '';
  signBox.hidden = false;
  signBox.querySelector('.signway:not(:disabled)').focus();
}

export function mountAccount(say = () => {}) {
  const nav = document.querySelector('.nav nav');
  if (!nav) return;
  const box = document.createElement('span');
  box.className = 'who';
  const id = account(), auth = signedInWithAuth();
  // a NEAR Auth account is named by the game (kail-….testnet): shown without its ending, it fits
  const shown = id && (auth ? shortName(id.replace(/\.(testnet|near)$/, ''), 18) : shortName(id));
  // The account's name is a button: it opens a small card with the whole name, a way to copy it, and Sign out.
  // On a wide screen Sign out also stands beside the name; on a phone there is no room for that, so it is in the card.
  box.innerHTML = id
    ? `<button class="acct" type="button" data-who="menu" aria-haspopup="true" aria-expanded="false" title="${id} on NEAR ${NETWORK}">${shown}</button><button class="btn small out" type="button" data-who="out">Sign out</button>
       <div class="whomenu" hidden>
         <span class="sub">Signed in with ${auth ? 'NEAR Auth' : 'a wallet'} · ${NETWORK}</span>
         <code>${id}</code>
         <span class="row"><button class="btn small" type="button" data-who="copy">Copy name</button><button class="btn small" type="button" data-who="out">Sign out</button></span>
       </div>`
    : '<button class="btn small" type="button" data-who="in">Sign in</button>';
  nav.insertBefore(box, nav.querySelector('.btn.primary'));
  const menu = box.querySelector('.whomenu'), name = box.querySelector('.acct');
  const openMenu = (open) => { if (!menu) return; menu.hidden = !open; name.setAttribute('aria-expanded', String(open)); };
  document.addEventListener('click', (e) => { if (menu && !menu.hidden && !box.contains(e.target)) openMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu && !menu.hidden) { openMenu(false); name.focus(); } });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-who]');
    if (!b) return;
    if (b.dataset.who === 'in') return openSignIn();
    if (b.dataset.who === 'menu') return openMenu(menu.hidden);
    if (b.dataset.who === 'copy') {
      try { await navigator.clipboard.writeText(id); b.textContent = 'Copied'; } catch { b.textContent = 'Select it above'; }
      setTimeout(() => { b.textContent = 'Copy name'; }, 2000);
      return;
    }
    b.disabled = true;
    disconnectWallet().finally(() => { b.disabled = false; });
  });
  // the wallet may have been disconnected somewhere else since the last visit
  if (id) stillSignedIn().then((ok) => { if (!ok) location.reload(); });
}

// The player's own last transactions made from this browser (top-ups, tickets burned into the draw, NEAR
// collected, ticket trades): what it was, when, and the transaction's hash, so it can be looked up later too.
// The chain has all of them; this list only remembers which ones were this player's.
const txSlot = (id) => `kail.txs.${id}`;
export function myTransactions(id = account()) { try { return (id && JSON.parse(localStorage.getItem(txSlot(id)))) || []; } catch { return []; } }
function keepTransaction(id, text, tx) {
  if (!id || !tx) return;
  try { localStorage.setItem(txSlot(id), JSON.stringify([{ text, tx, at: Date.now() }, ...myTransactions(id)].slice(0, 10))); } catch { /* private mode */ }
}

// ---- the box that shows an action on its way
// Anything that goes to the chain takes a few seconds, more when NEAR Auth's window is in between. A box in the
// middle of the page says what was asked, where it stands (waiting for the approval, being signed, on its way),
// how long it has been, and how it ended, with a link to the transaction. It can be closed once it has ended.
function actionBox() {
  const box = document.createElement('div');
  box.className = 'txbox'; box.hidden = true;
  box.innerHTML = `<div class="txpanel" role="dialog" aria-modal="true" aria-labelledby="txTitle">
      <h2 id="txTitle"></h2>
      <ol class="txsteps"></ol>
      <p class="txnow" role="status" aria-live="polite"></p>
      <p class="txend" hidden></p>
      <div class="txfoot"><span class="txtime"></span><button class="btn primary small" type="button" data-tx="close" hidden>Close</button></div>
    </div>`;
  document.body.append(box);
  const el = (c) => box.querySelector(c);
  let clock = 0, started = 0, over = true, steps = [], cur = 0;
  const close = () => { if (over) { box.hidden = true; clearInterval(clock); } };
  box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-tx="close"]')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden) close(); });
  const paint = (at, failed = false) => { el('.txsteps').innerHTML = steps.map((t, i) => `<li class="${i < at ? 'done' : i === at ? (failed ? 'fail' : 'now') : ''}">${t}</li>`).join(''); };
  return {
    // `steps`: what the action goes through, in order
    open(title, list) {
      steps = list; over = false; started = Date.now(); cur = 0;
      el('#txTitle').textContent = title; el('.txnow').textContent = ''; el('.txend').hidden = true; el('.txend').className = 'txend';
      el('[data-tx="close"]').hidden = true; el('.txpanel').classList.remove('ok', 'bad');
      paint(0); box.hidden = false;
      clearInterval(clock);
      const tick = () => { el('.txtime').textContent = `${Math.round((Date.now() - started) / 1000)} s`; };
      tick(); clock = setInterval(tick, 1000);
    },
    // where it stands now: the step it has reached, and a line about it
    at(i, text = '') { if (over) return; cur = i; paint(i); el('.txnow').textContent = text; },
    end(ok, text, tx) {
      over = true; clearInterval(clock);
      // a failure stays marked at the step it happened in
      paint(ok ? steps.length : cur, !ok);
      el('.txpanel').classList.add(ok ? 'ok' : 'bad'); el('.txnow').textContent = '';
      const end = el('.txend'); end.hidden = false; end.className = `txend ${ok ? 'good' : 'bad'}`; end.textContent = text;
      if (tx) { const a = document.createElement('a'); a.href = txUrl(tx); a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'See the transaction'; end.append(document.createElement('br'), a); }
      // out of NEAR: where to get more, and the name the faucet asks for
      if (!ok && FAUCET && outOfNear(text)) { const a = document.createElement('a'); a.href = FAUCET; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open the NEAR faucet'; end.append(document.createElement('br'), a, ` and give it your account's name: ${account()}`); }
      const b = el('[data-tx="close"]'); b.hidden = false; b.focus();
    },
  };
}

// A page that shows the contract's state: reads it, draws it, reads it again now and then.
// page.act(call, done) sends one call for the player and says how it went in the page's status line.
export async function openPage(draw) {
  const me = account(), status = document.getElementById('status');
  let timer = 0;
  // a line of news for the player; with `tx`, a link to that transaction on an explorer, for anybody to check
  const say = (text, kind = 'good', tx = null) => {
    status.textContent = text; status.className = `status ${kind}`;
    if (tx) { const a = document.createElement('a'); a.href = txUrl(tx); a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'See the transaction'; status.append(' ', a); }
    clearTimeout(timer); timer = setTimeout(() => { status.textContent = ''; }, tx ? 30000 : 7000);
  };
  mountAccount((text) => say(text, 'bad'));
  const box = actionBox();
  let S = null;
  while (!S) { try { S = await load(me); } catch (e) { say(`Could not reach NEAR: ${reason(e)}. Trying again…`, 'bad'); await new Promise((r) => setTimeout(r, 3000)); } }
  const page = {
    me, say, busy: false,
    get S() { return S; },
    async refresh() { try { S = await load(me); draw(page); } catch { /* the next try will do */ } },
    // `what`: the action in a few words, for the box's heading ("Buying 1 ticket").
    // `approved`: true when the action moves NEAR, so a NEAR Auth player has to approve it in NEAR Auth's window.
    async act(call, done, what = 'Sending', approved = false) {
      if (page.busy) return;
      page.busy = true; draw(page);
      const auth = signedInWithAuth();
      const steps = auth && approved ? [`Approve it in NEAR Auth's window (${near(SIGN_FEE)} NEAR goes along for the signing)`, 'NEAR signs it (about 10 seconds)', 'It goes to the chain'] : auth ? ['It goes to the chain'] : ['Approve it in your wallet, if it asks', 'It goes to the chain'];
      box.open(what, steps);
      // NEAR Auth says where it is: its window, the signing, the sending
      waiting.tell = (text) => box.at(/Signed|Sending/i.test(text) ? 2 : /Approved|Signing/i.test(text) ? 1 : 0, text);
      try {
        const value = await call(), text = done ? done(value) : 'Done', tx = lastTransaction();
        keepTransaction(me, text, tx);
        box.end(true, text, tx);
      } catch (e) { box.end(false, reason(e)); }
      waiting.tell = () => {};
      page.busy = false;
      await new Promise((r) => setTimeout(r, 500));
      await page.refresh();
      setTimeout(page.refresh, 3000);
    },
  };
  draw(page);
  setInterval(() => { if (!document.hidden && !page.busy) page.refresh(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) page.refresh(); });
  return page;
}
