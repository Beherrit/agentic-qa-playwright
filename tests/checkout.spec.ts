import { expect, test } from '../fixtures/test.ts';

const shopper = { firstName: 'Ada', lastName: 'Lovelace', postalCode: '80202' };

/** "Item total: $37.98" -> 37.98 */
const amount = (text: string): number => Number(text.replace(/[^0-9.]/g, ''));

test.describe('Checkout', () => {
  test.beforeEach(async ({ signedIn, cartPage }) => {
    await signedIn.addToCart('Sauce Labs Backpack');
    await signedIn.addToCart('Sauce Labs Onesie');
    await signedIn.openCart();
    await cartPage.checkout();
  });

  test('a shopper can complete an order', async ({ checkoutPage }) => {
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();
    await expect(checkoutPage.title).toHaveText('Checkout: Overview');

    await checkoutPage.finish();

    await expect(checkoutPage.confirmation).toHaveText('Thank you for your order!');
    await expect(checkoutPage.cartBadge).toBeHidden();
  });

  test('the total is the item total plus tax', async ({ checkoutPage }) => {
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    // Backpack 29.99 + Onesie 7.99
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $37.98');

    const itemTotal = amount(await checkoutPage.itemTotal.innerText());
    const tax = amount(await checkoutPage.tax.innerText());
    const total = amount(await checkoutPage.total.innerText());
    expect(total).toBeCloseTo(itemTotal + tax, 2);
  });

  for (const [label, field] of [
    ['First Name', 'firstName'],
    ['Last Name', 'lastName'],
    ['Postal Code', 'postalCode'],
  ] as const) {
    test(`${label} is required`, async ({ checkoutPage }) => {
      await checkoutPage.fillShopper({ ...shopper, [field]: '' });
      await checkoutPage.continue();

      await expect(checkoutPage.error).toHaveText(`Error: ${label} is required`);
      await expect(checkoutPage.title).toHaveText('Checkout: Your Information');
    });
  }

  test('cancelling on the overview keeps the cart', async ({ checkoutPage }) => {
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();
    await checkoutPage.cancelButton.click();

    await expect(checkoutPage.title).toHaveText('Products');
    await expect(checkoutPage.cartBadge).toHaveText('2');
  });
});
