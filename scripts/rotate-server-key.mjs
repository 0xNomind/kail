// Gives the game's server a new key and takes the old one off the account. For when the old key may have been
// seen by somebody (it is in server/.dev.vars, which must never be served or committed).
//
//   node scripts/rotate-server-key.mjs            do it
//   node scripts/rotate-server-key.mjs --look     only say what would be done
//
// The server's key is not the account's own key: it may only call `land` and `settle_draw` on the game's contract.
// The new one is made on this machine and gets the same limits; the account's own key adds it and deletes the old
// one: from its file in ~/.near-credentials when the server has an account of its own (npm run server-account),
// or else from the system keychain, through the NEAR CLI. The new key is written into server/.dev.vars and never
// shown. Afterwards: start the server again, and for a hosted server hand the new key over (deploy/push.sh --keys,
// or npm run secrets).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from 'near-api-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), file = path.join(root, 'server/.dev.vars');
const NEAR = [path.join(os.homedir(), '.cargo/bin/near'), 'near'].find((p) => p === 'near' || fs.existsSync(p));
const look = process.argv.includes('--look');
const CALLS = ['land', 'settle_draw'];
const lines = fs.readFileSync(file, 'utf8').split('\n');
const read = (name) => (lines.find((l) => l.startsWith(`${name}=`)) || '').slice(name.length + 1).trim();
const network = read('NEAR_NETWORK') || 'testnet', account = read('NEAR_ACCOUNT'), contract = read('NEAR_CONTRACT'), oldKey = read('NEAR_KEY');
if (!account || !contract || !oldKey) { console.log('server/.dev.vars needs NEAR_ACCOUNT, NEAR_CONTRACT and NEAR_KEY.'); process.exit(1); }
const NODES = network === 'mainnet' ? ['https://free.rpc.fastnear.com', 'https://near.drpc.org'] : ['https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org', 'https://near-testnet.drpc.org'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function keyOnChain(publicKey) {
  for (const url of NODES) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_access_key', finality: 'optimistic', account_id: account, public_key: publicKey } }) });
      const j = await r.json();
      if (j.result?.nonce != null) return j.result.permission;
      if (/does not exist|UNKNOWN_ACCESS_KEY/i.test(JSON.stringify(j.error || j.result || ''))) return null;
    } catch { /* the next node */ }
  }
  throw new Error('No NEAR node answered');
}
// the NEAR CLI, with the owner's key from the system keychain; its answer without anything that could be a key
function cli(args) {
  const r = spawnSync(NEAR, [...args, 'network-config', network, 'sign-with-keychain', 'send'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000 });
  const said = `${r.stdout || ''}\n${r.stderr || ''}`.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter((l) => l && !/private|secret|seed|phrase/i.test(l)).slice(-4).join(' / ');
  return { ok: r.status === 0, said: said || (r.error ? String(r.error.message) : 'no answer in a minute and a half') };
}

// An account of the server's own holds nothing but fee money: its key needs no spending limit. A key on the
// contract's account (the old arrangement) gets one, since that account also holds the prize vault.
const ownFile = path.join(os.homedir(), '.near-credentials', network, `${account}.json`), own = account !== contract && fs.existsSync(ownFile);
const ALLOWANCE = account === contract ? '2 NEAR' : null;
const self = own ? new Account(account, new FailoverRpcProvider(NODES.map((url) => new JsonRpcProvider({ url }))), new KeyPairSigner(KeyPair.fromString(JSON.parse(fs.readFileSync(ownFile, 'utf8')).private_key))) : null;
// one change to the account's keys, signed with its own key file, or through the NEAR CLI
async function change(action, args) {
  if (!self) return cli(args);
  try { const r = await self.signAndSendTransaction({ receiverId: account, actions: [action] }); return { ok: !r?.status?.Failure, said: r?.status?.Failure ? JSON.stringify(r.status.Failure).slice(0, 200) : 'done' }; }
  catch (e) { return { ok: false, said: String(e?.message || e).slice(0, 200) }; }
}
const oldPublic = KeyPair.fromString(oldKey).getPublicKey().toString();
const had = await keyOnChain(oldPublic);
console.log(`The server's key now: ${oldPublic.slice(0, 18)}… ${had ? (had === 'FullAccess' ? '(FULL ACCESS: it should not be)' : `(may call ${had.FunctionCall.method_names.join(', ')})`) : '(not on the account any more)'}`);
if (look) { console.log(`Would add a new key limited to ${CALLS.join(', ')} on ${contract}, write it into server/.dev.vars, and delete the old one. Nothing was changed (--look).`); process.exit(0); }

// 1. the new key, with the same limits
const pair = KeyPair.fromRandom('ed25519'), newPublic = pair.getPublicKey().toString();
console.log(`1. Adding the new key ${newPublic.slice(0, 18)}… (may call ${CALLS.join(', ')} on ${contract})…`);
const added = await change(actions.addFunctionCallAccessKey(pair.getPublicKey(), contract, CALLS),
  ['account', 'add-key', account, 'grant-function-call-access', '--allowance', ALLOWANCE || 'unlimited', '--contract-account-id', contract, '--function-names', CALLS.join(', '), 'use-manually-provided-public-key', newPublic]);
let there = null;
for (let i = 0; i < 10 && !there; i++) { there = await keyOnChain(newPublic).catch(() => null); if (!there) await sleep(1000); }
if (!there) { console.log(`   It was not added: ${added.said}\n   Nothing was changed.`); process.exit(1); }

// 2. the server's settings
fs.writeFileSync(file, lines.map((l) => (l.startsWith('NEAR_KEY=') ? `NEAR_KEY=${pair.toString()}` : l)).join('\n'));
console.log('2. server/.dev.vars has the new key.');

// 2b. the contract takes the new key as the one the server signs its approvals of catches with (its owner's
// key is in the system keychain). Until it does, players cannot land their catches.
{
  const approvesWith = Buffer.from(pair.getPublicKey().data).toString('base64');
  console.log(`   Telling ${contract} which key the server signs its approvals with…`);
  const told = cli(['contract', 'call-function', 'as-transaction', contract, 'set_server_key', 'json-args', JSON.stringify({ key: approvesWith }), 'prepaid-gas', '30 Tgas', 'attached-deposit', '0 NEAR', 'sign-as', contract]);
  if (!told.ok) console.log(`   THE CONTRACT DID NOT TAKE IT: ${told.said}\n   By hand: near contract call-function as-transaction ${contract} set_server_key json-args '{"key":"${approvesWith}"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as ${contract} network-config ${network} sign-with-keychain send`);
}

// 3. the old key goes
if (!had) console.log('3. The old key was not on the account: nothing to delete.');
else {
  console.log('3. Deleting the old key…');
  const gone = await change(actions.deleteKey(KeyPair.fromString(oldKey).getPublicKey()), ['account', 'delete-keys', account, 'public-keys', oldPublic]);
  let still = had;
  for (let i = 0; i < 10 && still; i++) { still = await keyOnChain(oldPublic).catch(() => had); if (still) await sleep(1000); }
  if (still) { console.log(`   It is STILL on the account: ${gone.said}\n   Delete it by hand: near account delete-keys ${account} public-keys ${oldPublic} network-config ${network} sign-with-keychain send`); process.exit(1); }
  console.log('   Gone.');
}
console.log('\nDone. Start the server again; for a hosted server: deploy/push.sh … --keys, or npm run secrets.');
