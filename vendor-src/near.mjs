// What the browser needs from npm, packed into one file by `npm run vendor`:
// the wallet connector, and the plugin that signs the game's own calls with a key kept in the browser.
export { NearConnector } from '@hot-labs/near-connect';
export { createAccessKeyPlugin } from 'function-call-key-plugin';
// for making the game's own key in the browser
export { KeyPair } from 'near-api-js';
// for players who signed in with NEAR Auth: no wallet stands between them and the chain, so the game signs its
// small calls itself with the key it keeps in the browser
export { Account, FailoverRpcProvider, JsonRpcProvider, KeyPairSigner, actions, baseEncode, encodeTransaction } from 'near-api-js';
