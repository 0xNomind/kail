// Gives the game's server an account of its own, so that the network's fees for landing catches and holding draws
// are never paid by the account that holds the prize vault (the contract's own).
//
//   node scripts/server-account.mjs            do it            (npm run server-account)
//   node scripts/server-account.mjs --look     only say what would be done
//
// One run does all of it, and running it again does only what is still missing:
//   1. makes kail-server.<network>, with a key that stays on this machine
//      (~/.near-credentials/<network>/kail-server.<network>.json), paid by the welcome account;
//   2. gives it a second key, for the server: that one may only call `land` and `settle_draw` on the contract.
//      It has no spending limit of its own: the account holds nothing but fee money, and that is the limit;
//   3. has the contract take the account as its server (`configure`, by the contract's owner, whose key is in
//      the system keychain: the NEAR CLI signs with it);
//   4. writes NEAR_ACCOUNT and NEAR_KEY into server/.dev.vars;
//   5. takes the old server key off the contract's account.
// Afterwards: start the server again (and hand a hosted one its new key). The account pays about 0.0003 NEAR for
// every catch landed, so it needs topping up now and then: on testnet from the faucet, to its name.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner, actions, baseEncode, encodeTransaction } from 'near-api-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEAR = [path.join(os.homedir(), '.cargo/bin/near'), 'near'].find((p) => p === 'near' || fs.existsSync(p));
const look = process.argv.includes('--look');
const varsFile = path.join(root, 'server/.dev.vars');
if (!fs.existsSync(varsFile)) { console.log('No server/.dev.vars here: this machine has no settings for a server.'); process.exit(1); }
const vars = fs.readFileSync(varsFile, 'utf8').split('\n');
const read = (name) => (vars.find((l) => l.startsWith(`${name}=`)) || '').slice(name.length + 1).trim();
const network = read('NEAR_NETWORK') || 'testnet', top = network === 'mainnet' ? 'near' : 'testnet';
const CONTRACT = read('NEAR_CONTRACT'), was = read('NEAR_ACCOUNT'), oldKey = read('NEAR_KEY'), welcome = read('WELCOME');
const ID = `kail-server.${top}`, CALLS = ['land', 'settle_draw'], TGAS = 1_000_000_000_000n, ONE = 10n ** 24n, START_WITH = 2n * ONE;
const NODES = network === 'mainnet' ? ['https://free.rpc.fastnear.com', 'https://near.drpc.org'] : ['https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org', 'https://near-testnet.drpc.org'];
const explorer = network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';
const keyFile = (id) => path.join(os.homedir(), '.near-credentials', network, `${id}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (yocto) => (Number(BigInt(yocto) / 10n ** 21n) / 1000).toString();
if (!CONTRACT) { console.log('server/.dev.vars has no NEAR_CONTRACT.'); process.exit(1); }

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
const view = async (method, args = {}) => {
  const j = await rpc('query', { request_type: 'call_function', finality: 'optimistic', account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  if (!j.result?.result) throw new Error(JSON.stringify(j.error || j.result || 'no answer').slice(0, 160));
  return JSON.parse(Buffer.from(j.result.result).toString());
};
/// What a key may do on an account: 'FullAccess', { FunctionCall }, or null when the account has no such key.
const keyOn = async (id, publicKey) => (await rpc('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: id, public_key: publicKey }))?.result?.permission ?? null;
// the server's key is right when it is on the account and may call exactly the server's two functions on the contract
const isServerKey = (p) => !!p?.FunctionCall && p.FunctionCall.receiver_id === CONTRACT && CALLS.every((c) => p.FunctionCall.method_names.includes(c)) && p.FunctionCall.method_names.length === CALLS.length;
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
const signerOf = (id) => new Account(id, new FailoverRpcProvider(NODES.map((url) => new JsonRpcProvider({ url }))), new KeyPairSigner(KeyPair.fromString(JSON.parse(fs.readFileSync(keyFile(id), 'utf8')).private_key)));
// the NEAR CLI, with the owner's key from the system keychain; its answer without anything that could be a key
function cli(args) {
  const r = spawnSync(NEAR, [...args, 'network-config', network, 'sign-with-keychain', 'send'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000 });
  const said = `${r.stdout || ''}\n${r.stderr || ''}`.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter((l) => l && !/private|secret|seed|phrase/i.test(l)).slice(-4).join(' / ');
  return { ok: r.status === 0, said: said || (r.error ? String(r.error.message) : 'no answer in a minute and a half') };
}
const publicOf = (privateKey) => { try { return KeyPair.fromString(privateKey).getPublicKey().toString(); } catch { return null; } };

// ---- 1. the account
let has = await held(ID);
const fileThere = fs.existsSync(keyFile(ID));
if (has != null && !(fileThere && (await keyOn(ID, JSON.parse(fs.readFileSync(keyFile(ID), 'utf8')).public_key)) === 'FullAccess')) {
  console.log(`${ID} is on the chain, but its key is not on this machine: it cannot be used. Nothing was changed.`); process.exit(1);
}
if (has != null) console.log(`1. ${ID} is there already and holds ${near(has)} NEAR.`);
else {
  const payer = welcome && fs.existsSync(keyFile(welcome)) ? welcome : null, purse = payer ? await held(payer) : null;
  if (!payer || purse == null) { console.log(`1. No account of the game's on this machine can pay for ${ID} (WELCOME in server/.dev.vars names none with a key here). Nothing was changed.`); process.exit(1); }
  // the welcome account keeps at least as much as it gives: it has fees of its own to pay
  const give = purse / 2n > START_WITH ? START_WITH : purse / 2n;
  if (give < ONE / 2n) { console.log(`1. ${payer} holds only ${near(purse)} NEAR: too little to set up ${ID}. Nothing was changed.`); process.exit(1); }
  if (look) console.log(`1. Would make ${ID}, with ${near(give)} NEAR from ${payer} (which holds ${near(purse)}).`);
  else {
    // the key: the one a first try left on this machine, or a new one
    let publicKey;
    if (fileThere) publicKey = JSON.parse(fs.readFileSync(keyFile(ID), 'utf8')).public_key;
    else {
      const pair = KeyPair.fromRandom('ed25519'); publicKey = pair.getPublicKey().toString();
      fs.mkdirSync(path.dirname(keyFile(ID)), { recursive: true });
      fs.writeFileSync(keyFile(ID), JSON.stringify({ account_id: ID, public_key: publicKey, private_key: pair.toString() }), { mode: 0o600 });
    }
    console.log(`1. Making ${ID} with ${near(give)} NEAR from ${payer}…`);
    const r = await send(signerOf(payer), top, [actions.functionCall('create_account', { new_account_id: ID, new_public_key: publicKey }, 30n * TGAS, give)]);
    for (let i = 0; i < 8 && has == null; i++) { has = await held(ID); if (has == null) await sleep(1000); }
    if (r.status.Failure || has == null) { console.log(`   It was not made. The chain said: ${JSON.stringify(r.status).slice(0, 300)}\n   ${explorer}/txns/${r.hash}`); process.exit(1); }
    console.log(`   Made. It holds ${near(has)} NEAR.  ${explorer}/txns/${r.hash}`);
  }
}

// ---- 2. the server's own key on it: only `land` and `settle_draw` on the contract
// (the settings name it already when an earlier run got this far)
let serverKey = was === ID && oldKey && has != null && isServerKey(await keyOn(ID, publicOf(oldKey))) ? oldKey : null;
// a key from a run that stopped between here and the settings is kept beside the account's, so it is not made twice
const spare = keyFile(`${ID}.server`);
if (!serverKey && has != null && fs.existsSync(spare)) { const k = JSON.parse(fs.readFileSync(spare, 'utf8')).private_key; if (isServerKey(await keyOn(ID, publicOf(k)))) serverKey = k; }
if (serverKey) console.log(`2. ${ID} has the server's key already (may call ${CALLS.join(', ')} on ${CONTRACT}).`);
else if (look) console.log(`2. Would give ${ID} a second key that may only call ${CALLS.join(', ')} on ${CONTRACT}.`);
else {
  const pair = KeyPair.fromRandom('ed25519');
  console.log(`2. Giving ${ID} a key that may only call ${CALLS.join(', ')} on ${CONTRACT}…`);
  const r = await send(signerOf(ID), ID, [actions.addFunctionCallAccessKey(pair.getPublicKey(), CONTRACT, CALLS)]);
  let there = null;
  for (let i = 0; i < 8 && !there; i++) { there = await keyOn(ID, pair.getPublicKey().toString()); if (!there) await sleep(1000); }
  if (r.status.Failure || !isServerKey(there)) { console.log(`   It was not added. The chain said: ${JSON.stringify(r.status).slice(0, 300)}\n   Nothing else was changed.`); process.exit(1); }
  fs.writeFileSync(spare, JSON.stringify({ account_id: ID, public_key: pair.getPublicKey().toString(), private_key: pair.toString() }), { mode: 0o600 });
  serverKey = pair.toString();
  console.log('   Added.');
}

// ---- 3. the contract takes it as its server
const minter = await view('minter').catch(() => null);
if (minter === ID) console.log(`3. The contract's server is ${ID} already.`);
else if (look) console.log(`3. Would have ${CONTRACT} take ${ID} as its server (it is ${minter || 'unknown'} now). From then on only ${ID} can land a catch.`);
else {
  console.log(`3. Having ${CONTRACT} take ${ID} as its server (it was ${minter || 'unknown'})…`);
  const r = cli(['contract', 'call-function', 'as-transaction', CONTRACT, 'configure', 'json-args', JSON.stringify({ minter: ID }), 'prepaid-gas', '30 Tgas', 'attached-deposit', '0 NEAR', 'sign-as', CONTRACT]);
  let done = false;
  for (let i = 0; i < 8 && !done; i++) { done = (await view('minter').catch(() => null)) === ID; if (!done) await sleep(1000); }
  if (!done) { console.log(`   The contract did not take it: ${r.said}\n   The server's settings were not changed: ${was || 'the old account'} still signs.`); process.exit(1); }
  console.log('   Done.');
}

// ---- 4. the server's settings
if (was === ID && oldKey === serverKey) console.log('4. server/.dev.vars names the account and its key already.');
else if (look) console.log(`4. Would write NEAR_ACCOUNT=${ID} and its key into server/.dev.vars (now: ${was || 'no account'}).`);
else {
  const set = (lines, name, value) => (lines.some((l) => l.startsWith(`${name}=`)) ? lines.map((l) => (l.startsWith(`${name}=`) ? `${name}=${value}` : l)) : [...lines, `${name}=${value}`]);
  fs.writeFileSync(varsFile, set(set(vars, 'NEAR_ACCOUNT', ID), 'NEAR_KEY', serverKey).join('\n'));
  fs.rmSync(spare, { force: true });
  console.log(`4. server/.dev.vars: the server signs as ${ID} now.`);
}

// ---- 5. the old server key leaves the contract's account
const oldPublic = was && was !== ID && oldKey ? publicOf(oldKey) : null, oldThere = oldPublic ? await keyOn(was, oldPublic) : null;
if (!oldPublic || !oldThere) console.log('5. No old server key is left on the contract\'s account.');
else if (oldThere === 'FullAccess') console.log(`5. The old key on ${was} is a full-access key: left alone. (A server should never have had one.)`);
else if (look) console.log(`5. Would take the old server key ${oldPublic.slice(0, 18)}… off ${was}.`);
else {
  console.log(`5. Taking the old server key ${oldPublic.slice(0, 18)}… off ${was}…`);
  const r = cli(['account', 'delete-keys', was, 'public-keys', oldPublic]);
  let still = oldThere;
  for (let i = 0; i < 8 && still; i++) { still = await keyOn(was, oldPublic); if (still) await sleep(1000); }
  console.log(still ? `   It is STILL there: ${r.said}\n   By hand: near account delete-keys ${was} public-keys ${oldPublic} network-config ${network} sign-with-keychain send` : '   Gone.');
}

if (look) console.log('\nNothing was changed (--look).');
else {
  const now = await held(ID);
  console.log(`\nDone. ${ID} holds ${near(now ?? 0n)} NEAR: about ${Math.floor(Number((now ?? 0n) / (ONE / 1000n)) / 1000 / 0.0003)} catches' worth of fees.`);
  console.log(`Start the server again. Top the account up now and then${network === 'testnet' ? ' (the testnet faucet, to its name)' : ''}; for a hosted server: deploy/push.sh … --keys, or npm run secrets.`);
}
