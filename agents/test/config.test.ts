import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { budgetLeft, modelFor, providerEnv, providerName } from '../lib/agent.ts';
import { ConfigSchema, findProjectRoot, loadConfig } from '../lib/paths.ts';
import { suiteEnv } from '../lib/suite.ts';

const minimal = {
  app: { name: 'Shop', baseUrl: 'https://shop.example', brief: 'docs/product-brief.md' },
  conventions: 'docs/test-conventions.md',
  writable: ['tests/'],
  minPlanScore: 70,
  stabilityRuns: 2,
};

describe('qa.config.json', () => {
  it('fills in every optional section, so a host config can be five lines', () => {
    const config = ConfigSchema.parse(minimal);
    assert.equal(config.suite.commands.test, 'npx playwright test');
    assert.equal(config.suite.testImport, 'fixtures/test.ts');
    assert.equal(config.personas.envVar, 'QA_PERSONA');
    assert.equal(config.auth.setup, null);
    assert.deepEqual(config.sensitivity, { required: false, targets: [] });
    assert.equal(config.accessibility.enabled, false);
    assert.equal(config.budget.maxUsdPerRun, 0);
    assert.deepEqual(config.jira.fields, {});
  });

  it('fills in the parts of a section that are given in part', () => {
    const config = ConfigSchema.parse({ ...minimal, suite: { commands: { test: 'npm run e2e --' } }, personas: { envVar: 'TEST_USER' } });
    assert.equal(config.suite.commands.test, 'npm run e2e --');
    assert.equal(config.suite.commands.lint, 'npx eslint');
    assert.equal(config.personas.envVar, 'TEST_USER');
    assert.equal(config.personas.default, '');
  });

  it('reads a fault-injection target with its defaults', () => {
    const config = ConfigSchema.parse({ ...minimal, sensitivity: { targets: [{ name: 'no-reset', routes: [{ url: '**/api/reset' }] }] } });
    assert.deepEqual(config.sensitivity.targets[0], { name: 'no-reset', env: {}, routes: [{ url: '**/api/reset', abort: false }] });
  });

  it('refuses a config with a bad address or no writable folder', () => {
    assert.ok(!ConfigSchema.safeParse({ ...minimal, app: { ...minimal.app, baseUrl: 'shop.example' } }).success);
    assert.ok(!ConfigSchema.safeParse({ ...minimal, writable: [] }).success);
  });

  it('names the file and the field when loading fails', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-config-'));
    assert.throws(() => loadConfig(path.join(dir, 'qa.config.json')), /No qa\.config\.json in .*init/);
    fs.writeFileSync(path.join(dir, 'qa.config.json'), '{ not json');
    assert.throws(() => loadConfig(path.join(dir, 'qa.config.json')), /not valid JSON/);
    fs.writeFileSync(path.join(dir, 'qa.config.json'), JSON.stringify({ ...minimal, minPlanScore: 170 }));
    assert.throws(() => loadConfig(path.join(dir, 'qa.config.json')), /minPlanScore/);
  });
});

describe('finding the project', () => {
  it('walks up to the nearest qa.config.json, and takes QA_PROJECT_ROOT first', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-root-'));
    fs.writeFileSync(path.join(root, 'qa.config.json'), '{}');
    const deep = path.join(root, 'tests', 'deep');
    fs.mkdirSync(deep, { recursive: true });
    assert.equal(findProjectRoot(deep, {}), root);
    assert.equal(findProjectRoot(deep, { QA_PROJECT_ROOT: '/elsewhere' }), path.resolve('/elsewhere'));
  });

  it('falls back to the working directory when there is no config above it', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-bare-'));
    assert.equal(findProjectRoot(bare, {}), bare);
  });
});

describe('the suite environment', () => {
  it('hands QA_PERSONA to the suite under its own variable, and keeps the variable when set directly', () => {
    // This repository's config names SAUCE_USER.
    assert.deepEqual(suiteEnv({}, { QA_PERSONA: 'problem_user' }), { SAUCE_USER: 'problem_user' });
    assert.deepEqual(suiteEnv({}, { SAUCE_USER: 'error_user' }), { SAUCE_USER: 'error_user' });
    assert.deepEqual(suiteEnv({ QA_A11Y: '1' }, {}), { QA_A11Y: '1' });
  });

  it('points the suite at the build under test', () => {
    assert.equal(suiteEnv({}, { QA_BASE_URL: 'https://pr-12.preview.example' }).BASE_URL, 'https://pr-12.preview.example');
  });
});

describe('model providers and the budget', () => {
  it('unpacks the provider settings from one secret', () => {
    const env = providerEnv('CLAUDE_CODE_USE_BEDROCK=1\nAWS_REGION="us-east-1"\n# a comment\n\nbad line\nAWS_PROFILE = qa ');
    assert.deepEqual(env, { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-1', AWS_PROFILE: 'qa' });
    assert.deepEqual(providerEnv(undefined), {});
  });

  it('says which provider the environment points at', () => {
    assert.equal(providerName({ QA_PROVIDER_ENV: 'CLAUDE_CODE_USE_BEDROCK=1' }), 'Amazon Bedrock');
    assert.equal(providerName({ CLAUDE_CODE_USE_VERTEX: 'true' }), 'Google Vertex AI');
    assert.equal(providerName({ ANTHROPIC_API_KEY: 'k' }), 'Anthropic API key');
    assert.equal(providerName({ CLAUDE_CODE_OAUTH_TOKEN: 't' }), 'Claude subscription token');
  });

  it('picks the model per role, then the wildcard, then the repository variable, then sonnet', () => {
    assert.equal(modelFor('plan-critic', {}, {}), 'sonnet');
    assert.equal(modelFor('plan-critic', {}, { QA_AGENT_MODEL: 'opus' }), 'opus');
    assert.equal(modelFor('plan-critic', { '*': 'haiku' }, { QA_AGENT_MODEL: 'opus' }), 'haiku');
    assert.equal(modelFor('automation-engineer', { '*': 'haiku', 'automation-engineer': 'sonnet' }, {}), 'sonnet');
    assert.equal(modelFor('plan-critic', { 'automation-engineer': 'sonnet' }, {}), 'sonnet');
    assert.equal(providerName({}), 'the signed-in Claude Code CLI');
  });

  it('stops a run that has spent its budget, and passes the rest on otherwise', () => {
    assert.equal(budgetLeft(0, 99), null);
    assert.equal(budgetLeft(5, 1.5), 3.5);
    assert.throws(() => budgetLeft(5, 5), /budget of \$5\.00 is spent/);
  });
});
