import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage.ts';

export class InventoryPage extends BasePage {
  readonly items: Locator;
  readonly itemNames: Locator;
  readonly itemPrices: Locator;

  constructor(page: Page) {
    super(page);
    this.items = page.getByTestId('inventory-item');
    this.itemNames = page.getByTestId('inventory-item-name');
    this.itemPrices = page.getByTestId('inventory-item-price');
  }

  /** The card for one product, found by its visible name. */
  item(name: string): Locator {
    return this.items.filter({ has: this.page.getByText(name, { exact: true }) });
  }

  addButton(name: string): Locator {
    return this.item(name).getByRole('button', { name: 'Add to cart' });
  }

  removeButton(name: string): Locator {
    return this.item(name).getByRole('button', { name: 'Remove' });
  }

  async addToCart(name: string): Promise<void> {
    await this.addButton(name).click();
  }

  async removeFromCart(name: string): Promise<void> {
    await this.removeButton(name).click();
  }
}
