// Tiny local web server for the game: node serve.mjs  ->  http://localhost:3000
// No dependencies. Files are never cached, so a reload always shows the latest code.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// The game's server (server/game.mjs) runs inside this one while developing: anything under /api goes to it,
// and it holds the draw of finished days once a minute. Its secrets come from server/.dev.vars.
const env = {};
try {
  for (const line of fs.readFileSync(path.join(root, 'server/.dev.vars'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
} catch { /* no server key on this machine: the pages still work, catches cannot be landed */ }
let game = null;
const loadGame = async () => (game ||= await import('./server/game.mjs'));
// Somebody who only wants to look at the game on their own machine has no keys. KAIL_SERVER names a server that
// has (the hosted one): everything under /api is then passed on to it, and the pages are served from here.
const elsewhere = !env.NEAR_KEY ? String(process.env.KAIL_SERVER || env.KAIL_SERVER || '').replace(/\/$/, '') : '';
async function passOn(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const answer = await fetch(elsewhere + req.url, { method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json' }, body: chunks.length ? Buffer.concat(chunks) : undefined });
  res.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
  res.end(Buffer.from(await answer.arrayBuffer()));
}
async function api(req, res) {
  const { default: worker } = await loadGame();
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
  const answer = await worker.fetch(request, env);
  res.writeHead(answer.status, Object.fromEntries(answer.headers));
  res.end(Buffer.from(await answer.arrayBuffer()));
}
// The other boats (server/npc.mjs): fishers the computer plays, when NPCS names their accounts. Their catches go
// through the game's server like a player's.
let boats = null;
if (env.NEAR_KEY && env.NPCS) {
  (async () => {
    const [{ default: worker }, { startNpcs }] = await Promise.all([loadGame(), import('./server/npc.mjs')]);
    const ask = async (path, body) => {
      const r = await worker.fetch(new Request(`http://boats${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
      return { status: r.status, ...(await r.json().catch(() => ({}))) };
    };
    boats = startNpcs({ env, api: ask, say: (line) => console.log(`[boat] ${line}`) });
  })().catch((e) => console.log('the other boats did not start:', String(e?.message || e).slice(0, 200)));
}
// The helper for new players and for players who sign in with NEAR Auth (server/relay.mjs), when WELCOME names
// its account: it makes a NEAR Auth player's account, gives every new account its 5 bait, and carries approvals.
let relay = null;
// (its key is read from where the NEAR CLI keeps it; a hosted server gets it in its settings, as WELCOME_KEY)
if (env.WELCOME && !env.WELCOME_KEY) {
  try { env.WELCOME_KEY = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.near-credentials', env.NEAR_NETWORK || 'testnet', `${env.WELCOME}.json`), 'utf8')).private_key; } catch { /* said below */ }
}
if (env.WELCOME) import('./server/relay.mjs').then(({ makeRelay }) => { relay = makeRelay(env); console.log(relay ? `welcome account: ${relay.account}` : `(WELCOME is set, but its key is not on this machine)`); }).catch((e) => console.log('the welcome account did not start:', String(e?.message || e).slice(0, 200)));
async function auth(req, res, what) {
  const send = (status, data) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(data));
  if (!relay) return send(503, { error: 'This server has no welcome account (WELCOME in server/.dev.vars)' });
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 32_000) return send(413, { error: 'Too long' }); chunks.push(c); }
  let body; try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return send(400, { error: 'Send JSON' }); }
  const [status, data] = await relay[what](body);
  console.log(`[welcome] ${what} -> ${status} ${JSON.stringify(data).slice(0, 160)}`);
  send(status, data);
}
if (env.NEAR_KEY) {
  setInterval(async () => {
    try { const held = await (await loadGame()).holdDraws(env); if (held.length) console.log('draws held:', JSON.stringify(held)); }
    catch (e) { console.log('could not hold the draw:', String(e?.message || e).slice(0, 160)); }
  }, 60_000);
}
// One address: http://localhost:3000. NEAR Auth's sign-in client for testnet (shared by everybody trying it out)
// only lets a site at exactly that address sign people in, so the whole game lives there.
const port = Number(process.env.PORT || 3000);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ico': 'image/x-icon' };

const HELPER = { '/api/auth/open': 'open', '/api/auth/sign': 'sign', '/api/welcome': 'bait' };
const SITE = /^\/(index|play|harbour|tickets)\.html$|^\/favicon\.ico$|^\/(src|public)\/[^?#]+$/;
const answer = (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (elsewhere && url.pathname.startsWith('/api/')) { passOn(req, res).catch((e) => res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `The game's server at ${elsewhere} did not answer: ${String(e?.message || e).slice(0, 120)}` }))); return; }
  if (req.method === 'POST' && HELPER[url.pathname]) { auth(req, res, HELPER[url.pathname]).catch((e) => res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e?.message || e).slice(0, 200) }))); return; }
  if (url.pathname === '/api/npcs') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(boats ? boats.status() : [])); return; }
  if (url.pathname.startsWith('/api/')) { api(req, res).catch((e) => { res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e?.message || e).slice(0, 200) })); }); return; }
  let rel = decodeURIComponent(url.pathname);
  // clean addresses: /play shows play.html, and the old /play.html address moves on to /play
  if (rel.endsWith('.html') && rel !== '/index.html') { res.writeHead(301, { location: rel.slice(0, -5) + url.search }).end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  else if (!path.extname(rel) && fs.existsSync(path.join(root, rel + '.html'))) rel += '.html';
  // Only the site itself is handed out: the four pages, their scripts and styles, the pictures and the music.
  // Everything else in this folder (the server's code and, above all, its settings with the keys) is not a page:
  // asked for by address, it is "not found". The same list is what gets published (scripts/build-site.mjs).
  if (!SITE.test(rel) || rel.split('/').some((part) => part.startsWith('.'))) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
};
http.createServer(answer)
  .on('error', (e) => { console.log(e.code === 'EADDRINUSE' ? `Port ${port} is taken by another program. Close that one and start again.` : String(e)); process.exit(1); })
  .listen(port, () => console.log(`Kail is at http://localhost:${port}${elsewhere ? ` (its server: ${elsewhere})` : env.NEAR_KEY ? '' : ' (no server key here: the pages work, catches cannot be landed; see README.md)'}`));
