import { idText, isoDate, isRecord, oneOf, text } from '../history.ts';
import type { TestEntry, TestStatus, Verdict } from './types.ts';

/**
 * Rows for tests.jsonl: one per test per run, read from Playwright's JSON report and the triage verdicts.
 * The report passed through a job where generated test code ran, so every value is untrusted: types are
 * checked, strings capped and cleaned, and what does not fit is dropped (same style as lib/history.ts).
 */

const MAX_ROWS = 5_000;
const MAX_DEPTH = 20;
const MAX_MS = 86_400_000;
const STATUSES: readonly TestStatus[] = ['passed', 'failed', 'flaky', 'skipped', 'expected-failure'];
const VERDICTS: readonly Verdict[] = ['product-bug', 'test-defect', 'flaky', 'environment'];
const ANSI = /\u001b\[[0-9;]*m/g;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A whole number of at most `max`, never negative. Anything that is not a finite number is 0. */
function whole(value: unknown, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(Math.max(value, 0), max)) : 0;
}

/** A URL-safe name: lower case, letters and digits, single hyphens, 60 characters at most. 'Swag Labs' gives 'swag-labs'. */
export function slug(name: unknown): string {
  const clean = typeof name === 'string' ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 60).replace(/-+$/, '') : '';
  return clean || 'project';
}

/**
 * The error with the parts that change between runs normalised, so one failure clusters across tests and runs.
 * Hex ids need a digit in them, so ordinary words such as "decade" are left alone.
 */
export function fingerprint(error: string | null): string | null {
  if (error === null) return null;
  return error
    .toLowerCase()
    .replace(/(?<![a-z0-9])'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g, '"?"')
    .replace(/(?:[a-z]:)?[\\/]?[^\s\\/]+(?:[\\/][^\s\\/]+)+/g, '/path')
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{6,}\b/g, '#')
    .replace(/\d+/g, '0')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

// ── Reading a Playwright report ──────────────────────────────────────────────

type Found = { spec: Record<string, unknown>; name: string };

/** Every spec with its "describe > test" name, walking suites the way coverageMap does (file suites dropped). */
function collectSpecs(report: unknown): Found[] {
  const found: Found[] = [];
  const walk = (suite: unknown, parents: string[], depth: number): void => {
    if (!isRecord(suite) || depth > MAX_DEPTH || found.length >= MAX_ROWS) return;
    const title = typeof suite.title === 'string' ? suite.title : '';
    const names = title === '' || title.endsWith('.ts') ? parents : [...parents, title];
    for (const spec of list(suite.specs)) {
      if (isRecord(spec) && typeof spec.title === 'string') found.push({ spec, name: [...names, spec.title].join(' > ') });
    }
    for (const child of list(suite.suites)) walk(child, names, depth + 1);
  };
  if (isRecord(report)) for (const suite of list(report.suites)) walk(suite, [], 0);
  return found;
}

function statusOf(test: Record<string, unknown>): TestStatus | null {
  switch (test.status) {
    case 'expected':
      return test.expectedStatus === 'failed' ? 'expected-failure' : 'passed';
    case 'unexpected':
      return 'failed';
    case 'flaky':
      return 'flaky';
    case 'skipped':
      return 'skipped';
    default:
      return null;
  }
}

/** The first non-empty line of an attempt's error message, colour codes removed. */
function errorLine(result: Record<string, unknown>): string | null {
  const first = list(result.errors)[0];
  const direct = isRecord(result.error) ? result.error.message : undefined;
  const raw = typeof direct === 'string' && direct.trim() ? direct : isRecord(first) ? first.message : undefined;
  if (typeof raw !== 'string') return null;
  const line = raw.replace(ANSI, '').split(/\r?\n/).find((l) => l.trim() !== '');
  return line === undefined ? null : text(line, 300);
}

/** What the triage agent said about each failure, keyed by the (cleaned) full test title. */
function verdictMap(triage: unknown): Map<string, Verdict> {
  const map = new Map<string, Verdict>();
  if (!isRecord(triage)) return map;
  for (const item of list(triage.failures).slice(0, MAX_ROWS)) {
    if (!isRecord(item)) continue;
    const title = text(item.test, 200);
    const verdict = oneOf(item.verdict, VERDICTS);
    if (title && verdict && !map.has(title)) map.set(title, verdict);
  }
  return map;
}

type Meta = { runId: string; finishedAt: string; project: string };

function rowFor(meta: Meta, found: Found, test: Record<string, unknown>, verdicts: Map<string, Verdict>): TestEntry | null {
  const status = statusOf(test);
  if (!status) return null;
  const results = status === 'skipped' ? [] : list(test.results).filter(isRecord);
  const last = results.at(-1);
  const failed = results.filter((r) => r.status !== 'passed' && r.status !== 'skipped').at(-1);
  const error = failed ? errorLine(failed) : null;
  return cleanTestEntry({
    ...meta,
    file: found.spec.file,
    title: found.name,
    browser: test.projectName,
    status,
    attempts: results.length,
    durationMs: last?.duration,
    wastedMs: results.slice(0, -1).reduce((sum: number, r) => sum + whole(r.duration, MAX_MS), 0),
    error,
    fingerprint: fingerprint(error),
    verdict: status === 'failed' || status === 'flaky' ? (verdicts.get(text(found.name, 200) ?? '') ?? null) : null,
  });
}

/** One row per test in the report. A report that is not an object, or a meta that is unusable, gives no rows. */
export function testEntries(meta: Meta, report: unknown, triage: unknown): TestEntry[] {
  const rows: TestEntry[] = [];
  const verdicts = verdictMap(triage);
  for (const found of collectSpecs(report)) {
    for (const test of list(found.spec.tests)) {
      if (!isRecord(test)) continue;
      const row = rowFor(meta, found, test, verdicts);
      if (row) rows.push(row);
      if (rows.length >= MAX_ROWS) return rows;
    }
  }
  return rows;
}

// ── Reading and writing tests.jsonl ──────────────────────────────────────────

/** Re-checks a row read back from tests.jsonl, with the same caps. Null when it cannot be used. */
export function cleanTestEntry(raw: unknown): TestEntry | null {
  if (!isRecord(raw)) return null;
  const runId = idText(raw.runId);
  const finishedAt = isoDate(raw.finishedAt);
  const project = text(raw.project, 60) ? slug(raw.project) : '';
  const file = text(raw.file, 200)?.replace(/\\/g, '/');
  const title = text(raw.title, 200);
  const status = oneOf(raw.status, STATUSES);
  if (!runId || !finishedAt || !project || !file || !title || !status) return null;
  return {
    runId,
    finishedAt,
    project,
    file,
    title,
    browser: text(raw.browser, 40),
    status,
    attempts: whole(raw.attempts, 1000),
    durationMs: whole(raw.durationMs, MAX_MS),
    wastedMs: whole(raw.wastedMs, MAX_MS),
    error: text(raw.error, 300),
    fingerprint: text(raw.fingerprint, 120),
    verdict: oneOf(raw.verdict, VERDICTS),
  };
}

/** The rows in tests.jsonl. A damaged line is skipped, not fatal. */
export function parseTestLog(content: string): TestEntry[] {
  const rows: TestEntry[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = cleanTestEntry(JSON.parse(line));
      if (row) rows.push(row);
    } catch {
      // Not JSON: skipped.
    }
  }
  return rows;
}

const newerRun = (a: TestEntry, b: TestEntry): number =>
  Date.parse(b.finishedAt) - Date.parse(a.finishedAt) || (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0);

/**
 * Rows of any run in `incoming` are replaced; only the newest `maxRuns` runs are kept, newest first. If the rows
 * still exceed `maxRows`, whole runs are dropped from the oldest end until they fit (a run is never cut in half).
 */
export function mergeTestLog(existing: TestEntry[], incoming: TestEntry[], maxRuns = 400, maxRows = 100_000): TestEntry[] {
  const replaced = new Set(incoming.map((row) => row.runId));
  const byRun = new Map<string, TestEntry[]>();
  for (const row of [...existing.filter((r) => !replaced.has(r.runId)), ...incoming]) {
    const rows = byRun.get(row.runId);
    if (rows) rows.push(row);
    else byRun.set(row.runId, [row]);
  }
  const runs = [...byRun.values()].sort((a, b) => newerRun(a[0], b[0])).slice(0, Math.max(maxRuns, 0));
  let total = runs.reduce((sum, run) => sum + run.length, 0);
  while (runs.length > 0 && total > maxRows) total -= runs.pop()!.length;
  return runs.flat();
}

export const serialiseTestLog = (rows: TestEntry[]): string => rows.map((row) => `${JSON.stringify(row)}\n`).join('');
