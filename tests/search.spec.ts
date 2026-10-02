import { expect, test } from '../fixtures/test.ts';
import { namesAtoZ, sortOptions } from '../fixtures/products.ts';

const BACKPACK = 'Sauce Labs Backpack';
const BIKE_LIGHT = 'Sauce Labs Bike Light';
const BOLT_SHIRT = 'Sauce Labs Bolt T-Shirt';
const ONESIE = 'Sauce Labs Onesie';
const RED_SHIRT = 'Test.allTheThings() T-Shirt (Red)';
const sauceLabsAtoZ = namesAtoZ.filter((n) => n.startsWith('Sauce Labs'));
const sauceLabsZtoA = [...sauceLabsAtoZ].reverse();
const sauceLabsPricesLowToHigh = ['$7.99', '$9.99', '$15.99', '$29.99', '$49.99'];

test.describe('Product search', { tag: '@REQ-4' }, () => {
  test('the search box is empty with its placeholder and all six products are listed', { tag: '@AC-1' }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    await expect(signedIn.items).toHaveCount(6);
    await expect(signedIn.itemNames).toHaveText(namesAtoZ);
    await expect(signedIn.noResults).toBeHidden();
    await expect(signedIn.searchBox).toHaveAttribute('placeholder', 'Search products');
    await expect(signedIn.searchBox).toHaveValue('');
    const boxTop = (await signedIn.searchBox.boundingBox())?.y ?? Infinity;
    const firstItemTop = (await signedIn.items.first().boundingBox())?.y ?? -Infinity;
    expect(boxTop).toBeLessThan(firstItemTop);
    await expect(signedIn.searchBox).toBeVisible();
  });

  test('searching Backpack lists only the backpack', { tag: '@AC-2' }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    await signedIn.search('Backpack');
    await expect(signedIn.noResults).toBeHidden();
    await expect(signedIn.itemNames).toHaveText([BACKPACK]);
  });

  test('searching Sauce Labs lists the five Sauce Labs products and not the red T-shirt', { tag: '@AC-3' }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    await signedIn.search('Sauce Labs');
    await expect(signedIn.item(RED_SHIRT)).toHaveCount(0);
    await expect(signedIn.itemNames).toHaveText(sauceLabsAtoZ);
  });

  test('matching ignores case', { tag: '@AC-4' }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    for (const term of ['backpack', 'BACKPACK', 'BaCkPaCk']) {
      await signedIn.search(term);
      await expect(signedIn.items).toHaveCount(1);
      await expect(signedIn.itemNames).toHaveText([BACKPACK]);
    }
  });

  test('clearing the box restores all six products', { tag: '@AC-5' }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    await signedIn.search('Onesie');
    await expect(signedIn.items).toHaveCount(1);
    await signedIn.search('');
    await expect(signedIn.searchBox).toHaveValue('');
    await expect(signedIn.itemNames).toHaveText(namesAtoZ);
  });

  test('backspacing widens the list step by step back to all six', { tag: '@AC-5' }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    await signedIn.searchBox.pressSequentially('Backpack');
    await signedIn.searchBox.press('Backspace');
    await expect(signedIn.searchBox).toHaveValue('Backpac');
    await expect(signedIn.itemNames).toHaveText([BACKPACK]);
    for (let i = 0; i < 5; i++) await signedIn.searchBox.press('Backspace');
    await expect(signedIn.searchBox).toHaveValue('Ba');
    await expect(signedIn.itemNames).toHaveText([BACKPACK]);
    await signedIn.searchBox.press('Backspace');
    await expect(signedIn.searchBox).toHaveValue('B');
    await expect(signedIn.itemNames).toHaveText(sauceLabsAtoZ);
    await signedIn.searchBox.press('Backspace');
    await expect(signedIn.searchBox).toHaveValue('');
    await expect(signedIn.noResults).toBeHidden();
    await expect(signedIn.itemNames).toHaveText(namesAtoZ);
  });

  test('a term that matches nothing shows No products found', { tag: '@AC-6' }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    await signedIn.search('zzzz');
    await expect(signedIn.items).toHaveCount(0);
    await expect(signedIn.noResults).toHaveText('No products found');
  });

  test('the no-results message goes away on clear and on a matching term', { tag: '@AC-7' }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    await signedIn.search('zzzz');
    await expect(signedIn.noResults).toBeVisible();
    await signedIn.search('');
    await expect(signedIn.noResults).toBeHidden();
    await expect(signedIn.items).toHaveCount(6);
    await signedIn.search('zzzz');
    await expect(signedIn.noResults).toBeVisible();
    await signedIn.search('Onesie');
    await expect(signedIn.noResults).toBeHidden();
    await expect(signedIn.itemNames).toHaveText([ONESIE]);
  });

  test('only names are searched, not descriptions', { tag: '@AC-8' }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    for (const term of ['carry', 'battery']) {
      await signedIn.search(term);
      await expect(signedIn.items).toHaveCount(0);
      await expect(signedIn.noResults).toHaveText('No products found');
    }
  });

  test('a term in the middle of a name matches', { tag: '@AC-9' }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    await signedIn.search('Backpack');
    await expect(signedIn.items).toHaveCount(1);
    await signedIn.search('shirt');
    await expect(signedIn.itemNames).toHaveText([BOLT_SHIRT, RED_SHIRT]);
  });

  test('changing the sort order keeps the filter and applies the new order', { tag: '@AC-10' }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    await signedIn.search('Sauce Labs');
    await signedIn.sortBy(sortOptions.za);
    await expect(signedIn.itemNames).toHaveText(sauceLabsZtoA);
    await signedIn.sortBy(sortOptions.lohi);
    await expect(signedIn.searchBox).toHaveValue('Sauce Labs');
    await expect(signedIn.itemPrices).toHaveText(sauceLabsPricesLowToHigh);
  });

  test('sorting first and then searching gives the filtered list in the chosen order', { tag: '@AC-10' }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    await signedIn.sortBy(sortOptions.za);
    await signedIn.search('Sauce Labs');
    await expect(signedIn.itemNames).toHaveText(sauceLabsZtoA);
    await signedIn.search('shirt');
    await expect(signedIn.itemNames).toHaveText([RED_SHIRT, BOLT_SHIRT]);
    await signedIn.sortBy(sortOptions.lohi);
    await expect(signedIn.items).toHaveCount(2);
    await expect(signedIn.sortSelect).toHaveValue('lohi');
    await expect(signedIn.itemPrices).toHaveText(['$15.99', '$15.99']);
  });

  test('a product added during a search stays in the cart after the search is cleared', { tag: '@AC-11' }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    await signedIn.search('Bike Light');
    await signedIn.addToCart(BIKE_LIGHT);
    await signedIn.search('');
    await expect(signedIn.items).toHaveCount(6);
    await expect(signedIn.cartBadge).toHaveText('1');
    await expect(signedIn.addButtons).toHaveCount(5);
    await expect(signedIn.removeButton(BIKE_LIGHT)).toBeVisible();
  });

  test('a product added from the full list shows Remove when searched for', { tag: '@AC-11' }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    await signedIn.addToCart(BACKPACK);
    await signedIn.search('Sauce Labs');
    await expect(signedIn.removeButton(BACKPACK)).toBeVisible();
    await expect(signedIn.addButtons).toHaveCount(4);
    await signedIn.search('Onesie');
    await expect(signedIn.cartBadge).toHaveText('1');
    await expect(signedIn.addButton(ONESIE)).toBeVisible();
    await expect(signedIn.itemNames).toHaveText([ONESIE]);
  });

  test('special characters in the term are matched literally', { tag: ['@AC-2', '@AC-6'] }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    for (const term of ['Test.all', '()', '(']) {
      await signedIn.search(term);
      await expect(signedIn.itemNames).toHaveText([RED_SHIRT]);
    }
    await signedIn.search('.*');
    await expect(signedIn.items).toHaveCount(0);
    await expect(signedIn.noResults).toBeVisible();
  });

  test('typing narrows the list one keystroke at a time with no Enter', { tag: ['@AC-2', '@AC-6'] }, async ({ signedIn }) => {
    test.fail(true, 'not built yet: REQ-4');
    await signedIn.searchBox.pressSequentially('S');
    await expect(signedIn.items).toHaveCount(6);
    await signedIn.searchBox.pressSequentially('auce Labs Bo');
    await expect(signedIn.itemNames).toHaveText([BOLT_SHIRT]);
    await signedIn.searchBox.pressSequentially('x');
    await expect(signedIn.items).toHaveCount(0);
    await expect(signedIn.noResults).toBeVisible();
  });
});
