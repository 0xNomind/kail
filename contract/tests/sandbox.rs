//! The contract on a real (local) NEAR chain: built to wasm, deployed, and played by two accounts.
//! Run with `cargo test`. The first run downloads the local chain.
use near_api::{AccountId, NearToken};
use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::{Value, json};

async fn account(sandbox: &near_sandbox::Sandbox, name: &str) -> testresult::TestResult<near_api::Account> {
    let id: AccountId = name.parse().unwrap();
    sandbox.create_account(id.clone().as_str().parse()?).initial_balance(NearToken::from_near(50)).send().await?;
    Ok(near_api::Account(id))
}

#[tokio::test]
async fn a_whole_day_of_the_game_on_a_local_chain() -> testresult::TestResult<()> {
    let wasm = std::fs::read(cargo_near_build::build_with_cli(Default::default())?)?;
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = near_api::Signer::from_secret_key(near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse().unwrap())?;

    let alice = account(&sandbox, "alice.sandbox").await?;
    let bob = account(&sandbox, "bob.sandbox").await?;
    let kail = account(&sandbox, "kail.sandbox").await?;
    let contract = kail.clone().as_contract();
    near_api::Contract::deploy(kail.account_id().clone())
        .use_code(wasm)
        .with_init_call("new", json!({ "owner": kail.account_id() }))?
        .with_signer(signer.clone())
        .send_to(&net)
        .await?
        .assert_success();

    // a change call by `who`, with NEAR attached or not; gives back whether it went through
    let call = async |who: &near_api::Account, method: &str, args: Value, deposit: NearToken| -> testresult::TestResult<bool> {
        let r = contract.call_function(method, args).transaction().deposit(deposit)
            .with_signer(who.account_id().clone(), signer.clone()).send_to(&net).await?;
        Ok(r.is_success())
    };
    let view = async |method: &str, args: Value| -> testresult::TestResult<Value> {
        Ok(contract.call_function(method, args).read_only().fetch_from(&net).await?.data)
    };
    let player = async |who: &near_api::Account| view("player", json!({ "account_id": who.account_id() })).await;
    let none = NearToken::from_yoctonear(0);
    // a long day, so the quest does not change while the test runs
    assert!(call(&kail, "configure", json!({ "day_ms": "86400000" }), none).await?);

    // Alice pays 5 NEAR. The vault is empty, so a coin is at its lowest price: 500,000 coins. The NEAR is now in
    // the contract's account
    let vault_before = kail.tokens().near_balance().fetch_from(&net).await?.total;
    assert!(call(&alice, "top_up", json!({}), NearToken::from_near(5)).await?);
    let vault_after = kail.tokens().near_balance().fetch_from(&net).await?.total;
    assert!(vault_after >= vault_before.saturating_add(NearToken::from_near(5)), "the contract holds the NEAR");
    assert!(!call(&alice, "top_up", json!({}), NearToken::from_yoctonear(12_345)).await?, "not whole coins");
    assert!(call(&alice, "buy_bait", json!({ "amount": 200 }), none).await?);
    assert!(call(&alice, "upgrade", json!({ "what": "storage" }), none).await?);
    let p = player(&alice).await?;
    assert_eq!((p["coins"].as_str(), p["bait"].as_str(), p["storage_cap"].as_u64()), (Some("499570"), Some("200"), Some(24)));

    // every cast is sealed with the hash of a secret; landing it needs the secret (base64, as the calls take it)
    let secret = "a2FpbA=="; // "kail"
    let seal = "0C1ZxPJaKuO7x+toww/TPL9lCD+eIH1hIb/YasYjOFY=";
    // one throw: Alice casts, the server (here the contract's own account) says what came up
    let throw = async |what: &str| -> testresult::TestResult<Option<String>> {
        let r = contract.call_function("cast", json!({ "seal": seal })).transaction().with_signer(alice.account_id().clone(), signer.clone()).send_to(&net).await?;
        let cast: U64 = r.assert_success().json()?;
        let r = contract.call_function("land", json!({ "player": alice.account_id(), "cast": cast, "what": what, "secret": secret })).transaction()
            .with_signer(kail.account_id().clone(), signer.clone()).send_to(&net).await?;
        Ok(r.assert_success().json()?)
    };
    // Alice cannot land her own catch
    assert!(call(&alice, "cast", json!({ "seal": seal }), none).await?);
    assert!(!call(&alice, "land", json!({ "player": alice.account_id(), "cast": "1", "what": "crown", "secret": secret }), none).await?);
    // and the server cannot land it without her secret
    assert!(!call(&kail, "land", json!({ "player": alice.account_id(), "cast": "1", "what": "tuna", "secret": "Z3Vlc3M=" }), none).await?);

    // she fishes what today's quest asks for
    let quest = view("quest", json!({})).await?;
    let needs: Vec<(String, u64)> = near_sdk::serde_json::from_value(quest["needs"].clone())?;
    for (kind, n) in &needs[..2] {
        for _ in 0..*n {
            assert_eq!(throw(kind).await?.as_deref(), Some(kind.as_str()));
        }
    }
    let wanted = needs[2].0.clone();
    let mut chests = 0;
    loop {
        chests += 1;
        assert!(chests <= 60, "no {wanted} in 60 chests");
        // the chain lets a player bring up a chest only every 20 seconds: let that time pass
        sandbox.fast_forward(60).await?;
        let got = throw("chest").await?.expect("room in storage");
        if got == wanted { break; }
        // a find the quest does not want cannot be given to Bob; it goes back into the sea
        assert!(!call(&alice, "mt_transfer", json!({ "receiver_id": bob.account_id(), "token_id": got, "amount": "1" }), NearToken::from_yoctonear(1)).await?);
        assert!(call(&alice, "throw_back", json!({ "token_id": got, "amount": 1 }), none).await?);
    }
    assert!(!call(&alice, "mt_transfer", json!({ "receiver_id": bob.account_id(), "token_id": "coin", "amount": "1" }), NearToken::from_yoctonear(1)).await?);

    // the quest takes the catch and pays tickets
    assert!(call(&alice, "hand_in", json!({}), none).await?);
    let p = player(&alice).await?;
    let tickets = quest["tickets"].as_u64().unwrap();
    assert_eq!((p["tickets"].as_str().unwrap().parse::<u64>()?, p["held"].as_u64()), (tickets, Some(0)));
    // no limit on how many tickets the quest gives in a day
    let _ = tickets;
    assert_eq!(view("quest", json!({})).await?["stock"].as_u64(), Some(0));
    assert!(!call(&alice, "hand_in", json!({}), none).await?, "nothing left to hand in");
    // a ticket is the one thing that can be sent to another account
    assert!(call(&alice, "mt_transfer", json!({ "receiver_id": bob.account_id(), "token_id": "ticket", "amount": "1" }), NearToken::from_yoctonear(1)).await?);
    assert_eq!(player(&bob).await?["tickets"].as_str(), Some("1"));

    // the market: Alice sells a shark to Bob for 20 coins; Bob pays 1 coin more as the fee, which is burned
    assert_eq!(throw("shark").await?.as_deref(), Some("shark"));
    let coins_before: u128 = player(&alice).await?["coins"].as_str().unwrap().parse()?;
    assert!(call(&alice, "list_item", json!({ "token_id": "shark", "amount": 1, "price": "20" }), none).await?);
    let listing = view("item_orders", json!({})).await?[0]["id"].clone();
    assert!(!call(&bob, "buy_item", json!({ "order": listing, "amount": 1 }), none).await?, "Bob has no coins yet");
    assert!(call(&bob, "top_up", json!({}), NearToken::from_near(1)).await?);
    assert!(call(&bob, "buy_item", json!({ "order": listing, "amount": 1 }), none).await?);
    let (a, b) = (player(&alice).await?, player(&bob).await?);
    assert_eq!(a["coins"].as_str().unwrap().parse::<u128>()?, coins_before + 20);
    assert_eq!(b["coins"].as_str(), Some("99979"));
    let bob_shark: U128 = near_sdk::serde_json::from_value(view("mt_balance_of", json!({ "account_id": bob.account_id(), "token_id": "shark" })).await?)?;
    assert_eq!(bob_shark, U128(1));
    assert_eq!(view("item_orders", json!({})).await?.as_array().unwrap().len(), 0);

    // the ticket market: Bob sells the ticket he was given for 0.5 NEAR, Alice buys it, Bob collects real NEAR
    let half = NearToken::from_millinear(500);
    assert!(call(&bob, "sell_tickets", json!({ "amount": 1, "price": half.as_yoctonear().to_string() }), none).await?);
    let order = view("ticket_orders", json!({})).await?[0]["id"].clone();
    assert!(!call(&alice, "buy_tickets", json!({ "order": order, "amount": 1 }), NearToken::from_millinear(100)).await?, "too little NEAR");
    assert!(call(&alice, "buy_tickets", json!({ "order": order, "amount": 1 }), half).await?);
    let bob_before = bob.tokens().near_balance().fetch_from(&net).await?.total;
    assert!(call(&bob, "claim", json!({}), none).await?);
    let bob_after = bob.tokens().near_balance().fetch_from(&net).await?.total;
    assert!(bob_after > bob_before.saturating_add(NearToken::from_millinear(470)), "Bob got 0.475 NEAR, minus a little gas");
    assert!(!call(&bob, "claim", json!({}), none).await?, "nothing more to collect");

    // The draw. Days are made short first, so that this one is over soon: that is allowed while no tickets are in.
    assert!(call(&kail, "configure", json!({ "day_ms": "60000" }), none).await?);
    // Alice burns all her tickets into today's draw. She is the only one in it.
    let mine: u64 = player(&alice).await?["tickets"].as_str().unwrap().parse()?;
    assert!(call(&alice, "enter_draw", json!({ "amount": mine }), none).await?);
    let mut draw = view("draw", json!({})).await?;
    // (the minute may have turned right after she entered: then her tickets are in the day before)
    if draw["tickets"].as_str() == Some("0") {
        let before: u64 = draw["day"].as_str().unwrap().parse::<u64>()? - 1;
        draw = view("draw", json!({ "day": before.to_string() })).await?;
    }
    let (day, pool): (String, u128) = (draw["day"].as_str().unwrap().to_string(), draw["pool"].as_str().unwrap().parse()?);
    // the vault holds the 6 NEAR topped up and the ticket market's fee of 0.025 NEAR; a draw pays 20% of it
    assert_eq!(pool, NearToken::from_millinear(1205).as_yoctonear());
    // with tickets in a draw the length of a day cannot be changed: that would put the draw out of reach
    assert!(!call(&kail, "configure", json!({ "day_ms": "120000" }), none).await?, "not while a draw is waiting");
    // let the minute pass, and hold its draw
    for _ in 0..30 {
        if view("draw", json!({})).await?["day"].as_str() != Some(day.as_str()) { break; }
        sandbox.fast_forward(20).await?;
    }
    assert_ne!(view("draw", json!({})).await?["day"].as_str(), Some(day.as_str()), "the day is over");
    assert!(!call(&bob, "settle_draw", json!({ "day": day }), none).await?, "a player cannot hold the draw");
    assert!(call(&kail, "settle_draw", json!({ "day": day }), none).await?);
    // One ticket in five wins. Alice has fewer than five in, so the chain rolled whether one of hers won;
    // a ticket that wins gets a hundredth of the prize.
    let held = view("draw", json!({ "day": day })).await?;
    let winners = held["winners"].as_u64().unwrap() as u128;
    assert!(held["settled"].as_bool().unwrap() && winners <= mine.div_ceil(5) as u128);
    let owed: u128 = player(&alice).await?["owed"].as_str().unwrap().parse()?;
    assert_eq!(owed, pool / 100 * winners);
    if winners > 0 {
        let alice_before = alice.tokens().near_balance().fetch_from(&net).await?.total;
        assert!(call(&alice, "claim", json!({}), none).await?);
        let alice_after = alice.tokens().near_balance().fetch_from(&net).await?.total;
        assert!(alice_after.as_yoctonear() + NearToken::from_millinear(5).as_yoctonear() > alice_before.as_yoctonear() + owed, "the prize arrived in her account");
    } else {
        assert!(!call(&alice, "claim", json!({}), none).await?, "nothing won, nothing to collect");
    }
    let vault: u128 = near_sdk::serde_json::from_value::<U128>(view("vault", json!({})).await?)?.0;
    // 6.025 NEAR came in. 1.205 was that draw's prize; of the 4.82 left, 20% is set aside for the day that
    // began; and what was not won of the 1.205 is back in the vault
    let expected = NearToken::from_millinear(3856).as_yoctonear() + pool - owed;
    assert!(vault >= expected - NearToken::from_millinear(5).as_yoctonear() && vault <= expected, "the rest is still in the vault: {vault}");
    Ok(())
}
