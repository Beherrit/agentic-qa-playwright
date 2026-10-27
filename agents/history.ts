import fs from 'node:fs';
import path from 'node:path';
import { buildEntry, cleanEntry, historyHtml, historyMd, mergeEntries, newestFirst, parseRunLog, rollup, type RunEntry, type RunFiles } from './lib/history.ts';
import { companionFile, readJson, readTestRows, writeUnder } from './lib/history/files.ts';
import type { TestEntry } from './lib/history/types.ts';
import { projectHtml } from './lib/history/project-page.ts';
import { summaryHtml } from './lib/history/summary-page.ts';
import { mergeTestLog, serialiseTestLog, slug, testEntries } from './lib/history/tests.ts';
import { config } from './lib/paths.ts';

/**
 * The run history, kept by .github/workflows/qa-history.yml:
 *   npx tsx agents/history.ts record <qa-run dir> <out file>   one finished run, read from its artifact
 *   npx tsx agents/history.ts render <history dir> [entry]     runs.jsonl, tests.jsonl and the pages
 * The site root is the executive summary, pipeline/ the run history of the agents, projects/<slug>/ one page per
 * project. Only this script reads the artifact, and it only parses JSON. Nothing in it is executed.
 */

const FILES = ['request.json', 'requirements.json', 'strategy.json', 'generation.json', 'gates.json', 'review.json', 'round.json', 'ledger.json', 'triage.json'];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REPORT_BYTES = 20 * 1024 * 1024;
const WORKFLOWS: Record<string, 'analysis' | 'tests' | 'regression'> = { 'QA analysis': 'analysis', 'QA tests': 'tests', Regression: 'regression' };

export function record(dir: string, out: string): void {
  const files: RunFiles = {};
  for (const name of FILES) {
    const value = readJson(path.join(dir, name), MAX_BYTES);
    if (value !== undefined) files[name] = value;
  }
  // A regression run leaves no request; a green one leaves no artifact at all, and still counts (nothing was flaky).
  const workflow = WORKFLOWS[process.env.WORKFLOW_NAME ?? ''];
  if (!files['request.json'] && workflow !== 'regression') {
    console.log('No request.json in the artifact: the run was a skipped trigger. Nothing recorded.');
    return;
  }
  const entry = buildEntry(
    {
      runId: process.env.RUN_ID,
      runUrl: process.env.RUN_URL,
      workflow,
      conclusion: process.env.CONCLUSION,
      finishedAt: process.env.FINISHED_AT,
    },
    files,
  );
  if (!entry.runId) throw new Error('RUN_ID is missing or has no usable characters.');
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(entry, null, 2)}\n`);
  console.log(`Recorded run ${entry.runId} (${entry.workflow}, ${entry.key ?? 'no key'}).`);
  if (workflow === 'regression') recordTests(dir, out, entry, files['triage.json']);
}

/** The suite's own JSON report as test rows, written next to the entry for render to merge. */
function recordTests(dir: string, out: string, entry: RunEntry, triage: unknown): void {
  const report = readJson(path.join(dir, 'test-results', 'results.json'), MAX_REPORT_BYTES);
  if (report === undefined) {
    console.log('No test-results/results.json in the artifact: no test rows recorded.');
    return;
  }
  const rows = testEntries({ runId: entry.runId, finishedAt: entry.finishedAt, project: slug(config.app.name) }, report, triage);
  fs.writeFileSync(companionFile(out), serialiseTestLog(rows));
  console.log(`Recorded ${rows.length} test rows.`);
}

const readLog = (file: string): RunEntry[] => (fs.existsSync(file) ? parseRunLog(fs.readFileSync(file, 'utf8')) : []);

/** The display name of a project slug: the app's own name for this repository's app, the slug otherwise. */
const projectName = (project: string): string => (project === slug(config.app.name) ? config.app.name : project);

/** Writes the three kinds of page: the summary at the root, the pipeline history, one page per project. */
function writePages(dir: string, entries: RunEntry[], rows: TestEntry[]): void {
  const cap = config.budget.maxUsdPerDay;
  const named = [...new Set(rows.map((r) => r.project))].sort().map((s) => ({ slug: s, name: projectName(s) }));
  writeUnder(dir, 'README.md', historyMd(entries, undefined, cap));
  writeUnder(dir, 'pipeline/index.html', historyHtml(entries, cap));
  writeUnder(dir, 'index.html', summaryHtml({ rows, runs: entries, projects: named, manualMinutesPerTest: config.history.manualMinutesPerTest }));
  for (const p of named) writeUnder(dir, `projects/${p.slug}/index.html`, projectHtml({ slug: p.slug, name: p.name, rows: rows.filter((r) => r.project === p.slug) }));
}

export function render(dir: string, entryFile?: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, 'runs.jsonl');
  const testLog = path.join(dir, 'tests.jsonl');
  let entries = newestFirst(readLog(log));
  let rows = readTestRows(testLog);
  if (entryFile) {
    const entry = cleanEntry(readJson(entryFile, MAX_BYTES));
    if (!entry) throw new Error(`${entryFile} does not hold a usable run entry.`);
    entries = mergeEntries(entries, entry);
    rows = mergeTestLog(rows, readTestRows(companionFile(entryFile)));
  }
  fs.writeFileSync(log, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
  fs.writeFileSync(testLog, serialiseTestLog(rows));
  const cap = config.budget.maxUsdPerDay;
  writePages(dir, entries, rows);
  console.log(`History has ${entries.length} runs and ${rows.length} test rows.`);
  const today = rollup(entries, 1).todayUsd;
  // The workflow log shows it as a warning; the cap itself stops nothing, since the history is written after the run.
  if (cap && today > cap) console.log(`::warning title=Daily agent budget::Today's runs have cost $${today.toFixed(2)}, over the $${cap.toFixed(2)} cap in qa.config.json (budget.maxUsdPerDay).`);
}

// Only when run as a script; the CLI imports record and render.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('agents/history.ts')) {
  const [command, first, second] = process.argv.slice(2);
  if (command === 'record' && first && second) record(first, second);
  else if (command === 'render' && first) render(first, second);
  else {
    console.error('Usage: history.ts record <qa-run dir> <out file> | render <history dir> [entry file]');
    process.exit(2);
  }
}
