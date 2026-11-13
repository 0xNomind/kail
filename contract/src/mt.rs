//! The token side of the contract, in the shape of NEP-245 (multi token):
//! https://github.com/near/NEPs/blob/master/neps/nep-0245.md
//!
//! One contract, many kinds of token; an account holds an amount of each kind.
//!
//! What is here: the balances, minting, burning and moving (used by the game's rules), the standard's
//! read-only methods, its events, its plain transfers, its metadata (a name and a description for every
//! kind) and its lists (every kind; the kinds an account holds).
//! What is not here: `mt_transfer_call` / `mt_batch_transfer_call` (handing tokens to another contract)
//! and approvals.
//!
//! Only tickets may be sent to another account. Coins, bait, fish and chest finds stay with their holder:
//! they change hands through the game's own market only, so nothing can be passed around for free.
use near_sdk::json_types::U128;
use near_sdk::serde_json::{Value, json};
use near_sdk::{AccountId, assert_one_yocto, env, near, require};

use crate::{BAIT, CHEST, COIN, Contract, ContractExt, DEEP, PRIZE_FISH, TICKET, TokenId, UPPER, game, is_item};

/// The standard's description of a token. A kind that many accounts hold has no single owner.
#[near(serializers = [json])]
pub struct Token {
    pub token_id: TokenId,
    pub owner_id: Option<AccountId>,
    pub token_metadata: Option<TokenMetadata>,
    /// Every kind is its own class: this is the kind's id again.
    pub base_metadata_id: String,
}

/// The standard's metadata (NEP-245, Metadata): for the contract, for a class of tokens, for a token.
#[near(serializers = [json])]
pub struct ContractMetadata {
    pub spec: String,
    pub name: String,
}
#[near(serializers = [json])]
pub struct BaseTokenMetadata {
    pub name: String,
    pub id: String,
    pub symbol: Option<String>,
    pub icon: Option<String>,
    pub decimals: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub copies: Option<u64>,
    pub reference_hash: Option<String>,
}
#[near(serializers = [json])]
pub struct TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<String>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}
#[near(serializers = [json])]
pub struct TokenMetadataAll {
    pub base: BaseTokenMetadata,
    pub token: TokenMetadata,
}

/// Every kind of token, in the order the lists give them: the three of the game's economy, then the fish
/// from the top of the sea down, then what a chest holds.
pub(crate) fn kinds() -> Vec<&'static str> {
    let mut all = vec![COIN, BAIT, TICKET];
    all.extend(UPPER);
    all.extend(DEEP);
    all.push(PRIZE_FISH);
    all.extend(CHEST.iter().map(|(id, _)| *id));
    all
}
/// A kind's name as the game shows it, what it is in a sentence, and what sort of thing it is.
fn about(id: &str) -> (String, &'static str, &'static str) {
    let name = match id {
        "goldbar" => "Gold bar".to_string(),
        "crown" => "Old crown".to_string(),
        _ => id[..1].to_uppercase() + &id[1..],
    };
    let (words, sort) = match id {
        COIN => ("The game's money. Bought with NEAR at the day's price; pays for bait, upgrades and things on the market. Stays with its holder.", "coin"),
        BAIT => ("One bait is one throw of the hook. Bought for 2 coins. Stays with its holder.", "bait"),
        TICKET => ("Earned by finishing the day's quest. Goes into a daily draw for NEAR, or is sold to another player for NEAR. Can be sent to another account.", "ticket"),
        PRIZE_FISH => ("A rare fish of the deepest water. No quest asks for it; it is traded for coins on the game's market.", "fish"),
        _ if UPPER.contains(&id) => ("A fish of the upper water. Caught with the hook, asked for by some days' quest, traded for coins on the game's market.", "fish"),
        _ if DEEP.contains(&id) => ("A big fish of the deep water. Caught with the hook, asked for by some days' quest, traded for coins on the game's market.", "fish"),
        _ => ("Found in a chest on the sea floor. A day's quest asks for one chest find; traded for coins on the game's market.", "chest find"),
    };
    (name, words, sort)
}
fn base_metadata(id: &str) -> BaseTokenMetadata {
    require!(exists(id), "No such kind of token");
    BaseTokenMetadata {
        name: about(id).0,
        id: id.to_string(),
        symbol: Some(id.to_uppercase()),
        icon: None,
        // every kind is counted in whole pieces
        decimals: Some("0".to_string()),
        base_uri: None,
        reference: None,
        copies: None,
        reference_hash: None,
    }
}
fn token_metadata(id: &str) -> TokenMetadata {
    require!(exists(id), "No such kind of token");
    let (name, words, sort) = about(id);
    TokenMetadata {
        title: Some(name),
        description: Some(words.to_string()),
        media: None,
        media_hash: None,
        issued_at: None,
        expires_at: None,
        starts_at: None,
        updated_at: None,
        extra: Some(json!({ "sort": sort, "can_be_sent": can_be_sent(id) }).to_string()),
        reference: None,
        reference_hash: None,
    }
}
fn token(id: &str) -> Token {
    Token { token_id: id.to_string(), owner_id: None, token_metadata: Some(token_metadata(id)), base_metadata_id: id.to_string() }
}
/// A part of a list, as the standard's lists are asked for: from this place on, at most so many.
fn part<T>(all: Vec<T>, from_index: Option<U128>, limit: Option<u64>) -> Vec<T> {
    let from = from_index.map_or(0, |f| f.0.min(all.len() as u128) as usize);
    all.into_iter().skip(from).take(limit.map_or(usize::MAX, |l| l as usize)).collect()
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
    /// What the contract holds of a kind for the open orders on both markets: the things and tickets put up
    /// for sale, and the coins behind offers to buy. Counted from the orders themselves.
    pub(crate) fn held(&self, id: &str) -> u128 {
        let things: u128 = self
            .listings
            .values()
            .map(|o| match (o.buying, id) {
                (false, _) if o.token_id == id => o.amount as u128,
                (true, COIN) => o.price.0 * o.amount as u128,
                _ => 0,
            })
            .sum();
        let tickets: u128 = if id == TICKET { self.ticket_orders.values().filter(|o| !o.buying).map(|o| o.amount as u128).sum() } else { 0 };
        things + tickets
    }
    /// An account's balance as the standard's methods give it. For the contract's own account that is what
    /// it holds for open orders (the events say those tokens moved to it), plus anything sent to it.
    fn shown(&self, owner: &AccountId, id: &str) -> u128 {
        self.balance(owner, id) + if *owner == env::current_account_id() { self.held(id) } else { 0 }
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
        token_ids.into_iter().map(|id| exists(&id).then(|| token(&id))).collect()
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: TokenId) -> U128 {
        U128(self.shown(&account_id, &token_id))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<TokenId>) -> Vec<U128> {
        token_ids.iter().map(|id| U128(self.shown(&account_id, id))).collect()
    }

    /// How many of this kind exist, or nothing if there is no such kind.
    pub fn mt_supply(&self, token_id: TokenId) -> Option<U128> {
        exists(&token_id).then(|| U128(self.supply.get(&token_id).copied().unwrap_or(0)))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<TokenId>) -> Vec<Option<U128>> {
        token_ids.into_iter().map(|id| self.mt_supply(id)).collect()
    }

    // ---- the standard's metadata: what each kind is called and what it is

    pub fn mt_metadata_contract(&self) -> ContractMetadata {
        ContractMetadata { spec: "mt-1.0.0".to_string(), name: "Kail".to_string() }
    }

    pub fn mt_metadata_token_all(&self, token_ids: Vec<TokenId>) -> Vec<TokenMetadataAll> {
        token_ids.iter().map(|id| TokenMetadataAll { base: base_metadata(id), token: token_metadata(id) }).collect()
    }

    pub fn mt_metadata_token_by_token_id(&self, token_ids: Vec<TokenId>) -> Vec<TokenMetadata> {
        token_ids.iter().map(|id| token_metadata(id)).collect()
    }

    pub fn mt_metadata_base_by_token_id(&self, token_ids: Vec<TokenId>) -> Vec<BaseTokenMetadata> {
        token_ids.iter().map(|id| base_metadata(id)).collect()
    }

    /// (Every kind is its own class, so a class's id is the kind's id.)
    pub fn mt_metadata_base_by_metadata_id(&self, base_metadata_ids: Vec<String>) -> Vec<BaseTokenMetadata> {
        base_metadata_ids.iter().map(|id| base_metadata(id)).collect()
    }

    // ---- the standard's lists

    /// Every kind of token there is.
    pub fn mt_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        part(kinds(), from_index, limit).into_iter().map(token).collect()
    }

    /// The kinds an account holds some of.
    pub fn mt_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let held: Vec<&str> = kinds().into_iter().filter(|id| self.shown(&account_id, id) > 0).collect();
        part(held, from_index, limit).into_iter().map(token).collect()
    }

    pub fn mt_tokens_base_metadata_all(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<BaseTokenMetadata> {
        part(kinds(), from_index, limit).into_iter().map(base_metadata).collect()
    }
}
