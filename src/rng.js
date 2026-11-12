// Small seeded random numbers, so the same day gives the same orders for everyone.
export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // where the row of numbers stands, so it can be written down and picked up again somewhere else
  next.at = () => a;
  next.from = (state) => { a = state >>> 0; };
  return next;
}
export const between = (rnd, [a, b]) => a + (b - a) * rnd();
export const intBetween = (rnd, [a, b]) => Math.floor(a + (b - a + 1) * rnd());
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
