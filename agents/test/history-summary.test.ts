import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEntry, type RunEntry } from '../lib/history.ts';
import { summaryHtml } from '../lib/history/summary-page.ts';
import type { TestEntry } from '../lib/history/types.ts';

const NOW = new Date('2026-10-27T12:00:00Z');
const R1 = { runId: '1', finishedAt: '2026-10-10T10:00:00Z', project: 'swag-labs' };
const R2 = { runId: '2', finishedAt: '2026-10-25T10:00:00Z', project: 'swag-labs' };
const R3 = { runId: '3', finishedAt: '2026-03-01T10:00:00Z', project: 'shop' };

function row(run: typeof R1, title: string, over: Partial<TestEntry> = {}): TestEntry {
  return {
    ...run, file: 'tests/a.spec.ts', title, browser: 'chromium', status: 'passed', attempts: 1,
    durationMs: 1000, wastedMs: 0, error: null, fingerprint: null, verdict: null, ...over,
  };
}

const failed = (verdict: TestEntry['verdict']): Partial<TestEntry> => ({ status: 'failed', durationMs: 3000, error: 'boom', fingerprint: 'boom', verdict });

// Hand totals. Rows: 11. Ran (not skipped): 10. Passed in the end: 6 (run 1: 3 of 4, run 2: 2 of 4, run 3: 1 of 2).
const ROWS: TestEntry[] = [
  row(R1, 't1'),
  row(R1, 't2', { durationMs: 2000 }),
  row(R1, 't3', failed('product-bug')),
  row(R1, 't7', { durationMs: 2000 }),
  row(R1, 't4', { status: 'skipped', attempts: 0, durationMs: 0 }),
  row(R2, 't1'),
  row(R2, 't2', { status: 'flaky', attempts: 2, durationMs: 2000, wastedMs: 1_800_000, error: 'late', fingerprint: 'late', verdict: 'flaky' }),
  row(R2, 't3', failed('test-defect')),
  row(R2, 't4', { ...failed(null), durationMs: 1000 }),
  row(R3, 't5', { durationMs: 4000 }),
  row(R3, 't6', { ...failed(null), attempts: 3, durationMs: 5000, wastedMs: 5_400_000 }),
];

const entry = (workflow: string, gatesPassed: boolean | null, costUsd: number, runId: number): RunEntry =>
  buildEntry(
    { runId, runUrl: 'https://github.com/acme/shop/actions/runs/1', workflow, conclusion: 'success', finishedAt: '2026-10-01T12:30:00Z' },
    {
      'request.json': { key: 'SHOP-1', source: 'jira', title: 'x', mode: 'built' },
      ...(gatesPassed === null ? {} : { 'gates.json': { passed: gatesPassed, results: [] } }),
      'ledger.json': [{ role: 'engineer', turns: 1, seconds: 1, costUsd }],
    },
  );
const RUNS = [entry('analysis', null, 0.5, 11), entry('tests', true, 0.75, 12), entry('tests', false, 0.25, 13)];
const PROJECTS = [{ slug: 'swag-labs', name: 'Swag Labs' }, { slug: 'shop', name: 'Shop' }];

const page = (over: Partial<Parameters<typeof summaryHtml>[0]> = {}): string =>
  summaryHtml({ rows: ROWS, runs: RUNS, projects: PROJECTS, manualMinutesPerTest: 0, now: NOW, ...over });

/** The value and note of the stat tile with this label. */
function tile(html: string, label: string): { value: string; note: string } {
  const chunk = html.split('<div class="stat">').find((c) => c.startsWith(`<span class="label">${label}</span>`));
  assert.ok(chunk, `no stat labelled ${label}`);
  return { value: /class="value">([^<]*)</.exec(chunk)?.[1] ?? '', note: /class="note">([^<]*)/.exec(chunk)?.[1] ?? '' };
}

/** The text of each cell in the table row that contains this link. */
function projectRow(html: string, href: string): string[] {
  const tr = html.split('<tr data-i=').slice(1).find((c) => c.includes(`href="${href}"`));
  assert.ok(tr, `no row linking ${href}`);
  return [...tr.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
}

describe('summaryHtml: year to date', () => {
  const html = page();
  it('counts runs across projects', () => assert.equal(tile(html, 'Test runs').value, '3'));
  it('gives the pass rate over tests that ran, 6 of 10', () => assert.equal(tile(html, 'Pass rate').value, '60.0%'));
  it('counts unique tests across projects', () => assert.deepEqual(tile(html, 'Test coverage'), { value: '7', note: 'unique tests' }));
  it('says hours saved are not estimated at 0 minutes', () => {
    assert.deepEqual(tile(html, 'QA hours saved'), { value: 'not estimated', note: 'set history.manualMinutesPerTest in qa.config.json' });
  });
  it('computes hours saved at 20 minutes per test: 10 ran, 200 minutes', () => {
    const t = tile(page({ manualMinutesPerTest: 20 }), 'QA hours saved');
    assert.deepEqual(t, { value: '3.3 hrs', note: 'at 20 min per test run by hand, set in qa.config.json' });
  });
  it('leaves out rows from another year', () => {
    const old = ROWS.map((r) => ({ ...r, finishedAt: '2025-12-31T10:00:00Z' }));
    assert.equal(tile(page({ rows: old }), 'Test runs').value, '0');
  });
});

describe('summaryHtml: what the failures were', () => {
  const html = page();
  it('counts the verdicts of the last 90 days, leaving out the March run', () => {
    assert.equal(tile(html, 'Real bugs').value, '1');
    assert.equal(tile(html, 'Test defects').value, '1');
    assert.equal(tile(html, 'Environment').value, '0');
    assert.equal(tile(html, 'Flaky').value, '1');
  });
  it('shows the signal as one real bug among three classified', () => {
    assert.match(html, /Signal: real bugs among classified failures<\/span><span>33\.3%<\/span>/);
    assert.match(html, /<span style="width:33\.3%">/);
  });
  it('says how many failures triage did not see', () => assert.match(html, /1 failures triage did not see\./));
});

describe('summaryHtml: CI efficiency', () => {
  const html = page();
  it('gives median 2.0s and p95 5.0s over the 10 rows that ran', () => {
    assert.equal(tile(html, 'Median test duration').value, '2.0s');
    assert.equal(tile(html, 'P95 test duration').value, '5.0s');
  });
  it('gives the retry success rate with the counts in the note', () => {
    assert.deepEqual(tile(html, 'Retry success rate'), { value: '50.0%', note: '2 retried, 1 recovered' });
  });
  it('gives retry waste in hours: 30 plus 90 minutes', () => {
    assert.deepEqual(tile(html, 'Retry waste'), { value: '2.0 hrs', note: '3 extra attempts' });
  });
});

describe('summaryHtml: recent trend', () => {
  const html = page();
  it('compares the last 7 days (2 of 4) with the 30 days (5 of 8) and marks it down', () => {
    assert.equal(tile(html, 'Last 7 days pass rate').value, '50.0%');
    assert.match(html, /<span class="chip down">-12.5 pts vs 30 day pass rate<\/span>/);
  });
  it('marks the chip up when the week is better than the month', () => {
    const better = ROWS.filter((r) => r.runId !== '2').concat([row(R2, 'x1'), row(R2, 'x2')]);
    assert.match(page({ rows: better }), /<span class="chip up">\+/);
  });
  it('counts the 30 day tests run, failures and skipped share', () => {
    assert.equal(tile(html, 'Tests run').value, '8');
    assert.equal(tile(html, 'Failures').value, '3');
    assert.deepEqual(tile(html, 'Skipped'), { value: '11.1%', note: '1 of 9 rows' });
  });
  it('charts a point per run with its date and pass rate', () => {
    assert.match(html, /<title>2026-10-10: 75.0%<\/title>/);
    assert.match(html, /<title>2026-10-25: 50\.0%<\/title>/);
  });
});

describe('summaryHtml: projects table', () => {
  const html = page();
  it('links each project to its folder and gives its figures', () => {
    assert.deepEqual(projectRow(html, 'projects/swag-labs/'), ['Swag Labs', '2', '2026-10-25', '50.0%', '62.5%', '4', '1']);
  });
  it('shows - for a project with no run in the last 30 days', () => {
    assert.deepEqual(projectRow(html, 'projects/shop/'), ['Shop', '1', '2026-03-01', '50.0%', '-', '2', '0']);
  });
  it('shows the slug for a project missing from the list', () => {
    assert.deepEqual(projectRow(page({ projects: [] }), 'projects/shop/')[0], 'shop');
  });
  it('escapes a script in a project name, in the table and the nav', () => {
    const html2 = page({ projects: [{ slug: 'swag-labs', name: '<script>alert(1)</script>' }] });
    assert.ok(!html2.includes('<script'));
    assert.match(html2, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });
});

describe('summaryHtml: pipeline', () => {
  const html = page();
  it('counts analysis and tests runs, gates passed over runs that reached them, and cost', () => {
    assert.equal(tile(html, 'Analysis runs').value, '1');
    assert.equal(tile(html, 'Tests runs').value, '2');
    assert.deepEqual(tile(html, 'Gates passed'), { value: '50.0%', note: '1 of 2 runs that reached the gates' });
    assert.equal(tile(html, 'Estimated cost').value, '$1.50');
  });
  it('links to the run history and the other pages from the nav', () => {
    assert.match(html, /<a href="pipeline\/">Open the run history<\/a>/);
    for (const href of ['pipeline/', 'projects/swag-labs/', 'perf/']) assert.ok(html.includes(`<nav class="links">`) && html.includes(`<a href="${href}">`));
  });
});

describe('summaryHtml: nothing recorded', () => {
  const html = summaryHtml({ rows: [], runs: [], projects: [], manualMinutesPerTest: 0, now: NOW });
  it('renders every block with - values and no chart data', () => {
    assert.match(html, /QA executive summary/);
    assert.equal(tile(html, 'Pass rate').value, '-');
    assert.equal(tile(html, 'Median test duration').value, '-');
    assert.match(html, /No data yet\./);
  });
  it('says no regression run has been recorded', () => assert.match(html, /No regression run has been recorded yet\./));
});
