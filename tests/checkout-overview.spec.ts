import { expect, test } from '../fixtures/test.ts';
import type { CartPage } from '../pages/CartPage.ts';
import type { CheckoutPage } from '../pages/CheckoutPage.ts';
import type { InventoryPage } from '../pages/InventoryPage.ts';

const BACKPACK = 'Sauce Labs Backpack';
const ONESIE = 'Sauce Labs Onesie';
const BOLT = 'Sauce Labs Bolt T-Shirt';
const SHOPPER = { firstName: 'Ada', lastName: 'Lovelace', postalCode: '80202' };

async function startCheckout(inventory: InventoryPage, cart: CartPage, products: string[]): Promise<void> {
  for (const product of products) await inventory.addToCart(product);
  await inventory.openCart();
  await cart.checkout();
}

async function reachOverview(inventory: InventoryPage, cart: CartPage, checkout: CheckoutPage, products: string[]): Promise<void> {
  await startCheckout(inventory, cart, products);
  await checkout.fillShopper(SHOPPER);
  await checkout.continue();
  await expect(checkout.title).toHaveText('Checkout: Overview');
}

async function placeOrder(inventory: InventoryPage, cart: CartPage, checkout: CheckoutPage): Promise<void> {
  await reachOverview(inventory, cart, checkout, [BACKPACK, ONESIE]);
  await checkout.finish();
  await expect(checkout.confirmation).toBeVisible();
}

test.describe('Checkout overview and order confirmation', { tag: '@REQ-31' }, () => {
  test('the overview lists exactly the two items in the cart with name and price', { tag: '@AC-1' }, async ({ signedIn, cartPage, checkoutPage }) => {
    await reachOverview(signedIn, cartPage, checkoutPage, [BACKPACK, ONESIE]);

    await expect(cartPage.items).toHaveCount(2);
    await expect(cartPage.itemPrice(BACKPACK)).toHaveText('$29.99');
    await expect(cartPage.itemPrice(ONESIE)).toHaveText('$7.99');
  });

  test('the overview shows payment, shipping and the exact amounts', { tag: '@AC-2' }, async ({ signedIn, cartPage, checkoutPage }) => {
    await reachOverview(signedIn, cartPage, checkoutPage, [BACKPACK, ONESIE]);

    await expect(checkoutPage.paymentInfo).toBeVisible();
    await expect(checkoutPage.paymentInfo).not.toBeEmpty();
    await expect(checkoutPage.shippingInfo).toBeVisible();
    await expect(checkoutPage.shippingInfo).not.toBeEmpty();
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $37.98');
    await expect(checkoutPage.tax).toHaveText('Tax: $3.04');
    await expect(checkoutPage.total).toHaveText('Total: $41.02');
  });

  test('Finish shows the confirmation with a Back Home button', { tag: '@AC-3' }, async ({ signedIn, cartPage, checkoutPage, page }) => {
    await reachOverview(signedIn, cartPage, checkoutPage, [BACKPACK, ONESIE]);

    await checkoutPage.finish();

    await expect(page).toHaveURL(/\/checkout-complete\.html$/);
    await expect(checkoutPage.confirmation).toHaveText('Thank you for your order!');
    await expect(checkoutPage.backHomeButton).toBeVisible();
  });

  test('Back Home returns to the product list with an empty cart', { tag: '@AC-4' }, async ({ signedIn, cartPage, checkoutPage }) => {
    await placeOrder(signedIn, cartPage, checkoutPage);

    await checkoutPage.backHomeButton.click();

    await expect(signedIn.title).toHaveText('Products');
    await expect(signedIn.cartBadge).toBeHidden();
    await signedIn.openCart();
    await expect(cartPage.items).toHaveCount(0);
  });

  test('Cancel on the overview keeps both items in the cart', { tag: '@AC-5' }, async ({ signedIn, cartPage, checkoutPage }) => {
    await reachOverview(signedIn, cartPage, checkoutPage, [BACKPACK, ONESIE]);

    await checkoutPage.cancelButton.click();

    await expect(signedIn.title).toHaveText('Products');
    await expect(signedIn.cartBadge).toHaveText('2');
    await signedIn.openCart();
    await expect(cartPage.itemNames).toHaveText([BACKPACK, ONESIE]);
  });

  test('Cancel on step one returns to the cart with both items', { tag: '@AC-6' }, async ({ signedIn, cartPage, checkoutPage, page }) => {
    await startCheckout(signedIn, cartPage, [BACKPACK, ONESIE]);
    await expect(checkoutPage.title).toHaveText('Checkout: Your Information');

    await checkoutPage.cancelButton.click();

    await expect(page).toHaveURL(/\/cart\.html$/);
    await expect(cartPage.itemNames).toHaveText([BACKPACK, ONESIE]);
  });

  test('a single-item order shows totals matching that one price', { tag: '@AC-7' }, async ({ signedIn, cartPage, checkoutPage }) => {
    await reachOverview(signedIn, cartPage, checkoutPage, [BOLT]);

    await expect(cartPage.items).toHaveCount(1);
    await expect(cartPage.itemNames).toHaveText([BOLT]);
    await expect(cartPage.itemPrice(BOLT)).toHaveText('$15.99');
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $15.99');
    await expect(checkoutPage.tax).toHaveText('Tax: $1.28');
    await expect(checkoutPage.total).toHaveText('Total: $17.27');
  });

  for (const field of ['First Name', 'Last Name', 'Postal Code'] as const) {
    test(`step one blocks Continue when ${field} is empty`, { tag: '@AC-8' }, async ({ signedIn, cartPage, checkoutPage, page }) => {
      await startCheckout(signedIn, cartPage, [BACKPACK, ONESIE]);
      await checkoutPage.fillShopper(SHOPPER);
      const fields = { 'First Name': checkoutPage.firstName, 'Last Name': checkoutPage.lastName, 'Postal Code': checkoutPage.postalCode };
      await fields[field].clear();

      await checkoutPage.continue();

      await expect(checkoutPage.error).toContainText(`${field} is required`);
      await expect(checkoutPage.title).toHaveText('Checkout: Your Information');
      await expect(page).toHaveURL(/\/checkout-step-one\.html$/);
    });
  }

  test('the cart is still empty after reloading following an order', { tag: '@AC-9' }, async ({ signedIn, cartPage, checkoutPage, page }) => {
    await placeOrder(signedIn, cartPage, checkoutPage);
    await checkoutPage.backHomeButton.click();
    await expect(signedIn.title).toHaveText('Products');

    await page.reload();

    await expect(signedIn.title).toHaveText('Products');
    await expect(signedIn.cartBadge).toBeHidden();

    await signedIn.openCart();
    await expect(cartPage.items).toHaveCount(0);
    await page.reload();
    await expect(cartPage.items).toHaveCount(0);
    await expect(cartPage.cartBadge).toBeHidden();
  });

  test('a second order lists only the new product and its own totals', { tag: '@AC-10' }, async ({ signedIn, cartPage, checkoutPage }) => {
    await placeOrder(signedIn, cartPage, checkoutPage);
    await checkoutPage.backHomeButton.click();
    await expect(signedIn.title).toHaveText('Products');

    await reachOverview(signedIn, cartPage, checkoutPage, [BOLT]);

    await expect(cartPage.itemNames).toHaveText([BOLT]);
    await expect(cartPage.item(BACKPACK)).toHaveCount(0);
    await expect(cartPage.item(ONESIE)).toHaveCount(0);
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $15.99');
    await expect(checkoutPage.tax).toHaveText('Tax: $1.28');
    await expect(checkoutPage.total).toHaveText('Total: $17.27');
  });

  test('records what happens when Checkout is pressed on an empty cart', { tag: '@AC-11' }, async ({ signedIn, cartPage, page }) => {
    await signedIn.openCart();
    await expect(cartPage.items).toHaveCount(0);

    await cartPage.checkout();
    await page.waitForLoadState();

    const observed = `${new URL(page.url()).pathname} (title: ${await page.getByTestId('title').textContent()})`;
    test.info().annotations.push({ type: 'observed', description: observed });
  });
});
