import { expect, test } from '../fixtures/test.ts';

const BACKPACK = 'Sauce Labs Backpack';
const BIKE_LIGHT = 'Sauce Labs Bike Light';
const ONESIE = 'Sauce Labs Onesie';
const FLEECE_JACKET = 'Sauce Labs Fleece Jacket';

test.describe('Reset App State', { tag: '@REQ-17' }, () => {
  test('reset on the product list hides the cart badge', { tag: '@AC-1' }, async ({ signedIn }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.addToCart(ONESIE);
    await expect(signedIn.cartBadge).toHaveText('3');

    await signedIn.resetAppState();

    await expect(signedIn.cartBadge).toBeHidden();
  });

  test('reset on the product list shows Add to cart on every product at once', { tag: '@AC-2' }, async ({ signedIn }) => {
    test.fail(true, 'bug: AC-2 the product list keeps showing Remove on reset items until the page is reloaded');
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.addToCart(ONESIE);
    await expect(signedIn.cartBadge).toHaveText('3');

    await signedIn.resetAppState();

    await expect(signedIn.addButtons).toHaveCount(6);
    await expect(signedIn.removeButtons).toHaveCount(0);
  });

  test('the cart page is empty after a reset on the product list', { tag: '@AC-2' }, async ({ signedIn, cartPage }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await expect(signedIn.cartBadge).toHaveText('2');

    await signedIn.resetAppState();
    await signedIn.openCart();

    await expect(cartPage.items).toHaveCount(0);
  });

  test('reset on a product detail page empties the cart everywhere', { tag: '@AC-3' }, async ({ signedIn, productPage, cartPage }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.openProduct(BACKPACK);
    await expect(productPage.cartBadge).toHaveText('2');

    await productPage.resetAppState();

    await expect(productPage.cartBadge).toBeHidden();
    await productPage.openCart();
    await expect(cartPage.items).toHaveCount(0);
    await cartPage.continueShoppingButton.click();
    await expect(signedIn.addButtons).toHaveCount(6);
    await expect(signedIn.removeButtons).toHaveCount(0);
  });

  test('reset on the cart page empties the cart page at once', { tag: '@AC-4' }, async ({ signedIn, cartPage }) => {
    test.fail(true, 'bug: AC-4 the cart page still lists the items after reset until the page is reloaded');
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.openCart();

    await cartPage.resetAppState();

    await expect(cartPage.items).toHaveCount(0);
  });

  test('reset on the cart page hides the badge', { tag: '@AC-4' }, async ({ signedIn, cartPage }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.openCart();
    await expect(cartPage.cartBadge).toHaveText('2');

    await cartPage.resetAppState();

    await expect(cartPage.cartBadge).toBeHidden();
  });

  test('the list offers Add to cart on every product after a reset on the cart page', { tag: '@AC-4' }, async ({ signedIn, cartPage }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.openCart();
    await expect(cartPage.cartBadge).toHaveText('2');

    await cartPage.resetAppState();
    await cartPage.closeMenuButton.click();
    await cartPage.continueShoppingButton.click();

    await expect(signedIn.addButtons).toHaveCount(6);
    await expect(signedIn.removeButtons).toHaveCount(0);
  });

  test('the product list shows no badge and only Add to cart after a reload following a reset', { tag: '@AC-5' }, async ({ signedIn, page }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await expect(signedIn.cartBadge).toHaveText('2');
    await signedIn.resetAppState();

    await page.reload();

    await expect(signedIn.cartBadge).toBeHidden();
    await expect(signedIn.addButtons).toHaveCount(6);
    await expect(signedIn.removeButtons).toHaveCount(0);
  });

  test('the cart page is still empty after a reload following a reset', { tag: '@AC-5' }, async ({ signedIn, cartPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await expect(signedIn.cartBadge).toHaveText('2');
    await signedIn.resetAppState();
    await signedIn.openCart();

    await page.reload();

    await expect(cartPage.items).toHaveCount(0);
  });

  test('the product list reloaded after a reset still shows only Add to cart', { tag: '@AC-5' }, async ({ signedIn, cartPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await expect(signedIn.cartBadge).toHaveText('2');
    await signedIn.resetAppState();
    await signedIn.closeMenuButton.click();
    await signedIn.openCart();
    await cartPage.continueShoppingButton.click();

    await page.reload();

    await expect(signedIn.cartBadge).toBeHidden();
    await expect(signedIn.addButtons).toHaveCount(6);
    await expect(signedIn.removeButtons).toHaveCount(0);
  });

  test('reset on an empty cart is harmless', { tag: '@AC-6' }, async ({ signedIn, cartPage, page }) => {
    await signedIn.resetAppState();

    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expect(signedIn.title).toHaveText('Products');
    await expect(signedIn.menuButton).toBeVisible();
    await expect(page.getByTestId('error')).toBeHidden();
    await expect(signedIn.cartBadge).toBeHidden();
    await signedIn.openCart();
    await expect(cartPage.items).toHaveCount(0);
  });

  test('reset keeps the user signed in', { tag: '@AC-7' }, async ({ signedIn, cartPage, page }) => {
    await signedIn.addToCart(BACKPACK);

    await signedIn.resetAppState();
    await expect(page).not.toHaveURL(/saucedemo\.com\/?$/);
    await expect(page).toHaveURL(/\/inventory\.html$/);

    await page.goto('/inventory.html');
    await expect(signedIn.title).toHaveText('Products');
    await expect(signedIn.items).toHaveCount(6);
    await expect(signedIn.menuButton).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login' })).toBeHidden();
    await signedIn.openCart();
    await expect(page).toHaveURL(/\/cart\.html$/);
    await expect(cartPage.title).toHaveText('Your Cart');
  });

  test('reset leaves the chosen sort alone', { tag: '@AC-8' }, async ({ signedIn }) => {
    await signedIn.sortBy('Price (high to low)');
    await signedIn.addToCart(FLEECE_JACKET);
    await signedIn.addToCart(BACKPACK);

    await signedIn.resetAppState();

    await expect(signedIn.sortSelect).toHaveValue('hilo');
    await expect(signedIn.itemNames.first()).toHaveText(FLEECE_JACKET);
    await expect(signedIn.itemPrices.first()).toHaveText('$49.99');
  });

  test('reset with a sort chosen empties the cart', { tag: '@AC-8' }, async ({ signedIn, page }) => {
    await signedIn.sortBy('Price (high to low)');
    await signedIn.addToCart(FLEECE_JACKET);
    await signedIn.addToCart(BACKPACK);
    await expect(signedIn.cartBadge).toHaveText('2');

    await signedIn.resetAppState();
    await page.reload();

    await expect(signedIn.cartBadge).toBeHidden();
    await expect(signedIn.addButtons).toHaveCount(6);
  });

  test('adding after a reset starts from a clean cart', { tag: '@AC-9' }, async ({ signedIn, cartPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await expect(signedIn.cartBadge).toHaveText('2');
    await signedIn.resetAppState();
    await page.reload();
    await expect(signedIn.addButtons).toHaveCount(6);

    await signedIn.addToCart(ONESIE);

    await expect(signedIn.cartBadge).toHaveText('1');
    await signedIn.openCart();
    await expect(cartPage.itemNames).toHaveText([ONESIE]);
  });

  test('closing the menu without resetting leaves the cart alone', { tag: '@AC-10' }, async ({ signedIn, cartPage }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);

    await signedIn.closeMenu();

    await expect(signedIn.cartBadge).toHaveText('2');
    await expect(signedIn.removeButton(BACKPACK)).toBeVisible();
    await expect(signedIn.removeButton(BIKE_LIGHT)).toBeVisible();
    await expect(signedIn.addButtons).toHaveCount(4);
    await signedIn.openCart();
    await expect(cartPage.itemNames).toHaveText([BACKPACK, BIKE_LIGHT]);
  });

  test('a product that was in the cart before the reset can be added again', { tag: '@AC-9' }, async ({ signedIn, cartPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await expect(signedIn.cartBadge).toHaveText('2');
    await signedIn.resetAppState();
    await page.reload();
    await expect(signedIn.addButton(BACKPACK)).toBeVisible();

    await signedIn.addToCart(BACKPACK);

    await expect(signedIn.removeButton(BACKPACK)).toBeVisible();
    await expect(signedIn.cartBadge).toHaveText('1');
    await signedIn.openCart();
    await expect(cartPage.itemNames).toHaveText([BACKPACK]);
  });

  test('resetting twice in a row is harmless', { tag: '@AC-6' }, async ({ signedIn, cartPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await expect(signedIn.cartBadge).toHaveText('2');
    await signedIn.resetAppState();
    await page.reload();
    await expect(signedIn.addButtons).toHaveCount(6);

    await signedIn.resetAppState();

    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expect(signedIn.menuButton).toBeVisible();
    await expect(page.getByTestId('error')).toBeHidden();
    await expect(signedIn.cartBadge).toBeHidden();
    await expect(signedIn.addButtons).toHaveCount(6);
    await expect(signedIn.removeButtons).toHaveCount(0);
    await signedIn.openCart();
    await expect(cartPage.items).toHaveCount(0);
  });

  test('add and remove stay consistent after a reset cycle', { tag: '@AC-9' }, async ({ signedIn, cartPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await expect(signedIn.cartBadge).toHaveText('2');
    await signedIn.resetAppState();
    await page.reload();
    await expect(signedIn.addButtons).toHaveCount(6);

    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(ONESIE);
    await signedIn.removeFromCart(BACKPACK);

    await expect(signedIn.cartBadge).toHaveText('1');
    await expect(signedIn.removeButtons).toHaveCount(1);
    await expect(signedIn.removeButton(ONESIE)).toBeVisible();
    await expect(signedIn.addButtons).toHaveCount(5);
    await signedIn.openCart();
    await expect(cartPage.itemNames).toHaveText([ONESIE]);
  });
});
