// Pantry demo shop: a static frontend plus a small JSON API, plain Node only.
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRODUCTS, SORTS, findProduct, sortProducts, searchProducts } from './lib/catalog.mjs';
import { addItem, removeItem, clearCart, cartItems, cartView } from './lib/cart.mjs';
import { totals } from './lib/pricing.mjs';
import { validateCheckout } from './lib/validation.mjs';
import { BUGS, FEATURES, checkedSet, parseList } from './lib/flags.mjs';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
export const PASSWORD = 'pantry123';
const ACCOUNTS = new Map([['shopper', { locked: false }], ['locked', { locked: true }]]);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const fail = (status, error) => { throw Object.assign(new Error(error), { status }); };
const newSession = (username) => ({ username, cart: [], count: 0, orders: [] });

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) fail(413, 'Request body too large');
  }
  if (!raw) return {};
  let body;
  try { body = JSON.parse(raw); } catch { fail(400, 'Request body is not valid JSON'); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Request body must be a JSON object');
  return body;
}

// Each route handler returns [status, data]. The last argument, auth, requires a session.
function buildRoutes(ctx) {
  const { bugs, features } = ctx;
  const routes = [];
  const route = (method, pattern, handler, auth = false) =>
    routes.push({ method, re: new RegExp(`^${pattern}$`), handler, auth });
  const productId = (raw) => (/^\d+$/.test(String(raw)) ? Number(raw) : NaN);
  const existingProduct = (raw) => findProduct(productId(raw)) ?? fail(404, 'Product not found');

  route('GET', '/api/config', () => [200, { features: [...features] }]);

  route('POST', '/api/login', ({ body, setCookie }) => {
    const account = ACCOUNTS.get(body.username);
    if (!account || body.password !== PASSWORD) fail(401, 'Username or password is incorrect');
    if (account.locked) fail(403, 'Sorry, this user has been locked out');
    const sid = randomUUID();
    ctx.sessions.set(sid, newSession(body.username));
    setCookie(`sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
    return [200, { username: body.username }];
  });

  route('POST', '/api/logout', ({ sid, setCookie }) => {
    ctx.sessions.delete(sid);
    setCookie('sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
    return [200, { ok: true }];
  });

  route('GET', '/api/session', ({ session }) => [200, { username: session.username }], true);

  route('GET', '/api/products', ({ query }) => {
    const sort = query.get('sort') ?? 'name-asc';
    if (!SORTS.includes(sort)) fail(400, `sort must be one of ${SORTS.join(', ')}`);
    // The q parameter only exists when the search feature is on.
    const found = features.has('search') ? searchProducts(PRODUCTS, query.get('q')) : PRODUCTS;
    return [200, { products: sortProducts(found, sort, bugs) }];
  });
  route('GET', '/api/products/([^/]+)', ({ params }) => [200, existingProduct(params[0])]);

  route('GET', '/api/cart', ({ session }) => [200, cartView(session)], true);
  route('POST', '/api/cart', ({ body, session }) => {
    if (body.productId === undefined) fail(400, 'productId is required');
    addItem(session, existingProduct(body.productId).id);
    return [201, cartView(session)];
  }, true);
  route('DELETE', '/api/cart/([^/]+)', ({ params, session }) => {
    if (!removeItem(session, productId(params[0]), bugs)) fail(404, 'Product is not in the cart');
    return [200, cartView(session)];
  }, true);

  route('POST', '/api/orders', ({ body, session }) => {
    const { error, values } = validateCheckout(body, bugs);
    if (error) fail(400, error);
    const items = cartItems(session);
    if (items.length === 0) fail(400, 'Your cart is empty');
    const order = { id: ctx.nextOrderId++, ...values, items, ...totals(items, bugs) };
    session.orders.push(order);
    clearCart(session);
    return [201, { id: order.id, itemTotal: order.itemTotal, tax: order.tax, total: order.total }];
  }, true);
  route('GET', '/api/orders', ({ session }) => [200, { orders: session.orders }], true);

  // Test hooks: read what is switched on, and wipe carts and orders between tests.
  route('GET', '/api/test/state', () => [200, { bugs: [...bugs], features: [...features] }]);
  route('POST', '/api/test/reset', () => {
    for (const s of ctx.sessions.values()) { clearCart(s); s.orders = []; }
    ctx.nextOrderId = 1001;
    return [200, { ok: true }];
  });
  return routes;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

async function handleApi(req, res, url, ctx, routes) {
  const sid = parseCookies(req.headers.cookie).sid;
  const headers = {};
  try {
    let match;
    const found = routes.find((r) => r.method === req.method && (match = r.re.exec(url.pathname)));
    if (!found) fail(404, 'Not found');
    const session = ctx.sessions.get(sid);
    if (found.auth && !session) fail(401, 'You are not signed in');
    const body = req.method === 'POST' ? await readBody(req) : {};
    const setCookie = (value) => { headers['Set-Cookie'] = value; };
    const [status, data] = found.handler({ body, query: url.searchParams, params: match.slice(1), session, sid, setCookie });
    send(res, status, data, headers);
  } catch (err) {
    if (!err.status) console.error(err);
    send(res, err.status ?? 500, { error: err.status ? err.message : 'Internal server error' });
  }
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
  try {
    const file = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : decodeURIComponent(pathname));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new Error('outside public dir');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

export function start({ port = 4173, bugs = [], features = [] } = {}) {
  const ctx = {
    bugs: checkedSet(bugs, BUGS, 'bug'),
    features: checkedSet(features, FEATURES, 'feature'),
    sessions: new Map(),
    nextOrderId: 1001,
  };
  const routes = buildRoutes(ctx);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) handleApi(req, res, url, ctx, routes);
    else serveStatic(req, res, url.pathname);
  });
  server.listen(port);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = process.env.PORT === undefined ? 4173 : Number(process.env.PORT);
  const bugs = parseList(process.env.BUGS);
  const features = parseList(process.env.FEATURES);
  start({ port, bugs, features }).on('listening', () => {
    console.log(`Pantry running at http://localhost:${port}`);
    console.log(`Bugs on: ${bugs.join(', ') || 'none'}. Features on: ${features.join(', ') || 'none'}.`);
  });
}
