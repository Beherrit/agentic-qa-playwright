import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server.mjs';
import { withServer, client, CHECKOUT } from './helpers.mjs';

// Sign in, add the given product ids, return the client.
async function shopper(base, ...ids) {
  const api = client(base);
  assert.equal((await api.login()).status, 200);
  for (const productId of ids) assert.equal((await api.post('/api/cart', { productId })).status, 201);
  return api;
}
const ids = (res) => res.data.products.map((p) => p.id);
const prices = (res) => res.data.products.map((p) => p.price);
const numeric = (list) => [...list].sort((a, b) => a - b);

test('login: good, wrong password, locked user', async () => {
  await withServer({}, async (base) => {
    const api = client(base);
    const ok = await api.login();
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data, { username: 'shopper' });
    assert.match(ok.headers.getSetCookie()[0], /HttpOnly/);
    assert.equal((await api.get('/api/session')).status, 200);

    const wrong = await client(base).login('shopper', 'nope');
    assert.equal(wrong.status, 401);
    assert.match(wrong.data.error, /incorrect/);

    const locked = await client(base).login('locked');
    assert.equal(locked.status, 403);
    assert.match(locked.data.error, /locked out/);
  });
});

test('logout ends the session', async () => {
  await withServer({}, async (base) => {
    const api = await shopper(base);
    assert.equal((await api.post('/api/logout')).status, 200);
    assert.equal((await api.get('/api/cart')).status, 401);
  });
});

test('protected routes return 401 when not signed in', async () => {
  await withServer({}, async (base) => {
    const api = client(base);
    const routes = [['get', '/api/session'], ['get', '/api/cart'], ['post', '/api/cart'], ['del', '/api/cart/1'], ['post', '/api/orders'], ['get', '/api/orders']];
    for (const [method, path] of routes) {
      const res = await api[method](path);
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.ok(res.data.error);
    }
  });
});

test('products: list, sorting, detail, 404 and bad sort', async () => {
  await withServer({}, async (base) => {
    const api = client(base);
    assert.equal((await api.get('/api/products')).data.products.length, 8);
    const asc = prices(await api.get('/api/products?sort=price-asc'));
    assert.deepEqual(asc, numeric(asc));
    const names = (await api.get('/api/products?sort=name-desc')).data.products.map((p) => p.name);
    assert.deepEqual(names, [...names].sort((a, b) => b.localeCompare(a)));
    assert.equal((await api.get('/api/products/4')).data.name, 'Ground Coffee 500 g');
    assert.equal((await api.get('/api/products/99')).status, 404);
    assert.equal((await api.get('/api/products/abc')).status, 404);
    assert.equal((await api.get('/api/products?sort=size')).status, 400);
    assert.equal((await api.get('/api/nothing')).status, 404);
  });
});

test('cart: add, repeat add, remove, errors, count', async () => {
  await withServer({}, async (base) => {
    const api = await shopper(base, 1, 2);
    await api.post('/api/cart', { productId: 2 }); // adding twice keeps one line
    const cart = (await api.get('/api/cart')).data;
    assert.deepEqual(cart.items.map((i) => i.productId), [1, 2]);
    assert.equal(cart.count, 2);
    assert.equal(cart.itemTotal, 549 + 249);

    const removed = await api.del('/api/cart/2');
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.data.items.map((i) => i.productId), [1]);
    assert.equal(removed.data.count, 1);

    assert.equal((await api.del('/api/cart/2')).status, 404);
    assert.equal((await api.post('/api/cart', { productId: 99 })).status, 404);
    assert.equal((await api.post('/api/cart', {})).status, 400);
  });
});

test('carts are separate per session', async () => {
  await withServer({}, async (base) => {
    await shopper(base, 1);
    const other = await shopper(base);
    assert.equal((await other.get('/api/cart')).data.count, 0);
  });
});

test('order: totals, cart is emptied, order is listed', async () => {
  await withServer({}, async (base) => {
    const api = await shopper(base, 2, 4); // 249 + 1099 = 1348, tax 107.84 rounds to 108
    const res = await api.post('/api/orders', CHECKOUT);
    assert.equal(res.status, 201);
    assert.deepEqual(res.data, { id: 1001, itemTotal: 1348, tax: 108, total: 1456 });
    assert.equal((await api.get('/api/cart')).data.count, 0);
    const orders = (await api.get('/api/orders')).data.orders;
    assert.equal(orders.length, 1);
    assert.equal(orders[0].lastName, 'Lovelace');
  });
});

test('order: validation errors and empty cart give 400 with an error', async () => {
  await withServer({}, async (base) => {
    const api = await shopper(base, 1);
    const cases = [
      [{ ...CHECKOUT, firstName: '' }, 'First name is required'],
      [{ ...CHECKOUT, lastName: ' ' }, 'Last name is required'],
      [{ ...CHECKOUT, postcode: '' }, 'Postcode is required'],
    ];
    for (const [body, error] of cases) {
      const res = await api.post('/api/orders', body);
      assert.equal(res.status, 400);
      assert.equal(res.data.error, error);
    }
    assert.equal((await api.get('/api/cart')).data.count, 1, 'a failed order keeps the cart');
    assert.equal((await api.post('/api/orders', CHECKOUT)).status, 201);
    const empty = await api.post('/api/orders', CHECKOUT);
    assert.equal(empty.status, 400);
    assert.equal(empty.data.error, 'Your cart is empty');
  });
});

test('bad JSON gives 400', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(base + '/api/login', { method: 'POST', body: '{nope' });
    assert.equal(res.status, 400);
  });
});

test('test hooks: state is empty by default, reset clears carts and orders', async () => {
  await withServer({}, async (base) => {
    const api = await shopper(base, 1);
    assert.deepEqual((await api.get('/api/test/state')).data, { bugs: [], features: [] });
    await api.post('/api/orders', CHECKOUT);
    await api.post('/api/cart', { productId: 3 });
    assert.equal((await api.post('/api/test/reset')).status, 200);
    assert.equal((await api.get('/api/cart')).data.count, 0);
    assert.deepEqual((await api.get('/api/orders')).data.orders, []);
    assert.equal((await api.get('/api/session')).status, 200, 'reset keeps people signed in');
  });
});

test('static frontend is served and stays inside public/', async () => {
  await withServer({}, async (base) => {
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html lang="en">/);
    assert.equal((await fetch(base + '/app.js')).status, 200);
    assert.equal((await fetch(base + '/..%2Fserver.mjs')).status, 404);
    assert.equal((await fetch(base + '/missing.html')).status, 404);
  });
});

test('unknown bug or feature names are rejected', () => {
  assert.throws(() => start({ port: 0, bugs: ['nope'] }), /Unknown bug "nope"/);
  assert.throws(() => start({ port: 0, features: ['nope'] }), /Unknown feature "nope"/);
});

// Seeded bugs: each one really changes behaviour when switched on.

test('bug sort-price: price sorting uses string order', async () => {
  await withServer({}, async (base) => {
    const asc = prices(await client(base).get('/api/products?sort=price-asc'));
    assert.deepEqual(asc, numeric(asc));
  });
  await withServer({ bugs: ['sort-price'] }, async (base) => {
    const api = client(base);
    assert.deepEqual((await api.get('/api/test/state')).data.bugs, ['sort-price']);
    const asc = prices(await api.get('/api/products?sort=price-asc'));
    assert.notDeepEqual(asc, numeric(asc));
    assert.ok(asc.indexOf(1099) < asc.indexOf(249));
  });
});

test('bug tax-rounding: tax is truncated', async () => {
  const taxFor = async (options) => {
    let tax;
    await withServer(options, async (base) => {
      const api = await shopper(base, 2); // 249 gives 19.92
      tax = (await api.post('/api/orders', CHECKOUT)).data.tax;
    });
    return tax;
  };
  assert.equal(await taxFor({}), 20);
  assert.equal(await taxFor({ bugs: ['tax-rounding'] }), 19);
});

test('bug cart-remove: removes the first item, not the asked one', async () => {
  const left = async (options) => {
    let remaining;
    await withServer(options, async (base) => {
      const api = await shopper(base, 1, 2);
      remaining = (await api.del('/api/cart/2')).data.items.map((i) => i.productId);
    });
    return remaining;
  };
  assert.deepEqual(await left({}), [1]);
  assert.deepEqual(await left({ bugs: ['cart-remove'] }), [2]);
});

test('bug postcode-optional: empty postcode is accepted', async () => {
  const statusFor = async (options) => {
    let status;
    await withServer(options, async (base) => {
      const api = await shopper(base, 1);
      status = (await api.post('/api/orders', { ...CHECKOUT, postcode: '' })).status;
    });
    return status;
  };
  assert.equal(await statusFor({}), 400);
  assert.equal(await statusFor({ bugs: ['postcode-optional'] }), 201);
});

test('bug badge-stale: count does not go down after a removal', async () => {
  const countAfterRemove = async (options) => {
    let count;
    await withServer(options, async (base) => {
      const api = await shopper(base, 1, 2);
      count = (await api.del('/api/cart/1')).data.count;
      assert.equal((await api.get('/api/cart')).data.count, count);
    });
    return count;
  };
  assert.equal(await countAfterRemove({}), 1);
  assert.equal(await countAfterRemove({ bugs: ['badge-stale'] }), 2);
});

// Feature flag: search.

test('feature search is off by default: q is ignored and the page has no search box', async () => {
  await withServer({}, async (base) => {
    const api = client(base);
    assert.equal(ids(await api.get('/api/products?q=milk')).length, 8);
    assert.deepEqual((await api.get('/api/config')).data.features, []);
    const html = await (await fetch(base + '/')).text();
    assert.ok(!html.includes('product-search'));
  });
});

test('feature search on: q narrows the list, case-insensitively', async () => {
  await withServer({ features: ['search'] }, async (base) => {
    const api = client(base);
    assert.deepEqual((await api.get('/api/test/state')).data.features, ['search']);
    assert.deepEqual((await api.get('/api/config')).data.features, ['search']);
    assert.deepEqual(ids(await api.get('/api/products?q=MILK')), [2]);
    assert.deepEqual(ids(await api.get('/api/products?q=zzz')), []);
    assert.equal(ids(await api.get('/api/products?q=')).length, 8);
    assert.deepEqual(prices(await api.get('/api/products?q=e&sort=price-desc')), numeric(prices(await api.get('/api/products?q=e'))).reverse());
  });
});
