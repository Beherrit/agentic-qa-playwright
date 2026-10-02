// Product data and the pure sort / search logic. Prices are integer cents.
export const PRODUCTS = [
  { id: 1, name: 'Sourdough Loaf', description: 'Crusty white sourdough, baked this morning.', price: 549, category: 'bakery' },
  { id: 2, name: 'Whole Milk 2 L', description: 'Fresh whole milk from a local dairy.', price: 249, category: 'dairy' },
  { id: 3, name: 'Free-Range Eggs 12', description: 'A dozen large free-range eggs.', price: 399, category: 'dairy' },
  { id: 4, name: 'Ground Coffee 500 g', description: 'Medium roast, ground for filter machines.', price: 1099, category: 'pantry' },
  { id: 5, name: 'Olive Oil 750 ml', description: 'Cold-pressed extra virgin olive oil.', price: 1299, category: 'pantry' },
  { id: 6, name: 'Bananas 1 kg', description: 'Ripe bananas, about six to a bunch.', price: 189, category: 'produce' },
  { id: 7, name: 'Mature Cheddar 400 g', description: 'Sharp cheddar aged for twelve months.', price: 749, category: 'dairy' },
  { id: 8, name: 'Dark Chocolate Bar', description: 'Seventy percent cocoa, 100 g bar.', price: 329, category: 'pantry' },
];

export const SORTS = ['name-asc', 'name-desc', 'price-asc', 'price-desc'];

export const findProduct = (id) => PRODUCTS.find((p) => p.id === Number(id));

function priceKey(product, bugs) {
  // BUG(sort-price): prices are compared as strings, so "1099" sorts before "249"
  return bugs.has('sort-price') ? String(product.price) : product.price;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function sortProducts(list, sort = 'name-asc', bugs = new Set()) {
  const byName = (a, b) => a.name.localeCompare(b.name, 'en');
  const byPrice = (a, b) => cmp(priceKey(a, bugs), priceKey(b, bugs)) || byName(a, b);
  const order = {
    'name-asc': byName,
    'name-desc': (a, b) => byName(b, a),
    'price-asc': byPrice,
    'price-desc': (a, b) => byPrice(b, a),
  }[sort];
  if (!order) throw new Error(`Unknown sort "${sort}"`);
  return [...list].sort(order);
}

// Case-insensitive "name contains text". An empty query matches everything.
export function searchProducts(list, q) {
  const needle = String(q ?? '').trim().toLowerCase();
  if (!needle) return [...list];
  return list.filter((p) => p.name.toLowerCase().includes(needle));
}
