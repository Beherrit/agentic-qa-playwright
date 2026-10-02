// The switches that can be turned on. Unknown names are rejected so a typo
// in BUGS or FEATURES fails loudly instead of silently testing nothing.
export const BUGS = ['sort-price', 'tax-rounding', 'cart-remove', 'postcode-optional', 'badge-stale'];
export const FEATURES = ['search'];

export function parseList(value) {
  if (Array.isArray(value)) return value;
  return String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function checkedSet(value, known, label) {
  const names = parseList(value);
  for (const name of names) {
    if (!known.includes(name)) throw new Error(`Unknown ${label} "${name}". Known: ${known.join(', ')}`);
  }
  return new Set(names);
}
