// Makes the NEAR accounts for the other boats (server/npc-rules.mjs), all in one go:
//
//   node scripts/npc-accounts.mjs            every fisher gets an account
//   node scripts/npc-accounts.mjs 3          only the first three
//   node scripts/npc-accounts.mjs --look     only say what would be done
//
// Each account is created through the testnet faucet with the NEAR CLI, which gives it 10 free testnet NEAR and
// keeps its key on this machine (~/.near-credentials/testnet/<account>.json). The names are written to
// server/npc-accounts.json, and the line NPCS=... is put into server/.dev.vars, so the server starts the boats the
// next time it runs. Running it again makes only what is still missing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FISHERS } from '../server/npc-rules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEAR = [path.join(os.homedir(), '.cargo/bin/near'), 'near'].find((p) => p === 'near' || fs.existsSync(p));
const NODES = ['https://test.rpc.fastnear.com', 'https://rpc.testnet.fastnear.com', 'https://near-testnet.drpc.org'];
const look = process.argv.includes('--look');
const many = Math.max(1, Math.min(FISHERS.length, Number(process.argv.find((a) => /^\d+$/.test(a))) || FISHERS.length));
const listFile = path.join(root, 'server/npc-accounts.json'), varsFile = path.join(root, 'server/.dev.vars');
const keyFile = (id) => path.join(os.homedir(), '.near-credentials/testnet', `${id}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// What the CLI answered, for when it fails: its last lines, without anything that could be a private key.
function said(r) {
  return `${r.stdout || ''}\n${r.stderr || ''}`.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter((l) => l && !/private|secret|seed|phrase/i.test(l)).slice(-6).join('\n      ');
}

// Is there such an account on testnet? (true, false, or null when no node answered)
async function exists(id) {
  for (const url of NODES) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: id } }) });
      const j = await r.json();
      if (j.result?.amount != null) return true;
      if (/UNKNOWN_ACCOUNT|does not exist/i.test(JSON.stringify(j.error || j.result || ''))) return false;
    } catch { /* the next node */ }
  }
  return null;
}
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const tail = () => Math.random().toString(36).slice(2, 6);

const known = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')) : {};
let made = 0, kept = 0, failed = 0;
for (const who of FISHERS.slice(0, many)) {
  // an account made earlier, with its key still on this machine, is kept
  if (known[who.name] && fs.existsSync(keyFile(known[who.name])) && (await exists(known[who.name])) !== false) { console.log(`${who.name}: has ${known[who.name]} already`); kept++; continue; }
  // a free name: kail-<fisher>.testnet, or the same with four more letters when somebody has that one
  let id = `kail-${slug(who.name)}.testnet`, there = await exists(id);
  if (there && fs.existsSync(keyFile(id))) { console.log(`${who.name}: has ${id} already (its key is on this machine)`); known[who.name] = id; kept++; continue; }
  for (let i = 0; there !== false && i < 5; i++) { id = `kail-${slug(who.name)}-${tail()}.testnet`; there = await exists(id); }
  if (there !== false) { console.log(`${who.name}: could not find a free name (is the network reachable?)`); failed++; continue; }
  if (look) { console.log(`${who.name}: would make ${id}`); continue; }
  // the faucet does not like many accounts in a row: try again a little later when it says no
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    console.log(`${who.name}: making ${id}${attempt > 1 ? ` (try ${attempt})` : ''}…`);
    const r = spawnSync(NEAR, ['account', 'create-account', 'sponsor-by-faucet-service', id, 'autogenerate-new-keypair', '--signature-scheme', 'ed25519', 'save-to-legacy-keychain', 'network-config', 'testnet', 'create'], { encoding: 'utf8' });
    for (let i = 0; i < 10 && !ok; i++) { ok = fs.existsSync(keyFile(id)) && (await exists(id)) === true; if (!ok) await sleep(2000); }
    if (!ok) { console.log(`   the faucet did not make it. It said:\n      ${said(r) || '(nothing)'}\n   Waiting half a minute…`); await sleep(30_000); }
  }
  if (!ok) { console.log(`${who.name}: not made. Run this again later: what is made is kept.`); failed++; continue; }
  known[who.name] = id; made++;
  fs.writeFileSync(listFile, `${JSON.stringify(known, null, 2)}\n`);
  await sleep(4000);
}

// the server's line: every account with the fisher it plays
const line = `NPCS=${FISHERS.filter((f) => known[f.name]).map((f) => `${known[f.name]}=${f.name}`).join(',')}`;
if (!look && Object.keys(known).length) {
  fs.writeFileSync(listFile, `${JSON.stringify(known, null, 2)}\n`);
  const vars = fs.existsSync(varsFile) ? fs.readFileSync(varsFile, 'utf8').split('\n').filter((l) => !l.startsWith('NPCS=')) : [];
  while (vars.length && vars[vars.length - 1] === '') vars.pop();
  fs.writeFileSync(varsFile, `${[...vars, line].join('\n')}\n`);
}
console.log(`\n${made} made, ${kept} there already${failed ? `, ${failed} not made` : ''}.`);
if (look) console.log('Nothing was changed (--look).');
else if (Object.keys(known).length) console.log(`server/.dev.vars now has the boats' line (${Object.keys(known).length} accounts). Start the server again:  node serve.mjs`);
