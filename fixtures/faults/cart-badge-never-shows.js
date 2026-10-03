// A fault for the sensitivity gate: the cart badge is removed as soon as it appears, so the app behaves as if
// adding to the cart never counted. Tests that check the badge should fail against this; tests that never
// look at it will not. It runs on every page before the app's own scripts (see fixtures/fault.ts).
//
// It watches `document`, not `document.documentElement`: an init script runs when the document is created,
// before the <html> element exists, and observing a null node throws and silently disarms the fault.
const strip = () => {
  for (const badge of document.querySelectorAll('[data-test="shopping-cart-badge"]')) badge.remove();
};
new MutationObserver(strip).observe(document, { childList: true, subtree: true });
