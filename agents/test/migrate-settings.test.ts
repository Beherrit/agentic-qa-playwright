import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { migrationMd, waveMd } from '../lib/migrate/report.ts';
import { Settings } from '../lib/migrate/schemas.ts';
import { evidenced, renderConfig, renderEnvExample, settingsMd } from '../lib/migrate/settings.ts';
import type { MigrationPlan, Wave } from '../lib/migrate/types.ts';
import type { WaveOutcome } from '../lib/migrate/waves.ts';

const full: Settings = {
  appName: 'Shop',
  baseUrl: 'https://shop.example',
  browsers: ['chromium', 'firefox'],
  headless: true,
  timeoutMs: 60_000,
  expectTimeoutMs: 7_000,
  retries: 1,
  workers: null,
  viewport: { width: 1366, height: 900 },
  testIdAttribute: 'data-test',
  envVars: [{ name: 'SAUCE_USER', purpose: 'which account signs in', example: 'standard_user' }],
  personas: { envVar: 'SAUCE_USER', default: 'standard_user', list: ['standard_user', 'locked_out_user'] },
  auth: { how: 'Each test signs in through the form.', sharedSession: false },
  grid: { hubUrl: 'http://selenium-hub:4444/wd/hub', maxInstances: 4, note: 'The hub has no equivalent.' },
  evidence: [
    { setting: 'baseUrl', file: 'config.yaml', where: 'base_url', value: 'https://shop.example' },
    { setting: 'timeoutMs', file: 'pytest.ini', where: 'timeout', value: '60' },
    { setting: 'expectTimeoutMs', file: 'config.yaml', where: 'timeouts.explicit', value: '7' },
    { setting: 'retries', file: 'pytest.ini', where: 'addopts --reruns 1', value: '1' },
    { setting: 'viewport', file: 'config.yaml', where: 'window', value: '1366x900' },
    { setting: 'testIdAttribute', file: 'config.yaml', where: 'test_id_attribute', value: 'data-test' },
    { setting: 'headless', file: 'config.yaml', where: 'headless', value: 'true' },
    { setting: 'browsers', file: 'config.yaml', where: 'browser', value: 'chrome' },
  ],
  unmapped: [{ setting: 'timeouts.implicit', file: 'config.yaml', note: 'Playwright has no implicit wait' }],
};

describe('settings', () => {
  it('keeps only what the evidence covers and names what fell back', () => {
    assert.deepEqual(evidenced(full).dropped, []);
    const thin = { ...full, evidence: full.evidence.filter((e) => e.setting === 'baseUrl') };
    const { settings, dropped } = evidenced(thin);
    assert.equal(settings.baseUrl, 'https://shop.example');
    assert.equal(settings.timeoutMs, 30_000);
    assert.equal(settings.retries, 0);
    assert.deepEqual(settings.browsers, ['chromium']);
    assert.equal(settings.viewport, null);
    assert.ok(dropped.some((d) => d.startsWith('timeoutMs (60000)')));
    assert.ok(dropped.some((d) => d.startsWith('browsers')));
    const noUrl = evidenced({ ...full, evidence: [] });
    assert.equal(noUrl.settings.baseUrl, '');
    assert.ok(noUrl.dropped.some((d) => d.startsWith('baseUrl (https://shop.example)')));
  });
  it('renders a parallel-safe config with the first browser on and the rest off', () => {
    const text = renderConfig(full);
    assert.match(text, /fullyParallel: true/);
    assert.match(text, /timeout: 60000/);
    assert.match(text, /expect: \{ timeout: 7000 \}/);
    assert.match(text, /retries: isCI \? 1 : 0/);
    assert.match(text, /testIdAttribute: "data-test"/);
    assert.match(text, /viewport: \{ width: 1366, height: 900 \}/);
    assert.match(text, /\{ name: 'chromium', use: \{ ...devices\['Desktop Chrome'\] \} \},\n\s+\{ name: 'firefox', use: \{ ...devices\['Desktop Firefox'\] \}, default: false \}/);
    assert.doesNotMatch(text, /headless/);
    assert.match(renderConfig({ ...full, workers: 2, headless: false }), /workers: 2,[\s\S]*headless: false/);
  });
  it('lists every variable in .env.example once', () => {
    const text = renderEnvExample({ ...full, envVars: [...full.envVars, { name: 'BASE_URL', purpose: 'the app', example: '' }] });
    assert.equal(text.match(/^BASE_URL=/gm)?.length, 1);
    assert.match(text, /# which account signs in \(e\.g\. standard_user\)\nSAUCE_USER=/);
  });
  it('reports the evidence as a table and the unmapped settings as a list', () => {
    const text = settingsMd(full, ['workers (4)'], ['playwright.config.ts']);
    assert.match(text, /\*\*8 value\(s\) carried over with evidence; 1 without evidence fell back to defaults\.\*\*/);
    assert.match(text, /\| baseUrl \| https:\/\/shop\.example \| config\.yaml: base_url \|/);
    assert.match(text, /- timeouts\.implicit \(config\.yaml\): Playwright has no implicit wait/);
    assert.match(text, /Dropped for lack of evidence: workers \(4\)\./);
  });
  it('refuses evidence that is not named after a field', () => {
    assert.throws(() => Settings.parse({ ...full, evidence: [{ setting: 'base_url', file: 'x', where: 'y', value: 'z' }] }));
  });
});

describe('the migration report', () => {
  const waves: Wave[] = [
    { id: 'settings', kind: 'settings', name: 'settings', sources: ['config.yaml'], tests: 0, assertions: 0 },
    { id: 'login', kind: 'login', name: 'login', sources: ['tests/test_login.py'], tests: 3, assertions: 5 },
  ];
  const plan: MigrationPlan = { language: 'python', framework: 'pytest', waves };
  const outcome: WaveOutcome = {
    wave: waves[1],
    passed: false,
    attempts: 2,
    summary: 'parity failed: 1 problem(s)',
    markdown: '',
    conversion: {
      summary: 'Login moved.',
      files: [{ path: 'tests/login.spec.ts', from: ['tests/test_login.py'], kind: 'spec' }],
      tests: [{ source: { file: 'tests/test_login.py', name: 'test_locked_out' }, target: { file: 'tests/login.spec.ts', title: 'a locked out user | sees an error' }, assertions: [{ source: 'assert "locked out" in login.error_text()', target: 'await expect(loginPage.error).toContainText(\'locked out\');' }] }],
      dropped: [{ source: { file: 'tests/test_login.py', name: 'test_wrong_password' }, reason: 'duplicate of the locked-out case' }],
      gaps: ['The old test never checked the URL.'],
    },
    parity: { passed: false, problems: ['tests/test_login.py: test "test_standard" is neither converted nor dropped'], covered: 2, total: 3, mapped: 1 },
  };
  it('puts the verdict first and the mapping in a table with pipes escaped', () => {
    const section = waveMd(outcome);
    assert.match(section, /^### login \(login\): FAILED, after a fix round/);
    assert.match(section, /a locked out user \\\| sees an error/);
    assert.match(section, /Dropped:\n- test_wrong_password/);
    assert.match(section, /\*\*Parity: 1 problem\(s\)\*\* \(2 of 3 old tests mapped, 1 assertions\)/);
    const whole = migrationMd(plan, [{ id: 'settings', status: 'passed', attempts: 1, summary: 'ok' }, { id: 'login', status: 'failed', attempts: 2, summary: outcome.summary }], [section], '/old');
    assert.match(whole, /\*\*Stopped at the "login" wave: parity failed: 1 problem\(s\)\.\*\* Every suite waits on it\./);
    assert.match(whole, /\| login \| login \| 1 \| 3 \| - \| failed \(fix round\) \|/);
    assert.match(whole, /\| Passed first time \| 1 \| 50% of the waves run \|/);
    assert.match(whole, /### Needs a person\n\n[\s\S]*\| login \| parity failed: 1 problem\(s\) \|/);
    assert.match(migrationMd(plan, [{ id: 'settings', status: 'passed', attempts: 1, summary: '' }, { id: 'login', status: 'passed', attempts: 1, summary: '' }], [], '/old'), /Every wave passed/);
    const suitePlan: MigrationPlan = { ...plan, waves: [waves[0], { ...waves[1], id: 'suite-a', kind: 'suite', risks: ['ordered'] }, { ...waves[1], id: 'suite-b', kind: 'suite' }] };
    const partial = migrationMd(suitePlan, [{ id: 'settings', status: 'passed', attempts: 1, summary: '' }, { id: 'suite-a', status: 'failed', attempts: 2, summary: 'the gates failed', problem: 'Runs in parallel: the new specs fail' }, { id: 'suite-b', status: 'pending', attempts: 0, summary: '' }], [], '/old');
    assert.match(partial, /\*\*1 of 3 waves passed; 1 failed and need a person; 1 still to run\.\*\*/);
    assert.match(partial, /\| suite-a \| suite \| 1 \| 3 \| ordered \| failed \(fix round\) \|/);
    assert.match(partial, /\| suite-a \| Runs in parallel: the new specs fail \|/);
    assert.match(settingsMd(full, [], []), /Grid: http:\/\/selenium-hub:4444\/wd\/hub, 4 instances\. Playwright runs its default number of workers/);
  });
});
