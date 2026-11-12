// The older NEAR libraries expect Node's Buffer to be there.
import { Buffer } from 'buffer';
globalThis.Buffer ||= Buffer;
export { Buffer };
