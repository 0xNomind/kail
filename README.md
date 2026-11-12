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
npm test          # the sea, the replay check, the boats' rules (about a minute)
npm start         # the pages, at http://localhost:3000
```

`npm run verify` changes nothing and needs no account. It prints each claim with what it found on the chain
(the contract and its NEP-245 methods, the draw's limits, the coin price worked out from the prize, earlier draws
with the transaction that held each, the ten boats with their balances and casts, their orders on the markets)
and ends with a line like `9 held, 0 did not, 5 skipped`. The five skipped ones are about a running game server:
`npm run verify -- --server <address>` checks those too, against the hosted game or against
`http://localhost:3000` on a machine that has the server's key. `--json` gives the same as JSON.

Where each claim lives, and how to check it:

| Claim | Code | Check |
| --- | --- | --- |
| A catch is played again by the server before it counts | `src/replay.js`, `land` in `server/game.mjs` | `npm test` (thousands of recorded catches replay to the same result; tampered ones do not); `verify --server`: a made-up catch is refused |
| Everything owned is an NEP-245 token of one contract | `contract/src/mt.rs` | `npm run verify`; `npm run test:contract` |
| The prize, the 500 / 10 limits, one ticket in five, the coin price | `contract/src/draw.rs`, `price_for` in `contract/src/lib.rs` | `npm run verify`; `npm run test:contract` (58 tests) |
| The computer's boats are accounts that play by readable rules | `server/npc-rules.mjs`, `server/npc.mjs` | `npm run verify` lists them; `test/npc.test.mjs` |
| Playing opens no wallet after one approval | `GAME_CALLS` and `enableGameKey` in `src/account.js` | a player's account has a function-call key limited to those methods (any explorer) |
| Sign-in with Google, Apple or email | `src/nearauth.js`, `server/relay.mjs` | by hand, at `http://localhost:3000` (see "Signing in") |

What cannot be checked without a signed-in player: the game itself (casting and pulling), a top-up, entering a
draw. Those are the steps under "Try it". A local `npm start` without the server's key shows the pages with live
contract data, but cannot land a catch; `KAIL_SERVER=<the hosted address> npm start` uses the hosted server
instead. `npm run test:contract` needs Rust and compiles for several minutes the first time.

## The problem it deals with

A game that pays out real tokens has three weak spots, and this project is an attempt at each:

1. **"The server says you caught it."** If the game's server just reports catches, whoever controls a client can
   report anything. Here the sea is decided by the server, the player's moves are recorded, and to land a catch
   the moves are handed in: the server plays them again in the same sea and sees for itself what came up
   (`src/replay.js`, `server/game.mjs`). Only then does it have the contract put the fish in storage.
2. **A prize that depends on new money.** A day's prize is a fixed share (20%) of the vault as it stood when the
   day began, at most 500 tickets enter a day (10 per account), one ticket in five wins, and a winning ticket gets
   a hundredth of the prize. A day with few tickets pays out less and the rest stays in the vault. The price of a
   coin is worked out from the day's prize, so bait is never dearer than what it can win back on average.
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
| Press **Sign in**, choose **NEAR wallet** (Meteor on testnet) or **NEAR Auth** (Google, Apple, email) | You land in the game. A new account gets 5 bait once. With too little NEAR the game says so first, with your account's name and the testnet faucet |
| Press **Approve once** | One approval adds the game's key. From here casting and trading open no window |
| Press **CAST**, steer the hook onto a fish, hold to pull it up while keeping it in the box | The fish is in Storage after a few seconds. It is a token: look your account up on `https://testnet.nearblocks.io` |
| Open **Board → Market** | Orders by players and by the computer's boats, cheapest first. Open one: it says who it is from. Where the boats run (a local `npm start` with the boats' keys) it also says why the boat asks that price |
| Open **Board → Quest**, hand in the three things asked for | A ticket |
| Open **Harbour** | Top up coins with NEAR, put tickets into today's draw, see earlier draws with the transaction that held each, collect NEAR you won |
| Open **Tickets** | The ticket market, for NEAR: buy one sale, or several of the cheapest at once in one transaction |

On testnet a "day" is one hour, so a quest and a draw come round every hour. The pages say so.

## What is on NEAR

- Contract: [`kail-game.testnet`](https://testnet.nearblocks.io/address/kail-game.testnet), source in
  [`contract/`](contract/README.md) (Rust, near-sdk). 58 unit tests and a test on a local chain.
- Tokens: one NEP-245 contract holds every kind. Only tickets can be sent to another account; coins, bait and
  fish change hands through the market.
- The draw uses the chain's randomness and is held by anybody's call once a day is over (the server does it every
  minute). Every draw is kept with its winners and the transaction that held it.
- What NEAR makes possible here: function-call access keys (the game key that can only call the game's small
  actions and can never move NEAR), named accounts made for players by the network's registrar, NEAR Auth's
  MPC-held keys for sign-in without a wallet, fees small enough that every cast can be a transaction
  (about 0.0003 NEAR), and one transaction carrying several calls (buying from several sellers at once, or a
  fee together with a top-up).

## The computer's boats

`server/npc-rules.mjs` holds ten fishers and the one function that decides a boat's next step from the
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
| `contract/` | The contract |
| `server/game.mjs` | The game's server: hands out a sea, plays a catch again, lands it, holds the draws |
| `server/relay.mjs` | The helper for new players and NEAR Auth |
| `server/npc-rules.mjs`, `server/npc.mjs` | The computer's boats |
| `serve.mjs` | Runs all of it on one machine with Node |
| `server/boats.mjs` | Runs only the boats, against a hosted server (`npm run boats`) |
| `server/worker.mjs`, `server/wrangler.toml` | The same server as a Cloudflare Worker |
| `public/vendor/` | The wallet and NEAR Auth libraries, packed into browser files (`npm run vendor`, `npm run vendor:auth`) |
| `art/` | The pixel art and the site's icons, drawn by code (`npm run art`) |
| `public/music/` | The one piece of music, generated with a music model (see the note in that folder). There are no other sounds |
| `test/` | Tests of the sea, the replay and the boats' rules |

## Tests

```bash
npm test                 # the sea, the replay check, the boats' rules
npm run test:contract    # the contract's unit tests (needs Rust)
```

## Running the server yourself

The server's settings are listed in [`server/dev.vars.example`](server/dev.vars.example): copy it to
`server/.dev.vars`. It needs an account with a key that may call `land` and `settle_draw` on the contract; the
helper account (`npm run welcome`) and the boats' accounts (`npm run npcs`) are made on testnet by those scripts.
`npm start` then runs the pages, the server, the helper and the boats.

## Hosting on Cloudflare

One Worker serves the pages and the server (`server/worker.mjs`). Keys are Worker secrets and are never written
into a file of this repository.

```bash
npx wrangler login       # once, in your browser
npm run secrets          # hands NEAR_KEY and WELCOME_KEY to Cloudflare, without showing them
npm run deploy           # copies the pages into dist/ and publishes
```

`npm run worker` runs the same Worker on your machine in Cloudflare's runtime.

The computer's boats need a process that stays up, which a Worker is not. They run by themselves on any
machine that stays on (a small VPS will do) and play through the hosted server like players:

```bash
# on that machine: Node 20 or newer, this repository, and the boats' keys in ~/.near-credentials/testnet/
npm install
KAIL_SERVER=https://<the hosted address> BOATS_TOKEN=<from server/.dev.vars> \
NPCS="kail-old-tom.testnet=Old Tom,kail-maggie.testnet=Maggie,..." npm run boats
```

That machine holds the boats' keys and nothing else: not the game's key, not the helper's. Every two minutes the
runner tells the hosted server who the boats are, what each is doing and why (`BOATS_TOKEN` is the password
between the two; `npm run secrets` makes it up); the game shows that beside their orders. Run the boats in one
place at a time. Without a runner the hosted game still shows their standing orders, since those are on the
contract, and names them from `NPCS` in `server/wrangler.toml`.

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
- The contract has not been audited.

## Licence

MIT, see [LICENSE](LICENSE).
