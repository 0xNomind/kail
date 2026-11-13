# Kail

A fishing game in the browser whose economy runs on a NEAR contract. Built at NEAR Hackathon, for the tracks
`games` and `open`. It is on NEAR **testnet**.

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
(the contract and its NEP-245 methods, the draw's limits, the coin price worked out from the prize, earlier draws
with the transaction that held each, the ten boats with their balances and casts, their orders on the markets)
and ends with a line like `9 held, 0 did not, 5 skipped`. The five skipped ones are about a running game server:
`npm run verify -- --server <address>` checks those too, against the hosted game or against
`http://localhost:3000` on a machine that has the server's key. `--json` gives the same as JSON.

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
| The prize, the 500 / 10 limits, one ticket in five, the coin price | `contract/src/draw.rs`, `price_for` in `contract/src/lib.rs` | `npm run verify`; `npm run test:contract` (61 tests) |
| The economy keeps going by itself, and its books close | `src/week.js`, `src/model.js` | `npm run simulate`; `npm test` |
| The computer's boats are accounts that play by readable rules | `src/npc-rules.js`, `server/npc.mjs` | `npm run verify` lists them; `test/npc.test.mjs` |
| Playing opens no wallet after one approval | `GAME_CALLS` and `enableGameKey` in `src/account.js` | a player's account has a function-call key limited to those methods (any explorer) |
| Sign-in with Google, Apple or email | `src/nearauth.js`, `server/relay.mjs` | by hand, at `http://localhost:3000` (see "Signing in") |

The game itself can be seen and played without signing in: `http://localhost:3000/play` is then a practice sea
(the same sea, hook and pull, played in the browser only; nothing is saved or sent). What cannot be checked
without a signed-in player is what touches the chain: a real cast, a top-up, entering a draw. Those are the steps
under "Try it". A local `npm start` without the server's key shows the pages with live
contract data, but cannot land a catch; `KAIL_SERVER=<the hosted address> npm start` uses the hosted server
instead. `npm run test:contract` needs Rust and compiles for several minutes the first time.

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
   buying bait, trading fish) with a key that can do nothing else, so playing opens no wallet. Signing in also
   works with Google, Apple or email (NEAR Auth), with no wallet at all.

## Try it

Hosted: _the address is added here after the first deploy._

On your own machine (Node 20 or newer):

```bash
npm install
npm start
```

Then open `http://localhost:3000`. To use the hosted game's server from your machine (no keys needed), start it
with `KAIL_SERVER=<the hosted address> npm start`. Signing in with Google or email works at exactly
`http://localhost:3000`, because NEAR Auth's shared test sign-in only accepts that address.

Steps a judge can follow:

| Do | See |
| --- | --- |
| Open the front page | Today's quest, the prize and the tickets in today's draw, read live from the contract `kail-game.testnet` |
| Press **Play now** without signing in | The practice sea: press **CAST**, steer the hook onto a fish, hold to pull it up. Bait is free there and nothing is saved |
| Press **Sign in**, choose **NEAR wallet** (Meteor on testnet) or **NEAR Auth** (Google, Apple, email) | You land in the game. A new account gets 5 bait once. With too little NEAR the game says so first, with your account's name and the testnet faucet |
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
  [`contract/`](contract/README.md) (Rust, near-sdk). 61 unit tests and a test on a local chain.
- Who pays the network: whoever acts. A player pays for their own cast and for their own catch (about 0.0003
  NEAR each), sent by the game's key without a wallet window. The game's server only signs its approval of a
  catch, which costs nothing, and pays for holding the daily draws (about 0.0005 NEAR each) from an account of
  its own, `kail-server.testnet`. The contract's account, which holds the prize vault, pays no fees. So running
  the game costs its makers the same whether ten people fish or ten thousand, and mainnet needs no other
  arrangement.
- Tokens: one NEP-245 contract holds every kind. Only tickets can be sent to another account; coins, bait and
  fish change hands through the market.
- The draw uses the chain's randomness. Once a day is over it is held by a call from the game's server (every
  minute it looks for days to hold; only the server's account or the owner may make that call). Every draw is
  kept with its winners and the transaction that held it.
- What NEAR makes possible here: function-call access keys (the game key that can only call the game's small
  actions and can never move NEAR), named accounts made for players by the network's registrar, NEAR Auth's
  MPC-held keys for sign-in without a wallet, fees small enough that every cast can be a transaction
  (about 0.0003 NEAR), and one transaction carrying several calls (buying from several sellers at once, or a
  fee together with a top-up).

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
(`test/npc.test.mjs`: 47 situations and 20,000 made-up states).

## Signing in

- **NEAR wallet** (NEAR Connect, `@hot-labs/near-connect`): connecting costs nothing; the game key is asked for in
  the game.
- **NEAR Auth** (`@fast-auth-near`): the player's key is held by NEAR's MPC network. The game's helper account
  (`kail-welcome.testnet`, `server/relay.mjs`) makes the player a named account and carries each approval to
  NEAR Auth's contract. An approval on the game's contract carries 0.005 NEAR that pays the helper back
  (`relay_fee`); the server refuses to carry one that does not.

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
| `test/` | Tests of the sea, the replay and the boats' rules. `test/model/` is the economy as it was modelled before the contract existed; the game does not use it |

## Tests

```bash
npm test                 # the sea, the replay check, the boats' rules
npm run test:contract    # the contract's unit tests (needs Rust)
npm run build:contract   # builds the contract (needs cargo-near)
```

## Running the server yourself

The server's settings are listed in [`server/dev.vars.example`](server/dev.vars.example): copy it to
`server/.dev.vars`. The server's own account (`npm run server-account`: makes it, gives it a key that may only
call `land` and `settle_draw`, and names it and that key to the contract), the helper account (`npm run welcome`) and the
boats' accounts (`npm run npcs`) are made by those scripts. `npm start` then runs the pages, the server, the
helper and the boats. The server's account pays only for holding the draws, about 0.0005 NEAR each (the server
says so in its log when the account is under half a NEAR, and `npm run verify -- --server` fails then).
`node scripts/rotate-server-key.mjs` replaces the server's key.

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
(docs.auth.near.org).

## Limits, said plainly

- Testnet only. Stakes are whatever is in the vault, which is test NEAR.
- The replay check proves the moves bring up that catch in that sea. It does not prove a person made the moves:
  a program can play. Limits on what a day can pay (500 tickets, 10 per account) bound what that is worth.
- The welcome bait is 5 per account, and accounts are cheap: somebody can make many.
- The server and the helper use free public nodes of NEAR unless `NEAR_RPC` names another; those turn a busy
  server away.
- NEAR Auth on testnet works at `http://localhost:3000` only, until NEAR Auth approves the hosted address.
- The contract has not been audited. Its account is also its own owner, and the wasm on the chain was built on
  a developer's machine, not reproducibly: the source here is what was deployed, but the chain cannot prove it.
- The server is trusted to check catches honestly; the contract only checks that the server's account reports
  them. A day's quest is worked out from the day's number, so a coming day's quest can be known ahead.
- Nearly all orders on the markets are the computer's boats' so far, and the boats trade only while their
  runner is up (`npm start` with their keys, or `npm run boats`).
- The git history starts on 2026-11-13: the game was written outside git during the hackathon and brought in
  as a set of layered commits, so the commit dates say nothing about when each part was made.

## Licence

MIT, see [LICENSE](LICENSE).
