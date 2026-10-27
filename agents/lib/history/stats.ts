import {
  passedInTheEnd,
  testKey,
  type Cluster,
  type DurationStats,
  type FlakyTest,
  type ProjectSummary,
  type Regression,
  type RetryStats,
  type RunTotals,
  type TestEntry,
  type TestHealth,
  type TestStatus,
  type TrendPoint,
  type VerdictCounts,
} from './types.ts';

/**
 * Pure aggregation over test rows. Nothing here reads a file or a clock except the `now` default, so the same
 * rows always give the same numbers. Percentages are 0 to 100 with one decimal.
 */

const DAY_MS = 86_400_000;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : round1((part / whole) * 100));
const countOf = (rows: TestEntry[], status: TestStatus): number => rows.filter((r) => r.status === status).length;
const ran = (rows: TestEntry[]): TestEntry[] => rows.filter((r) => r.status !== 'skipped');
const isFlake = (r: TestEntry): boolean => r.status === 'flaky' || r.verdict === 'flaky';
const isFailure = (r: TestEntry): boolean => r.status === 'failed' || r.status === 'flaky';
const byTitle = (a: { title: string }, b: { title: string }): number => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);

/** Newest first: by time, then run id. */
const newer = (a: { finishedAt: string; runId: string }, b: { finishedAt: string; runId: string }): number =>
  Date.parse(b.finishedAt) - Date.parse(a.finishedAt) || (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0);

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

const newestOf = (rows: TestEntry[]): TestEntry => [...rows].sort(newer)[0];

// ── Runs ─────────────────────────────────────────────────────────────────────

/** One entry per (project, run), newest first. Skipped tests are left out of the pass rate. */
export function runTotals(rows: TestEntry[]): RunTotals[] {
  const groups = groupBy(rows, (r) => `${r.project}\u0000${r.runId}`);
  return [...groups.values()]
    .map((group): RunTotals => ({
      runId: group[0].runId,
      finishedAt: group[0].finishedAt,
      project: group[0].project,
      tests: group.length,
      passed: countOf(group, 'passed'),
      failed: countOf(group, 'failed'),
      flaky: countOf(group, 'flaky'),
      skipped: countOf(group, 'skipped'),
      expectedFailures: countOf(group, 'expected-failure'),
      durationMs: group.reduce((sum, r) => sum + r.durationMs, 0),
      passRate: passRate(group),
    }))
    .sort(newer);
}

export const latestRun = (rows: TestEntry[], project: string): RunTotals | null => runTotals(rows.filter((r) => r.project === project))[0] ?? null;
export const previousRun = (rows: TestEntry[], project: string): RunTotals | null => runTotals(rows.filter((r) => r.project === project))[1] ?? null;

/** Rows from the last `days` days. A row dated after `now` is left out. */
export function inWindow(rows: TestEntry[], days: number, now: Date = new Date()): TestEntry[] {
  const cutoff = now.getTime() - days * DAY_MS;
  return rows.filter((r) => {
    const time = Date.parse(r.finishedAt);
    return time >= cutoff && time <= now.getTime();
  });
}

/** Tests passing in the end over tests that ran. Null when nothing ran. */
export function passRate(rows: TestEntry[]): number | null {
  const done = ran(rows);
  return ratio(done.filter((r) => passedInTheEnd(r.status)).length, done.length);
}

// ── Durations and retries ────────────────────────────────────────────────────

/** Nearest-rank percentile, p from 0 to 100. Null on an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(Math.max(Math.ceil((p / 100) * sorted.length), 1), sorted.length);
  return sorted[rank - 1];
}

export function durations(rows: TestEntry[]): DurationStats {
  const values = ran(rows).map((r) => r.durationMs);
  return { medianMs: percentile(values, 50), p95Ms: percentile(values, 95) };
}

export function retries(rows: TestEntry[]): RetryStats {
  const retried = rows.filter((r) => r.attempts > 1);
  const recovered = retried.filter((r) => passedInTheEnd(r.status)).length;
  return {
    extraAttempts: retried.reduce((sum, r) => sum + r.attempts - 1, 0),
    retried: retried.length,
    recovered,
    successRate: ratio(recovered, retried.length),
    wastedMs: rows.reduce((sum, r) => sum + r.wastedMs, 0),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

/** One entry per test over the rows given: lowest pass rate first, tests that never ran last. */
export function testHealth(rows: TestEntry[]): TestHealth[] {
  const health = [...groupBy(rows, testKey).values()].map((group): TestHealth => {
    const last = newestOf(group);
    return {
      file: last.file,
      title: last.title,
      browser: last.browser,
      runs: group.length,
      passed: countOf(group, 'passed'),
      failed: countOf(group, 'failed'),
      flaky: countOf(group, 'flaky'),
      skipped: countOf(group, 'skipped'),
      passRate: passRate(group),
      medianMs: percentile(ran(group).map((r) => r.durationMs), 50),
      lastStatus: last.status,
      lastRunId: last.runId,
      lastFinishedAt: last.finishedAt,
      lastError: last.error,
    };
  });
  return health.sort((a, b) => {
    if (a.passRate === null || b.passRate === null) return a.passRate === b.passRate ? byTitle(a, b) : a.passRate === null ? 1 : -1;
    return a.passRate - b.passRate || byTitle(a, b);
  });
}

export function slowest(health: TestHealth[], n = 10): TestHealth[] {
  return health
    .filter((h) => h.medianMs !== null)
    .sort((a, b) => (b.medianMs ?? 0) - (a.medianMs ?? 0) || byTitle(a, b))
    .slice(0, n);
}

/** Tests that passed in the end in the previous run of the project and failed in the latest. */
export function regressions(rows: TestEntry[], project: string): Regression[] {
  const latest = latestRun(rows, project);
  const previous = previousRun(rows, project);
  if (!latest || !previous) return [];
  const inRun = (run: RunTotals): TestEntry[] => rows.filter((r) => r.project === project && r.runId === run.runId);
  const before = new Set(inRun(previous).filter((r) => passedInTheEnd(r.status)).map(testKey));
  return inRun(latest)
    .filter((r) => r.status === 'failed' && before.has(testKey(r)))
    .map((r) => ({ file: r.file, title: r.title, browser: r.browser, previousRunId: previous.runId, latestRunId: latest.runId, error: r.error }));
}

/** Tests with a flaky row (by status or by triage's verdict) in the newest `runs` runs of each project. */
export function flakyTests(rows: TestEntry[], runs = 20): FlakyTest[] {
  const found: FlakyTest[] = [];
  for (const project of new Set(rows.map((r) => r.project))) {
    const projectRows = rows.filter((r) => r.project === project);
    const recent = new Set(runTotals(projectRows).slice(0, runs).map((t) => t.runId));
    for (const group of groupBy(projectRows.filter((r) => recent.has(r.runId)), testKey).values()) {
      const flakes = group.filter(isFlake);
      if (flakes.length === 0) continue;
      const { file, title, browser } = group[0];
      found.push({ file, title, browser, flakes: flakes.length, runs: group.length, lastFinishedAt: newestOf(flakes).finishedAt });
    }
  }
  return found.sort((a, b) => b.flakes - a.flakes || byTitle(a, b));
}

// ── Failures ─────────────────────────────────────────────────────────────────

/** Failed and flaky rows grouped by fingerprint, most failures first. */
export function clusters(rows: TestEntry[]): Cluster[] {
  const failing = rows.filter((r) => r.fingerprint !== null && isFailure(r));
  return [...groupBy(failing, (r) => r.fingerprint ?? '').entries()]
    .map(([print, group]): Cluster => {
      const newest = newestOf(group);
      return {
        fingerprint: print,
        sample: newest.error ?? print,
        failures: group.length,
        tests: new Set(group.map(testKey)).size,
        runs: new Set(group.map((r) => r.runId)).size,
        lastFinishedAt: newest.finishedAt,
      };
    })
    .sort((a, b) => b.failures - a.failures || (a.fingerprint < b.fingerprint ? -1 : 1));
}

/** What triage made of the failed and flaky rows. Signal is the share of classified failures that were real bugs. */
export function verdicts(rows: TestEntry[]): VerdictCounts {
  const failing = rows.filter(isFailure);
  const of = (verdict: string): number => failing.filter((r) => r.verdict === verdict).length;
  const productBug = of('product-bug');
  const testDefect = of('test-defect');
  const flaky = of('flaky');
  const environment = of('environment');
  return {
    productBug,
    testDefect,
    flaky,
    environment,
    unclassified: failing.filter((r) => r.verdict === null).length,
    signal: ratio(productBug, productBug + testDefect + flaky + environment),
  };
}

// ── Pages ────────────────────────────────────────────────────────────────────

/** One point per run in the window, oldest first. */
export function trend(rows: TestEntry[], days: number, now: Date = new Date()): TrendPoint[] {
  return runTotals(inWindow(rows, days, now))
    .reverse()
    .map((t) => ({ runId: t.runId, finishedAt: t.finishedAt, passRate: t.passRate, tests: t.tests }));
}

/** One point per UTC day in the window that has rows, oldest first, over all projects. */
export function dailyTrend(rows: TestEntry[], days: number, now: Date = new Date()): TrendPoint[] {
  const perDay = groupBy(inWindow(rows, days, now), (r) => r.finishedAt.slice(0, 10));
  return [...perDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, group]) => ({ runId: newestOf(group).runId, finishedAt: `${day}T00:00:00.000Z`, passRate: passRate(group), tests: group.length }));
}

/** One entry per project, alphabetical. */
export function projects(rows: TestEntry[], now: Date = new Date()): ProjectSummary[] {
  return [...groupBy(rows, (r) => r.project).entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([project, group]): ProjectSummary => {
      const totals = runTotals(group);
      const recent = inWindow(group, 30, now);
      return {
        project,
        runs: totals.length,
        lastRunId: totals[0].runId,
        lastFinishedAt: totals[0].finishedAt,
        lastPassRate: totals[0].passRate,
        passRate30d: passRate(recent),
        tests: new Set(group.filter((r) => r.runId === totals[0].runId).map(testKey)).size,
        flaky: new Set(recent.filter(isFlake).map(testKey)).size,
      };
    });
}

/** Tests that ran, times the minutes a person would have spent on each, in hours with one decimal. */
export const hoursSaved = (rows: TestEntry[], minutesPerTest: number): number => round1((ran(rows).length * minutesPerTest) / 60);

/** Tests counted by project and test together, so the same test in two projects counts twice. */
export const distinctTests = (rows: TestEntry[]): number => new Set(rows.map((r) => `${r.project} ${testKey(r)}`)).size;
