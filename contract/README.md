# Kail's contract

The economy of the fishing game Kail, on NEAR. Everything a player owns is a token of this one contract,
in the shape of [NEP-245](https://github.com/near/NEPs/blob/master/neps/nep-0245.md) (the multi token standard).

What it does so far:

| Call | What happens |
| --- | --- |
| `top_up` (with NEAR attached) | Coins are minted at today's price (`coin_price`), and that NEAR goes into the prize vault; what is left over, less than one coin's price, is sent back. The price of a coin goes with the day's prize: the 44 coins a ticket is counted as cost a five-hundredth of the prize, which is what a ticket is worth (one in five wins a hundredth). It is set when the day begins and stays for the day; the lowest price is 0.00001 NEAR. |
| `buy_bait { amount }` | 2 coins are burned for each bait. |
| `cast { seal }` | 1 bait is burned and the cast gets a number. Refused, with nothing spent, when the storage is full. `seal` is the SHA-256 of a secret the player's game made up. |
| `land { cast, what, secret, sea, approval }` | The player lands their own catch, and pays the network's fee for it. The contract takes it only with `approval`: the game's server's signature for exactly this catch (this contract, this player, this cast, `what`, `sea`), checked against the key the owner named with `set_server_key`. The server's own account may make the call for a player instead (then with `player`). Either way it needs the cast's secret, which only the player who cast has. The server does not take the game's word for `what`: it plays the player's moves again in the player's sea and reports what came up there (`src/replay.js`, `server/game.mjs`). `sea` is the server's mark for that sea after this catch; it is kept per player (`player.sea`), and a sea from before it is of no use any more. `what` is a kind of fish, or `chest`: then the chain's own randomness picks pearl, gold bar or old crown, each as likely as the others. The catch is minted, unless the storage is full. One player can bring up a chest at most every 20 seconds. A chest is opened in a second step, a call of the contract to itself (`chest_opened`, which nobody else can make): the cast is spent before anybody can know the find, so a landing cannot be undone because the find did not suit. |
| `throw_back { token_id, amount }` | Fish or chest finds go back into the sea: burned, and their room in storage is free. |
| `upgrade { what }` | Coins buy the next reel or storage level. Storage limits how many fish and finds an account holds. |
| `quest` (read-only), `hand_in` | One quest a day, the same for everybody: an upper fish, a deep fish and a chest find. Handing them in is all or nothing: the things are burned and the tickets minted in one step. It can be done again as often as a player finishes it (the owner can set a daily stock; there is none by default). The first storage (16) holds the biggest quest (14 things). |
| `list_item`, `buy_item`, `want_item`, `sell_item`, `cancel_item_order`, `item_orders`, `item_quote` | Players trade fish and chest finds with each other for coins: a seller lists at a price, or a buyer posts an offer and sellers sell into it. Things for sale and coins for offers are held by the contract. 5% of every sale is burned, rounded up, so at least 1 coin; whoever acts on an order pays it (a buyer taking from a sale pays price plus fee, a seller selling into an offer gets price minus fee), so whoever posted the order gets exactly their price. The lowest price is 2 coins, so no sale pays a seller nothing, and `item_quote` tells what a sale will come to before anybody commits. Things up for sale keep their room in the seller's storage, and an offer to buy sets its room aside in the buyer's, so a full storage never breaks a sale halfway. |
| `enter_draw { amount }` | Burn tickets to enter today's draw. A day's draw takes 500 tickets, 10 from one account, first come first served; tickets that find no room stay with their holder. Every ticket is one chance. |
| `settle_draw { day }` | Only the game itself (the owner or the game's server) holds the draw of a day that is over, once. One ticket in five wins: the chain's randomness picks them (for a number of tickets that does not divide by five it also rolls whether there is one winner more), at most 100. Each winning ticket gets a hundredth of that day's prize, and what is not won goes back into the vault. The transaction's log lists every winner. Called again with `tx` (the hash of that transaction), it attaches the hash to the draw, once, so anybody can look the draw up. When the game's server holds it (from its own account), the vault pays that account back what the draw cost in network fees, by the gas used: the vault pays for its own draws. |
| `claim` | Collect the NEAR an account is owed: prizes, and tickets it sold. |
| `sell_tickets`, `buy_tickets`, `bid_tickets`, `fill_bid`, `cancel_order`, `ticket_orders` | The ticket market, for NEAR. Tickets for sale and NEAR for offers are held by the contract. 5% of every sale goes into the prize vault. |
| `draw { day }`, `past_draws`, `entered`, `owed` | Read-only: a day's draw, the latest ten earlier draws that had tickets in them, an account's entries, and what it can collect. |
| `ticket_trades` | Read-only: the ticket market's latest 30 sales (how many, at what price, between whom), newest first. |
| `history { account_id }` | Read-only: the latest 30 things that happened to an account (sales and purchases on both markets, quest tickets, draw prizes, top-ups), newest first. Both sides of a trade get their line, whether their game was open or not. |
| `state { account_id }` | Read-only: everything a page shows in one answer (quest, draw, both markets, vault, coin price, and the named account's side and history). |
| `player { account_id }` | Read-only: everything the game shows about one player. |
| `mt_balance_of`, `mt_batch_balance_of`, `mt_supply`, `mt_batch_supply`, `mt_token` | The standard's read-only methods. |
| `mt_transfer`, `mt_batch_transfer` | The standard's transfers. Only tickets can be sent to another account. Coins, bait, fish and chest finds cannot: they change hands through the market only. |
| `welcome { player }`, `welcomed`, `set_greeter`, `greeter` | A new account gets 5 bait, once. Only the owner or the greeter (the game's helper account, named by the owner) can give them. |
| `relay_fee` (with NEAR attached) | What a player who signs in with NEAR Auth pays for having an approval signed: it is owed to the greeter, who sent the signing request, and collected with `claim`. With no greeter it goes into the vault. |
| `configure`, `add_prize` | The owner sets the length of a day (only between draws), a daily stock for the quest (0 = no limit, the default), the server's account, the share of the vault a draw pays out, or how many coins a ticket is counted as when the coin's price is worked out (44; fewer makes coins dearer). Anybody may add NEAR to the vault with `add_prize`. |

The vault holds every NEAR of every top-up and the ticket market's fees. A day's prize is 20% of the vault
as it is when that day begins (the owner can change the share): it is set aside then, so it is known all day,
and what comes in during the day counts for the days after. Over time all of it comes back to players as prizes. Nothing lets anybody
take NEAR out of the vault any other way.

Not there yet: the standard's `mt_transfer_call`.

What the contract does not check: whether a player really caught the fish the server signed for. That is the
server's job; the contract checks that the server did sign.

## Try it

```bash
cargo test                                # unit tests, then the contract on a local NEAR chain
cargo near build non-reproducible-wasm    # writes target/near/contract.wasm
```

`src/mt.rs` is the token standard. The game's rules are in `src/lib.rs` (top up, bait), `src/game.rs` (casting,
catches, storage, upgrades), `src/quest.rs` and `src/market.rs`.
