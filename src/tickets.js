// The ticket market: tickets for NEAR, between players. Tickets are all alike, so an order is "this many, at this
// price each". Everything shown comes from the contract; every button sends it a call.
//
// One list, five ways to look at it (tabs): tickets for sale, offers to buy, your own orders, the market's latest
// sales, your own ticket history. Each can be sorted and is shown ten rows to a page. An order opens in place to
// choose how many and confirm. Above the sales: buying several at once, the cheapest first, from as many sales as
// it takes, in one transaction. Beside the list: the form for a new order, and the order book (how many tickets
// stand at each price).
import { loadArt } from './render.js';
import { paintIcons, spriteHTML } from './sprites.js';
import { openPage } from './nav.js';
import { send, sendMany, near, toYocto, allOrders, walletBalance, AT_HAND, GAS } from './chain.js';
import { shortName } from './account.js';
import { describe } from './history.js';

const art = await loadArt();
paintIcons(art);
const $ = (id) => document.getElementById(id);
const N = (yocto) => `${near(yocto)} NEAR`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ticket = spriteHTML(art, 'icon_ticket', 2);
const big = (v) => BigInt(v);
const times = (price, n) => (big(price) * big(n)).toString();
// what a seller gets out of a sale: the price less the 5% that goes into the vault (rounded up, as the contract does)
const afterFee = (total) => { const t = big(total), fee = (t * 5n + 99n) / 100n; return (t - fee).toString(); };
const ago = (at) => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const PER_PAGE = 10, MAX_ORDERS = 10;

// ---- what the page is showing right now (kept while the numbers behind it are read again)
const TABS = [['sale', 'For sale'], ['bids', 'Offers'], ['mine', 'My orders'], ['trades', 'Sales'], ['history', 'My history']];
const SORTS = {
  sale: [['low', 'Cheapest first'], ['high', 'Dearest first'], ['many', 'Most tickets'], ['new', 'Newest']],
  bids: [['high', 'Best paying first'], ['low', 'Lowest paying first'], ['many', 'Most tickets'], ['new', 'Newest']],
};
let tab = TABS.some(([k]) => k === location.hash.slice(1)) ? location.hash.slice(1) : 'sale';
let sort = { sale: 'low', bids: 'high' }, pageNo = 1, hideMine = true;
let sel = null, seln = 1;            // the order opened in the list, and how many of it
let way = 'sell';                    // the form: 'sell' or 'bid'
// ---- buying several at once
// The cheapest tickets, from as many sales as it takes: one call per sale, all in ONE transaction, so the buyer
// gets all of them or (when somebody else was quicker at one of the sales) none, and pays nothing then.
// A transaction can carry only so much, so one purchase reaches into ten sales at most.
const MOST_SALES = 10;
// gas for each of those calls: buying from one sale uses about 4 Tgas (measured on testnet)
const SWEEP_GAS = '8000000000000';
let bulk = 2, sweep = null;          // how many to buy at once, and the sales that makes (kept for the button)
function cheapest(me, n) {
  const sales = sorted(orders.filter((o) => !o.buying && o.account !== me), 'low').slice(0, MOST_SALES);
  const there = sales.reduce((a, o) => a + o.amount, 0), plan = [];
  let left = Math.min(n, there), total = 0n;
  for (const o of sales) {
    if (left < 1) break;
    const take = Math.min(o.amount, left);
    plan.push({ order: o.id, amount: take, price: o.price, pay: times(o.price, take) });
    total += big(o.price) * big(take); left -= take;
  }
  return { plan, there, got: plan.reduce((a, p) => a + p.amount, 0), total: total.toString() };
}
let orders = [], wallet = null, loadedAt = 0;

const byPrice = (dir) => (a, b) => (big(a.price) < big(b.price) ? -dir : big(a.price) > big(b.price) ? dir : +a.id - +b.id);
const sorted = (list, how) => [...list].sort(how === 'low' ? byPrice(1) : how === 'high' ? byPrice(-1) : how === 'many' ? (a, b) => b.amount - a.amount || +a.id - +b.id : (a, b) => +b.id - +a.id);

function rowsFor(page) {
  const { S, me } = page;
  if (tab === 'sale') return sorted(orders.filter((o) => !o.buying && !(hideMine && o.account === me)), sort.sale);
  if (tab === 'bids') return sorted(orders.filter((o) => o.buying && !(hideMine && o.account === me)), sort.bids);
  if (tab === 'mine') return orders.filter((o) => o.account === me);
  if (tab === 'trades') return S.ticketTrades;
  return S.events.filter((e) => e.what === 'ticket');
}

function draw(page) {
  const { S, me } = page, m = S.me, off = page.busy ? 'disabled' : '';
  const have = m ? Number(m.tickets) : 0;
  const asks = sorted(orders.filter((o) => !o.buying), 'low'), bids = sorted(orders.filter((o) => o.buying), 'high');
  const mineCount = orders.filter((o) => o.account === me).length;

  // ---- the numbers on top
  $('stats').innerHTML = [['Lowest price', asks[0] ? N(asks[0].price) : 'none for sale'], ['Best offer', bids[0] ? N(bids[0].price) : 'no offers'], ['Last sold for', S.ticketTrades[0] ? N(S.ticketTrades[0].price) : 'no sales yet'],
    ['You hold', me ? plural(have, 'ticket') : 'not connected'], ["Today's prize", N(S.draw.pool)]].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');

  // ---- tabs, with how many are behind each
  const counts = { sale: asks.length, bids: bids.length, mine: mineCount, trades: S.ticketTrades.length, history: S.events.filter((e) => e.what === 'ticket').length };
  $('tabs').innerHTML = TABS.map(([k, label]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${label}<span class="n">${counts[k]}</span></button>`).join('');

  // ---- the list
  const all = rowsFor(page), pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  pageNo = Math.min(Math.max(1, pageNo), pages);
  const shown = all.slice((pageNo - 1) * PER_PAGE, pageNo * PER_PAGE);
  const sorts = SORTS[tab];
  $('tools').innerHTML = `${sorts ? `<label class="pick">Sort <select id="sort">${sorts.map(([k, label]) => `<option value="${k}" ${sort[tab] === k ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="hideMine" ${hideMine ? 'checked' : ''}> Hide my own</label>` : ''}
    <span class="fresh"><span id="age">updated ${ago(loadedAt)}</span><button class="link" type="button" id="reload" ${off}>Refresh</button></span>`;

  // ---- buying several at once (only where the sales are listed)
  const buyable = tab === 'sale' ? cheapest(me, 1e9) : null;
  if (!buyable || buyable.there < 2) { $('sweep').innerHTML = ''; sweep = null; }
  else if (!$('sweep').contains(document.activeElement) || document.activeElement.tagName !== 'INPUT') {
    bulk = Math.max(1, Math.min(bulk, buyable.there));
    sweep = cheapest(me, bulk);
    const { plan, got, total } = sweep, lo = plan[0].price, hi = plan[plan.length - 1].price;
    // what has to be at hand while it runs: the price, and NEAR's hold for the gas of every call (it comes back)
    const hold = (AT_HAND * big(SWEEP_GAS) * big(plan.length)) / big(GAS), need = big(total) + hold;
    const why = !me ? 'Sign in (top right) to buy.' : wallet != null && big(wallet) < need ? `Your account holds ${N(wallet)}. This needs ${N(need.toString())} at hand: the price, and ${N(hold.toString())} that NEAR holds back while it runs and gives back after.` : '';
    $('sweep').innerHTML = `<div class="deal sweep">
        <div class="inline"><span><b>Buy several at once</b>: the cheapest tickets, from as many sales as it takes.</span><button class="btn small" data-act="bulk" data-d="-1" aria-label="Fewer">−</button><input class="qty" id="bulkQty" inputmode="numeric" value="${bulk}" aria-label="How many tickets"><button class="btn small" data-act="bulk" data-d="1" aria-label="More">+</button><button class="btn small" data-act="bulk" data-d="all">All ${buyable.there}</button></div>
        <div class="inline"><span>${plural(got, 'ticket')} from ${plural(plan.length, 'sale')}, at ${lo === hi ? N(lo) : `${near(lo)} to ${N(hi)}`} each. You pay <b>${N(total)}</b> with one approval. You get all of them, or none if somebody was quicker.</span>
          <button class="btn primary small" data-act="sweep" ${why ? 'disabled' : off}>Buy ${plural(got, 'ticket')}</button></div>
        ${why ? `<p class="err">${why}</p>` : ''}
      </div>`;
  }

  // every tab's columns: a heading, and whether it holds a number (right-aligned) or the row's button
  const COLS = {
    sale: [['Seller'], ['Tickets', 'num'], ['Price each', 'num'], ['For all', 'num'], ['', 'act']],
    bids: [['Buyer'], ['Wants', 'num'], ['Pays each', 'num'], ['For all', 'num'], ['', 'act']],
    mine: [['Order'], ['Tickets', 'num'], ['Price each', 'num'], ['Held for it', 'num'], ['', 'act']],
    trades: [['When'], ['Tickets', 'num'], ['Price each', 'num'], ['From'], ['To']],
    history: [['When'], ['What happened']],
  }[tab];
  const who = (id) => (id === me ? '<b>you</b>' : `<span class="acct" title="${id}">${shortName(id, 20)}</span>`);
  // one row: the cells in the order of the columns
  const tr = (cells, cls = '') => `<tr class="${cls}">${cells.map((html, k) => `<td class="${COLS[k][1] || ''}" data-label="${COLS[k][0]}">${html}</td>`).join('')}</tr>`;
  const body = shown.map((o) => {
    if (tab === 'trades') return tr([ago(+o.at), o.amount, N(o.price), who(o.seller), who(o.buyer)], o.seller === me || o.buyer === me ? 'own' : '');
    if (tab === 'history') return tr([ago(+o.at), describe(o).text]);
    if (tab === 'mine') return tr([o.buying ? '<span class="tag buy">Offer to buy</span>' : '<span class="tag sell">For sale</span>', o.amount, N(o.price), o.buying ? N(times(o.price, o.amount)) : plural(o.amount, 'ticket'),
      `<button class="btn small" data-act="cancel" data-order="${o.id}" ${off}>Take down</button>`]);
    const buying = tab === 'sale', mineIs = o.account === me, open = sel === o.id;
    const most = buying ? o.amount : Math.min(o.amount, have);
    const line = tr([who(o.account), o.amount, N(o.price), N(times(o.price, o.amount)),
      mineIs ? '<span class="sub">yours</span>' : !me ? '<span class="sub">connect to trade</span>' : `<button class="btn small ${open ? '' : 'primary'}" data-act="open" data-order="${o.id}">${open ? 'Close' : buying ? 'Buy' : 'Sell'}</button>`], `${mineIs ? 'own' : ''} ${open ? 'open' : ''}`);
    if (!open) return line;
    seln = Math.max(1, Math.min(seln, Math.max(1, most)));
    const total = times(o.price, seln);
    const why = most < 1 ? 'You hold no tickets to sell.' : buying && wallet != null && big(wallet) < big(total) ? `Your wallet holds ${N(wallet)}.` : '';
    return `${line}<tr class="dealrow"><td colspan="${COLS.length}"><div class="deal">
        <div class="inline"><span>${buying ? 'Buy' : 'Sell'} how many</span><button class="btn small" data-act="n" data-d="-1" aria-label="Fewer">−</button><input class="qty" id="qty" inputmode="numeric" value="${seln}" aria-label="How many"><button class="btn small" data-act="n" data-d="1" aria-label="More">+</button><button class="btn small" data-act="n" data-d="all">All ${most}</button></div>
        <div class="inline"><span>${buying ? `You pay <b>${N(total)}</b>. Your wallet asks you to approve it.` : `You get <b>${N(afterFee(total))}</b> to collect at the Harbour (${N(total)} less the 5% fee).`}</span>
          <button class="btn primary small" data-act="${buying ? 'buy' : 'fill'}" data-order="${o.id}" data-n="${seln}" data-pay="${total}" data-get="${afterFee(total)}" ${why ? 'disabled' : off}>Confirm</button></div>
        ${why ? `<p class="err">${why}</p>` : ''}
      </div></td></tr>`;
  }).join('');
  const none = { sale: 'No tickets are for sale right now. You can post an offer to buy.', bids: 'Nobody is offering to buy right now. You can put tickets up for sale.',
    mine: me ? 'You have no orders up.' : 'Connect your wallet (top right) to trade.', trades: 'No tickets have been sold yet.', history: me ? 'Nothing yet: tickets you earn, buy, sell or win show up here.' : 'Connect your wallet (top right) to see your history.' }[tab];
  // while a number is being typed into the list, leave the list alone
  if (!$('list').contains(document.activeElement) || document.activeElement.tagName !== 'INPUT') {
    $('list').innerHTML = shown.length
      ? `<table class="tbl t-${tab}"><thead><tr>${COLS.map(([h, c]) => `<th class="${c || ''}" scope="col">${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`
      : `<div class="nothing">${ticket}<p>${none}</p></div>`;
  }

  // ---- pages
  const from = all.length ? (pageNo - 1) * PER_PAGE + 1 : 0, to = Math.min(all.length, pageNo * PER_PAGE);
  const nums = [...new Set([1, pageNo - 1, pageNo, pageNo + 1, pages].filter((p) => p >= 1 && p <= pages))].sort((a, b) => a - b);
  const thing = { sale: 'sale', bids: 'offer', mine: 'order', trades: 'sale', history: 'line' }[tab];
  $('pager').innerHTML = all.length <= PER_PAGE ? (all.length ? `<span class="count">${plural(all.length, thing)}</span>` : '') : `<span class="count">${from}–${to} of ${plural(all.length, thing)}</span>
    <span class="nums"><button class="btn small" data-page="${pageNo - 1}" ${pageNo === 1 ? 'disabled' : ''}>‹ Prev</button>${nums.map((p, i) => `${i && p - nums[i - 1] > 1 ? '<span class="gap">…</span>' : ''}<button class="btn small ${p === pageNo ? 'on' : ''}" data-page="${p}" ${p === pageNo ? 'aria-current="page"' : ''}>${p}</button>`).join('')}<button class="btn small" data-page="${pageNo + 1}" ${pageNo === pages ? 'disabled' : ''}>Next ›</button></span>`;

  // ---- the order book: how many tickets stand at each price (the five nearest prices on each side)
  const levels = (list) => { const map = new Map(); for (const o of list) map.set(o.price, (map.get(o.price) || 0) + o.amount); return [...map].slice(0, 5); };
  const A = levels(asks), B = levels(bids), top = Math.max(1, ...A.map(([, n]) => n), ...B.map(([, n]) => n));
  const bar = ([price, n], side) => `<div class="lvl ${side}"><i style="width:${Math.max(4, (100 * n) / top)}%"></i><span>${N(price)}</span><b>${n}</b></div>`;
  $('depth').innerHTML = `<div class="sidehead"><span>For sale</span><span>tickets</span></div>${[...A].reverse().map((l) => bar(l, 'ask')).join('') || '<p class="empty">nothing for sale</p>'}
    <div class="mid">${asks[0] && bids[0] ? `gap ${N((big(asks[0].price) - big(bids[0].price)).toString())}` : 'the market price is whatever the next buyer and seller agree on'}</div>
    <div class="sidehead"><span>Wanted</span><span>tickets</span></div>${B.map((l) => bar(l, 'bid')).join('') || '<p class="empty">no offers</p>'}`;

  // ---- the form
  for (const b of document.querySelectorAll('.switch [data-way]')) b.setAttribute('aria-selected', String(b.dataset.way === way));
  $('quick').innerHTML = [way === 'sell' ? ['Lowest price', asks[0]?.price] : ['Best offer', bids[0]?.price], ['Last sold', S.ticketTrades[0]?.price]].filter(([, p]) => p)
    .map(([label, p]) => `<button class="btn small" type="button" data-price="${near(p)}">${label}: ${near(p)}</button>`).join('');
  $('max').hidden = way !== 'sell';
  $('submit').textContent = way === 'sell' ? 'Put up for sale' : 'Post the offer';
  $('orderNote').textContent = way === 'sell'
    ? `Your tickets are held until they are sold or you take the sale down. You have ${mineCount} of ${MAX_ORDERS} orders open.`
    : `Your NEAR is held until somebody sells to you or you take the offer down; your wallet asks you to approve it. You have ${mineCount} of ${MAX_ORDERS} orders open.`;
  summary(page);
}

// The form's sum line and whether it can be sent. Gives back the reason it cannot, or ''.
function summary(page) {
  const { S, me } = page, have = Number(S.me?.tickets || 0);
  const amount = Math.floor(Number($('amount').value)), price = Number($('price').value.replace(',', '.'));
  const mineCount = orders.filter((o) => o.account === me).length;
  let err = !me ? 'Connect your wallet (top right) first.'
    : !Number.isFinite(amount) || amount < 1 || amount > 1000 ? 'Enter between 1 and 1000 tickets.'
    : !Number.isFinite(price) || price < 0.0001 ? 'A ticket costs at least 0.0001 NEAR.'
    : mineCount >= MAX_ORDERS ? `You already have ${MAX_ORDERS} orders open. Take one down first.`
    : way === 'sell' && amount > have ? `You hold ${plural(have, 'ticket')}.` : '';
  const ok = Number.isFinite(amount) && amount >= 1 && Number.isFinite(price) && price >= 0.0001;
  const total = ok ? times(toYocto(price), amount) : '0';
  if (!err && way === 'bid' && wallet != null && big(wallet) < big(total)) err = `Your wallet holds ${N(wallet)}.`;
  $('sum').innerHTML = !ok ? '' : way === 'sell'
    ? `<div><span>Buyers pay</span><b>${N(total)}</b></div><div><span>Fee to the prize vault (5%)</span><b>${N((big(total) - big(afterFee(total))).toString())}</b></div><div class="tot"><span>You get</span><b>${N(afterFee(total))}</b></div>`
    : `<div><span>${plural(amount, 'ticket')} at ${price} NEAR</span><b>${N(total)}</b></div><div class="tot"><span>Held from your wallet</span><b>${N(total)}</b></div>`;
  $('err').textContent = me ? err : '';
  $('submit').disabled = !!err || page.busy;
  return err;
}

// ---- reading: the orders (all of them, also past the first hundred) and the wallet
async function extras(page) {
  try { orders = await allOrders('ticket_orders', page.S.ticketOrders); } catch { orders = page.S.ticketOrders; }
  wallet = page.me ? await walletBalance(page.me).catch(() => wallet) : null;
  loadedAt = Date.now();
}
const page = await openPage(draw);
await extras(page); draw(page);
const again = page.refresh;
page.refresh = async () => { await again(); await extras(page); draw(page); };
setInterval(() => { const a = $('age'); if (a) a.textContent = `updated ${ago(loadedAt)}`; }, 20000);
// for looking at the page from the browser console
window.kail = { page, draw, get orders() { return orders; }, set orders(v) { orders = v; } };

// ---- presses
document.getElementById('main').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; pageNo = 1; sel = null; history.replaceState(null, '', `#${tab}`); draw(page); return; }
  const p = e.target.closest('[data-page]');
  if (p && !p.disabled) { pageNo = +p.dataset.page; sel = null; draw(page); $('list').scrollIntoView({ block: 'nearest' }); return; }
  if (e.target.closest('#reload')) { page.refresh(); return; }
  const w = e.target.closest('.switch [data-way]');
  if (w) { way = w.dataset.way; draw(page); return; }
  const q = e.target.closest('[data-price]');
  if (q) { $('price').value = q.dataset.price; summary(page); return; }
  const st = e.target.closest('[data-step]');
  if (st) { $('amount').value = Math.max(1, Math.min(1000, (Math.floor(Number($('amount').value)) || 0) + +st.dataset.step)); summary(page); return; }
  if (e.target.closest('#max')) { $('amount').value = Math.max(1, Math.min(1000, Number(page.S.me?.tickets || 1))); summary(page); return; }

  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const { act, order } = b.dataset, n = +b.dataset.n;
  if (act === 'open') { sel = sel === order ? null : order; seln = 1; draw(page); }
  if (act === 'bulk') { bulk = b.dataset.d === 'all' ? 1e9 : Math.max(1, bulk + +b.dataset.d); draw(page); }
  if (act === 'sweep' && sweep?.plan.length) {
    const { plan, got, total } = sweep;
    page.act(() => sendMany(plan.map((p) => ({ method: 'buy_tickets', args: { order: p.order, amount: p.amount }, deposit: p.pay, gas: SWEEP_GAS }))),
      () => `Bought ${plural(got, 'ticket')} from ${plural(plan.length, 'sale')} for ${N(total)}`, `Buying ${plural(got, 'ticket')} for ${N(total)}`, true);
  }
  if (act === 'n') { seln = b.dataset.d === 'all' ? 1e9 : Math.max(1, seln + +b.dataset.d); draw(page); }
  if (act === 'buy') { sel = null; page.act(() => send('buy_tickets', { order, amount: n }, { deposit: b.dataset.pay }), () => `Bought ${plural(n, 'ticket')} for ${N(b.dataset.pay)}`, `Buying ${plural(n, 'ticket')} for ${N(b.dataset.pay)}`, true); }
  if (act === 'fill') { sel = null; page.act(() => send('fill_bid', { order, amount: n }), () => `Sold ${plural(n, 'ticket')}: ${N(b.dataset.get)} to collect at the Harbour`, `Selling ${plural(n, 'ticket')}`); }
  if (act === 'cancel') page.act(() => send('cancel_order', { order }), () => 'Taken down', 'Taking the order down');
});
document.getElementById('main').addEventListener('change', (e) => {
  if (e.target.id === 'sort') { sort[tab] = e.target.value; pageNo = 1; draw(page); }
  if (e.target.id === 'hideMine') { hideMine = e.target.checked; pageNo = 1; draw(page); }
  if (e.target.id === 'bulkQty') { bulk = Math.max(1, Math.floor(Number(e.target.value)) || 1); e.target.blur(); draw(page); }
  if (e.target.id === 'qty') { seln = Math.max(1, Math.floor(Number(e.target.value)) || 1); e.target.blur(); draw(page); }
});
for (const id of ['amount', 'price']) $(id).addEventListener('input', () => summary(page));
$('order').addEventListener('submit', (e) => {
  e.preventDefault();
  if (summary(page)) return;
  const amount = Math.floor(Number($('amount').value)), price = Number($('price').value.replace(',', '.')), each = toYocto(price);
  if (way === 'sell') page.act(() => send('sell_tickets', { amount, price: each }), () => { tab = 'mine'; pageNo = 1; return `${plural(amount, 'ticket')} up for ${price} NEAR each`; }, `Putting ${plural(amount, 'ticket')} up for sale`);
  else page.act(() => send('bid_tickets', { amount, price: each }, { deposit: times(each, amount) }), () => { tab = 'mine'; pageNo = 1; return `Offer for ${plural(amount, 'ticket')} at ${price} NEAR each is up`; }, `Offering to buy ${plural(amount, 'ticket')}`, true);
});
