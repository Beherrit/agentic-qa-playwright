import { expect, test } from '../fixtures/test.ts';
import { PASSWORD, personas } from '../fixtures/personas.ts';
import { namesAtoZ } from '../fixtures/products.ts';
import type { CartPage } from '../pages/CartPage.ts';
import type { CheckoutPage } from '../pages/CheckoutPage.ts';
import type { InventoryPage } from '../pages/InventoryPage.ts';

const BACKPACK = 'Sauce Labs Backpack';
const BIKE_LIGHT = 'Sauce Labs Bike Light';
const FLEECE_JACKET = 'Sauce Labs Fleece Jacket';
const ONESIE = 'Sauce Labs Onesie';

const shopper = { firstName: 'Ada', lastName: 'Lovelace', postalCode: '80202' };

/** "$29.99" or "Item total: $29.99" -> 2999 */
const cents = (text: string): number => Number(text.replace(/[^0-9]/g, ''));

/** Adds the products in the order given and goes through the cart and the information form to the overview. */
async function checkOutWith(inventory: InventoryPage, cart: CartPage, checkout: CheckoutPage, names: string[]): Promise<void> {
  for (const name of names) await inventory.addToCart(name);
  await inventory.openCart();
  await cart.checkout();
  await checkout.fillShopper(shopper);
  await checkout.continue();
}

test.describe('Checkout overview and finishing the order', { tag: '@REQ-57' }, () => {
  test('a single Backpack is listed once with its price and an exact summary', { tag: '@AC-1' }, async ({ signedIn, cartPage, checkoutPage, page }) => {
    await checkOutWith(signedIn, cartPage, checkoutPage, [BACKPACK]);

    await expect(page).toHaveURL(/\/checkout-step-two\.html$/);
    await expect(checkoutPage.items).toHaveCount(1);
    await expect(checkoutPage.itemQuantities).toHaveText(['1']);
    await expect(checkoutPage.itemNames).toHaveText([BACKPACK]);
    await expect(checkoutPage.itemPrices).toHaveText(['$29.99']);
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $29.99');
    await expect(checkoutPage.tax).toHaveText('Tax: $2.40');
    await expect(checkoutPage.total).toHaveText('Total: $32.39');
  });

  test('the overview shows the SauceCard payment and free Pony Express shipping', { tag: '@AC-4' }, async ({ signedIn, cartPage, checkoutPage }) => {
    await checkOutWith(signedIn, cartPage, checkoutPage, [BACKPACK]);

    await expect(checkoutPage.paymentInfo).toHaveText('SauceCard #31337');
    await expect(checkoutPage.shippingInfo).toHaveText('Free Pony Express Delivery!');
  });

  test('three items are listed in the order added with an exact summary', { tag: '@AC-2' }, async ({ signedIn, cartPage, checkoutPage }) => {
    await checkOutWith(signedIn, cartPage, checkoutPage, [BACKPACK, BIKE_LIGHT, ONESIE]);

    await expect(checkoutPage.itemNames).toHaveText([BACKPACK, BIKE_LIGHT, ONESIE]);
    await expect(checkoutPage.itemQuantities).toHaveText(['1', '1', '1']);
    await expect(checkoutPage.itemPrices).toHaveText(['$29.99', '$9.99', '$7.99']);
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $47.97');
    await expect(checkoutPage.tax).toHaveText('Tax: $3.84');
    await expect(checkoutPage.total).toHaveText('Total: $51.81');
  });

  test('with all six products the row prices add up to the item total and item total plus tax is the total', { tag: '@AC-3' }, async ({ signedIn, cartPage, checkoutPage }) => {
    await checkOutWith(signedIn, cartPage, checkoutPage, namesAtoZ);

    await expect(checkoutPage.itemNames).toHaveText(namesAtoZ);
    await expect(checkoutPage.itemQuantities).toHaveText(['1', '1', '1', '1', '1', '1']);
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $129.94');
    await expect(checkoutPage.tax).toHaveText('Tax: $10.40');
    await expect(checkoutPage.total).toHaveText('Total: $140.34');

    const rowSum = (await checkoutPage.itemPrices.allTextContents()).reduce((sum, price) => sum + cents(price), 0);
    const itemTotal = cents(await checkoutPage.itemTotal.innerText());
    const tax = cents(await checkoutPage.tax.innerText());
    const total = cents(await checkoutPage.total.innerText());
    expect(rowSum).toBe(12994);
    expect(rowSum).toBe(itemTotal);
    expect(itemTotal + tax).toBe(14034);
    expect(itemTotal + tax).toBe(total);
  });

  test('Backpack and Onesie show the exact tax and total', { tag: '@AC-3' }, async ({ signedIn, cartPage, checkoutPage }) => {
    await checkOutWith(signedIn, cartPage, checkoutPage, [BACKPACK, ONESIE]);

    await expect(checkoutPage.itemTotal).toHaveText('Item total: $37.98');
    await expect(checkoutPage.tax).toHaveText('Tax: $3.04');
    await expect(checkoutPage.total).toHaveText('Total: $41.02');
  });

  for (const { name, itemTotal, tax, total } of [
    { name: BIKE_LIGHT, itemTotal: 'Item total: $9.99', tax: 'Tax: $0.80', total: 'Total: $10.79' },
    { name: ONESIE, itemTotal: 'Item total: $7.99', tax: 'Tax: $0.64', total: 'Total: $8.63' },
  ]) {
    test(`tax on ${name} alone is rounded to the nearest cent, not truncated`, { tag: '@AC-5' }, async ({ signedIn, cartPage, checkoutPage }) => {
      await checkOutWith(signedIn, cartPage, checkoutPage, [name]);

      await expect(checkoutPage.itemTotal).toHaveText(itemTotal);
      await expect(checkoutPage.tax).toHaveText(tax);
      await expect(checkoutPage.total).toHaveText(total);
    });
  }

  test('Fleece Jacket and Onesie show the exact tax and total', { tag: '@AC-3' }, async ({ signedIn, cartPage, checkoutPage }) => {
    await checkOutWith(signedIn, cartPage, checkoutPage, [FLEECE_JACKET, ONESIE]);

    await expect(checkoutPage.tax).toHaveText('Tax: $4.64');
    await expect(checkoutPage.total).toHaveText('Total: $62.62');
  });

  test('the item total for Fleece Jacket and Onesie is shown with two decimals', { tag: '@AC-3' }, async ({ signedIn, cartPage, checkoutPage }) => {
    test.fail(true, 'bug: two-decimals rule of epic #56, checked under AC-3: the item total for Fleece Jacket and Onesie shows $57.980000000000004 instead of $57.98');
    await checkOutWith(signedIn, cartPage, checkoutPage, [FLEECE_JACKET, ONESIE]);

    await expect(checkoutPage.itemTotal).toHaveText('Item total: $57.98');
  });

  test('Finish shows the confirmation and leaves the cart empty', { tag: '@AC-6' }, async ({ signedIn, cartPage, checkoutPage, page }) => {
    await checkOutWith(signedIn, cartPage, checkoutPage, [BACKPACK, ONESIE]);

    await checkoutPage.finish();

    await expect(page).toHaveURL(/\/checkout-complete\.html$/);
    await expect(checkoutPage.confirmation).toHaveText('Thank you for your order!');
    await expect(checkoutPage.cartBadge).toBeHidden();
    await checkoutPage.openCart();
    await expect(page).toHaveURL(/\/cart\.html$/);
    await expect(cartPage.items).toHaveCount(0);
    await expect(cartPage.cartBadge).toBeHidden();
  });

  test('Back Home shows the product list with Add to cart on every product', { tag: '@AC-7' }, async ({ signedIn, cartPage, checkoutPage, page }) => {
    await checkOutWith(signedIn, cartPage, checkoutPage, [BACKPACK, ONESIE]);
    await checkoutPage.finish();

    await checkoutPage.backHome();

    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expect(signedIn.title).toHaveText('Products');
    await expect(signedIn.addButtons).toHaveCount(6);
    await expect(signedIn.removeButtons).toHaveCount(0);
    await expect(signedIn.cartBadge).toBeHidden();
  });

  test('reloading the confirmation keeps it and keeps the cart empty', { tag: '@AC-8' }, async ({ signedIn, cartPage, checkoutPage, page }) => {
    await checkOutWith(signedIn, cartPage, checkoutPage, [BACKPACK]);
    await checkoutPage.finish();
    await expect(checkoutPage.confirmation).toHaveText('Thank you for your order!');

    await page.reload();

    await expect(page).toHaveURL(/\/checkout-complete\.html$/);
    await expect(checkoutPage.confirmation).toHaveText('Thank you for your order!');
    await expect(checkoutPage.cartBadge).toBeHidden();
    await checkoutPage.openCart();
    await expect(cartPage.items).toHaveCount(0);
  });

  test('browser Back after Finish does not bring the old items back', { tag: '@AC-9' }, async ({ signedIn, cartPage, checkoutPage, page }) => {
    await checkOutWith(signedIn, cartPage, checkoutPage, [BACKPACK, ONESIE]);
    await checkoutPage.finish();
    await expect(checkoutPage.confirmation).toHaveText('Thank you for your order!');

    await page.goBack();

    await expect(checkoutPage.items).toHaveCount(0);
    await expect(checkoutPage.total).toHaveText('Total: $0.00');
    await expect(checkoutPage.cartBadge).toBeHidden();
    await checkoutPage.openCart();
    await expect(cartPage.items).toHaveCount(0);
  });

  test('Finish on the page Back lands on cannot place an order with the old items', { tag: '@AC-9' }, async ({ signedIn, cartPage, checkoutPage, page }) => {
    await checkOutWith(signedIn, cartPage, checkoutPage, [BACKPACK, ONESIE]);
    await checkoutPage.finish();
    await expect(checkoutPage.confirmation).toHaveText('Thank you for your order!');
    await page.goBack();
    await expect(checkoutPage.items).toHaveCount(0);
    await expect(checkoutPage.cartBadge).toBeHidden();

    await checkoutPage.finish();

    await expect(checkoutPage.itemNames.filter({ hasText: BACKPACK })).toHaveCount(0);
    await expect(checkoutPage.itemNames.filter({ hasText: ONESIE })).toHaveCount(0);
    await expect(checkoutPage.cartBadge).toBeHidden();
    await checkoutPage.openCart();
    await expect(page).toHaveURL(/\/cart\.html$/);
    await expect(cartPage.items).toHaveCount(0);
  });

  test('double-clicking Finish gives one confirmation and an empty cart', { tag: '@AC-10' }, async ({ signedIn, cartPage, checkoutPage, page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    await checkOutWith(signedIn, cartPage, checkoutPage, [BACKPACK, BIKE_LIGHT]);

    await checkoutPage.finishButton.dblclick();

    await expect(page).toHaveURL(/\/checkout-complete\.html$/);
    await expect(checkoutPage.confirmation).toHaveCount(1);
    await expect(checkoutPage.confirmation).toHaveText('Thank you for your order!');
    await expect(checkoutPage.error).toBeHidden();
    await expect(checkoutPage.cartBadge).toBeHidden();
    await checkoutPage.openCart();
    await expect(cartPage.items).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('a second order after Back Home lists only the new product', { tag: '@AC-11' }, async ({ signedIn, cartPage, checkoutPage }) => {
    await checkOutWith(signedIn, cartPage, checkoutPage, [BACKPACK, ONESIE]);
    await checkoutPage.finish();
    await checkoutPage.backHome();

    await signedIn.addToCart(FLEECE_JACKET);
    await expect(signedIn.cartBadge).toHaveText('1');
    await signedIn.openCart();
    await cartPage.checkout();
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.itemNames).toHaveText([FLEECE_JACKET]);
    await expect(checkoutPage.itemQuantities).toHaveText(['1']);
    await expect(checkoutPage.itemPrices).toHaveText(['$49.99']);
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $49.99');
    await expect(checkoutPage.tax).toHaveText('Tax: $4.00');
    await expect(checkoutPage.total).toHaveText('Total: $53.99');
  });

  test('removing an item after seeing the overview recalculates the overview', { tag: '@AC-12' }, async ({ signedIn, cartPage, checkoutPage }) => {
    await checkOutWith(signedIn, cartPage, checkoutPage, [BACKPACK, BIKE_LIGHT]);
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $39.98');
    await expect(checkoutPage.tax).toHaveText('Tax: $3.20');
    await expect(checkoutPage.total).toHaveText('Total: $43.18');

    await checkoutPage.openCart();
    await cartPage.remove(BACKPACK);
    await cartPage.checkout();
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.itemNames).toHaveText([BIKE_LIGHT]);
    await expect(checkoutPage.itemPrices).toHaveText(['$9.99']);
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $9.99');
    await expect(checkoutPage.tax).toHaveText('Tax: $0.80');
    await expect(checkoutPage.total).toHaveText('Total: $10.79');
  });

  test('performance_glitch_user can still finish an order', { tag: '@AC-6' }, async ({ loginPage, inventoryPage, cartPage, checkoutPage }) => {
    test.setTimeout(90_000);
    const slow = { timeout: 15_000 };
    await loginPage.goto();
    await loginPage.signIn(personas.slow, PASSWORD);
    await expect(inventoryPage.title).toHaveText('Products', slow);
    await checkOutWith(inventoryPage, cartPage, checkoutPage, [BACKPACK]);

    await expect(checkoutPage.itemTotal).toHaveText('Item total: $29.99', slow);
    await expect(checkoutPage.tax).toHaveText('Tax: $2.40', slow);
    await expect(checkoutPage.total).toHaveText('Total: $32.39', slow);
    await checkoutPage.finish();

    await expect(checkoutPage.confirmation).toHaveText('Thank you for your order!', slow);
    await expect(checkoutPage.cartBadge).toBeHidden(slow);
    await checkoutPage.openCart();
    await expect(cartPage.items).toHaveCount(0, slow);
  });
});

// These check the team's assumptions for questions the requirement left open (Q5, Q6), not acceptance criteria.
test.describe('Checkout overview and finishing the order: assumptions without a criterion', { tag: '@REQ-57' }, () => {
  test('the empty overview reached by Back shows the item total with two decimals', { tag: '@Q6' }, async ({ signedIn, cartPage, checkoutPage, page }) => {
    test.fail(true, 'bug: assumption Q6, no criterion (reached by the AC-9 journey): the empty overview shows Item total: $0 instead of $0.00');
    await checkOutWith(signedIn, cartPage, checkoutPage, [BACKPACK]);
    await checkoutPage.finish();
    await expect(checkoutPage.confirmation).toHaveText('Thank you for your order!');
    await page.goBack();
    await expect(checkoutPage.items).toHaveCount(0);

    await expect(checkoutPage.itemTotal).toHaveText('Item total: $0.00');
  });

  test('Finish on the empty overview reached by Back does not confirm an empty order', { tag: '@Q6' }, async ({ signedIn, cartPage, checkoutPage, page }) => {
    test.fail(true, 'bug: assumption Q6, no criterion (reached by the AC-9 journey): Finish on an empty overview confirms an empty order');
    await checkOutWith(signedIn, cartPage, checkoutPage, [BACKPACK]);
    await checkoutPage.finish();
    await expect(checkoutPage.confirmation).toHaveText('Thank you for your order!');
    await page.goBack();
    await expect(checkoutPage.items).toHaveCount(0);
    await expect(checkoutPage.finishButton).toBeVisible();

    await checkoutPage.finish();

    // The app changes the route inside the click handler, so the URL has settled by the time click() returns.
    await expect(page).toHaveURL(/\/checkout-step-two\.html$/);
  });

  test('opening the confirmation page directly does not count as finishing and keeps the cart', { tag: '@Q5' }, async ({ signedIn, cartPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await expect(signedIn.cartBadge).toHaveText('1');

    await page.goto('/checkout-complete.html');

    await expect(page).toHaveURL(/\/checkout-complete\.html$/);
    await expect(signedIn.cartBadge).toHaveText('1');
    await signedIn.openCart();
    await expect(cartPage.itemNames).toHaveText([BACKPACK]);
    await expect(cartPage.cartBadge).toHaveText('1');
  });
});
