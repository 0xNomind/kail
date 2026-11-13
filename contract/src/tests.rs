//! Quick tests of the rules, without a chain. `tests/sandbox.rs` runs the same contract on a local chain.
use super::*;
use near_sdk::test_utils::{VMContextBuilder, accounts, get_logs};
use near_sdk::{NearToken, testing_env};

const NEAR: u128 = YOCTO_PER_NEAR;
/// A coin at its lowest price, as it is while the vault is empty.
const YOCTO_PER_COIN: u128 = LOWEST_COIN_PRICE;
const MINUTE: u64 = 60_000;

/// Make the next calls come from account number `who` (0 is the contract and its owner), at time `ms`.
fn at(who: usize, deposit: u128, ms: u64, seed: u8) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(accounts(0))
        .signer_account_id(accounts(who))
        .predecessor_account_id(accounts(who))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(ms * 1_000_000)
        .random_seed([seed; 32]);
    testing_env!(b.build());
}
fn as_player(who: usize, deposit: u128) {
    at(who, deposit, MINUTE, 7);
}
fn fresh() -> Contract {
    as_player(0, 0);
    Contract::new(accounts(0))
}
/// A player who has topped up `near` NEAR and bought `bait` bait.
/// The NEAR all goes into the vault. So that the tests can count coins in small numbers, the player is left
/// with 100 coins for each NEAR, whatever a coin cost that day (the rest is taken away again).
fn funded(c: &mut Contract, who: usize, near: u128, bait: u32) {
    as_player(who, near * NEAR);
    let got = c.top_up().0;
    as_player(who, 0);
    if got > near * 100 {
        c.burn(&accounts(who), &[(COIN, got - near * 100)], None);
        as_player(who, 0);
    }
    if bait > 0 {
        c.buy_bait(bait);
    }
}
/// The secret every test cast is sealed with, and its seal.
fn secret() -> near_sdk::json_types::Base64VecU8 {
    b"a secret only the player knows".to_vec().into()
}
fn seal() -> near_sdk::json_types::Base64VecU8 {
    env::sha256(&secret().0).into()
}
/// Is a cast by `who` refused (and nothing spent)?
fn cast_refused(c: &mut Contract, who: usize) -> bool {
    as_player(who, 0);
    let bait = c.player(accounts(who)).bait;
    let refused = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.cast(seal()))).is_err();
    refused && c.player(accounts(who)).bait == bait
}
/// Lands a catch as whoever is calling now. A fish is in storage at once; for a chest the contract calls itself
/// afterwards to open it, which these tests do in its place: the same moment and the same roll of the chain,
/// the caller being the contract (account 0).
fn land(c: &mut Contract, player: Option<AccountId>, cast: U64, what: &str, secret: near_sdk::json_types::Base64VecU8, sea: Option<String>, approval: Option<near_sdk::json_types::Base64VecU8>) -> Option<String> {
    let caller = env::predecessor_account_id();
    let who = player.clone().unwrap_or_else(|| caller.clone());
    match c.land(player, cast, what.to_string(), secret, sea, approval) {
        near_sdk::PromiseOrValue::Value(v) => v,
        near_sdk::PromiseOrValue::Promise(_) => {
            let (ms, seed): (u64, [u8; 32]) = (env::block_timestamp_ms(), env::random_seed().try_into().unwrap());
            let as_account = |id: AccountId| {
                let mut b = VMContextBuilder::new();
                b.current_account_id(accounts(0)).signer_account_id(id.clone()).predecessor_account_id(id).block_timestamp(ms * 1_000_000).random_seed(seed);
                testing_env!(b.build());
            };
            as_account(accounts(0));
            let found = c.chest_opened(who, cast);
            as_account(caller);
            found
        }
    }
}
/// One throw that brings up `what`.
fn catch(c: &mut Contract, who: usize, what: &str) -> Option<String> {
    as_player(who, 0);
    let cast = c.cast(seal());
    as_player(0, 0);
    land(c, Some(accounts(who)), cast, what, secret(), None, None)
}
fn has(c: &Contract, who: usize, id: &str) -> u128 {
    c.mt_balance_of(accounts(who), id.to_string()).0
}

#[test]
fn a_top_up_buys_coins_at_the_days_price_and_fills_the_vault() {
    let mut c = fresh();
    // an empty vault: a coin is at its lowest price, a hundred-thousandth of a NEAR
    as_player(1, NEAR);
    assert_eq!(c.top_up(), U128(100_000));
    as_player(1, NEAR / 2);
    assert_eq!(c.top_up(), U128(50_000));
    let p = c.player(accounts(1));
    assert_eq!((p.coins, p.topped_up), (U128(150_000), U128(NEAR * 3 / 2)));
    assert_eq!(c.vault(), U128(NEAR * 3 / 2));
    assert_eq!(c.mt_supply(COIN.to_string()), Some(U128(150_000)));
    assert_eq!(c.player(accounts(2)).coins, U128(0));
}

#[test]
fn a_top_up_says_so_in_the_standard_event() {
    let mut c = fresh();
    as_player(1, NEAR);
    c.top_up();
    assert_eq!(get_logs(), vec![r#"EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_mint","data":[{"owner_id":"bob","token_ids":["coin"],"amounts":["100000"],"memo":"top up"}]}"#]);
}

#[test]
#[should_panic(expected = "That is less than the price of one coin today")]
fn a_top_up_of_less_than_one_coin_is_refused() {
    let mut c = fresh();
    as_player(1, YOCTO_PER_COIN - 1);
    c.top_up();
}

#[test]
fn a_top_up_keeps_only_the_price_of_whole_coins() {
    let mut c = fresh();
    // 2.5 coins' worth: two coins are minted, and only their price stays in the vault (the rest is sent back)
    as_player(1, YOCTO_PER_COIN * 5 / 2);
    assert_eq!(c.top_up(), U128(2));
    assert_eq!((c.vault(), c.player(accounts(1)).topped_up), (U128(YOCTO_PER_COIN * 2), U128(YOCTO_PER_COIN * 2)));
}

#[test]
fn the_bait_for_a_ticket_costs_a_fifth_of_what_a_win_brings() {
    let mut c = fresh();
    assert_eq!(c.coin_price(), U128(LOWEST_COIN_PRICE), "an empty vault: the lowest price");
    // day 0: a player tops up while the vault is empty, at the lowest price
    as_player(1, NEAR);
    assert_eq!(c.top_up(), U128(100_000), "an empty vault: the lowest price");
    // then the game's makers put 1000 NEAR in the vault. The price follows at once: coins are not left at the
    // old price for the rest of the day, to be bought up for the bigger prizes to come
    as_player(0, NEAR * 1000);
    c.add_prize();
    assert_eq!(c.coin_price(), U128(NEAR * 91 / 10_000), "the price that goes with the vault as it is now");
    as_player(2, NEAR);
    assert_eq!(c.top_up(), U128(109), "1 NEAR buys 109 coins now, not 100,000");

    // Day 1 begins with a little under 1002 NEAR: the prize is 200.2 NEAR and a bit. A winning ticket gets a hundredth of it (2.002 NEAR),
    // and one ticket in five wins, so a ticket is worth a five-hundredth (0.4004 NEAR). The 44 coins a ticket
    // is counted as cost just that: 0.0091 NEAR a coin.
    at(1, NEAR, NEXT_DAY, 1);
    let vault = c.vault().0;
    let (prize, price) = (vault / 5, c.coin_price().0);
    assert_eq!(c.top_up(), U128(NEAR / price), "1 NEAR buys coins at the forecast price");
    assert_eq!((c.draw(None).pool, c.draw(None).fixed), (U128(prize), true));
    // the price is the prize spread over 500 tickets of 44 coins, rounded up to a millionth of a NEAR: so the
    // bait for five tickets costs what one winning ticket gets (and at most a rounding more)
    assert!(price * 44 * 5 >= prize / 100 && price * 44 * 5 < prize / 100 + NEAR / 1000, "{price} {prize}");
    // a small top-up does not move today's price; one that makes the vault much bigger moves it up at once
    at(2, NEAR, NEXT_DAY, 1);
    c.top_up();
    assert_eq!(c.coin_price(), U128(price));
    at(2, NEAR * 500, NEXT_DAY, 1);
    c.top_up();
    assert!(c.coin_price().0 > price, "the vault grew by half: a coin costs more at once");
    let price = c.coin_price().0;

    // day 2: the vault holds more, so the prize and the price are higher again
    at(2, 0, 2 * NEXT_DAY, 1);
    let day2 = c.coin_price().0;
    assert!(day2 > price);
    // (nobody entered day 1's draw: its prize is back in the vault for day 2, and the forecast knew)
    at(0, 0, 2 * NEXT_DAY, 1);
    c.start_day();
    assert_eq!(c.coin_price().0, day2, "the forecast was right");
    // the owner counts a ticket as fewer coins (players turned out to be better): a coin costs more, from tomorrow
    c.configure(None, None, None, None, Some(22));
    assert_eq!((c.coins_per_ticket(), c.coin_price().0), (22, day2), "today's price stays");
    at(0, 0, 3 * NEXT_DAY, 1);
    let prize3 = c.draw(None).pool.0;
    assert_eq!(c.coin_price().0, (prize3 / (500 * 22)).div_ceil(NEAR / 1_000_000) * (NEAR / 1_000_000));
}

#[test]
fn coins_buy_bait_and_are_gone_for_good() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 10);
    let p = c.player(accounts(1));
    assert_eq!((p.coins, p.bait), (U128(80), U128(10)));
    assert_eq!(c.mt_supply(COIN.to_string()), Some(U128(80)));
    assert_eq!(c.vault(), U128(NEAR));
}

#[test]
#[should_panic(expected = "Not enough coin")]
fn bait_cannot_be_bought_without_the_coins() {
    let mut c = fresh();
    as_player(1, YOCTO_PER_COIN * 3);
    c.top_up();
    as_player(1, 0);
    c.buy_bait(2);
}

#[test]
#[should_panic(expected = "coin cannot be sent to another account")]
fn coins_cannot_be_sent_to_somebody_else() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 0);
    as_player(1, 1);
    c.mt_transfer(accounts(2), COIN.to_string(), U128(10), None, None);
}

#[test]
fn a_cast_spends_a_bait_and_the_server_lands_the_fish() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 3);
    assert_eq!(catch(&mut c, 1, "tuna"), Some("tuna".to_string()));
    let p = c.player(accounts(1));
    assert_eq!((p.bait, p.held, p.open_cast), (U128(2), 1, None));
    assert_eq!(p.items, vec![("tuna".to_string(), U128(1))]);
    // a cast that brings up nothing just costs its bait
    as_player(1, 0);
    c.cast(seal());
    assert_eq!(c.player(accounts(1)).bait, U128(1));
}

/// The server can be an account of its own (so that its fees are not paid by the account with the vault):
/// once the owner names it, it alone lands catches, and the contract's own account no longer can.
#[test]
fn the_server_can_be_an_account_of_its_own() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 2);
    as_player(0, 0);
    c.configure(None, None, Some(accounts(3)), None, None);
    assert_eq!((c.owner(), c.minter()), (accounts(0), accounts(3)));
    // the new server lands a catch
    as_player(1, 0);
    let cast = c.cast(seal());
    as_player(3, 0);
    assert_eq!(land(&mut c, Some(accounts(1)), cast, "anchovy", secret(), None, None), Some("anchovy".to_string()));
    assert_eq!(has(&c, 1, "anchovy"), 1);
    // the contract's own account, which was the server before, is refused
    as_player(1, 0);
    let cast = c.cast(seal());
    as_player(0, 0);
    let refused = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| land(&mut c, Some(accounts(1)), cast, "anchovy", secret(), None, None))).is_err();
    assert!(refused);
    assert_eq!(has(&c, 1, "anchovy"), 1);
}

/// A player lands their own catch, and pays the network's fee for it, when the game's server has signed for
/// exactly that catch. (The key and the two signatures were made once, outside: a signature over
/// "kail land|alice|bob|1|anchovy|mark-1" and one over "kail land|alice|bob|2|chest|mark-2": the contract is
/// alice in these tests, and the player bob.)
const SERVER_KEY_B64: &str = "Dblz5N3eXGv4HJi6IN/JWJU+/1NQT3z9v/bSyzRF/oc=";
const APPROVES_ANCHOVY: &str = "uO8oGIwDTWjXCDJsxIOA/+Y64wrPV6hiwznpW/R+8bDuJGN3naXHC5HSrDJ/T1xzGELeSGoQD55P9qGFHULCAQ==";
const APPROVES_CHEST: &str = "c8ZbJYKS+fB/cQJRCguotPJbPhxhqvfrc1hQtugikza+MjE5WXDXbSS8arVunbB5bdcIA30VqyqhwI7ZdalUAg==";
fn b64(text: &str) -> near_sdk::json_types::Base64VecU8 {
    near_sdk::serde_json::from_str(&format!("\"{text}\"")).unwrap()
}
fn refuses<T>(f: impl FnOnce() -> T) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()
}
#[test]
fn a_player_lands_their_own_catch_with_the_servers_approval() {
    let mut c = fresh();
    c.set_server_key(Some(b64(SERVER_KEY_B64)));
    assert_eq!(c.server_key().map(|k| k.0.len()), Some(32));
    funded(&mut c, 1, 1, 3);
    as_player(1, 0);
    let cast = c.cast(seal());
    assert_eq!(cast.0, 1);
    // an approval of something else, of another sea mark, of another cast, or used by another account is worth nothing
    assert!(refuses(|| land(&mut c, None, cast, "crown", secret(), Some("mark-1".to_string()), Some(b64(APPROVES_ANCHOVY)))));
    assert!(refuses(|| land(&mut c, None, cast, "anchovy", secret(), Some("mark-9".to_string()), Some(b64(APPROVES_ANCHOVY)))));
    assert!(refuses(|| land(&mut c, None, cast, "chest", secret(), Some("mark-2".to_string()), Some(b64(APPROVES_CHEST)))));
    as_player(2, 0);
    assert!(refuses(|| land(&mut c, Some(accounts(1)), cast, "anchovy", secret(), Some("mark-1".to_string()), Some(b64(APPROVES_ANCHOVY)))));
    // without the sea's mark the approval is not the one the server signed
    as_player(1, 0);
    assert!(refuses(|| land(&mut c, None, cast, "anchovy", secret(), None, Some(b64(APPROVES_ANCHOVY)))));
    assert!(refuses(|| land(&mut c, None, cast, "anchovy", secret(), Some(String::new()), Some(b64(APPROVES_ANCHOVY)))));
    // the approved catch goes into the player's storage, and the sea's mark is kept
    as_player(1, 0);
    assert_eq!(land(&mut c, None, cast, "anchovy", secret(), Some("mark-1".to_string()), Some(b64(APPROVES_ANCHOVY))), Some("anchovy".to_string()));
    assert_eq!((has(&c, 1, "anchovy"), c.player(accounts(1)).sea), (1, Some("mark-1".to_string())));
    // the same approval a second time: that cast is not in the water any more
    assert!(refuses(|| land(&mut c, None, cast, "anchovy", secret(), Some("mark-1".to_string()), Some(b64(APPROVES_ANCHOVY)))));
    assert_eq!(has(&c, 1, "anchovy"), 1);
    // a chest lands the same way, and the chain decides what is in it
    at(1, 0, 2 * MINUTE, 7);
    let cast = c.cast(seal());
    assert_eq!(cast.0, 2);
    let found = land(&mut c, None, cast, "chest", secret(), Some("mark-2".to_string()), Some(b64(APPROVES_CHEST))).unwrap();
    assert!(["pearl", "goldbar", "crown"].contains(&found.as_str()));
}
#[test]
fn without_a_server_key_named_no_approval_counts() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 1);
    as_player(1, 0);
    let cast = c.cast(seal());
    assert!(refuses(|| land(&mut c, None, cast, "anchovy", secret(), Some("mark-1".to_string()), Some(b64(APPROVES_ANCHOVY)))));
    // and only the owner can name the key
    as_player(1, 0);
    assert!(refuses(|| c.set_server_key(Some(b64(SERVER_KEY_B64)))));
}

/// A chest is opened in a second step, by the contract itself. Landing it spends the cast and puts nothing into
/// storage yet: whoever lands it cannot know the find, and so cannot undo the landing because of it.
#[test]
fn a_chest_is_opened_in_a_second_step() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 2);
    as_player(1, 0);
    let cast = c.cast(seal());
    as_player(0, 0);
    let finds = |c: &Contract| has(c, 1, "pearl") + has(c, 1, "goldbar") + has(c, 1, "crown");
    // the landing: the cast is spent, the chest's clock is set, and nothing is in storage
    assert!(matches!(c.land(Some(accounts(1)), cast, "chest".to_string(), secret(), None, None), near_sdk::PromiseOrValue::Promise(_)));
    assert_eq!((finds(&c), c.player(accounts(1)).open_cast), (0, None));
    // landing the same cast again is refused: there is no second roll for it
    assert!(refuses(|| c.land(Some(accounts(1)), cast, "chest".to_string(), secret(), None, None)));
    // (that nobody but the contract can take the second step is checked on a local chain, in tests/sandbox.rs:
    // the check lives in the exported call, which these tests do not go through)
    // the contract takes it: one find is in storage
    as_player(0, 0);
    let found = c.chest_opened(accounts(1), cast).unwrap();
    assert_eq!((finds(&c), has(&c, 1, &found)), (1, 1));
}

#[test]
#[should_panic(expected = "Only the game's server can land a catch")]
fn a_player_cannot_land_their_own_catch() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 1);
    as_player(1, 0);
    let cast = c.cast(seal());
    land(&mut c, Some(accounts(1)), cast, "crown", secret(), None, None);
}

#[test]
#[should_panic(expected = "That cast is not in the water")]
fn one_cast_lands_only_once() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 1);
    as_player(1, 0);
    let cast = c.cast(seal());
    as_player(0, 0);
    land(&mut c, Some(accounts(1)), cast, "tuna", secret(), None, None);
    land(&mut c, Some(accounts(1)), cast, "tuna", secret(), None, None);
}

#[test]
#[should_panic(expected = "No such fish")]
fn the_server_cannot_hand_out_a_chest_find_directly() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 1);
    catch(&mut c, 1, "crown");
}

#[test]
fn a_chest_holds_one_of_the_three_finds_and_the_chain_picks() {
    let mut c = fresh();
    funded(&mut c, 1, 10, 40);
    as_player(1, 0);
    for _ in 0..3 {
        c.upgrade("storage".to_string());
    }
    let mut seen = std::collections::BTreeMap::new();
    for seed in 0..30u8 {
        let now = MINUTE + seed as u64 * 20_000;
        at(1, 0, now, seed);
        let cast = c.cast(seal());
        at(0, 0, now, seed);
        let got = land(&mut c, Some(accounts(1)), cast, "chest", secret(), None, None).unwrap();
        *seen.entry(got).or_insert(0u32) += 1;
    }
    assert_eq!(seen.values().sum::<u32>(), 30);
    assert!(seen.keys().all(|k| CHEST.iter().any(|(id, _)| id == k)), "{seen:?}");
    assert!(seen.len() == 3 && seen.values().all(|n| *n >= 4), "all three come up, none of them rarely: {seen:?}");
}

#[test]
fn a_full_storage_loses_the_catch_until_it_is_upgraded() {
    let mut c = fresh();
    funded(&mut c, 1, 2, 30);
    for _ in 0..16 {
        assert!(catch(&mut c, 1, "anchovy").is_some());
    }
    assert!(cast_refused(&mut c, 1), "with a full storage the hook is not thrown, and no bait is spent");
    assert_eq!(c.player(accounts(1)).held, 16);
    as_player(1, 0);
    assert_eq!(c.upgrade("storage".to_string()), 1);
    let p = c.player(accounts(1));
    assert_eq!((p.storage_cap, p.coins), (24, U128(200 - 60 - 30)));
    assert!(catch(&mut c, 1, "anchovy").is_some());
}

#[test]
fn every_day_has_a_quest_of_three_kinds_sized_like_the_game() {
    fresh();
    let mut crown_days = 0;
    for day in 0..400u64 {
        let (needs, tickets) = quest::quest_of(day);
        assert!(UPPER.contains(&needs[0].0) && DEEP.contains(&needs[1].0), "day {day}: {needs:?}");
        assert_eq!(needs[2].1, 1);
        assert_eq!(tickets, 1);
        assert!((3..=10).contains(&needs[0].1) && (2..=5).contains(&needs[1].1), "day {day}: {needs:?}");
        assert!(needs.iter().map(|n| n.1).sum::<u32>() + 2 <= game::storage_cap(0), "day {day} fits a new player's storage: {needs:?}");
        crown_days += (needs[2].0 == "crown") as u32;
    }
    assert!((90..=180).contains(&crown_days), "about a third of the days ask for a crown: {crown_days}");
}

/// Catch everything today's quest asks for (the chest find by fishing chests until the right one comes up).
fn fill_quest(c: &mut Contract, who: usize) {
    let q = c.quest();
    for (id, n) in &q.needs[..2] {
        for _ in 0..*n {
            catch(c, who, id);
        }
    }
    let want = q.needs[2].0.clone();
    for seed in 0..=255u8 {
        // chests come back every 20 seconds; the test's day is 5 minutes, so stay within 3 of them
        let now = MINUTE + (seed % 9) as u64 * 20_000;
        at(who, 0, now, seed);
        let cast = c.cast(seal());
        at(0, 0, now, seed);
        if land(c, Some(accounts(who)), cast, "chest", secret(), None, None).as_deref() == Some(want.as_str()) {
            return;
        }
        // not the one the quest wants: back into the sea
        let got = c.player(accounts(who)).items.iter().find(|(id, _)| CHEST.iter().any(|(c, _)| c == id) && *id != want).map(|(id, _)| id.clone());
        if let Some(extra) = got {
            at(who, 0, now, seed);
            c.throw_back(extra, 1);
        }
    }
    panic!("no {want} in 256 chests");
}

#[test]
fn handing_in_the_quest_burns_the_catch_and_pays_tickets_while_stock_lasts() {
    let mut c = fresh();
    assert_eq!(c.quest().stock, 0, "no limit unless the owner sets one");
    as_player(0, 0);
    c.configure(None, Some(400), None, None, None);
    funded(&mut c, 1, 20, 900);
    as_player(1, 0);
    c.upgrade("storage".to_string());
    c.upgrade("storage".to_string());
    as_player(5, 0);
    as_player(1, 0);
    let q = c.quest();
    fill_quest(&mut c, 1);
    as_player(1, 0);
    assert_eq!(c.hand_in(), U128(q.tickets as u128));
    let p = c.player(accounts(1));
    assert_eq!((p.tickets, p.held), (U128(q.tickets as u128), 0));
    assert_eq!(c.quest().left, q.stock - q.tickets);
    // tickets can be sent to another account, unlike coins
    as_player(1, 1);
    c.mt_transfer(accounts(2), TICKET.to_string(), U128(1), None, None);
    assert_eq!(has(&c, 2, TICKET), 1);
}

#[test]
#[should_panic(expected = "Not enough")]
fn the_quest_is_all_or_nothing() {
    let mut c = fresh();
    funded(&mut c, 1, 5, 60);
    // everything but the chest find
    let q = c.quest();
    for (id, n) in &q.needs[..2] {
        for _ in 0..*n {
            catch(&mut c, 1, id);
        }
    }
    as_player(1, 0);
    c.hand_in();
}

#[test]
fn a_refused_hand_in_takes_nothing() {
    // the same as above, but looking at what is left: a failed call changes nothing on a real chain, and the
    // rules are written so that the check comes before anything is taken
    let mut c = fresh();
    funded(&mut c, 1, 5, 60);
    let q = c.quest();
    for _ in 0..q.needs[0].1 {
        catch(&mut c, 1, &q.needs[0].0);
    }
    let held = c.player(accounts(1)).held;
    as_player(1, 0);
    let refused = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.hand_in())).is_err();
    assert!(refused);
    assert_eq!(held, q.needs[0].1);
}

#[test]
#[should_panic(expected = "All tickets are gone for today")]
fn the_quest_stops_when_the_days_tickets_are_gone() {
    let mut c = fresh();
    // the owner limits the day to one ticket, and that one is gone
    as_player(0, 0);
    c.configure(None, Some(1), None, None, None);
    c.quest_given.insert(0, 1);
    as_player(1, 0);
    c.hand_in();
}

#[test]
fn players_sell_fish_to_each_other_for_coins_and_a_fee_is_burned() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 5);
    funded(&mut c, 2, 1, 0);
    for _ in 0..3 {
        catch(&mut c, 1, "shark");
    }
    as_player(1, 0);
    let id = c.list_item("shark".to_string(), 3, U128(20));
    assert_eq!((has(&c, 1, "shark"), c.player(accounts(1)).held), (0, 3), "listed fish keep their room in storage");
    assert_eq!(c.item_orders(None, None).len(), 1);

    as_player(2, 0);
    c.buy_item(id, 2);
    // 40 coins to the seller, and the buyer pays 2 more as the fee, which is burned
    assert_eq!((has(&c, 2, "shark"), has(&c, 2, COIN)), (2, 58));
    assert_eq!((c.player(accounts(1)).held, c.player(accounts(2)).held), (1, 2));
    assert_eq!(has(&c, 1, COIN), 100 - 10 + 40);
    assert_eq!(c.mt_supply(COIN.to_string()), Some(U128(200 - 10 - 2)));
    assert_eq!(c.item_orders(None, None)[0].amount, 1);

    // the seller takes the last one back
    as_player(1, 0);
    c.cancel_item_order(id);
    assert_eq!((has(&c, 1, "shark"), c.player(accounts(1)).held, c.item_orders(None, None).len()), (1, 1, 0));
    assert_eq!(c.mt_supply("shark".to_string()), Some(U128(3)), "nothing was created or lost on the way");
}

#[test]
#[should_panic(expected = "Not enough coin")]
fn a_buyer_without_the_coins_gets_nothing() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 1);
    catch(&mut c, 1, "shark");
    as_player(1, 0);
    let id = c.list_item("shark".to_string(), 1, U128(20));
    as_player(2, 0);
    c.buy_item(id, 1);
}

#[test]
#[should_panic(expected = "Only the owner can change the rules")]
fn only_the_owner_changes_the_rules() {
    let mut c = fresh();
    as_player(1, 0);
    c.configure(None, None, Some(accounts(1)), None, None);
}

#[test]
fn the_first_versions_coins_survive_the_move_to_this_version() {
    as_player(0, 0);
    // the state as the first deployed version wrote it: one player with 4 coins
    let mut old = ContractV1 { owner: accounts(0), balances: LookupMap::new(b"b"), supply: LookupMap::new(b"s"), topped_up: LookupMap::new(b"t"), vault: NEAR / 10 };
    old.balances.insert((accounts(1), COIN.to_string()), 4);
    old.supply.insert(COIN.to_string(), 4);
    old.topped_up.insert(accounts(1), NEAR / 10);
    old.balances.flush();
    old.supply.flush();
    old.topped_up.flush();
    env::state_write(&old);

    let mut c = Contract::migrate();
    assert_eq!((c.player(accounts(1)).coins, c.vault(), c.owner(), c.minter()), (U128(4), U128(NEAR / 10), accounts(0), accounts(0)));
    assert_eq!(c.quest().stock, 0);
    // and the new rules work on top of the old coins
    as_player(1, 0);
    c.buy_bait(2);
    assert_eq!(catch(&mut c, 1, "tuna"), Some("tuna".to_string()));
}

#[test]
#[should_panic(expected = "tuna cannot be sent to another account")]
fn fish_cannot_be_sent_to_somebody_else() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 1);
    catch(&mut c, 1, "tuna");
    as_player(1, 1);
    c.mt_transfer(accounts(2), "tuna".to_string(), U128(1), None, None);
}

#[test]
fn no_sale_is_free_and_a_listing_is_not_a_second_storage() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 20);
    funded(&mut c, 2, 1, 0);
    for _ in 0..16 {
        catch(&mut c, 1, "anchovy");
    }
    // the storage is full; putting fish up for sale does not make room
    as_player(1, 0);
    let id = c.list_item("anchovy".to_string(), 10, U128(2));
    assert!(cast_refused(&mut c, 1));
    // even at the lowest price the fee is a coin: the buyer pays 3, the seller gets the 2 they asked
    as_player(2, 0);
    assert_eq!(c.item_quote(id, 1).buyer_pays, U128(3));
    c.buy_item(id, 1);
    assert_eq!((has(&c, 2, COIN), has(&c, 1, COIN)), (97, 100 - 40 + 2));
    // now the seller has room for one again, and can throw fish back to make more
    assert!(catch(&mut c, 1, "anchovy").is_some());
    as_player(1, 0);
    c.throw_back("anchovy".to_string(), 1);
    assert_eq!(c.player(accounts(1)).held, 15);
}

// ---- the draw and the ticket market

/// Hand an account tickets without playing for them.
fn tickets(c: &mut Contract, who: usize, n: u128) {
    c.mint(&accounts(who), &[(TICKET, n)], None);
}
fn owed(c: &Contract, who: usize) -> u128 {
    c.owed(accounts(who)).0
}
const NEXT_DAY: u64 = 6 * MINUTE;

#[test]
fn the_days_prize_is_set_aside_when_the_day_begins() {
    let mut c = fresh();
    // day 0: 10 NEAR come in. They count from the next day on.
    funded(&mut c, 1, 10, 0);
    assert_eq!(c.vault(), U128(NEAR * 10));
    // day 1 begins: 20% of the vault is today's prize, and it is out of the vault from the first moment
    at(1, 0, NEXT_DAY, 9);
    assert_eq!((c.draw(None).pool, c.draw(None).fixed), (U128(NEAR * 2), false), "a forecast until something happens today");
    for (who, n) in [(1usize, 10u32), (2, 10), (3, 5)] {
        tickets(&mut c, who, n as u128);
        at(who, 0, NEXT_DAY, 9);
        c.enter_draw(n);
        assert_eq!((has(&c, who, TICKET), c.entered(accounts(who), U64(1))), (0, n));
    }
    let d = c.draw(None);
    assert_eq!((d.pool, d.fixed, d.tickets, c.vault()), (U128(NEAR * 2), true, U64(25), U128(NEAR * 8)));
    // a big top-up during the day does not change today's prize
    let top = c.coin_price().0 * 500_000;      // whole coins, so all of it stays: 45.5 NEAR
    assert_eq!(top, NEAR * 455 / 10);
    at(4, top, NEXT_DAY, 9);
    c.top_up();
    let vault = NEAR * 8 + top;
    assert_eq!((c.draw(None).pool, c.vault()), (U128(NEAR * 2), U128(vault)));

    // day 2: the game holds day 1's draw. One ticket in five wins: 5 of the 25, each a hundredth of the prize.
    at(0, 0, 2 * NEXT_DAY, 9);
    assert_eq!(c.settle_draw(U64(1), None), 5);
    let d = c.draw(Some(U64(1)));
    let each = NEAR * 2 / 100;
    assert_eq!((d.settled, d.winners, d.prize_each, d.pool), (true, 5, U128(each), U128(each * 5)), "the draw keeps what it paid");
    let won: Vec<u128> = (1..=3).map(|w| owed(&c, w) / each).collect();
    assert_eq!(won.iter().sum::<u128>(), 5);
    assert!(won[0] <= 10 && won[1] <= 10 && won[2] <= 5, "{won:?}");
    assert_eq!(owed(&c, 4), 0);
    // day 2's prize is 20% of what the vault held when day 2 began; and what day 1 did not pay out (95 of its
    // hundredths) is back in the vault
    assert_eq!((c.draw(None).pool, c.vault()), (U128(vault / 5), U128(vault * 4 / 5 + NEAR * 2 - each * 5)));

    // collecting empties what is owed
    at(1, 0, 2 * NEXT_DAY, 9);
    let _payout = c.claim();
    assert_eq!(owed(&c, 1), 0);
}

#[test]
#[should_panic(expected = "That day is not over yet")]
fn a_draw_cannot_be_held_before_its_day_is_over() {
    let mut c = fresh();
    tickets(&mut c, 1, 1);
    as_player(1, 0);
    c.enter_draw(1);
    as_player(0, 0);
    c.settle_draw(U64(0), None);
}

#[test]
#[should_panic(expected = "That draw has been held already")]
fn a_draw_is_held_only_once() {
    let mut c = fresh();
    tickets(&mut c, 1, 1);
    as_player(1, 0);
    c.enter_draw(1);
    at(0, 0, NEXT_DAY, 9);
    c.settle_draw(U64(0), None);
    c.settle_draw(U64(0), None);
}

#[test]
fn one_ticket_in_five_wins_a_hundredth_and_what_is_not_won_goes_back() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 0);
    // day 1 begins with 1 NEAR in the vault: 0.2 is its prize. Nobody enters.
    at(2, 0, NEXT_DAY, 3);
    tickets(&mut c, 2, 5);
    c.start_day();
    assert_eq!((c.draw(None).pool, c.vault()), (U128(NEAR / 5), U128(NEAR * 4 / 5)));
    // day 2: day 1's prize is back in the vault, so day 2's prize is 20% of the whole 1 NEAR again
    at(2, 0, 2 * NEXT_DAY, 3);
    c.enter_draw(5);
    assert_eq!((c.draw(Some(U64(1))).pool, c.draw(None).pool, c.vault()), (U128(0), U128(NEAR / 5), U128(NEAR * 4 / 5)));
    // day 3: five tickets were in day 2's draw. One of them wins a hundredth of the prize, as a ticket would in
    // a full draw; the other 99 hundredths go back into the vault
    at(0, 0, 3 * NEXT_DAY, 3);
    assert_eq!(c.settle_draw(U64(2), None), 1);
    assert_eq!(owed(&c, 2), NEAR / 5 / 100);
    assert_eq!(c.draw(Some(U64(2))).prize_each, U128(NEAR / 5 / 100));
    assert_eq!(c.vault().0 + c.draw(None).pool.0 + owed(&c, 2), NEAR, "nothing is lost: it stays in the vault");
    // a day nobody entered has no draw to hold (its prize went back into the vault by itself)
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.settle_draw(U64(1), None))).is_err());
    assert_eq!(c.draw(Some(U64(1))).settled, false);
}

#[test]
fn with_fewer_than_five_tickets_the_chain_rolls_for_the_one_winner() {
    // 3 tickets a day for 200 days. Every ticket has one chance in five, so there is a winner on about 3 days
    // out of 5, never two; a win is always a hundredth of that day's prize; and no NEAR appears or is lost.
    let mut c = fresh();
    funded(&mut c, 1, 10, 0);
    tickets(&mut c, 1, 600);
    let (mut days_won, mut paid) = (0u32, 0u128);
    const DAY: u64 = 5 * MINUTE;      // a day as the contract counts it when it is new
    for day in 1..=200u64 {
        at(1, 0, day * DAY + 1000, day as u8);
        c.enter_draw(3);
        let prize = c.draw(None).pool.0;
        at(0, 0, (day + 1) * DAY + 1000, day as u8);
        let winners = c.settle_draw(U64(day), None);
        assert!(winners <= 1);
        if winners == 1 {
            days_won += 1;
            assert_eq!(owed(&c, 1) - paid, prize / 100, "a win is a hundredth of the day's prize");
            paid = owed(&c, 1);
        }
    }
    assert!((100..=140).contains(&days_won), "a winner on about 120 of 200 days, not on {days_won}");
    assert_eq!(c.vault().0 + c.draw(None).pool.0 + paid, NEAR * 10, "every NEAR is in the vault, in today's prize or won");
}

fn stranger(n: u32) -> AccountId {
    format!("player{n}.near").parse().unwrap()
}
fn as_stranger(id: &AccountId, ms: u64) {
    testing_env!(VMContextBuilder::new().current_account_id(accounts(0)).signer_account_id(id.clone()).predecessor_account_id(id.clone())
        .block_timestamp(ms * 1_000_000).random_seed([5; 32]).build());
}

#[test]
fn a_days_draw_takes_500_tickets_and_10_from_one_player() {
    let mut c = fresh();
    funded(&mut c, 1, 10, 0);
    // one player: ten tickets and no more
    tickets(&mut c, 1, 12);
    at(1, 0, NEXT_DAY, 9);
    c.enter_draw(4);
    c.enter_draw(6);
    let eleventh = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.enter_draw(1)));
    assert!(eleventh.is_err(), "ten from one player is the limit");
    assert_eq!((has(&c, 1, TICKET), c.draw(None).cap, c.draw(None).per_player), (2, 500, 10));
    // 49 more players put in ten each: the draw is full
    for n in 0..49 {
        let who = stranger(n);
        c.mint(&who, &[(TICKET, 10)], None);
        as_stranger(&who, NEXT_DAY);
        c.enter_draw(10);
    }
    assert_eq!(c.draw(None).tickets, U64(500));
    let late = stranger(99);
    c.mint(&late, &[(TICKET, 1)], None);
    as_stranger(&late, NEXT_DAY);
    let no_room = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.enter_draw(1)));
    assert!(no_room.is_err(), "the 501st ticket finds no room");
    assert_eq!(c.mt_balance_of(late.clone(), TICKET.to_string()), U128(1), "and stays with its holder");
    // tomorrow there is room again, and the full draw of today is held: 100 winners, the whole prize paid
    as_stranger(&late, 2 * NEXT_DAY);
    c.enter_draw(1);
    at(0, 0, 2 * NEXT_DAY, 9);
    assert_eq!(c.settle_draw(U64(1), None), 100);
    let gas = env::used_gas().as_tgas();
    println!("holding a full draw used {gas} Tgas of host calls");
    assert!(gas < 150, "holding a full draw must fit in one transaction: {gas} Tgas");
    let d = c.draw(Some(U64(1)));
    assert_eq!((d.winners, d.prize_each, d.pool), (100, U128(NEAR * 2 / 100), U128(NEAR * 2)));
    let won: u128 = (0..49).map(|n| c.owed(stranger(n)).0).sum::<u128>() + owed(&c, 1);
    assert_eq!(won, NEAR * 2);
    assert!((0..49).all(|n| c.owed(stranger(n)).0 <= NEAR * 2 / 100 * 10), "nobody wins with more tickets than they put in");
}

#[test]
fn tickets_are_sold_for_near_and_the_fee_goes_to_the_prize() {
    let mut c = fresh();
    tickets(&mut c, 1, 5);
    as_player(1, 0);
    let sale = c.sell_tickets(5, U128(NEAR / 2));
    assert_eq!(has(&c, 1, TICKET), 0, "tickets for sale are held by the contract");

    as_player(2, NEAR);
    c.buy_tickets(sale, 2);
    assert_eq!(has(&c, 2, TICKET), 2);
    // 1 NEAR paid: 5% into the vault, the rest for the seller to collect
    assert_eq!((owed(&c, 1), c.vault()), (NEAR * 95 / 100, U128(NEAR * 5 / 100)));
    assert_eq!(c.ticket_orders(None, None)[0].amount, 3);

    // the sale is in the market's list for everybody, and in both players' own history
    let t = &c.ticket_trades()[0];
    assert_eq!((t.amount, t.price, t.seller.clone(), t.buyer.clone()), (2, U128(NEAR / 2), accounts(1), accounts(2)));
    assert_eq!((c.history(accounts(1))[0].kind.as_str(), c.history(accounts(2))[0].kind.as_str()), ("ticket_sold", "ticket_bought"));
    assert_eq!(c.state(None).ticket_trades.len(), 1);
    // the seller takes the rest back
    as_player(1, 0);
    c.cancel_order(sale);
    assert_eq!((has(&c, 1, TICKET), c.ticket_orders(None, None).len()), (3, 0));
}

#[test]
#[should_panic(expected = "Attach exactly the price of the tickets")]
fn buying_tickets_needs_the_exact_price() {
    let mut c = fresh();
    tickets(&mut c, 1, 1);
    as_player(1, 0);
    let sale = c.sell_tickets(1, U128(NEAR / 2));
    as_player(2, NEAR / 4);
    c.buy_tickets(sale, 1);
}

#[test]
fn an_offer_holds_the_buyers_near_until_somebody_sells_into_it() {
    let mut c = fresh();
    tickets(&mut c, 1, 4);
    as_player(2, NEAR * 3 / 10 * 3);
    let offer = c.bid_tickets(3, U128(NEAR * 3 / 10));
    as_player(1, 0);
    c.fill_bid(offer, 2);
    assert_eq!((has(&c, 1, TICKET), has(&c, 2, TICKET)), (2, 2));
    let total = NEAR * 3 / 10 * 2;
    assert_eq!(owed(&c, 1), total - total * 5 / 100);
    // the buyer cancels what is left and gets that NEAR back to collect
    as_player(2, 0);
    c.cancel_order(offer);
    assert_eq!(owed(&c, 2), NEAR * 3 / 10);
}

#[test]
#[should_panic(expected = "Only the game can hold the draw")]
fn a_player_cannot_hold_the_draw() {
    let mut c = fresh();
    tickets(&mut c, 1, 1);
    as_player(1, 0);
    c.enter_draw(1);
    at(1, 0, NEXT_DAY, 9);
    c.settle_draw(U64(0), None);
}

#[test]
fn a_buyer_posts_an_offer_and_a_fisher_sells_into_it() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 5);
    funded(&mut c, 2, 1, 0);
    // player 2 wants 3 sharks at 8 coins: the 24 coins are held
    as_player(2, 0);
    let offer = c.want_item("shark".to_string(), 3, U128(8));
    assert_eq!(has(&c, 2, COIN), 76);
    // player 1 catches two and sells them into the offer: 16 coins, 1 burned as the fee
    catch(&mut c, 1, "shark");
    catch(&mut c, 1, "shark");
    as_player(1, 0);
    c.sell_item(offer, 2);
    // the buyer's storage counts 3: the two sharks that arrived and the room still set aside for the third
    assert_eq!((has(&c, 1, "shark"), has(&c, 2, "shark"), c.player(accounts(2)).held), (0, 2, 3));
    assert_eq!(has(&c, 1, COIN), 100 - 10 + 15);
    assert_eq!(c.mt_supply(COIN.to_string()), Some(U128(200 - 10 - 1)));
    // the buyer takes the rest of the offer down and gets those 8 coins back
    as_player(2, 0);
    c.cancel_item_order(offer);
    assert_eq!((has(&c, 2, COIN), c.item_orders(None, None).len(), c.player(accounts(2)).held), (84, 0, 2));
}

#[test]
#[should_panic(expected = "Not enough coin")]
fn an_offer_needs_the_coins_up_front() {
    let mut c = fresh();
    funded(&mut c, 2, 1, 0);
    as_player(2, 0);
    c.want_item("shark".to_string(), 10, U128(11));
}

/// Fill an account's storage to the brim with anchovies.
fn fill_storage(c: &mut Contract, who: usize) {
    for _ in 0..16 {
        assert!(catch(c, who, "anchovy").is_some());
    }
}

#[test]
fn buying_with_a_full_storage_is_refused_and_costs_nothing() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 2);
    funded(&mut c, 2, 1, 20);
    catch(&mut c, 1, "shark");
    as_player(1, 0);
    let sale = c.list_item("shark".to_string(), 1, U128(20));
    fill_storage(&mut c, 2);
    as_player(2, 0);
    let refused = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.buy_item(sale, 1)));
    let why = refused.unwrap_err();
    let why = why.downcast_ref::<String>().cloned().unwrap_or_default();
    assert!(why.contains("Storage is full"), "{why}");
    // the check comes before any coin moves: on a real chain the whole call is undone anyway
    assert_eq!(c.item_orders(None, None).len(), 1, "the sale is still up");
}

#[test]
#[should_panic(expected = "Storage is full")]
fn an_offer_to_buy_needs_the_room_when_it_is_posted() {
    let mut c = fresh();
    funded(&mut c, 2, 1, 20);
    fill_storage(&mut c, 2);
    as_player(2, 0);
    c.want_item("shark".to_string(), 1, U128(8));
}

#[test]
fn an_offer_sets_its_room_aside_so_selling_into_it_always_fits() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 3);
    funded(&mut c, 2, 1, 20);
    // the buyer has 14 fish and offers to buy 2 sharks: the storage of 16 is now spoken for
    for _ in 0..14 {
        catch(&mut c, 2, "anchovy");
    }
    as_player(2, 0);
    let offer = c.want_item("shark".to_string(), 2, U128(8));
    assert_eq!(c.player(accounts(2)).held, 16);
    assert!(cast_refused(&mut c, 2), "no room left for a catch of their own");
    // so the seller's sharks fit for sure
    catch(&mut c, 1, "shark");
    as_player(1, 0);
    c.sell_item(offer, 1);
    assert_eq!((has(&c, 2, "shark"), c.player(accounts(2)).held), (1, 16));
    // taking the rest of the offer down frees its room again
    as_player(2, 0);
    c.cancel_item_order(offer);
    assert_eq!(c.player(accounts(2)).held, 15);
}

/// Not a check but a table: the smallest sales, run through the contract. `cargo test fee_table -- --nocapture`
#[test]
fn fee_table() {
    println!("FEE|way|price|amount|buyer pays|seller gets|burned|fee %");
    for (price, amount) in [(2u128, 1u32), (2, 2), (3, 1), (4, 1), (4, 2), (4, 5), (4, 10), (6, 1), (6, 3), (9, 1), (14, 1), (20, 1), (21, 1), (40, 1), (40, 3)] {
        for selling_into_offer in [false, true] {
            let mut c = fresh();
            funded(&mut c, 1, 10, 20);
            funded(&mut c, 2, 10, 0);
            for _ in 0..amount {
                catch(&mut c, 1, "anchovy");
            }
            let (seller0, buyer0, supply0) = (has(&c, 1, COIN), has(&c, 2, COIN), c.mt_supply(COIN.to_string()).unwrap().0);
            if selling_into_offer {
                as_player(2, 0);
                let offer = c.want_item("anchovy".to_string(), amount, U128(price));
                as_player(1, 0);
                c.sell_item(offer, amount);
            } else {
                as_player(1, 0);
                let sale = c.list_item("anchovy".to_string(), amount, U128(price));
                as_player(2, 0);
                c.buy_item(sale, amount);
            }
            let (paid, got, burned) = (buyer0 - has(&c, 2, COIN), has(&c, 1, COIN) - seller0, supply0 - c.mt_supply(COIN.to_string()).unwrap().0);
            assert!(got >= 1, "nobody ever sells for nothing");
            assert_eq!(paid, got + burned, "every coin is accounted for");
            let total = price * amount as u128;
            assert_eq!(if selling_into_offer { paid } else { got }, total, "whoever posted the order gets exactly their price");
            println!("FEE|{}|{price}|{amount}|{paid}|{got}|{burned}|{:.1}", if selling_into_offer { "sell into offer" } else { "buy from sale" }, 100.0 * burned as f64 / total as f64);
            // the test chain keeps its state from one round to the next: empty the buyer's storage again
            as_player(2, 0);
            c.throw_back("anchovy".to_string(), amount);
        }
    }
}

#[test]
fn buying_one_by_one_costs_the_buyer_and_never_the_seller() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 12);
    funded(&mut c, 2, 1, 0);
    for _ in 0..10 {
        catch(&mut c, 1, "anchovy");
    }
    as_player(1, 0);
    let sale = c.list_item("anchovy".to_string(), 10, U128(4));
    as_player(2, 0);
    for _ in 0..10 {
        c.buy_item(sale, 1);
    }
    // the seller gets the full 40 either way; the buyer paid 10 fees of 1 coin instead of one fee of 2
    assert_eq!((has(&c, 1, COIN), has(&c, 2, COIN)), (100 - 24 + 40, 100 - 50));
}

#[test]
#[should_panic(expected = "Name a price of at least 2 coins")]
fn nothing_is_listed_for_less_than_2_coins() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 1);
    catch(&mut c, 1, "anchovy");
    as_player(1, 0);
    c.list_item("anchovy".to_string(), 1, U128(1));
}

#[test]
#[should_panic(expected = "Name a price of at least 2 coins")]
fn nothing_is_asked_for_at_less_than_2_coins() {
    let mut c = fresh();
    funded(&mut c, 2, 1, 0);
    as_player(2, 0);
    c.want_item("anchovy".to_string(), 1, U128(1));
}

#[test]
fn the_contract_says_what_a_sale_comes_to_before_anybody_commits() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 3);
    funded(&mut c, 2, 1, 0);
    for _ in 0..3 {
        catch(&mut c, 1, "anchovy");
    }
    as_player(1, 0);
    let sale = c.list_item("anchovy".to_string(), 2, U128(4));
    as_player(2, 0);
    let offer = c.want_item("anchovy".to_string(), 1, U128(4));
    // taking 2 from the sale: the buyer pays 9, the seller gets the 8 asked
    let q = c.item_quote(sale, 2);
    assert_eq!((q.buyer_pays, q.seller_gets, q.fee), (U128(9), U128(8), U128(1)));
    // selling 1 into the offer: the buyer has paid 4, the seller gets 3
    let q = c.item_quote(offer, 1);
    assert_eq!((q.buyer_pays, q.seller_gets, q.fee), (U128(4), U128(3), U128(1)));
    // and that is exactly what happens
    let before = has(&c, 1, COIN);
    as_player(1, 0);
    c.sell_item(offer, 1);
    assert_eq!(has(&c, 1, COIN) - before, 3);
}

#[test]
#[should_panic(expected = "That is not the secret of this cast")]
fn a_cast_cannot_be_landed_without_the_players_secret() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 1);
    as_player(1, 0);
    let cast = c.cast(seal());
    as_player(0, 0);
    land(&mut c, Some(accounts(1)), cast, "tuna", b"a guess".to_vec().into(), None, None);
}

#[test]
#[should_panic(expected = "The chest has not come back yet")]
fn a_chest_cannot_be_claimed_with_every_cast() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 5);
    assert!(catch(&mut c, 1, "chest").is_some());
    catch(&mut c, 1, "chest");
}

#[test]
fn both_sides_of_a_sale_find_it_in_their_history_whoever_was_there() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 3);
    funded(&mut c, 2, 1, 0);
    catch(&mut c, 1, "shark");
    catch(&mut c, 1, "shark");
    as_player(1, 0);
    let sale = c.list_item("shark".to_string(), 2, U128(8));
    // the buyer acts; the seller is not there
    as_player(2, 0);
    c.buy_item(sale, 2);
    let seller = c.history(accounts(1));
    assert_eq!((seller[0].kind.as_str(), seller[0].what.as_str(), seller[0].amount, seller[0].value, seller[0].own), ("sold", "shark", 2, U128(16), false));
    let buyer = c.history(accounts(2));
    assert_eq!((buyer[0].kind.as_str(), buyer[0].amount, buyer[0].value, buyer[0].own), ("bought", 2, U128(17), true));
    // top-ups are in there too, older
    assert_eq!(buyer[1].kind, "top_up");
}

#[test]
fn a_winner_finds_the_prize_in_their_history_and_only_the_latest_30_are_kept() {
    let mut c = fresh();
    funded(&mut c, 1, 10, 0);
    at(1, 0, NEXT_DAY, 9);
    tickets(&mut c, 1, 5);
    c.enter_draw(5);
    at(0, 0, 2 * NEXT_DAY, 9);
    c.settle_draw(U64(1), None);
    let h = c.history(accounts(1));
    assert_eq!((h[0].kind.as_str(), h[0].amount, h[0].value, h[0].own), ("won", 1, U128(NEAR * 2 / 100), false));
    // forty small top-ups later, the list still holds 30
    for _ in 0..40 {
        at(1, NEAR / 100, 2 * NEXT_DAY, 9);
        c.top_up();
    }
    assert_eq!(c.history(accounts(1)).len(), 30);
}

#[test]
fn one_call_gives_a_page_everything_it_shows() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 2);
    catch(&mut c, 1, "shark");
    as_player(1, 0);
    c.list_item("shark".to_string(), 1, U128(8));
    let all = c.state(Some(accounts(1)));
    assert_eq!((all.orders.len(), all.vault, all.coin_price, all.quest.stock), (1, U128(NEAR), U128(YOCTO_PER_COIN), 0));
    let me = all.me.unwrap();
    assert_eq!((me.coins, me.bait, me.held), (U128(96), U128(1), 1));
    assert_eq!(all.events[0].kind, "top_up");
    // without an account: the public part only
    let public = c.state(None);
    assert!(public.me.is_none() && public.events.is_empty() && public.orders.len() == 1);
}

#[test]
fn the_three_chest_finds_are_equally_likely() {
    let mut c = fresh();
    as_player(1, NEAR * 30);
    c.top_up();
    as_player(1, 0);
    c.buy_bait(1000);
    let mut seen = std::collections::BTreeMap::new();
    for i in 0..900u64 {
        // a different block seed for every chest, and twenty seconds between them
        let seed: Vec<u8> = env::sha256(&i.to_le_bytes());
        let now = MINUTE + i * 20_000;
        let mut b = VMContextBuilder::new();
        b.current_account_id(accounts(0)).predecessor_account_id(accounts(1)).block_timestamp(now * 1_000_000).random_seed(seed.clone().try_into().unwrap());
        testing_env!(b.build());
        let cast = c.cast(seal());
        let mut b = VMContextBuilder::new();
        b.current_account_id(accounts(0)).predecessor_account_id(accounts(0)).block_timestamp(now * 1_000_000).random_seed(seed.try_into().unwrap());
        testing_env!(b.build());
        let got = land(&mut c, Some(accounts(1)), cast, "chest", secret(), None, None).unwrap();
        *seen.entry(got.clone()).or_insert(0u32) += 1;
        // make room again
        let mut b = VMContextBuilder::new();
        b.current_account_id(accounts(0)).predecessor_account_id(accounts(1)).block_timestamp(now * 1_000_000);
        testing_env!(b.build());
        c.throw_back(got, 1);
    }
    // 300 each on average; a fair draw of 900 stays well inside 250..350
    assert!(seen.len() == 3 && seen.values().all(|n| (250..=350).contains(n)), "{seen:?}");
}

#[test]
fn a_catch_is_lost_only_when_the_storage_filled_up_while_the_hook_was_down() {
    let mut c = fresh();
    funded(&mut c, 1, 1, 20);
    funded(&mut c, 2, 1, 2);
    catch(&mut c, 2, "shark");
    as_player(2, 0);
    let sale = c.list_item("shark".to_string(), 1, U128(5));
    for _ in 0..15 {
        catch(&mut c, 1, "anchovy");
    }
    // one box left: the cast is allowed
    as_player(1, 0);
    let cast = c.cast(seal());
    // while the hook is down the player buys a shark: the storage is full now
    c.buy_item(sale, 1);
    as_player(0, 0);
    assert_eq!(land(&mut c, Some(accounts(1)), cast, "anchovy", secret(), None, None), None);
    assert_eq!(c.player(accounts(1)).held, 16);
}

#[test]
fn the_harbour_lists_only_the_draws_that_had_tickets_newest_first() {
    let mut c = fresh();
    funded(&mut c, 1, 10, 0);
    // day 1: player 1 enters 5 tickets. Day 2: nobody. Day 3: player 2 enters 1.
    tickets(&mut c, 1, 5);
    at(1, 0, NEXT_DAY, 9);
    c.enter_draw(5);
    tickets(&mut c, 2, 1);
    at(2, 0, 3 * NEXT_DAY, 9);
    c.enter_draw(1);
    assert_eq!(c.past_draws(None).len(), 1, "day 3 is still running: only day 1 is in the past");
    // day 4: the game holds day 1's draw
    at(0, 0, 4 * NEXT_DAY, 9);
    c.settle_draw(U64(1), None);
    let list = c.past_draws(Some(accounts(1)));
    assert_eq!(list.iter().map(|d| d.day.0).collect::<Vec<_>>(), vec![3, 1], "no line for the empty day 2");
    assert_eq!((list[1].tickets, list[1].settled, list[1].winners, list[1].yours, list[1].ended_at), (U64(5), true, 1, 5, U64(600_000)));      // day 1 of five-minute days ends at minute 10
    assert_eq!((list[0].settled, list[0].yours), (false, 0));
    assert_eq!(c.state(Some(accounts(1))).past_draws.len(), 2);
}

/// The vault pays the game's server back for holding a draw: besides the prizes, the vault ends lower by
/// exactly the payment the log names. When the owner holds a draw, nothing is paid.
#[test]
fn the_vault_pays_the_server_back_for_holding_a_draw() {
    let mut c = fresh();
    funded(&mut c, 1, 10, 0);
    tickets(&mut c, 1, 10);
    at(1, 0, NEXT_DAY, 9);
    c.enter_draw(10);
    at(0, 0, NEXT_DAY, 9);
    c.configure(None, None, Some(accounts(3)), None, None);
    // the next day begins (its prize is set aside) before the vault is looked at
    at(0, 1, 2 * NEXT_DAY, 9);
    c.add_prize();
    let (before, prize) = (c.vault().0, c.draw(Some(U64(1))).pool.0);
    at(3, 0, 2 * NEXT_DAY, 9);
    assert_eq!(c.settle_draw(U64(1), None), 2);
    let each = c.draw(Some(U64(1))).prize_each.0;
    let paid = before + prize - 2 * each - c.vault().0;
    // more than the fixed part alone (4.5 Tgas at the network's price), and nowhere near a prize
    assert!(paid > 450_000_000_000_000_000_000 && paid < NEAR / 100, "{paid}");
    let log = get_logs().into_iter().find(|l| l.starts_with("The vault pays")).expect("the payment is in the log");
    assert!(log.contains(&paid.to_string()), "{log}");
    // telling the draw's transaction afterwards costs the vault nothing more
    let vault = c.vault().0;
    c.settle_draw(U64(1), Some("GDHezAMM7qjBtzJcPL9Py1b2aTQrLiUaLHt6TmzmR6KM".to_string()));
    assert_eq!(c.vault().0, vault);
}
/// With the server's key alone nobody can have the vault pay for draws that never were: an empty day, or a day
/// that never happened, is refused, and the vault stays as it is.
#[test]
fn the_vault_does_not_pay_for_draws_of_empty_days() {
    let mut c = fresh();
    funded(&mut c, 1, 10, 0);
    at(0, 0, NEXT_DAY, 9);
    c.configure(None, None, Some(accounts(3)), None, None);
    at(0, 1, 5 * NEXT_DAY, 9);
    c.add_prize();
    let vault = c.vault().0;
    at(3, 0, 5 * NEXT_DAY, 9);
    for day in 0..5 {
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.settle_draw(U64(day), None))).is_err(), "day {day}");
    }
    assert_eq!(c.vault().0, vault);
}
/// The accounts that hold the draw (the owner and the game's server) cannot put tickets into it.
#[test]
fn the_games_own_accounts_do_not_enter_the_draw() {
    let mut c = fresh();
    funded(&mut c, 1, 10, 0);
    at(0, 0, NEXT_DAY, 9);
    c.configure(None, None, Some(accounts(3)), None, None);
    for who in [0, 3] {
        tickets(&mut c, who, 1);
        at(who, 0, NEXT_DAY, 9);
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.enter_draw(1))).is_err(), "account {who}");
    }
}
/// Sending nothing is refused: it would write a row for the receiver at the contract's cost.
#[test]
fn sending_no_tickets_is_refused() {
    let mut c = fresh();
    at(1, 1, MINUTE, 7);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.mt_transfer(accounts(2), TICKET.to_string(), U128(0), None, None))).is_err());
}

/// The owner holding a draw is paid nothing back.
#[test]
fn the_owner_holding_a_draw_is_not_paid_back() {
    let mut c = fresh();
    funded(&mut c, 1, 10, 0);
    tickets(&mut c, 1, 10);
    at(1, 0, NEXT_DAY, 9);
    c.enter_draw(10);
    at(0, 0, NEXT_DAY, 9);
    c.configure(None, None, Some(accounts(3)), None, None);
    at(0, 1, 2 * NEXT_DAY, 9);
    c.add_prize();
    let (before, prize) = (c.vault().0, c.draw(Some(U64(1))).pool.0);
    at(0, 0, 2 * NEXT_DAY, 9);
    assert_eq!(c.settle_draw(U64(1), None), 2);
    assert_eq!(c.vault().0, before + prize - 2 * c.draw(Some(U64(1))).prize_each.0);
    assert!(get_logs().iter().all(|l| !l.starts_with("The vault pays")));
}

#[test]
fn a_held_draw_can_carry_its_transaction_once_and_names_its_winners_in_the_log() {
    let mut c = fresh();
    funded(&mut c, 1, 10, 0);
    tickets(&mut c, 1, 10);
    at(1, 0, NEXT_DAY, 9);
    c.enter_draw(10);
    at(0, 0, 2 * NEXT_DAY, 9);
    c.settle_draw(U64(1), None);
    // the draw's own record, in the transaction's log: two of the ten tickets won
    let log = get_logs().into_iter().find(|l| l.contains(r#""event":"draw""#)).expect("the draw logs who won");
    assert!(log.contains(r#""winners":[{"account":"bob","tickets":2}]"#) && log.contains(r#""day":"1""#), "{log}");
    assert_eq!(c.past_draws(None)[0].tx, None);
    // the game attaches the hash of that transaction
    let hash = "GDHezAMM7qjBtzJcPL9Py1b2aTQrLiUaLHt6TmzmR6KM".to_string();
    c.settle_draw(U64(1), Some(hash.clone()));
    assert_eq!(c.past_draws(None)[0].tx, Some(hash.clone()));
    // not a second time
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.settle_draw(U64(1), Some(hash))));
    assert!(again.is_err());
    // and collecting shows up in the winner's history
    at(1, 0, 2 * NEXT_DAY, 9);
    let _payout = c.claim();
    assert_eq!((c.history(accounts(1))[0].kind.as_str(), c.history(accounts(1))[0].value), ("claimed", U128(NEAR * 2 / 100 * 2)));
}

#[test]
fn a_catch_leaves_the_servers_mark_of_the_sea_and_the_view_counts_the_casts() {
    let mut c = fresh();
    funded(&mut c, 1, 10, 0);
    c.buy_bait(3);
    assert_eq!((c.player(accounts(1)).casts, c.player(accounts(1)).sea), (U64(0), None));
    let cast = c.cast(seal());
    as_player(0, 0);
    assert_eq!(land(&mut c, Some(accounts(1)), cast, "tuna", secret(), Some("mark-one".to_string()), None), Some("tuna".to_string()));
    assert_eq!((c.player(accounts(1)).casts, c.player(accounts(1)).sea), (U64(1), Some("mark-one".to_string())));
    // a catch reported without a mark leaves the old one; another player's mark is their own
    as_player(1, 0);
    let cast = c.cast(seal());
    as_player(0, 0);
    land(&mut c, Some(accounts(1)), cast, "tuna", secret(), None, None);
    assert_eq!(c.player(accounts(1)).sea, Some("mark-one".to_string()));
    assert_eq!(c.player(accounts(2)).sea, None);
    // a full storage still moves the mark: the fish is gone from the sea either way
    as_player(1, 0);
    let cast = c.cast(seal());
    as_player(0, 0);
    land(&mut c, Some(accounts(1)), cast, "tuna", secret(), Some("mark-two".to_string()), None);
    assert_eq!((c.player(accounts(1)).casts, c.player(accounts(1)).sea), (U64(3), Some("mark-two".to_string())));
}

#[test]
fn the_length_of_a_day_changes_only_between_draws_and_loses_nothing() {
    let mut c = fresh();
    funded(&mut c, 1, 10, 0);
    tickets(&mut c, 1, 10);
    at(1, 0, NEXT_DAY, 9);
    c.enter_draw(5);
    let vault_and_prize = c.vault().0 + c.draw(None).pool.0;
    // tickets are in today's draw: not now
    at(0, 0, NEXT_DAY + 1000, 9);
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.configure(Some(U64(3_600_000)), None, None, None, None)));
    assert!(early.is_err());
    // the day is over but its draw has not been held: not yet either
    at(0, 0, 2 * NEXT_DAY, 9);
    let waiting = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.configure(Some(U64(3_600_000)), None, None, None, None)));
    assert!(waiting.is_err());
    c.settle_draw(U64(1), None);
    let all = c.vault().0 + c.draw(None).pool.0 + c.owed(accounts(1)).0;
    assert_eq!(all, vault_and_prize, "the prize went to the winner, the rest is still there");
    // now it works: an hour a day
    c.configure(Some(U64(3_600_000)), None, None, None, None);
    let s = c.state(Some(accounts(1)));
    assert_eq!(s.day_ms, U64(3_600_000));
    assert_eq!(s.draw.day.0, 2 * NEXT_DAY / 3_600_000);
    // today's prize went back into the vault; what the draw shows now is only what the next prize will be
    assert!(!s.draw.fixed);
    assert_eq!(c.vault().0 + c.owed(accounts(1)).0, vault_and_prize, "nothing was lost with the change");
    assert!(s.past_draws.is_empty(), "the list of earlier draws starts anew");
    assert!(s.draw.ends_in_ms.0 <= 3_600_000);
    // and the game goes on in days of the new length: a ticket in, the hour over, the draw held
    at(1, 0, 2 * NEXT_DAY, 9);
    c.enter_draw(5);
    let day = c.draw(None).day.0;
    at(0, 0, (day + 1) * 3_600_000 + 5, 9);
    assert_eq!(c.settle_draw(U64(day), None), 1);
    assert_eq!(c.past_draws(None).len(), 1);
    assert_eq!(c.past_draws(None)[0].ended_at, U64((day + 1) * 3_600_000));
}

#[test]
fn a_new_player_is_welcomed_with_five_bait_once_and_only_by_the_game() {
    let mut c = fresh();
    // nobody but the owner can welcome until a greeter is named
    as_player(2, 0);
    let stranger = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.welcome(accounts(1))));
    assert!(stranger.is_err());
    let own = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.set_greeter(Some(accounts(2)))));
    assert!(own.is_err(), "only the owner names the greeter");
    as_player(0, 0);
    c.set_greeter(Some(accounts(2)));
    assert_eq!(c.greeter(), Some(accounts(2)));
    // the greeter welcomes a player: 5 bait, and the player can throw the hook without having topped up
    as_player(2, 0);
    assert!(!c.welcomed(accounts(1)));
    assert!(c.welcome(accounts(1)));
    assert_eq!((c.player(accounts(1)).bait, c.player(accounts(1)).coins, c.welcomed(accounts(1))), (U128(5), U128(0), true));
    // not a second time
    assert!(!c.welcome(accounts(1)));
    assert_eq!(c.player(accounts(1)).bait, U128(5));
    as_player(1, 0);
    c.cast(seal());
    assert_eq!(c.player(accounts(1)).bait, U128(4));
    // the owner can take the greeter away again
    as_player(0, 0);
    c.set_greeter(None);
    as_player(2, 0);
    let after = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.welcome(accounts(3))));
    assert!(after.is_err());
}

#[test]
fn a_near_auth_player_pays_back_what_their_approval_cost() {
    let mut c = fresh();
    let vault = c.vault().0;
    // with no greeter named, the fee goes into the prize vault
    as_player(1, NEAR / 200);
    c.relay_fee();
    assert_eq!(c.vault().0, vault + NEAR / 200);
    // with a greeter, it is owed to the greeter and nothing more goes into the vault
    as_player(0, 0);
    c.set_greeter(Some(accounts(2)));
    as_player(1, NEAR / 200);
    c.relay_fee();
    as_player(3, NEAR / 100);
    c.relay_fee();
    assert_eq!(c.owed(accounts(2)).0, NEAR / 200 + NEAR / 100);
    assert_eq!(c.vault().0, vault + NEAR / 200);
    // nothing attached is not a fee
    as_player(1, 0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.relay_fee())).is_err());
}
