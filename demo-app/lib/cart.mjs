// Cart logic on a session object: { cart: [productId], count, orders }.
// The cart holds each product at most once, like a simple shop.
import { findProduct } from './catalog.mjs';
import { itemTotal } from './pricing.mjs';

export function addItem(session, id) {
  if (!session.cart.includes(id)) session.cart.push(id);
  session.count = session.cart.length;
}

export function removeItem(session, id, bugs = new Set()) {
  const index = session.cart.indexOf(id);
  if (index === -1) return false;
  // BUG(cart-remove): removes the first item in the cart instead of the one asked for
  session.cart.splice(bugs.has('cart-remove') ? 0 : index, 1);
  // BUG(badge-stale): the count is only refreshed on add, so it stays high after a removal
  if (!bugs.has('badge-stale')) session.count = session.cart.length;
  return true;
}

export function clearCart(session) {
  session.cart = [];
  session.count = 0;
}

export function cartItems(session) {
  return session.cart.map((id) => {
    const { name, price } = findProduct(id);
    return { productId: id, name, price };
  });
}

export function cartView(session) {
  const items = cartItems(session);
  return { items, count: session.count, itemTotal: itemTotal(items) };
}
