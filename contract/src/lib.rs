//! Kail's contract: the economy of the fishing game, on NEAR.
//!
//! Everything a player owns is a token of this one contract, in the shape of NEP-245 (the multi token
//! standard): coins, bait, fish, chest finds and tickets. `mt.rs` is that part.
//!
//! The game's own rules:
//!   * `lib.rs`    - top up (NEAR in, coins out; the NEAR goes into the prize vault) and bait
//!   * `game.rs`   - casting the hook, landing a catch, storage and upgrades
//!   * `quest.rs`  - the daily quest that pays tickets, first come first served
//!   * `market.rs` - players selling fish and chest finds to each other, for coins
//!   * `tickets.rs` - players trading tickets with each other, for NEAR
//!   * `draw.rs`   - burning tickets to enter the daily draw, and its prizes in NEAR
//!
//! Coins and bait cannot be sent from one account to another. Coins only ever appear through a top-up.
//!
//! What a coin costs follows the day's prize: never less than 0.01 NEAR, and more on a day with a big prize,
//! so that making a ticket never costs less than a ticket is worth. Both are set when the day begins.
use near_sdk::json_types::{U64, U128};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{AccountId, NearToken, PanicOnDefault, Promise, env, near, require};

mod draw;
mod events;
mod game;
mod market;
mod mt;
mod quest;
mod tickets;

pub use draw::{Draw, DrawView, PastDraw};
pub use events::{Event, TicketTrade};
pub use market::{ItemOrder, ItemQuote};
pub use quest::QuestView;
pub use tickets::TicketOrder;

pub type TokenId = String;

pub const COIN: &str = "coin";
pub const BAIT: &str = "bait";
pub const TICKET: &str = "ticket";
/// Fish of the upper and middle water, fish of the deep, and the one prize fish near the floor.
pub const UPPER: [&str; 6] = ["anchovy", "mackerel", "clownfish", "snapper", "milkfish", "grouper"];
pub const DEEP: [&str; 3] = ["barracuda", "tuna", "shark"];
pub const PRIZE_FISH: &str = "sailfish";
/// What a chest can hold, and how many shares of the chance each has: one each, so all three are equally likely.
pub const CHEST: [(&str, u32); 3] = [("pearl", 1), ("goldbar", 1), ("crown", 1)];

pub fn is_fish(id: &str) -> bool {
    UPPER.contains(&id) || DEEP.contains(&id) || id == PRIZE_FISH
}
/// Fish and chest finds: the things that take room in storage.
pub fn is_item(id: &str) -> bool {
    is_fish(id) || CHEST.iter().any(|(c, _)| *c == id)
}

const YOCTO_PER_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
/// The price of a coin goes with the day's prize (see `price_for`). It is a whole number of millionths of a
/// NEAR, so it can be shown, and never less than a hundred-thousandth of a NEAR.
const PRICE_STEP: u128 = YOCTO_PER_NEAR / 1_000_000;
pub const LOWEST_COIN_PRICE: u128 = YOCTO_PER_NEAR / 100_000;
/// How many coins of bait one ticket is counted as, when the price of a coin is worked out: what a good player
/// spends on a ticket (measured with the game's robots: quick 44, average 48, slow 68). The owner can change it:
/// if players make tickets with fewer coins than this, the vault shrinks; with more, it grows.
pub const COINS_PER_TICKET: u32 = 44;
const COINS_PER_TICKET_KEY: &[u8] = b"coins_per_ticket";
/// The lowest price a ticket can be offered at on the ticket market.
pub const LOWEST_TICKET_PRICE: u128 = YOCTO_PER_NEAR / 10_000;
/// One bait costs 2 coins.
pub const BAIT_PRICE: u128 = 2;
pub const MAX_BAIT_PER_CALL: u32 = 1000;

/// What the contract remembers about a player besides the tokens.
#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct Profile {
    /// level of the reel and of the storage, starting at 0
    pub reel: u8,
    pub storage: u8,
    /// how many fish and chest finds the player holds (the storage has a limit)
    pub held: u32,
    /// how many times the player has cast; the number of the latest cast
    pub casts: u64,
    /// when the latest cast was made, in milliseconds; 0 once it has been landed
    pub cast_at: u64,
    /// the seal of the latest cast: the hash of a secret only the player who cast knows
    pub seal: Vec<u8>,
    /// when this player last brought up a chest, in milliseconds
    pub last_chest_at: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    /// May change the rules below. Cannot touch anybody's tokens.
    owner: AccountId,
    /// The game's server: the only account that may say what a cast caught.
    minter: AccountId,
    balances: LookupMap<(AccountId, TokenId), u128>,
    supply: LookupMap<TokenId, u128>,
    /// yoctoNEAR each account has paid in through top-ups
    topped_up: LookupMap<AccountId, u128>,
    /// The prize vault, in yoctoNEAR: all top-ups and ticket market fees, minus the prizes paid so far.
    vault: u128,
    profiles: LookupMap<AccountId, Profile>,
    /// How long a "day" is, in milliseconds: how often the quest changes.
    day_ms: u64,
    /// How many tickets the quest hands out in one day, for everybody together.
    quest_stock: u32,
    /// Tickets handed out so far, per day.
    quest_given: LookupMap<u64, u32>,
    /// The open orders of the item market (sales and offers to buy), for coins.
    listings: IterableMap<u64, ItemOrder>,
    next_listing: u64,
    listings_of: LookupMap<AccountId, u32>,
    /// Each draw pays out this many percent of the vault.
    prize_percent: u8,
    /// The draw of each day, the entries in the order they came (who, and the number of their first ticket),
    /// and how many tickets each account entered.
    draws: LookupMap<u64, Draw>,
    draw_entries: LookupMap<(u64, u32), (AccountId, u64)>,
    entered: LookupMap<(u64, AccountId), u32>,
    /// NEAR accounts can collect: prizes and the price of tickets they sold.
    owed: LookupMap<AccountId, u128>,
    ticket_orders: IterableMap<u64, TicketOrder>,
    orders_of: LookupMap<AccountId, u32>,
}

/// The first version's state, kept only so `migrate` can read it.
#[near(serializers = [borsh])]
pub struct ContractV1 {
    owner: AccountId,
    balances: LookupMap<(AccountId, TokenId), u128>,
    supply: LookupMap<TokenId, u128>,
    topped_up: LookupMap<AccountId, u128>,
    vault: u128,
}

/// What the game shows about one player, read in one call.
#[near(serializers = [json])]
pub struct PlayerView {
    pub coins: U128,
    pub bait: U128,
    pub tickets: U128,
    /// yoctoNEAR paid in through top-ups
    pub topped_up: U128,
    pub reel: u8,
    pub storage: u8,
    pub storage_cap: u32,
    pub held: u32,
    /// fish and chest finds held, as [kind, amount]
    pub items: Vec<(String, U128)>,
    /// the number of the cast that is in the water, if any, and when it was made (milliseconds)
    pub open_cast: Option<U64>,
    pub cast_at: U64,
    /// how many casts the player has made in all, and the server's mark of their sea (see `land`)
    pub casts: U64,
    pub sea: Option<String>,
    /// tickets entered into today's draw, and yoctoNEAR waiting to be collected
    pub entered_today: u32,
    pub owed: U128,
}

/// Everything a page of the game shows, in one answer: asking once is kinder to the shared public nodes than
/// asking eight times.
#[near(serializers = [json])]
pub struct StateView {
    pub quest: QuestView,
    pub draw: DrawView,
    /// the earlier draws that had tickets in them, newest first
    pub past_draws: Vec<PastDraw>,
    pub orders: Vec<ItemOrder>,
    pub ticket_orders: Vec<TicketOrder>,
    /// the ticket market's latest sales
    pub ticket_trades: Vec<TicketTrade>,
    pub vault: U128,
    pub coin_price: U128,
    /// how long a day is here, in milliseconds (the quest, the draw and the coin price all go by it)
    pub day_ms: U64,
    /// the account asked about, when one was named
    pub me: Option<PlayerView>,
    pub events: Vec<Event>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            minter: owner.clone(),
            owner,
            balances: LookupMap::new(b"b"),
            supply: LookupMap::new(b"s"),
            topped_up: LookupMap::new(b"t"),
            vault: 0,
            profiles: LookupMap::new(b"p"),
            day_ms: 5 * 60 * 1000,
            quest_stock: 0,
            quest_given: LookupMap::new(b"q"),
            listings: IterableMap::new(b"l"),
            next_listing: 1,
            listings_of: LookupMap::new(b"m"),
            prize_percent: 20,
            draws: LookupMap::new(b"d"),
            draw_entries: LookupMap::new(b"e"),
            entered: LookupMap::new(b"n"),
            owed: LookupMap::new(b"o"),
            ticket_orders: IterableMap::new(b"k"),
            orders_of: LookupMap::new(b"r"),
        }
    }

    /// Moves the state of the first deployed version (coins and bait only) to this one. Run once, by the
    /// contract's own account, right after new code is deployed.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: ContractV1 = env::state_read().expect("No old state to move");
        Self {
            minter: old.owner.clone(),
            owner: old.owner,
            balances: old.balances,
            supply: old.supply,
            topped_up: old.topped_up,
            vault: old.vault,
            profiles: LookupMap::new(b"p"),
            day_ms: 5 * 60 * 1000,
            quest_stock: 0,
            quest_given: LookupMap::new(b"q"),
            listings: IterableMap::new(b"l"),
            next_listing: 1,
            listings_of: LookupMap::new(b"m"),
            prize_percent: 20,
            draws: LookupMap::new(b"d"),
            draw_entries: LookupMap::new(b"e"),
            entered: LookupMap::new(b"n"),
            owed: LookupMap::new(b"o"),
            ticket_orders: IterableMap::new(b"k"),
            orders_of: LookupMap::new(b"r"),
        }
    }

    /// The owner sets the length of a day, the quest's daily stock, the game server's account, or the share
    /// of the vault that one draw pays out. Changing the length of a day renumbers the days: only do it when
    /// no draw is open.
    pub fn configure(&mut self, day_ms: Option<U64>, quest_stock: Option<u32>, minter: Option<AccountId>, prize_percent: Option<u8>, coins_per_ticket: Option<u32>) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can change the rules");
        if let Some(d) = day_ms {
            require!(d.0 >= 60_000, "A day is at least a minute");
            if d.0 != self.day_ms {
                self.change_day_length(d.0);
            }
        }
        // 0 = as many tickets a day as players earn
        if let Some(s) = quest_stock {
            self.quest_stock = s;
        }
        // counts from the next day on: today's price of a coin stays as it was set
        if let Some(k) = coins_per_ticket {
            require!((1..=1000).contains(&k), "Between 1 and 1000 coins");
            env::storage_write(COINS_PER_TICKET_KEY, &k.to_le_bytes());
        }
        if let Some(m) = minter {
            self.minter = m;
        }
        if let Some(p) = prize_percent {
            require!(p <= 100, "A share is at most 100 percent");
            self.prize_percent = p;
        }
    }

    /// Pay NEAR, get coins at today's price. As many whole coins as the NEAR buys are minted; what is left
    /// over (less than the price of one coin) is sent back.
    #[payable]
    pub fn top_up(&mut self) -> U128 {
        // today's prize and today's coin price are set before this NEAR comes in: a top-up counts for the
        // days after
        self.start_day();
        let price = self.coin_price_now();
        let sent = env::attached_deposit().as_yoctonear();
        require!(sent >= price, "That is less than the price of one coin today");
        let player = env::predecessor_account_id();
        let coins = sent / price;
        let paid = coins * price;
        if sent > paid {
            Promise::new(player.clone()).transfer(NearToken::from_yoctonear(sent - paid)).detach();
        }
        self.vault += paid;
        let before = self.topped_up.get(&player).copied().unwrap_or(0);
        self.topped_up.insert(player.clone(), before + paid);
        self.mint(&player, &[(COIN, coins)], Some("top up"));
        self.happened(&player, "top_up", COIN, coins as u32, paid, true);
        U128(coins)
    }

    /// Coins buy bait. One bait is needed for every throw of the hook.
    pub fn buy_bait(&mut self, amount: u32) {
        require!(amount >= 1, "Buy at least one bait");
        require!(amount <= MAX_BAIT_PER_CALL, "That is too much bait for one purchase");
        let player = env::predecessor_account_id();
        let amount = amount as u128;
        self.burn(&player, &[(COIN, amount * BAIT_PRICE)], Some("bait"));
        self.mint(&player, &[(BAIT, amount)], Some("bait"));
    }

    // ---- read-only

    pub fn player(&self, account_id: AccountId) -> PlayerView {
        let p = self.profile(&account_id);
        let items = UPPER.iter().chain(DEEP.iter()).chain([PRIZE_FISH].iter()).chain(CHEST.iter().map(|(id, _)| id))
            .filter_map(|id| { let n = self.balance(&account_id, id); (n > 0).then(|| (id.to_string(), U128(n))) })
            .collect();
        PlayerView {
            coins: U128(self.balance(&account_id, COIN)),
            bait: U128(self.balance(&account_id, BAIT)),
            tickets: U128(self.balance(&account_id, TICKET)),
            topped_up: U128(self.topped_up.get(&account_id).copied().unwrap_or(0)),
            reel: p.reel,
            storage: p.storage,
            storage_cap: game::storage_cap(p.storage),
            held: p.held,
            items,
            open_cast: (p.cast_at > 0).then_some(U64(p.casts)),
            cast_at: U64(p.cast_at),
            casts: U64(p.casts),
            sea: game::sea_of(&account_id),
            entered_today: self.entered.get(&(self.today(), account_id.clone())).copied().unwrap_or(0),
            owed: U128(self.owed.get(&account_id).copied().unwrap_or(0)),
        }
    }

    /// The whole state a page shows, in one call. With an account: that player's side too.
    pub fn state(&self, account_id: Option<AccountId>) -> StateView {
        StateView {
            quest: self.quest(),
            draw: self.draw(None),
            past_draws: self.past_draws(account_id.clone()),
            orders: self.item_orders(None, Some(100)),
            ticket_orders: self.ticket_orders(None, Some(100)),
            ticket_trades: self.ticket_trades(),
            vault: self.vault(),
            coin_price: self.coin_price(),
            day_ms: U64(self.day_ms),
            events: account_id.as_ref().map(|a| self.history(a.clone())).unwrap_or_default(),
            me: account_id.map(|a| self.player(a)),
        }
    }

    /// What one coin costs today, in yoctoNEAR. Set when the day begins; before anything has happened today
    /// this is what it will be.
    pub fn coin_price(&self) -> U128 {
        U128(self.coin_price_now())
    }

    /// The prize vault right now, in yoctoNEAR.
    pub fn vault(&self) -> U128 {
        U128(self.vault)
    }
    pub fn owner(&self) -> AccountId {
        self.owner.clone()
    }
    pub fn minter(&self) -> AccountId {
        self.minter.clone()
    }
}

const COIN_PRICE: &[u8] = b"coin_price";

impl Contract {
    /// The coin price that goes with a day's prize: the prize spread over the day's tickets and over the coins
    /// a ticket takes, rounded up to a price that can be shown, and never under 0.01 NEAR.
    /// The price of a coin on a day with this prize. A winning ticket gets a hundredth of the prize and one
    /// ticket in five wins, so a ticket is worth a five-hundredth of the prize: the coins for one ticket are
    /// priced at just that. So the bait for a ticket costs about what the ticket is worth, whatever the size of
    /// the vault, and a ticket that wins brings five times that.
    pub(crate) fn price_for(&self, prize: u128) -> u128 {
        let raw = prize / (draw::DRAW_CAP as u128 * self.coins_per_ticket() as u128);
        (raw.div_ceil(PRICE_STEP) * PRICE_STEP).max(LOWEST_COIN_PRICE)
    }
    pub fn coins_per_ticket(&self) -> u32 {
        env::storage_read(COINS_PER_TICKET_KEY).map(|b| u32::from_le_bytes(b.try_into().unwrap())).unwrap_or(COINS_PER_TICKET)
    }
    /// Remember the price of a day (done by `start_day`).
    pub(crate) fn set_coin_price(&mut self, day: u64, price: u128) {
        let mut bytes = day.to_le_bytes().to_vec();
        bytes.extend_from_slice(&price.to_le_bytes());
        env::storage_write(COIN_PRICE, &bytes);
    }
    pub(crate) fn coin_price_now(&self) -> u128 {
        if let Some(b) = env::storage_read(COIN_PRICE) {
            if u64::from_le_bytes(b[..8].try_into().unwrap()) == self.today() {
                return u128::from_le_bytes(b[8..24].try_into().unwrap());
            }
        }
        self.price_for(self.prize_forecast())
    }
    pub(crate) fn profile(&self, who: &AccountId) -> Profile {
        self.profiles.get(who).cloned().unwrap_or_default()
    }
    pub(crate) fn now_ms() -> u64 {
        env::block_timestamp_ms()
    }
}

#[cfg(test)]
mod tests;
