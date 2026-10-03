import { expect, test } from '../fixtures/test.ts';
import type { InventoryPage } from '../pages/InventoryPage.ts';
import { PASSWORD, personas } from '../fixtures/personas.ts';
import { namesAtoZ, productsAtoZ } from '../fixtures/products.ts';
import type { Page } from '@playwright/test';

const BACKPACK = 'Sauce Labs Backpack';
const BIKE_LIGHT = 'Sauce Labs Bike Light';
const ONESIE = 'Sauce Labs Onesie';
const DETAILS_URL = /\/inventory-item\.html\?id=\d+$/;

/**
 * Opens a product from the list and returns the details URL. A click right after the list is drawn is sometimes
 * swallowed (about one run in four), so it is repeated until the details page opens.
 */
async function open(inventory: InventoryPage, page: Page, name: string, via: 'name' | 'picture' = 'name'): Promise<string> {
  await expect(async () => {
    if (via === 'name') await inventory.openProduct(name);
    else await inventory.openProductByImage(name);
    await expect(page).toHaveURL(DETAILS_URL, { timeout: 2_000 });
  }).toPass();
  // The address changes a moment before the page content does.
  await expect(page.getByRole('button', { name: 'Back to products' })).toBeVisible();
  return page.url();
}

async function signInAs(persona: string, loginPage: { goto(): Promise<void>; signIn(u: string, p: string): Promise<void> }, inventory: InventoryPage) {
  await loginPage.goto();
  await loginPage.signIn(persona, PASSWORD);
  await expect(inventory.title).toHaveText('Products');
}

async function expectOnlyInCart(inventory: InventoryPage, inCart: string[]) {
  await expect(inventory.items).toHaveCount(6);
  await expect(inventory.cartBadge).toHaveText(String(inCart.length));
  for (const name of namesAtoZ) {
    if (inCart.includes(name)) {
      await expect(inventory.removeButton(name)).toBeVisible();
      await expect(inventory.addButton(name)).toHaveCount(0);
    } else {
      await expect(inventory.addButton(name)).toBeVisible();
      await expect(inventory.removeButton(name)).toHaveCount(0);
    }
  }
}

test.describe('Product details page', { tag: '@REQ-37' }, () => {
  for (const product of productsAtoZ) {
    test(`${product.name}: the name link opens a details page with the same name, description and price`, { tag: '@AC-1' }, async ({ signedIn, productPage, page }) => {
      const description = await signedIn.description(product.name);
      const price = await signedIn.price(product.name);

      await open(signedIn, page, product.name);

      await expect(productPage.name).toHaveText(product.name);
      await expect(productPage.description).toHaveText(description);
      await expect(productPage.description).toContainText(product.description);
      await expect(productPage.price).toHaveText(price);
      await expect(productPage.price).toHaveText(/^\$\d+\.\d{2}$/);
      await expect(productPage.price).toHaveText(product.price);
    });

    test(`${product.name}: the picture opens the same details page as the name`, { tag: '@AC-2' }, async ({ signedIn, productPage, page }) => {
      const byName = await open(signedIn, page, product.name);
      await page.goBack();
      await expect(signedIn.items).toHaveCount(6);

      const byPicture = await open(signedIn, page, product.name, 'picture');

      expect(byPicture).toBe(byName);
      await expect(productPage.name).toHaveText(product.name);
    });

    test(`${product.name}: the details picture is the list picture with the product name as alt text`, { tag: '@AC-3' }, async ({ signedIn, productPage, page }) => {
      const listSrc = await signedIn.imageSrc(product.name);

      await open(signedIn, page, product.name);

      await expect(productPage.image).toHaveAttribute('src', listSrc);
      await expect(productPage.image).toHaveAttribute('alt', product.name);
    });
  }

  test('Add to cart on the details page shows Remove and a badge of 1', { tag: '@AC-4' }, async ({ signedIn, productPage, page }) => {
    await open(signedIn, page, BACKPACK);
    await expect(signedIn.cartBadge).toBeHidden();

    await productPage.addToCart();

    await expect(productPage.removeButton).toBeVisible();
    await expect(productPage.addButton).toHaveCount(0);
    await expect(productPage.cartBadge).toHaveText('1');
  });

  test('Remove on the details page brings back Add to cart and hides the badge', { tag: ['@AC-4', '@AC-5'] }, async ({ signedIn, productPage, page }) => {
    await open(signedIn, page, BACKPACK);
    await productPage.addToCart();
    await expect(productPage.cartBadge).toHaveText('1');

    await productPage.removeFromCart();

    await expect(productPage.addButton).toBeVisible();
    await expect(productPage.removeButton).toHaveCount(0);
    await expect(productPage.cartBadge).toBeHidden();
  });

  test('Remove on the details page lowers the badge when other items are in the cart', { tag: '@AC-5' }, async ({ signedIn, productPage, cartPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(ONESIE);
    await expect(signedIn.cartBadge).toHaveText('2');
    await open(signedIn, page, BACKPACK);

    await productPage.removeFromCart();

    await expect(productPage.addButton).toBeVisible();
    await expect(productPage.removeButton).toHaveCount(0);
    await expect(productPage.cartBadge).toHaveText('1');
    await productPage.openCart();
    await expect(cartPage.itemNames).toHaveText([ONESIE]);
  });

  test('Back to products keeps both added products in the cart and shows Remove on them', { tag: '@AC-6' }, async ({ signedIn, productPage, cartPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await open(signedIn, page, ONESIE);
    await productPage.addToCart();
    await productPage.backToProducts();
    await open(signedIn, page, BACKPACK);
    await expect(productPage.removeButton).toBeVisible();

    await productPage.backToProducts();

    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expectOnlyInCart(signedIn, [BACKPACK, ONESIE]);
    await signedIn.openCart();
    await expect(cartPage.itemNames).toHaveText([BACKPACK, ONESIE]);
  });

  test('a product added on the details page still shows Remove when reopened after Back to products', { tag: '@AC-6' }, async ({ signedIn, productPage, page }) => {
    await open(signedIn, page, BIKE_LIGHT);
    await productPage.addToCart();

    await productPage.backToProducts();

    await expectOnlyInCart(signedIn, [BIKE_LIGHT]);
    await open(signedIn, page, BIKE_LIGHT);
    await expect(productPage.removeButton).toBeVisible();
    await expect(productPage.addButton).toHaveCount(0);
    await expect(productPage.cartBadge).toHaveText('1');
  });

  test('a details page opened by address and reloaded shows Remove and the cart count', { tag: '@AC-7' }, async ({ signedIn, productPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await signedIn.addToCart(ONESIE);
    const url = await open(signedIn, page, BACKPACK);

    await page.goto(url);
    await expect(productPage.name).toHaveText(BACKPACK);
    await expect(productPage.removeButton).toBeVisible();
    await expect(productPage.addButton).toHaveCount(0);
    await expect(productPage.cartBadge).toHaveText('2');

    await page.reload();
    await expect(productPage.name).toHaveText(BACKPACK);
    await expect(productPage.removeButton).toBeVisible();
    await expect(productPage.addButton).toHaveCount(0);
    await expect(productPage.cartBadge).toHaveText('2');
  });

  test('a product that is not in the cart shows Add to cart when opened by address', { tag: '@AC-7' }, async ({ signedIn, productPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await open(signedIn, page, ONESIE);
    const url = page.url();
    await productPage.backToProducts();
    await expect(signedIn.items).toHaveCount(6);

    await page.goto(url);

    await expect(productPage.name).toHaveText(ONESIE);
    await expect(productPage.addButton).toBeVisible();
    await expect(productPage.removeButton).toHaveCount(0);
    await expect(productPage.cartBadge).toHaveText('1');
  });

  test('a single item added on the details page survives a reload and a direct visit', { tag: '@AC-7' }, async ({ signedIn, productPage, page }) => {
    const url = await open(signedIn, page, BIKE_LIGHT);
    await productPage.addToCart();
    await expect(productPage.cartBadge).toHaveText('1');

    await page.reload();
    await expect(productPage.removeButton).toBeVisible();
    await expect(productPage.addButton).toHaveCount(0);
    await expect(productPage.cartBadge).toHaveText('1');

    await page.goto(url);
    await expect(productPage.name).toHaveText(BIKE_LIGHT);
    await expect(productPage.removeButton).toBeVisible();
    await expect(productPage.addButton).toHaveCount(0);
    await expect(productPage.cartBadge).toHaveText('1');
  });

  test('clicking Add to cart several times quickly adds one unit', { tag: '@AC-8' }, async ({ signedIn, productPage, cartPage, page }) => {
    await open(signedIn, page, BACKPACK);

    await productPage.addButton.click({ clickCount: 5, delay: 0 });

    await expect(productPage.removeButton).toBeVisible();
    await expect(productPage.cartBadge).toHaveText('1');
    await productPage.openCart();
    await expect(cartPage.itemNames).toHaveText([BACKPACK]);
  });

  for (const id of ['99', '-1', 'abc', undefined]) {
    test(`product id ${id ?? '(none)'} offers nothing to buy`, { tag: '@AC-9' }, async ({ signedIn, productPage }) => {
      test.fail(true, `bug: AC-9 id ${id ?? '(none)'} shows an item-not-found page with a live Add to cart button`);
      expect(signedIn.items).toBeDefined();

      await productPage.goto(id);

      await expect(productPage.addButton).toHaveCount(0);
      await expect(productPage.removeButton).toHaveCount(0);
      await expect(productPage.price).toHaveCount(0);
      await expect(productPage.name).toHaveCount(0);
    });
  }

  test('a details page cannot be opened without signing in', { tag: '@AC-10' }, async ({ loginPage, productPage, page }) => {
    await productPage.goto('1');

    await expect(page).toHaveURL(/\/$/);
    await expect(loginPage.username).toBeVisible();
    await expect(loginPage.error).toContainText("You can only access '/inventory-item.html' when you are logged in");
    await expect(productPage.name).toHaveCount(0);
    await expect(productPage.price).toHaveCount(0);
  });

  test('after logging out, browser back does not show the product', { tag: '@AC-10' }, async ({ signedIn, productPage, loginPage, page }) => {
    await open(signedIn, page, BACKPACK);
    await productPage.logout();
    await expect(loginPage.loginButton).toBeVisible();

    await page.goBack();

    await expect(loginPage.loginButton).toBeVisible();
    await expect(productPage.name).toHaveCount(0);
    await expect(productPage.addButton).toHaveCount(0);
  });

  for (const persona of [personas.problem, personas.visual]) {
    test(`${persona}: the details picture is the list picture`, { tag: '@AC-11' }, async ({ loginPage, inventoryPage, productPage, page }) => {
      test.fail(true, `bug: AC-11 ${persona} sees a different picture on the details page than on the list`);
      await signInAs(persona, loginPage, inventoryPage);

      for (const product of productsAtoZ) {
        const listSrc = await inventoryPage.imageSrc(product.name);
        await open(inventoryPage, page, product.name);
        await expect(productPage.image).toHaveAttribute('src', listSrc);
        await productPage.backToProducts();
        await expect(inventoryPage.items).toHaveCount(6);
      }
    });
  }

  test('browser back from the details page leaves the same cart as Back to products', { tag: '@AC-12' }, async ({ signedIn, productPage, page }) => {
    await signedIn.addToCart(BACKPACK);
    await open(signedIn, page, ONESIE);
    await productPage.addToCart();
    await expect(productPage.cartBadge).toHaveText('2');

    await page.goBack();

    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expectOnlyInCart(signedIn, [BACKPACK, ONESIE]);

    await open(signedIn, page, ONESIE);
    await productPage.backToProducts();

    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expectOnlyInCart(signedIn, [BACKPACK, ONESIE]);
  });

  test('performance_glitch_user gets a details page matching the list', { tag: '@AC-1' }, async ({ loginPage, inventoryPage, productPage, page }) => {
    test.setTimeout(90_000);
    await loginPage.goto();
    await loginPage.signIn(personas.slow, PASSWORD);
    await expect(inventoryPage.title).toHaveText('Products', { timeout: 30_000 });
    const price = await inventoryPage.price(BACKPACK);

    await expect(async () => {
      await inventoryPage.openProduct(BACKPACK);
      await expect(page).toHaveURL(DETAILS_URL, { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    await expect(productPage.backButton).toBeVisible({ timeout: 30_000 });
    await expect(productPage.name).toHaveText(BACKPACK, { timeout: 30_000 });
    await expect(productPage.price).toHaveText(price);
  });
});
