// The landing page: sign in with a NEAR wallet, a live view of the game's sea, and today's quest read from
// the contract.
import { W, ITEM_BY_ID } from './config.js';
import { newWorld, newPlayer, step } from './sim.js';
import { loadArt, makeRenderer } from './render.js';
import { paintIcons, spriteHTML } from './sprites.js';
import { account, signedInWithAuth, NETWORK } from './account.js';
import { mountAccount, openSignIn, disconnectWallet } from './nav.js';
import { view, near, dayNote } from './chain.js';

const art = await loadArt();
paintIcons(art);

// --- who plays: the game is played with a NEAR account, connected through a wallet
const who = account();
mountAccount();
document.getElementById('signedOut').hidden = !!who;
document.getElementById('signedIn').hidden = !who;
if (who) { document.getElementById('acct').textContent = who; document.getElementById('acctHow').textContent = `${signedInWithAuth() ? 'NEAR Auth' : 'wallet'} · ${NETWORK}`; }
// one button: the box it opens has the two ways of signing in (NEAR Auth, or a wallet)
document.getElementById('signin').addEventListener('click', () => openSignIn());
document.getElementById('signout').addEventListener('click', () => disconnectWallet());

// --- the sea, live: the real game with nobody throwing the hook
const canvas = document.getElementById('sea'), VIEW_H = 300;
const renderer = makeRenderer(canvas, art), world = newWorld(42), idle = newPlayer();
const fit = () => renderer.resize(VIEW_H, (canvas.getBoundingClientRect().width / W) * (window.devicePixelRatio || 1));
canvas.style.aspectRatio = `${W} / ${VIEW_H}`;
fit();
new ResizeObserver(fit).observe(canvas);
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
let last = performance.now(), t = 0;
function frame(now) {
  if (!still) requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now; t += dt;
  if (!document.hidden) { step(world, idle, dt); world.events.length = 0; renderer.draw(world, dt, t); }
}
if (still) { for (let i = 0; i < 30; i++) step(world, idle, 1 / 30); renderer.draw(world, 0, 1); } else requestAnimationFrame(frame);

// --- today's quest and the day's numbers, from the contract
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let ends = 0;
async function today() {
  try {
    const { quest: q, draw: d, vault, day_ms: dayMs } = await view('state', { account_id: null });
    document.getElementById('dayNote').textContent = dayNote(Number(dayMs));
    ends = Date.now() + q.ends_in_ms;
    document.getElementById('needs').innerHTML = q.needs.map(([id, n]) => {
      const it = ITEM_BY_ID[id], k = it.rare ? 3 : it.w > 56 ? 1 : it.w > 34 ? 2 : 3;
      return `<div class="n"><span class="ic">${spriteHTML(art, it.sprite, k)}</span><span><b>${n} × ${it.name}</b></span></div>`;
    }).join('');
    document.getElementById('left').textContent = `${d.tickets} of ${d.cap || 500}`;
    document.getElementById('prize').textContent = `${near(d.pool)} NEAR`;
    document.getElementById('each').textContent = `${near(vault)} NEAR`;
  } catch { /* the next try will do */ }
}
today();
setInterval(() => { document.getElementById('clock').textContent = ends ? mmss(ends - Date.now()) : '...'; if (ends && Date.now() > ends + 1500) today(); }, 1000);
setInterval(today, 20000);
