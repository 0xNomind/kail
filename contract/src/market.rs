//! The market inside the game: players trade fish and chest finds with each other, for coins.
//! A seller puts things up at a price; a buyer can also post an offer ("I pay this much for a shark").
//! Things for sale and coins for offers are held by the contract until the order is filled or taken down.
//! Storage is settled up front: a buyer needs the room when buying, and an offer to buy sets its room aside
//! when it is posted. So a sale never fails halfway because a storage turned out to be full.
//! This market is the only way a fish or a chest find changes hands, and no sale is free:
//! 5% of every sale is burned, rounded up, so at least 1 coin.
//!
//! The fee is paid by whoever acts on an order, because that is who decides how many to take at a time:
//! a buyer taking from a sale pays the price plus the fee, and a seller selling into an offer gets the price
//! minus the fee. Whoever posted the order always gets exactly the price they named.
use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, env, near, require};

use crate::{COIN, Contract, ContractExt, is_item};

const FEE_PERCENT: u128 = 5;
const MAX_ORDERS_EACH: u32 = 5;
const MAX_PER_ORDER: u32 = 10;
/// The lowest price for one thing. With it, a seller always gets at least 1 coin after the fee.
const MIN_PRICE: u128 = 2;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct ItemOrder {
    pub id: U64,
    pub account: AccountId,
    /// true: the account wants to buy and its coins are held. false: it sells and its things are held.
    pub buying: bool,
    pub token_id: String,
    pub amount: u32,
    /// coins for one
    pub price: U128,
}

/// What a sale comes to, in coins.
#[near(serializers = [json])]
pub struct ItemQuote {
    pub fee: U128,
    pub buyer_pays: U128,
    pub seller_gets: U128,
}

#[near]
impl Contract {
    /// Put fish or chest finds up for sale at a price for each. They keep their place in the seller's storage
    /// until they are sold.
    pub fn list_item(&mut self, token_id: String, amount: u32, price: U128) -> U64 {
        let seller = env::predecessor_account_id();
        let id = self.open_item_order(seller.clone(), false, &token_id, amount, price);
        self.hold(&seller, &token_id, amount as u128);
        id
    }

    /// Offer to buy fish or chest finds at a price for each. The coins for all of them are held, and room for
    /// all of them is set aside in the buyer's storage: without the room the offer cannot be posted.
    pub fn want_item(&mut self, token_id: String, amount: u32, price: U128) -> U64 {
        let buyer = env::predecessor_account_id();
        let id = self.open_item_order(buyer.clone(), true, &token_id, amount, price);
        self.hold(&buyer, COIN, price.0 * amount as u128);
        self.take_room(&buyer, &token_id, amount as u128);
        id
    }

    /// Take an order down. What is left of it goes back: things to the seller, coins to the buyer.
    pub fn cancel_item_order(&mut self, order: U64) {
        let o = self.item_order(order);
        require!(env::predecessor_account_id() == o.account, "That is somebody else's order");
        self.close_item_order(&o);
        if o.buying {
            self.give_back(&o.account, COIN, o.price.0 * o.amount as u128);
            self.free_room(&o.account, &o.token_id, o.amount as u128);
        } else {
            self.give_back(&o.account, &o.token_id, o.amount as u128);
        }
    }

    /// Buy from somebody's sale. The buyer pays the price plus the fee; the seller gets the price in full.
    /// If the buyer's storage has no room, nothing happens: no coins are taken.
    pub fn buy_item(&mut self, order: U64, amount: u32) {
        let o = self.item_order(order);
        let buyer = env::predecessor_account_id();
        require!(!o.buying, "That order is an offer to buy: sell into it instead");
        require!(buyer != o.account, "That is your own sale");
        require!(amount >= 1 && amount <= o.amount, "Not that many are left in this sale");
        let total = o.price.0 * amount as u128;
        let fee = (total * FEE_PERCENT).div_ceil(100);
        self.burn(&buyer, &[(COIN, fee)], Some("market fee"));
        self.pass(&buyer, &o.account, &[(COIN, total)], Some("sale"));
        self.deliver(&o.account, &buyer, &o.token_id, amount as u128);
        self.happened(&buyer, "bought", &o.token_id, amount, total + fee, true);
        self.happened(&o.account, "sold", &o.token_id, amount, total, false);
        self.shrink_item_order(o, amount);
    }

    /// Sell into somebody's offer. The things go to the buyer's storage; the seller gets the held coins minus
    /// the fee. The buyer has paid exactly the price they offered.
    pub fn sell_item(&mut self, order: U64, amount: u32) {
        let o = self.item_order(order);
        let seller = env::predecessor_account_id();
        require!(o.buying, "That order is a sale: buy from it instead");
        require!(seller != o.account, "That is your own offer");
        require!(amount >= 1 && amount <= o.amount, "The offer does not want that many");
        let total = o.price.0 * amount as u128;
        let fee = (total * FEE_PERCENT).div_ceil(100);
        self.hand_over(&seller, &o.account, &o.token_id, amount as u128);
        self.burn_held(COIN, fee, "market fee");
        if total > fee {
            self.pay_out(&seller, COIN, total - fee, "sale");
        }
        self.happened(&seller, "sold", &o.token_id, amount, total - fee, true);
        self.happened(&o.account, "bought", &o.token_id, amount, total, false);
        self.shrink_item_order(o, amount);
    }

    /// What taking this many from an order comes to, before anybody commits: the game shows these numbers
    /// and asks the player to confirm.
    pub fn item_quote(&self, order: U64, amount: u32) -> ItemQuote {
        let o = self.item_order(order);
        require!(amount >= 1 && amount <= o.amount, "The order does not hold that many");
        let total = o.price.0 * amount as u128;
        let fee = (total * FEE_PERCENT).div_ceil(100);
        ItemQuote {
            fee: U128(fee),
            buyer_pays: U128(if o.buying { total } else { total + fee }),
            seller_gets: U128(if o.buying { total - fee } else { total }),
        }
    }

    /// The open orders, oldest first.
    pub fn item_orders(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<ItemOrder> {
        self.listings.values().skip(from_index.unwrap_or(0) as usize).take(limit.unwrap_or(50).min(100) as usize).cloned().collect()
    }
}

impl Contract {
    fn item_order(&self, id: U64) -> ItemOrder {
        self.listings.get(&id.0).cloned().unwrap_or_else(|| env::panic_str("That order is gone"))
    }
    fn open_item_order(&mut self, account: AccountId, buying: bool, token_id: &str, amount: u32, price: U128) -> U64 {
        require!(is_item(token_id), "Only fish and chest finds are traded here");
        require!((1..=MAX_PER_ORDER).contains(&amount), "Between 1 and 10 in one order");
        require!(price.0 >= MIN_PRICE && price.0 <= 1_000_000, "Name a price of at least 2 coins");
        let mine = self.listings_of.get(&account).copied().unwrap_or(0);
        require!(mine < MAX_ORDERS_EACH, "You already have 5 orders open");
        self.listings_of.insert(account.clone(), mine + 1);
        let id = self.next_listing;
        self.next_listing += 1;
        self.listings.insert(id, ItemOrder { id: U64(id), account, buying, token_id: token_id.to_string(), amount, price });
        U64(id)
    }
    fn close_item_order(&mut self, o: &ItemOrder) {
        self.listings.remove(&o.id.0);
        let mine = self.listings_of.get(&o.account).copied().unwrap_or(1);
        self.listings_of.insert(o.account.clone(), mine - 1);
    }
    fn shrink_item_order(&mut self, mut o: ItemOrder, by: u32) {
        o.amount -= by;
        if o.amount == 0 { self.close_item_order(&o); } else { self.listings.insert(o.id.0, o); }
    }
}
