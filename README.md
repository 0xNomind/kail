# Kail

A fishing game in the browser whose economy runs on a NEAR contract. Built at NEAR Hackathon, for the tracks
`games` and `open`. It is on NEAR **testnet**.

Play it: **https://kail.nomind.dev**

- You throw a hook, pull up fish and chests, fill the day's quest for tickets, and put tickets into a daily draw
  that pays NEAR out of a prize vault. Fish, chest finds and tickets are traded between players.
- Everything a player owns (coins, bait, fish, chest finds, tickets) is a token of one contract, in the shape of
  NEP-245. The quest, both markets, the vault and the draw are in the contract too.
- Ten boats are played by the computer. Each is an ordinary NEAR account with its own NEAR, coins and fish, and
  plays by the same contract calls as a person.

## Check it in a few minutes (no wallet, no keys, no sign-in)

For a reviewer, human or program. Node 20 or newer.

```bash
npm install       # no build step follows
npm run verify    # reads NEAR testnet and checks this README's claims, one line each
npm run simulate  # a week of the game's economy in about a second: no network, no keys
npm test          # the sea, the replay check, the boats' rules, the model of the contract (a few seconds)
npm start         # the pages, at http://localhost:3000; /play is a practice sea when nobody is signed in
```

`npm run verify` changes nothing and needs no account. It prints each claim with what it found on the chain
(the contract and its NEP-245 methods, the tokens' names, the draw's limits, the coin price worked out from the prize, earlier draws
with the transaction that held each, the ten boats with their balances and casts, their orders on the markets)
and ends with a line like `14 held, 0 did not, 5 skipped` (the first number grows when checks are added;
`0 did not` is the result, and the exit code is 0). The five skipped ones are about a running game server:
`npm run verify -- --server https://kail.nomind.dev` checks those too, against the hosted game (19 held, none
skipped). Against a local `npm start` that has no server key, four stay skipped. `--json` gives the same as
JSON; with `npm run`, add `--silent` so that npm's own two lines stay out of it
(`npm run verify --silent -- --json`, `npm run simulate --silent -- --json`).

`npm start` stays in the foreground and prints `Kail is at http://localhost:3000` when it is ready.
`PORT=3111 npm start` uses another port.

`npm run simulate` plays seven days of the game at once: players the computer plays, with the rules they play
by on the chain, fishing in the real sea in its real steps, against a model of the contract's rules written in
JavaScript (`src/model.js`). The model also charges the network's fee for every call, at the gas each call
burned on testnet. It prints each day's prize, coin price, tickets earned and drawn, winners, fees, what fish
traded for, where every player ended, where all the NEAR is, and a few of the players' decisions with their
reasons. The settings: `--vault 4` (NEAR in the prize vault before the first day), `--players 10` (players on
day 1), `--join 0` (more players on every later day), `--wallet 10` (NEAR each comes with), `--seed 1` (the luck
number: which chance the week gets), `--days 7`, `--json`. The same settings always play the same week (it
prints a fingerprint), and after every day it adds up its books: if NEAR, coins, tickets or fish appeared or
vanished without a rule for it, it says where and exits with 1. It is a model, not the chain: the players are
ten computer characters repeated, and chance comes from the luck number. `npm run verify` checks that the model
gives the contract's quest and the contract's coin price for today, and `test/model.test.mjs` holds it against
the contract's rules. The same week can be watched in the browser at `/week`, with the same settings.

Where each claim lives, and how to check it:

| Claim | Code | Check |
| --- | --- | --- |
| A catch is played again by the server before it counts | `src/replay.js`, `land` in `server/game.mjs` | `npm test` (thousands of recorded catches replay to the same result; tampered ones do not); `verify --server`: a made-up catch is refused |
| Everything owned is an NEP-245 token of one contract | `contract/src/mt.rs` | `npm run verify`; `npm run test:contract` |
| The prize, the 500 / 10 limits, one ticket in five, the coin price | `contract/src/draw.rs`, `price_for` in `contract/src/lib.rs` | `npm run verify`; `npm run test:contract` (70 tests) |
| The economy keeps going by itself, and its books close | `src/week.js`, `src/model.js` | `npm run simulate`; `npm test` |
| The computer's boats are accounts that play by readable rules | `src/npc-rules.js`, `server/npc.mjs` | `npm run verify` lists them; `test/npc.test.mjs` |
| Playing opens no wallet after one approval | `GAME_CALLS` and `enableGameKey` in `src/account.js` | a player's account has a function-call key limited to those methods (any explorer) |
| Sign-in with Google, Apple or email | `src/nearauth.js`, `server/relay.mjs` | cannot be tried by a reviewer; "Signing in" says why and links what it did on the chain |

The game itself can be seen and played without signing in: `http://localhost:3000/play` is then a practice sea
(the same sea, hook and pull, played in the browser only; nothing is saved or sent). What cannot be checked
without a signed-in player is what touches the chain: a real cast, a top-up, entering a draw. Those are the steps
under "Try it". A local `npm start` without the server's key shows the pages with live
contract data, but cannot land a catch; `KAIL_SERVER=<the hosted address> npm start` uses the hosted server
instead. `npm run test:contract` needs Rust (rustup fetches the pinned toolchain, 1.95.0 with the wasm target)
and compiles for several minutes the first time.

## The loop

- **Every half minute, a throw.** The hook swings under the boat. The player picks the moment to cast, steers
  the sinking hook past the fish they do not want onto the one they do, then holds and lets go to keep it in the
  box while it comes up. What is on the hook, and whether it stays on, is not known until it is up: a fish, a
  chest with one of three finds, junk, or nothing. A throw costs one bait.
- **Every five minutes, a choice.** The day's quest asks for some of an upper fish, some of a deep fish and one
  chest find. Fish for what is missing, or buy it on the market from another player or a boat? Sell the spare
  catch, and at what price? Buy more bait, a faster reel, a bigger storage?
- **Every session, a ticket.** A finished quest pays a ticket. Put it into the day's draw (one ticket in five
  wins a hundredth of the day's prize, in NEAR) or sell it to another player for NEAR. The next day there is a
  new quest, the last draw's winners are listed, and what was won can be collected.

## The problem it deals with

A game that pays out real tokens has three weak spots, and this project is an attempt at each:

1. **"The server says you caught it."** If the game's server just reports catches, whoever controls a client can
   report anything. Here the sea is decided by the server, the player's moves are recorded, and to land a catch
   the moves are handed in: the server plays them again in the same sea and sees for itself what came up
   (`src/replay.js`, `server/game.mjs`). Only then does it sign its approval of that one catch; the player's
   own transaction carries the catch and the approval to the contract, which checks the signature before the
   fish goes into storage.
2. **A prize that depends on new money.** A day's prize is a fixed share (20%) of the vault as it stood when the
   day began, at most 500 tickets enter a day (10 per account), one ticket in five wins, and a winning ticket gets
   a hundredth of the prize. A day with few tickets pays out less and the rest stays in the vault. The price of a
   coin is worked out from the day's prize: in a full draw, the bait a quick player spends to make a ticket
   (44 coins, measured with the game's robots; an average player spends about 48, a slow one 68) costs what a
   ticket wins on average. So the vault does not drain to good players, and it grows from everybody else.
3. **A chain the player has to think about.** After one approval the game signs its own small actions (casting,
   buying bait, trading fish) with a key that can do nothing else, so playing opens no wallet. Signing in with
   Google, Apple or email (NEAR Auth), with no wallet at all, is built and has been used on the chain, but is not
   open on the hosted address yet (see "Signing in").

## Try it

Hosted: **https://kail.nomind.dev** (NEAR testnet). Sign in there with a NEAR wallet; `/play` is a practice sea
without signing in. `npm run verify -- --server https://kail.nomind.dev` checks the hosted server too.

On your own machine (Node 20 or newer):

```bash
npm install
npm start
```

Then open `http://localhost:3000`. To use the hosted game's server from your machine (no keys needed), start it
with `KAIL_SERVER=https://kail.nomind.dev npm start`. Signing in with Google or email cannot be tried from a
fresh copy or on the hosted address: see "Signing in".

Steps a judge can follow:

| Do | See |
| --- | --- |
| Open the front page | Today's quest, the prize and the tickets in today's draw, read live from the contract `kail-game.testnet` |
| Press **Play now** without signing in | The practice sea: press **CAST**, steer the hook onto a fish, hold to pull it up. Bait is free there and nothing is saved |
| Press **Sign in**, choose **NEAR wallet** (Meteor on testnet; **NEAR Auth** is shown there as not available at this address yet) | You land in the game. A new account gets 5 bait once. With too little NEAR the game says so first, with your account's name and the testnet faucet |
| Press **Approve once** | One approval adds the game's key. From here casting and trading open no window |
| Press **CAST**, steer the hook onto a fish, hold to pull it up while keeping it in the box | The fish is in Storage after a few seconds. It is a token: look your account up on `https://testnet.nearblocks.io` |
| Open **Board → Market** | Orders by players and by the computer's boats, cheapest first. Open one: it says who it is from. Where the boats run (a local `npm start` with the boats' keys) it also says why the boat asks that price |
| Open **Board → Quest**, hand in the three things asked for | A ticket |
| Open **Harbour** | Top up coins with NEAR, put tickets into today's draw, see earlier draws with the transaction that held each, collect NEAR you won |
| Open **Tickets** | The ticket market, for NEAR: buy one sale, or several of the cheapest at once in one transaction |
| Open `/week`, set the vault and the players, press **Play the week** | Seven days of the economy in about a minute: the players' decisions with their reasons, each day's prize, coin price, tickets, winners and fees, and a table of where all the NEAR is |

On testnet a "day" is one hour, so a quest and a draw come round every hour. The pages say so.

## What is on NEAR

- Contract: [`kail-game.testnet`](https://testnet.nearblocks.io/address/kail-game.testnet), source in
  [`contract/`](contract/README.md) (Rust, near-sdk). 70 unit tests (`npm run test:contract`) and a test on a
  local chain (`cd contract && cargo test --test sandbox`; it downloads a local NEAR node the first time).
- Who pays the network: whoever acts. A player pays for their own cast and for their own catch (about 0.0003
  NEAR each), sent by the game's key without a wallet window. The game's server only signs its approval of a
  catch, which costs nothing. It holds the daily draws from an account of its own, `kail-server.testnet`, and
  the vault pays that account back what each draw cost (about 0.0005 NEAR, by the gas used). So the server's
  account does not have to be fed by hand while the game runs, and the contract's account (with the vault) has
  no key of the server's on it. The boats pay their own fees like players, out of the NEAR each was given (about
  10; a week of steady fishing costs one about 0.13 NEAR in the model), so they last many months and then need
  NEAR again.
- Tokens: one contract holds every kind, in the shape of NEP-245. It has the standard's `mt_transfer`,
  `mt_batch_transfer`, `mt_token`, `mt_balance_of`, `mt_batch_balance_of`, `mt_supply` and `mt_batch_supply`;
  the metadata extension (`mt_metadata_contract`, `mt_metadata_token_all`, `mt_metadata_token_by_token_id`,
  `mt_metadata_base_by_token_id`, `mt_metadata_base_by_metadata_id`: a name and a description for each of the 16
  kinds, no pictures); the enumeration extension (`mt_tokens`, `mt_tokens_for_owner`,
  `mt_tokens_base_metadata_all`); and a `nep245` event for every mint, burn and transfer. It does not have
  `mt_transfer_call` and `mt_batch_transfer_call` or the approval methods: a token cannot be handed to another
  contract. Only tickets can be sent to another account; coins, bait and fish change hands through the market.
  What is up for sale is held by the contract, and shows as the balance of the contract's own account.
- The draw uses the chain's randomness. Once a day is over it is held by a call from the game's server (every
  minute it looks for days to hold; only the server's account or the owner may make that call). Every draw is
  kept with its winners and the transaction that held it.
- What NEAR makes possible here: function-call access keys (the game key that can only call the game's small
  actions and can never move NEAR), named accounts made for players by the network's registrar, NEAR Auth's
  MPC-held keys for sign-in without a wallet, fees small enough that every cast can be a transaction
  (about 0.0003 NEAR), and one transaction carrying several calls (buying from several sellers at once, or a
  fee together with a top-up).

## What runs by itself, and what needs the makers

- **By itself, in the contract:** the day's quest (worked out from the day's number), the day's prize (a fifth of
  the vault), the price of a coin (from the prize), both markets, the limits of the draw, entering it, and
  collecting what was won. No call of the makers sets a quest or a price.
- **Needs the game's server:** a catch counts only with the server's signature, so while the server is down
  nobody lands a fish. The markets, top-ups, entering the draw and collecting still work then, straight on the
  contract. A finished day's draw is held by the server's account (or the owner); while it is down the day
  waits, and is held, oldest first, when it is back. The welcome bait and the boats also come from the server's
  machine.
- **What the owner can change** (the owner is the contract's own account): the length of a day, the prize's
  share of the vault, how many tickets the quest hands out a day, the coins a ticket is priced at, and which
  account and key the server signs with (`configure`, `set_server_key`, `set_greeter`). No method lets the owner
  take tokens or NEAR from a player or from the vault. The account's full-access key is another matter: see
  "Limits".
- **What the boats' prices follow:** the quest of the day decides what a boat needs and what it has spare. Its
  price for a fish is the throws that fish takes, times what bait costs, times the boat's own factor, and comes
  down while the order stays unsold (to 60% at the lowest). So prices follow the price of a coin, which follows
  the vault; they do not follow how much of a fish is on the market.

## The computer's boats

`src/npc-rules.js` holds ten fishers and the one function that decides a boat's next step from the
contract's state: fish for the quest, hand it in, list a spare fish at a price worked out from what bait costs,
buy what is cheaper than fishing it, take a ticket offer, enter the draw, upgrade, rest. Each step comes with its
reason in words; the reason behind an order shows in the game when the order is opened.

`server/npc.mjs` runs them: each boat signs with its own key, throws the hook at the pace of the clock and has
its catch checked by the game's server like a player's. Their accounts:

`kail-old-tom.testnet` `kail-maggie.testnet` `kail-finn.testnet` `kail-captain-hale.testnet` `kail-nora.testnet`
`kail-ruby.testnet` `kail-silas.testnet` `kail-wren.testnet` `kail-jack.testnet` `kail-dolly.testnet`

They are not driven by a language model: the rules are plain code that can be read and tested
(`test/npc.test.mjs`: 51 situations and 20,000 made-up states).

## Signing in

- **NEAR wallet** (NEAR Connect, `@hot-labs/near-connect`): connecting costs nothing; the game key is asked for in
  the game.
- **NEAR Auth** (`@fast-auth-near`): the player's key is held by NEAR's MPC network. The game's helper account
  (`kail-welcome.testnet`, `server/relay.mjs`) makes the player a named account and carries each approval to
  NEAR Auth's contract. An approval on the game's contract carries 0.005 NEAR that pays the helper back
  (`relay_fee`); the server refuses to carry one that does not.
- **Where NEAR Auth works, and why not on the hosted address.** On testnet every app uses one sign-in client
  that NEAR Auth shares (docs.auth.near.org/resources/testnet). A sign-in client has a list, kept by NEAR Auth,
  of the addresses it may send a signed-in person back to. For the shared one that list is
  `http://localhost:3000` (where NEAR Auth's own example app runs) and NEAR Auth's own demo,
  `https://example.fast-auth.com`. Every other address is refused with "Callback URL mismatch", this game's
  hosted one too; `npm run verify` asks NEAR Auth's sign-in server and prints its answers. So NEAR Auth signs
  players in where the game runs at exactly `http://localhost:3000` on a machine that has the helper account's
  key, and nowhere else until NEAR Auth adds the hosted address to its list. A reviewer's fresh copy has no
  such key, and the hosted game shows the button as not available. What it did on the chain can be read: the
  helper carried a player's approvals to NEAR Auth's contract `fast-auth.testnet`
  ([B3Ryij…](https://testnet.nearblocks.io/txns/B3RyijTgpmZSH8H3vDsToNpNWkravahdjNoj5X3C7EAJ),
  [7dVuZE…](https://testnet.nearblocks.io/txns/7dVuZEQQmnFRw4sDZHcpbTrs2aK1kHPVeKLvW41kCbBX)).

## How it is put together

| Where | What |
| --- | --- |
| `index.html`, `play.html`, `harbour.html`, `tickets.html`, `src/` | The pages. Plain HTML, CSS and JavaScript modules, served as written |
| `src/sim.js`, `src/replay.js`, `src/dmath.js` | The sea: fixed steps, own arithmetic, so that it plays out the same in every browser and on the server |
| `src/network.js` | Everything that differs between testnet and mainnet |
| `src/npc-rules.js`, `src/bot.js` | The boats' rules, and the robot that works the reel for them |
| `src/model.js`, `src/week.js`, `week.html` | The contract's rules as a fast model, and a week played through it (`npm run simulate`, `/week`) |
| `contract/` | The contract |
| `server/game.mjs` | The game's server: hands out a sea, plays a catch again, signs its approval of it, holds the draws |
| `server/relay.mjs` | The helper for new players and NEAR Auth |
| `server/npc.mjs` | Runs the boats on the chain: each signs with its own key |
| `serve.mjs` | Runs all of it on one machine with Node |
| `server/boats.mjs` | Runs only the boats, against a hosted server (`npm run boats`) |
| `server/worker.mjs`, `server/wrangler.toml` | The same server as a Cloudflare Worker |
| `deploy/` | Hosting on one machine: `setup.sh` (once, on the machine), `kail.service`, `push.sh` (code and keys over SSH) |
| `public/vendor/` | The wallet and NEAR Auth libraries, packed into browser files (`npm run vendor`, `npm run vendor:auth`) |
| `art/` | The pixel art and the site's icons, drawn by code (`npm run art`) |
| `public/music/` | The one piece of music, generated with a music model (see the note in that folder). There are no other sounds |
| `test/` | Tests of the sea, the replay, the boats' rules and the model of the contract. `test/model/` is the economy as it was modelled before the contract existed; the game does not use it |

## Tests

```bash
npm test                 # the sea, the replay check, the boats' rules, the model of the contract
npm run test:contract    # the contract's 70 unit tests (needs Rust)
npm run build:contract   # builds the contract (needs cargo-near) and prints the wasm's hash
(cd contract && cargo test --test sandbox)   # the contract on a local NEAR chain (downloads a node once)
```

## Running the server yourself

The server's settings are listed in [`server/dev.vars.example`](server/dev.vars.example): copy it to
`server/.dev.vars`. The server's own account (`npm run server-account`: makes it, gives it a key that may only
call `land` and `settle_draw`, and names it and that key to the contract), the helper account (`npm run welcome`) and the
boats' accounts (`npm run npcs`) are made by those scripts. `npm start` then runs the pages, the server, the
helper and the boats. The server's account pays for holding the draws, about 0.0005 NEAR each, and the vault
pays it back with every draw (should the account still fall under half a NEAR, the server says so in its log and
`npm run verify -- --server` fails).
`node scripts/rotate-server-key.mjs` replaces the server's key.

The prize vault fills from players' top-ups. To add to it yourself: `npm run add-prize -- 10` puts 10 NEAR into
it from the welcome account (`--from <account>` for another one whose key is on this machine). On testnet,
`npm run add-prize -- --faucet` asks the faucet service for a new account with 10 test NEAR, puts that into the
vault and closes the account again (one for each run; the service turns away many requests in a row). NEAR sent to the
contract's account by an ordinary transfer is not in the vault; only `add_prize` and top-ups count.

## Hosting

### On one machine that stays on (the simple way)

The game is one process, `node serve.mjs`: the pages, the game's server and the computer's boats together, the
same as on a developer's machine. A small VPS runs it (with the ten boats going it uses a little over 100 MB of memory). `deploy/` has what that
takes, for Debian or Ubuntu:

```bash
# on your own machine, in this folder; the login must be root or have sudo without a password
deploy/push.sh user@machine --setup kail.example.com   # once: Node, Caddy (HTTPS), a user, the service
deploy/push.sh user@machine --keys                     # the code and the keys, then a start
deploy/push.sh user@machine                            # later: new code only, then a start
```

- The address given to `--setup` must already point at the machine; Caddy gets its HTTPS certificate by itself.
  Without a name of your own, `<the machine's IP with dashes>.sslip.io` works.
- Behind Cloudflare's proxy (the DNS record "Proxied", the zone's SSL/TLS mode "Full"), add `--cloudflare` to
  the `--setup` line: the machine's IP stays out of the DNS, Caddy makes its own certificate, answers
  Cloudflare's addresses only, and counts each visitor by the address Cloudflare reports. Port 443 must be open.
- The system's own Node (`/usr/bin/node`) runs the game; a Node in somebody's home folder is left alone.
- `deploy/setup.sh` stops without changing anything if another program already answers on ports 80 or 443.
- The code sent is exactly what git tracks. The keys travel only with `--keys`, into folders only the service's
  user can read: `server/.dev.vars`, and the key files of the welcome account and of the boats named in `NPCS`.
- The service (`deploy/kail.service`) listens on the machine itself only, starts with the machine, starts again
  if it stops, and may write nothing. `journalctl -u kail -f` shows what the boats do.
- Run the boats in one place at a time: once they run there, stop `npm start` on the machine that has the keys,
  or start it without them (`KAIL_SERVER=https://<the address> npm start` on a copy that has no
  `server/.dev.vars`: the pages from here, the server from there).

### On Cloudflare, with the boats elsewhere

One Worker can serve the pages and the server (`server/worker.mjs`), but not the boats: they need a process that
stays up. So this way needs a second machine anyway, and is here for when the pages should not depend on it.
Keys are Worker secrets and are never written into a file of this repository.

```bash
npx wrangler login       # once, in your browser
npm run deploy           # copies the pages into dist/ and publishes
npm run secrets          # hands NEAR_KEY and WELCOME_KEY to Cloudflare, without showing them
```

`npm run worker` runs the same Worker on your machine in Cloudflare's runtime. The boats then run by themselves
on a machine that stays on, and play through the hosted server like players:

```bash
# on that machine: Node 20 or newer, this repository, and the boats' keys in ~/.near-credentials/testnet/
npm install
KAIL_SERVER=https://<the hosted address> BOATS_TOKEN=<from server/.dev.vars> \
NPCS="kail-old-tom.testnet=Old Tom,kail-maggie.testnet=Maggie,..." npm run boats
```

That machine holds the boats' keys and nothing else. Every two minutes the runner tells the hosted server who
the boats are, what each is doing and why (`BOATS_TOKEN` is the password between the two; `npm run secrets`
makes it up); the game shows that beside their orders. Without a runner the hosted game still shows their
standing orders, since those are on the contract, and names them from `NPCS` in `server/wrangler.toml`.

## Going to mainnet

Fill in the `mainnet` block of `src/network.js` and set `NETWORK`, deploy the contract and name its greeter,
give the server the same names in its settings, and deploy. The steps are written at the top of
`src/network.js`. On mainnet NEAR Auth signs players in only on an address it has approved
(docs.auth.near.org). Before real NEAR is in the vault, the full-access key of the contract's account has to be
removed or put behind a multisig, so that no single person can change the code or move the vault.

## Limits, said plainly

- Testnet only. Stakes are whatever is in the vault, which is test NEAR.
- The replay check proves the moves bring up that catch in that sea. It does not prove a person made the moves:
  a program can play. Limits on what a day can pay (500 tickets, 10 per account) bound what that is worth.
- The welcome bait is 5 per account, and accounts are cheap: somebody can make many.
- The server and the helper use free public nodes of NEAR unless `NEAR_RPC` names another; those turn a busy
  server away.
- Signing in with Google, Apple or email is closed on the hosted address: NEAR Auth's shared test client sends
  people back only to `http://localhost:3000` and to NEAR Auth's own demo. A reviewer's fresh copy cannot try
  it either (see "Signing in").
- The contract has not been audited. Its account is also its own owner and still has one full-access key, on
  the developer's machine: whoever holds that key could put other code there or send the account's NEAR away,
  the vault included.
- The wasm on the chain was built on that machine with `npm run build:contract`. Building this source there
  again, also from a fresh clone in another folder, gives the hash the chain shows (`npm run verify` prints the
  chain's, the build prints its own). It is not a reproducible-build image, so another machine or toolchain may
  give another hash.
- The game's key in the browser cannot move NEAR, but it can list and sell the player's fish and tickets and
  take offers. Somebody who got that key out of the browser could sell a player's things cheaply to an account
  of their own.
- At this size the game costs a player more than it pays. In the default week of `npm run simulate` (10 players,
  4 NEAR in the vault) the players pay about 1.3 NEAR to the network in fees, and the draws pay out about 0.08 NEAR.
  A prize is a share of the vault, so that changes only with a bigger vault.
- The vault on testnet is mostly the makers': about a tenth of it came from top-ups, the rest was put in with
  `add_prize` from the testnet faucet (`npm run add-prize`).
- Coins are paid for a ticket into a draw with a prize: that is a paid prize draw. Whether and where it may run
  with real NEAR has not been looked into.
- The server is trusted to check catches honestly; the contract only checks the server's signature on each
  one. Whoever held the server's key could sign catches for accounts of their own, up to what the daily limits
  let through (a day's prize is a fifth of the vault), until the key is replaced
  (`node scripts/rotate-server-key.mjs`). A day's quest is worked out from the day's number, so a coming day's
  quest can be known ahead.
- Two reviews (contract; server and pages) were made on 2026-11-13 by separate runs of an AI assistant that had
  not seen the code, and what they found was fixed,
  except what is listed here as a limit. Known and not fixed:
  - Coins do not expire, so coins bought while the vault is small can be spent when it is bigger. The price
    follows the vault at once when it grows, which closes the worst of it; somebody filling every draw for weeks
    with coins bought ahead could still take out more than they put in.
  - Storage for players' data is paid from the contract's own balance, and a day's entries are never removed:
    the account needs NEAR beyond the vault, more as the game is used.
  - The server keeps no memory of a throw: a changed client can try a throw as often as it likes offline and
    hand in the one that catches.
  - On a Cloudflare Worker the helper's hourly limits are per copy of the Worker, not for all of them.
  - Before mainnet the helper that carries NEAR Auth approvals has to check the approval itself and send the
    approved transaction itself; as it is, it trusts what the request says about paying the fee. (On testnet its
    routes answer only a browser on the server's own machine.)
- Nearly all orders on the markets are the computer's boats' so far, and the boats trade only while their
  runner is up (`npm start` with their keys, or `npm run boats`).
- The git history starts on 2026-11-13: the game was written outside git during the hackathon and brought in
  as a set of layered commits, so the commit dates say nothing about when each part was made.

## Libraries, templates and AI assistance

- Contract: `near-sdk` 5.30. The project's skeleton (`Cargo.toml`, `rust-toolchain.toml`) and its build come
  from `cargo-near`. The local-chain test uses `near-sandbox` and `near-api`.
- Pages and server: `near-api-js`, `@hot-labs/near-connect` (wallets), `function-call-key-plugin`,
  `@fast-auth-near/browser-sdk` and `@fast-auth-near/javascript-provider` (NEAR Auth), bundled with `esbuild`
  into `public/vendor/` (`npm run vendor`, `npm run vendor:auth`). The game's own code has no framework and no
  build step.
- Hosting: Caddy (set up by `deploy/setup.sh`); `wrangler` for the Cloudflare Worker.
- The font is Fredoka, loaded from Google Fonts. The pixel art is drawn by code in `art/`. The music is one
  piece from Google's Lyria 3 music model (`public/music/README.md`).
- AI assistance: the code, the tests and this README were written with Claude Code (Anthropic's coding
  assistant), directed and checked by the maker; the commits say so.
- Everything here was written during the hackathon. There is no earlier code of the maker's in it.

## Licence

MIT, see [LICENSE](LICENSE).
