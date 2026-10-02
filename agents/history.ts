import fs from 'node:fs';
import path from 'node:path';
import { buildEntry, cleanEntry, historyHtml, historyMd, mergeEntries, newestFirst, parseRunLog, type RunEntry, type RunFiles } from './lib/history.ts';

/**
 * The run history, kept by .github/workflows/qa-history.yml:
 *   npx tsx agents/history.ts record <qa-run dir> <out file>   one finished run, read from its artifact
 *   npx tsx agents/history.ts render <history dir> [entry]     runs.jsonl, README.md and index.html
 * Only this script reads the artifact, and it only parses JSON. Nothing in it is executed.
 */

const FILES = ['request.json', 'requirements.json', 'strategy.json', 'generation.json', 'gates.json', 'review.json', 'round.json', 'ledger.json'];
const MAX_BYTES = 5 * 1024 * 1024;
const WORKFLOWS: Record<string, 'analysis' | 'tests'> = { 'QA analysis': 'analysis', 'QA tests': 'tests' };

/** The parsed file, or undefined when it is missing, too big or not JSON. */
function readJson(file: string): unknown {
  try {
    if (fs.statSync(file).size > MAX_BYTES) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function record(dir: string, out: string): void {
  const files: RunFiles = {};
  for (const name of FILES) {
    const value = readJson(path.join(dir, name));
    if (value !== undefined) files[name] = value;
  }
  if (!files['request.json']) {
    console.log('No request.json in the artifact: the run was a skipped trigger. Nothing recorded.');
    return;
  }
  const entry = buildEntry(
    {
      runId: process.env.RUN_ID,
      runUrl: process.env.RUN_URL,
      workflow: WORKFLOWS[process.env.WORKFLOW_NAME ?? ''],
      conclusion: process.env.CONCLUSION,
      finishedAt: process.env.FINISHED_AT,
    },
    files,
  );
  if (!entry.runId) throw new Error('RUN_ID is missing or has no usable characters.');
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(entry, null, 2)}\n`);
  console.log(`Recorded run ${entry.runId} (${entry.workflow}, ${entry.key ?? 'no key'}).`);
}

const readLog = (file: string): RunEntry[] => (fs.existsSync(file) ? parseRunLog(fs.readFileSync(file, 'utf8')) : []);

function render(dir: string, entryFile?: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, 'runs.jsonl');
  let entries = newestFirst(readLog(log));
  if (entryFile) {
    const entry = cleanEntry(readJson(entryFile));
    if (!entry) throw new Error(`${entryFile} does not hold a usable run entry.`);
    entries = mergeEntries(entries, entry);
  }
  fs.writeFileSync(log, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
  fs.writeFileSync(path.join(dir, 'README.md'), historyMd(entries));
  fs.writeFileSync(path.join(dir, 'index.html'), historyHtml(entries));
  console.log(`History has ${entries.length} runs.`);
}

const [command, first, second] = process.argv.slice(2);
if (command === 'record' && first && second) record(first, second);
else if (command === 'render' && first) render(first, second);
else {
  console.error('Usage: history.ts record <qa-run dir> <out file> | render <history dir> [entry file]');
  process.exit(2);
}
