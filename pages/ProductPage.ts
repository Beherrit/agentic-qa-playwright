import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage.ts';

/** The detail page of a single product. */
export class ProductPage extends BasePage {
  readonly name: Locator;
  readonly price: Locator;
  readonly backButton: Locator;
  readonly addButton: Locator;

  constructor(page: Page) {
    super(page);
    this.name = page.getByTestId('inventory-item-name');
    this.price = page.getByTestId('inventory-item-price');
    this.backButton = page.getByRole('button', { name: 'Back to products' });
    this.addButton = page.getByRole('button', { name: 'Add to cart' });
  }

  async addToCart(): Promise<void> {
    await this.addButton.click();
  }

  async backToProducts(): Promise<void> {
    await this.backButton.click();
  }
}
