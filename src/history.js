// The player's history. The lines come from the contract (its `history` view): it writes one for both sides of
// every trade, for quest tickets, prizes and top-ups, whether a game was open or not. So the history is the same
// in every browser. This file turns a line into words, and remembers, in this browser, up to where the player
// has looked and what they were already told.
import { ITEM_BY_ID } from './config.js';
import { near } from './chain.js';

const slot = (me, name) => `kail.history:${me}:${name}`;
const read = (me, name) => { try { return +localStorage.getItem(slot(me, name)) || 0; } catch { return 0; } };
const write = (me, name, value) => { try { localStorage.setItem(slot(me, name), String(value)); } catch { /* private mode */ } };

/// A line of the contract's history as words, and the name of a picture for it.
export function describe(e) {
  const n = e.amount, s = n === 1 ? '' : 's', item = ITEM_BY_ID[e.what], name = item ? item.name : e.what;
  const N = `${near(e.value)} NEAR`, coins = `${e.value} coins`;
  switch (e.kind) {
    case 'sold': return { pic: e.what, text: e.own ? `You sold ${n} ${name} for ${coins}` : `Somebody bought your ${n} ${name}: +${coins}` };
    case 'bought': return { pic: e.what, text: e.own ? `You bought ${n} ${name} for ${coins}` : `Somebody sold you ${n} ${name}: your offer paid ${coins}` };
    case 'ticket_sold': return { pic: 'icon_ticket', text: e.own ? `You sold ${n} ticket${s}: ${N} to collect at the Harbour` : `Somebody bought ${n} of your tickets: ${N} to collect at the Harbour` };
    case 'ticket_bought': return { pic: 'icon_ticket', text: e.own ? `You bought ${n} ticket${s} for ${N}` : `Somebody sold you ${n} ticket${s}: your offer paid ${N}` };
    case 'quest': return { pic: 'icon_ticket', text: `The quest paid you ${n} ticket${s}` };
    case 'won': return { pic: 'item_goldbar', text: `${n} of your tickets won the draw: ${N} to collect at the Harbour` };
    case 'top_up': return { pic: 'icon_coin', text: `Topped up ${n} coins for ${N}` };
    case 'claimed': return { pic: 'item_goldbar', text: `You collected ${N} into your wallet` };
    default: return { pic: '', text: `${e.kind} ${n} ${name}` };
  }
}

/// Up to when the player has looked at their history, and how many lines are newer than that.
export const seenAt = (me) => read(me, 'seen');
export const unread = (me, events) => { const at = seenAt(me); return events.filter((e) => +e.at > at).length; };
export function markSeen(me, events) { if (events.length) write(me, 'seen', Math.max(seenAt(me), +events[0].at)); }

/// The lines the player has not been told about yet that somebody else caused (a sale to them, a prize):
/// newest first. Calling this counts as telling.
export function news(me, events) {
  const at = read(me, 'told'), fresh = events.filter((e) => +e.at > at && !e.own);
  if (events.length) write(me, 'told', Math.max(at, +events[0].at));
  return fresh;
}
