// Gives the game a "welcome" account of its own (server/relay.mjs): the one that makes a NEAR Auth player's
// account, hands every new account its 5 bait, and carries approvals to NEAR Auth's contract.
//
//   node scripts/welcome-account.mjs            do it
//   node scripts/welcome-account.mjs --look     only say what would be done
//
// One run does all of it, and running it again does only what is still missing:
//   1. makes kail-welcome.testnet, with a key that stays on this machine
//      (~/.near-credentials/testnet/kail-welcome.testnet.json);
//   2. has the contract take it as its greeter (the account that may give the 5 bait);
//   3. writes WELCOME=... into server/.dev.vars, and puts the fisher that stood in as welcome account back among
//      the boats (NPCS).
// The account is not asked of the faucet (which refused it the first time): the network's registrar makes it, paid
// by the game's account that is the welcome account now and has the NEAR for it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner, actions, baseEncode, encodeTransaction } from 'near-api-js';
import { FISHERS } from '../server/npc-rules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEAR = [path.join(os.homedir(), '.cargo/bin/near'), 'near'].find((p) => p === 'near' || fs.existsSync(p));
const NODES = ['https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org', 'https://near-testnet.drpc.org'];
const ID = 'kail-welcome.testnet', TGAS = 1_000_000_000_000n, ONE = 10n ** 24n;
const look = process.argv.includes('--look');
const varsFile = path.join(root, 'server/.dev.vars');
const keyFile = (id) => path.join(os.homedir(), '.near-credentials/testnet', `${id}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (yocto) => (Number(BigInt(yocto) / 10n ** 21n) / 1000).toString();

// ---- asking the chain
async function rpc(method, params) {
  let last = null;
  for (const url of NODES) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.error && /rate|limit|429/i.test(JSON.stringify(j.error))) { last = new Error('that node is busy'); continue; }
      return j;
    } catch (e) { last = e; }
  }
  throw last;
}
/// NEAR in an account, or null when there is no such account.
async function held(id) {
  const j = await rpc('query', { request_type: 'view_account', finality: 'optimistic', account_id: id });
  if (j.result?.amount != null) return BigInt(j.result.amount);
  if (/UNKNOWN_ACCOUNT|does not exist/i.test(JSON.stringify(j.error || j.result || ''))) return null;
  throw new Error(`could not look up ${id}: ${JSON.stringify(j.error || j).slice(0, 160)}`);
}
const view = async (contract, method, args = {}) => {
  const j = await rpc('query', { request_type: 'call_function', finality: 'optimistic', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  if (!j.result?.result) throw new Error(JSON.stringify(j.error || j.result || 'no answer').slice(0, 160));
  return JSON.parse(Buffer.from(j.result.result).toString());
};
const hasKey = async (id, publicKey) => (await rpc('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: id, public_key: publicKey }))?.result?.nonce != null;
// Hand a transaction to the chain and look every second whether it is through.
async function send(account, receiverId, list) {
  const signed = await account.createSignedTransaction({ receiverId, actions: list });
  const hash = baseEncode(createHash('sha256').update(encodeTransaction(signed.transaction)).digest());
  await account.provider.sendTransactionAsync(signed);
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const status = (await rpc('tx', { tx_hash: hash, sender_account_id: account.accountId, wait_until: 'EXECUTED_OPTIMISTIC' }).catch(() => null))?.result?.status;
    if (status && typeof status === 'object' && ('SuccessValue' in status || 'Failure' in status)) return { hash, status };
  }
  throw new Error(`the chain did not finish ${hash} in a minute`);
}
const signerOf = (id, privateKey) => new Account(id, new FailoverRpcProvider(NODES.map((url) => new JsonRpcProvider({ url }))), new KeyPairSigner(KeyPair.fromString(privateKey)));

// ---- what there is now
const vars = fs.existsSync(varsFile) ? fs.readFileSync(varsFile, 'utf8').split('\n') : [];
const read = (name) => (vars.find((l) => l.startsWith(`${name}=`)) || '').slice(name.length + 1).trim();
const CONTRACT = read('NEAR_CONTRACT') || 'kail-game.testnet', before = read('WELCOME'), boats = read('NPCS');
if ((read('NEAR_NETWORK') || 'testnet') !== 'testnet') { console.log('This script is for the test network only.'); process.exit(1); }

// 1. the account
let has = await held(ID);
const keyThere = fs.existsSync(keyFile(ID));
if (has != null && !(keyThere && await hasKey(ID, JSON.parse(fs.readFileSync(keyFile(ID), 'utf8')).public_key))) {
  console.log(`${ID} is on the chain, but its key is not on this machine: it cannot be used. Nothing was changed.`); process.exit(1);
}
if (has != null) console.log(`1. ${ID} is there already and holds ${near(has)} NEAR.`);
else {
  const payer = before && before !== ID && fs.existsSync(keyFile(before)) ? before : null;
  const purse = payer ? await held(payer) : null;
  if (!payer || purse == null) { console.log(`1. No account of the game's on this machine can pay for ${ID} (WELCOME in server/.dev.vars names none with a key here). Nothing was changed.`); process.exit(1); }
  // half of what the payer holds, 5 NEAR at most: it pays the fees of approvals and of making players' accounts
  const give = purse / 2n > 5n * ONE ? 5n * ONE : purse / 2n;
  if (give < ONE / 2n) { console.log(`1. ${payer} holds only ${near(purse)} NEAR: too little to set up ${ID}. Nothing was changed.`); process.exit(1); }
  if (look) console.log(`1. Would make ${ID}, with ${near(give)} NEAR from ${payer} (which holds ${near(purse)}).`);
  else {
    // the key: the one a first try left on this machine, or a new one
    let publicKey;
    if (keyThere) publicKey = JSON.parse(fs.readFileSync(keyFile(ID), 'utf8')).public_key;
    else {
      const pair = KeyPair.fromRandom('ed25519'); publicKey = pair.getPublicKey().toString();
      fs.mkdirSync(path.dirname(keyFile(ID)), { recursive: true });
      fs.writeFileSync(keyFile(ID), JSON.stringify({ account_id: ID, public_key: publicKey, private_key: pair.toString() }), { mode: 0o600 });
    }
    console.log(`1. Making ${ID} with ${near(give)} NEAR from ${payer}…`);
    const r = await send(signerOf(payer, JSON.parse(fs.readFileSync(keyFile(payer), 'utf8')).private_key), 'testnet', [actions.functionCall('create_account', { new_account_id: ID, new_public_key: publicKey }, 30n * TGAS, give)]);
    for (let i = 0; i < 8 && has == null; i++) { has = await held(ID); if (has == null) await sleep(1000); }
    if (r.status.Failure || has == null) { console.log(`   It was not made. The chain said: ${JSON.stringify(r.status).slice(0, 300)}\n   https://testnet.nearblocks.io/txns/${r.hash}`); process.exit(1); }
    console.log(`   Made. It holds ${near(has)} NEAR.  https://testnet.nearblocks.io/txns/${r.hash}`);
  }
}

// 2. the contract's greeter
const greeter = await view(CONTRACT, 'greeter').catch(() => null);
if (greeter === ID) console.log(`2. The contract's greeter is ${ID} already.`);
else if (look) console.log(`2. Would have ${CONTRACT} take ${ID} as its greeter (it is ${greeter || 'nobody'} now).`);
else {
  console.log(`2. Having ${CONTRACT} take ${ID} as its greeter (it was ${greeter || 'nobody'})…`);
  let done = false, why = '';
  // Only the contract's owner may, and the owner's key is in the system keychain: the NEAR CLI signs with it.
  // (The key in server/.dev.vars is the game server's: it may only land catches and hold draws. Trying it here
  // made this script hang for minutes, which is why the first run stopped at this step.)
  const owner = read('NEAR_ACCOUNT') || CONTRACT;
  const r = spawnSync(NEAR, ['contract', 'call-function', 'as-transaction', CONTRACT, 'set_greeter', 'json-args', JSON.stringify({ account_id: ID }), 'prepaid-gas', '30 Tgas', 'attached-deposit', '0 NEAR', 'sign-as', owner, 'network-config', 'testnet', 'sign-with-keychain', 'send'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000 });
  if (r.status !== 0) why = `${r.stdout || ''}\n${r.stderr || ''}`.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter((l) => l && !/private|secret|seed|phrase/i.test(l)).slice(-4).join(' / ') || (r.error ? String(r.error.message) : 'the NEAR CLI gave no answer in a minute and a half');
  for (let i = 0; i < 6 && !done; i++) { done = (await view(CONTRACT, 'greeter').catch(() => null)) === ID; if (!done) await sleep(1000); }
  if (!done) { console.log(`   The contract did not take it: ${why || 'no reason given'}\n   Nothing else was changed: ${before || 'no account'} stays the welcome account.`); process.exit(1); }
  console.log('   Done.');
}

// 3. the server's settings: the new welcome account, and the fisher that stood in goes back to sea
const names = boats.split(',').map((x) => x.trim()).filter(Boolean);
const back = before && before !== ID && !names.some((n) => n.split('=')[0] === before) ? before : null;
// (the fisher nobody plays yet: that is who the stand-in was)
const free = FISHERS.map((f) => f.name).filter((n) => !names.some((x) => x.split('=')[1] === n));
const boatLine = back ? [...names, `${back}=${free.find((n) => back.includes(n.toLowerCase().replace(/ /g, '-'))) || free[0] || 'Dolly'}`].join(',') : boats;
if (before === ID && !back) console.log('3. server/.dev.vars names it already.');
else if (look) console.log(`3. Would write WELCOME=${ID} into server/.dev.vars${back ? `, and put ${back} back among the boats` : ''}.`);
else {
  const out = vars.filter((l) => !l.startsWith('WELCOME=')).map((l) => (l.startsWith('NPCS=') ? `NPCS=${boatLine}` : l));
  while (out.length && out[out.length - 1] === '') out.pop();
  fs.writeFileSync(varsFile, `${[...out, `WELCOME=${ID}`].join('\n')}\n`);
  console.log(`3. server/.dev.vars now names ${ID}${back ? `, and ${back} is a boat again (${boatLine.split(',').length} boats)` : ''}.`);
}
console.log(look ? '\nNothing was changed (--look).' : '\nAll set. The server has to be started again to use it.');
