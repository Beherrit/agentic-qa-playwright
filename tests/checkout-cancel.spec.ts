import { expect, test } from '../fixtures/test.ts';

const shopper = { firstName: 'Ada', lastName: 'Lovelace', postalCode: '80202' };
const BACKPACK = 'Sauce Labs Backpack';
const ONESIE = 'Sauce Labs Onesie';

test.describe('Cancel on the checkout information step', { tag: '@REQ-40' }, () => {
  test.beforeEach(async ({ page, signedIn, cartPage, checkoutPage }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(ONESIE);
    await signedIn.openCart();
    await cartPage.checkout();
    await expect(checkoutPage.title).toHaveText('Checkout: Your Information');
    await expect(page).toHaveURL(/\/checkout-step-one\.html$/);
  });

  test('cancel returns to the cart with both items, badge 2 and a usable cart', { tag: ['@AC-1', '@AC-2'] }, async ({ page, checkoutPage, cartPage }) => {
    await checkoutPage.cancelButton.click();

    await expect(page).toHaveURL(/\/cart\.html$/);
    await expect(cartPage.title).toHaveText('Your Cart');
    await expect(cartPage.itemNames).toHaveText([BACKPACK, ONESIE]);
    await expect(cartPage.cartBadge).toHaveText('2');
    await expect(cartPage.removeButton(BACKPACK)).toBeVisible();
    await expect(cartPage.removeButton(ONESIE)).toBeVisible();
    await expect(cartPage.continueShoppingButton).toBeVisible();
    await expect(cartPage.checkoutButton).toBeVisible();
  });

  test('typed details are not kept after cancel and checkout again', { tag: '@AC-3' }, async ({ checkoutPage, cartPage }) => {
    // Clearing is observed demo behaviour, not a stated requirement.
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.cancelButton.click();
    await expect(cartPage.title).toHaveText('Your Cart');
    await cartPage.checkout();

    await expect(checkoutPage.title).toHaveText('Checkout: Your Information');
    await expect(checkoutPage.firstName).toHaveValue('');
    await expect(checkoutPage.lastName).toHaveValue('');
    await expect(checkoutPage.postalCode).toHaveValue('');
    await expect(checkoutPage.error).toBeHidden();
  });

  test('after cancel the Onesie can be removed and only the Backpack remains', { tag: '@AC-4' }, async ({ checkoutPage, cartPage }) => {
    await checkoutPage.cancelButton.click();
    await expect(cartPage.title).toHaveText('Your Cart');
    await cartPage.remove(ONESIE);

    await expect(cartPage.itemNames).toHaveText([BACKPACK]);
    await expect(cartPage.item(ONESIE)).toHaveCount(0);
    await expect(cartPage.cartBadge).toHaveText('1');
  });

  test('the cart survives a reload after cancel', { tag: '@AC-5' }, async ({ page, checkoutPage, cartPage }) => {
    await checkoutPage.cancelButton.click();
    await expect(cartPage.title).toHaveText('Your Cart');
    await page.reload();

    await expect(page).toHaveURL(/\/cart\.html$/);
    await expect(cartPage.itemNames).toHaveText([BACKPACK, ONESIE]);
    await expect(cartPage.cartBadge).toHaveText('2');
  });

  test('cancel after a failed submit shows the cart with no error and items intact', { tag: '@AC-7' }, async ({ page, checkoutPage, cartPage }) => {
    await checkoutPage.fillShopper({ ...shopper, firstName: '' });
    await checkoutPage.continue();
    await expect(checkoutPage.error).toHaveText('Error: First Name is required');
    await checkoutPage.cancelButton.click();

    await expect(cartPage.title).toHaveText('Your Cart');
    await expect(cartPage.itemNames).toHaveText([BACKPACK, ONESIE]);
    await expect(cartPage.cartBadge).toHaveText('2');
    await expect(checkoutPage.error).toBeHidden();
    await expect(page.getByText('is required')).toHaveCount(0);

    await cartPage.checkout();
    await expect(checkoutPage.firstName).toHaveValue('');
    await expect(checkoutPage.error).toBeHidden();
  });

  test('repeated checkout and cancel round trips do not duplicate or lose items', { tag: ['@AC-2', '@AC-6'] }, async ({ checkoutPage, cartPage }) => {
    await checkoutPage.cancelButton.click();
    await expect(cartPage.title).toHaveText('Your Cart');
    await cartPage.checkout();
    await expect(checkoutPage.title).toHaveText('Checkout: Your Information');
    await checkoutPage.cancelButton.click();

    await expect(cartPage.title).toHaveText('Your Cart');
    await expect(cartPage.itemNames).toHaveText([BACKPACK, ONESIE]);
    await expect(cartPage.cartBadge).toHaveText('2');
  });

  test('an item removed after cancel stays out of the next checkout overview', { tag: '@AC-4' }, async ({ checkoutPage, cartPage }) => {
    await checkoutPage.cancelButton.click();
    await expect(cartPage.title).toHaveText('Your Cart');
    await cartPage.remove(ONESIE);
    await cartPage.checkout();
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.title).toHaveText('Checkout: Overview');
    await expect(cartPage.itemNames).toHaveText([BACKPACK]);
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $29.99');
  });

  test('reload on the information step, then cancel, keeps the cart intact', { tag: ['@AC-1', '@AC-2'] }, async ({ page, checkoutPage, cartPage }) => {
    await page.reload();
    await expect(checkoutPage.title).toHaveText('Checkout: Your Information');
    await checkoutPage.cancelButton.click();

    await expect(page).toHaveURL(/\/cart\.html$/);
    await expect(cartPage.title).toHaveText('Your Cart');
    await expect(cartPage.itemNames).toHaveText([BACKPACK, ONESIE]);
    await expect(cartPage.cartBadge).toHaveText('2');
  });

  test('double-clicking cancel still lands once on the cart with items intact', { tag: ['@AC-1', '@AC-2'] }, async ({ page, checkoutPage, cartPage }) => {
    await checkoutPage.cancelButton.dblclick();

    await expect(cartPage.title).toHaveText('Your Cart');
    await expect(page).toHaveURL(/\/cart\.html$/);
    await expect(cartPage.itemNames).toHaveText([BACKPACK, ONESIE]);
    await expect(cartPage.cartBadge).toHaveText('2');
  });
});

test.describe('Cancel on the checkout information step with one item', { tag: '@REQ-40' }, () => {
  test('cancel keeps the single item once and the badge at 1', { tag: '@AC-6' }, async ({ signedIn, cartPage, checkoutPage }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.openCart();
    await cartPage.checkout();
    await expect(checkoutPage.title).toHaveText('Checkout: Your Information');
    await expect(checkoutPage.cartBadge).toHaveText('1');
    await checkoutPage.cancelButton.click();

    await expect(cartPage.title).toHaveText('Your Cart');
    await expect(cartPage.itemNames).toHaveText([BACKPACK]);
    await expect(cartPage.cartBadge).toHaveText('1');
  });
});
