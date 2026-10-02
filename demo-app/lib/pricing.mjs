// Money maths in integer cents. Never use floats for prices.
export const TAX_RATE_PERCENT = 8;

export const itemTotal = (items) => items.reduce((sum, item) => sum + item.price, 0);

export function tax(totalCents, bugs = new Set()) {
  const scaled = totalCents * TAX_RATE_PERCENT; // hundredths of a cent
  // BUG(tax-rounding): tax is truncated instead of rounded to the nearest cent
  if (bugs.has('tax-rounding')) return Math.floor(scaled / 100);
  return Math.floor((scaled + 50) / 100);
}

export function totals(items, bugs = new Set()) {
  const sub = itemTotal(items);
  const t = tax(sub, bugs);
  return { itemTotal: sub, tax: t, total: sub + t };
}
