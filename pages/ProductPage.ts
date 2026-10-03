import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage.ts';

/** The detail page of a single product. */
export class ProductPage extends BasePage {
  readonly name: Locator;
  readonly price: Locator;
  readonly backButton: Locator;
  readonly addButton: Locator;
  readonly removeButton: Locator;
  readonly description: Locator;
  readonly image: Locator;

  constructor(page: Page) {
    super(page);
    this.name = page.getByTestId('inventory-item-name');
    this.price = page.getByTestId('inventory-item-price');
    this.backButton = page.getByRole('button', { name: 'Back to products' });
    this.addButton = page.getByRole('button', { name: 'Add to cart' });
    this.removeButton = page.getByRole('button', { name: 'Remove' });
    this.description = page.getByTestId('inventory-item-desc');
    this.image = page.getByRole('main').getByRole('img');
  }

  /** Opens the details page by its address, as a shopper with a bookmark would. A missing id opens the bare page. */
  async goto(id?: string): Promise<void> {
    await this.page.goto(id === undefined ? '/inventory-item.html' : `/inventory-item.html?id=${id}`);
  }

  async addToCart(): Promise<void> {
    await this.addButton.click();
  }

  async removeFromCart(): Promise<void> {
    await this.removeButton.click();
  }

  async backToProducts(): Promise<void> {
    await this.backButton.click();
  }
}
