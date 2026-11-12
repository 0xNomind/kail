// The page "A week in a minute" (week.html): plays the fast week of src/week.js and shows it a day at a time.
//
// The settings are the reader's: NEAR in the prize vault at the start, players on the first day, players who join
// on every later day, and the luck number (which chance the week gets). A day is worked out away from the page
// (src/weekworker.js) and then told over about eight seconds. The page is laid out in full before anything plays:
// seven days in the bar and in the table, six figures, six small charts, a row for each of the ten characters,
// every line of the NEAR table, a box of a fixed height for the decisions. Playing only fills these in, so nothing
// appears, grows or pushes anything else while somebody is reading or scrolling.
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
const n4 = (x) => (x == null ? '–' : String(Math.round(x * 10000) / 10000)), plus = (x) => (x > 0 ? '+' : '') + n4(x), n6 = (x) => x.toFixed(6);
const LINES = makeWeek({ players: 0, vault: 0 }).money();      // the lines of the NEAR table, before there are numbers for them
let running = 0, hurry = false, engine = null;

// ---- the settings: read from the page, kept inside what the page can play, and written back as they are used
function settings() {
  const num = (id, lo, hi, whole) => { const el = $(id), v = Number(el.value), x = Math.min(hi, Math.max(lo, Number.isFinite(v) ? (whole ? Math.floor(v) : Math.round(v * 100) / 100) : lo)); el.value = x; return x; };
  return { vault: num('vault', 0, 10000), players: num('players', 1, 100, true), joining: num('joining', 0, 20, true), seed: num('seed', 1, 999999, true) };
}
// the days are worked out by a worker; where that cannot start, here on the page (the same week either way)
function startEngine(options) {
  const waiting = [];
  let given = 0, here = null;
  const answer = () => ({ day: here.playDay(), boats: here.standing(), money: here.money() });
  const onPage = () => { if (here) return; here = makeWeek(options); for (let i = 0; i < given; i++) here.playDay(); for (const w of waiting.splice(0)) w(answer()); };
  let worker = null;
  try {
    worker = new Worker(new URL('./weekworker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { given += 1; waiting.shift()?.(data); };
    worker.onerror = () => { worker.terminate(); worker = null; onPage(); };
    worker.postMessage({ start: options });
  } catch { worker = null; onPage(); }
  return {
    day: () => new Promise((resolve) => { if (here) { given += 1; resolve(answer()); } else { waiting.push(resolve); worker.postMessage({ day: true }); } }),
    stop: () => worker?.terminate(),
  };
}

// ---- the parts of the page, each drawn from what is known so far (`days`: the days played; `boats`: where each player stands)
function bar(days, now = 0, share = 0) {
  $('bar').innerHTML = Array.from({ length: DAYS }, (_, i) => {
    const d = days[i], state = d ? 'done' : i + 1 === now ? 'now' : '';
    const under = d ? `${d.winners} won${d.books.length ? '' : ' <span class="tick" title="The books closed">✓</span>'}` : i + 1 === now ? 'playing' : '&nbsp;';
    return `<li class="${state}"><span>Day ${i + 1}</span><i style="width:${d ? 100 : i + 1 === now ? Math.round(share * 100) : 0}%"></i><b>${under}</b></li>`;
  }).join('');
}
function figures(days) {
  const d = days[days.length - 1], sum = (f) => days.reduce((a, x) => a + f(x), 0);
  $('big').innerHTML = [['Players', d ? d.players : '–'], ['Prize money in the game', d ? `${n4(d.bankEnd)} NEAR` : '–'], ["The day's prize", d ? `${n4(d.prize)} NEAR` : '–'], ['1,000 coins cost', d ? `${n4(d.coinPrice * 1000)} NEAR` : '–'],
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
  $('sparks').innerHTML = spark('Prize money', of((x) => x.bankEnd), 'NEAR') + spark("A day's prize", of((x) => x.prize), 'NEAR') + spark('1,000 coins cost', of((x) => x.coinPrice * 1000), 'NEAR')
    + spark('Tickets into the draw', of((x) => x.ticketsEntered), '') + spark('Fish traded', of((x) => x.fishSold), '') + spark('Price of a fish', of((x) => x.fishPrice), 'coins');
}
function dayTable(days, now = 0) {
  const head = ['Day', 'Quest', 'Players', 'Prize', 'Earned', 'In draw', 'Won', 'Fish', 'Fees'];
  $('days').innerHTML = `<thead><tr>${head.map((h, i) => `<th scope="col" class="${i > 1 ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${Array.from({ length: DAYS }, (_, i) => {
    const x = days[i];
    return `<tr class="${i + 1 === now ? 'now' : ''}"><td>${i + 1}</td><td class="quest">${x ? esc(x.quest.replace(/, /g, ' · ')) : '–'}</td>${(x ? [x.players, n4(x.prize), x.ticketsMade, x.ticketsEntered, x.winners, x.fishSold, n4(x.fees + x.serverFees)] : ['–', '–', '–', '–', '–', '–', '–']).map((v) => `<td class="num">${v}</td>`).join('')}</tr>`;
  }).join('')}</tbody>`;
}
// the players, by the ten characters they are: always ten rows, however many players there are
function boatTable(boats) {
  const head = ['Character', 'Players', 'NEAR each', 'Coins', 'Tickets', 'Quests'];
  $('boats').innerHTML = `<thead><tr>${head.map((h, i) => `<th scope="col" class="${i ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${FISHERS.map((f) => {
    const mine = (boats || []).filter((b) => b.character === f.name), sum = (g) => mine.reduce((a, b) => a + g(b), 0);
    const cells = !boats ? ['–', '–', '–', '–', '–'] : !mine.length ? [0, '–', '–', '–', '–'] : [mine.length, plus(sum((b) => b.change) / mine.length), sum((b) => b.coins), sum((b) => b.tickets), sum((b) => b.quests)];
    return `<tr><td title="${esc(f.about)}">${esc(f.name)}</td>${cells.map((v) => `<td class="num">${v}</td>`).join('')}</tr>`;
  }).join('')}</tbody>`;
}
// all the NEAR: what came into the game from outside, and every place it is now; the two totals are the same number
function nearTable(money) {
  const rows = (list, numbers) => list.map(([k], i) => `<tr><td>${esc(k)}</td><td class="num">${numbers ? n6(numbers[i][1]) : '–'}</td></tr>`).join('');
  const total = (k, v) => `<tr class="total"><td>${k}</td><td class="num">${v == null ? '–' : n6(v)}</td></tr>`;
  $('near').innerHTML = `<colgroup><col><col class="amount"></colgroup><tbody><tr class="part"><th scope="colgroup" colspan="2">Came into the game from outside</th></tr>${rows(LINES.cameIn, money?.cameIn)}${total('All that came in', money?.total)}
    <tr class="part"><th scope="colgroup" colspan="2">Where it is now</th></tr>${rows(LINES.isNow, money?.isNow)}${total('All there is now', money?.totalNow)}</tbody>`;
}
function blank() { bar([]); figures([]); charts([]); dayTable([]); boatTable(null); nearTable(null); }

async function play() {
  const mine = ++running; hurry = false;
  engine?.stop();
  const options = settings(), eng = engine = startEngine(options), days = [], problems = [];
  let money = null;
  blank();
  $('start').textContent = 'Play it again'; $('skip').disabled = false; $('saidList').innerHTML = '';
  $('now').textContent = 'Working out day 1…'; $('why').textContent = `${options.players} player${options.players === 1 ? '' : 's'} start, with 10 NEAR each; the prize vault holds ${options.vault} NEAR. Luck no. ${options.seed}.`;
  $('books').textContent = 'After every day everything is added up: NEAR, coins, tickets, fish. A tick under a day means nothing appeared or vanished without a rule for it.';
  let next = eng.day();
  for (let n = 1; n <= DAYS; n++) {
    const r = await next, d = r.day;
    if (mine !== running) return;
    if (n < DAYS) next = eng.day();      // the next day is worked out while this one is told
    problems.push(...d.books.map((b) => `day ${d.day}: ${b}`));
    $('now').textContent = `Day ${n} of ${DAYS}, ${d.players} player${d.players === 1 ? '' : 's'}. Quest: ${d.quest}.`;
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
    days.push(d); money = r.money;
    bar(days, n + 1, 0); figures(days); charts(days); dayTable(days, n + 1); boatTable(r.boats); nearTable(money);
  }
  eng.stop();
  const made = days.reduce((a, x) => a + x.ticketsMade, 0), won = days.reduce((a, x) => a + x.winners, 0), refused = days.reduce((a, x) => a + x.refused, 0);
  bar(days); dayTable(days);
  $('now').textContent = `The week is over: ${made} tickets earned, ${won} winning tickets.`;
  $('why').textContent = `That was luck no. ${options.seed}. “Play it again” gives exactly this week again; “Play with other luck” gives the same game a different week.`;
  $('skip').disabled = true;
  $('books').innerHTML = problems.length ? `<b>The books did not close.</b> ${problems.map(esc).join('<br>')}`
    : `<b>The books closed after every one of the ${DAYS} days.</b> No NEAR, coin, ticket or fish appeared or vanished without a rule for it: ${n6(money.total)} NEAR came in, and ${n6(money.totalNow)} NEAR is accounted for. Steps the model refused, as the contract would have: ${refused}.`;
}
blank();
$('start').addEventListener('click', play);
$('skip').addEventListener('click', () => { hurry = true; });
// other dice: a luck number nobody chose, written into the box so that the week can be played again or checked elsewhere
$('reroll').addEventListener('click', () => { $('seed').value = 1 + Math.floor(Math.random() * 999999); play(); });
// for a look from the browser's console, and for tests of the page
window.kailWeek = { play, makeWeek };
