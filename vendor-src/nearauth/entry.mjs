// What the game needs of NEAR Auth, packed into one browser file (npm run build, in this folder).
// NEAR Auth: sign in with Google, Apple or email; the key is held by NEAR's MPC network, never by one party.
export { FastAuthClient, FastAuthSignature } from '@fast-auth-near/browser-sdk';
export { JavascriptProvider } from '@fast-auth-near/javascript-provider';
// the near-api-js these libraries were written for (5.x): its transactions are what they sign
export { connect, transactions, utils, KeyPair, keyStores } from 'near-api-js';
export { buildDelegateAction } from 'near-api-js/lib/transaction';
