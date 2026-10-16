import type { Locator, Page } from '@playwright/test';

/**
 * What every page object shares. A page object owns its locators (readonly fields, set in the constructor) and
 * offers actions a user would recognise. It holds no assertions: the test decides what should be true.
 * There is no separate locators folder; a locator lives with the page that uses it.
 */
export abstract class BasePage {
  protected readonly page: Page;
  /** The path this page answers at, relative to baseURL. */
  protected abstract readonly path: string;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto(this.path);
  }

  /** A locator inside a named region of this page, for the few cases where role and name are not enough on their own. */
  protected region(name: string): Locator {
    return this.page.getByRole('region', { name });
  }
}
