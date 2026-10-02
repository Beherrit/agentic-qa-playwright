import { namesAtoZ, sortOptions } from '../fixtures/products.ts';
import { expect, test } from '../fixtures/test.ts';

const backpack = 'Sauce Labs Backpack';
const bikeLight = 'Sauce Labs Bike Light';
const shopper = { firstName: 'Ada', lastName: 'Lovelace', postalCode: '80202' };

test.describe('Reset App State', { tag: '@REQ-14' }, () => {
  test('reset empties the cart badge and the cart page', { tag: ['@AC-1', '@AC-2'] }, async ({ signedIn, cartPage }) => {
    await signedIn.addToCart(backpack);
    await signedIn.addToCart(bikeLight);
    await expect(signedIn.cartBadge).toHaveText('2');

    await signedIn.resetAppState();

    await expect(signedIn.cartBadge).toBeHidden();
    await expect(signedIn.cartLink).toHaveAccessibleName('Cart, empty');

    await signedIn.openCart();
    await expect(cartPage.itemNames).toHaveCount(0);
  });

  test('product cards all show Add to cart right after reset, without a reload', { tag: '@AC-3' }, async ({ signedIn }) => {
    test.fail(true, 'bug: AC-3 Backpack and Bike Light still show Remove after reset until the page is reloaded');
    await signedIn.addToCart(backpack);
    await signedIn.addToCart(bikeLight);

    await signedIn.resetAppState();

    await expect(signedIn.addButtons).toHaveCount(6);
    await expect(signedIn.removeButtons).toHaveCount(0);
  });

  test('reset persists across a reload', { tag: '@AC-4' }, async ({ signedIn, page }) => {
    await signedIn.addToCart(backpack);
    await signedIn.addToCart(bikeLight);
    await signedIn.resetAppState();

    await page.reload();

    await expect(signedIn.cartBadge).toBeHidden();
    await expect(signedIn.addButtons).toHaveCount(6);
    await expect(signedIn.removeButtons).toHaveCount(0);
  });

  test('reset with an empty cart changes nothing and shows no error', { tag: '@AC-5' }, async ({ signedIn, page }) => {
    await signedIn.resetAppState();

    await expect(signedIn.cartBadge).toBeHidden();
    await expect(signedIn.addButtons).toHaveCount(6);
    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expect(signedIn.itemNames).toHaveText(namesAtoZ);
    await expect(page.getByTestId('error')).toHaveCount(0);
  });

  test('reset on the cart page empties the cart page and the badge', { tag: '@AC-6' }, async ({ signedIn, cartPage }) => {
    test.fail(true, 'bug: AC-6 the cart page still lists the items after reset until it is reloaded');
    await signedIn.addToCart(backpack);
    await signedIn.addToCart(bikeLight);
    await signedIn.openCart();
    await expect(cartPage.itemNames).toHaveCount(2);

    await cartPage.resetAppState();

    await expect(cartPage.itemNames).toHaveCount(0);
    await expect(cartPage.cartBadge).toBeHidden();
  });

  test('after reset on the cart page the product cards all show Add to cart', { tag: '@AC-6' }, async ({ signedIn, cartPage }) => {
    await signedIn.addToCart(backpack);
    await signedIn.addToCart(bikeLight);
    await signedIn.openCart();
    await cartPage.resetAppState();
    await cartPage.closeMenu();

    await cartPage.continueShoppingButton.click();

    await expect(signedIn.addButtons).toHaveCount(6);
    await expect(signedIn.removeButtons).toHaveCount(0);
  });

  test('adding after a reset starts the badge count from 1', { tag: '@AC-7' }, async ({ signedIn, cartPage }) => {
    test.fail(true, 'bug: AC-7 after reset the Backpack card still shows Remove, so it cannot be added again without a reload');
    await signedIn.addToCart(backpack);
    await signedIn.addToCart(bikeLight);
    await signedIn.resetAppState();

    await signedIn.addToCart(backpack);

    await expect(signedIn.cartBadge).toHaveText('1');
    await signedIn.openCart();
    await expect(cartPage.itemNames).toHaveText([backpack]);
  });

  test('reset with a price sort keeps the user signed in with an empty cart', { tag: '@AC-8' }, async ({ signedIn, page }) => {
    await signedIn.sortBy(sortOptions.hilo);
    await signedIn.addToCart(backpack);

    await signedIn.resetAppState();

    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expect(signedIn.items).toHaveCount(6);
    await expect(signedIn.cartBadge).toBeHidden();
  });

  test('the detail page shows Add to cart after reset', { tag: ['@AC-3', '@AC-4'] }, async ({ signedIn, productPage, page }) => {
    await signedIn.addToCart(backpack);
    await expect(signedIn.cartBadge).toHaveText('1');
    await signedIn.resetAppState();

    await signedIn.openProduct(backpack);

    await expect(page).toHaveURL(/\/inventory-item\.html/);
    await expect(productPage.name).toHaveText(backpack);
    await expect(productPage.addButton).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    await expect(productPage.cartBadge).toBeHidden();

    await productPage.backToProducts();
    await expect(signedIn.cartBadge).toBeHidden();

    await page.reload();
    await expect(signedIn.cartBadge).toBeHidden();
  });

  test('resetting twice in a row is harmless', { tag: '@AC-5' }, async ({ signedIn, page }) => {
    await signedIn.addToCart(backpack);
    await signedIn.addToCart(bikeLight);
    await signedIn.resetAppState();

    await signedIn.resetLink.click();

    await expect(signedIn.cartBadge).toBeHidden();
    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expect(page.getByTestId('error')).toHaveCount(0);
    await expect(signedIn.itemNames).toHaveText(namesAtoZ);

    await page.reload();
    await expect(signedIn.addButtons).toHaveCount(6);
  });

  test('after reset and reload only the newly added item is checked out', { tag: '@AC-7' }, async ({ signedIn, cartPage, checkoutPage, page }) => {
    await signedIn.addToCart(backpack);
    await signedIn.addToCart(bikeLight);
    await signedIn.resetAppState();
    await page.reload();

    await signedIn.addToCart(bikeLight);
    await expect(signedIn.cartBadge).toHaveText('1');

    await signedIn.openCart();
    await expect(cartPage.itemNames).toHaveText([bikeLight]);
    await cartPage.checkout();
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continue();

    await expect(checkoutPage.title).toHaveText('Checkout: Overview');
    await expect(cartPage.itemNames).toHaveText([bikeLight]);
    await expect(checkoutPage.itemTotal).toHaveText('Item total: $9.99');
  });
});
