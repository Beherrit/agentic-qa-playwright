// Pantry frontend: hash-routed, and every piece of data comes from /api.
const main = document.getElementById('main');
const nav = document.getElementById('nav');
const badge = document.getElementById('cart-badge');
const state = { user: null, features: [], cart: { items: [], count: 0, itemTotal: 0 }, sort: 'name-asc', q: '' };

const SORT_LABELS = [
  ['name-asc', 'Name (A to Z)'],
  ['name-desc', 'Name (Z to A)'],
  ['price-asc', 'Price (low to high)'],
  ['price-desc', 'Price (high to low)'],
];
const COLOURS = { bakery: '#f1d9a8', dairy: '#cfe3f7', pantry: '#f7e08a', produce: '#bfe8c4' };
const money = (cents) => '$' + (cents / 100).toFixed(2);

// Tiny element builder. `test` becomes data-test, `onxxx` becomes an event listener.
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'test') el.dataset.test = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...kids.flat().filter((kid) => kid != null && kid !== false));
  return el;
}

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.user) signedOut();
  return { ok: res.ok, status: res.status, data };
}

function signedOut() {
  state.user = null;
  state.cart = { items: [], count: 0, itemTotal: 0 };
  location.hash = '#/login';
}

function showBadge() {
  badge.textContent = String(state.cart.count);
}

async function loadCart() {
  const res = await api('GET', '/cart');
  if (res.ok) state.cart = res.data;
  showBadge();
}

async function changeCart(method, id) {
  const res = method === 'POST' ? await api('POST', '/cart', { productId: id }) : await api('DELETE', '/cart/' + id);
  if (res.ok) state.cart = res.data;
  showBadge();
}

const inCart = (id) => state.cart.items.some((item) => item.productId === id);

// One alert element at a time, placed just above the form's submit button.
function showError(form, message) {
  form.querySelector('[data-test="error"]')?.remove();
  const alert = h('p', { role: 'alert', class: 'error', test: 'error' }, message);
  form.querySelector('button[type="submit"]').before(alert);
}

function field(id, label, extra = {}) {
  return h('div', {}, h('label', { for: id }, label), h('input', { id, name: id, type: 'text', test: extra.test ?? id, ...extra }));
}

function cartButton(product, after) {
  const has = inCart(product.id);
  return h('button', {
    type: 'button',
    class: has ? 'secondary' : '',
    test: has ? 'remove-from-cart' : 'add-to-cart',
    onclick: async () => { await changeCart(has ? 'DELETE' : 'POST', product.id); after(); },
  }, has ? 'Remove' : 'Add to cart', h('span', { class: 'sr' }, ' ' + product.name));
}

const swatch = (product) =>
  h('div', { class: 'swatch', role: 'img', 'aria-label': 'Illustration of ' + product.name, style: 'background:' + COLOURS[product.category] });

// ---- views: each returns [page title, ...nodes] ----

const views = {};

views.login = async () => {
  const form = h('form', { novalidate: true, test: 'login-form' },
    field('username', 'Username', { autocomplete: 'username' }),
    h('div', {}, h('label', { for: 'password' }, 'Password'),
      h('input', { id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', test: 'password' })),
    h('button', { type: 'submit', test: 'login' }, 'Sign in'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const res = await api('POST', '/login', { username: form.username.value, password: form.password.value });
    if (!res.ok) return showError(form, res.data.error);
    state.user = res.data.username;
    await loadCart();
    location.hash = '#/products';
  });
  return ['Sign in', h('h1', {}, 'Sign in'), form,
    h('section', { class: 'hint', 'aria-labelledby': 'hint-title' },
      h('h2', { id: 'hint-title' }, 'Demo accounts'),
      h('p', {}, 'Usernames: ', h('code', {}, 'shopper'), ' or ', h('code', {}, 'locked'), ' (locked out).'),
      h('p', {}, 'Password for all accounts: ', h('code', {}, 'pantry123')))];
};

views.products = async () => {
  const searchOn = state.features.includes('search');
  const list = h('ul', { class: 'grid', test: 'product-list' });
  const status = h('div', { 'aria-live': 'polite' });
  let current = [];
  let latest = 0;

  const paint = () => {
    list.replaceChildren(...current.map((p) =>
      h('li', { class: 'card', test: 'product-card', 'data-product-id': p.id },
        swatch(p),
        h('h2', {}, h('a', { href: '#/product/' + p.id, test: 'product-name' }, p.name)),
        h('p', { class: 'muted' }, p.description),
        h('p', { class: 'price', test: 'product-price' }, money(p.price)),
        cartButton(p, paint))));
    status.replaceChildren(current.length || !searchOn ? '' : h('p', { test: 'no-results' }, 'No products found'));
  };

  async function load() {
    const mine = ++latest; // ignore slow answers that arrive after a newer request
    const params = new URLSearchParams({ sort: state.sort });
    if (searchOn && state.q) params.set('q', state.q);
    const res = await api('GET', '/products?' + params);
    if (mine !== latest || !res.ok) return;
    current = res.data.products;
    paint();
  }

  const sort = h('select', { id: 'sort', test: 'sort', onchange: (e) => { state.sort = e.target.value; load(); } },
    SORT_LABELS.map(([value, label]) => h('option', { value, selected: value === state.sort }, label)));
  const search = searchOn && h('div', {}, h('label', { for: 'search' }, 'Search'),
    h('input', { id: 'search', type: 'search', placeholder: 'Search products', autocomplete: 'off', value: state.q, test: 'product-search',
      oninput: (e) => { state.q = e.target.value; load(); } }));

  await load();
  return ['Products', h('h1', {}, 'Products'),
    h('div', { class: 'controls' }, search, h('div', {}, h('label', { for: 'sort' }, 'Sort by'), sort)),
    status, list];
};

views.product = async (id) => {
  const res = await api('GET', '/products/' + id);
  if (!res.ok) return views.missing();
  const p = res.data;
  const box = h('div', {});
  const paint = () => box.replaceChildren(
    h('p', { class: 'price', test: 'product-price' }, money(p.price)),
    h('p', {}, 'Category: ', h('span', { test: 'product-category' }, p.category)),
    cartButton(p, paint));
  paint();
  return [p.name, h('h1', { test: 'product-name' }, p.name), swatch(p), h('p', { test: 'product-description' }, p.description), box,
    h('p', {}, h('a', { href: '#/products' }, 'Back to products'))];
};

views.cart = async () => {
  await loadCart();
  const { items, itemTotal } = state.cart;
  if (!items.length) {
    return ['Cart', h('h1', {}, 'Your cart'), h('p', { test: 'cart-empty' }, 'Your cart is empty.'),
      h('a', { href: '#/products' }, 'Continue shopping')];
  }
  const rows = items.map((item) => h('tr', { test: 'cart-item' },
    h('td', { test: 'cart-item-name' }, item.name),
    h('td', { test: 'cart-item-price' }, money(item.price)),
    h('td', {}, h('button', { type: 'button', class: 'secondary', test: 'remove-from-cart',
      onclick: async () => { await changeCart('DELETE', item.productId); render(); } }, 'Remove', h('span', { class: 'sr' }, ' ' + item.name)))));
  return ['Cart', h('h1', {}, 'Your cart'),
    h('table', { test: 'cart-items' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'Price'), h('th', {}, h('span', { class: 'sr' }, 'Actions')))),
      h('tbody', {}, rows)),
    h('p', {}, 'Item total: ', h('strong', { test: 'cart-total' }, money(itemTotal))),
    h('p', {}, h('a', { class: 'button', href: '#/checkout', test: 'checkout' }, 'Checkout'), ' ',
      h('a', { href: '#/products' }, 'Continue shopping'))];
};

views.checkout = async () => {
  const form = h('form', { novalidate: true, test: 'checkout-form' },
    field('first-name', 'First name', { autocomplete: 'given-name' }),
    field('last-name', 'Last name', { autocomplete: 'family-name' }),
    field('postcode', 'Postcode', { autocomplete: 'postal-code' }),
    h('button', { type: 'submit', test: 'place-order' }, 'Place order'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const res = await api('POST', '/orders', {
      firstName: form['first-name'].value, lastName: form['last-name'].value, postcode: form.postcode.value,
    });
    if (!res.ok) return showError(form, res.data.error);
    await loadCart();
    location.hash = '#/order/' + res.data.id;
  });
  return ['Checkout', h('h1', {}, 'Checkout'), form];
};

views.order = async (id) => {
  const res = await api('GET', '/orders');
  const order = res.data.orders?.find((o) => String(o.id) === id);
  if (!order) return views.missing();
  const row = (label, test, cents) => [h('dt', {}, label), h('dd', { test }, money(cents))];
  return ['Order confirmed', h('section', { test: 'order-confirmation', 'aria-labelledby': 'done' },
    h('h1', { id: 'done' }, 'Thank you for your order'),
    h('p', {}, 'Order number: ', h('strong', { test: 'order-id' }, String(order.id))),
    h('dl', { class: 'summary' }, row('Item total', 'item-total', order.itemTotal), row('Tax (8%)', 'tax', order.tax), row('Total', 'total', order.total)),
    h('p', {}, h('a', { href: '#/products' }, 'Continue shopping')))];
};

views.missing = async () => ['Not found', h('h1', {}, 'Page not found'), h('a', { href: '#/products' }, 'Back to products')];

// ---- routing ----

let renderCount = 0;
async function render() {
  const [, name, arg] = (location.hash || '#/products').match(/^#\/(\w+)(?:\/([\w-]+))?/) ?? [];
  if (!state.user && name !== 'login') { location.hash = '#/login'; return; }
  if (state.user && name === 'login') { location.hash = '#/products'; return; }
  const mine = ++renderCount;
  const [title, ...nodes] = await (views[name] ?? views.missing)(arg);
  if (mine !== renderCount) return; // a newer navigation won
  document.title = title + ' | Pantry';
  nav.hidden = !state.user;
  showBadge();
  main.replaceChildren(...nodes);
  main.focus();
}

document.getElementById('sign-out').addEventListener('click', async () => {
  await api('POST', '/logout');
  signedOut();
});

async function boot() {
  const [config, session] = await Promise.all([api('GET', '/config'), api('GET', '/session')]);
  state.features = config.data.features ?? [];
  if (session.ok) {
    state.user = session.data.username;
    await loadCart();
  }
  addEventListener('hashchange', render);
  render();
}
boot();
