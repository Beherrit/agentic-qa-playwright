import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage.ts';

export class InventoryPage extends BasePage {
  readonly items: Locator;
  readonly itemNames: Locator;
  readonly itemPrices: Locator;
  readonly sortSelect: Locator;
  readonly addButtons: Locator;
  readonly removeButtons: Locator;

  constructor(page: Page) {
    super(page);
    this.addButtons = page.getByRole('button', { name: 'Add to cart' });
    this.removeButtons = page.getByRole('button', { name: 'Remove' });
    this.items = page.getByTestId('inventory-item');
    this.itemNames = page.getByTestId('inventory-item-name');
    this.itemPrices = page.getByTestId('inventory-item-price');
    this.sortSelect = page.getByRole('combobox', { name: 'Sort products' });
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

  async sortBy(label: string): Promise<void> {
    await this.sortSelect.selectOption({ label });
  }

  /** The visible name, price, description and image alt text of every card, in display order. */
  async readCards(): Promise<{ name: string; price: string; description: string; alt: string }[]> {
    const count = await this.items.count();
    const cards = [];
    for (let i = 0; i < count; i++) {
      const card = this.items.nth(i);
      cards.push({
        name: (await card.getByTestId('inventory-item-name').textContent()) ?? '',
        price: (await card.getByTestId('inventory-item-price').textContent()) ?? '',
        description: (await card.getByTestId('inventory-item-desc').textContent()) ?? '',
        alt: (await card.getByRole('img').getAttribute('alt')) ?? '',
      });
    }
    return cards;
  }

  async openProduct(name: string): Promise<void> {
    await this.itemNames.getByText(name, { exact: true }).click();
  }

  async openProductByImage(name: string): Promise<void> {
    await this.item(name).getByRole('img').click();
  }

  async imageSrc(name: string): Promise<string> {
    return (await this.item(name).getByRole('img').getAttribute('src')) ?? '';
  }

  async description(name: string): Promise<string> {
    return (await this.item(name).getByTestId('inventory-item-desc').textContent()) ?? '';
  }

  async price(name: string): Promise<string> {
    return (await this.item(name).getByTestId('inventory-item-price').textContent()) ?? '';
  }
}
