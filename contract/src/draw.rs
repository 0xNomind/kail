//! The draw: burn tickets to enter today's draw (500 fit into a day, 10 from one player). When the day is
//! over, one ticket in five wins, and each winning ticket gets a hundredth of that day's prize; what is not
//! won goes back into the vault. Winners collect with `claim`.
//!
//! The prize comes out of the vault. Every NEAR of every top-up goes into the vault, and so do the fees of
//! the ticket market. The prize of a day is a share (20%) of what is in the vault when that day begins: it is
//! set aside then, so players know all day what the draw will pay. What comes in during the day counts for
//! the days after. So the vault never runs dry, a busy day lifts the prizes of the days that
//! follow, and over time all of it comes back to the players as prizes.
use std::collections::HashMap;

use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, NearToken, Promise, env, near, require};

use crate::{Contract, ContractExt, TICKET};

/// For paying a draw's fee back from the vault (see `repay_the_draw`): the part of a draw's cost that the call
/// itself cannot measure, and what the network asks for a unit of gas (its lowest price, which is what it has
/// asked since the game began).
const DRAW_OVERHEAD_GAS: u128 = 4_500_000_000_000;
const GAS_PRICE: u128 = 100_000_000;

/// At most this many tickets win in one draw.
pub const MAX_WINNERS: u64 = 100;
/// So many tickets go into one day's draw, first come first served, and one account can put in so many.
/// Tickets that find no room stay with their holder, for a later draw or the ticket market.
pub const DRAW_CAP: u64 = 500;
pub const PLAYER_CAP: u32 = 10;
/// One ticket in so many wins. With a full draw that is 100 winners.
pub const ONE_IN: u64 = 5;

/// One day's draw.
#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct Draw {
    /// the day's prize in yoctoNEAR, set aside out of the vault when the day began
    pub pool: u128,
    /// how many tickets were burned into it, and in how many entries
    pub tickets: u64,
    pub entries: u32,
    pub settled: bool,
    pub winners: u32,
    pub prize_each: u128,
}

#[near(serializers = [json])]
pub struct DrawView {
    pub day: U64,
    /// the day's prize in yoctoNEAR
    pub pool: U128,
    /// true when the prize is set aside already; false when it is still a forecast
    pub fixed: bool,
    pub tickets: U64,
    pub settled: bool,
    pub winners: u32,
    /// yoctoNEAR for each winning ticket, once settled
    pub prize_each: U128,
    /// 0 when the day is over
    pub ends_in_ms: U64,
    /// how many tickets fit into a day's draw, and how many one account may put in
    pub cap: u32,
    pub per_player: u32,
}

/// A draw of an earlier day, as the Harbour lists it.
#[near(serializers = [json])]
pub struct PastDraw {
    pub day: U64,
    /// when that day ended, in milliseconds
    pub ended_at: U64,
    pub pool: U128,
    pub tickets: U64,
    pub settled: bool,
    pub winners: u32,
    pub prize_each: U128,
    /// how many tickets the account asked about had in it
    pub yours: u32,
    /// the hash of the transaction that held this draw, once the game has attached it: anybody can open it
    /// on an explorer and see the draw's own record of who won
    pub tx: Option<String>,
}
fn tx_key(day: u64) -> Vec<u8> {
    format!("draw_tx:{day}").into_bytes()
}
/// The days that had tickets in their draw, newest first (the latest ten).
const RECENT: &[u8] = b"recent_draws";
const LAST_DAY: &[u8] = b"last_day";
const RECENT_KEPT: usize = 10;

#[near]
impl Contract {
    /// Burn tickets to enter today's draw. Every ticket is one chance.
    pub fn enter_draw(&mut self, amount: u32) {
        require!(amount >= 1, "Enter at least one ticket");
        let player = env::predecessor_account_id();
        self.start_day();
        let day = self.today();
        let mut d = self.draw_of(day);
        let key = (day, player.clone());
        let mine = self.entered.get(&key).copied().unwrap_or(0);
        // the accounts that hold the draw do not take part in it
        require!(player != self.owner && player != self.minter, "The game's own accounts do not enter the draw");
        require!(mine + amount <= PLAYER_CAP, format!("One player can put {PLAYER_CAP} tickets into a day's draw"));
        require!(d.tickets + amount as u64 <= DRAW_CAP, "Today's draw is full: keep the ticket for the next one");
        self.burn(&player, &[(TICKET, amount as u128)], Some("draw"));

        if d.entries == 0 {
            // the first ticket of the day: this day goes onto the list of draws worth showing
            let mut days = self.recent_days();
            days.insert(0, day);
            days.truncate(RECENT_KEPT);
            env::storage_write(RECENT, &near_sdk::borsh::to_vec(&days).unwrap());
        }
        // entries are kept in the order they came: this one holds the tickets numbered from `d.tickets` on
        self.draw_entries.insert((day, d.entries), (player.clone(), d.tickets));
        d.entries += 1;
        d.tickets += amount as u64;
        self.draws.insert(day, d);
        self.entered.insert(key, mine + amount);
    }

    /// Hold the draw of a day that is over. Only the game itself may do it (the owner or the game's server),
    /// so nobody else chooses the moment; it works once per day.
    /// The chain's own randomness picks the winning tickets. Gives back how many tickets won.
    ///
    /// A contract cannot know the hash of the transaction it runs in. So after holding a draw the game calls
    /// again with that hash (`tx`), and it is kept with the draw for everybody to look up. It can be attached
    /// once, and only to a draw that has been held.
    pub fn settle_draw(&mut self, day: U64, tx: Option<String>) -> u32 {
        let caller = env::predecessor_account_id();
        require!(caller == self.owner || caller == self.minter, "Only the game can hold the draw");
        self.start_day();
        let today = self.today();
        require!(day.0 < today, "That day is not over yet");
        let mut d = self.draw_of(day.0);
        if let (true, Some(hash)) = (d.settled, &tx) {
            require!(env::storage_read(&tx_key(day.0)).is_none(), "That draw has its transaction already");
            require!((40..=50).contains(&hash.len()) && hash.chars().all(|ch| ch.is_ascii_alphanumeric()), "That is not a transaction hash");
            env::storage_write(&tx_key(day.0), hash.as_bytes());
            return d.winners;
        }
        require!(!d.settled, "That draw has been held already");
        // a day nobody entered has no draw: its prize went back into the vault when the next day began. Without
        // this, whoever held the server's key could "hold" every empty day there ever was and have the vault
        // pay for each.
        require!(d.tickets > 0, "No ticket was in that day's draw");
        d.settled = true;

        // One ticket in five wins. Whole fives give one winner each; for what is left over the chain rolls:
        // with 3 tickets left over there is one more winner 3 times out of 5. So every ticket has the same one
        // chance in five, in a draw of 3 tickets as in a full one, and a win is always the same prize.
        let mut seed = env::random_seed();
        seed.extend_from_slice(&day.0.to_le_bytes());
        let roll = {
            let mut s = seed.clone();
            s.extend_from_slice(b"one more");
            u64::from_le_bytes(env::sha256(&s)[..8].try_into().unwrap()) % ONE_IN
        };
        let winners = (d.tickets / ONE_IN + u64::from(roll < d.tickets % ONE_IN)).min(MAX_WINNERS);
        if winners == 0 {
            // nobody entered, or so few that this time no ticket won: the prize goes back into the vault
            self.vault += d.pool;
            d.pool = 0;
        } else {
            // a day from before prizes were set aside at the start of the day: take its prize now
            if d.pool == 0 {
                d.pool = self.prize_now();
                self.vault -= d.pool;
            }
            d.winners = winners as u32;
            // a winning ticket gets a hundredth of the prize, however few tickets are in the draw: so what a win
            // brings is known the moment the day begins. What is not won goes back into the vault.
            d.prize_each = d.pool / MAX_WINNERS as u128;
            let paid = d.prize_each * winners as u128;
            self.vault += d.pool - paid;
            d.pool = paid;
            // pick `winners` different ticket numbers out of `d.tickets`
            let mut moved: HashMap<u64, u64> = HashMap::new();
            let mut wins: HashMap<AccountId, u32> = HashMap::new();
            for i in 0..winners {
                let mut s = seed.clone();
                s.extend_from_slice(&i.to_le_bytes());
                let h = env::sha256(&s);
                let r = i + u64::from_le_bytes(h[..8].try_into().unwrap()) % (d.tickets - i);
                let picked = *moved.get(&r).unwrap_or(&r);
                let first = *moved.get(&i).unwrap_or(&i);
                moved.insert(r, first);
                let who = self.holder_of(day.0, picked, d.entries);
                self.owe(&who, d.prize_each);
                *wins.entry(who).or_insert(0u32) += 1;
            }
            // one line in each winner's history: how many of their tickets won, and what that comes to.
            // The same list goes into this transaction's log, so anybody can read who won from the chain.
            let mut list: Vec<(AccountId, u32)> = wins.into_iter().collect();
            list.sort();
            for (who, n) in &list {
                self.happened(who, "won", crate::TICKET, *n, d.prize_each * *n as u128, false);
            }
            let winners: Vec<_> = list.iter().map(|(who, n)| near_sdk::serde_json::json!({ "account": who, "tickets": n })).collect();
            env::log_str(&format!("EVENT_JSON:{}", near_sdk::serde_json::json!({ "standard": "kail", "version": "1.0.0", "event": "draw",
                "data": [{ "day": day, "tickets_in": d.tickets.to_string(), "prize": d.pool.to_string(), "prize_each": d.prize_each.to_string(), "winners": winners }] })));
        }
        self.draws.insert(day.0, d.clone());
        env::log_str(&format!("Draw of day {}: {} winning tickets, {} yoctoNEAR each", day.0, d.winners, d.prize_each));
        self.repay_the_draw(&caller);
        d.winners
    }

    /// Collect the NEAR this account is owed: prizes, and tickets it sold.
    pub fn claim(&mut self) -> Promise {
        let player = env::predecessor_account_id();
        let amount = self.owed.get(&player).copied().unwrap_or(0);
        require!(amount > 0, "Nothing to collect");
        self.owed.remove(&player);
        self.happened(&player, "claimed", "near", 0, amount, true);
        Promise::new(player).transfer(NearToken::from_yoctonear(amount))
    }

    /// Anybody may put NEAR into the vault (this is how the game's makers fund the first prizes).
    #[payable]
    pub fn add_prize(&mut self) {
        self.start_day();
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid > 0, "Attach the NEAR to add");
        self.vault += paid;
    }

    /// The draw of a day (today's when no day is given).
    pub fn draw(&self, day: Option<U64>) -> DrawView {
        let today = self.today();
        let day = day.map(|d| d.0).unwrap_or(today);
        let d = self.draw_of(day);
        let now = Self::now_ms();
        // set aside already, or (on a day nothing has happened yet) what will be set aside
        let fixed = day != today || d.settled || d.pool > 0;
        DrawView {
            day: U64(day),
            pool: U128(if fixed { d.pool } else { self.prize_forecast() }),
            fixed,
            tickets: U64(d.tickets),
            settled: d.settled,
            winners: d.winners,
            prize_each: U128(d.prize_each),
            ends_in_ms: U64(if day == today { self.day_ms - now % self.day_ms } else { 0 }),
            cap: DRAW_CAP as u32,
            per_player: PLAYER_CAP,
        }
    }

    /// The earlier draws that had tickets in them, newest first: what each paid, and the named account's part.
    pub fn past_draws(&self, account_id: Option<AccountId>) -> Vec<PastDraw> {
        let today = self.today();
        self.recent_days().into_iter().filter(|day| *day < today).map(|day| {
            let d = self.draw_of(day);
            PastDraw {
                day: U64(day),
                ended_at: U64((day + 1) * self.day_ms),
                pool: U128(d.pool),
                tickets: U64(d.tickets),
                settled: d.settled,
                winners: d.winners,
                prize_each: U128(d.prize_each),
                yours: account_id.as_ref().map(|a| self.entered.get(&(day, a.clone())).copied().unwrap_or(0)).unwrap_or(0),
                tx: env::storage_read(&tx_key(day)).and_then(|b| String::from_utf8(b).ok()),
            }
        }).collect()
    }

    /// How many tickets an account entered into a day's draw.
    pub fn entered(&self, account_id: AccountId, day: U64) -> u32 {
        self.entered.get(&(day.0, account_id)).copied().unwrap_or(0)
    }
}

impl Contract {
    fn recent_days(&self) -> Vec<u64> {
        use near_sdk::borsh::BorshDeserialize;
        env::storage_read(RECENT).map(|b| Vec::<u64>::try_from_slice(&b).unwrap_or_default()).unwrap_or_default()
    }
    pub(crate) fn today(&self) -> u64 {
        Self::now_ms() / self.day_ms
    }
    pub(crate) fn draw_of(&self, day: u64) -> Draw {
        self.draws.get(&day).cloned().unwrap_or_default()
    }
    /// The first thing that touches the vault or a draw on a new day sets that day's prize aside. Nothing
    /// changed the vault between midnight and this call, so this is the vault as the day began.
    /// A day gets its number from how long a day is, so with another length every day has another number.
    /// The change is only made between draws: no tickets may be in today's draw and no earlier draw may be
    /// waiting to be held. Today's prize goes back into the vault, the list of earlier draws starts anew
    /// (their closing times were counted with the old length), and the next action begins a day of the new length.
    pub(crate) fn change_day_length(&mut self, day_ms: u64) {
        self.start_day();
        let today = self.today();
        let mut d = self.draw_of(today);
        require!(d.tickets == 0, "Tickets are in today's draw: change the length of a day after it has been held");
        for day in self.recent_days() {
            let earlier = self.draw_of(day);
            require!(earlier.settled || earlier.tickets == 0, "A draw is still waiting to be held");
        }
        self.vault += d.pool;
        d.pool = 0;
        self.draws.insert(today, d);
        env::storage_remove(LAST_DAY);
        env::storage_remove(RECENT);
        self.day_ms = day_ms;
    }

    pub(crate) fn start_day(&mut self) {
        let today = self.today();
        let last = env::storage_read(LAST_DAY).map(|b| u64::from_le_bytes(b.try_into().unwrap()));
        if last == Some(today) {
            return;
        }
        // first close the books of the day before: an unentered prize goes back, and a day that began with
        // an empty vault gets its prize now that it is over
        if let Some(l) = last {
            let mut d = self.draw_of(l);
            if !d.settled {
                if d.tickets == 0 {
                    self.vault += d.pool;
                    d.pool = 0;
                } else if d.pool == 0 {
                    d.pool = self.prize_now();
                    self.vault -= d.pool;
                }
                self.draws.insert(l, d);
            }
        }
        let mut d = self.draw_of(today);
        d.pool = self.prize_now();
        self.vault -= d.pool;
        // the price of a coin goes with the prize, and is fixed for the day with it
        let price = self.price_for(d.pool);
        self.set_coin_price(today, price);
        self.draws.insert(today, d);
        env::storage_write(LAST_DAY, &today.to_le_bytes());
    }
    /// The share of the vault that one day's draw gets.
    pub(crate) fn prize_now(&self) -> u128 {
        self.vault * self.prize_percent as u128 / 100
    }
    /// What today's prize will be, on a day nothing has happened yet. The last day's prize is still set aside
    /// then; if nobody entered that day it comes back into the vault the moment this day begins, so it counts.
    pub(crate) fn prize_forecast(&self) -> u128 {
        let mut vault = self.vault;
        if let Some(last) = env::storage_read(LAST_DAY).map(|b| u64::from_le_bytes(b.try_into().unwrap())) {
            let d = self.draw_of(last);
            if last != self.today() && !d.settled && d.tickets == 0 {
                vault += d.pool;
            }
        }
        vault * self.prize_percent as u128 / 100
    }
    /// The vault pays for its own draws. Holding one costs the game's server a fee to the network; the vault
    /// gives it back, so that the server's account never runs dry and nobody has to feed it. What is paid: the
    /// gas this call has used, and a fixed part for what cannot be measured from inside it (sending the call,
    /// this payment, and the second call that tells the draw's transaction), at the network's gas price.
    /// Not when the owner holds the draw, nor when the contract is its own server: then nothing left the game.
    fn repay_the_draw(&mut self, caller: &AccountId) {
        if *caller != self.minter || *caller == env::current_account_id() {
            return;
        }
        // (the prizes owed and the draw are written down first, so that what they cost is in the gas counted)
        self.owed.flush();
        self.draws.flush();
        let fee = (u128::from(env::used_gas().as_gas()) + DRAW_OVERHEAD_GAS) * GAS_PRICE;
        if self.vault < fee {
            return;
        }
        self.vault -= fee;
        env::log_str(&format!("The vault pays {fee} yoctoNEAR for holding this draw"));
        Promise::new(caller.clone()).transfer(NearToken::from_yoctonear(fee)).detach();
    }
    pub(crate) fn owe(&mut self, who: &AccountId, yocto: u128) {
        let now = self.owed.get(who).copied().unwrap_or(0);
        self.owed.insert(who.clone(), now + yocto);
    }
    /// Whose entry holds the ticket with this number: the last entry that starts at or before it.
    fn holder_of(&self, day: u64, ticket: u64, entries: u32) -> AccountId {
        let (mut lo, mut hi) = (0u32, entries - 1);
        while lo < hi {
            let mid = (lo + hi).div_ceil(2);
            if self.draw_entries.get(&(day, mid)).unwrap().1 <= ticket { lo = mid; } else { hi = mid - 1; }
        }
        self.draw_entries.get(&(day, lo)).unwrap().0.clone()
    }
}
