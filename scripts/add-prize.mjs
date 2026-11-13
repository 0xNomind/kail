// Puts NEAR into the prize vault:
//
//   node scripts/add-prize.mjs 10                              10 NEAR, from the welcome account   (npm run add-prize -- 10)
//   node scripts/add-prize.mjs 10 --from kail-server.testnet   from another account whose key is on this machine
//   node scripts/add-prize.mjs --faucet                        testnet: 10 NEAR straight from the faucet service   (npm run add-prize -- --faucet)
//   node scripts/add-prize.mjs 10 --look                       only say what would be done
//
// --faucet (testnet only) asks the network's faucet service for a new account, which comes with 10 free test NEAR
// (the NEAR CLI does the asking, as for the boats' accounts), puts all of it into the vault, and closes the account
// again. One account for each run. The service turns away too many requests in a row: then this stops and says
// so, and it is to be tried again later.
//
// NEAR sent to the contract's account by an ordinary transfer is NOT in the vault: it sits in that account and no
// prize is ever paid from it. The vault only counts what comes in through the contract's `add_prize` (and through
// players' top-ups). So NEAR for the vault goes first to an account of your own (on testnet: from the faucet), and
// from there with this command. The paying account's key is read from ~/.near-credentials/<network>/, and at
// least 1 NEAR is left in it. A bigger vault means a bigger prize every day, and a dearer coin from the next day on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from 'near-api-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), look = args.includes('--look');
const amount = Number(args.find((a) => /^\d+(\.\d+)?$/.test(a)));
const vars = fs.existsSync(path.join(root, 'server/.dev.vars')) ? fs.readFileSync(path.join(root, 'server/.dev.vars'), 'utf8').split('\n') : [];
const read = (name) => (vars.find((l) => l.startsWith(`${name}=`)) || '').slice(name.length + 1).trim();
const network = read('NEAR_NETWORK') || 'testnet', CONTRACT = read('NEAR_CONTRACT');
const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : read('WELCOME');
const faucet = args.includes('--faucet');
if (faucet) { await fromTheFaucet(); process.exit(0); }
if (!(amount > 0) || !CONTRACT || !from) { console.log('usage: node scripts/add-prize.mjs <NEAR> [--from <account>] [--look]   (server/.dev.vars names the contract and the welcome account)'); process.exit(1); }
const keyFile = path.join(os.homedir(), '.near-credentials', network, `${from}.json`);
if (!fs.existsSync(keyFile)) { console.log(`The key of ${from} is not on this machine (${path.join('~/.near-credentials', network, `${from}.json`)}).`); process.exit(1); }
const NODES = network === 'mainnet' ? ['https://free.rpc.fastnear.com', 'https://near.drpc.org'] : ['https://rpc.testnet.near.org', 'https://rpc.testnet.fastnear.com', 'https://near-testnet.drpc.org'];
const provider = new FailoverRpcProvider(NODES.map((url) => new JsonRpcProvider({ url })));
const ONE = 10n ** 24n, yocto = BigInt(Math.round(amount * 1e6)) * 10n ** 18n, near = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toString();
const view = (method) => provider.callFunction({ contractId: CONTRACT, method, args: {} });

const holds = BigInt((await provider.viewAccount({ accountId: from })).amount), vault = BigInt(await view('vault'));
console.log(`${from} holds ${near(holds)} NEAR. The vault of ${CONTRACT} holds ${near(vault)} NEAR.`);
if (holds < yocto + ONE) { console.log(`Not enough: ${amount} NEAR for the vault and 1 NEAR left in ${from} needs ${near(yocto + ONE)} NEAR there.${network === 'testnet' ? ` Ask the faucet for NEAR to ${from} first.` : ''}`); process.exit(1); }
if (look) { console.log(`Would put ${amount} NEAR from ${from} into the vault: it would hold ${near(vault + yocto)} NEAR. Nothing was changed (--look).`); process.exit(0); }

const account = new Account(from, provider, new KeyPairSigner(KeyPair.fromString(JSON.parse(fs.readFileSync(keyFile, 'utf8')).private_key)));
const r = await account.signAndSendTransaction({ receiverId: CONTRACT, actions: [actions.functionCall('add_prize', {}, 30_000_000_000_000n, yocto)] });
if (r?.status?.Failure) { console.log(`The contract refused: ${JSON.stringify(r.status.Failure).slice(0, 300)}`); process.exit(1); }
let now = vault;
for (let i = 0; i < 8 && now === vault; i++) { await new Promise((ok) => setTimeout(ok, 1000)); now = BigInt(await view('vault')); }
console.log(`Done: ${amount} NEAR is in the vault, which holds ${near(now)} NEAR now. Transaction ${r?.transaction?.hash || r?.transaction_outcome?.id || ''}`);
console.log('The prize of a day is a fifth of the vault as it stands when that day begins; the price of a coin follows from the next day on.');

// ---- testnet: a new account from the faucet service, its NEAR into the vault, the account closed again
async function fromTheFaucet() {
  if (network !== 'testnet') { console.log('There is a faucet on testnet only.'); process.exit(1); }
  if (!CONTRACT) { console.log('server/.dev.vars has no NEAR_CONTRACT.'); process.exit(1); }
  const cli = [path.join(os.homedir(), '.cargo/bin/near'), 'near'].find((p) => p === 'near' || fs.existsSync(p));
  const nodes = ['https://rpc.testnet.near.org', 'https://rpc.testnet.fastnear.com', 'https://near-testnet.drpc.org'];
  const rpc = new FailoverRpcProvider(nodes.map((url) => new JsonRpcProvider({ url })));
  const say = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toString(), wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const vaultNow = async () => BigInt(await rpc.callFunction({ contractId: CONTRACT, method: 'vault', args: {} }));
  const id = `kail-vault-${Date.now().toString(36)}.testnet`, file = path.join(os.homedir(), '.near-credentials/testnet', `${id}.json`);
  const before = await vaultNow();
  console.log(`The vault of ${CONTRACT} holds ${say(before)} NEAR.`);
  if (look) { console.log(`Would ask the faucet service for a new account (${id}) with 10 test NEAR, put that into the vault, and close the account. Nothing was changed (--look).`); return; }
  console.log(`Asking the faucet service for ${id}…`);
  const r = spawnSync(cli, ['account', 'create-account', 'sponsor-by-faucet-service', id, 'autogenerate-new-keypair', '--signature-scheme', 'ed25519', 'save-to-legacy-keychain', 'network-config', 'testnet', 'create'], { encoding: 'utf8', timeout: 120_000 });
  let has = null;
  for (let i = 0; i < 10 && has == null; i++) { has = fs.existsSync(file) ? await rpc.viewAccount({ accountId: id }).then((a) => BigInt(a.amount), () => null) : null; if (has == null) await wait(2000); }
  if (has == null) {
    const said = `${r.stdout || ''}\n${r.stderr || ''}`.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter((l) => l && !/private|secret|seed|phrase/i.test(l)).slice(-4).join(' / ');
    console.log(`The faucet service did not make it (it turns away too many requests in a row). It said: ${said || '(nothing)'}\nNothing was changed. Try again later.`);
    process.exit(1);
  }
  // all but a little for the two fees; what is left goes to the welcome account when the account is closed
  const give = has - 10n ** 24n / 20n;      // 0.05 NEAR stays behind
  const account = new Account(id, rpc, new KeyPairSigner(KeyPair.fromString(JSON.parse(fs.readFileSync(file, 'utf8')).private_key)));
  console.log(`It came with ${say(has)} NEAR. Putting ${say(give)} NEAR into the vault…`);
  const put = await account.signAndSendTransaction({ receiverId: CONTRACT, actions: [actions.functionCall('add_prize', {}, 30_000_000_000_000n, give)] }).catch((e) => ({ status: { Failure: String(e?.message || e) } }));
  if (put?.status?.Failure) { console.log(`The contract refused: ${JSON.stringify(put.status.Failure).slice(0, 300)}\n${id} keeps its NEAR; its key is on this machine. Later: node scripts/add-prize.mjs ${Math.floor(Number(say(give)))} --from ${id}`); process.exit(1); }
  let after = before;
  for (let i = 0; i < 8 && after === before; i++) { await wait(1000); after = await vaultNow(); }
  // the account has done its work: close it, the last bit to the welcome account (or to the contract's)
  const heir = read('WELCOME') || CONTRACT;
  const closed = await account.signAndSendTransaction({ receiverId: id, actions: [actions.deleteAccount(heir)] }).then((x) => !x?.status?.Failure, () => false);
  // (the NEAR CLI keeps the key twice: a file, and a folder of the account's name)
  if (closed) { fs.rmSync(file, { force: true }); fs.rmSync(file.replace(/\.json$/, ''), { recursive: true, force: true }); }
  console.log(`Done: the vault holds ${say(after)} NEAR now (it held ${say(before)}). ${closed ? `${id} is closed again.` : `${id} could not be closed; its key stays on this machine.`}`);
  console.log('The prize of a day is a fifth of the vault as it stands when that day begins; the price of a coin follows from the next day on.');
}
