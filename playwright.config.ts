import { defineConfig, devices } from '@playwright/test';
import qa from './qa.config.json' with { type: 'json' };

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  // One retry in CI, so a flaky test is reported as flaky instead of quietly passing or failing the build.
  retries: isCI ? 1 : 0,
  workers: isCI ? 4 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || qa.app.baseUrl,
    testIdAttribute: 'data-test',
    // A click or fill on something that is not there fails after this long, with an error that names the locator.
    // Without it the action waits until the whole test times out, and Playwright does not count a timeout as the
    // failure that test.fail() expects, so a test written ahead of its feature would be reported as broken.
    actionTimeout: 7_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Chromium is what a plain `npx playwright test` runs, and what the pipeline's gates run on every iteration.
  // Firefox and WebKit stay configured but off by default (Playwright 1.64): `--project=firefox` runs one,
  // `--project="*"` runs them all, as the nightly regression does once the browsers are installed.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, default: false },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, default: false },
  ],
});
