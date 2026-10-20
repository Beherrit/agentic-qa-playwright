import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from './schemas.ts';

/**
 * From the settings migrator's answer to files: playwright.config.ts, .env.example, a bare fixtures/test.ts, and
 * the app's address and personas in qa.config.json. A value the agent could not point at in the old project is
 * replaced by the Playwright default and reported, so nothing in the new config is a guess.
 */

const DEFAULTS = { timeoutMs: 30_000, expectTimeoutMs: 7_000, retries: 0, workers: null, viewport: null, testIdAttribute: null, headless: true, browsers: ['chromium'] as Settings['browsers'] };
const EVIDENCED = ['baseUrl', 'timeoutMs', 'expectTimeoutMs', 'retries', 'workers', 'viewport', 'testIdAttribute', 'headless', 'browsers'] as const;

/** Keeps only the values the evidence covers. The rest fall back to the defaults and are listed. */
export function evidenced(settings: Settings): { settings: Settings; dropped: string[] } {
  const cited = new Set(settings.evidence.map((e) => e.setting.trim()));
  const dropped: string[] = [];
  const out: Settings = { ...settings };
  for (const key of EVIDENCED) {
    if (cited.has(key)) continue;
    if (key === 'baseUrl') {
      if (out.baseUrl) dropped.push(`${key} (${out.baseUrl})`);
      out.baseUrl = '';
    } else {
      const fallback = DEFAULTS[key];
      if (JSON.stringify(out[key]) !== JSON.stringify(fallback)) dropped.push(`${key} (${JSON.stringify(out[key])})`);
      (out as Record<string, unknown>)[key] = fallback;
    }
  }
  return { settings: out, dropped };
}

const DEVICES: Record<Settings['browsers'][number], string> = { chromium: 'Desktop Chrome', firefox: 'Desktop Firefox', webkit: 'Desktop Safari' };

export function renderConfig(s: Settings): string {
  const [first, ...rest] = s.browsers;
  const projects = [
    `{ name: '${first}', use: { ...devices['${DEVICES[first]}'] } }`,
    ...rest.map((b) => `{ name: '${b}', use: { ...devices['${DEVICES[b]}'] }, default: false }`),
  ];
  const use = [
    `baseURL: process.env.BASE_URL || qa.app.baseUrl`,
    s.testIdAttribute ? `testIdAttribute: ${JSON.stringify(s.testIdAttribute)}` : null,
    s.viewport ? `viewport: { width: ${s.viewport.width}, height: ${s.viewport.height} }` : null,
    s.headless ? null : `headless: false`,
    `actionTimeout: ${s.expectTimeoutMs}`,
    `trace: 'retain-on-failure'`,
    `screenshot: 'only-on-failure'`,
  ].filter(Boolean);
  return `import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices, type Project } from '@playwright/test';

/**
 * Written by the Selenium migration from the old suite's settings (see qa-run/migration/settings.md for where each
 * value came from). Edit freely after that. The app's address is read from qa.config.json, as the pipeline reads it.
 */

const isCI = !!process.env.CI;
const here = typeof __dirname === 'string' ? __dirname : process.cwd();
const qa = JSON.parse(readFileSync(path.join(here, 'qa.config.json'), 'utf8')) as { app: { baseUrl: string } };

export default defineConfig({
  testDir: './tests',
  // Every test runs by itself, in any order, next to any other. The migration gates run them shuffled with four workers.
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? ${s.retries} : 0,
  workers: ${s.workers === null ? 'isCI ? 4 : undefined' : String(s.workers)},
  timeout: ${s.timeoutMs},
  expect: { timeout: ${s.expectTimeoutMs} },
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    ${use.join(',\n    ')},
  },
  projects: [
    ${projects.join(',\n    ')},
  ] as Project[],
});
`;
}

export function renderEnvExample(s: Settings): string {
  const lines = ['# Every variable the suite reads. Copy to .env and fill in; nothing here is a secret.', 'BASE_URL='];
  for (const v of s.envVars) if (v.name !== 'BASE_URL') lines.push(`# ${v.purpose}${v.example ? ` (e.g. ${v.example})` : ''}`, `${v.name}=`);
  return `${lines.join('\n')}\n`;
}

/** The `test` every spec imports, with no page fixtures yet: the utils wave adds them. */
export const BARE_FIXTURE = `import { test as base, expect } from '@playwright/test';
import { applyFault, attachProbe, faultFromEnv } from './fault.ts';

/**
 * The \`test\` and \`expect\` every spec imports. Each page object gets a fixture here as the migration adds it, and
 * each starting state (such as \`signedIn\`) gets one too, so a spec receives what it needs as an argument.
 */

type Fixtures = Record<string, never>;

export const test = base.extend<Fixtures>({
  // The pipeline's sensitivity gate can hand every test a broken version of the app (QA_FAULT). Nothing happens otherwise.
  page: async ({ page }, use, testInfo) => {
    const fault = faultFromEnv();
    if (fault) await applyFault(page, fault);
    await use(page);
    await attachProbe(page, testInfo, fault);
  },
});

export { expect };
`;

/** Writes the settings into the target project. The scaffold's sample page and spec go, so nothing is left over. */
export function applySettings(target: string, s: Settings): string[] {
  const written: string[] = [];
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
    fs.writeFileSync(path.join(target, file), content);
    written.push(file);
  };
  write('playwright.config.ts', renderConfig(s));
  write('.env.example', renderEnvExample(s));
  write('fixtures/test.ts', BARE_FIXTURE);
  for (const leftover of ['tests/smoke.spec.ts', 'pages/HomePage.ts']) fs.rmSync(path.join(target, leftover), { force: true });
  const file = path.join(target, 'qa.config.json');
  const qa = JSON.parse(fs.readFileSync(file, 'utf8')) as { app: { name: string; baseUrl: string }; personas: Settings['personas'] };
  if (s.baseUrl) qa.app.baseUrl = s.baseUrl;
  if (s.appName) qa.app.name = s.appName;
  if (s.personas.envVar) qa.personas = s.personas;
  fs.writeFileSync(file, `${JSON.stringify(qa, null, 2)}\n`);
  written.push('qa.config.json');
  return written;
}

/** Whether Playwright accepts the new config: it lists the tests without running them. */
export function configLoads(target: string, testCommand: string): { ok: boolean; output: string } {
  const run = spawnSync(`${testCommand} --list`, { cwd: target, shell: true, encoding: 'utf8', env: { ...process.env, CI: '' } });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
  // With no spec yet Playwright exits 1 saying no tests were found; the config still loaded.
  const ok = run.status === 0 || /No tests found/i.test(output);
  return { ok, output: output.split('\n').slice(-15).join('\n') };
}

export function settingsMd(s: Settings, dropped: string[], written: string[]): string {
  const rows = s.evidence.map((e) => `| ${e.setting} | ${e.value.replace(/\|/g, '\\|')} | ${e.file}: ${e.where.replace(/\|/g, '\\|')} |`);
  return [
    '## Settings',
    '',
    `**${s.evidence.length} value(s) carried over with evidence; ${dropped.length} without evidence fell back to defaults.**`,
    '',
    `Written: ${written.join(', ')}.`,
    '',
    '| Setting | Value | From |',
    '|---|---|---|',
    ...rows,
    ...(dropped.length ? ['', `Dropped for lack of evidence: ${dropped.join(', ')}.`] : []),
    ...(s.unmapped.length ? ['', '### No Playwright equivalent', '', ...s.unmapped.map((u) => `- ${u.setting} (${u.file}): ${u.note}`)] : []),
    '',
    `Sign-in: ${s.auth.how}${s.auth.sharedSession ? ' The old suite shared one session; the new suite signs in per test through a fixture unless auth.setup is configured.' : ''}`,
    ...(s.grid.hubUrl || s.grid.maxInstances
      ? ['', `Grid: ${s.grid.hubUrl ?? 'no hub URL'}${s.grid.maxInstances ? `, ${s.grid.maxInstances} instances` : ''}. Playwright runs ${s.workers ?? 'its default number of'} workers on the machine instead; the hub has no equivalent. ${s.grid.note}`.trim()]
      : []),
  ].join('\n');
}
