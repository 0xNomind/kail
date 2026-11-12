// The page "A week in a minute" (week.html): plays the fast week of src/week.js and shows it a day at a time.
//
// A day is worked out at once (a tenth of a second) and then told over about eight seconds. The page is laid out
// in full before anything plays: seven days in the bar and in the table, six figures, six small charts, a row for
// every boat, a box of a fixed height for the boats' decisions. Playing only fills these in, so nothing appears,
// grows or pushes anything else while somebody is reading or scrolling.
import { loadArt } from './render.js';
import { paintIcons } from './sprites.js';
import { mountAccount } from './nav.js';
import { makeWeek } from './week.js';
import { FISHERS } from './npc-rules.js';

paintIcons(await loadArt());
mountAccount();
const $ = (id) => document.getElementById(id), DAYS = 7, PER_DAY_MS = 8000;
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const n4 = (x) => (x == null ? '–' : String(Math.round(x * 10000) / 10000)), plus = (x) => (x > 0 ? '+' : '') + n4(x);
let running = 0, hurry = false;

// ---- the parts of the page, each drawn from what is known so far (`days`: the days played; `boats`: where each stands)
function bar(days, now = 0, share = 0) {
  $('bar').innerHTML = Array.from({ length: DAYS }, (_, i) => {
    const d = days[i], state = d ? 'done' : i + 1 === now ? 'now' : '';
    const under = d ? `${d.winners} won${d.books.length ? '' : ' <span class="tick" title="The books closed">✓</span>'}` : i + 1 === now ? 'playing' : '&nbsp;';
    return `<li class="${state}"><span>Day ${i + 1}</span><i style="width:${d ? 100 : i + 1 === now ? Math.round(share * 100) : 0}%"></i><b>${under}</b></li>`;
  }).join('');
}
function figures(days) {
  const d = days[days.length - 1], sum = (f) => days.reduce((a, x) => a + f(x), 0);
  $('big').innerHTML = [['Day', d ? `${d.day} of ${DAYS}` : `– of ${DAYS}`], ['Prize money in the game', d ? `${n4(d.bankEnd)} NEAR` : '–'], ["The day's prize", d ? `${n4(d.prize)} NEAR` : '–'], ['A coin cost', d ? `${d.coinPrice} NEAR` : '–'],
    ['Tickets earned so far', d ? sum((x) => x.ticketsMade) : '–'], ['Paid to winners so far', d ? `${n4(sum((x) => x.paidOut))} NEAR` : '–']].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}
// a small line for one number over the seven days: the room for all seven is there from the start
function spark(label, values, unit) {
  const real = values.filter((v) => v != null), lo = Math.min(...real), hi = Math.max(...real), span = hi - lo || 1, x = (i) => (6 + (i * 108) / (DAYS - 1)).toFixed(1);
  const marks = Array.from({ length: DAYS }, (_, i) => `<line x1="${x(i)}" y1="34" x2="${x(i)}" y2="36" stroke="currentColor" opacity=".35"/>`).join('');
  const at = values.map((v, i) => (v == null ? null : [x(i), (30 - ((v - lo) / span) * 24).toFixed(1)])).filter(Boolean);
  const line = at.length > 1 ? `<polyline points="${at.map((p) => p.join(',')).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : '';
  const dot = at.length ? `<circle cx="${at[at.length - 1][0]}" cy="${at[at.length - 1][1]}" r="3" fill="currentColor"/>` : '';
  const last = real[real.length - 1];
  return `<div class="spark"><span>${label}</span><b>${last == null ? '–' : `${n4(last)}${unit ? ` ${unit}` : ''}`}</b><svg viewBox="0 0 120 38" preserveAspectRatio="none" aria-hidden="true">${marks}${line}${dot}</svg></div>`;
}
function charts(days) {
  const of = (f) => Array.from({ length: DAYS }, (_, i) => (days[i] ? f(days[i]) : null));
  $('sparks').innerHTML = spark('Prize money', of((x) => x.bankEnd), 'NEAR') + spark("A day's prize", of((x) => x.prize), 'NEAR') + spark('Price of a coin', of((x) => x.coinPrice * 1e6), 'millionths')
    + spark('Tickets into the draw', of((x) => x.ticketsEntered), '') + spark('Fish traded', of((x) => x.fishSold), '') + spark('Price of a fish', of((x) => x.fishPrice), 'coins');
}
function dayTable(days, now = 0) {
  const head = ['Day', 'Quest', 'Prize', 'Earned', 'In draw', 'Won', 'Fish'];
  $('days').innerHTML = `<thead><tr>${head.map((h, i) => `<th scope="col" class="${i > 1 ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${Array.from({ length: DAYS }, (_, i) => {
    const x = days[i];
    return `<tr class="${i + 1 === now ? 'now' : ''}"><td>${i + 1}</td><td class="quest">${x ? esc(x.quest.replace(/, /g, ' · ')) : '–'}</td>${(x ? [n4(x.prize), x.ticketsMade, x.ticketsEntered, x.winners, x.fishSold] : ['–', '–', '–', '–', '–']).map((v) => `<td class="num">${v}</td>`).join('')}</tr>`;
  }).join('')}</tbody>`;
}
// the ten boats always in the same rows; fishers who arrive later share one row, so the table never grows
function boatTable(boats, more) {
  const head = ['Boat', 'NEAR', 'Coins', 'Tickets', 'Quests'], row = (name, about, cells) => `<tr><td title="${esc(about)}">${esc(name)}</td>${cells.map((v) => `<td class="num">${v}</td>`).join('')}</tr>`;
  const first = FISHERS.map((f) => { const b = boats?.find((x) => x.name === f.name); return row(f.name, f.about, b ? [plus(b.change), b.coins, b.tickets, b.quests] : ['–', '–', '–', '–']); });
  const late = (boats || []).filter((b) => !FISHERS.some((f) => f.name === b.name)), sum = (f) => late.reduce((a, b) => a + f(b), 0);
  const extra = more ? row(`${more} new fishers`, 'They arrive on day 3, with the same ten characters.', late.length ? [`${plus(sum((b) => b.change) / late.length)} each`, sum((b) => b.coins), sum((b) => b.tickets), sum((b) => b.quests)] : ['–', '–', '–', '–']) : '';
  $('boats').innerHTML = `<thead><tr>${head.map((h, i) => `<th scope="col" class="${i ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${first.join('')}${extra}</tbody>`;
}
function blank() { bar([]); figures([]); charts([]); dayTable([]); boatTable(null, Number($('more').value)); }

async function play() {
  const mine = ++running; hurry = false;
  const seed = Math.max(1, Math.floor(Number($('seed').value)) || 1), more = Number($('more').value);
  const week = makeWeek({ seed, newcomers: more ? [{ day: 3, count: more }] : [] }), days = [], problems = [];
  blank();
  $('start').textContent = 'Play it again'; $('skip').disabled = false; $('saidList').innerHTML = '';
  $('books').textContent = 'After every day everything is added up: NEAR, coins, tickets, fish. A tick under a day means nothing appeared or vanished without a rule for it.';
  for (let n = 1; n <= DAYS; n++) {
    const d = week.playDay();
    if (mine !== running) return;
    problems.push(...d.books.map((b) => `day ${d.day}: ${b}`));
    $('now').textContent = `Day ${n} of ${DAYS}. The quest asks for ${d.quest}.`;
    dayTable(days, n);
    // a few of the day's decisions, one of each kind, told one after another while the day's bar fills
    const picked = d.said.filter((x, i, all) => all.findIndex((y) => y.step === x.step) === i).slice(0, 6), started = performance.now();
    for (let k = 0; k <= picked.length; k++) {
      const s = picked[k];
      if (s) {
        $('why').innerHTML = `<b>${esc(s.who)}:</b> ${esc(s.why)}`;
        $('saidList').insertAdjacentHTML('afterbegin', `<li><b>Day ${n}, ${esc(s.who)}</b> ${esc(s.why)}</li>`);
        while ($('saidList').children.length > 40) $('saidList').lastElementChild.remove();
      }
      const until = started + (PER_DAY_MS * (k + 1)) / (picked.length + 1);
      while (!hurry && performance.now() < until) {
        if (mine !== running) return;
        bar(days, n, (performance.now() - started) / PER_DAY_MS);
        await wait(120);
      }
    }
    if (mine !== running) return;
    days.push(d);
    bar(days, n + 1, 0); figures(days); charts(days); dayTable(days, n + 1); boatTable(week.standing(), more);
  }
  const made = days.reduce((a, x) => a + x.ticketsMade, 0), won = days.reduce((a, x) => a + x.winners, 0), refused = days.reduce((a, x) => a + x.refused, 0);
  bar(days); dayTable(days);
  $('now').textContent = `The week is over: ${made} tickets earned, ${won} winning tickets.`;
  $('why').textContent = 'Play it again with another number for another week, or with new fishers arriving on day 3.';
  $('skip').disabled = true;
  $('books').innerHTML = problems.length ? `<b>The books did not close.</b> ${problems.map(esc).join('<br>')}` : `<b>The books closed after every one of the ${DAYS} days.</b> No NEAR, coin, ticket or fish appeared or vanished without a rule for it. Steps the model refused, as the contract would have: ${refused}.`;
}
blank();
$('start').addEventListener('click', play);
$('skip').addEventListener('click', () => { hurry = true; });
$('more').addEventListener('change', () => { if (!$('skip').disabled) return; boatTable(null, Number($('more').value)); });
// for a look from the browser's console, and for tests of the page
window.kailWeek = { play, makeWeek };
