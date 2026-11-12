// The game's server on Cloudflare: one Worker that serves the pages and answers everything under /api.
// (On a developer's machine serve.mjs does the same job with Node.)
//
//   /api/sea, /api/sea/keep, /api/land   the game's own server (game.mjs): the player's sea, and landing a catch
//   /api/auth/open, /api/auth/sign       for players who sign in with NEAR Auth (relay.mjs)
//   /api/welcome                         the 5 bait of welcome for a new account (relay.mjs)
//   /api/npcs                            the computer's boats (see below)
//   anything else                        the pages, as built into dist/ by "npm run build"
// Once a minute Cloudflare also calls `scheduled`: the draw of every day that is over is held.
//
// Settings: [vars] in wrangler.toml for the names, and secrets for the keys (NEAR_KEY, WELCOME_KEY); see README.md.
import game, { holdDraws } from './game.mjs';
import { makeRelay } from './relay.mjs';
import { FISHERS } from '../src/npc-rules.js';

const HELPER = { '/api/auth/open': 'open', '/api/auth/sign': 'sign', '/api/welcome': 'bait' };
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// The helper keeps count of what it gave out lately, in memory. A Worker's memory lasts as long as Cloudflare
// keeps this copy of it running, and there may be more than one copy: the limits are a brake, not a lock.
let relay = null, relayOf = null;
function helper(env) {
  if (relayOf !== env.WELCOME_KEY) { relay = makeRelay(env); relayOf = env.WELCOME_KEY; }
  return relay;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && HELPER[url.pathname]) {
      const r = helper(env);
      if (!r) return json(503, { error: 'This server has no welcome account (WELCOME and WELCOME_KEY in its settings)' });
      const raw = await request.text();
      if (raw.length > 32_000) return json(413, { error: 'Too long' });
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { return json(400, { error: 'Send JSON' }); }
      try { const [status, data] = await r[HELPER[url.pathname]](body); return json(status, data); }
      catch (e) { return json(502, { error: String(e?.message || e).slice(0, 200) }); }
    }
    // The computer's boats need a process that stays up, which a Worker is not: they run elsewhere
    // (server/boats.mjs) and play through this server like players. Every two minutes their runner tells this
    // server who they are, what each is doing and why; that is kept (in KV, binding BOATS) and handed to the game,
    // which shows it beside their orders. With no news, the game is only told which accounts are boats (NPCS).
    if (url.pathname === '/api/npcs') {
      if (request.method === 'POST') {
        if (!env.BOATS_TOKEN || request.headers.get('authorization') !== `Bearer ${env.BOATS_TOKEN}`) return json(401, { error: 'Only the boats\' runner tells their news' });
        const raw = await request.text();
        let list = null;
        try { list = JSON.parse(raw); } catch { /* refused below */ }
        if (raw.length > 200_000 || !Array.isArray(list) || list.length > 50) return json(400, { error: 'Send the list of boats' });
        if (env.BOATS) await env.BOATS.put('news', JSON.stringify({ at: Date.now(), boats: list }), { expirationTtl: 900 });
        return json(200, { kept: !!env.BOATS });
      }
      // (news older than a quarter of an hour is no news: the runner has stopped)
      const news = env.BOATS ? await env.BOATS.get('news', { type: 'json', cacheTtl: 60 }).catch(() => null) : null;
      if (news?.boats && Date.now() - news.at < 15 * 60_000) return json(200, news.boats);
      const boats = String(env.NPCS || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.split('='));
      return json(200, boats.map(([account, called], i) => { const who = FISHERS.find((f) => f.name === called) || FISHERS[i % FISHERS.length]; return { account, name: who.name, about: who.about, doing: '', why: '', reasons: {} }; }));
    }
    if (url.pathname.startsWith('/api/')) return game.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env, ctx) {
    if (env.NEAR_KEY) ctx.waitUntil(holdDraws(env).catch((e) => console.log('could not hold the draw:', String(e?.message || e).slice(0, 160))));
  },
};
