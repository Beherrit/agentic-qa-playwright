import { expect, test } from '../fixtures/test.ts';

const BACKPACK = 'Sauce Labs Backpack';
const BIKE_LIGHT = 'Sauce Labs Bike Light';

test.describe('Cart', () => {
  test('the cart starts empty', async ({ signedIn }) => {
    await expect(signedIn.cartBadge).toBeHidden();
  });

  test('adding items updates the cart badge', async ({ signedIn }) => {
    await signedIn.addToCart(BACKPACK);
    await expect(signedIn.cartBadge).toHaveText('1');

    await signedIn.addToCart(BIKE_LIGHT);
    await expect(signedIn.cartBadge).toHaveText('2');
  });

  test('an added item can be removed from the product list', async ({ signedIn }) => {
    await signedIn.addToCart(BACKPACK);
    await expect(signedIn.removeButton(BACKPACK)).toBeVisible();

    await signedIn.removeFromCart(BACKPACK);

    await expect(signedIn.addButton(BACKPACK)).toBeVisible();
    await expect(signedIn.cartBadge).toBeHidden();
  });

  test('the cart lists what was added', async ({ signedIn, cartPage }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.openCart();

    await expect(cartPage.itemNames).toHaveText([BACKPACK, BIKE_LIGHT]);
  });

  test('removing an item in the cart leaves the others', async ({ signedIn, cartPage }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.openCart();

    await cartPage.remove(BACKPACK);

    await expect(cartPage.itemNames).toHaveText([BIKE_LIGHT]);
    await expect(cartPage.cartBadge).toHaveText('1');
  });

  test('the cart survives a page reload', async ({ signedIn, page }) => {
    await signedIn.addToCart(BACKPACK);
    await page.reload();

    await expect(signedIn.cartBadge).toHaveText('1');
    await expect(signedIn.removeButton(BACKPACK)).toBeVisible();
  });
});
