import { expect, test } from '../fixtures/test.ts';

/**
 * The first spec, in the shape every spec follows: `test` and `expect` from fixtures/test.ts, a page object as an
 * argument, a describe block tagged with the requirement it covers, a title that states the behaviour, an
 * assertion on what the user can see. Replace it with the app's own first behaviour; keep the shape.
 */
test.describe('Smoke', { tag: '@REQ-0' }, () => {
  test('the home page opens and shows its heading', { tag: '@AC-1' }, async ({ homePage }) => {
    await homePage.goto();
    await expect(homePage.heading).toBeVisible();
  });
});
