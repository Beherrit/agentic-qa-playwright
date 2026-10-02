// Shared test helpers: start a server on a random port and talk to it with a cookie jar.
import { once } from 'node:events';
import { start, PASSWORD } from '../server.mjs';

export async function withServer(options, run) {
  const server = start({ port: 0, ...options });
  await once(server, 'listening');
  const base = `http://localhost:${server.address().port}`;
  try {
    await run(base);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

// A tiny API client that keeps the session cookie between calls.
export function client(base) {
  let cookie = '';
  async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie()[0];
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* not JSON, keep the text */ }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (path) => call('GET', path),
    post: (path, body = {}) => call('POST', path, body),
    del: (path) => call('DELETE', path),
    login: (username = 'shopper', password = PASSWORD) => call('POST', '/api/login', { username, password }),
  };
}

export const CHECKOUT = { firstName: 'Ada', lastName: 'Lovelace', postcode: 'AB1 2CD' };
