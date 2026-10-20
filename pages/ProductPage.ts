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
    // The product page reuses the list's test ids (inventory-item-name, inventory-item-price, and even the
    // inventory-item container), and after a click the URL changes before the list is replaced, so an unscoped
    // locator briefly matches all six cards and fails strict mode. The one thing only the product page has is the
    // inventory_details wrapper, hence a class here where the rest of the suite uses test ids.
    const details = page.locator('.inventory_details');
    this.name = details.getByTestId('inventory-item-name');
    this.price = details.getByTestId('inventory-item-price');
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
