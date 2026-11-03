// Money helpers. The backend sends decimal strings; we only convert to numbers for display and charts.

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** "$1,248" or "$1,248.50" (no ".00"). */
export function formatUsd(n) {
  if (n === null || n === undefined) return '—';
  return usdFull.format(n);
}

/** "≈ 111,696,000 LBP", rounded to the nearest 1,000 like Lebanese shops do. */
export function formatLbp(usd, rate) {
  if (usd === null || usd === undefined || !rate) return '';
  const lbp = Math.round((usd * rate) / 1000) * 1000;
  return `≈ ${lbp.toLocaleString('en-US')} LBP`;
}

/** Percent change from b to a, or null when b is 0. */
export function percentChange(a, b) {
  if (!b) return null;
  return Math.round(((a - b) / b) * 100);
}

/** "$1.2k", "$860" for tight spaces like calendar cells and axes. */
export function formatUsdCompact(n) {
  if (n === null || n === undefined) return '—';
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return `$${Math.round(n)}`;
}

/**
 * The one rounding rule for every % in the app (margins, shares): whole percent, half up.
 * 36.5% → 37% everywhere. Returns null when the base is 0.
 */
export function pct(part, whole) {
  if (part === null || part === undefined || !whole) return null;
  return Math.round(((part / whole) * 100) + 1e-9);
}
