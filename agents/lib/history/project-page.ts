/**
 * One project's page on the history site (projects/<slug>/index.html): the latest run, regressions, recent runs,
 * test health with a filter, flaky tests, failure clusters, the slowest tests and a pass rate trend. Pure: rows in,
 * one HTML document out. Every number is counted from the rows by stats.ts.
 */
import {
  areaChart, card, count, dateText, delta, filterScript, pageShell, pct, secs, stat, stats, table,
  type Cell,
} from './html.ts';
import {
  clusters, flakyTests, inWindow, latestRun, previousRun, regressions, runTotals, slowest, testHealth, trend,
} from './stats.ts';
import type { RunTotals, TestEntry, TestHealth } from './types.ts';

const ERROR_SHOWN = 120;
const dash = (s: string | null): string => (s ? s : '-');
const shorten = (s: string | null): string => (s ? s.slice(0, ERROR_SHOWN) : '-');

/** Cells every test table starts with: title, file and browser. */
const testCells = (t: { title: string; file: string; browser: string | null }): Cell[] => [t.title, t.file, dash(t.browser)];

function chipFor(latest: number | null, before: number | null): { text: string; dir: 'up' | 'down' | 'flat' } | undefined {
  const text = delta(latest, before, 'previous run');
  if (!text) return undefined;
  return { text, dir: (latest ?? 0) > (before ?? 0) ? 'up' : (latest ?? 0) < (before ?? 0) ? 'down' : 'flat' };
}

function latestCard(latest: RunTotals | null, previous: RunTotals | null): string {
  if (!latest) {
    const empty = ['Pass rate', 'Tests', 'Failed', 'Expected failures', 'Flaky', 'Skipped', 'Duration'].map((label) => stat(label, '-'));
    return card('Latest run', '', stats(empty));
  }
  return card('Latest run', `${dateText(latest.finishedAt)}, run ${latest.runId}`, stats([
    stat('Pass rate', pct(latest.passRate), 'skipped tests left out', chipFor(latest.passRate, previous?.passRate ?? null)),
    stat('Tests', count(latest.tests)),
    stat('Failed', count(latest.failed)),
    stat('Expected failures', count(latest.expectedFailures), 'marked as known failures, counted as passing'),
    stat('Flaky', count(latest.flaky)),
    stat('Skipped', count(latest.skipped)),
    stat('Duration', secs(latest.durationMs), 'sum of the tests'),
  ]));
}

function regressionsCard(rows: TestEntry[], slug: string): string {
  const found = regressions(rows, slug);
  return card('Regressions', 'passed last run, failed this run', table(
    ['File', 'Test', 'Browser', 'Error'],
    found.map((r) => [r.file, r.title, dash(r.browser), shorten(r.error)]),
    { empty: 'Nothing that passed last run failed in this one.' },
  ));
}

function recentRunsCard(rows: TestEntry[]): string {
  const runs = runTotals(rows).slice(0, 30);
  return card('Recent runs', 'newest first, up to 30', table(
    ['Date', 'Run', 'Tests', 'Passed', 'Failed', 'Expected failures', 'Flaky', 'Skipped', 'Pass rate', 'Duration'],
    runs.map((t) => [
      dateText(t.finishedAt), t.runId, count(t.tests), count(t.passed), count(t.failed), count(t.expectedFailures),
      count(t.flaky), count(t.skipped), pct(t.passRate), secs(t.durationMs),
    ]),
    { numeric: [2, 3, 4, 5, 6, 7, 8, 9], empty: 'No run has been recorded yet.' },
  ));
}

/** The newest 30 runs or the last 90 days of rows, whichever holds more. */
function healthRows(rows: TestEntry[], now: Date): TestEntry[] {
  const newest = new Set(runTotals(rows).slice(0, 30).map((t) => t.runId));
  const recent = new Set(inWindow(rows, 90, now));
  return rows.filter((r) => newest.has(r.runId) || recent.has(r));
}

const haystack = (h: TestHealth): string => [h.title, h.file, h.browser ?? '', h.lastStatus].join(' ');

function healthCard(health: TestHealth[]): string {
  const filter =
    `<p><input type="search" id="health-filter" placeholder="Filter by test, file, browser or status" aria-label="Filter tests">` +
    ` <span class="muted" id="health-count"></span></p>`;
  const grid = table(
    ['Test', 'File', 'Browser', 'Runs', 'Pass rate', 'Failed', 'Flaky', 'Median', 'Last status', 'Last error'],
    health.map((h) => [...testCells(h), count(h.runs), pct(h.passRate), count(h.failed), count(h.flaky), secs(h.medianMs), h.lastStatus, shorten(h.lastError)]),
    { id: 'health', numeric: [3, 4, 5, 6, 7], empty: 'No test has been recorded yet.' },
  );
  return card('Test health', 'every test over the last 30 runs or 90 days, whichever is more', filter + grid);
}

function flakyCard(rows: TestEntry[]): string {
  return card('Flaky tests', 'last 20 runs', table(
    ['Test', 'File', 'Browser', 'Flakes', 'Runs'],
    flakyTests(rows, 20).map((f) => [...testCells(f), count(f.flakes), count(f.runs)]),
    { numeric: [3, 4], empty: 'No flaky test in the last 20 runs.' },
  ));
}

function clustersCard(rows: TestEntry[]): string {
  return card('Failure clusters', 'the same error across tests and runs', table(
    ['Error', 'Failures', 'Tests', 'Runs', 'Last seen'],
    clusters(rows).map((c) => [shorten(c.sample), count(c.failures), count(c.tests), count(c.runs), dateText(c.lastFinishedAt)]),
    { numeric: [1, 2, 3], empty: 'No failure has been recorded.' },
  ));
}

function slowestCard(health: TestHealth[]): string {
  return card('Slowest tests', 'by median duration', table(
    ['Test', 'File', 'Median', 'Runs'],
    slowest(health, 10).map((h) => [h.title, h.file, secs(h.medianMs), count(h.runs)]),
    { numeric: [2, 3], empty: 'No test has run yet.' },
  ));
}

function trendCard(rows: TestEntry[], now: Date): string {
  const chart = areaChart({
    title: 'Pass rate by run',
    points: trend(rows, 30, now).map((p) => ({ label: dateText(p.finishedAt), value: p.passRate })),
    max: 100,
    target: 95,
    format: (n) => pct(n),
    yLabel: 'Pass rate (%)',
  });
  return card('Pass rate trend', 'last 30 days', chart);
}

export function projectHtml(opts: { slug: string; name: string; rows: TestEntry[]; now?: Date }): string {
  const { slug, name, rows } = opts;
  const now = opts.now ?? new Date();
  const latest = latestRun(rows, slug);
  const health = testHealth(healthRows(rows, now));
  const intro = `Every regression run's test results for this project, newest first.${latest ? ` Latest run: ${dateText(latest.finishedAt)}.` : ' No run has been recorded yet.'}`;
  const body = [
    latestCard(latest, previousRun(rows, slug)),
    regressionsCard(rows, slug),
    recentRunsCard(rows),
    healthCard(health),
    flakyCard(rows),
    clustersCard(rows),
    slowestCard(testHealth(rows)),
    trendCard(rows, now),
  ].join('\n');
  return pageShell({
    title: name,
    intro,
    nav: [{ href: '../../', text: 'Executive summary' }, { href: '../../pipeline/', text: 'Pipeline run history' }],
    body,
    json: { id: 'health-data', data: health.map(haystack) },
    script: filterScript('health', 'health-filter', 'health-count', 'tests'),
  });
}
