import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coverageMap, coverageMd } from './lib/coverage.ts';
import { exportAs, exportedTests } from './lib/export.ts';
import { ROOT, RUN_DIR } from './lib/paths.ts';
import { jobSummary } from './lib/store.ts';
import { testCommand } from './lib/suite.ts';

/**
 * Prints the traceability map: every requirement the suite has tests for, the criteria those tests claim,
 * and how they did in the last run.
 *
 * Usage: npm run coverage     (uses test-results/results.json if there is one, otherwise just lists the tests)
 */

function listing(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-list-')), 'list.json');
  spawnSync(testCommand('--list --reporter=json'), {
    cwd: ROOT,
    shell: true,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: file },
  });
  return file;
}

/** The traceability map as markdown, from the last run's results or, without one, from a listing of the tests. */
export function coverageReport(): string {
  const results = path.join(ROOT, 'test-results', 'results.json');
  const source = fs.existsSync(results) ? results : listing();
  if (!fs.existsSync(source)) throw new Error('Could not list the tests.');
  return coverageMd(coverageMap(JSON.parse(fs.readFileSync(source, 'utf8'))));
}

/** Writes the last run's results in a test management tool's shape to the run folder, and returns the file. */
export function exportResults(format: string): string {
  const results = path.join(ROOT, 'test-results', 'results.json');
  const source = fs.existsSync(results) ? results : listing();
  if (!fs.existsSync(source)) throw new Error('Could not list the tests.');
  const file = exportAs(format, exportedTests(JSON.parse(fs.readFileSync(source, 'utf8'))));
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUN_DIR, file.name), file.text);
  return path.relative(ROOT, path.join(RUN_DIR, file.name));
}

// Only when run as a script, so the MCP server can import coverageReport.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('agents/coverage.ts')) {
  try {
    const markdown = coverageReport();
    jobSummary(markdown);
    console.log(markdown);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
