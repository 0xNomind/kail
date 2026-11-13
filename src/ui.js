// Buttons, counters and the menus (Shop, Storage, Board). On a phone the menus open on top of the sea, one at a
// time. On a wide screen they are always there, in two columns beside the sea. The sea keeps running either way.
//
// Nothing here decides anything. What the player owns, today's quest and the market all come from the contract
// (`game.state`), and every button sends a call to it (`game.act`). Coins stay in the game; NEAR is at the Harbour.
import { UPGRADES, BAIT, ITEMS, ITEM_BY_ID, SURF, FLOOR } from './config.js';
import { storageUsed, storageCap } from './sim.js';
import { iconURL } from './render.js';
import { send, dayNote } from './chain.js';
import { describe, unread, markSeen, seenAt } from './history.js';

const $ = (id) => document.getElementById(id);
const metres = (y) => Math.max(0, Math.round((y - SURF) / 6));
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const MAX_PER_ORDER = 10, MIN_PRICE = 2, MAX_PRICE = 1000000, MAX_ORDERS = 5;
// the market's fee, as the contract takes it: 5%, rounded up
const feeOf = (total) => Math.ceil((total * 5) / 100);

export function makeUI({ art, player, game }) {
  const icons = {};
  const icon = (name, k = 1) => {
    const i = (icons[name] ||= iconURL(art, name));
    return `<img class="px" src="${i.url}" alt="" style="width:calc(var(--u)*${i.w * k});height:calc(var(--u)*${i.h * k})">`;
  };
  // an item's picture, shrunk to fit a box of this many game pixels
  const pic = (id, bw = 26, bh = 18) => {
    const item = ITEM_BY_ID[id], i = (icons[item.sprite] ||= iconURL(art, item.sprite));
    return icon(item.sprite, Math.min(item.rare ? 1.4 : 1, bw / i.w, bh / i.h));
  };
  const coin = (n) => `<span class="price">${icon('icon_coin', 0.62)}${n}</span>`;
  const tix = (n) => `<span class="price">${icon('icon_ticket', 0.7)}${n}</span>`;
  document.querySelectorAll('img[data-icon]').forEach((img) => {
    const i = (icons[img.dataset.icon] ||= iconURL(art, img.dataset.icon));
    const k = +img.dataset.k || 1;
    img.src = i.url; img.style.width = `calc(var(--u)*${i.w * k})`; img.style.height = `calc(var(--u)*${i.h * k})`;
  });

  const panel = $('panel'), docks = [$('dockLeft'), $('dockRight')];
  let open = null, tab = 'quest', picked = null, adding = false;   // adding: the "more room" view of Storage is showing
  let desk = false;                                                 // wide screen: menus sit beside the sea instead of on top
  let ask = { id: null, n: 1, price: MIN_PRICE };                   // the sale being written in Storage
  let want = { id: ITEMS[0].id, n: 1, price: 4 };                   // the offer to buy being written on the Board
  let sure = null;                                                  // a step waiting for "yes": { text, yes }
  let mpage = 1, mjump = false;                                     // the market's page, and whether to turn to the page of the opened order
  let mtab = 'sale', mkind = null, msel = null, mn = 1;             // the market: its tab, the kind shown, the order opened, how many
  // The market's history is about this market only: fish and chest finds sold and bought for coins. Tickets,
  // prizes, top-ups and collected NEAR have their own places (the ticket market, the Harbour).
  const trades = () => S().events.filter((e) => e.kind === 'sold' || e.kind === 'bought');
  let unreadSince = Date.now();                                     // history lines newer than this are marked as new
  const closeBtn = () => (desk ? '' : '<button class="btn x" data-act="close" aria-label="Close">×</button>');
  const name = (id) => ITEM_BY_ID[id].name;
  const S = () => game.state;
  const held = (id) => player.storage[id] || 0;
  const room = () => storageCap(player) - S().me.held;
  const off = () => (game.busy ? 'disabled' : '');
  // does the player hold everything today's quest asks for?
  const ready = () => S().quest.needs.every(([id, n]) => held(id) >= n);
  const mine = (o) => o.account === game.account;

  // text from outside the contract (a boat's name and reasons come from the game's server) is shown as text
  const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  // A short message over the sea. `ms` is how long it stays.
  function toast(html, kind = '', ms = 2200) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`; el.innerHTML = html;
    el.style.animationDuration = `${ms}ms`;
    $('toasts').append(el);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
    setTimeout(() => el.remove(), ms);
    return el;
  }
  // A message that stays while a call is on its way to the chain, with a turning mark. Gives back the way to
  // take it away again.
  function working(text) {
    const el = document.createElement('div');
    el.className = 'toast wait'; el.innerHTML = `<i class="spin" aria-hidden="true"></i>${text}`;
    $('toasts').append(el);
    return () => el.remove();
  }
  // A little picture flies from where something was pressed to the counter it ends up in.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function fly(html, from, toId) {
    const to = $(toId)?.getBoundingClientRect();
    if (still || !from || !to || !document.body.animate) return;
    const el = document.createElement('div');
    el.className = 'fly'; el.innerHTML = html;
    document.body.append(el);
    const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2, x1 = to.left + to.width / 2, y1 = to.top + to.height / 2;
    el.animate([
      { transform: `translate(${x0}px, ${y0}px) translate(-50%, -50%) scale(1.6)`, opacity: 1 },
      { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 40}px) translate(-50%, -50%) scale(1.9)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${x1}px, ${y1}px) translate(-50%, -50%) scale(0.7)`, opacity: 0.2 },
    ], { duration: 650, easing: 'cubic-bezier(.3,.7,.3,1)' }).onfinish = () => el.remove();
  }
  // A counter that changed gives a little jump, so the eye finds what happened.
  const shown = {};
  function count(id, value) {
    const el = $(id);
    if (shown[id] !== undefined && shown[id] !== value && !still) {
      const chip = el.closest('.chip');
      chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump');
    }
    shown[id] = value;
    el.textContent = value;
  }

  function hud(world) {
    count('coins', player.coins);
    count('bait', player.bait);
    count('store', `${S().me.held}/${storageCap(player)}`);
    count('tickets', player.tickets);
    const h = world.hook;
    $('depth').textContent = `${metres(h.y)} / ${metres(FLOOR)} m`;
    $('depthChip').classList.toggle('hidden', h.state === 'idle');
    const cast = $('btnCast');
    cast.disabled = h.state !== 'idle' || player.bait <= 0;
    const full = game.storageFull;
    cast.textContent = h.state === 'idle' ? (player.bait <= 0 ? 'NO BAIT' : full ? 'FULL' : 'CAST') : h.state === 'out' ? '. . .' : 'REELING';
    cast.classList.toggle('full', h.state === 'idle' && full);
    // "Drop": shows the very thing that is on the hook, so it is clear what the button throws away
    const held = h.state === 'in' && h.catch ? h.catch.def : null;
    const drop = $('btnRelease');
    drop.classList.toggle('hidden', !held);
    if (held && drop.dataset.id !== held.id) {
      const name = held.sprite || `fish_${held.id}_1`, i = (icons[name] ||= iconURL(art, name));
      drop.dataset.id = held.id;
      drop.dataset.since = performance.now();      // a press right as it appears was meant for something else
      drop.innerHTML = `<span class="what">${icon(name, Math.min(1, 20 / i.w, 14 / i.h))}</span><span class="arrow">↓</span><span>Drop</span>`;
    }
    if (!held) drop.dataset.id = '';
    // the pulling game: a box the player moves, and the catch's icon that must stay inside it
    const g = held ? h.fight : null, pull = $('pull');
    pull.classList.toggle('hidden', !g);
    if (g) {
      const mark = $('pullIcon');
      if (mark.dataset.id !== held.id) {
        const name = held.sprite || `fish_${held.id}_1`, i = (icons[name] ||= iconURL(art, name));
        mark.dataset.id = held.id;
        mark.innerHTML = icon(name, Math.min(1, 22 / i.w, 16 / i.h));
      }
      mark.style.left = `${g.icon * 100}%`;
      $('pullBox').style.left = `${g.box * 100}%`;
      $('pullBox').style.width = `${g.w * 100}%`;
      $('gripFill').style.width = `${Math.max(0, g.grip) * 100}%`;
      pull.classList.toggle('out', !g.inside);
      pull.classList.toggle('low', g.grip < 0.3);
      $('pullLabel').textContent = g.inside ? 'Coming up… keep it in the box' : 'Get it back in the box!';
    } else $('pullIcon').dataset.id = '';
    // while the hook is in the water the bottom buttons get out of the way; only "Drop" stays
    $('bottom').classList.toggle('diving', h.state !== 'idle');
    // a red dot when something in storage is wanted by the quest
    $('storageDot').classList.toggle('hidden', !ready());
    // a red dot on Board when the history has something new
    $('boardDot').classList.toggle('hidden', !unread(game.account, trades()));
  }

  const head = (title, extra = '') => `<header><h2>${title}</h2>${extra}${closeBtn()}</header>`;
  // a step that needs a "yes" first: what it will cost or give is spelled out, then Confirm or Cancel
  // A price: the − and + beside it move it by one coin; the number itself can be typed over.
  const priceBox = (which, value) => `<span class="price typed">${icon('icon_coin', 0.62)}<input class="num" inputmode="numeric" pattern="[0-9]*" data-in="${which}" value="${value}" aria-label="Price for one, in coins"></span>`;
  const sureHTML = () => (sure ? `<div class="offer sure"><b>${sure.text}</b><div class="steps"><button class="btn row go" data-act="yes" ${off()}>Confirm</button><button class="btn row" data-act="no">Cancel</button></div></div>` : '');

  function shopHTML() {
    const lvl = player.up.reel, u = UPGRADES.reel, cost = u.costs[lvl];
    return `${head('Shop')}
      <div class="body">
        <div class="item"><div class="pic">${icon('icon_bait', 1.3)}</div>
          <div><div class="name">Bait</div><div class="sub">One bait per throw. You have ${player.bait}.</div></div>
          <div class="acts"><button class="btn row go" data-act="bait" data-n="1" ${player.coins < BAIT.price ? 'disabled' : off()}>1 for ${coin(BAIT.price)}</button>
            <button class="btn row go" data-act="bait" data-n="10" ${player.coins < BAIT.price * 10 ? 'disabled' : off()}>10 for ${coin(BAIT.price * 10)}</button></div></div>
        <div class="item"><div class="pic">${icon('hook', 1.2)}</div>
          <div><div class="name">${u.name} <span class="sub">level ${lvl + 1}</span></div>
          <div class="sub">Pulls faster and makes the box wider, so fewer catches get away.<br>${u.values[lvl]}x speed${cost != null ? ` → ${u.values[lvl + 1]}x` : ' (best)'}</div></div>
          <div class="acts">${cost != null ? `<button class="btn row go" data-act="up" data-key="reel" ${player.coins < cost ? 'disabled' : off()}>${coin(cost)}</button>` : ''}</div></div>
        <a class="btn row wide" href="harbour#topup" title="Coins only come from topping up with NEAR, at the Harbour">Out of coins? Top up at the Harbour</a>
      </div>`;
  }

  // Storage: one box per thing. Tapping a box opens that thing on its own, with everything that can be done
  // with it in view at once. "Back" returns to the boxes.
  function itemHTML() {
    const n = held(picked), q = S().quest.needs.find(([id]) => id === picked);
    if (ask.id !== picked) ask = { id: picked, n: 1, price: Math.max(MIN_PRICE, ITEM_BY_ID[picked].value) };
    ask.n = Math.max(1, Math.min(ask.n, n, MAX_PER_ORDER)); ask.price = Math.max(MIN_PRICE, ask.price);
    const full = S().orders.filter(mine).length >= MAX_ORDERS;
    // somebody's offer to buy this kind: the best price first
    const bid = S().orders.filter((o) => o.buying && o.token_id === picked && !mine(o)).sort((a, b) => b.price - a.price)[0];
    const k = bid ? Math.min(n, bid.amount) : 0, gets = bid ? bid.price * k - feeOf(bid.price * k) : 0;
    return `<header><button class="btn x" data-act="unpick" aria-label="Back to Storage">‹</button><h2>${name(picked)} <span class="sub">× ${n}</span></h2>${closeBtn()}</header>
      <div class="body item-view">
        ${sureHTML()}
        <div class="detail">
          <div class="pic">${pic(picked, 34, 24)}</div>
          <div class="sub">${q ? `Today's quest asks for ${q[1]} of these. You hold ${n}.` : ITEM_BY_ID[picked].rare ? 'From the chest. Today\'s quest does not ask for it.' : 'Today\'s quest does not ask for it. Keep it for another day, or sell.'}</div>
        </div>
        <div class="choices">
          ${bid ? `<button class="btn row go" data-act="tobid" data-order="${bid.id}" data-n="${k}">Somebody pays ${coin(bid.price)} each · sell ${k} for ${coin(gets)}</button>` : '<p class="note">Nobody is offering to buy these right now.</p>'}
          <button class="btn row" data-act="toss" data-id="${picked}" data-n="1" ${off()}>Throw 1 back into the sea</button>
        </div>
        <div class="offer">
          <b>Put it up at your own price</b>
          <div class="steps"><span class="sub">How many</span><button class="btn mini" data-act="askn" data-d="-1" aria-label="Fewer">−</button><b>${ask.n}</b><button class="btn mini" data-act="askn" data-d="1" aria-label="More">+</button></div>
          <div class="steps"><span class="sub">Price each</span><button class="btn mini" data-act="askp" data-d="-1" aria-label="Lower price">−</button>${priceBox('askp', ask.price)}<button class="btn mini" data-act="askp" data-d="1" aria-label="Higher price">+</button></div>
          <button class="btn row wide" data-act="list" data-id="${picked}" ${full ? 'disabled' : off()}>${full ? `You already have ${MAX_ORDERS} orders up` : `Put ${ask.n} up for <span data-sum="askp">${coin(ask.price * ask.n)}</span>`}</button>
          <p class="note">You get exactly your price; the buyer pays the 5% fee on top. Things up for sale keep their box in your storage.</p>
        </div>
      </div>`;
  }
  function storageHTML() {
    const cap = storageCap(player);
    const list = ITEMS.flatMap((it) => Array(held(it.id)).fill(it.id));
    const away = Math.max(0, S().me.held - list.length);        // boxes taken by things up for sale and by offers to buy
    if (picked && !held(picked)) picked = null;
    if (picked) return itemHTML();
    const lvl = player.up.storage, u = UPGRADES.storage, cost = u.costs[lvl], next = u.values[lvl + 1];
    if (adding && next) {
      // tapping a "+" box opens this: what the upgrade gives, what it costs, and the button to buy it
      const short = player.coins < cost;
      return `<header><button class="btn x" data-act="unpick" aria-label="Back to Storage">‹</button><h2>More room</h2>${closeBtn()}</header>
        <div class="body item-view">
          <div class="detail"><div class="pic">${icon('icon_storage', 1.6)}</div>
            <div><div class="name">${cap} boxes → ${next} boxes</div><div class="sub">${next - cap} more boxes to keep fish and chest finds for a later quest.</div></div></div>
          <div class="choices">
            <button class="btn row go" data-act="up" data-key="storage" ${short ? 'disabled' : off()}>Upgrade · ${coin(cost)}</button>
            ${short ? `<p class="note">You have ${player.coins} coins, this costs ${cost}.</p>` : ''}
          </div>
        </div>`;
    }
    adding = false;
    const wanted = new Set(S().quest.needs.map(([id]) => id));
    let boxes = '';
    for (let i = 0; i < cap; i++) {
      const id = list[i];
      if (id) boxes += `<button class="slot ${ITEM_BY_ID[id].rare ? 'rare' : ''} ${wanted.has(id) ? 'wanted' : ''}" data-act="pick" data-id="${id}" aria-label="${name(id)}">${pic(id)}</button>`;
      else if (i < list.length + away) boxes += '<div class="slot away" title="Taken by something on the market">·</div>';
      else boxes += '<div class="slot empty"></div>';
    }
    if (next) for (let i = 0; i < 5; i++) boxes += '<button class="slot locked" data-act="more" aria-label="More room">+</button>';
    return `${head('Storage', `<span class="sub">${S().me.held} / ${cap}</span>`)}
      <div class="body">
        <p class="note">Tap a box to sell it or throw it back. A green mark means today's quest wants it.${away ? ` ${plural(away, 'box')} ${away === 1 ? 'is' : 'are'} taken by the market.` : ''}${next ? ' Tap a + box for more room.' : ''}</p>
        <div class="grid">${boxes}</div>
      </div>`;
  }

  // The quest and the market are two tabs of "Board" on a phone, and two separate cards on a wide screen.
  function questBody() {
    const q = S().quest, ok = ready();
    const needs = q.needs.map(([id, n]) => {
      const have = held(id), done = have >= n;
      return `<div class="need ${done ? 'ok' : ''}"><span class="pic">${pic(id, 26, 18)}</span><span><b>${name(id)}</b><span class="sub">${done ? 'you have enough' : `${n - have} more to catch`}</span></span><b class="count">${Math.min(have, n)} / ${n}</b></div>`;
    }).join('');
    // the quest gives a ticket to everybody who finishes it, unless the game's owner has set a stock for the day
    const limited = q.stock > 0, gone = limited && q.left < q.tickets;
    return `<div class="body">
        <p class="note">One quest a day, the same for everybody. Hand in all three kinds at once and you get ${plural(q.tickets, 'ticket')}, as often as you can finish it.${limited ? ' Only so many tickets a day: first come, first served.' : ''}</p>
        ${dayNote(S().dayMs) ? `<p class="note testnote">${dayNote(S().dayMs)}</p>` : ''}
        <div class="quest ${gone ? 'closed' : ''}">
          <div class="qhead"><b>Today's quest</b><span class="sub">pays ${tix(q.tickets)}</span></div>
          ${needs}
          ${limited ? `<div class="stockline"><span>Tickets left today</span><b>${q.left} of ${q.stock}</b></div>
          <div class="bar"><i style="width:${(100 * q.left) / q.stock}%"></i></div>` : ''}
          ${gone ? '<p class="note">All tickets are gone for today.</p>' : `<button class="btn row go wide" data-act="quest" ${ok ? off() : 'disabled'}>${ok ? 'Hand in the quest' : 'Catch all three kinds first'}</button>`}
        </div>
        <p class="note">New quest in <b id="liveClock">${mmss(game.questEnds - Date.now())}</b>. What you hold stays yours when the day changes.</p>
        <p class="note">You hold ${tix(player.tickets)}. Tickets are used at the Harbour: one in five wins the draw, or sell them for NEAR.</p>
        <a class="btn row wide" href="harbour#draw">Go to the Harbour</a></div>`;
  }
  // The market: four small tabs (what is for sale, what is wanted, your own orders, asking for something),
  // a row of kinds to narrow the list down, and one line per order. Tapping an order opens it in place:
  // how many, what it comes to with the fee, and Confirm.
  // A line says what, how many and the price, cheapest first, and never who: a list where only the computer's
  // boats had names read as if they were a different kind of offer. Who it is shows once an order is opened, for
  // every order alike.
  const short = (id) => (id.length <= 16 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`);
  const ago = (at) => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
  // an account the computer plays, if this is one (see "the other boats" in main.js)
  const boat = (id) => (game.boats || []).find((b) => b.account === id);
  const who = (id) => { const b = boat(id); return b ? `${esc(b.name)} <i class="npc" title="Played by the computer">computer</i>` : short(id); };
  // A long list is shown a page at a time. Gives the rows of the current page and the line to turn pages with.
  const PER_PAGE = 8;
  function paged(list, things) {
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    mpage = Math.min(Math.max(1, mpage), pages);
    const from = (mpage - 1) * PER_PAGE, shown = list.slice(from, from + PER_PAGE);
    const pager = pages < 2 ? '' : `<div class="pager"><button class="btn mini" data-act="mpage" data-d="-1" aria-label="Previous page" ${mpage === 1 ? 'disabled' : ''}>‹</button>
        <span>Page <b>${mpage}</b> of ${pages} <i>· ${from + 1}–${from + shown.length} of ${list.length} ${things}</i></span>
        <button class="btn mini" data-act="mpage" data-d="1" aria-label="Next page" ${mpage === pages ? 'disabled' : ''}>›</button></div>`;
    return { shown, pager };
  }
  function marketBody() {
    const all = S().orders, quest = new Set(S().quest.needs.map(([id]) => id));
    const lists = {
      sale: all.filter((o) => !o.buying && !mine(o)).sort((a, b) => a.price - b.price),
      want: all.filter((o) => o.buying && !mine(o)).sort((a, b) => b.price - a.price),
      mine: all.filter(mine),
    };
    const fresh = mtab === 'log' ? 0 : unread(game.account, trades());
    const tabs = [['sale', `For sale ${lists.sale.length}`], ['want', `Wanted ${lists.want.length}`], ['mine', `Yours ${lists.mine.length}`], ['ask', 'Ask'], ['log', `History${fresh ? ` <i class="new">${fresh}</i>` : ''}`]]
      .map(([k, label]) => `<button class="tab" role="tab" data-act="mtab" data-tab="${k}" aria-selected="${mtab === k}">${label}</button>`).join('');
    let body = '';
    if (mtab === 'log') {
      // the player's sales and purchases here, newest first; opening this tab counts as having seen them
      const log = paged(trades(), 'trades');
      body = `<div class="orows">${log.shown.map((e) => {
        const w = describe(e);
        return `<div class="orow log ${+e.at > unreadSince ? 'fresh' : ''}"><span class="pic">${w.pic ? (ITEM_BY_ID[w.pic] ? pic(w.pic, 22, 14) : icon(w.pic, 0.8)) : ''}</span><span class="what">${w.text}</span><span class="sub">${ago(+e.at)}</span></div>`;
      }).join('') || '<p class="note">Nothing yet. What you sell and buy on this market shows up here, also sales made while you were away.</p>'}</div>${log.pager}
        <p class="note">Your latest trades on this market, kept on NEAR. Ticket trades are in the ticket market; draws and top-ups are at the Harbour.</p>`;
    } else if (mtab === 'ask') {
      want.n = Math.max(1, Math.min(want.n, MAX_PER_ORDER)); want.price = Math.max(MIN_PRICE, want.price);
      const cost = want.n * want.price, cant = player.coins < cost || room() < want.n || lists.mine.length >= MAX_ORDERS;
      body = `${sureHTML()}<div class="offer">
          <b>Ask for something</b>
          <div class="steps"><span class="sub">What</span><button class="btn mini" data-act="wantk" data-d="-1" aria-label="Previous kind">‹</button><b class="kind">${pic(want.id, 20, 14)} ${name(want.id)}</b><button class="btn mini" data-act="wantk" data-d="1" aria-label="Next kind">›</button></div>
          <div class="steps"><span class="sub">How many</span><button class="btn mini" data-act="wantn" data-d="-1" aria-label="Fewer">−</button><b>${want.n}</b><button class="btn mini" data-act="wantn" data-d="1" aria-label="More">+</button></div>
          <div class="steps"><span class="sub">You pay each</span><button class="btn mini" data-act="wantp" data-d="-1" aria-label="Lower price">−</button>${priceBox('wantp', want.price)}<button class="btn mini" data-act="wantp" data-d="1" aria-label="Higher price">+</button></div>
          <button class="btn row wide" data-act="want" ${cant ? 'disabled' : off()}>Offer <span data-sum="wantp">${coin(cost)}</span> for ${want.n}</button>
          <p class="note">The coins and ${plural(want.n, 'box')} in your storage are set aside until somebody sells to you or you take the offer down.</p>
        </div>`;
    } else {
      const list = lists[mtab];
      // the kinds in this list, today's quest first; one can be picked to show only that kind
      const kinds = [...new Set(list.map((o) => o.token_id))].sort((a, b) => quest.has(b) - quest.has(a) || ITEMS.findIndex((x) => x.id === a) - ITEMS.findIndex((x) => x.id === b));
      if (mkind && !kinds.includes(mkind)) mkind = null;
      const chips = kinds.length > 1 ? `<div class="kinds"><button class="kindbtn ${mkind ? '' : 'on'}" data-act="mkind" data-id="">All</button>${kinds.map((k) =>
        `<button class="kindbtn ${mkind === k ? 'on' : ''} ${quest.has(k) ? 'wanted' : ''}" data-act="mkind" data-id="${k}" aria-label="${name(k)}" title="${name(k)}">${pic(k, 18, 12)}</button>`).join('')}</div>` : '';
      const fits = list.filter((o) => !mkind || o.token_id === mkind);
      // (coming from Storage to one order: turn to the page it is on)
      if (mjump) { mjump = false; const at = fits.findIndex((o) => o.id === msel); if (at >= 0) mpage = Math.floor(at / PER_PAGE) + 1; }
      const { shown, pager } = paged(fits, mtab === 'sale' ? 'for sale' : mtab === 'want' ? 'wanted' : 'orders');
      const rows = shown.map((o) => {
        const open = msel === o.id;
        const does = mtab === 'mine' ? `<button class="btn row" data-act="cancel" data-order="${o.id}" ${off()}>Take down</button>`
          : `<button class="btn row ${open ? '' : 'go'}" data-act="msel" data-order="${o.id}">${open ? 'Close' : mtab === 'sale' ? 'Buy' : 'Sell'}</button>`;
        const line = `<div class="orow ${open ? 'open' : ''}"><span class="pic">${pic(o.token_id, 22, 14)}</span><span class="what"><b>${name(o.token_id)}</b> × ${o.amount}${quest.has(o.token_id) ? '<i class="q" title="Today\'s quest asks for this"></i>' : ''}</span><span class="each">${mtab === 'mine' ? (o.buying ? 'you pay ' : 'you ask ') : ''}${coin(o.price)}</span>${does}</div>`;
        if (!open) return line;
        // the order is open: choose how many, see what it comes to, confirm
        const buying = mtab === 'sale', most = buying ? Math.min(o.amount, room()) : Math.min(o.amount, held(o.token_id));
        mn = Math.max(1, Math.min(mn, Math.max(1, most)));
        const total = o.price * mn, fee = feeOf(total), pays = total + fee, gets = total - fee;
        const why = most < 1 ? (buying ? 'Your storage is full.' : `You hold no ${name(o.token_id)}.`) : buying && player.coins < pays ? `You have ${player.coins} coins.` : '';
        return `${line}<div class="deal">
            <div class="steps"><span class="sub">${buying ? 'Buy' : 'Sell'} how many <span class="who">${buying ? 'from' : 'to'} ${who(o.account)}</span></span><button class="btn mini" data-act="mn" data-d="-1" aria-label="Fewer">−</button><b>${mn}</b><button class="btn mini" data-act="mn" data-d="1" aria-label="More">+</button></div>
            <div class="steps"><span class="sub">${buying ? `You pay <b>${coin(pays)}</b> · ${coin(total)} to the seller + ${coin(fee)} fee` : `You get <b>${coin(gets)}</b> · ${coin(total)} offered − ${coin(fee)} fee`}</span>
              <button class="btn row go" data-act="${buying ? 'buy' : 'fill'}" data-order="${o.id}" data-n="${mn}" ${why ? 'disabled' : off()}>Confirm</button></div>
            ${why ? `<p class="note">${why}</p>` : ''}
            ${boat(o.account)?.reasons?.[o.id] ? `<p class="note said"><b>${esc(boat(o.account).name)}:</b> ${esc(boat(o.account).reasons[o.id])}</p>` : ''}
          </div>`;
      }).join('');
      // what other players did with your orders lately
      const none = { sale: 'Nothing is for sale right now.', want: 'Nobody is asking for anything right now.', mine: `You have no orders up. To sell, ${desk ? 'click a thing in Storage' : 'open Storage and tap a thing'}; to ask for one, use the Ask tab.` }[mtab];
      body = `${chips}<div class="orows">${rows || `<p class="note">${none}</p>`}</div>${pager}`;
    }
    return `<div class="tabs small" role="tablist">${tabs}</div><div class="body">${body}
        <p class="note fee">Fish and chest finds for coins, between players. Whoever takes an order pays the 5% fee (at least 1 coin).</p></div>`;
  }
  function boardHTML() {
    const tabs = `<div class="tabs" role="tablist">${[['quest', 'Quest'], ['market', 'Market']].map(([k, label]) =>
      `<button class="tab" role="tab" data-act="tab" data-tab="${k}" aria-selected="${tab === k}">${label}</button>`).join('')}</div>`;
    return head('Board', tabs) + (tab === 'quest' ? questBody() : marketBody());
  }

  // Swap a container's HTML but keep how far each list was scrolled.
  function paint(el, html) {
    const tops = [...el.querySelectorAll('.body')].map((x) => x.scrollTop);
    el.innerHTML = html;
    el.querySelectorAll('.body').forEach((x, i) => { if (tops[i]) x.scrollTop = tops[i]; });
  }
  const card = (key, html, grow = false) => `<section class="card ${grow ? 'grow' : ''}" data-card="${key}">${html}</section>`;
  function render() {
    if (desk) {
      // wide screen: everything is always in view, quest and storage on the left, shop and market on the right
      panel.classList.add('hidden');
      paint(docks[0], card('quest', head('Quest') + questBody()) + card('storage', storageHTML(), true));
      paint(docks[1], card('shop', shopHTML()) + card('market', head('Market') + marketBody(), true));
      return;
    }
    if (!open) { panel.classList.add('hidden'); return; }
    paint(panel, open === 'shop' ? shopHTML() : open === 'storage' ? storageHTML() : boardHTML());
    panel.classList.remove('hidden');
  }
  // The clock is updated in place, so buttons are never swapped out from under a finger.
  function live() {
    const clock = $('liveClock');
    if (clock) clock.textContent = mmss(game.questEnds - Date.now());
  }
  const show = (which) => { open = open === which ? null : which; picked = null; adding = false; sure = null; render(); };
  const refresh = () => { if (desk || open) render(); };
  const step = (v, d, lo, hi) => Math.max(lo, Math.min(hi, v + d));

  function act(ev) {
    const b = ev.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const d = b.dataset, n = +d.n;
    // moving around in the menus
    if (d.act === 'close') open = null;
    if (d.act === 'tab') { tab = d.tab; sure = null; }
    if (d.act === 'mpage') { mpage += +d.d; msel = null; }
    if (d.act === 'mtab') { mtab = d.tab; mpage = 1; msel = null; sure = null; if (mtab === 'log') { unreadSince = seenAt(game.account); markSeen(game.account, trades()); } }
    if (d.act === 'mkind') { mkind = d.id || null; mpage = 1; msel = null; }
    if (d.act === 'msel') { msel = msel === d.order ? null : d.order; mn = 1; }
    if (d.act === 'mn') mn = Math.max(1, mn + +d.d);      // the most is known where the order is drawn
    if (d.act === 'pick') { picked = d.id; sure = null; }
    if (d.act === 'unpick') { picked = null; adding = false; sure = null; }
    if (d.act === 'more') adding = true;
    if (d.act === 'askn') ask.n = step(ask.n, +d.d, 1, Math.min(MAX_PER_ORDER, held(picked) || 1));
    if (d.act === 'askp') ask.price = step(ask.price, +d.d, MIN_PRICE, MAX_PRICE);
    if (d.act === 'wantn') want.n = step(want.n, +d.d, 1, MAX_PER_ORDER);
    if (d.act === 'wantp') want.price = step(want.price, +d.d, MIN_PRICE, MAX_PRICE);
    if (d.act === 'wantk') { const i = ITEMS.findIndex((it) => it.id === want.id); want.id = ITEMS[(i + +d.d + ITEMS.length) % ITEMS.length].id; want.price = Math.max(MIN_PRICE, ITEM_BY_ID[want.id].value); }
    if (d.act === 'tobid') { mtab = 'want'; mkind = null; msel = d.order; mjump = true; mn = n; tab = 'market'; picked = null; if (!desk) open = 'board'; }
    if (d.act === 'no') sure = null;
    if (d.act === 'yes' && sure) { const go = sure.yes; sure = null; go(); }

    // calls to the contract
    const from = b.getBoundingClientRect();      // where the press was: a picture flies from here when the call is done
    if (d.act === 'bait') game.act(() => send('buy_bait', { amount: n }), () => { fly(icon('icon_bait', 1), from, 'bait'); return `${icon('icon_bait', 0.7)} +${n} bait`; }, 'Buying bait…');
    if (d.act === 'up') game.act(() => send('upgrade', { what: d.key }), () => { adding = false; return d.key === 'storage' ? 'Storage upgraded' : 'Reel upgraded'; }, 'Upgrading…', d.key === 'storage' ? 'icon_storage' : 'hook');
    if (d.act === 'quest') game.act(() => send('hand_in'), (t) => { fly(icon('icon_ticket', 1), from, 'tickets'); return `${icon('icon_ticket', 0.9)} +${plural(+t, 'ticket')}!`; }, 'Handing in the quest…', 'icon_ticket');
    if (d.act === 'toss') game.act(() => send('throw_back', { token_id: d.id, amount: n }), () => `${name(d.id)} thrown back`, 'Throwing it back…');
    if (d.act === 'list') { const { n: k, price } = ask, id = d.id; game.act(() => send('list_item', { token_id: id, amount: k, price: String(price) }), () => `${k} ${name(id)} up for ${coin(price)} each`, 'Putting it up for sale…', id); }
    if (d.act === 'cancel') { game.act(() => send('cancel_item_order', { order: d.order }), () => 'Taken down', 'Taking it down…'); }
    // buying from a sale and selling into an offer: the order was opened first, with how many and what it comes
    // to (the same sum the contract does), so this is the confirmed step
    if (d.act === 'buy' || d.act === 'fill') {
      const buying = d.act === 'buy', order = d.order, o = S().orders.find((x) => x.id === order), what = o ? `${n} ${name(o.token_id)}` : `${n}`;
      const total = o ? o.price * n : 0, coins = buying ? total + feeOf(total) : total - feeOf(total);
      msel = null;
      game.act(() => send(buying ? 'buy_item' : 'sell_item', { order, amount: n }), () => {
        // bought: the thing flies into storage. sold: the coins fly into the purse.
        if (o) fly(buying ? pic(o.token_id, 26, 18) : icon('icon_coin', 1), from, buying ? 'store' : 'coins');
        return buying ? `${o ? pic(o.token_id, 22, 12) : ''} Bought ${what} for ${coin(coins)}` : `Sold ${what} · +${coin(coins)}`;
      }, buying ? `Buying ${what}…` : `Selling ${what}…`, o ? o.token_id : true);
    }
    if (d.act === 'want') {
      const { id, n: k, price } = want;
      sure = { text: `Offer ${coin(price)} each for ${k} ${name(id)}: ${coin(price * k)} and ${plural(k, 'box')} are set aside`, yes: () => game.act(() => send('want_item', { token_id: id, amount: k, price: String(price) }), () => `Offer for ${k} ${name(id)} is up`, 'Putting your offer up…', id) };
    }
    render();
  }
  // A price being typed. The card is not redrawn while typing (that would take the cursor away, and a press on
  // the button right after would land on nothing): only the sum on the button follows. Leaving the field puts a
  // price that is too low or not a number right.
  function typed(ev) {
    const el = ev.target.closest('[data-in]');
    if (!el) return;
    const v = Math.round(Number(el.value)), ok = Number.isFinite(v) && v >= MIN_PRICE;
    const price = ok ? Math.min(v, MAX_PRICE) : MIN_PRICE;
    const mineIs = el.dataset.in === 'askp' ? ask : want;
    mineIs.price = price;
    const sum = el.closest('.offer')?.querySelector(`[data-sum="${el.dataset.in}"]`);
    if (sum) sum.innerHTML = coin(price * mineIs.n);
    if (ev.type === 'change') el.value = price;
  }
  for (const el of [panel, ...docks]) { el.addEventListener('click', act); el.addEventListener('input', typed); el.addEventListener('change', typed); }
  $('btnShop').addEventListener('click', () => show('shop'));
  $('btnStorage').addEventListener('click', () => show('storage'));
  $('storeChip').addEventListener('click', () => { if (!desk) show('storage'); });
  $('btnMarket').addEventListener('click', () => show('board'));
  setInterval(live, 1000);

  // called when the window changes between phone shape and wide shape
  function setDesk(on) { if (on === desk) return; desk = on; open = null; picked = null; adding = false; if (!desk) for (const d of docks) d.innerHTML = ''; render(); }

  return { hud, toast, working, fly, icon, pic, coin, name, render, refresh, setDesk, get open() { return open; }, close() { if (!open) return; open = null; render(); } };
}
