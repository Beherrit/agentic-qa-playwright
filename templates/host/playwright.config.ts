import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices, type Project } from '@playwright/test';

/**
 * Written by `npx agentic-qa init` for a project that had no Playwright config. Kept as it is after that: edit freely.
 * The pipeline reads the app's address from qa.config.json, so this file reads it from the same place.
 */

const isCI = !!process.env.CI;

// qa.config.json sits next to this file. It is read rather than imported so the same config works in a CommonJS
// project (where TypeScript forbids import attributes) and in an ES module one (where Node requires them).
const here = typeof __dirname === 'string' ? __dirname : process.cwd();
const qa = JSON.parse(readFileSync(path.join(here, 'qa.config.json'), 'utf8')) as { app: { baseUrl: string } };

// `default: false` is Playwright 1.64. Older versions ignore the key at run time; the cast keeps their typecheck quiet.
const OTHER_BROWSERS = [
  { name: 'firefox', use: { ...devices['Desktop Firefox'] }, default: false },
  { name: 'webkit', use: { ...devices['Desktop Safari'] }, default: false },
] as Project[];

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  // One retry in CI, so a flaky test is reported as flaky instead of quietly passing or failing the build.
  retries: isCI ? 1 : 0,
  workers: isCI ? 4 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  // Playwright writes its own output folders (playwright-report/, test-results/). Nothing else needs a folder.
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: process.env.BASE_URL || qa.app.baseUrl,
    // The attribute getByTestId() reads. Change it to what the app renders (data-testid is Playwright's default).
    testIdAttribute: 'data-testid',
    // A click or fill on something that is not there fails after this long, with an error that names the locator,
    // instead of waiting until the whole test times out.
    actionTimeout: 7_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Chromium is what a plain `npx playwright test` runs, and what the pipeline's gates run on every iteration.
  // Firefox and WebKit stay configured but off by default: `--project=firefox` runs one, `--project="*"` runs all.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, ...OTHER_BROWSERS],
});
