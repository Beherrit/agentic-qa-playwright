import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTS, sortProducts, searchProducts, findProduct } from '../lib/catalog.mjs';
import { itemTotal, tax, totals } from '../lib/pricing.mjs';
import { validateCheckout } from '../lib/validation.mjs';
import { addItem, removeItem, cartView } from '../lib/cart.mjs';
import { checkedSet, parseList } from '../lib/flags.mjs';

const bugs = (...names) => new Set(names);
const names = (list) => list.map((p) => p.name);
const session = () => ({ cart: [], count: 0, orders: [] });

test('catalog has 8 products with integer cent prices', () => {
  assert.equal(PRODUCTS.length, 8);
  for (const p of PRODUCTS) assert.ok(Number.isInteger(p.price) && p.price > 0);
});

test('sorts by name both ways', () => {
  const asc = names(sortProducts(PRODUCTS, 'name-asc'));
  assert.deepEqual(asc, [...asc].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(names(sortProducts(PRODUCTS, 'name-desc')), [...asc].reverse());
});

test('sorts by price numerically both ways', () => {
  const asc = sortProducts(PRODUCTS, 'price-asc').map((p) => p.price);
  assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
  assert.equal(asc[0], 189);
  assert.equal(asc.at(-1), 1299);
  assert.deepEqual(sortProducts(PRODUCTS, 'price-desc').map((p) => p.price), [...asc].reverse());
});

test('sort-price bug compares prices as strings', () => {
  const asc = sortProducts(PRODUCTS, 'price-asc', bugs('sort-price')).map((p) => p.price);
  assert.ok(asc.indexOf(1099) < asc.indexOf(249));
});

test('sortProducts rejects an unknown sort and does not mutate its input', () => {
  assert.throws(() => sortProducts(PRODUCTS, 'size'));
  const before = names(PRODUCTS);
  sortProducts(PRODUCTS, 'name-desc');
  assert.deepEqual(names(PRODUCTS), before);
});

test('search is a case-insensitive name contains', () => {
  assert.deepEqual(names(searchProducts(PRODUCTS, 'MILK')), ['Whole Milk 2 L']);
  assert.equal(searchProducts(PRODUCTS, '').length, 8);
  assert.equal(searchProducts(PRODUCTS, 'zzz').length, 0);
  assert.equal(searchProducts(PRODUCTS, 'milk').length, searchProducts(PRODUCTS, ' Milk ').length);
});

test('item total, tax and total in cents', () => {
  const items = [{ price: 249 }, { price: 549 }];
  assert.equal(itemTotal(items), 798);
  assert.deepEqual(totals(items), { itemTotal: 798, tax: 64, total: 862 });
  assert.deepEqual(totals([]), { itemTotal: 0, tax: 0, total: 0 });
});

test('tax rounds to the nearest cent', () => {
  assert.equal(tax(249), 20); // 19.92
  assert.equal(tax(549), 44); // 43.92
  assert.equal(tax(100), 8);
  assert.equal(tax(631), 50); // 50.48
});

test('tax-rounding bug truncates', () => {
  assert.equal(tax(249, bugs('tax-rounding')), 19);
  assert.equal(tax(549, bugs('tax-rounding')), 43);
});

test('checkout validation messages', () => {
  assert.equal(validateCheckout({ lastName: 'L', postcode: 'AB1' }).error, 'First name is required');
  assert.equal(validateCheckout({ firstName: 'F', postcode: 'AB1' }).error, 'Last name is required');
  assert.equal(validateCheckout({ firstName: 'F', lastName: 'L', postcode: '   ' }).error, 'Postcode is required');
  assert.match(validateCheckout({ firstName: 'F', lastName: 'L', postcode: '!!' }).error, /Postcode must be/);
  assert.equal(validateCheckout(null).error, 'First name is required');
});

test('checkout validation trims valid values', () => {
  const result = validateCheckout({ firstName: ' Ada ', lastName: 'L', postcode: ' AB1 2CD ' });
  assert.deepEqual(result.values, { firstName: 'Ada', lastName: 'L', postcode: 'AB1 2CD' });
});

test('postcode-optional bug lets an empty postcode through', () => {
  const input = { firstName: 'F', lastName: 'L', postcode: '' };
  assert.ok(validateCheckout(input).error);
  assert.deepEqual(validateCheckout(input, bugs('postcode-optional')).values.postcode, '');
});

test('cart adds each product once and removes the right one', () => {
  const s = session();
  addItem(s, 1); addItem(s, 2); addItem(s, 2);
  assert.deepEqual(s.cart, [1, 2]);
  assert.equal(removeItem(s, 2), true);
  assert.deepEqual(s.cart, [1]);
  assert.equal(s.count, 1);
  assert.equal(removeItem(s, 5), false);
  assert.equal(cartView(s).itemTotal, findProduct(1).price);
});

test('cart-remove bug removes the first item', () => {
  const s = session();
  addItem(s, 1); addItem(s, 2);
  removeItem(s, 2, bugs('cart-remove'));
  assert.deepEqual(s.cart, [2]);
});

test('badge-stale bug leaves the count high after a removal', () => {
  const s = session();
  addItem(s, 1); addItem(s, 2);
  removeItem(s, 1, bugs('badge-stale'));
  assert.equal(s.cart.length, 1);
  assert.equal(s.count, 2);
});

test('flag parsing', () => {
  assert.deepEqual(parseList(' a, b ,,c'), ['a', 'b', 'c']);
  assert.deepEqual(parseList(undefined), []);
  assert.deepEqual([...checkedSet('search', ['search'], 'feature')], ['search']);
  assert.throws(() => checkedSet('nope', ['search'], 'feature'), /Unknown feature "nope"/);
});
