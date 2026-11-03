// One color = one meaning, everywhere in the Business area.
// Checked with the dataviz palette validator (light surface #fffbfa):
// - Sales / Cost / Profit pass together (they share charts).
// - Cash / Whish pass together (they share the payment bar).
// Cash is no longer the Sales maroon, and Whish is amber everywhere (never the Cost blue).
export const COLORS = {
  sales: '#a8455c',
  salesSoft: '#e2b0aa', // same hue, lighter: "last week", other hours, comparison bars
  cost: '#5b62b5',
  profit: '#00968f',
  cash: '#2f8fc7',
  whish: '#c27a2c',
  forecast: '#b9a7a2', // dashed outline for days still to come
  target: '#2a2626',
};

export const PAY_COLORS = { CASH: COLORS.cash, WHISH: COLORS.whish };

export const AXIS = { tick: { fill: '#6e6461', fontSize: 12 }, grid: '#f0e2de', line: '#e3cfc9' };
