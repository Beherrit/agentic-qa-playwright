import { expect, test } from '../fixtures/test.ts';
import { defaultUser, PASSWORD } from '../fixtures/personas.ts';

const shopper = { firstName: 'Ada', lastName: 'Lovelace', postalCode: '80202' };

// Backpack 29.99 + Onesie 7.99 = 37.98. With SAVE10 (assumed tax on the discounted amount, Q1):
// discount 3.80, discounted 34.18, tax 2.73, total 36.91.

test.describe('Checkout discount code', { tag: '@REQ-33' }, () => {
  test.beforeEach(async ({ signedIn, cartPage }) => {
    await signedIn.addToCart('Sauce Labs Backpack');
    await signedIn.addToCart('Sauce Labs Onesie');
    await signedIn.openCart();
    await cartPage.checkout();
  });

  test('SAVE10 gives 10% off and a lower total on the overview', { tag: ['@AC-1', '@AC-2'] }, async ({ checkoutPage }) => {
    test.fail(true, 'not built yet: REQ-33');
    await checkoutPage.applyDiscount('SAVE10');
    await expect(checkoutPage.discountError).toBeHidden();
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.itemTotal).toHaveText('Item total: $37.98');
    await expect(checkoutPage.discountLabel).toHaveText('Discount: -$3.80');
    await expect(checkoutPage.tax).toHaveText('Tax: $2.73');

    const subtotalBox = await checkoutPage.itemTotal.boundingBox();
    const discountBox = await checkoutPage.discountLabel.boundingBox();
    const taxBox = await checkoutPage.tax.boundingBox();
    expect(subtotalBox!.y).toBeLessThan(discountBox!.y);
    expect(discountBox!.y).toBeLessThan(taxBox!.y);

    await expect(checkoutPage.total).toHaveText('Total: $36.91');
  });

  test('an unknown code shows an error and no discount', { tag: '@AC-3' }, async ({ checkoutPage }) => {
    test.fail(true, 'not built yet: REQ-33');
    await checkoutPage.applyDiscount('BOGUS');
    await expect(checkoutPage.discountError).toHaveText('Invalid discount code');
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.title).toHaveText('Checkout: Overview');
    await expect(checkoutPage.discountLabel).toHaveCount(0);
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $37.98');
    await expect(checkoutPage.tax).toHaveText('Tax: $3.04');
    await expect(checkoutPage.total).toHaveText('Total: $41.02');
  });

  test('an empty code shows a required error and no discount', { tag: '@AC-4' }, async ({ checkoutPage }) => {
    test.fail(true, 'not built yet: REQ-33');
    await checkoutPage.applyDiscountButton.click();
    await expect(checkoutPage.discountError).toHaveText('Discount code is required');
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.title).toHaveText('Checkout: Overview');
    await expect(checkoutPage.discountLabel).toHaveCount(0);
    await expect(checkoutPage.total).toHaveText('Total: $41.02');
  });

  test('a whitespace-only code shows a required error', { tag: '@AC-4' }, async ({ checkoutPage }) => {
    test.fail(true, 'not built yet: REQ-33');
    await checkoutPage.applyDiscount('   ');
    await expect(checkoutPage.discountError).toHaveText('Discount code is required');
  });

  test('a code that was typed but not applied is ignored on Continue', { tag: '@AC-5' }, async ({ checkoutPage }) => {
    test.fail(true, 'not built yet: REQ-33');
    await expect(checkoutPage.discountCode).toBeVisible();
    await checkoutPage.discountCode.fill('SAVE10');
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.title).toHaveText('Checkout: Overview');
    await expect(checkoutPage.discountLabel).toHaveCount(0);
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $37.98');
    await expect(checkoutPage.tax).toHaveText('Tax: $3.04');
    await expect(checkoutPage.total).toHaveText('Total: $41.02');
  });

  test('applying SAVE10 twice does not stack', { tag: '@AC-6' }, async ({ checkoutPage }) => {
    test.fail(true, 'not built yet: REQ-33');
    await checkoutPage.applyDiscount('SAVE10');
    await checkoutPage.applyDiscountButton.click();
    await checkoutPage.applyDiscount('SAVE10');
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.discountLabel).toHaveText('Discount: -$3.80');
    await expect(checkoutPage.total).toHaveText('Total: $36.91');
  });

  test('a failed attempt after a valid code keeps the discount', { tag: '@AC-7' }, async ({ checkoutPage }) => {
    test.fail(true, 'not built yet: REQ-33');
    await checkoutPage.applyDiscount('SAVE10');
    await checkoutPage.applyDiscount('BOGUS');
    await expect(checkoutPage.discountError).toHaveText('Invalid discount code');
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.discountLabel).toHaveText('Discount: -$3.80');
    await expect(checkoutPage.total).toHaveText('Total: $36.91');
  });

  test('the code is case-insensitive and trimmed', { tag: '@AC-8' }, async ({ checkoutPage }) => {
    test.fail(true, 'not built yet: REQ-33');
    await checkoutPage.applyDiscount(' save10 ');
    await expect(checkoutPage.discountError).toBeHidden();
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.discountLabel).toHaveText('Discount: -$3.80');
    await expect(checkoutPage.total).toHaveText('Total: $36.91');
  });

  test('near-miss codes are rejected and SAVE10 in capitals is accepted', { tag: ['@AC-3', '@AC-8'] }, async ({ checkoutPage }) => {
    test.fail(true, 'not built yet: REQ-33');
    for (const code of ['SAVE100', 'SAVE 10', 'XSAVE10']) {
      await checkoutPage.applyDiscount(code);
      await expect(checkoutPage.discountError).toHaveText('Invalid discount code');
    }
    await checkoutPage.applyDiscount('SAVE10');
    await expect(checkoutPage.discountError).toBeHidden();
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.discountLabel).toHaveText('Discount: -$3.80');
    await expect(checkoutPage.total).toHaveText('Total: $36.91');
  });

  test('the discount survives a reload on the overview', { tag: '@AC-9' }, async ({ checkoutPage, page }) => {
    test.fail(true, 'not built yet: REQ-33');
    await checkoutPage.applyDiscount('SAVE10');
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();
    await expect(checkoutPage.discountLabel).toHaveText('Discount: -$3.80');

    await page.reload();

    await expect(checkoutPage.discountLabel).toHaveText('Discount: -$3.80');
  });

  test('the discount is recalculated after removing an item', { tag: '@AC-9' }, async ({ checkoutPage, cartPage }) => {
    test.fail(true, 'not built yet: REQ-33');
    await checkoutPage.applyDiscount('SAVE10');
    await checkoutPage.openCart();
    await cartPage.remove('Sauce Labs Onesie');
    await cartPage.checkout();
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.itemTotal).toHaveText('Item total: $29.99');
    await expect(checkoutPage.discountLabel).toHaveText('Discount: -$3.00');
    await expect(checkoutPage.tax).toHaveText('Tax: $2.16');
    await expect(checkoutPage.total).toHaveText('Total: $29.15');
  });

  test('the discount is recalculated after adding an item', { tag: '@AC-9' }, async ({ checkoutPage, cartPage, inventoryPage }) => {
    test.fail(true, 'not built yet: REQ-33');
    await checkoutPage.applyDiscount('SAVE10');
    await checkoutPage.openCart();
    await cartPage.continueShoppingButton.click();
    await inventoryPage.addToCart('Sauce Labs Fleece Jacket');
    await inventoryPage.openCart();
    await cartPage.checkout();
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    // 37.98 + 49.99 = 87.97; 10% = 8.80; discounted 79.17; tax 6.33
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $87.97');
    await expect(checkoutPage.discountLabel).toHaveText('Discount: -$8.80');
    await expect(checkoutPage.total).toHaveText('Total: $85.50');
  });

  test('the discount is cleared after finishing an order', { tag: '@AC-10' }, async ({ checkoutPage, cartPage, inventoryPage }) => {
    test.fail(true, 'not built yet: REQ-33');
    await checkoutPage.applyDiscount('SAVE10');
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();
    await checkoutPage.finish();
    await expect(checkoutPage.confirmation).toHaveText('Thank you for your order!');
    await checkoutPage.backHomeButton.click();

    await inventoryPage.addToCart('Sauce Labs Backpack');
    await inventoryPage.openCart();
    await cartPage.checkout();
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.title).toHaveText('Checkout: Overview');
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $29.99');
    await expect(checkoutPage.discountLabel).toHaveCount(0);
    await expect(checkoutPage.total).toHaveText('Total: $32.39');
  });

  test('the discount is cleared by Reset App State', { tag: '@AC-10' }, async ({ checkoutPage, cartPage, inventoryPage, page }) => {
    test.fail(true, 'not built yet: REQ-33');
    await checkoutPage.applyDiscount('SAVE10');
    await checkoutPage.resetAppState();
    await page.goto('/inventory.html');
    await inventoryPage.addToCart('Sauce Labs Backpack');
    await inventoryPage.openCart();
    await cartPage.checkout();
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.title).toHaveText('Checkout: Overview');
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $29.99');
    await expect(checkoutPage.discountLabel).toHaveCount(0);
    await expect(checkoutPage.total).toHaveText('Total: $32.39');
  });

  test('the discount is cleared by logging out and back in', { tag: '@AC-10' }, async ({ checkoutPage, cartPage, inventoryPage, loginPage }) => {
    test.fail(true, 'not built yet: REQ-33');
    await checkoutPage.applyDiscount('SAVE10');
    await checkoutPage.logout();
    await loginPage.signIn(defaultUser, PASSWORD);
    await expect(inventoryPage.title).toHaveText('Products');
    await inventoryPage.openCart();
    await cartPage.checkout();
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    // the cart survives logout in this app, so the overview still lists Backpack and Onesie
    await expect(checkoutPage.title).toHaveText('Checkout: Overview');
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $37.98');
    await expect(checkoutPage.discountLabel).toHaveCount(0);
    await expect(checkoutPage.tax).toHaveText('Tax: $3.04');
    await expect(checkoutPage.total).toHaveText('Total: $41.02');
  });

  for (const [label, field] of [
    ['First Name', 'firstName'],
    ['Last Name', 'lastName'],
    ['Postal Code', 'postalCode'],
  ] as const) {
    test(`${label} is still required with a code applied`, { tag: '@AC-11' }, async ({ checkoutPage }) => {
      test.fail(true, 'not built yet: REQ-33');
      await checkoutPage.applyDiscount('SAVE10');
      await checkoutPage.fillShopper({ ...shopper, [field]: '' });
      await checkoutPage.continue();

      await expect(checkoutPage.title).toHaveText('Checkout: Your Information');
      await expect(checkoutPage.error).toHaveText(`Error: ${label} is required`);
    });
  }

  test('applying a code with empty required fields shows no required-field error', { tag: '@AC-11' }, async ({ checkoutPage }) => {
    test.fail(true, 'not built yet: REQ-33');
    await checkoutPage.applyDiscount('SAVE10');
    await expect(checkoutPage.title).toHaveText('Checkout: Your Information');
    await expect(checkoutPage.error).toHaveCount(0);
    await expect(checkoutPage.discountError).toBeHidden();
    await expect(checkoutPage.applyDiscountButton).toBeVisible();
  });

  test('without a code the overview has no discount line', { tag: '@AC-12' }, async ({ checkoutPage }) => {
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.itemTotal).toHaveText('Item total: $37.98');
    await expect(checkoutPage.tax).toHaveText('Tax: $3.04');
    await expect(checkoutPage.total).toHaveText('Total: $41.02');
    await expect(checkoutPage.discountLabel).toHaveCount(0);
  });
});
