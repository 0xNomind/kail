// The Harbour: the NEAR side of the game. Top up coins, enter the draw, collect prizes.
// Everything shown comes from the contract; every button sends it a call.
import { loadArt } from './render.js';
import { paintIcons } from './sprites.js';
import { openPage, myTransactions } from './nav.js';
import { send, sendNear, near, toYocto, walletBalance, txUrl, dayNote, AT_HAND, FAUCET, SIGN_FEE } from './chain.js';
import { NET } from './network.js';
import { signedInWithAuth } from './account.js';

paintIcons(await loadArt());
const $ = (id) => document.getElementById(id);
const N = (yocto) => `${near(yocto)} NEAR`;
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const PACKS = [0.01, 0.1, 0.5];
// while an action runs NEAR holds back about 0.016 NEAR (it comes back, but for the fee): with less than that at
// hand nothing goes through
const LOW = AT_HAND;
const auth = signedInWithAuth();

let wallet = null, ends = 0;
async function extras(page) {
  wallet = page.me ? await walletBalance(page.me).catch(() => null) : null;
}
// when a draw closed, in words: "today 14:35", "yesterday 09:10", "3 Nov, 18:00"
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
function when(ms) {
  const d = new Date(ms), now = new Date(), day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), back = Math.round((day(now) - day(d)) / 86400000);
  return back === 0 ? `Today, ${time}` : back === 1 ? `Yesterday, ${time}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

function draw(page) {
  const { S, me } = page, m = S.me, d = S.draw, off = page.busy ? 'disabled' : '';
  ends = S.at + Number(d.ends_in_ms);
  $('wallet').textContent = !me ? 'not connected' : wallet == null ? '...' : N(wallet);
  $('coins').textContent = m ? m.coins : '-';
  $('tickets').textContent = m ? m.tickets : '-';

  const owed = m ? BigInt(m.owed) : 0n;
  $('collect').hidden = owed === 0n;
  $('owedLine').textContent = `${N(owed)} is waiting for you: prizes you won and tickets you sold.`;
  $('claim').disabled = page.busy;

  // a player who signed in with NEAR Auth: their NEAR is in the account itself, so the Harbour is also their wallet
  $('purse').hidden = !(auth && me);
  if (auth && me) {
    $('purseHas').textContent = wallet == null ? '...' : N(wallet);
    $('purseId').textContent = me;
    $('outSend').disabled = page.busy;
  }
  // too little NEAR to do anything, whichever way the player signed in: say so, and where NEAR comes from
  const short = !!me && wallet != null && BigInt(wallet) < LOW;
  $('lowNear').hidden = !short;
  if (short) $('lowNear').innerHTML = `<b>Too little NEAR to do anything here.</b> An action costs only about 0.0003 NEAR, but ${near(AT_HAND)} NEAR has to be at hand while it runs, and your account holds ${N(wallet)}.${FAUCET ? ` Test NEAR is free: open <a href="${FAUCET}" target="_blank" rel="noopener">the NEAR faucet</a> and give it your account's name, <code>${esc(me)}</code>.` : ''}`;

  // what a coin costs today: it goes with today's prize, and both are set when the day begins
  const price = BigInt(S.coinPrice), coinsFor = (n) => (BigInt(toYocto(n)) / price).toString();
  const cap = d.cap || 500, perPlayer = d.per_player || 10, win = BigInt(d.pool) / 100n;
  $('priceLine').innerHTML = `Today <b>1 NEAR buys ${coinsFor(1)} coins</b> (a coin is ${near(S.coinPrice)} NEAR). The price of a coin goes with today's prize: the bait for one ticket costs about a fifth of what a winning ticket gets. So a bigger prize makes coins dearer, a smaller one cheaper.`;
  $('packs').innerHTML = me
    ? PACKS.map((n) => { const short = wallet != null && BigInt(wallet) < BigInt(toYocto(n)) + LOW; return `<div class="pack"><span><b>${coinsFor(n)} coins</b> for ${n} NEAR</span><button class="btn primary small" data-act="topup" data-n="${n}" ${short ? 'disabled title="You hold less NEAR than that"' : off}>Top up ${n} NEAR</button></div>`; }).join('')
    : '<p class="note">Connect your wallet (top right) to top up.</p>';

  const about = dayNote(S.dayMs);
  $('dayNote').hidden = !about; $('dayNote').textContent = about;
  const mine = m ? m.entered_today : 0, tickets = Number(d.tickets);
  // A day's draw takes `cap` tickets, `perPlayer` from one player. One ticket in five wins; a winning ticket gets a
  // hundredth of the prize. What is not won goes back into the vault.
  $('stats').innerHTML = [
    ["Today's prize", N(d.pool)], ['A winning ticket gets', N(win)],
    ['Tickets in the draw', `${tickets} of ${cap}`], ['Yours in it', `${mine} of ${perPlayer}`],
    ['In the vault for later days', N(S.vault)], ['Draw is held in', `<span id="clock">${mmss(ends - Date.now())}</span>`],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  const likely = tickets >= 5 ? `${tickets % 5 ? 'about ' : ''}${Math.max(1, Math.round(tickets / 5))} of the ${tickets} tickets in now will win` : `with ${plural(tickets, 'ticket')} in, each has its one chance in five`;
  $('drawNote').textContent = `${d.fixed ? "Today's prize is fixed." : "Today's prize is fixed with the first action of the day; this is what it will be."} ${
    tickets === 0 ? 'No tickets are in yet.' : `One ticket in five wins ${N(win)}: ${likely}.`} What is topped up today counts for the days after.`;
  const have = m ? Number(m.tickets) : 0, room = Math.max(0, Math.min(perPlayer - mine, cap - tickets)), most = Math.min(have, room);
  $('enter').innerHTML = !me ? '<span class="note">Connect your wallet to enter.</span>'
    : `<button class="btn primary small" data-act="enter" data-n="1" ${most ? off : 'disabled'}>Burn 1 ticket</button>
       ${most > 1 ? `<button class="btn small" data-act="enter" data-n="${most}" ${off}>Burn ${most === have ? `all ${most}` : `${most} (all that fit)`}</button>` : ''}
       ${!have ? '<span class="note">You hold no tickets. Finish the daily quest in the game, or buy one on the ticket market.</span>'
          : tickets >= cap ? `<span class="note">Today's draw is full (${cap} tickets). Your tickets keep: enter the next one, or sell them.</span>`
          : mine >= perPlayer ? `<span class="note">You have ${perPlayer} tickets in today's draw, the most one player can. The rest keep for the next one.</span>` : ''}`;
  // earlier draws: only the ones that had tickets in them, by when they closed
  $('results').innerHTML = S.pastDraws.map((p) => {
    const n = Number(p.tickets);
    const proof = p.tx ? `<a class="sub" href="${txUrl(p.tx)}" target="_blank" rel="noopener">See the draw on chain</a>` : p.settled ? '<span class="sub">held on chain</span>' : '';
    const result = (p.settled ? `<b class="win">${plural(p.winners, 'ticket')} won ${N(p.prize_each)} each</b>` : '<b>waiting to be held</b>') + proof;
    return `<li><span><b>${when(Number(p.ended_at))}</b><span class="sub">${plural(n, 'ticket')} in the draw${p.settled ? ` · ${N(p.pool)} paid out` : ''}${p.yours ? ` · ${p.yours} of them yours` : ''}</span></span><span class="res">${result}</span></li>`;
  }).join('') || '<li class="none">No draw has had tickets in it yet. Burn a ticket above to be in the first one.</li>';

  // the player's own last transactions from this browser, each with its link
  const txs = myTransactions(me);
  $('mine').hidden = !txs.length;
  $('mineList').innerHTML = txs.map((t) => `<li><span><b>${esc(t.text)}</b><span class="sub">${when(t.at)}</span></span><span class="res"><a href="${txUrl(t.tx)}" target="_blank" rel="noopener">See the transaction</a></span></li>`).join('');

  const sales = S.ticketOrders.filter((o) => !o.buying), bids = S.ticketOrders.filter((o) => o.buying);
  const low = sales.length ? sales.reduce((a, o) => (BigInt(o.price) < BigInt(a) ? o.price : a), sales[0].price) : null;
  const best = bids.length ? bids.reduce((a, o) => (BigInt(o.price) > BigInt(a) ? o.price : a), bids[0].price) : null;
  $('tstats').innerHTML = [['Lowest price', low ? N(low) : 'none for sale'], ['Best offer', best ? N(best) : 'no offers'], ['For sale', sales.reduce((a, o) => a + o.amount, 0)], ['Wanted', bids.reduce((a, o) => a + o.amount, 0)]]
    .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}

const page = await openPage(draw);
// for looking at the page from the browser console
window.kail = { page, draw };
await extras(page); draw(page);
const again = page.refresh;
page.refresh = async () => { await again(); await extras(page); draw(page); };
setInterval(() => { const c = $('clock'); if (c) c.textContent = mmss(ends - Date.now()); if (Date.now() > ends + 2000 && !page.busy) page.refresh(); }, 1000);

document.getElementById('main').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const n = +b.dataset.n;
  if (b.dataset.act === 'topup') page.act(() => send('top_up', {}, { deposit: toYocto(n) }), (coins) => `${coins ?? ''} coins added for ${n} NEAR`, `Topping up ${n} NEAR`, true);
  if (b.dataset.act === 'enter') page.act(() => send('enter_draw', { amount: n }), () => `${plural(n, 'ticket')} burned into today's draw`, `Burning ${plural(n, 'ticket')} into the draw`);
});
$('claim').addEventListener('click', () => { const owed = page.S.me.owed; page.act(() => send('claim'), () => `${N(owed)} is on its way to your wallet`, `Collecting ${N(owed)}`); });

// ---- for a NEAR Auth account: copy the address, send NEAR out
$('copyId').addEventListener('click', async () => { try { await navigator.clipboard.writeText(page.me); $('copyId').textContent = 'Copied'; } catch { $('copyId').textContent = 'Select the name above and copy it'; } setTimeout(() => { $('copyId').textContent = "Copy my account's name"; }, 2500); });
if (FAUCET) $('faucet').href = FAUCET; else $('faucet').hidden = true;
$('signFee').textContent = near(SIGN_FEE);
$('outTo').placeholder = `to: account.${NET.top}`;
$('outSend').addEventListener('click', () => {
  const to = $('outTo').value.trim().toLowerCase(), amount = Number($('outAmount').value.replace(',', '.'));
  const note = (text) => { $('outNote').textContent = text; };
  if (!/^(?=.{2,64}$)[a-z0-9]+([._-][a-z0-9]+)*$/.test(to)) return note(`Name the account to send to, for example yourname.${NET.top}.`);
  if (to === page.me) return note('That is this account.');
  if (!(amount > 0)) return note('Say how much NEAR.');
  const yocto = BigInt(toYocto(amount));
  if (wallet != null && yocto + LOW > BigInt(wallet)) return note(`You hold ${N(wallet)}. About ${near(LOW)} NEAR has to stay, or the account cannot do anything any more: at most ${near(BigInt(wallet) > LOW ? BigInt(wallet) - LOW : 0n)} can go.`);
  note('');
  page.act(() => sendNear(to, yocto), () => `${amount} NEAR sent to ${to}`, `Sending ${amount} NEAR to ${to}`, true);
});
