import { productsAtoZ } from '../fixtures/products.ts';
import { expect, test } from '../fixtures/test.ts';

const BACKPACK = 'Sauce Labs Backpack';
const BIKE_LIGHT = 'Sauce Labs Bike Light';
const BOLT = 'Sauce Labs Bolt T-Shirt';
const FLEECE = 'Sauce Labs Fleece Jacket';
const ONESIE = 'Sauce Labs Onesie';
const NOT_FOUND = 'ITEM NOT FOUND';
const LOGIN_ERROR = "Epic sadface: You can only access '/inventory-item.html' when you are logged in.";

test.describe('Product details page', { tag: '@REQ-11' }, () => {
  test('opening a product by its name shows the same details as the list', { tag: '@AC-1' }, async ({ signedIn, productPage, page }) => {
    await expect(signedIn.item(BIKE_LIGHT).getByTestId('inventory-item-desc')).toContainText("A red light isn't");
    await signedIn.openProduct(BIKE_LIGHT);

    await expect(page).toHaveURL(/\/inventory-item\.html/);
    await expect(productPage.name).toHaveText(BIKE_LIGHT);
    await expect(productPage.description).toContainText("A red light isn't");
    await expect(productPage.price).toHaveText('$9.99');
    await expect(productPage.image).toHaveCount(1);
    await expect(productPage.image).toHaveAttribute('alt', BIKE_LIGHT);
  });

  test('opening a product by its picture shows the same details as the list', { tag: '@AC-1' }, async ({ signedIn, productPage, page }) => {
    await signedIn.openProductByPicture(BIKE_LIGHT);

    await expect(page).toHaveURL(/\/inventory-item\.html/);
    await expect(productPage.name).toHaveText(BIKE_LIGHT);
    await expect(productPage.description).toContainText("A red light isn't");
    await expect(productPage.price).toHaveText('$9.99');
    await expect(productPage.image).toHaveAttribute('alt', BIKE_LIGHT);
  });

  for (const product of productsAtoZ) {
    test(`${product.name} opens its own details, not another product's`, { tag: ['@AC-9', '@AC-1'] }, async ({ signedIn, productPage }) => {
      const listSrc = await signedIn.picture(product.name).getAttribute('src');
      await signedIn.openProduct(product.name);

      await expect(productPage.name).toHaveText(product.name);
      await expect(productPage.price).toHaveText(product.price);
      await expect(productPage.description).toContainText(product.description);
      await expect(productPage.image).toHaveAttribute('alt', product.name);
      await expect(productPage.image).toHaveAttribute('src', listSrc ?? '');
      await expect.poll(() => productPage.image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    });
  }

  test('add to cart on the details page switches to Remove and sets the badge to 1', { tag: '@AC-2' }, async ({ signedIn, productPage }) => {
    await signedIn.openProduct(BACKPACK);
    await productPage.addToCart();

    await expect(productPage.removeButton).toBeVisible();
    await expect(productPage.addButton).toBeHidden();
    await expect(productPage.cartBadge).toHaveText('1');
  });

  test('an item added on the details page is in the cart once with its name and price', { tag: '@AC-3' }, async ({ signedIn, productPage, cartPage }) => {
    await signedIn.openProduct(BACKPACK);
    await productPage.addToCart();
    await productPage.openCart();

    await expect(cartPage.itemNames).toHaveText([BACKPACK]);
    await expect(cartPage.items).toHaveCount(1);
    await expect(cartPage.item(BACKPACK).getByTestId('inventory-item-price')).toHaveText('$29.99');
    await expect(cartPage.item(BACKPACK).getByTestId('item-quantity')).toHaveText('1');
    await expect(cartPage.cartBadge).toHaveText('1');
  });

  test('Remove on the details page restores Add to cart and clears the badge', { tag: '@AC-4' }, async ({ signedIn, productPage }) => {
    await signedIn.openProduct(BACKPACK);
    await productPage.addToCart();
    await productPage.removeFromCart();

    await expect(productPage.addButton).toBeVisible();
    await expect(productPage.removeButton).toBeHidden();
    await expect(productPage.cartBadge).toBeHidden();
  });

  test('Remove on the details page drops the badge by one when other items are in the cart', { tag: '@AC-4' }, async ({ signedIn, productPage, cartPage }) => {
    await signedIn.openProduct(BACKPACK);
    await productPage.addToCart();
    await productPage.backToProducts();
    await signedIn.addToCart(BIKE_LIGHT);
    await expect(signedIn.cartBadge).toHaveText('2');

    await signedIn.openProduct(BACKPACK);
    await productPage.removeFromCart();

    await expect(productPage.addButton).toBeVisible();
    await expect(productPage.cartBadge).toHaveText('1');
    await productPage.openCart();
    await expect(cartPage.itemNames).toHaveText([BIKE_LIGHT]);
  });

  test('Back to products opens the full list of six', { tag: '@AC-5' }, async ({ signedIn, productPage, page }) => {
    await signedIn.openProduct(BACKPACK);
    await productPage.backToProducts();

    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expect(signedIn.items).toHaveCount(6);
    await expect(signedIn.itemNames.first()).toHaveText(BACKPACK);
    await expect(signedIn.itemNames.last()).toHaveText('Test.allTheThings() T-Shirt (Red)');
  });

  test('an item added on the list shows Remove on its details page with the badge unchanged', { tag: '@AC-6' }, async ({ signedIn, productPage }) => {
    await signedIn.addToCart(BOLT);
    await expect(signedIn.cartBadge).toHaveText('1');
    await signedIn.openProduct(BOLT);

    await expect(productPage.name).toHaveText(BOLT);
    await expect(productPage.removeButton).toBeVisible();
    await expect(productPage.addButton).toBeHidden();
    await expect(productPage.cartBadge).toHaveText('1');
  });

  test('an item added on the details page shows Remove on the list', { tag: '@AC-7' }, async ({ signedIn, productPage, page }) => {
    await signedIn.openProduct(FLEECE);
    await productPage.addToCart();
    await productPage.backToProducts();

    await expect(signedIn.removeButton(FLEECE)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to cart' })).toHaveCount(5);
    await expect(signedIn.cartBadge).toHaveText('1');
  });

  test('the details page keeps its cart state after a reload', { tag: '@AC-8' }, async ({ signedIn, productPage, page }) => {
    await signedIn.openProduct(ONESIE);
    await productPage.addToCart();
    const url = page.url();
    await page.reload();

    await expect(page).toHaveURL(url);
    await expect(productPage.name).toHaveText(ONESIE);
    await expect(productPage.removeButton).toBeVisible();
    await expect(productPage.cartBadge).toHaveText('1');
  });

  test('removing one of two products on its details page leaves the other in the cart', { tag: '@AC-10' }, async ({ signedIn, productPage, cartPage }) => {
    await signedIn.openProduct(BACKPACK);
    await productPage.addToCart();
    await productPage.backToProducts();
    await signedIn.openProduct(BIKE_LIGHT);
    await productPage.addToCart();
    await expect(productPage.cartBadge).toHaveText('2');
    await productPage.openCart();

    await expect(cartPage.itemNames).toHaveText([BACKPACK, BIKE_LIGHT]);
    await expect(cartPage.item(BACKPACK).getByTestId('inventory-item-price')).toHaveText('$29.99');
    await expect(cartPage.item(BIKE_LIGHT).getByTestId('inventory-item-price')).toHaveText('$9.99');

    await cartPage.continueShoppingButton.click();
    await signedIn.openProduct(BACKPACK);
    await productPage.removeFromCart();
    await expect(productPage.cartBadge).toHaveText('1');
    await productPage.openCart();

    await expect(cartPage.itemNames).toHaveText([BIKE_LIGHT]);
  });

  test('removing the later of two non-adjacent products keeps the earlier one', { tag: '@AC-10' }, async ({ signedIn, productPage, cartPage }) => {
    await signedIn.openProduct(BACKPACK);
    await productPage.addToCart();
    await productPage.backToProducts();
    await signedIn.openProduct(ONESIE);
    await productPage.addToCart();
    await expect(productPage.cartBadge).toHaveText('2');
    await productPage.openCart();

    await expect(cartPage.itemNames).toHaveText([BACKPACK, ONESIE]);
    await expect(cartPage.item(BACKPACK).getByTestId('inventory-item-price')).toHaveText('$29.99');
    await expect(cartPage.item(ONESIE).getByTestId('inventory-item-price')).toHaveText('$7.99');

    await cartPage.continueShoppingButton.click();
    await signedIn.openProduct(ONESIE);
    await productPage.removeFromCart();
    await expect(productPage.cartBadge).toHaveText('1');
    await productPage.openCart();

    await expect(cartPage.itemNames).toHaveText([BACKPACK]);
  });

  test('Remove on the details page is reflected on the list and in the cart', { tag: ['@AC-4', '@AC-7'] }, async ({ signedIn, productPage, cartPage, page }) => {
    await signedIn.openProduct(BOLT);
    await productPage.addToCart();
    await productPage.removeFromCart();
    await productPage.backToProducts();

    await expect(signedIn.addButton(BOLT)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to cart' })).toHaveCount(6);
    await expect(signedIn.cartBadge).toBeHidden();
    await signedIn.openCart();
    await expect(cartPage.items).toHaveCount(0);
  });

  test('a signed-out visitor opening a details URL is sent to login with an error', { tag: '@AC-11' }, async ({ productPage, loginPage, page }) => {
    await productPage.goto('?id=4');

    await expect(page).toHaveURL(/\/$/);
    await expect(loginPage.error).toHaveText(LOGIN_ERROR);
    await expect(productPage.name).toBeHidden();
    await expect(productPage.price).toBeHidden();
    await expect(productPage.addButton).toBeHidden();
  });

  test('signing out on a details page and going Back does not show the product', { tag: '@AC-11' }, async ({ signedIn, productPage, loginPage, page }) => {
    await expect(signedIn.title).toHaveText('Products');
    await productPage.goto('?id=4');
    await expect(productPage.name).toHaveText(BACKPACK);
    await productPage.logout();
    await expect(loginPage.loginButton).toBeVisible();
    await page.goBack();

    await expect(loginPage.loginButton).toBeVisible();
    await expect(productPage.name).toBeHidden();
    await expect(productPage.price).toBeHidden();
    await expect(productPage.addButton).toBeHidden();
  });

  const invalidIds = [
    { label: 'id=99', query: '?id=99' },
    { label: 'id=6', query: '?id=6' },
    { label: 'id=-1', query: '?id=-1' },
    { label: 'id=abc', query: '?id=abc' },
    { label: 'no id', query: '' },
  ];

  for (const { label, query } of invalidIds) {
    test(`an unknown product (${label}) offers a way back to the full list`, { tag: '@AC-12' }, async ({ signedIn, productPage, page }) => {
      await productPage.goto(query);
      await productPage.backToProducts();

      await expect(page).toHaveURL(/\/inventory\.html$/);
      await expect(signedIn.items).toHaveCount(6);
    });

    test(`an unknown product (${label}) has no Add to cart button`, { tag: '@AC-12' }, async ({ signedIn, productPage }) => {
      test.fail(true, `bug: AC-12 the page for a non-existent product (${label}) still offers Add to cart`);
      await productPage.goto(query);

      await expect(productPage.backButton).toBeVisible();
      await expect(productPage.addButton).toBeHidden();
      await expect(signedIn.cartBadge).toBeHidden();
    });
  }

  test('Add to cart on a non-existent item does not put it in the cart', { tag: ['@AC-12', '@AC-3'] }, async ({ signedIn, productPage, cartPage }) => {
    test.fail(true, 'bug: AC-12 a non-existent product can be added to the cart');
    await productPage.goto('?id=99');
    await productPage.addToCart();

    await expect(productPage.cartBadge).toBeHidden();
    await productPage.openCart();
    await expect(cartPage.item(NOT_FOUND)).toHaveCount(0);
    await expect(signedIn.cartBadge).toBeHidden();
  });
});
