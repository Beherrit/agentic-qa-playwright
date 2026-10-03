import { expect, test } from '../fixtures/test.ts';
import { PASSWORD, personas } from '../fixtures/personas.ts';

const BACKPACK = 'Sauce Labs Backpack';
const BIKE_LIGHT = 'Sauce Labs Bike Light';
const BIKE_LIGHT_DESCRIPTION =
  "A red light isn't the desired state in testing but it sure helps when riding your bike at night. Water-resistant with 3 lighting modes, 1 AAA battery included.";

test.describe('Remove an item from the cart page', { tag: '@REQ-21' }, () => {
  test('removing one of two items leaves the other and the badge falls from 2 to 1', { tag: ['@AC-1', '@AC-2'] }, async ({ signedIn, cartPage }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.openCart();
    await expect(cartPage.cartBadge).toHaveText('2');

    await cartPage.remove(BACKPACK);

    await expect(cartPage.itemNames).toHaveText([BIKE_LIGHT]);
    await expect(cartPage.item(BACKPACK)).toHaveCount(0);
    await expect(cartPage.cartBadge).toHaveText('1');
  });

  test('removing the last item empties the cart and hides the badge', { tag: '@AC-3' }, async ({ signedIn, cartPage }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.openCart();

    await cartPage.remove(BACKPACK);

    await expect(cartPage.items).toHaveCount(0);
    await expect(cartPage.cartBadge).toBeHidden();
    await expect(cartPage.continueShoppingButton).toBeVisible();
    await expect(cartPage.checkoutButton).toBeVisible();
  });

  test('the list offers Add to cart for the removed product and Remove for the other', { tag: '@AC-4' }, async ({ signedIn, cartPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.openCart();
    await cartPage.remove(BACKPACK);

    await cartPage.continueShoppingButton.click();

    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expect(signedIn.addButton(BACKPACK)).toBeVisible();
    await expect(signedIn.removeButton(BACKPACK)).toHaveCount(0);
    await expect(signedIn.removeButton(BIKE_LIGHT)).toBeVisible();
    await expect(signedIn.cartBadge).toHaveText('1');
  });

  test('the removal survives a reload', { tag: '@AC-5' }, async ({ signedIn, cartPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.openCart();
    await cartPage.remove(BACKPACK);
    await expect(cartPage.cartBadge).toHaveText('1');

    await page.reload();

    await expect(cartPage.itemNames).toHaveText([BIKE_LIGHT]);
    await expect(cartPage.cartBadge).toHaveText('1');
  });

  test('re-adding a removed product gives one entry and a count of 1', { tag: '@AC-6' }, async ({ signedIn, cartPage }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.openCart();
    await cartPage.remove(BACKPACK);
    await cartPage.continueShoppingButton.click();

    await signedIn.addToCart(BACKPACK);
    await signedIn.openCart();

    await expect(cartPage.itemNames).toHaveText([BACKPACK]);
    await expect(cartPage.cartBadge).toHaveText('1');
  });

  test('problem_user can remove an item on the cart page', { tag: '@AC-7' }, async ({ loginPage, inventoryPage, cartPage }) => {
    await loginPage.goto();
    await loginPage.signIn(personas.problem, PASSWORD);
    await expect(inventoryPage.title).toHaveText('Products');
    await inventoryPage.addToCart(BACKPACK);
    await inventoryPage.addToCart(BIKE_LIGHT);
    await inventoryPage.openCart();
    await expect(cartPage.cartBadge).toHaveText('2');

    await cartPage.remove(BIKE_LIGHT);

    await expect(cartPage.itemNames).toHaveText([BACKPACK]);
    await expect(cartPage.cartBadge).toHaveText('1');
  });

  test('problem_user can remove both items one after the other', { tag: '@AC-7' }, async ({ loginPage, inventoryPage, cartPage }) => {
    await loginPage.goto();
    await loginPage.signIn(personas.problem, PASSWORD);
    await expect(inventoryPage.title).toHaveText('Products');
    await inventoryPage.addToCart(BACKPACK);
    await inventoryPage.addToCart(BIKE_LIGHT);
    await inventoryPage.openCart();

    await cartPage.remove(BACKPACK);
    await expect(cartPage.itemNames).toHaveText([BIKE_LIGHT]);
    await expect(cartPage.cartBadge).toHaveText('1');

    await cartPage.remove(BIKE_LIGHT);
    await expect(cartPage.items).toHaveCount(0);
    await expect(cartPage.cartBadge).toBeHidden();
  });

  test('error_user can remove an item on the cart page', { tag: '@AC-7' }, async ({ loginPage, inventoryPage, cartPage }) => {
    await loginPage.goto();
    await loginPage.signIn(personas.error, PASSWORD);
    await expect(inventoryPage.title).toHaveText('Products');
    await inventoryPage.addToCart(BACKPACK);
    await inventoryPage.addToCart(BIKE_LIGHT);
    await inventoryPage.openCart();

    await cartPage.remove(BACKPACK);

    await expect(cartPage.itemNames).toHaveText([BIKE_LIGHT]);
    await expect(cartPage.cartBadge).toHaveText('1');
  });

  test('performance_glitch_user can remove an item on the cart page', { tag: '@AC-7' }, async ({ loginPage, inventoryPage, cartPage }) => {
    await loginPage.goto();
    await loginPage.signIn(personas.slow, PASSWORD);
    await expect(inventoryPage.title).toHaveText('Products');
    await inventoryPage.addToCart(BACKPACK);
    await inventoryPage.addToCart(BIKE_LIGHT);
    await inventoryPage.openCart();

    await cartPage.remove(BACKPACK);

    await expect(cartPage.itemNames).toHaveText([BIKE_LIGHT]);
    await expect(cartPage.cartBadge).toHaveText('1');
  });

  test('the remaining item keeps its details after a removal', { tag: '@AC-8' }, async ({ signedIn, cartPage }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.openCart();

    await cartPage.remove(BACKPACK);

    await expect(cartPage.itemNames).toHaveText([BIKE_LIGHT]);
    await expect(cartPage.itemDescription(BIKE_LIGHT)).toHaveText(BIKE_LIGHT_DESCRIPTION);
    await expect(cartPage.itemPrice(BIKE_LIGHT)).toHaveText('$9.99');
  });

  test('Continue Shopping still works after a removal', { tag: '@AC-8' }, async ({ signedIn, cartPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.openCart();
    await cartPage.remove(BACKPACK);

    await cartPage.continueShoppingButton.click();

    await expect(page).toHaveURL(/\/inventory\.html$/);
  });

  test('Checkout still works after a removal', { tag: '@AC-8' }, async ({ signedIn, cartPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.openCart();
    await cartPage.remove(BACKPACK);

    await cartPage.checkout();

    await expect(page).toHaveURL(/\/checkout-step-one\.html$/);
  });

  test('the checkout overview lists only the remaining item', { tag: ['@AC-1', '@AC-8'] }, async ({ signedIn, cartPage, checkoutPage }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.openCart();
    await cartPage.remove(BACKPACK);
    await cartPage.checkout();

    await checkoutPage.fillShopper({ firstName: 'Ada', lastName: 'Lovelace', postalCode: '12345' });
    await checkoutPage.continue();

    await expect(cartPage.itemNames).toHaveText([BIKE_LIGHT]);
    await expect(checkoutPage.itemTotal).toContainText('$9.99');
  });

  test('the removal holds on a directly loaded list and an emptied cart holds after reload', { tag: ['@AC-4', '@AC-5'] }, async ({ signedIn, cartPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.openCart();
    await cartPage.remove(BACKPACK);
    await expect(cartPage.cartBadge).toHaveText('1');

    await page.goto('/inventory.html');

    await expect(signedIn.addButton(BACKPACK)).toBeVisible();
    await expect(signedIn.removeButton(BIKE_LIGHT)).toBeVisible();
    await expect(signedIn.cartBadge).toHaveText('1');

    await signedIn.openCart();
    await cartPage.remove(BIKE_LIGHT);
    await expect(cartPage.items).toHaveCount(0);
    await page.reload();

    await expect(cartPage.items).toHaveCount(0);
    await expect(cartPage.cartBadge).toBeHidden();
  });
});
