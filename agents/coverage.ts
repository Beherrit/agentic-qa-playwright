import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coverageMap, coverageMd } from './lib/coverage.ts';
import { ROOT } from './lib/paths.ts';
import { jobSummary } from './lib/store.ts';

/**
 * Prints the traceability map: every requirement the suite has tests for, the criteria those tests claim,
 * and how they did in the last run.
 *
 * Usage: npm run coverage     (uses test-results/results.json if there is one, otherwise just lists the tests)
 */

function listing(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-list-')), 'list.json');
  spawnSync('npx playwright test --list --reporter=json', {
    cwd: ROOT,
    shell: true,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: file },
  });
  return file;
}

const results = path.join(ROOT, 'test-results', 'results.json');
const source = fs.existsSync(results) ? results : listing();
if (!fs.existsSync(source)) {
  console.error('Could not list the tests.');
  process.exit(1);
}

const markdown = coverageMd(coverageMap(JSON.parse(fs.readFileSync(source, 'utf8'))));
jobSummary(markdown);
console.log(markdown);
