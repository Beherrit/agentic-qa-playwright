/**
 * The test-level history: one row per test per regression run, kept as tests.jsonl on the qa-history branch next
 * to runs.jsonl. Every page that shows pass rates, durations, flakiness or failure clusters is computed from these
 * rows by pure functions in stats.ts; nothing here is read from a model.
 *
 * The rows come from Playwright's JSON report, which passed through a job where generated test code ran, so the
 * parser in tests.ts treats every value as untrusted: types checked, strings capped, the rest dropped.
 */

export type TestStatus = 'passed' | 'failed' | 'flaky' | 'skipped' | 'expected-failure';
export type Verdict = 'product-bug' | 'test-defect' | 'flaky' | 'environment';

export type TestEntry = {
  runId: string;
  /** ISO time the run finished; the same value the run's RunEntry carries. */
  finishedAt: string;
  /** The project slug, from qa.config.json app.name (see slug() in tests.ts). */
  project: string;
  /** Spec file, relative to the repository root, forward slashes. */
  file: string;
  /** The full title path, "describe > test", the same form the coverage map uses. */
  title: string;
  /** Playwright's project name (the browser), null when the report has none. */
  browser: string | null;
  status: TestStatus;
  /** How many times the test ran: 1 for a straight pass, more when it was retried. 0 when skipped. */
  attempts: number;
  /** The final attempt's duration. */
  durationMs: number;
  /** Time spent on attempts before the final one: the cost of retries. */
  wastedMs: number;
  /** First line of the final failing attempt's error message, capped. Null when nothing failed. */
  error: string | null;
  /** The error with numbers, quoted values, hex ids and paths normalised, so the same failure clusters across tests and runs. */
  fingerprint: string | null;
  /** What the triage agent made of the failure in this run, matched by title. Null when triage did not run or did not name it. */
  verdict: Verdict | null;
};

/** The identity of a test across runs: file, title and browser together. */
export const testKey = (t: Pick<TestEntry, 'file' | 'title' | 'browser'>): string => `${t.file}\u0000${t.title}\u0000${t.browser ?? ''}`;

/** A test counts as passing in the end when its final attempt passed, which includes a flaky one and an expected failure. */
export const passedInTheEnd = (status: TestStatus): boolean => status === 'passed' || status === 'flaky' || status === 'expected-failure';

// ── Aggregates, all produced by stats.ts ─────────────────────────────────────

/** One regression run of one project, totalled from its rows. */
export type RunTotals = {
  runId: string;
  finishedAt: string;
  project: string;
  tests: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  expectedFailures: number;
  /** Sum of final-attempt durations. */
  durationMs: number;
  /** Tests passing in the end over tests that ran (skipped excluded), 0 to 100. Null when nothing ran. */
  passRate: number | null;
};

export type DurationStats = { medianMs: number | null; p95Ms: number | null };

export type RetryStats = {
  /** Attempts beyond the first, summed over all rows. */
  extraAttempts: number;
  /** Rows retried at least once. */
  retried: number;
  /** Retried rows that passed in the end. */
  recovered: number;
  /** recovered over retried, 0 to 100. Null when nothing was retried. */
  successRate: number | null;
  /** Sum of wastedMs. */
  wastedMs: number;
};

/** One test's record over the rows given. */
export type TestHealth = {
  file: string;
  title: string;
  browser: string | null;
  runs: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  /** Passing in the end over runs that were not skipped. Null when every run skipped it. */
  passRate: number | null;
  /** Median final-attempt duration over runs that were not skipped. */
  medianMs: number | null;
  lastStatus: TestStatus;
  lastRunId: string;
  lastFinishedAt: string;
  lastError: string | null;
};

/** A test that passed in the end in the previous run of its project and failed in the latest. */
export type Regression = { file: string; title: string; browser: string | null; previousRunId: string; latestRunId: string; error: string | null };

export type FlakyTest = { file: string; title: string; browser: string | null; flakes: number; runs: number; lastFinishedAt: string };

/** Failures that share a fingerprint. */
export type Cluster = { fingerprint: string; sample: string; failures: number; tests: number; runs: number; lastFinishedAt: string };

export type VerdictCounts = {
  productBug: number;
  testDefect: number;
  flaky: number;
  environment: number;
  /** Failed or flaky rows triage did not classify. */
  unclassified: number;
  /** productBug over all classified rows, 0 to 100: how much of what automation flags is a real bug. Null when nothing was classified. */
  signal: number | null;
};

export type TrendPoint = { runId: string; finishedAt: string; passRate: number | null; tests: number };

/** One project on the executive summary's table. */
export type ProjectSummary = {
  project: string;
  runs: number;
  lastRunId: string;
  lastFinishedAt: string;
  lastPassRate: number | null;
  /** Over the last 30 days of rows. */
  passRate30d: number | null;
  /** Distinct tests in the latest run. */
  tests: number;
  /** Distinct tests flaky at least once in the last 30 days. */
  flaky: number;
};
