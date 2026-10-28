import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { projectHtml } from '../lib/history/project-page.ts';
import type { TestEntry, TestStatus } from '../lib/history/types.ts';

const NOW = new Date('2026-10-04T00:00:00Z');
const RUNS: [string, string][] = [['501', '2026-10-01T10:00:00Z'], ['502', '2026-10-02T10:00:00Z'], ['503', '2026-10-03T10:00:00Z']];

type Spec = { file: string; title: string; ms: number };
const A: Spec = { file: 'tests/login.spec.ts', title: 'Login > logs in', ms: 1000 };
const B: Spec = { file: 'tests/cart.spec.ts', title: 'Cart > adds item', ms: 2000 };
const C: Spec = { file: 'tests/checkout.spec.ts', title: 'Checkout > pays <b>bold</b>', ms: 1500 };
const D: Spec = { file: 'tests/search.spec.ts', title: 'Search > finds results', ms: 3000 };
const E: Spec = { file: 'tests/report.spec.ts', title: 'Report > exports big file', ms: 9000 };
const F: Spec = { file: 'tests/misc.spec.ts', title: 'Misc > not run', ms: 0 };

function row(run: number, s: Spec, status: TestStatus, error: string | null = null): TestEntry {
  const [runId, finishedAt] = RUNS[run];
  return {
    runId, finishedAt, project: 'swag-labs', file: s.file, title: s.title, browser: 'chromium', status,
    attempts: status === 'skipped' ? 0 : status === 'flaky' ? 2 : 1, durationMs: s.ms, wastedMs: status === 'flaky' ? 500 : 0,
    error, fingerprint: error === null ? null : error.replace(/\d+/g, '0'), verdict: null,
  };
}

// Run 501: 5 tests, C fails, D flaky: 4 of 5 pass in the end, 80.0%.
// Run 502: 5 tests, all pass: 100.0%.
// Run 503: 6 tests, B fails (it passed in 502: the regression), D flaky, F skipped: 4 of 5 ran pass, 80.0%.
// Every run's durations total 1000 + 2000 + 1500 + 3000 + 9000 = 16,500 ms.
const ROWS: TestEntry[] = [
  row(0, A, 'passed'), row(0, B, 'passed'), row(0, C, 'failed', 'expected 8 got 3'), row(0, D, 'flaky'), row(0, E, 'passed'),
  row(1, A, 'passed'), row(1, B, 'passed'), row(1, C, 'passed'), row(1, D, 'passed'), row(1, E, 'passed'),
  row(2, A, 'passed'), row(2, B, 'failed', 'expected 7 got 9'), row(2, C, 'passed'), row(2, D, 'flaky'), row(2, E, 'passed'), row(2, F, 'skipped'),
];

const page = projectHtml({ slug: 'swag-labs', name: 'Swag Labs', rows: ROWS, now: NOW });

const unescape = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const section = (html: string, title: string): string => {
  const start = html.indexOf(`<section class="card"><h2>${title}`);
  assert.ok(start >= 0, `no card named ${title}`);
  return html.slice(start, html.indexOf('</section>', start));
};
const rowsOf = (html: string, title: string): string[][] =>
  [...section(html, title).matchAll(/<tr data-i="\d+">(.*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((c) => unescape(c[1].replace(/<[^>]+>/g, ''))));
const statValue = (html: string, label: string): string => {
  const m = html.match(new RegExp(`<span class="label">${label}</span><span class="value">([^<]*)</span>`));
  assert.ok(m, `no stat named ${label}`);
  return m[1];
};

describe('projectHtml: the page', () => {
  it('titles the page with the project name and names the date of the latest run', () => {
    assert.match(page, /<title>Swag Labs<\/title>/);
    assert.match(page, /newest first\. Latest run: 2026-10-03\./);
  });
  it('links back with relative paths only', () => {
    assert.ok(page.includes('<a href="../../">Executive summary</a>'));
    assert.ok(page.includes('<a href="../../pipeline/">Pipeline run history</a>'));
    assert.doesNotMatch(page, /href="(https?:|\/)/);
  });
});

describe('projectHtml: latest run', () => {
  it('shows the pass rate of the latest run, 4 of the 5 tests that ran', () => assert.equal(statValue(page, 'Pass rate'), '80.0%'));
  it('shows the chip against the previous run, 100.0% down to 80.0%', () => {
    assert.match(page, /<span class="chip down">-20\.0 pts vs previous run<\/span>/);
  });
  it('counts tests, failed, flaky and skipped for the latest run', () => {
    assert.equal(statValue(page, 'Tests'), '6');
    assert.equal(statValue(page, 'Failed'), '1');
    assert.equal(statValue(page, 'Flaky'), '1');
    assert.equal(statValue(page, 'Skipped'), '1');
  });
  it('sums the durations of the latest run', () => assert.equal(statValue(page, 'Duration'), '16.5s'));
});

describe('projectHtml: regressions', () => {
  it('lists exactly the one test that passed last run and failed this run', () => {
    assert.deepEqual(rowsOf(page, 'Regressions'), [['tests/cart.spec.ts', 'Cart > adds item', 'chromium', 'expected 7 got 9']]);
  });
  it('does not list a test that was already failing', () => {
    const rows = [row(0, B, 'failed', 'boom'), row(1, B, 'failed', 'boom'), row(1, A, 'passed')];
    const html = projectHtml({ slug: 'swag-labs', name: 'Swag Labs', rows, now: NOW });
    assert.deepEqual(rowsOf(html, 'Regressions'), []);
    assert.match(section(html, 'Regressions'), /Nothing that passed last run failed in this one\./);
  });
});

describe('projectHtml: recent runs', () => {
  it('lists the runs newest first with their totals', () => {
    assert.deepEqual(rowsOf(page, 'Recent runs'), [
      ['2026-10-03', '503', '6', '3', '1', '0', '1', '1', '80.0%', '16.5s'],
      ['2026-10-02', '502', '5', '5', '0', '0', '0', '0', '100.0%', '16.5s'],
      ['2026-10-01', '501', '5', '3', '1', '0', '1', '0', '80.0%', '16.5s'],
    ]);
  });
});

describe('projectHtml: expected failures', () => {
  // One run: A passes, B and C are marked as known failures. All three count as passing in the end: 100.0%.
  const rows = [row(0, A, 'passed'), row(0, B, 'expected-failure', 'known: expected 1 got 2'), row(0, C, 'expected-failure', 'known: expected 3 got 4')];
  const html = projectHtml({ slug: 'swag-labs', name: 'Swag Labs', rows, now: NOW });
  it('has a tile for them on the latest run, so the tests add up', () => {
    assert.equal(statValue(html, 'Tests'), '3');
    assert.equal(statValue(html, 'Failed'), '0');
    assert.equal(statValue(html, 'Expected failures'), '2');
    assert.equal(statValue(html, 'Pass rate'), '100.0%');
  });
  it('has a column for them in recent runs, between failed and flaky', () => {
    assert.deepEqual(rowsOf(html, 'Recent runs'), [['2026-10-01', '501', '3', '1', '0', '2', '0', '0', '100.0%', '4.5s']]);
  });
  it('shows the tile with a dash when there is no run', () => {
    assert.equal(statValue(projectHtml({ slug: 'swag-labs', name: 'Swag Labs', rows: [], now: NOW }), 'Expected failures'), '-');
  });
});

describe('projectHtml: test health', () => {
  const health = rowsOf(page, 'Test health');
  it('has one row per test, lowest pass rate first', () => {
    assert.equal(health.length, 6);
    assert.deepEqual(health[0].slice(0, 9), ['Cart > adds item', 'tests/cart.spec.ts', 'chromium', '3', '66.7%', '1', '0', '2.0s', 'failed']);
  });
  it('shows the last error of a test and "-" for a test with none', () => {
    assert.equal(health[0][9], 'expected 7 got 9');
    assert.equal(health[health.length - 1][9], '-');
  });
  it('caps the displayed error at 120 characters', () => {
    const long = row(0, A, 'failed', `x${'y'.repeat(300)}`);
    const html = projectHtml({ slug: 'swag-labs', name: 'Swag Labs', rows: [long], now: NOW });
    assert.equal(rowsOf(html, 'Test health')[0][9].length, 120);
  });
  it('embeds one lower-case-able haystack per row for the filter, with < escaped', () => {
    const m = page.match(/<script type="application\/json" id="health-data">(.*?)<\/script>/);
    assert.ok(m);
    assert.ok(!m[1].includes('<'));
    const data = JSON.parse(m[1]) as string[];
    assert.equal(data.length, 6);
    assert.equal(data[0], 'Cart > adds item tests/cart.spec.ts chromium failed');
  });
  it('wires the filter box to the table', () => {
    assert.match(page, /id="health-filter"/);
    assert.match(page, /id="health-count"/);
    assert.match(page, /<table id="health">/);
    assert.match(page, /health-data/);
  });
});

describe('projectHtml: flaky tests, clusters and slowest', () => {
  it('names the flaky test with 2 flakes in 3 runs', () => {
    assert.deepEqual(rowsOf(page, 'Flaky tests'), [['Search > finds results', 'tests/search.spec.ts', 'chromium', '2', '3']]);
  });
  it('groups the two failures with the same error into one cluster across 2 tests and 2 runs', () => {
    assert.deepEqual(rowsOf(page, 'Failure clusters'), [['expected 7 got 9', '2', '2', '2', '2026-10-03']]);
  });
  it('puts the slow test first among the slowest', () => {
    const rows = rowsOf(page, 'Slowest tests');
    assert.deepEqual(rows[0], ['Report > exports big file', 'tests/report.spec.ts', '9.0s', '3']);
    assert.equal(rows.length, 5);
  });
});

describe('projectHtml: trend and escaping', () => {
  it('draws the pass rate trend from the runs in the last 30 days', () => {
    const trend = section(page, 'Pass rate trend');
    assert.match(trend, /<svg/);
    assert.match(trend, /2026-10-02: 100\.0%/);
    assert.doesNotMatch(trend, /No data yet\./);
  });
  it('escapes a tag in a test title everywhere it appears', () => {
    assert.ok(!page.includes('<b>bold'));
    assert.ok(page.includes('&lt;b&gt;bold&lt;/b&gt;'));
    assert.ok(page.includes('\\u003cb>bold'));
  });
  it('escapes a tag in the project name', () => {
    const html = projectHtml({ slug: 'x', name: '<script>alert(1)</script>', rows: [], now: NOW });
    assert.ok(!html.includes('<script>alert(1)'));
    assert.ok(html.includes('&lt;script&gt;alert(1)'));
  });
});

describe('projectHtml: no rows', () => {
  const empty = projectHtml({ slug: 'swag-labs', name: 'Swag Labs', rows: [], now: NOW });
  it('renders every table with its empty message', () => {
    for (const msg of [
      'Nothing that passed last run failed in this one.', 'No run has been recorded yet.', 'No test has been recorded yet.',
      'No flaky test in the last 20 runs.', 'No failure has been recorded.', 'No test has run yet.',
    ]) assert.ok(empty.includes(msg), msg);
  });
  it('says there is no data for the chart and shows "-" for the latest run', () => {
    assert.match(section(empty, 'Pass rate trend'), /No data yet\./);
    assert.equal(statValue(empty, 'Pass rate'), '-');
  });
});
