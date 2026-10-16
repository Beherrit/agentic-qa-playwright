import { test as base, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage.ts';
import { applyFault, attachProbe, faultFromEnv } from './fault.ts';

/**
 * The `test` and `expect` every spec imports. A page object gets a fixture here, so a test receives it as an
 * argument instead of constructing it, and a change to how a page object is built happens in one place.
 *
 * Add a fixture per page object as the suite grows:
 *   type Fixtures = { homePage: HomePage; checkoutPage: CheckoutPage };
 *   checkoutPage: async ({ page }, use) => use(new CheckoutPage(page)),
 * and a fixture for a state tests start from, such as `signedIn`, that does the setup once and hands back the page.
 */

type Fixtures = {
  homePage: HomePage;
};

export const test = base.extend<Fixtures>({
  // The pipeline's sensitivity gate can hand every test a broken version of the app (QA_FAULT). Nothing happens
  // otherwise. With a probe in the fault, the page is asked afterwards whether the breakage was visible.
  page: async ({ page }, use, testInfo) => {
    const fault = faultFromEnv();
    if (fault) await applyFault(page, fault);
    await use(page);
    await attachProbe(page, testInfo, fault);
  },

  homePage: async ({ page }, use) => use(new HomePage(page)),
});

export { expect };
