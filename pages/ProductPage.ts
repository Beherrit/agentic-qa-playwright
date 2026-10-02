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
    this.removeButton = page.getByRole('button', { name: 'Remove' });
    this.description = page.getByTestId('inventory-item-desc');
    this.image = page.getByTestId(/^item-.*-img$/);
    this.name = page.getByTestId('inventory-item-name');
    this.price = page.getByTestId('inventory-item-price');
    this.backButton = page.getByRole('button', { name: 'Back to products' });
    this.addButton = page.getByRole('button', { name: 'Add to cart' });
  }

  async addToCart(): Promise<void> {
    await this.addButton.click();
  }

  async removeFromCart(): Promise<void> {
    await this.removeButton.click();
  }

  /** Opens a details page by URL, as a shopper typing the address would. */
  async goto(query: string): Promise<void> {
    await this.page.goto(`/inventory-item.html${query}`);
  }

  async backToProducts(): Promise<void> {
    await this.backButton.click();
    await this.backButton.waitFor({ state: 'hidden' });
  }
}
