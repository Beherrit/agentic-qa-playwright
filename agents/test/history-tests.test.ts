import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clusters, dailyTrend, distinctTests, durations, flakyTests, hoursSaved, inWindow, latestRun, passRate, percentile, previousRun,
  projects, regressions, retries, runTotals, slowest, testHealth, trend, verdicts,
} from '../lib/history/stats.ts';
import { cleanTestEntry, fingerprint, mergeTestLog, parseTestLog, serialiseTestLog, slug, testEntries } from '../lib/history/tests.ts';
import type { TestEntry } from '../lib/history/types.ts';

const ESC = String.fromCharCode(27);
const META = { runId: '501', finishedAt: '2026-10-01T10:00:00Z', project: 'swag-labs' };
const ok = (duration: number) => ({ status: 'passed', duration, retry: 0 });
const bad = (duration: number, message: string) => ({ status: 'failed', duration, retry: 0, error: { message } });
const test = (status: string, results: object[], over: object = {}) => ({ projectName: 'chromium', expectedStatus: 'passed', status, results, ...over });
const spec = (title: string, tests: object[], file = 'tests/login.spec.ts') => ({ title, file, tests });
const oneTest = (t: object) => ({ suites: [{ title: 'a.spec.ts', suites: [{ title: 'A', specs: [spec('t', [t])] }] }] });

const REPORT = {
  suites: [
    { title: 'login.spec.ts', specs: [], suites: [{ title: 'Login', specs: [
      spec('accepts valid user', [test('expected', [ok(1200)]), test('expected', [ok(1800)], { projectName: 'firefox' })]),
      spec('rejects wrong password', [test('unexpected', [bad(3000, `${ESC}[31mError:${ESC}[39m expected 'Epic sadface' but got 'Locked out 42 times'\nsecond line`)])]),
    ] }] },
    { title: 'cart.spec.ts', suites: [{ title: 'Cart', specs: [
      spec('keeps items after reload', [test('flaky', [bad(2500, 'Timeout 5000ms exceeded\nwaiting for locator'), ok(1500)])], 'tests/cart.spec.ts'),
      spec('applies coupon', [test('skipped', [{ status: 'skipped', duration: 0, retry: 0 }], { expectedStatus: 'skipped' })], 'tests/cart.spec.ts'),
      spec('known sort bug', [test('expected', [bad(900, 'sorted wrong')], { expectedStatus: 'failed' })], 'tests/cart.spec.ts'),
    ] }] },
  ],
};
const TRIAGE = { failures: [
  { test: 'Login > rejects wrong password', verdict: 'product-bug' },
  { test: 'Cart > keeps items after reload', verdict: 'made-up' },
] };
const byTitle = (rows: TestEntry[], title: string, browser = 'chromium') => rows.find((r) => r.title === title && r.browser === browser);

describe('slug', () => {
  it('lower-cases and joins words with hyphens', () => assert.equal(slug('Swag Labs'), 'swag-labs'));
  it('collapses runs of other characters and trims hyphens', () => assert.equal(slug('  --Hello,   World!! '), 'hello-world'));
  it('falls back to "project" when nothing is left', () => {
    for (const name of ['', '!!!', 42, null]) assert.equal(slug(name), 'project');
  });
  it('caps at 60 characters without a trailing hyphen', () => {
    assert.equal(slug('a'.repeat(100)).length, 60);
    assert.equal(slug(`${'a'.repeat(59)} b`), 'a'.repeat(59));
  });
});

describe('testEntries: reading a report', () => {
  const rows = testEntries(META, REPORT, TRIAGE);
  it('gives one row per test, naming it describe > test with the file suite dropped', () => {
    assert.equal(rows.length, 6);
    assert.deepEqual(rows.map((r) => r.title).slice(0, 3), ['Login > accepts valid user', 'Login > accepts valid user', 'Login > rejects wrong password']);
    assert.equal(rows[0].file, 'tests/login.spec.ts');
    assert.deepEqual([rows[0].browser, rows[1].browser], ['chromium', 'firefox']);
    assert.deepEqual([rows[0].runId, rows[0].project, rows[0].finishedAt], ['501', 'swag-labs', '2026-10-01T10:00:00.000Z']);
  });
  const cases: [string, object, string][] = [
    ['an expected pass is passed', test('expected', [ok(1)]), 'passed'],
    ['an expected failure is expected-failure', test('expected', [bad(1, 'x')], { expectedStatus: 'failed' }), 'expected-failure'],
    ['unexpected is failed', test('unexpected', [bad(1, 'x')]), 'failed'],
    ['flaky stays flaky', test('flaky', [bad(1, 'x'), ok(1)]), 'flaky'],
    ['skipped stays skipped', test('skipped', []), 'skipped'],
  ];
  for (const [name, t, expected] of cases) {
    it(`maps status: ${name}`, () => assert.equal(testEntries(META, oneTest(t), null)[0].status, expected));
  }
  it('drops a test whose status is not one Playwright uses', () => assert.deepEqual(testEntries(META, oneTest(test('bogus', [ok(1)])), null), []));
  it('records a straight pass with one attempt, its duration and no error', () => {
    const r = byTitle(rows, 'Login > accepts valid user')!;
    assert.deepEqual([r.attempts, r.durationMs, r.wastedMs, r.error, r.fingerprint, r.verdict], [1, 1200, 0, null, null, null]);
  });
  it('records a retried test: two attempts, the last duration, the first attempt as waste, the failed attempt as error', () => {
    const r = byTitle(rows, 'Cart > keeps items after reload')!;
    assert.deepEqual([r.status, r.attempts, r.durationMs, r.wastedMs, r.error], ['flaky', 2, 1500, 2500, 'Timeout 5000ms exceeded']);
  });
  it('keeps only the first line of the error and strips colour codes', () => {
    assert.equal(byTitle(rows, 'Login > rejects wrong password')!.error, "Error: expected 'Epic sadface' but got 'Locked out 42 times'");
  });
  it('falls back to errors[0].message when the result has no error object', () => {
    const t = test('unexpected', [{ status: 'failed', duration: 5, errors: [{ message: '\n  boom\nmore' }] }]);
    assert.equal(testEntries(META, oneTest(t), null)[0].error, 'boom');
  });
  it('gives a skipped test no attempts, no time and no error', () => {
    const r = byTitle(rows, 'Cart > applies coupon')!;
    assert.deepEqual([r.attempts, r.durationMs, r.wastedMs, r.error], [0, 0, 0, null]);
  });
  it('turns backslashes in the file path into slashes and nulls an empty browser', () => {
    const report = { suites: [{ title: 'A', specs: [{ title: 't', file: 'tests\\a.spec.ts', tests: [test('expected', [ok(1)], { projectName: '' })] }] }] };
    const r = testEntries(META, report, null)[0];
    assert.deepEqual([r.file, r.browser], ['tests/a.spec.ts', null]);
  });
  it('gives the triage verdict to the failed row, and null when triage named an unknown verdict or nothing', () => {
    assert.equal(byTitle(rows, 'Login > rejects wrong password')!.verdict, 'product-bug');
    assert.equal(byTitle(rows, 'Cart > keeps items after reload')!.verdict, null);
    assert.equal(testEntries(META, REPORT, 'nonsense')[2].verdict, null);
  });
  it('gives the verdict only to the browser that failed, not to the row that passed', () => {
    const report = { suites: [{ title: 'A', specs: [spec('t', [test('unexpected', [bad(10, 'x')]), test('expected', [ok(10)], { projectName: 'firefox' })])] }] };
    const rows = testEntries(META, report, { failures: [{ test: 'A > t', verdict: 'test-defect' }] });
    assert.equal(byTitle(rows, 'A > t', 'chromium')!.verdict, 'test-defect');
    assert.equal(byTitle(rows, 'A > t', 'firefox')!.verdict, null);
  });
  it('gives no rows for a report that is not an object, or for a meta with no run id', () => {
    for (const junk of [null, 'x', 7, [], {}, { suites: 'no' }]) assert.deepEqual(testEntries(META, junk, null), []);
    assert.deepEqual(testEntries({ ...META, runId: '' }, REPORT, null), []);
  });
  it('keeps at most 5,000 rows', () => {
    const many = { suites: [{ title: 'A', specs: Array.from({ length: 5_100 }, (_, i) => spec(`t${i}`, [test('expected', [ok(1)])])) }] };
    assert.equal(testEntries(META, many, null).length, 5_000);
  });
});

describe('fingerprint', () => {
  it('is the same for errors that differ only in a number and a quoted value', () => {
    const a = fingerprint("Timeout 5000ms exceeded waiting for 'button#a1'");
    assert.equal(a, fingerprint("Timeout 30000ms exceeded waiting for 'button#b2'"));
    assert.equal(a, 'timeout 0ms exceeded waiting for "?"');
  });
  it('replaces paths and long hex ids but leaves ordinary words', () => {
    assert.equal(fingerprint('Failed at /home/run/app/a.spec.ts:12 id 9f86d081884c in decade'), 'failed at /path id # in decade');
    assert.equal(fingerprint('Cannot read C:\\Users\\bob\\x.ts'), 'cannot read /path');
  });
  it('is null without an error', () => assert.equal(fingerprint(null), null));
});

describe('cleanTestEntry, parseTestLog, mergeTestLog and serialiseTestLog', () => {
  const good = testEntries(META, REPORT, TRIAGE);
  it('rejects a row with a status outside the five, and anything that is not an object', () => {
    assert.equal(cleanTestEntry({ ...good[0], status: 'weird' }), null);
    assert.equal(cleanTestEntry('x'), null);
  });
  it('rejects a row with an unusable run id, date, project, file or title', () => {
    for (const over of [{ runId: '!!' }, { finishedAt: 'later' }, { project: ' ' }, { file: 3 }, { title: '' }]) assert.equal(cleanTestEntry({ ...good[0], ...over }), null);
  });
  it('re-slugs the project, caps the title and clamps negative numbers', () => {
    const r = cleanTestEntry({ ...good[0], project: 'Swag Labs!', title: 'x'.repeat(500), durationMs: -5 })!;
    assert.deepEqual([r.project, r.title.length, r.durationMs], ['swag-labs', 200, 0]);
  });
  it('reads back what it wrote, skipping blank, damaged and unusable lines', () => {
    const log = `${serialiseTestLog(good)}\n{not json\n${JSON.stringify({ ...good[0], status: 'weird' })}\n`;
    assert.deepEqual(parseTestLog(log), good);
    assert.ok(serialiseTestLog(good).endsWith('\n'));
    assert.equal(serialiseTestLog(good).split('\n').length, good.length + 1);
  });
  const row = (runId: string, finishedAt: string, title: string): TestEntry => ({ ...good[0], runId, finishedAt, title });
  const logged = [row('1', '2026-10-01T00:00:00.000Z', 'a'), row('1', '2026-10-01T00:00:00.000Z', 'b'), row('2', '2026-10-02T00:00:00.000Z', 'c'), row('3', '2026-10-03T00:00:00.000Z', 'd')];
  it('replaces every row of a run that comes in again and puts runs newest first', () => {
    const merged = mergeTestLog(logged, [row('2', '2026-10-02T00:00:00.000Z', 'new')]);
    assert.deepEqual(merged.map((r) => `${r.runId}${r.title}`), ['3d', '2new', '1a', '1b']);
  });
  it('keeps only the newest maxRuns runs, rows within a run in their order', () => {
    assert.deepEqual(mergeTestLog(logged, [], 2).map((r) => r.title), ['d', 'c']);
    assert.deepEqual(mergeTestLog(logged, [], 3).map((r) => r.title), ['d', 'c', 'a', 'b']);
  });
  it('drops whole runs from the oldest end when the rows exceed maxRows, never half a run', () => {
    assert.deepEqual(mergeTestLog(logged, [], 400, 2).map((r) => r.title), ['d', 'c']);
    assert.deepEqual(mergeTestLog(logged, [], 400, 3).map((r) => r.title), ['d', 'c']);
  });
});

// Hand-totalled rows. swag-labs run r1 (Sep 20): one pass 1000, two pass 2000, three fail 3000, four skipped.
// Run r2 (Oct 20): one pass 1000, two fail 2000, three fail 3000, four flaky 500 after 3 attempts, five skipped.
// other-shop run o1 (Oct 25): B one pass 500, B two pass 700, B three fail 900 after 2 attempts.
const NOW = new Date('2026-10-27T00:00:00.000Z');
const base = { project: 'swag-labs', file: 'tests/a.spec.ts', browser: 'chromium', attempts: 1, wastedMs: 0, error: null, fingerprint: null, verdict: null };
const R1 = { runId: 'r1', finishedAt: '2026-09-20T10:00:00.000Z' };
const R2 = { runId: 'r2', finishedAt: '2026-10-20T10:00:00.000Z' };
const O1 = { project: 'other-shop', file: 'tests/b.spec.ts', runId: 'o1', finishedAt: '2026-10-25T10:00:00.000Z' };
const r = (run: object, title: string, status: TestEntry['status'], durationMs: number, over: Partial<TestEntry> = {}): TestEntry =>
  ({ ...base, ...run, title: `${title.startsWith('B') ? '' : 'A > '}${title}`, status, durationMs, ...over }) as TestEntry;
const timeout = (n: number, verdict: TestEntry['verdict']) => ({ error: `timeout ${n}ms exceeded`, fingerprint: 'timeout 0ms exceeded', verdict });
const ROWS: TestEntry[] = [
  r(R1, 'one', 'passed', 1000), r(R1, 'two', 'passed', 2000), r(R1, 'three', 'failed', 3000, timeout(30000, 'flaky')), r(R1, 'four', 'skipped', 0, { attempts: 0 }),
  r(R2, 'one', 'passed', 1000), r(R2, 'two', 'failed', 2000, timeout(5000, 'product-bug')), r(R2, 'three', 'failed', 3000, timeout(5000, null)),
  r(R2, 'four', 'flaky', 500, { attempts: 3, wastedMs: 1500, error: 'locator not found', fingerprint: 'locator not found' }), r(R2, 'five', 'skipped', 0, { attempts: 0 }),
  r(O1, 'B > one', 'passed', 500), r(O1, 'B > two', 'passed', 700),
  r(O1, 'B > three', 'failed', 900, { ...timeout(9000, 'environment'), attempts: 2, wastedMs: 300 }),
];

describe('stats: runs', () => {
  it('totals each run and leaves skipped tests out of the pass rate', () => {
    const [o1, r2, r1] = runTotals(ROWS);
    assert.deepEqual([o1.runId, r2.runId, r1.runId], ['o1', 'r2', 'r1']);
    assert.deepEqual([r1.tests, r1.passed, r1.failed, r1.skipped, r1.passRate, r1.durationMs], [4, 2, 1, 1, 66.7, 6000]);
    assert.deepEqual([r2.tests, r2.passed, r2.failed, r2.flaky, r2.skipped, r2.passRate, r2.durationMs], [5, 1, 2, 1, 1, 50, 6500]);
    assert.equal(o1.passRate, 66.7);
  });
  it('gives a null pass rate when every test was skipped', () => assert.equal(runTotals([r(R1, 'x', 'skipped', 0)])[0].passRate, null));
  it('counts a flaky test and an expected failure as passing in the end', () => {
    assert.equal(passRate([r(R1, 'a', 'flaky', 1), r(R1, 'b', 'expected-failure', 1), r(R1, 'c', 'failed', 1), r(R1, 'd', 'passed', 1)]), 75);
  });
  it('finds the latest and previous run of a project', () => {
    assert.equal(latestRun(ROWS, 'swag-labs')?.runId, 'r2');
    assert.equal(previousRun(ROWS, 'swag-labs')?.runId, 'r1');
    assert.equal(previousRun(ROWS, 'other-shop'), null);
    assert.equal(latestRun(ROWS, 'nobody'), null);
  });
  it('keeps rows from the last N days only', () => {
    assert.equal(inWindow(ROWS, 30, NOW).length, 8);
    assert.deepEqual([...new Set(inWindow(ROWS, 5, NOW).map((x) => x.runId))], ['o1']);
  });
  it('leaves out a row dated after now', () => {
    const tomorrow = r({ runId: 'f1', finishedAt: '2026-10-28T10:00:00.000Z' }, 'future', 'passed', 1);
    assert.deepEqual(inWindow([...ROWS, tomorrow], 30, NOW).map((x) => x.runId).includes('f1'), false);
  });
  it('passRate over all rows is passing in the end over those that ran', () => assert.equal(passRate(ROWS), 60));
});

describe('stats: durations and retries', () => {
  it('percentile is nearest-rank on an unsorted list', () => {
    const values = [50, 20, 15, 40, 35];
    assert.deepEqual([0, 30, 40, 50, 100].map((p) => percentile(values, p)), [15, 20, 20, 35, 50]);
    assert.equal(percentile([], 50), null);
  });
  it('durations are the median and p95 over rows that ran', () => assert.deepEqual(durations(ROWS), { medianMs: 1000, p95Ms: 3000 }));
  it('retries count rows with more than one attempt, those that recovered, extra attempts and wasted time', () => {
    assert.deepEqual(retries(ROWS), { extraAttempts: 3, retried: 2, recovered: 1, successRate: 50, wastedMs: 1800 });
    assert.equal(retries([]).successRate, null);
  });
});

describe('stats: tests', () => {
  const health = testHealth(ROWS);
  it('testHealth sorts lowest pass rate first, tests that never ran last, ties by title', () => {
    assert.deepEqual(health.map((h) => h.title), ['A > three', 'B > three', 'A > two', 'A > four', 'A > one', 'B > one', 'B > two', 'A > five']);
  });
  it('testHealth totals one test across runs and takes the last fields from its newest row', () => {
    const two = health.find((h) => h.title === 'A > two')!;
    assert.deepEqual([two.runs, two.passed, two.failed, two.passRate, two.medianMs, two.lastStatus, two.lastRunId, two.lastError], [2, 1, 1, 50, 2000, 'failed', 'r2', 'timeout 5000ms exceeded']);
    const five = health.find((h) => h.title === 'A > five')!;
    assert.deepEqual([five.passRate, five.medianMs, five.skipped], [null, null, 1]);
  });
  it('slowest orders by median and leaves out tests with no median', () => {
    assert.deepEqual(slowest(health, 2).map((h) => h.title), ['A > three', 'A > two']);
    assert.equal(slowest(health, 20).length, 7);
  });
  it('regressions find the one test that passed last run and failed this run, not one already failing', () => {
    const found = regressions(ROWS, 'swag-labs');
    assert.deepEqual(found.map((x) => [x.title, x.previousRunId, x.latestRunId, x.error]), [['A > two', 'r1', 'r2', 'timeout 5000ms exceeded']]);
    assert.deepEqual(regressions(ROWS, 'other-shop'), []);
  });
  it('flakyTests count a flaky status and a flaky verdict, most flakes first', () => {
    const found = flakyTests(ROWS);
    assert.deepEqual(found.map((x) => [x.title, x.flakes, x.runs]), [['A > four', 1, 2], ['A > three', 1, 2]]);
    assert.equal(found[1].lastFinishedAt, R1.finishedAt);
  });
  it('flakyTests look only at the newest runs of each project', () => assert.deepEqual(flakyTests(ROWS, 1).map((x) => [x.title, x.runs]), [['A > four', 1]]));
  it('distinctTests counts a test once however many runs it is in', () => assert.equal(distinctTests(ROWS), 8));
  it('distinctTests counts the same test in two projects twice', () => {
    const twin = r({ ...O1 }, 'one', 'passed', 1, { file: 'tests/a.spec.ts' });
    assert.equal(distinctTests([r(R1, 'one', 'passed', 1), twin]), 2);
  });
});

describe('stats: failures and pages', () => {
  it('clusters group one fingerprint across tests and runs and sample the newest error', () => {
    const [top, second] = clusters(ROWS);
    assert.deepEqual([top.fingerprint, top.failures, top.tests, top.runs, top.sample], ['timeout 0ms exceeded', 4, 3, 3, 'timeout 9000ms exceeded']);
    assert.deepEqual([second.fingerprint, second.failures], ['locator not found', 1]);
  });
  it('verdicts count failed and flaky rows by what triage said, and signal is real bugs among the classified', () => {
    assert.deepEqual(verdicts(ROWS), { productBug: 1, testDefect: 0, flaky: 1, environment: 1, unclassified: 2, signal: 33.3 });
    assert.equal(verdicts([r(R1, 'a', 'failed', 1)]).signal, null);
  });
  it('trend lists the runs in the window oldest first', () => {
    assert.deepEqual(trend(ROWS, 30, NOW).map((p) => [p.runId, p.passRate, p.tests]), [['r2', 50, 5], ['o1', 66.7, 3]]);
    assert.deepEqual(trend(ROWS, 60, NOW).map((p) => p.runId), ['r1', 'r2', 'o1']);
  });
  it('dailyTrend gives one point for two projects on the same day, with the newest run id', () => {
    const early = r({ runId: 'a1', finishedAt: '2026-10-25T08:00:00.000Z' }, 'x', 'passed', 1);
    const points = dailyTrend([early, ...ROWS.filter((x) => x.runId === 'o1')], 30, NOW);
    assert.deepEqual(points.map((p) => [p.runId, p.finishedAt, p.passRate, p.tests]), [['o1', '2026-10-25T00:00:00.000Z', 75, 4]]);
  });
  it('dailyTrend gives a point per day, oldest first', () => {
    assert.deepEqual(dailyTrend(ROWS, 30, NOW).map((p) => [p.finishedAt.slice(0, 10), p.passRate, p.tests]), [['2026-10-20', 50, 5], ['2026-10-25', 66.7, 3]]);
  });
  it('projects summarise each project, alphabetical', () => {
    const [shop, swagLabs] = projects(ROWS, NOW);
    assert.deepEqual([shop.project, shop.runs, shop.lastRunId, shop.lastPassRate, shop.passRate30d, shop.tests, shop.flaky], ['other-shop', 1, 'o1', 66.7, 66.7, 3, 0]);
    assert.deepEqual([swagLabs.runs, swagLabs.lastRunId, swagLabs.lastPassRate, swagLabs.passRate30d, swagLabs.tests, swagLabs.flaky], [2, 'r2', 50, 50, 5, 1]);
  });
  it('hoursSaved is rows that ran times minutes over 60, one decimal', () => {
    assert.equal(hoursSaved(ROWS, 5), 0.8);
    assert.equal(hoursSaved(ROWS, 60), 10);
    assert.equal(hoursSaved([], 5), 0);
  });
});
