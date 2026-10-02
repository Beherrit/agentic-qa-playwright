import { expect, test } from '../fixtures/test.ts';
import type { InventoryPage } from '../pages/InventoryPage.ts';
import { PASSWORD, personas } from '../fixtures/personas.ts';
import {
  namesAtoZ,
  namesZtoA,
  pricesHighToLow,
  pricesLowToHigh,
  productsAtoZ,
  sortOptions,
} from '../fixtures/products.ts';

const ONESIE = 'Sauce Labs Onesie';
const BACKPACK = 'Sauce Labs Backpack';
const BIKE_LIGHT = 'Sauce Labs Bike Light';
const FLEECE = 'Sauce Labs Fleece Jacket';
const RED_SHIRT = 'Test.allTheThings() T-Shirt (Red)';

/** What the list must show for each option value: which column to read, and the expected sequence. */
const orders = {
  az: { column: (p: InventoryPage) => p.itemNames, expected: namesAtoZ },
  za: { column: (p: InventoryPage) => p.itemNames, expected: namesZtoA },
  lohi: { column: (p: InventoryPage) => p.itemPrices, expected: pricesLowToHigh },
  hilo: { column: (p: InventoryPage) => p.itemPrices, expected: pricesHighToLow },
};
type OptionValue = keyof typeof orders;

const labels: Record<OptionValue, string> = {
  az: sortOptions.az,
  za: sortOptions.za,
  lohi: sortOptions.lohi,
  hilo: sortOptions.hilo,
};

async function expectOrder(inventory: InventoryPage, value: OptionValue): Promise<void> {
  await expect(inventory.sortSelect).toHaveValue(value);
  await expect(inventory.items).toHaveCount(6);
  await expect(orders[value].column(inventory)).toHaveText(orders[value].expected);
}

test.describe('Product sorting', { tag: '@REQ-1' }, () => {
  test('the list loads sorted A to Z with the control showing Name (A to Z)', { tag: '@AC-1' }, async ({ signedIn }) => {
    await expect(signedIn.sortSelect).toHaveValue('az');
    await expect(signedIn.sortSelect.getByRole('option', { selected: true })).toHaveText(sortOptions.az);
    await expect(signedIn.itemNames).toHaveText(namesAtoZ);
  });

  test('the sort control offers exactly the four options in order', { tag: '@AC-1' }, async ({ signedIn }) => {
    await expect(signedIn.sortSelect.getByRole('option')).toHaveText([
      sortOptions.az,
      sortOptions.za,
      sortOptions.lohi,
      sortOptions.hilo,
    ]);
    await expect(signedIn.sortSelect).toHaveValue('az');
  });

  test('Name (Z to A) lists the names in reverse order', { tag: '@AC-2' }, async ({ signedIn }) => {
    await signedIn.sortBy(sortOptions.za);

    await expect(signedIn.itemNames).toHaveText(namesZtoA);
    await expect(signedIn.itemNames.first()).toHaveText(RED_SHIRT);
    await expect(signedIn.itemNames.last()).toHaveText(BACKPACK);
  });

  test('Price (low to high) shows the cheapest product first', { tag: '@AC-3' }, async ({ signedIn }) => {
    await signedIn.sortBy(sortOptions.lohi);

    await expect(signedIn.itemPrices).toHaveText(pricesLowToHigh);
    await expect(signedIn.itemNames.first()).toHaveText(ONESIE);
    await expect(signedIn.itemNames.last()).toHaveText(FLEECE);
  });

  test('Price (high to low) shows the most expensive product first', { tag: '@AC-4' }, async ({ signedIn }) => {
    await signedIn.sortBy(sortOptions.hilo);

    await expect(signedIn.itemPrices).toHaveText(pricesHighToLow);
    await expect(signedIn.itemNames.first()).toHaveText(FLEECE);
    await expect(signedIn.itemNames.last()).toHaveText(ONESIE);
  });

  for (const value of ['lohi', 'hilo'] as const) {
    test(`${labels[value]} keeps each product once with its own price, description and image`, { tag: '@AC-5' }, async ({ signedIn }) => {
      await signedIn.sortBy(labels[value]);
      await expectOrder(signedIn, value);

      const cards = await signedIn.readCards();
      expect(cards.map((c) => c.name).sort()).toEqual([...namesAtoZ].sort());
      for (const product of productsAtoZ) {
        const card = cards.find((c) => c.name === product.name);
        expect(card?.price).toBe(product.price);
        expect(card?.description).toContain(product.description);
        expect(card?.alt).toBe(product.name);
      }
    });
  }

  for (const value of ['za', 'az'] as const) {
    test(`${labels[value]} keeps each product once with its own price, description and image`, { tag: ['@AC-2', '@AC-5'] }, async ({ signedIn }) => {
      await signedIn.sortBy(sortOptions.za);
      await signedIn.sortBy(labels[value]);
      await expectOrder(signedIn, value);

      const cards = await signedIn.readCards();
      expect(cards.map((c) => c.name).sort()).toEqual([...namesAtoZ].sort());
      for (const product of productsAtoZ) {
        const card = cards.find((c) => c.name === product.name);
        expect(card?.price).toBe(product.price);
        expect(card?.description).toContain(product.description);
        expect(card?.alt).toBe(product.name);
      }
    });
  }

  test('switching from Price (high to low) back to Name (A to Z) restores the default order', { tag: '@AC-6' }, async ({ signedIn }) => {
    await signedIn.sortBy(sortOptions.hilo);
    await expectOrder(signedIn, 'hilo');

    await signedIn.sortBy(sortOptions.az);

    await expect(signedIn.sortSelect.getByRole('option', { selected: true })).toHaveText(sortOptions.az);
    await expectOrder(signedIn, 'az');
  });

  test('choosing the selected option again changes nothing', { tag: '@AC-7' }, async ({ signedIn }) => {
    await signedIn.sortBy(sortOptions.lohi);
    await expectOrder(signedIn, 'lohi');
    const before = await signedIn.itemNames.allTextContents();

    await signedIn.sortBy(sortOptions.lohi);

    await expectOrder(signedIn, 'lohi');
    await expect(signedIn.itemNames).toHaveText(before);
  });

  test('after a reload the control label matches the displayed order', { tag: '@AC-8' }, async ({ signedIn, page }) => {
    await signedIn.sortBy(sortOptions.za);
    await expectOrder(signedIn, 'za');

    await page.reload();

    await expect(signedIn.items).toHaveCount(6);
    const value = await signedIn.sortSelect.inputValue();
    expect(['az', 'za']).toContain(value);
    await expectOrder(signedIn, value as OptionValue);
  });

  test('sorting by price keeps the cart badge and the Remove button', { tag: '@AC-9' }, async ({ signedIn, page }) => {
    await signedIn.addToCart(ONESIE);

    for (const value of ['hilo', 'lohi'] as const) {
      await signedIn.sortBy(labels[value]);
      await expectOrder(signedIn, value);
      await expect(signedIn.cartBadge).toHaveText('1');
      await expect(signedIn.removeButton(ONESIE)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add to cart' })).toHaveCount(5);
    }
  });

  test('returning from a product page leaves the label matching the order', { tag: '@AC-10' }, async ({ signedIn, productPage, page }) => {
    await signedIn.sortBy(sortOptions.lohi);
    await expectOrder(signedIn, 'lohi');

    for (const goBack of [() => productPage.backToProducts(), () => page.goBack()]) {
      // Right after the list is redrawn, a click on a product is sometimes swallowed and the page stays put
      // (about one run in four). The click is repeated until the product page opens, so this test stays about
      // what it is for: the order after coming back.
      await expect(async () => {
        await signedIn.openProduct(BIKE_LIGHT);
        await expect(page).toHaveURL(/inventory-item/, { timeout: 2_000 });
      }).toPass();
      await expect(productPage.name).toHaveText(BIKE_LIGHT);
      await goBack();

      await expect(signedIn.items).toHaveCount(6);
      const value = await signedIn.sortSelect.inputValue();
      expect(['az', 'lohi']).toContain(value);
      await expectOrder(signedIn, value as OptionValue);
    }
  });

  test('a chain of sort changes always ends in the order of the last choice', { tag: ['@AC-6', '@AC-7'] }, async ({ signedIn }) => {
    for (const value of ['hilo', 'za', 'lohi', 'az', 'hilo'] as const) {
      await signedIn.sortBy(labels[value]);
      await expectOrder(signedIn, value);
    }
    await expect(signedIn.itemPrices.first()).toHaveText('$49.99');
    await expect(signedIn.itemPrices.last()).toHaveText('$7.99');
  });

  test('the right product opens and the cart holds the right items after sorting', { tag: ['@AC-9', '@AC-10'] }, async ({ signedIn, productPage, cartPage, page }) => {
    await signedIn.sortBy(sortOptions.hilo);
    // A click right after the list is redrawn is sometimes swallowed; repeat it until the product page opens.
    await expect(async () => {
      await signedIn.openProduct(BACKPACK);
      await expect(page).toHaveURL(/inventory-item/, { timeout: 2_000 });
    }).toPass();
    await expect(productPage.name).toHaveText(BACKPACK);
    await expect(productPage.price).toHaveText('$29.99');
    await productPage.addToCart();
    await productPage.backToProducts();

    await signedIn.addToCart(ONESIE);
    await signedIn.sortBy(sortOptions.lohi);
    await expect(signedIn.cartBadge).toHaveText('2');
    await signedIn.openCart();

    await expect(cartPage.itemNames).toHaveText([BACKPACK, ONESIE]);
    await expect(cartPage.item(BACKPACK)).toContainText('$29.99');
    await expect(cartPage.item(ONESIE)).toContainText('$7.99');
  });
});

test.describe('Product sorting for the defect personas', { tag: '@REQ-1' }, () => {
  async function signInAs(persona: string, loginPage: { goto(): Promise<void>; signIn(u: string, p: string): Promise<void> }, inventory: InventoryPage) {
    await loginPage.goto();
    await loginPage.signIn(persona, PASSWORD);
    await expect(inventory.title).toHaveText('Products');
  }

  // problem_user and error_user: sorting is observed to be broken for every option except the default.
  for (const persona of [personas.problem, personas.error]) {
    for (const value of ['za', 'lohi', 'hilo'] as const) {
      test(`${persona}: ${labels[value]} orders the list as labelled`, { tag: '@AC-11' }, async ({ loginPage, inventoryPage }) => {
        test.fail(true, `bug: AC-11 ${persona} sorting by ${labels[value]} does not reorder the list`);
        await signInAs(persona, loginPage, inventoryPage);

        await inventoryPage.sortBy(labels[value]);

        await expect(inventoryPage.sortSelect).toHaveValue(value);
        await expect(orders[value].column(inventoryPage)).toHaveText(orders[value].expected);
      });
    }
  }

  for (const persona of [personas.problem, personas.error, personas.visual]) {
    test(`${persona}: Name (A to Z) shows the names in order`, { tag: '@AC-11' }, async ({ loginPage, inventoryPage }) => {
      await signInAs(persona, loginPage, inventoryPage);

      await expect(inventoryPage.sortSelect).toHaveValue('az');
      await expect(inventoryPage.itemNames).toHaveText(namesAtoZ);
    });
  }

  test(`${personas.visual}: Name (Z to A) orders the list as labelled`, { tag: '@AC-11' }, async ({ loginPage, inventoryPage }) => {
    await signInAs(personas.visual, loginPage, inventoryPage);

    await inventoryPage.sortBy(sortOptions.za);

    await expect(inventoryPage.sortSelect).toHaveValue('za');
    await expect(inventoryPage.itemNames).toHaveText(namesZtoA);
  });

  // visual_user shows different (random) prices after a price sort, so the price order cannot match the listed prices.
  for (const value of ['lohi', 'hilo'] as const) {
    test(`${personas.visual}: ${labels[value]} orders the list as labelled`, { tag: '@AC-11' }, async ({ loginPage, inventoryPage }) => {
      test.fail(true, `bug: AC-11 visual_user prices after ${labels[value]} are not the product prices and are not in order`);
      await signInAs(personas.visual, loginPage, inventoryPage);

      await inventoryPage.sortBy(labels[value]);

      await expect(inventoryPage.sortSelect).toHaveValue(value);
      await expect(orders[value].column(inventoryPage)).toHaveText(orders[value].expected);
    });
  }
});
