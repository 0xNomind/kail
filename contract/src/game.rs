//! Fishing: a cast spends one bait, and the game's server says what came up.
//! Also the storage (how many fish and chest finds fit) and the two upgrades.
use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::{AccountId, env, near, require};

use crate::{BAIT, CHEST, COIN, Contract, ContractExt, is_fish};

/// How many fish and chest finds fit, by storage level. The first one holds the biggest daily quest (14
/// things) with a little to spare.
const STORAGE_CAP: [u32; 5] = [16, 24, 36, 50, 70];
/// What the next level costs, in coins.
const STORAGE_COST: [u128; 4] = [30, 70, 150, 300];
const REEL_COST: [u128; 4] = [40, 90, 200, 400];
/// In the game a chest takes at least this long to come back after it was brought up. The chain holds every
/// player to it, so nobody can claim a chest with every cast.
const CHEST_EVERY_MS: u64 = 20_000;
/// Bait a new player is welcomed with.
const WELCOME_BAIT: u128 = 5;
const GREETER: &[u8] = b"greeter";
fn the_greeter() -> Option<AccountId> {
    env::storage_read(GREETER).and_then(|b| String::from_utf8(b).ok()).and_then(|s| s.parse().ok())
}

/// The public key the game's server signs its approvals of catches with (ed25519, 32 bytes), named by the owner.
const SERVER_KEY: &[u8] = b"server_key";
fn the_server_key() -> Option<[u8; 32]> {
    env::storage_read(SERVER_KEY).and_then(|b| b.try_into().ok())
}
/// What the server signs to approve one catch: this contract, the player, the cast, what came up, and the
/// mark of the player's sea after it. Signed for one cast of one player, it is of no use for anything else.
pub fn approval_text(contract: &AccountId, player: &AccountId, cast: u64, what: &str, sea: &str) -> String {
    format!("kail land|{contract}|{player}|{cast}|{what}|{sea}")
}

fn sea_key(player: &AccountId) -> Vec<u8> {
    format!("sea:{player}").into_bytes()
}
/// The mark of a player's sea, as the server left it with their last catch.
pub fn sea_of(player: &AccountId) -> Option<String> {
    env::storage_read(&sea_key(player)).and_then(|b| String::from_utf8(b).ok())
}

pub fn storage_cap(level: u8) -> u32 {
    STORAGE_CAP[level as usize]
}

#[near]
impl Contract {
    /// Throw the hook: one bait is spent. Gives the number of this cast; a new cast replaces an old one
    /// that never came up with anything. Refused when the storage has no room for a catch.
    /// `seal` is the SHA-256 of a secret the player's game made up for this cast. Whoever lands the cast
    /// has to show that secret, so nobody but the player who cast can have it landed.
    pub fn cast(&mut self, seal: Base64VecU8) -> U64 {
        require!(seal.0.len() == 32, "The seal is a SHA-256 hash: 32 bytes");
        let player = env::predecessor_account_id();
        let mut p = self.profile(&player);
        // with no room for a catch the cast is refused before the bait is spent
        require!(p.held < storage_cap(p.storage), "Your storage is full: sell, throw back or upgrade before casting");
        self.burn(&player, &[(BAIT, 1)], Some("cast"));
        p.casts += 1;
        p.cast_at = Self::now_ms().max(1);
        p.seal = seal.0;
        self.profiles.insert(player, p.clone());
        U64(p.casts)
    }

    /// The game's server says what a cast brought up: a kind of fish, or "chest". It needs the cast's secret,
    /// which it can only have from the player who cast.
    /// A chest's content is decided here, by the chain's own randomness, so neither the player nor the
    /// server can pick it. Gives the kind that went into storage, or nothing when the storage was full.
    ///
    /// `sea` is the server's mark for the player's sea as it is after this catch. The server checks a catch by
    /// playing the player's moves again in the sea that belongs to the mark kept here, so a sea from before an
    /// earlier catch (with that fish still in it) can never be used again.
    pub fn land(&mut self, player: Option<AccountId>, cast: U64, what: String, secret: Base64VecU8, sea: Option<String>, approval: Option<Base64VecU8>) -> Option<String> {
        let caller = env::predecessor_account_id();
        let player = if caller == self.minter {
            // the server lands it for the player
            player.unwrap_or_else(|| env::panic_str("Name the player"))
        } else {
            // the player lands it, and pays the network's fee for it: with the server's signature that this
            // catch, of this cast, was really played
            let refused = "Only the game's server can land a catch";
            let key = the_server_key().unwrap_or_else(|| env::panic_str(refused));
            let signature: [u8; 64] = approval.and_then(|a| a.0.try_into().ok()).unwrap_or_else(|| env::panic_str(refused));
            let text = approval_text(&env::current_account_id(), &caller, cast.0, &what, sea.as_deref().unwrap_or(""));
            require!(env::ed25519_verify(&signature, text.as_bytes(), &key), "The game's server did not approve this catch");
            caller
        };
        let mut p = self.profile(&player);
        require!(p.cast_at > 0 && p.casts == cast.0, "That cast is not in the water");
        require!(env::sha256(&secret.0) == p.seal, "That is not the secret of this cast");
        p.cast_at = 0;
        self.profiles.insert(player.clone(), p.clone());
        if let Some(mark) = &sea {
            require!(mark.len() <= 64 && mark.is_ascii(), "That is not a sea mark");
            env::storage_write(&sea_key(&player), mark.as_bytes());
        }

        let kind: &str = if what == "chest" {
            let now = Self::now_ms();
            require!(now >= p.last_chest_at + CHEST_EVERY_MS, "The chest has not come back yet");
            p.last_chest_at = now;
            self.profiles.insert(player.clone(), p.clone());
            self.open_chest(&player, cast.0)
        } else {
            require!(is_fish(&what), "No such fish");
            &what
        };
        if p.held >= storage_cap(p.storage) {
            env::log_str(&format!("Storage full: the {kind} is lost"));
            return None;
        }
        self.mint(&player, &[(kind, 1)], Some("catch"));
        Some(kind.to_string())
    }

    /// A first gift for a new player: 5 bait, once per account, so that somebody who has just signed in can throw
    /// the hook before they have topped up. Only the game's greeter (the account that welcomes players who sign
    /// in with NEAR Auth) or the owner can give it: handing it to every new account would be an invitation to make
    /// accounts by the thousand.
    pub fn welcome(&mut self, player: AccountId) -> bool {
        let caller = env::predecessor_account_id();
        require!(caller == self.owner || Some(caller) == the_greeter(), "Only the game welcomes a player");
        let key = format!("w:{player}").into_bytes();
        if env::storage_has_key(&key) {
            return false;
        }
        env::storage_write(&key, &[1]);
        self.mint(&player, &[(crate::BAIT, WELCOME_BAIT)], Some("welcome"));
        true
    }
    /// Has this account had its welcome gift?
    pub fn welcomed(&self, account_id: AccountId) -> bool {
        env::storage_has_key(&format!("w:{account_id}").into_bytes())
    }
    /// The owner names the account that may welcome players (or nobody).
    pub fn set_greeter(&mut self, account_id: Option<AccountId>) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can change the rules");
        match account_id {
            Some(a) => { env::storage_write(GREETER, a.as_bytes()); }
            None => { env::storage_remove(GREETER); }
        }
    }
    /// The owner names the key the server signs its approvals of catches with (or none: then only the server's
    /// own account can land a catch).
    pub fn set_server_key(&mut self, key: Option<Base64VecU8>) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can change the rules");
        match key {
            Some(k) => {
                require!(k.0.len() == 32, "An ed25519 public key is 32 bytes");
                env::storage_write(SERVER_KEY, &k.0);
            }
            None => { env::storage_remove(SERVER_KEY); }
        }
    }
    pub fn server_key(&self) -> Option<Base64VecU8> {
        the_server_key().map(|k| k.to_vec().into())
    }
    pub fn greeter(&self) -> Option<AccountId> {
        the_greeter()
    }
    /// What a NEAR Auth player pays for having an approval signed. Such a player holds no key: every approval of
    /// theirs is signed by NEAR's MPC network, and somebody has to send that request and pay its fee. The game's
    /// helper (the greeter) sends it. This is how the player pays it back, as one more action in the very
    /// transaction they approved: the NEAR attached here is owed to the greeter, who collects it like any NEAR
    /// owed (`claim`). With no greeter named it goes into the prize vault.
    #[payable]
    pub fn relay_fee(&mut self) {
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid > 0, "Attach the fee");
        match the_greeter() {
            Some(greeter) => self.owe(&greeter, paid),
            None => self.vault += paid,
        }
    }

    /// Throw fish or chest finds back into the sea: they are gone, and their room in storage is free.
    pub fn throw_back(&mut self, token_id: String, amount: u32) {
        require!(crate::is_item(&token_id), "Only fish and chest finds can be thrown back");
        require!(amount >= 1, "Throw back at least one");
        let player = env::predecessor_account_id();
        self.burn(&player, &[(token_id.as_str(), amount as u128)], Some("thrown back"));
    }

    /// Coins buy the next level of the reel ("reel") or of the storage ("storage").
    pub fn upgrade(&mut self, what: String) -> u8 {
        let player = env::predecessor_account_id();
        let mut p = self.profile(&player);
        let (level, costs) = match what.as_str() {
            "reel" => (&mut p.reel, &REEL_COST),
            "storage" => (&mut p.storage, &STORAGE_COST),
            _ => env::panic_str("Upgrade the reel or the storage"),
        };
        require!((*level as usize) < costs.len(), "That is already the best one");
        let cost = costs[*level as usize];
        *level += 1;
        let now = *level;
        self.burn(&player, &[(COIN, cost)], Some("upgrade"));
        // read again: burning does not touch levels, but keep one source of truth for "held"
        let mut fresh = self.profile(&player);
        fresh.reel = p.reel;
        fresh.storage = p.storage;
        self.profiles.insert(player, fresh);
        now
    }
}

impl Contract {
    fn open_chest(&self, player: &AccountId, cast: u64) -> &'static str {
        let mut seed = env::random_seed();
        seed.extend_from_slice(player.as_bytes());
        seed.extend_from_slice(&cast.to_le_bytes());
        let h = env::sha256(&seed);
        let shares: u32 = CHEST.iter().map(|(_, share)| share).sum();
        let mut roll = u32::from_le_bytes([h[0], h[1], h[2], h[3]]) % shares;
        for (kind, odds) in CHEST {
            if roll < odds {
                return kind;
            }
            roll -= odds;
        }
        CHEST[0].0
    }
}
