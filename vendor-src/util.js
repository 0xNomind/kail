// A stand-in for Node's "util" in the browser. One library inside near-api-js (a code generator for checking
// JSON) asks for it, and only for these two functions.
export function inspect(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}
export function format(first, ...rest) {
  if (typeof first !== 'string') return [first, ...rest].map((v) => (typeof v === 'string' ? v : inspect(v))).join(' ');
  let i = 0;
  const text = first.replace(/%[sdjifoO%]/g, (m) => {
    if (m === '%%') return '%';
    if (i >= rest.length) return m;
    const v = rest[i++];
    if (m === '%s') return String(v);
    if (m === '%d' || m === '%i') return String(Math.trunc(Number(v)));
    if (m === '%f') return String(Number(v));
    return inspect(v);
  });
  return [text, ...rest.slice(i).map((v) => (typeof v === 'string' ? v : inspect(v)))].join(' ');
}
export default { format, inspect };
