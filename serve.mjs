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
  const chunks = await bodyOf(req);
  if (!chunks) { res.writeHead(413, { 'content-type': 'application/json', connection: 'close' }).end(JSON.stringify({ error: 'Too long' })); return; }
  const answer = await fetch(elsewhere + req.url, { method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json' }, body: chunks.length ? Buffer.concat(chunks) : undefined });
  res.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
  res.end(Buffer.from(await answer.arrayBuffer()));
}
// A request's body, read up to a limit: more than that is not a request of the game's, and is not kept in memory.
const MOST_BODY = 96 * 1024;
async function bodyOf(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MOST_BODY) return null; chunks.push(c); }
  return chunks;
}
async function api(req, res) {
  const { default: worker } = await loadGame();
  const chunks = await bodyOf(req);
  if (!chunks) { res.writeHead(413, { 'content-type': 'application/json', connection: 'close' }).end(JSON.stringify({ error: 'Too long' })); return; }
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
    // every catch landed costs the server's account a fee: said here before it runs dry and catches stop landing
    try { const near = await (await loadGame()).purse(env); if (near != null && near < 0.5) console.log(`LOW: the server's account ${env.NEAR_ACCOUNT} holds ${near} NEAR. Top it up, or catches will stop being landed.`); }
    catch { /* asked again in a minute */ }
  }, 60_000);
}
// One address: http://localhost:3000. NEAR Auth's sign-in client for testnet (shared by everybody trying it out)
// only lets a site at exactly that address sign people in, so the whole game lives there.
const port = Number(process.env.PORT || 3000);
// HOST=127.0.0.1 keeps it to this machine alone, for when a web server in front of it (Caddy, with HTTPS) is the
// way in from outside (deploy/kail.service). Without it, as before: reachable from the same network too.
const host = process.env.HOST || undefined;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ico': 'image/x-icon' };

const HELPER = { '/api/auth/open': 'open', '/api/auth/sign': 'sign', '/api/welcome': 'bait' };
const SITE = /^\/(index|play|harbour|tickets|week)\.html$|^\/favicon\.ico$|^\/(src|public)\/[^?#]+$/;
const PAGES = /^\/(play|harbour|tickets|week)\.html$/;
// what every answer carries: the pages are not to be shown inside somebody else's page, and a file is what its type says
const SAFE = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin' };

// ---- who is asking, and how often
// Behind a web server on this machine (Caddy) every request comes from this machine, and the asker's address is
// in X-Forwarded-For. Without one in front, the asker is whoever the connection is from.
const loopback = (a) => /^(::1|127\.|::ffff:127\.)/.test(a || '');
function askerOf(req) {
  const direct = req.socket.remoteAddress || '', passed = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 64);
  return { address: loopback(direct) && passed ? passed : direct, thisMachine: loopback(direct) && !passed && !req.headers['cf-connecting-ip'] };
}
// So many requests at once and so many a second after that, for each address: a game asks a few times a minute,
// so this only stops somebody making the server (and the public nodes it asks) work for nothing.
function limiter(burst, perSecond) {
  const seen = new Map();
  return (address) => {
    const now = Date.now(), had = seen.get(address) || { left: burst, at: now };
    const left = Math.min(burst, had.left + ((now - had.at) / 1000) * perSecond);
    if (seen.size > 20_000) for (const [k, v] of seen) if (now - v.at > 120_000) seen.delete(k);
    if (left < 1) { seen.set(address, { left, at: now }); return false; }
    seen.set(address, { left: left - 1, at: now });
    return true;
  };
}
const gameRoom = limiter(40, 8), helperRoom = limiter(6, 0.1);
const busy = (res) => res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '5', 'cache-control': 'no-store' }).end(JSON.stringify({ error: 'Too many requests from your address. Try again in a moment.' }));
// NEAR Auth's sign-in client for testnet lets only a page at http://localhost:3000 sign people in, so the two
// routes that carry its sign-ins and approvals answer only this machine's own browser then. Where the game has a
// sign-in client of its own (NEAR_AUTH_CLIENT, as on mainnet), they are open.
const authOpenTo = (asker) => !!env.NEAR_AUTH_CLIENT || asker.thisMachine;

function answer(req, res) {
  const url = new URL(req.url, 'http://x');
  const asker = askerOf(req);
  if (elsewhere && url.pathname.startsWith('/api/')) { passOn(req, res).catch((e) => res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `The game's server at ${elsewhere} did not answer: ${String(e?.message || e).slice(0, 120)}` }))); return; }
  if (req.method === 'POST' && HELPER[url.pathname]) {
    if (url.pathname.startsWith('/api/auth/') && !authOpenTo(asker)) { res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ error: 'NEAR Auth signs people in only at http://localhost:3000 on testnet.' })); return; }
    if (!asker.thisMachine && !helperRoom(asker.address)) { busy(res); return; }
    auth(req, res, HELPER[url.pathname]).catch((e) => res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e?.message || e).slice(0, 200) })));
    return;
  }
  if (url.pathname.startsWith('/api/') && !asker.thisMachine && !gameRoom(asker.address)) { busy(res); return; }
  if (url.pathname === '/api/npcs') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(boats ? boats.status() : [])); return; }
  if (url.pathname.startsWith('/api/')) { api(req, res).catch((e) => { res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e?.message || e).slice(0, 200) })); }); return; }
  let rel = decodeURIComponent(url.pathname);
  // an address is letters, digits and a few marks: nothing that could end a header line or a file name
  if (/[\0-\x1f\\]/.test(rel)) { res.writeHead(400, { 'content-type': 'text/plain' }).end('Bad request'); return; }
  // clean addresses: /play shows play.html, and the old /play.html address moves on to /play (the game's own
  // pages only: an address made up to look like one must not send anybody somewhere else)
  if (PAGES.test(rel)) { res.writeHead(301, { location: rel.slice(0, -5) + url.search }).end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  else if (!path.extname(rel) && fs.existsSync(path.join(root, rel + '.html'))) rel += '.html';
  // Only the site itself is handed out: the pages, their scripts and styles, the pictures and the music.
  // Everything else in this folder (the server's code and, above all, its settings with the keys) is not a page:
  // asked for by address, it is "not found". The same list is what gets published (scripts/build-site.mjs).
  if (!SITE.test(rel) || rel.split('/').some((part) => part.startsWith('.'))) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', ...SAFE });
    res.end(data);
  });
}
// An address this server cannot even read (a broken escape, two slashes for a start) is answered "bad request".
// Nothing a stranger sends may stop the server: it also runs the boats, and holds the draws.
function safely(req, res) {
  try { answer(req, res); }
  catch { try { if (!res.headersSent) res.writeHead(400, { 'content-type': 'text/plain' }); res.end('Bad request'); } catch { /* the connection is gone */ } }
}
process.on('unhandledRejection', (e) => console.log('a promise was left unanswered:', String(e?.message || e).slice(0, 200)));
http.createServer(safely)
  .on('error', (e) => { console.log(e.code === 'EADDRINUSE' ? `Port ${port} is taken by another program. Close that one and start again.` : String(e)); process.exit(1); })
  .listen(port, host, () => console.log(`Kail is at http://localhost:${port}${elsewhere ? ` (its server: ${elsewhere})` : env.NEAR_KEY ? '' : ' (no server key here: the pages work, catches cannot be landed; see README.md)'}`));
