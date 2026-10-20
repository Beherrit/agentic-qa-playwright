import type { Page } from '@playwright/test';

/**
 * How the performance gate signs in before it audits (qa.config.json, perf.setup). It runs once, in the browser
 * Lighthouse then measures through, so pages behind a login are audited as a signed-in user sees them. Replace the
 * body with your app's sign-in, the way your page objects do it; `page.goto('/')` resolves against app.baseUrl.
 * Leave it empty for an app with no login, or set perf.setup to null.
 */
export default async function signIn(page: Page, persona: string): Promise<void> {
  void page;
  void persona;
}
