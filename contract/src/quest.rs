//! The daily quest: one a day, the same for everybody. It asks for three kinds of things: a fish from the
//! upper water, a big fish from the deep, and something out of a chest. Handing them in pays a ticket.
//! Only so many tickets are handed out in a day, for all players together: first come, first served.
//! It can be done again while tickets are left.
//!
//! The biggest quest asks for 9 things. The first storage holds 16, so every quest fits with room to spare.
use near_sdk::json_types::U128;
use near_sdk::{env, near, require};

use crate::{CHEST, Contract, ContractExt, DEEP, TICKET, UPPER};

/// How many throws an average player needs for one of each thing, times 10 (measured in the game's tests).
fn effort10(id: &str) -> u32 {
    match id {
        "anchovy" => 21, "mackerel" => 22, "clownfish" => 27, "snapper" => 17, "milkfish" => 17, "grouper" => 19,
        "barracuda" => 31, "tuna" => 31, "shark" => 30, "pearl" => 71, "goldbar" => 71, "crown" => 71,
        _ => env::panic_str("No effort known for that"),
    }
}
/// A ticket is sized for about this many throws.
const BUDGET10: u32 = 240;
/// The upper fish gets 53% of the throws left after the chest find, the deep fish 47%.
const SHARE: [u32; 2] = [53, 47];

/// The quest of a day: what it asks for and how many tickets it pays. The three chest finds are equally
/// likely, so every day's quest is about the same size and pays one ticket.
pub fn quest_of(day: u64) -> ([(&'static str, u32); 3], u32) {
    let h = env::sha256(format!("kail quest {day}").as_bytes());
    let upper = UPPER[h[0] as usize % UPPER.len()];
    let deep = DEEP[h[1] as usize % DEEP.len()];
    let chest = CHEST[h[2] as usize % CHEST.len()].0;
    let tickets = 1;
    let left = BUDGET10 * tickets - effort10(chest);
    // rounded to the nearest whole fish, and never less than one
    let n = |id: &str, share: u32| (((2 * left * share) + effort10(id) * 100) / (2 * effort10(id) * 100)).max(1);
    ([(upper, n(upper, SHARE[0])), (deep, n(deep, SHARE[1])), (chest, 1)], tickets)
}

#[near(serializers = [json])]
pub struct QuestView {
    pub day: u64,
    /// [kind, amount]
    pub needs: Vec<(String, u32)>,
    pub tickets: u32,
    /// tickets for everybody today, and how many are left
    pub stock: u32,
    pub left: u32,
    pub ends_in_ms: u64,
}

#[near]
impl Contract {
    pub fn quest(&self) -> QuestView {
        let now = Self::now_ms();
        let day = now / self.day_ms;
        let (needs, tickets) = quest_of(day);
        QuestView {
            day,
            needs: needs.iter().map(|(id, n)| (id.to_string(), *n)).collect(),
            tickets,
            stock: self.quest_stock,
            left: self.quest_stock.saturating_sub(self.quest_given.get(&day).copied().unwrap_or(0)),
            ends_in_ms: self.day_ms - now % self.day_ms,
        }
    }

    /// Hand in everything today's quest asks for, at once: all of it or nothing. The things are gone and the
    /// tickets come back in the same step, so nobody can lose a catch to a quest that then pays nothing.
    pub fn hand_in(&mut self) -> U128 {
        let player = env::predecessor_account_id();
        let day = Self::now_ms() / self.day_ms;
        let (needs, tickets) = quest_of(day);
        let given = self.quest_given.get(&day).copied().unwrap_or(0);
        // a stock of 0 means no limit: everybody who finishes the quest gets the ticket
        require!(self.quest_stock == 0 || given + tickets <= self.quest_stock, "All tickets are gone for today");
        self.quest_given.insert(day, given + tickets);

        let list: Vec<(&str, u128)> = needs.iter().map(|(id, n)| (*id, *n as u128)).collect();
        self.burn(&player, &list, Some("quest"));
        self.mint(&player, &[(TICKET, tickets as u128)], Some("quest"));
        self.happened(&player, "quest", TICKET, tickets, 0, true);
        U128(tickets as u128)
    }
}
