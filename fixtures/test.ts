import { test as base, expect } from '@playwright/test';
import { CartPage } from '../pages/CartPage.ts';
import { CheckoutPage } from '../pages/CheckoutPage.ts';
import { InventoryPage } from '../pages/InventoryPage.ts';
import { ProductPage } from '../pages/ProductPage.ts';
import { LoginPage } from '../pages/LoginPage.ts';
import { defaultUser, PASSWORD } from './personas.ts';

type Fixtures = {
  loginPage: LoginPage;
  inventoryPage: InventoryPage;
  cartPage: CartPage;
  checkoutPage: CheckoutPage;
  productPage: ProductPage;
  /** Signs in as the default user and hands back the product list. Use it when the test starts after login. */
  signedIn: InventoryPage;
};

export const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  inventoryPage: async ({ page }, use) => use(new InventoryPage(page)),
  cartPage: async ({ page }, use) => use(new CartPage(page)),
  checkoutPage: async ({ page }, use) => use(new CheckoutPage(page)),

  productPage: async ({ page }, use) => use(new ProductPage(page)),

  signedIn: async ({ loginPage, inventoryPage }, use) => {
    await loginPage.goto();
    await loginPage.signIn(defaultUser, PASSWORD);
    await expect(inventoryPage.title).toHaveText('Products');
    await use(inventoryPage);
  },
});

export { expect };
