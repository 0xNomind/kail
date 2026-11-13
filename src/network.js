// Everything that differs between NEAR's test network and its main network, in one place.
//
// Moving the game to mainnet:
//   1. here: fill in the `mainnet` block below (the contract's account, and the sign-in NEAR Auth hands out when it
//      approves the game's address: docs.auth.near.org, "apply"), and set NETWORK to 'mainnet';
//   2. the contract: deploy it to that account (contract/README.md) and name the greeter (`set_greeter`);
//   3. the server: the same names in its settings (NEAR_NETWORK, NEAR_CONTRACT, NEAR_ACCOUNT, NEAR_KEY, WELCOME,
//      NEAR_AUTH_ISSUER, NEAR_AUTH_CLIENT, and NEAR_RPC for a node of its own; server/dev.vars.example lists them).
// Nothing else in the game names a network: the pages take it from here, the server from its settings.
export const NETWORK = 'testnet';

const NETWORKS = {
  testnet: {
    // the game's contract
    contract: 'kail-game.testnet',
    // Public nodes of NEAR to talk to, the first one first. They are free and shared, so now and then one is slow
    // or says no; then the next one is asked.
    nodes: ['https://test.rpc.fastnear.com', 'https://rpc.testnet.fastnear.com', 'https://near-testnet.drpc.org'],
    // what account names end in
    top: 'testnet',
    explorer: 'https://testnet.nearblocks.io',
    // where NEAR is free (only on a test network)
    faucet: 'https://near-faucet.io/',
    // where this game is hosted
    hosted: 'https://kail.nomind.dev',
    // NEAR Auth (docs.auth.near.org/resources/testnet): its contracts, and the sign-in client shared by everybody
    // who tries it out. That shared client sends a signed-in person back only to `onlyAt` (where NEAR Auth's own
    // example app runs) and to NEAR Auth's own demo: a hosted game is refused (`npm run verify` asks and says).
    auth: { contract: 'fast-auth.testnet', mpc: 'v1.signer-prod.testnet', clientId: 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl', onlyAt: 'http://localhost:3000' },
  },
  mainnet: {
    contract: '',
    nodes: ['https://free.rpc.fastnear.com', 'https://near.drpc.org'],
    top: 'near',
    explorer: 'https://nearblocks.io',
    faucet: null,
    // (docs.auth.near.org/resources/mainnet) clientId, domain and signingAudience come with NEAR Auth's approval
    auth: { contract: 'fast-auth.near', mpc: 'v1.signer', clientId: '', domain: '', signingAudience: '', onlyAt: null },
  },
};
export const NET = NETWORKS[NETWORK];

// What a NEAR Auth player pays on top of an approval (0.005 NEAR). Such a player's key is held by NEAR's MPC
// network: each signature is a request on the chain that costs about 0.004 NEAR, and NEAR wants a (tiny) deposit
// with it, which a key kept in a browser may not attach. So the game's helper sends the request, and the player
// pays it back in the same transaction (the contract's `relay_fee`). A wallet's player signs in their wallet, for
// nothing. The server holds to the same number (RELAY_FEE in its settings).
export const SIGN_FEE = '5000000000000000000000';
