import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Survey } from '../lib/schemas.ts';
import { checkSurvey, mergedConfig, surveyMd, tree } from '../survey.ts';

const answer: Survey = {
  app: { name: 'Shop', baseUrl: 'https://shop.example' },
  layout: { specGlob: 'e2e/**/*.spec.ts', testImport: 'e2e/fixtures.ts', writable: ['e2e/', 'ghost/'] },
  commands: { test: 'npx playwright test', typecheck: 'npx tsc -p e2e', lint: 'npm run lint --' },
  personas: { envVar: 'TEST_USER', default: 'alice', list: ['alice', 'bob'] },
  auth: { setup: 'npx playwright test --project=setup', storageState: 'e2e/.auth/user.json', how: 'A setup project signs in.' },
  brief: '# Product brief: Shop\n\nA shop.',
  conventions: '# Test conventions\n\nRules.',
  gaps: ['The staging address was not in the config.'],
};

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-survey-'));
  fs.mkdirSync(path.join(root, 'e2e'), { recursive: true });
  fs.writeFileSync(path.join(root, 'e2e', 'cart.spec.ts'), '');
  fs.writeFileSync(path.join(root, 'e2e', 'fixtures.ts'), '');
  fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
  return root;
}

describe('the suite survey', () => {
  it('keeps what exists and lists what does not', () => {
    const { survey, problems } = checkSurvey(answer, project());
    assert.equal(survey.layout.specGlob, 'e2e/**/*.spec.ts');
    assert.equal(survey.layout.testImport, 'e2e/fixtures.ts');
    assert.deepEqual(survey.layout.writable, ['e2e/']);
    assert.deepEqual(problems, ['writable folder "ghost/" does not exist; left out.', 'The staging address was not in the config.']);
  });

  it('falls back to the current settings for a glob, an import or a command it cannot use', () => {
    const bad: Survey = {
      ...answer,
      app: { name: 'Shop', baseUrl: 'shop.example' },
      layout: { specGlob: 'nowhere/**/*.ts', testImport: 'missing.ts', writable: ['e2e'] },
      commands: { ...answer.commands, test: 'npm test' },
      auth: { setup: 'npm run auth', storageState: null, how: '' },
    };
    const { survey, problems } = checkSurvey(bad, project());
    assert.equal(survey.layout.specGlob, 'tests/**/*.spec.ts');
    assert.equal(survey.layout.testImport, 'fixtures/test.ts');
    assert.deepEqual(survey.layout.writable, ['e2e/'], 'a folder without its slash is accepted with one');
    assert.equal(survey.commands.test, 'npx playwright test');
    assert.equal(survey.auth.setup, null);
    assert.equal(survey.app.baseUrl, '');
    assert.ok(problems.some((p) => /matches no file/.test(p)));
    assert.ok(problems.some((p) => /is not Playwright/.test(p)));
    assert.ok(problems.some((p) => /fill in app\.baseUrl/.test(p)));
  });

  it('merges only the suite settings into the config, and keeps the rest', () => {
    const current = { app: { name: 'Old', baseUrl: 'https://old.example', brief: 'docs/b.md' }, minPlanScore: 80, writable: ['tests/'] };
    const merged = mergedConfig(current, answer) as { app: { name: string; baseUrl: string; brief: string }; minPlanScore: number; writable: string[]; personas: unknown };
    assert.deepEqual(merged.app, { name: 'Shop', baseUrl: 'https://shop.example', brief: 'docs/b.md' });
    assert.equal(merged.minPlanScore, 80);
    assert.deepEqual(merged.writable, ['e2e/', 'ghost/']);
    assert.deepEqual(merged.personas, answer.personas);
  });

  it('opens the report with what is left to settle', () => {
    const md = surveyMd(checkSurvey(answer, project()));
    assert.match(md, /^# Survey of the suite\n\n\*\*2 thing\(s\) for a person to settle\.\*\* Shop at https:\/\/shop\.example/);
    assert.match(md, /## Product brief \(draft\)\n\n# Product brief: Shop/);
  });

  it('lists the project two levels deep without node_modules', () => {
    const files = tree(project());
    assert.deepEqual(files, ['e2e/', 'e2e/cart.spec.ts', 'e2e/fixtures.ts']);
  });
});
