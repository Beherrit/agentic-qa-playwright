import { PASSWORD, personas } from '../fixtures/personas.ts';
import { expect, test } from '../fixtures/test.ts';

const shopper = { firstName: 'Ada', lastName: 'Lovelace', postalCode: '80202' };
const stepOne = 'https://www.saucedemo.com/checkout-step-one.html';
const stepTwo = 'https://www.saucedemo.com/checkout-step-two.html';

test.describe('Checkout information form errors and recovery', { tag: '@REQ-42' }, () => {
  test.beforeEach(async ({ signedIn, cartPage }) => {
    await signedIn.addToCart('Sauce Labs Backpack');
    await signedIn.addToCart('Sauce Labs Onesie');
    await signedIn.openCart();
    await cartPage.checkout();
  });

  test('a missing first name is reported and the other values are kept', { tag: '@AC-1' }, async ({ page, checkoutPage }) => {
    await checkoutPage.fillShopper({ ...shopper, firstName: '' });
    await checkoutPage.continue();

    await expect(checkoutPage.error).toHaveText('Error: First Name is required');
    await expect(page).toHaveURL(stepOne);
    await expect(checkoutPage.title).toHaveText('Checkout: Your Information');
    await expect(checkoutPage.lastName).toHaveValue('Lovelace');
    await expect(checkoutPage.postalCode).toHaveValue('80202');
  });

  test('a missing last name names only that field and keeps first name', { tag: '@AC-2' }, async ({ page, checkoutPage }) => {
    await checkoutPage.fillShopper({ ...shopper, lastName: '', postalCode: '' });
    await checkoutPage.continue();

    await expect(checkoutPage.error).toHaveText('Error: Last Name is required');
    await expect(checkoutPage.error).not.toContainText('Postal Code');
    await expect(page).toHaveURL(stepOne);
    await expect(checkoutPage.firstName).toHaveValue('Ada');
  });

  test('a missing postal code is reported and both names are kept', { tag: '@AC-3' }, async ({ page, checkoutPage }) => {
    await checkoutPage.fillShopper({ ...shopper, postalCode: '' });
    await checkoutPage.continue();

    await expect(checkoutPage.error).toHaveText('Error: Postal Code is required');
    await expect(page).toHaveURL(stepOne);
    await expect(checkoutPage.firstName).toHaveValue('Ada');
    await expect(checkoutPage.lastName).toHaveValue('Lovelace');
  });

  test('all fields empty names only First Name', { tag: '@AC-4' }, async ({ page, checkoutPage }) => {
    await checkoutPage.continue();

    await expect(checkoutPage.error).toHaveText('Error: First Name is required');
    await expect(page).toHaveURL(stepOne);
  });

  test('first name and postal code missing names only First Name', { tag: ['@AC-4', '@AC-8'] }, async ({ page, checkoutPage }) => {
    await checkoutPage.fillShopper({ ...shopper, firstName: '', postalCode: '' });
    await checkoutPage.continue();

    await expect(checkoutPage.error).toHaveText('Error: First Name is required');
    await expect(checkoutPage.error).not.toContainText('Postal Code');
    await expect(page).toHaveURL(stepOne);
    await expect(checkoutPage.lastName).toHaveValue('Lovelace');
  });

  for (const [label, field] of [
    ['First Name', 'firstName'],
    ['Last Name', 'lastName'],
    ['Postal Code', 'postalCode'],
  ] as const) {
    test(`a space-only ${label} counts as missing`, { tag: '@AC-5' }, async ({ page, checkoutPage }) => {
      test.fail(true, `bug: AC-5 a space-only ${label} is accepted instead of reported as required`);
      await checkoutPage.fillShopper({ ...shopper, [field]: '   ' });
      await checkoutPage.continue();

      await expect(checkoutPage.error).toHaveText(`Error: ${label} is required`);
      await expect(page).toHaveURL(stepOne);
    });
  }

  test('a value padded with spaces is accepted', { tag: '@AC-5' }, async ({ page, checkoutPage }) => {
    await checkoutPage.fillShopper({ ...shopper, firstName: ' Ann ' });
    await checkoutPage.continue();

    await expect(checkoutPage.error).toBeHidden();
    await expect(checkoutPage.title).toHaveText('Checkout: Overview');
    await expect(page).toHaveURL(stepTwo);
  });

  test('closing the error hides it, keeps values, and Continue shows it again', { tag: '@AC-6' }, async ({ page, checkoutPage }) => {
    await checkoutPage.fillShopper({ ...shopper, postalCode: '' });
    await checkoutPage.continue();
    await expect(checkoutPage.error).toHaveText('Error: Postal Code is required');

    await checkoutPage.errorButton.click();

    await expect(checkoutPage.error).toBeHidden();
    await expect(checkoutPage.firstName).toHaveValue('Ada');
    await expect(checkoutPage.lastName).toHaveValue('Lovelace');

    await checkoutPage.continue();

    await expect(checkoutPage.error).toHaveText('Error: Postal Code is required');
    await expect(page).toHaveURL(stepOne);
  });

  test('fixing the missing field after an error reaches the overview', { tag: '@AC-7' }, async ({ page, checkoutPage, cartPage }) => {
    await checkoutPage.fillShopper({ ...shopper, postalCode: '' });
    await checkoutPage.continue();
    await expect(checkoutPage.error).toHaveText('Error: Postal Code is required');

    await checkoutPage.postalCode.fill('80202');
    await checkoutPage.continue();

    await expect(checkoutPage.title).toHaveText('Checkout: Overview');
    await expect(page).toHaveURL(stepTwo);
    await expect(cartPage.itemNames).toHaveText(['Sauce Labs Backpack', 'Sauce Labs Onesie']);
  });

  test('with two fields missing, fixing the first moves the error to the next', { tag: '@AC-8' }, async ({ page, checkoutPage }) => {
    await checkoutPage.fillShopper({ ...shopper, firstName: '', postalCode: '' });
    await checkoutPage.continue();
    await expect(checkoutPage.error).toHaveText('Error: First Name is required');

    await checkoutPage.firstName.fill('Ada');
    await checkoutPage.continue();

    await expect(checkoutPage.error).toHaveCount(1);
    await expect(checkoutPage.error).toHaveText('Error: Postal Code is required');
    await expect(page).toHaveURL(stepOne);
    await expect(checkoutPage.firstName).toHaveValue('Ada');
    await expect(checkoutPage.lastName).toHaveValue('Lovelace');
  });

  test('typed values survive a reload, including space-only ones, with no error', { tag: '@AC-9' }, async ({ page, checkoutPage }) => {
    test.fail(true, 'bug: AC-9 typed values are lost on reload, all fields come back empty');
    await checkoutPage.fillShopper({ firstName: '   ', lastName: 'Lovelace', postalCode: '80202' });

    await page.reload();

    await expect(checkoutPage.firstName).toHaveValue('   ');
    await expect(checkoutPage.lastName).toHaveValue('Lovelace');
    await expect(checkoutPage.postalCode).toHaveValue('80202');
    await expect(checkoutPage.error).toBeHidden();
  });

  test('typed values survive a reload while an error is showing, and the error is gone', { tag: '@AC-9' }, async ({ page, checkoutPage }) => {
    test.fail(true, 'bug: AC-9 typed values are lost on reload, all fields come back empty');
    await checkoutPage.fillShopper({ ...shopper, postalCode: '' });
    await checkoutPage.continue();
    await expect(checkoutPage.error).toBeVisible();

    await page.reload();

    await expect(checkoutPage.firstName).toHaveValue('Ada');
    await expect(checkoutPage.lastName).toHaveValue('Lovelace');
    await expect(checkoutPage.error).toBeHidden();
  });

  test('cancel then Checkout again gives empty fields and no error', { tag: '@AC-10' }, async ({ page, checkoutPage, cartPage }) => {
    await checkoutPage.fillShopper({ ...shopper, postalCode: '' });
    await checkoutPage.continue();
    await expect(checkoutPage.error).toBeVisible();

    await checkoutPage.cancelButton.click();
    await expect(page).toHaveURL(/cart\.html$/);
    await expect(cartPage.itemNames).toHaveText(['Sauce Labs Backpack', 'Sauce Labs Onesie']);
    await cartPage.checkout();

    await expect(checkoutPage.firstName).toHaveValue('');
    await expect(checkoutPage.lastName).toHaveValue('');
    await expect(checkoutPage.postalCode).toHaveValue('');
    await expect(checkoutPage.error).toBeHidden();
  });

  test('cancel without an error then Checkout again gives empty fields', { tag: '@AC-10' }, async ({ page, checkoutPage, cartPage }) => {
    await checkoutPage.fillShopper(shopper);

    await checkoutPage.cancelButton.click();
    await expect(page).toHaveURL(/cart\.html$/);
    await cartPage.checkout();

    await expect(checkoutPage.firstName).toHaveValue('');
    await expect(checkoutPage.lastName).toHaveValue('');
    await expect(checkoutPage.postalCode).toHaveValue('');
    await expect(checkoutPage.error).toBeHidden();
  });

  test('double-clicking Continue with valid data reaches the overview once', { tag: '@AC-12' }, async ({ page, checkoutPage, cartPage }) => {
    await checkoutPage.fillShopper(shopper);
    await checkoutPage.continueButton.dblclick();

    await expect(checkoutPage.title).toHaveText('Checkout: Overview');
    await expect(page).toHaveURL(stepTwo);
    await expect(checkoutPage.error).toBeHidden();
    await expect(cartPage.itemNames).toHaveText(['Sauce Labs Backpack', 'Sauce Labs Onesie']);
  });
});

test.describe('Checkout information last name kept for other accounts', { tag: '@REQ-42' }, () => {
  // Each account signs in by itself, so a normal run covers them all, whatever SAUCE_USER is.
  for (const account of [personas.problem, personas.error]) {
    test(`the typed last name is kept after a failed Continue as ${account}`, { tag: '@AC-11' }, async ({
      page,
      loginPage,
      inventoryPage,
      cartPage,
      checkoutPage,
    }) => {
      test.fail(true, `bug: AC-11 ${account} loses the typed last name`);
      await loginPage.goto();
      await loginPage.signIn(account, PASSWORD);
      await expect(inventoryPage.title).toHaveText('Products');
      await inventoryPage.addToCart('Sauce Labs Backpack');
      await inventoryPage.openCart();
      await cartPage.checkout();

      await checkoutPage.fillShopper({ ...shopper, firstName: '' });
      await checkoutPage.continue();

      await expect(checkoutPage.error).toHaveText('Error: First Name is required');
      await expect(page).toHaveURL(stepOne);
      await expect(checkoutPage.lastName).toHaveValue('Lovelace');
    });
  }
});
