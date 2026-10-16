import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage.ts';

/** The first page a visitor sees. Replace the locators with what the app renders; keep the shape. */
export class HomePage extends BasePage {
  protected readonly path = '/';
  readonly heading: Locator;
  readonly mainNavigation: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { level: 1 });
    this.mainNavigation = page.getByRole('navigation');
  }
}
