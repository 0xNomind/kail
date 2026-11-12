// Hands the server's keys to Cloudflare as secrets, without showing them: NEAR_KEY (from server/.dev.vars) and
// WELCOME_KEY (the welcome account's key, from where the NEAR CLI keeps it). Run once before the first deploy and
// again whenever a key changes, after "npx wrangler login":
//
//   node scripts/cloudflare-secrets.mjs            hand them over
//   node scripts/cloudflare-secrets.mjs --look     only say which would be sent (never their values)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vars = Object.fromEntries(fs.readFileSync(path.join(root, 'server/.dev.vars'), 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
// the password between the boats' runner (server/boats.mjs) and the hosted server: made up here once, and kept in
// server/.dev.vars so that the runner can be given the same one
if (!vars.BOATS_TOKEN && !process.argv.includes('--look')) {
  vars.BOATS_TOKEN = randomBytes(24).toString('hex');
  fs.appendFileSync(path.join(root, 'server/.dev.vars'), `\nBOATS_TOKEN=${vars.BOATS_TOKEN}\n`);
}
const secrets = {};
for (const name of ['NEAR_KEY', 'SEA_KEY', 'WELCOME_KEY', 'BOATS_TOKEN', 'RELAY_FEE', 'NEAR_RPC', 'NEAR_AUTH_ISSUER', 'NEAR_AUTH_CLIENT']) if (vars[name]) secrets[name] = vars[name];
if (!secrets.WELCOME_KEY && vars.WELCOME) {
  const file = path.join(os.homedir(), '.near-credentials', vars.NEAR_NETWORK || 'testnet', `${vars.WELCOME}.json`);
  if (fs.existsSync(file)) secrets.WELCOME_KEY = JSON.parse(fs.readFileSync(file, 'utf8')).private_key;
}
const names = Object.keys(secrets);
if (!secrets.NEAR_KEY) { console.log('server/.dev.vars has no NEAR_KEY: nothing to hand over.'); process.exit(1); }
console.log(`Secrets for the Worker: ${names.join(', ')}${secrets.WELCOME_KEY ? '' : '  (no key found for the welcome account: NEAR Auth and the welcome bait will be off)'}`);
if (process.argv.includes('--look')) { console.log('Nothing was sent (--look).'); process.exit(0); }
const r = spawnSync(path.join(root, 'node_modules/.bin/wrangler'), ['secret', 'bulk', '-c', path.join(root, 'server/wrangler.toml')], { input: JSON.stringify(secrets), stdio: ['pipe', 'inherit', 'inherit'] });
process.exit(r.status ?? 1);
