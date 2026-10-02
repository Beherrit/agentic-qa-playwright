import { PASSWORD, personas } from '../fixtures/personas.ts';
import { expect, test } from '../fixtures/test.ts';

test.describe('Login', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.goto();
  });

  test('a valid user lands on the product list', async ({ loginPage, inventoryPage, page }) => {
    await loginPage.signIn(personas.standard, PASSWORD);

    await expect(page).toHaveURL(/inventory\.html/);
    await expect(inventoryPage.title).toHaveText('Products');
    await expect(inventoryPage.items).toHaveCount(6);
  });

  test('a locked out user is told why they cannot sign in', async ({ loginPage, page }) => {
    await loginPage.signIn(personas.lockedOut, PASSWORD);

    await expect(loginPage.error).toContainText('this user has been locked out');
    await expect(page).not.toHaveURL(/inventory/);
  });

  test('a wrong password is rejected without saying which field was wrong', async ({ loginPage }) => {
    await loginPage.signIn(personas.standard, 'not-the-password');

    await expect(loginPage.error).toContainText('Username and password do not match any user');
  });

  test('username is required', async ({ loginPage }) => {
    await loginPage.signIn('', PASSWORD);

    await expect(loginPage.error).toContainText('Username is required');
  });

  test('password is required', async ({ loginPage }) => {
    await loginPage.signIn(personas.standard, '');

    await expect(loginPage.error).toContainText('Password is required');
  });

  test('the product list cannot be opened without signing in', async ({ loginPage, page }) => {
    await page.goto('/inventory.html');

    await expect(loginPage.loginButton).toBeVisible();
    await expect(loginPage.error).toContainText("You can only access '/inventory.html' when you are logged in");
  });

  test('logging out returns to the login page', async ({ loginPage, inventoryPage }) => {
    await loginPage.signIn(personas.standard, PASSWORD);
    await inventoryPage.logout();

    await expect(loginPage.loginButton).toBeVisible();
  });
});
