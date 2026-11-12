// The few curved-line sums the sea needs (sine, cosine, powers...), built from plus, minus, times, divide and
// square root only. Those five give the very same digits in every browser and on a server; the browser's own
// Math.sin and friends may differ in the last digit from one browser to the next. With these, a throw played
// in one place can be played again in another and come out exactly the same (see test/replay.mjs).
const PI = 3.141592653589793, TWO_PI = 6.283185307179586, HALF_PI = 1.5707963267948966, LN2 = 0.6931471805599453;

// sine and cosine: bring the angle into -pi/4..pi/4 around a quarter turn, then a fixed row of terms
function sinSmall(x) { const z = x * x; return x * (1 + z * (-1 / 6 + z * (1 / 120 + z * (-1 / 5040 + z * (1 / 362880 + z * (-1 / 39916800 + z * (1 / 6227020800))))))); }
function cosSmall(x) { const z = x * x; return 1 + z * (-1 / 2 + z * (1 / 24 + z * (-1 / 720 + z * (1 / 40320 + z * (-1 / 3628800 + z * (1 / 479001600 + z * (-1 / 87178291200))))))); }
export function sin(x) {
  const q = Math.round(x / HALF_PI), r = x - q * HALF_PI, k = ((q % 4) + 4) % 4;
  return k === 0 ? sinSmall(r) : k === 1 ? cosSmall(r) : k === 2 ? -sinSmall(r) : -cosSmall(r);
}
export const cos = (x) => sin(x + HALF_PI);

// e to the power x: split off whole doublings, then a fixed row of terms for the rest
export function exp(x) {
  const k = Math.round(x / LN2), r = x - k * LN2;
  let y = 1 + r * (1 + r * (1 / 2 + r * (1 / 6 + r * (1 / 24 + r * (1 / 120 + r * (1 / 720 + r * (1 / 5040 + r * (1 / 40320 + r * (1 / 362880 + r * (1 / 3628800 + r * (1 / 39916800 + r / 479001600)))))))))));
  for (let i = 0; i < k; i++) y *= 2;
  for (let i = 0; i > k; i--) y *= 0.5;
  return y;
}
// natural logarithm of a positive number: halve or double it into 0.75..1.5, then a fixed row of terms
export function ln(x) {
  let e = 0;
  while (x >= 1.5) { x *= 0.5; e++; }
  while (x < 0.75) { x *= 2; e--; }
  const s = (x - 1) / (x + 1), z = s * s;
  let sum = 0;
  for (let n = 25; n >= 1; n -= 2) sum = 1 / n + z * sum;
  return e * LN2 + 2 * s * sum;
}
export const pow = (x, p) => exp(p * ln(x));

// the angle whose tangent is t: fold it into a small angle (twice halved), then a fixed row of terms
function atan(t) {
  if (t < 0) return -atan(-t);
  if (t > 1) return HALF_PI - atan(1 / t);
  let a = t, f = 1;
  for (let i = 0; i < 3; i++) { a = a / (1 + Math.sqrt(1 + a * a)); f *= 2; }
  const z = a * a;
  let sum = 0;
  for (let n = 23; n >= 1; n -= 2) sum = 1 / n - z * sum;
  return f * a * sum;
}
export function atan2(y, x) {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : 0;
}
export const asin = (a) => atan2(a, Math.sqrt(1 - a * a));
export const hypot = (x, y) => Math.sqrt(x * x + y * y);
export { PI, TWO_PI };
