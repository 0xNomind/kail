//! The ticket market, for NEAR. Tickets are all alike, so an order is "this many, at this price each".
//! A seller's tickets and a buyer's NEAR are held by the contract until the order is filled or cancelled,
//! so nobody has to trust anybody. 5% of every sale goes into the prize vault.
use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, env, near, require};

use crate::{Contract, ContractExt, LOWEST_TICKET_PRICE, TICKET};

const FEE_PERCENT: u128 = 5;
const MAX_ORDERS_EACH: u32 = 10;
const MAX_PER_ORDER: u32 = 1000;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct TicketOrder {
    pub id: U64,
    pub account: AccountId,
    /// true: the account wants to buy and its NEAR is held. false: it sells and its tickets are held.
    pub buying: bool,
    pub amount: u32,
    /// yoctoNEAR for one ticket
    pub price: U128,
}

#[near]
impl Contract {
    /// Put tickets up for sale at a price in NEAR for each.
    pub fn sell_tickets(&mut self, amount: u32, price: U128) -> U64 {
        let seller = env::predecessor_account_id();
        self.hold(&seller, TICKET, amount as u128);
        self.open_order(seller, false, amount, price)
    }

    /// Offer to buy tickets at a price for each. The NEAR for all of them is attached and held.
    #[payable]
    pub fn bid_tickets(&mut self, amount: u32, price: U128) -> U64 {
        require!(env::attached_deposit().as_yoctonear() == price.0 * amount as u128, "Attach exactly the price of all the tickets you ask for");
        self.open_order(env::predecessor_account_id(), true, amount, price)
    }

    /// Take an order down. Tickets go back to the seller; held NEAR can be collected with `claim`.
    pub fn cancel_order(&mut self, order: U64) {
        let o = self.order(order);
        require!(env::predecessor_account_id() == o.account, "That is somebody else's order");
        self.close_order(&o);
        if o.buying { self.owe(&o.account, o.price.0 * o.amount as u128); } else { self.give_back(&o.account, TICKET, o.amount as u128); }
    }

    /// Buy tickets from somebody's sale. Attach exactly their price.
    #[payable]
    pub fn buy_tickets(&mut self, order: U64, amount: u32) {
        let o = self.order(order);
        let buyer = env::predecessor_account_id();
        require!(!o.buying, "That order is an offer to buy: sell into it instead");
        require!(buyer != o.account, "That is your own sale");
        require!(amount >= 1 && amount <= o.amount, "Not that many are left in this sale");
        let total = o.price.0 * amount as u128;
        require!(env::attached_deposit().as_yoctonear() == total, "Attach exactly the price of the tickets");
        self.settle_sale(&o.account, &buyer, amount, total, true);
        self.shrink_order(o, amount);
    }

    /// Sell tickets into somebody's offer. The NEAR held for it becomes the seller's to collect.
    pub fn fill_bid(&mut self, order: U64, amount: u32) {
        let o = self.order(order);
        let seller = env::predecessor_account_id();
        require!(o.buying, "That order is a sale: buy from it instead");
        require!(seller != o.account, "That is your own offer");
        require!(amount >= 1 && amount <= o.amount, "The offer does not want that many");
        self.hold(&seller, TICKET, amount as u128);
        self.settle_sale(&seller, &o.account, amount, o.price.0 * amount as u128, false);
        self.shrink_order(o, amount);
    }

    /// The orders that are open, oldest first.
    pub fn ticket_orders(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<TicketOrder> {
        self.ticket_orders.values().skip(from_index.unwrap_or(0) as usize).take(limit.unwrap_or(50).min(100) as usize).cloned().collect()
    }

    /// NEAR an account can collect with `claim`, in yoctoNEAR.
    pub fn owed(&self, account_id: AccountId) -> U128 {
        U128(self.owed.get(&account_id).copied().unwrap_or(0))
    }
}

impl Contract {
    fn order(&self, id: U64) -> TicketOrder {
        self.ticket_orders.get(&id.0).cloned().unwrap_or_else(|| env::panic_str("That order is gone"))
    }
    fn open_order(&mut self, account: AccountId, buying: bool, amount: u32, price: U128) -> U64 {
        require!((1..=MAX_PER_ORDER).contains(&amount), "Between 1 and 1000 tickets in one order");
        require!(price.0 >= LOWEST_TICKET_PRICE, "A ticket costs at least 0.0001 NEAR");
        let mine = self.orders_of.get(&account).copied().unwrap_or(0);
        require!(mine < MAX_ORDERS_EACH, "You already have 10 orders open");
        self.orders_of.insert(account.clone(), mine + 1);
        let id = self.next_listing;
        self.next_listing += 1;
        self.ticket_orders.insert(id, TicketOrder { id: U64(id), account, buying, amount, price });
        U64(id)
    }
    fn close_order(&mut self, o: &TicketOrder) {
        self.ticket_orders.remove(&o.id.0);
        let mine = self.orders_of.get(&o.account).copied().unwrap_or(1);
        self.orders_of.insert(o.account.clone(), mine - 1);
    }
    fn shrink_order(&mut self, mut o: TicketOrder, by: u32) {
        o.amount -= by;
        if o.amount == 0 { self.close_order(&o); } else { self.ticket_orders.insert(o.id.0, o); }
    }
    /// Held tickets go to the buyer; the NEAR goes to the seller to collect, minus the fee for the prize.
    /// `buyer_acted`: the buyer took a sale (true), or the seller sold into an offer (false).
    fn settle_sale(&mut self, seller: &AccountId, buyer: &AccountId, amount: u32, total: u128, buyer_acted: bool) {
        let fee = (total * FEE_PERCENT).div_ceil(100);
        self.start_day();
        self.vault += fee;
        self.owe(seller, total - fee);
        self.deliver(seller, buyer, TICKET, amount as u128);
        self.happened(seller, "ticket_sold", TICKET, amount, total - fee, !buyer_acted);
        self.happened(buyer, "ticket_bought", TICKET, amount, total, buyer_acted);
        self.traded(seller, buyer, amount, total / amount as u128);
    }
}
