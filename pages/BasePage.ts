import type { Locator, Page } from '@playwright/test';

/** What every signed-in page shares: the header title, the cart icon and the side menu. */
export abstract class BasePage {
  protected readonly page: Page;
  readonly title: Locator;
  readonly cartLink: Locator;
  readonly cartBadge: Locator;
  readonly menuButton: Locator;
  readonly logoutLink: Locator;
  readonly resetLink: Locator;
  readonly closeMenuButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.getByTestId('title');
    this.cartLink = page.getByTestId('shopping-cart-link');
    this.cartBadge = page.getByTestId('shopping-cart-badge');
    this.menuButton = page.getByRole('button', { name: 'Open Menu' });
    this.logoutLink = page.getByTestId('logout-sidebar-link');
    this.resetLink = page.getByTestId('reset-sidebar-link');
    this.closeMenuButton = page.getByRole('button', { name: 'Close Menu' });
  }

  async openCart(): Promise<void> {
    await this.cartLink.click();
  }

  async resetAppState(): Promise<void> {
    await this.menuButton.click();
    await this.resetLink.click();
  }

  async closeMenu(): Promise<void> {
    await this.closeMenuButton.click();
  }

  async logout(): Promise<void> {
    await this.menuButton.click();
    await this.logoutLink.click();
  }
}
