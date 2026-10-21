import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analysisMarkdown, checkFindings, type PerfAnalysis } from '../lib/perf/analyst.ts';
import { dashboardHtml, dashboardMd, tiles } from '../lib/perf/dashboard.ts';
import { buildEntry, cleanEntry, mergeEntries, parseLog } from '../lib/perf/entry.ts';
import { summarize, type Lhr } from '../lib/perf/lighthouse.ts';
import { numbersLine, perfMarkdown, verdictLine } from '../lib/perf/report.ts';
import { normalizeRoute, parseSitemap, planRoutes } from '../lib/perf/routes.ts';
import { fileKey, type PageResult, type PerfRun } from '../lib/perf/run.ts';
import { Budgets, PerfSchema, Regression } from '../lib/perf/schema.ts';
import { judgeBudgets, judgeRegression, median, medianMeasure, type Measure } from '../lib/perf/stats.ts';
import { ConfigSchema } from '../lib/paths.ts';

const BASE = 'https://shop.example';
const good: Measure = { performance: 95, lcpMs: 1800, cls: 0.02, tbtMs: 50, fcpMs: 900, speedIndexMs: 1500 };
const budgets = Budgets.parse({});
const allowed = Regression.parse({});

const page = (over: Partial<PageResult> = {}): PageResult => ({
  route: '/',
  formFactor: 'mobile',
  url: `${BASE}/`,
  measure: good,
  runs: [good, good, good],
  diagnostics: { lcpElement: 'img.hero', layoutShifts: [], renderBlocking: [], unsizedImages: [], thirdParty: [], heavyScripts: [], failed: [], warnings: [], error: null },
  visit: { consoleErrors: [], pageErrors: [], failedRequests: [], url: `${BASE}/` },
  pixelDiff: null,
  verdicts: [],
  passed: true,
  files: { report: 'reports/mobile-home.html', screenshot: null, lhr: 'lhr/mobile-home.json' },
  ...over,
});
const run = (pages: PageResult[], over: Partial<PerfRun> = {}): PerfRun => ({
  app: 'Shop',
  baseUrl: BASE,
  persona: 'standard_user',
  startedAt: '2026-10-19T10:00:00.000Z',
  finishedAt: '2026-10-19T10:20:00.000Z',
  routes: [...new Set(pages.map((p) => p.route))],
  discovered: { configured: 1, sitemap: 0, crawled: 2 },
  settings: { runs: 3, formFactors: ['mobile', 'desktop'], budgets, regression: allowed },
  pages,
  passed: pages.every((p) => p.passed),
  advisory: true,
  lighthouseVersion: '13.5.0',
  commit: 'abc1234',
  runUrl: 'https://github.com/o/r/actions/runs/1',
  baselineFrom: null,
  ...over,
});

describe('perf config', () => {
  it('is off by default and fills in every threshold', () => {
    const perf = ConfigSchema.parse({ app: { name: 'S', baseUrl: BASE, brief: 'b.md' }, conventions: 'c.md', writable: ['tests/'], minPlanScore: 70, stabilityRuns: 1 }).perf;
    assert.equal(perf.enabled, false);
    assert.deepEqual(perf.routes, ['/']);
    assert.equal(perf.budgets.lcpMs, 2500);
    assert.equal(perf.regression.pixels, 0.02);
    assert.equal(perf.runs, 3);
    assert.throws(() => PerfSchema.parse({ runs: 0 }));
    assert.throws(() => PerfSchema.parse({ formFactors: ['tv'] }));
  });
});

describe('routes', () => {
  it('keeps same-origin pages and drops files, other sites, hashes and sign-out links', () => {
    assert.equal(normalizeRoute('/cart.html#top', BASE), '/cart.html');
    assert.equal(normalizeRoute('https://shop.example/item?id=4', BASE), '/item?id=4');
    assert.equal(normalizeRoute('https://cdn.example/a.css', BASE), null);
    assert.equal(normalizeRoute('/logo.png', BASE), null);
    assert.equal(normalizeRoute('/account/logout', BASE), null);
    assert.equal(normalizeRoute('mailto:x@y', BASE), null);
    assert.equal(normalizeRoute('http://', BASE), null);
  });
  it('reads a sitemap and plans the list with the configured routes first and a cap on the rest', () => {
    const xml = '<urlset><url><loc>https://shop.example/</loc></url><url><loc> https://shop.example/a?x=1&amp;y=2 </loc></url><url><loc>https://shop.example/sitemap-2.xml</loc></url><url><loc>https://other.example/</loc></url></urlset>';
    assert.deepEqual(parseSitemap(xml, BASE), ['/', '/a?x=1&y=2']);
    assert.deepEqual(planRoutes(['/', 'cart.html'], ['/', '/a', '/b', '/c'], 2), ['/', '/cart.html', '/a', '/b']);
    assert.deepEqual(planRoutes(['/'], ['/a'], 0), ['/']);
  });
  it('turns a route into a file name', () => {
    assert.equal(fileKey('/', 'mobile'), 'mobile-home');
    assert.equal(fileKey('/inventory-item.html?id=4', 'desktop'), 'desktop-inventory-item-id-4');
    assert.equal(fileKey('/cart.html', 'mobile'), 'mobile-cart');
  });
});

describe('judging', () => {
  it('takes the median, so one noisy run changes nothing', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 4]), 2.5);
    assert.ok(Number.isNaN(median([])));
    const slow = { ...good, lcpMs: 9000 };
    assert.equal(medianMeasure([good, slow, good]).lcpMs, 1800);
  });
  it('fails each budget on its own side', () => {
    assert.deepEqual(judgeBudgets(good, budgets), []);
    const bad = { ...good, performance: 80, lcpMs: 3000, cls: 0.3, tbtMs: 400 };
    assert.deepEqual(judgeBudgets(bad, budgets).map((v) => v.metric), ['performance', 'lcpMs', 'cls', 'tbtMs']);
    assert.match(judgeBudgets(bad, budgets)[1].text, /LCP 3\.00 s, budget 2\.50 s/);
  });
  it('calls a regression only when the change is worse than allowed, and never for an improvement', () => {
    assert.deepEqual(judgeRegression(good, null, allowed), []);
    assert.deepEqual(judgeRegression(good, { ...good, performance: 99, lcpMs: 1600 }, allowed), []);
    const worse = { ...good, performance: 88, lcpMs: 2300, cls: 0.09, tbtMs: 70 };
    assert.deepEqual(judgeRegression(worse, good, allowed).map((v) => v.metric), ['performance', 'lcpMs', 'cls', 'tbtMs']);
    assert.deepEqual(judgeRegression({ ...good, lcpMs: 1200 }, good, allowed), []);
    // Tiny baselines: 10 ms to 40 ms is +300% but not a regression anyone would act on.
    assert.deepEqual(judgeRegression({ ...good, tbtMs: 40 }, { ...good, tbtMs: 10 }, allowed), []);
  });
});

describe('Lighthouse summary', () => {
  const lhr: Lhr = {
    lighthouseVersion: '13.5.0',
    finalDisplayedUrl: `${BASE}/`,
    runWarnings: ['The page loaded too slowly'],
    categories: { performance: { score: 0.734 } },
    audits: {
      'largest-contentful-paint': { id: 'largest-contentful-paint', numericValue: 3210.4, score: 0.4 },
      'cumulative-layout-shift': { id: 'cumulative-layout-shift', numericValue: 0.21, score: 0.3 },
      'total-blocking-time': { id: 'total-blocking-time', numericValue: 410, score: 0.5 },
      'first-contentful-paint': { id: 'first-contentful-paint', numericValue: 1000, score: 0.9 },
      'speed-index': { id: 'speed-index', numericValue: 2000, score: 0.95 },
      'largest-contentful-paint-element': { id: 'largest-contentful-paint-element', score: null, details: { items: [{ items: [{ node: { selector: 'img.hero' } }] }] } },
      'layout-shifts': { id: 'layout-shifts', score: 0, details: { items: [{ node: { selector: 'div.banner' }, score: 0.18 }, { score: 0.03 }] } },
      'render-blocking-resources': { id: 'render-blocking-resources', title: 'Eliminate render-blocking resources', score: 0.2, displayValue: 'Potential savings of 600 ms', details: { items: [{ url: `${BASE}/slow.js`, wastedMs: 612.5 }] } },
      'unsized-images': { id: 'unsized-images', score: 0, details: { items: [{ node: { selector: 'img#late' } }] } },
      'third-party-summary': { id: 'third-party-summary', score: null, scoreDisplayMode: 'informative', details: { items: [{ entity: { text: 'Ads Inc' }, blockingTime: 120, transferSize: 204800 }] } },
      'uses-http2': { id: 'uses-http2', title: 'Use HTTP/2', score: 0.5, scoreDisplayMode: 'binary' },
    },
  };
  it('boils a result down to the metrics and what Lighthouse blamed', () => {
    const s = summarize(lhr);
    assert.deepEqual(s.measure, { performance: 73, lcpMs: 3210.4, cls: 0.21, tbtMs: 410, fcpMs: 1000, speedIndexMs: 2000 });
    assert.equal(s.diagnostics.lcpElement, 'img.hero');
    assert.deepEqual(s.diagnostics.layoutShifts, [{ element: 'div.banner', score: 0.18 }]);
    assert.deepEqual(s.diagnostics.renderBlocking, [{ url: `${BASE}/slow.js`, wastedMs: 612.5 }]);
    assert.deepEqual(s.diagnostics.unsizedImages, ['img#late']);
    assert.deepEqual(s.diagnostics.thirdParty, [{ entity: 'Ads Inc', blockingMs: 120, transferKb: 200 }]);
    assert.deepEqual(s.diagnostics.failed.map((f) => f.id), ['layout-shifts', 'unsized-images', 'render-blocking-resources', 'cumulative-layout-shift', 'largest-contentful-paint', 'total-blocking-time', 'uses-http2']);
    assert.equal(s.diagnostics.warnings.length, 1);
    assert.ok(s.auditIds.includes('render-blocking-resources'));
  });
  it('reads Lighthouse 13, where the diagnostics are insight audits with node items in lists', () => {
    const s = summarize({
      categories: { performance: { score: 0.84 } },
      audits: {
        'largest-contentful-paint': { id: 'largest-contentful-paint', numericValue: 3161 },
        'cumulative-layout-shift': { id: 'cumulative-layout-shift', numericValue: 0.12 },
        'layout-shifts': { id: 'layout-shifts', score: null, scoreDisplayMode: 'notApplicable' },
        'cls-culprits-insight': { id: 'cls-culprits-insight', score: 0, details: { items: [{ type: 'table', items: [{ type: 'node', selector: 'body > main > p:nth-child(3)', score: 0.11 }] }] } },
        'render-blocking-insight': { id: 'render-blocking-insight', score: 0, details: { items: [{ url: `${BASE}/slow.js`, totalBytes: 535, wastedMs: 151 }] } },
        'lcp-breakdown-insight': { id: 'lcp-breakdown-insight', score: 1, scoreDisplayMode: 'informative', details: { items: [{ type: 'table', items: [{ subpart: 'ttfb' }] }, { type: 'node', selector: 'body > main > p' }] } },
        'third-parties-insight': { id: 'third-parties-insight', score: 1, details: { items: [{ entity: 'Ads Inc', transferSize: 2048, mainThreadTime: 30 }] } },
        'bootup-time': { id: 'bootup-time', score: 0, details: { items: [{ url: `${BASE}/slow.js`, total: 2400.35 }, { url: `${BASE}/tiny.js`, total: 3 }] } },
      },
    });
    assert.equal(s.measure.performance, 84);
    assert.equal(s.diagnostics.lcpElement, 'body > main > p');
    assert.deepEqual(s.diagnostics.layoutShifts, [{ element: 'body > main > p:nth-child(3)', score: 0.11 }]);
    assert.deepEqual(s.diagnostics.renderBlocking, [{ url: `${BASE}/slow.js`, wastedMs: 151 }]);
    assert.deepEqual(s.diagnostics.thirdParty, [{ entity: 'Ads Inc', blockingMs: 30, transferKb: 2 }]);
    assert.deepEqual(s.diagnostics.heavyScripts, [{ url: `${BASE}/slow.js`, cpuMs: 2400 }]);
  });
});

describe('the analyst is checked', () => {
  const failing = [page({ route: '/cart.html', passed: false, verdicts: [{ metric: 'cls', value: 0.3, limit: 0.1, kind: 'budget', text: 'CLS 0.300, budget 0.100' }] })];
  const ids = new Map([['mobile /cart.html', new Set(['layout-shifts', 'unsized-images'])]]);
  const finding = (over: Partial<PerfAnalysis['findings'][number]>) => ({ route: '/cart.html', formFactor: 'mobile' as const, cause: 'The banner has no size.', auditIds: ['unsized-images'], evidence: 'img#late in unsized-images', confidence: 'high' as const, action: 'Give the banner width and height.', ...over });
  it('drops findings about pages that passed or audits the report does not have', () => {
    const analysis: PerfAnalysis = { findings: [finding({}), finding({ auditIds: ['made-up-audit'] }), finding({ route: '/' })], unattributed: [] };
    const checked = checkFindings(analysis, failing, ids);
    assert.equal(checked.kept.length, 1);
    assert.deepEqual(checked.dropped, ['mobile /cart.html: cites audits the report does not have (made-up-audit)', 'mobile /: not a failing page']);
    const text = analysisMarkdown(checked, analysis);
    assert.match(text, /\*\*mobile \/cart\.html\*\* \(high\): The banner has no size/);
    assert.match(text, /Dropped 2 finding/);
  });
});

describe('the report and the page', () => {
  const bad = page({ route: '/cart.html', formFactor: 'desktop', measure: { ...good, cls: 0.3 }, passed: false, pixelDiff: 0.051, verdicts: [{ metric: 'cls', value: 0.3, limit: 0.1, kind: 'budget', text: 'CLS 0.300, budget 0.100' }], visit: { consoleErrors: ['boom'], pageErrors: [], failedRequests: [], url: `${BASE}/cart.html` } });
  const r = run([page(), bad]);
  it('leads with the verdict and puts the failing page first', () => {
    assert.equal(verdictLine(r), '**1 of 2 page audits failed** (advisory: the run goes on).');
    assert.match(numbersLine(r), /2 route\(s\) on mobile and desktop; 3 Lighthouse run\(s\) per page/);
    const md = perfMarkdown(r, '### What the analyst attributes\n\nNothing.');
    const rows = md.split('\n').filter((l) => l.startsWith('| pass') || l.startsWith('| FAIL'));
    assert.match(rows[0], /^\| FAIL \| desktop \/cart\.html \| 95 \| 1\.80 s \| 0\.300 \| 50 ms \| 1 \| 5\.1% \| CLS 0\.300, budget 0\.100 \|/);
    assert.match(md, /What the analyst attributes/);
    assert.match(md, /No baseline yet/);
  });
  it('records a run as one checked line and renders it with nothing unescaped', () => {
    const entry = buildEntry(r, { runId: '42', runUrl: r.runUrl });
    assert.equal(entry.pages.length, 2);
    const back = parseLog(`${JSON.stringify(entry)}\nnot json\n${JSON.stringify({ runId: '<x>', finishedAt: 'never' })}\n`);
    assert.equal(back.length, 1);
    assert.deepEqual(back[0].pages[1].failures, ['CLS 0.300, budget 0.100']);
    const hostile = cleanEntry({ runId: 'a/../b', finishedAt: '2026-10-19T00:00:00Z', pages: [{ route: '<script>', formFactor: 'mobile', performance: 900, report: '../../etc/passwd' }] });
    assert.equal(hostile?.runId, 'a..b');
    assert.equal(hostile?.pages[0].performance, 100);
    assert.equal(hostile?.pages[0].report, null);
    const merged = mergeEntries([entry], { ...entry, passed: true });
    assert.equal(merged.length, 1);
    const html = dashboardHtml([entry, { ...entry, runId: '41', finishedAt: '2026-10-18T10:00:00.000Z' }], 'Shop <b>');
    assert.ok(!html.includes('Shop <b>'));
    assert.match(html, /<title>Performance: Shop &lt;b&gt;<\/title>/);
    assert.match(html, /desktop \/cart\.html/);
    assert.match(html, /href="reports\/mobile-home\.html"/);
    assert.match(html, /<polyline/);
    assert.match(html, /<th scope="col" title="Largest Contentful Paint: [^"]+">LCP<\/th>/);
    assert.match(html, /<details class="legend"><summary>What the columns mean<\/summary><dl><dt>Result<\/dt>/);
    assert.match(html, /<dt>Run<\/dt><dd>The GitHub Actions run/);
    assert.ok(!/<script/.test(html));
    assert.deepEqual(tiles(entry, [entry])[1], ['1', 'failing budgets or regressed']);
    assert.match(dashboardMd([entry], 'Shop'), /\| FAIL \| desktop \/cart\.html \| 95 \|/);
    assert.match(dashboardMd([entry], 'Shop'), /\n- \*\*LCP\*\*: Largest Contentful Paint/);
    assert.match(dashboardMd([], 'Shop'), /No runs recorded yet/);
  });
});
