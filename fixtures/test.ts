import { AxeBuilder } from '@axe-core/playwright';
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
  /** Runs by itself. See below. */
  accessibilityScan: void;
};

type AxeResult = { id: string; impact?: string | null; help: string; helpUrl: string; nodes: unknown[] };

const brief = (results: AxeResult[]) =>
  results.map((r) => ({ rule: r.id, impact: r.impact ?? 'unknown', help: r.help, helpUrl: r.helpUrl, elements: r.nodes.length }));

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

  // With QA_A11Y set, every test that passes ends with an axe scan of the page it finished on, attached to
  // the test as data. It never fails a test: the pipeline's accessibility gate reads the attachments and reports.
  accessibilityScan: [
    async ({ page }, use, testInfo) => {
      await use();
      if (!process.env.QA_A11Y || testInfo.status !== 'passed' || page.isClosed() || !page.url().startsWith('http')) return;
      const results = await new AxeBuilder({ page }).analyze();
      await testInfo.attach('a11y', {
        contentType: 'application/json',
        body: JSON.stringify({ url: page.url(), violations: brief(results.violations), incomplete: brief(results.incomplete) }),
      });
    },
    { auto: true },
  ],
});

export { expect };
