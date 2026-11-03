// "Round" money axes: $0 · $1k · $2k · $3k instead of $750 · $1.5k · $2.3k.

const STEPS = [1, 2, 5, 10];

/** Nice step so that `max` fits in about `count` ticks. */
export function niceStep(max, count = 4) {
  if (!(max > 0)) return 1;
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = STEPS.find((s) => s * pow >= raw) * pow;
  return step;
}

/** { domain, ticks } for a money axis starting at 0 (or at a nice negative when values go below 0). */
export function niceMoneyAxis(values, count = 4) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const max = Math.max(0, ...nums);
  const min = Math.min(0, ...nums);
  const step = niceStep(Math.max(max, -min, 100), count);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const bottom = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { domain: [bottom, top], ticks };
}

/** Collect every numeric value of `keys` in `rows` (for niceMoneyAxis). */
export function valuesOf(rows, keys) {
  return rows.flatMap((r) => keys.map((k) => r[k]));
}

/** "$0", "$500", "$1k", "$2.5k", "$15k" for axis ticks. */
export function formatAxisUsd(n) {
  if (n === 0) return '$0';
  const a = Math.abs(n);
  const s = a >= 1000 ? `${(a / 1000).toFixed(a % 1000 === 0 ? 0 : 1)}k` : `${a}`;
  return `${n < 0 ? '−' : ''}$${s}`;
}
