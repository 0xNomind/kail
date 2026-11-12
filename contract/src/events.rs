//! What happened to each account lately: sales, purchases, tickets, prizes, top-ups. The game shows this as
//! the player's history and tells them about what happened while they were away. It is kept here, on the chain,
//! so it is the same in every browser and does not depend on a game being open when something happens.
//! Only the latest 30 are kept for an account.
use near_sdk::borsh::{BorshDeserialize, to_vec};
use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, env, near};

use crate::{Contract, ContractExt};

const KEPT: usize = 30;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Event {
    /// when, in milliseconds
    pub at: U64,
    /// "sold", "bought" (fish and chest finds, for coins), "ticket_sold", "ticket_bought" (for NEAR),
    /// "quest" (tickets earned), "won" (a draw), "top_up"
    pub kind: String,
    /// the kind of thing, or "ticket", or "coin"
    pub what: String,
    pub amount: u32,
    /// coins for the item market, yoctoNEAR for everything else
    pub value: U128,
    /// true when the account did this itself; false when somebody else did it to one of its orders, or the
    /// draw did
    pub own: bool,
}

/// One sale on the ticket market, for everybody to see: what tickets have been going for.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct TicketTrade {
    pub at: U64,
    pub amount: u32,
    /// yoctoNEAR for one ticket
    pub price: U128,
    pub seller: AccountId,
    pub buyer: AccountId,
}
const TRADES: &[u8] = b"ticket_trades";

fn key(who: &AccountId) -> Vec<u8> {
    let mut k = b"h:".to_vec();
    k.extend_from_slice(who.as_bytes());
    k
}

impl Contract {
    pub(crate) fn events_of(&self, who: &AccountId) -> Vec<Event> {
        env::storage_read(&key(who)).map(|b| Vec::<Event>::try_from_slice(&b).unwrap_or_default()).unwrap_or_default()
    }
    /// Remember that something happened to an account.
    pub(crate) fn happened(&mut self, who: &AccountId, kind: &str, what: &str, amount: u32, value: u128, own: bool) {
        let mut list = self.events_of(who);
        list.insert(0, Event { at: U64(Self::now_ms()), kind: kind.to_string(), what: what.to_string(), amount, value: U128(value), own });
        list.truncate(KEPT);
        env::storage_write(&key(who), &to_vec(&list).unwrap());
    }
}

impl Contract {
    pub(crate) fn trades(&self) -> Vec<TicketTrade> {
        env::storage_read(TRADES).map(|b| Vec::<TicketTrade>::try_from_slice(&b).unwrap_or_default()).unwrap_or_default()
    }
    /// Remember a sale on the ticket market (the latest 30 are kept).
    pub(crate) fn traded(&mut self, seller: &AccountId, buyer: &AccountId, amount: u32, price: u128) {
        let mut list = self.trades();
        list.insert(0, TicketTrade { at: U64(Self::now_ms()), amount, price: U128(price), seller: seller.clone(), buyer: buyer.clone() });
        list.truncate(KEPT);
        env::storage_write(TRADES, &to_vec(&list).unwrap());
    }
}

#[near]
impl Contract {
    /// The ticket market's latest sales, newest first.
    pub fn ticket_trades(&self) -> Vec<TicketTrade> {
        self.trades()
    }

    /// What happened to an account lately, newest first.
    pub fn history(&self, account_id: AccountId) -> Vec<Event> {
        self.events_of(&account_id)
    }
}
