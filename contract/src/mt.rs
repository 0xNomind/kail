//! The token side of the contract, in the shape of NEP-245 (multi token):
//! https://github.com/near/NEPs/blob/master/neps/nep-0245.md
//!
//! One contract, many kinds of token; an account holds an amount of each kind.
//!
//! What is here: the balances, minting, burning and moving (used by the game's rules), the standard's
//! read-only methods, its events, and its plain transfers.
//! What is not here yet: `mt_transfer_call` / `mt_batch_transfer_call` (handing tokens to another contract)
//! and approvals.
//!
//! Only tickets may be sent to another account. Coins, bait, fish and chest finds stay with their holder:
//! they change hands through the game's own market only, so nothing can be passed around for free.
use near_sdk::json_types::U128;
use near_sdk::serde_json::{Value, json};
use near_sdk::{AccountId, assert_one_yocto, env, near, require};

use crate::{BAIT, COIN, Contract, ContractExt, TICKET, TokenId, game, is_item};

/// The standard's description of a token. A kind that many accounts hold has no single owner.
#[near(serializers = [json])]
pub struct Token {
    pub token_id: TokenId,
    pub owner_id: Option<AccountId>,
}

/// The kinds of token this contract knows.
pub(crate) fn exists(id: &str) -> bool {
    matches!(id, COIN | BAIT | TICKET) || is_item(id)
}
/// May a holder send this kind to another account? Only tickets.
fn can_be_sent(id: &str) -> bool {
    id == TICKET
}

fn event(name: &str, mut data: Value, memo: Option<&str>) {
    if let Some(m) = memo {
        data["memo"] = json!(m);
    }
    env::log_str(&format!("EVENT_JSON:{}", json!({ "standard": "nep245", "version": "1.0.0", "event": name, "data": [data] })));
}
fn ids(list: &[(&str, u128)]) -> Vec<String> {
    list.iter().map(|(id, _)| id.to_string()).collect()
}
fn amounts(list: &[(&str, u128)]) -> Vec<String> {
    list.iter().map(|(_, n)| n.to_string()).collect()
}

// ---- used by the game's rules
impl Contract {
    pub(crate) fn balance(&self, owner: &AccountId, id: &str) -> u128 {
        self.balances.get(&(owner.clone(), id.to_string())).copied().unwrap_or(0)
    }
    /// Fish and chest finds take room in storage, whether they sit there or are up for sale.
    pub(crate) fn take_room(&mut self, owner: &AccountId, id: &str, n: u128) {
        if !is_item(id) { return; }
        let mut p = self.profile(owner);
        p.held += n as u32;
        require!(p.held <= game::storage_cap(p.storage), "Storage is full");
        self.profiles.insert(owner.clone(), p);
    }
    pub(crate) fn free_room(&mut self, owner: &AccountId, id: &str, n: u128) {
        if !is_item(id) { return; }
        let mut p = self.profile(owner);
        p.held -= n as u32;
        self.profiles.insert(owner.clone(), p);
    }
    fn add_balance(&mut self, owner: &AccountId, id: &str, n: u128) {
        require!(exists(id), "No such kind of token");
        self.balances.insert((owner.clone(), id.to_string()), self.balance(owner, id) + n);
    }
    fn sub_balance(&mut self, owner: &AccountId, id: &str, n: u128) {
        let have = self.balance(owner, id);
        require!(have >= n, format!("Not enough {id}: you have {have}, this needs {n}"));
        let key = (owner.clone(), id.to_string());
        // an empty balance is taken out again, so it stops costing storage
        if have == n { self.balances.remove(&key); } else { self.balances.insert(key, have - n); }
    }
    /// Give an account more of a kind. Fish and chest finds need room in the account's storage.
    fn add(&mut self, owner: &AccountId, id: &str, n: u128) {
        self.take_room(owner, id, n);
        self.add_balance(owner, id, n);
    }
    /// Take some of a kind from an account. Fails if the account holds too few.
    fn sub(&mut self, owner: &AccountId, id: &str, n: u128) {
        self.sub_balance(owner, id, n);
        self.free_room(owner, id, n);
    }
    fn change_supply(&mut self, id: &str, by: i128) {
        let now = self.supply.get(id).copied().unwrap_or(0);
        self.supply.insert(id.to_string(), now.checked_add_signed(by).expect("supply out of range"));
    }

    /// Create tokens for an account.
    pub(crate) fn mint(&mut self, owner: &AccountId, list: &[(&str, u128)], memo: Option<&str>) {
        for &(id, n) in list {
            self.add(owner, id, n);
            self.change_supply(id, n as i128);
        }
        event("mt_mint", json!({ "owner_id": owner, "token_ids": ids(list), "amounts": amounts(list) }), memo);
    }

    /// Destroy tokens of an account.
    pub(crate) fn burn(&mut self, owner: &AccountId, list: &[(&str, u128)], memo: Option<&str>) {
        for &(id, n) in list {
            self.sub(owner, id, n);
            self.change_supply(id, -(n as i128));
        }
        event("mt_burn", json!({ "owner_id": owner, "token_ids": ids(list), "amounts": amounts(list) }), memo);
    }

    /// Move tokens from one account to another, as one of the game's own rules (a sale on the market).
    pub(crate) fn pass(&mut self, from: &AccountId, to: &AccountId, list: &[(&str, u128)], memo: Option<&str>) {
        for &(id, n) in list {
            self.sub(from, id, n);
            self.add(to, id, n);
        }
        event("mt_transfer", json!({ "old_owner_id": from, "new_owner_id": to, "token_ids": ids(list), "amounts": amounts(list) }), memo);
    }

    /// Things put up for sale are held by the contract until sold or taken back. They still exist, and they
    /// keep taking room in the seller's storage: a listing is not a second storage.
    pub(crate) fn hold(&mut self, seller: &AccountId, id: &str, n: u128) {
        self.sub_balance(seller, id, n);
        event("mt_transfer", json!({ "old_owner_id": seller, "new_owner_id": env::current_account_id(), "token_ids": [id], "amounts": [n.to_string()] }), Some("listed"));
    }
    /// A sale into an offer to buy: the things go from the seller to the buyer, whose storage already has
    /// the room set aside for them.
    pub(crate) fn hand_over(&mut self, seller: &AccountId, buyer: &AccountId, id: &str, n: u128) {
        self.sub(seller, id, n);
        self.add_balance(buyer, id, n);
        event("mt_transfer", json!({ "old_owner_id": seller, "new_owner_id": buyer, "token_ids": [id], "amounts": [n.to_string()] }), Some("sale"));
    }
    /// Held coins leave the contract: burned as a fee, or paid to the seller.
    pub(crate) fn burn_held(&mut self, id: &str, n: u128, memo: &str) {
        self.change_supply(id, -(n as i128));
        event("mt_burn", json!({ "owner_id": env::current_account_id(), "token_ids": [id], "amounts": [n.to_string()] }), Some(memo));
    }
    pub(crate) fn pay_out(&mut self, to: &AccountId, id: &str, n: u128, memo: &str) {
        self.add_balance(to, id, n);
        event("mt_transfer", json!({ "old_owner_id": env::current_account_id(), "new_owner_id": to, "token_ids": [id], "amounts": [n.to_string()] }), Some(memo));
    }
    pub(crate) fn give_back(&mut self, seller: &AccountId, id: &str, n: u128) {
        self.add_balance(seller, id, n);
        event("mt_transfer", json!({ "old_owner_id": env::current_account_id(), "new_owner_id": seller, "token_ids": [id], "amounts": [n.to_string()] }), Some("taken back"));
    }
    /// A sale: the held things go to the buyer, and the room they took in the seller's storage is free again.
    pub(crate) fn deliver(&mut self, seller: &AccountId, buyer: &AccountId, id: &str, n: u128) {
        self.free_room(seller, id, n);
        self.add(buyer, id, n);
        event("mt_transfer", json!({ "old_owner_id": env::current_account_id(), "new_owner_id": buyer, "token_ids": [id], "amounts": [n.to_string()] }), Some("bought"));
    }

    /// A holder sends tokens to another account (the standard's transfer).
    fn send(&mut self, from: &AccountId, to: &AccountId, list: &[(&str, u128)], memo: Option<&str>) {
        require!(from != to, "Sender and receiver are the same account");
        for &(id, n) in list {
            // (sending nothing would still write a row for the receiver, at the contract's cost)
            require!(n > 0, "Send at least one");
            require!(exists(id), "No such kind of token");
            require!(can_be_sent(id), format!("{id} cannot be sent to another account: it stays with its holder"));
        }
        self.pass(from, to, list, memo);
    }
}

// ---- the standard's own methods
#[near]
impl Contract {
    /// Send some of one kind of token to another account. Needs 1 yoctoNEAR attached, as the standard asks:
    /// that makes the wallet confirm it with the player.
    #[payable]
    pub fn mt_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, amount: U128, approval: Option<(AccountId, u64)>, memo: Option<String>) {
        assert_one_yocto();
        require!(approval.is_none(), "Approvals are not supported");
        let from = env::predecessor_account_id();
        self.send(&from, &receiver_id, &[(token_id.as_str(), amount.0)], memo.as_deref());
    }

    /// The same for several kinds at once.
    #[payable]
    pub fn mt_batch_transfer(&mut self, receiver_id: AccountId, token_ids: Vec<TokenId>, amounts: Vec<U128>, approvals: Option<Vec<Option<(AccountId, u64)>>>, memo: Option<String>) {
        assert_one_yocto();
        require!(approvals.is_none(), "Approvals are not supported");
        require!(token_ids.len() == amounts.len(), "token_ids and amounts must have the same length");
        require!(!token_ids.is_empty(), "Nothing to send");
        let from = env::predecessor_account_id();
        let list: Vec<(&str, u128)> = token_ids.iter().map(String::as_str).zip(amounts.iter().map(|a| a.0)).collect();
        self.send(&from, &receiver_id, &list, memo.as_deref());
    }

    pub fn mt_token(&self, token_ids: Vec<TokenId>) -> Vec<Option<Token>> {
        token_ids.into_iter().map(|id| exists(&id).then_some(Token { token_id: id, owner_id: None })).collect()
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: TokenId) -> U128 {
        U128(self.balance(&account_id, &token_id))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<TokenId>) -> Vec<U128> {
        token_ids.iter().map(|id| U128(self.balance(&account_id, id))).collect()
    }

    /// How many of this kind exist, or nothing if there is no such kind.
    pub fn mt_supply(&self, token_id: TokenId) -> Option<U128> {
        exists(&token_id).then(|| U128(self.supply.get(&token_id).copied().unwrap_or(0)))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<TokenId>) -> Vec<Option<U128>> {
        token_ids.into_iter().map(|id| self.mt_supply(id)).collect()
    }
}
