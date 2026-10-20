import type { Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage.ts';
import { defaultUser, PASSWORD } from './personas.ts';

/**
 * How the performance gate signs in before it audits (qa.config.json, perf.setup). It runs once, in the browser
 * Lighthouse then measures through, so the pages behind the login are audited as a signed-in shopper sees them.
 * The persona is the one the run was given (QA_PERSONA), or the suite's default.
 */
export default async function signIn(page: Page, persona: string): Promise<void> {
  const login = new LoginPage(page);
  await login.goto();
  await login.signIn(persona || defaultUser, PASSWORD);
  await page.waitForURL(/inventory/, { timeout: 15_000 });
}
