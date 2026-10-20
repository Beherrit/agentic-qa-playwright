import fs from 'node:fs';
import path from 'node:path';
import { launch, loadSetup, pixelDiff, visit, type PerfBrowser, type Visit } from './browser.ts';
import { loadLighthouse, runLighthouse, type Diagnostics, type RunResult } from './lighthouse.ts';
import { crawl, fetchSitemap, planRoutes } from './routes.ts';
import type { FormFactor, PerfConfig } from './schema.ts';
import { judgeBudgets, judgeRegression, medianMeasure, pageKey, type Measure, type Verdict } from './stats.ts';

/**
 * One performance run: find the routes, look at each page with Playwright, measure it with Lighthouse several
 * times, judge the median against the budgets and the last run, and write it all to <out>/. Nothing here asks a
 * model anything; the analyst (analyst.ts) is called afterwards, and only when something failed.
 */

export type PageResult = {
  route: string;
  formFactor: FormFactor;
  url: string;
  /** The median of `runs`, which is what the verdicts judge. */
  measure: Measure;
  runs: Measure[];
  /** From the run closest to the median score. */
  diagnostics: Diagnostics;
  visit: Omit<Visit, 'screenshot'>;
  /** Share of screenshot pixels that changed since the baseline; null without a baseline. */
  pixelDiff: number | null;
  verdicts: Verdict[];
  passed: boolean;
  /** Files under the run's perf folder. */
  files: { report: string | null; screenshot: string | null; lhr: string | null };
};

export type PerfRun = {
  app: string;
  baseUrl: string;
  persona: string;
  startedAt: string;
  finishedAt: string;
  routes: string[];
  discovered: { configured: number; sitemap: number; crawled: number };
  settings: Pick<PerfConfig, 'runs' | 'formFactors' | 'budgets' | 'regression'>;
  pages: PageResult[];
  passed: boolean;
  advisory: boolean;
  lighthouseVersion: string;
  commit: string | null;
  runUrl: string | null;
  baselineFrom: string | null;
};

export type Baseline = { run: PerfRun; dir: string } | null;

export type RunOptions = {
  root: string;
  baseUrl: string;
  appName: string;
  perf: PerfConfig;
  persona: string;
  /** `critical` audits the short list and skips the crawl; a pull request run. */
  scope: 'all' | 'critical';
  out: string;
  baseline: Baseline;
  commit?: string | null;
  runUrl?: string | null;
  log?: (line: string) => void;
};

/** A file name for a page: form factor, then the route with everything unsafe turned into dashes. */
export const fileKey = (route: string, formFactor: FormFactor): string =>
  `${formFactor}-${route.replace(/^\//, '').replace(/\.html?(?=$|\?)/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'home'}`.slice(0, 120);

/** The baseline folder's record of a run, when there is one. */
export function loadBaseline(dir: string | null): Baseline {
  if (!dir) return null;
  const file = path.join(dir, 'latest', 'perf.json');
  if (!fs.existsSync(file)) return null;
  try {
    return { run: JSON.parse(fs.readFileSync(file, 'utf8')) as PerfRun, dir: path.join(dir, 'latest') };
  } catch {
    return null;
  }
}

async function discover(browser: PerfBrowser, o: RunOptions): Promise<{ routes: string[]; discovered: PerfRun['discovered'] }> {
  const configured = o.scope === 'critical' && o.perf.critical.length ? o.perf.critical : o.perf.routes;
  if (o.scope === 'critical' || o.perf.crawl.maxPages === 0) {
    return { routes: planRoutes(configured, [], 0), discovered: { configured: configured.length, sitemap: 0, crawled: 0 } };
  }
  const sitemap = o.perf.crawl.sitemap ? await fetchSitemap(o.baseUrl) : [];
  const fromSitemap = planRoutes(configured, sitemap, o.perf.crawl.maxPages);
  const crawled = fromSitemap.length < configured.length + o.perf.crawl.maxPages ? await crawl(browser.page, o.baseUrl, fromSitemap, o.perf.crawl.maxPages - (fromSitemap.length - configured.length)) : [];
  return { routes: planRoutes(configured, [...sitemap, ...crawled], o.perf.crawl.maxPages), discovered: { configured: configured.length, sitemap: sitemap.length, crawled: crawled.length } };
}

/** The run whose score sits at the median: its diagnostics and report stand for the page. */
const representative = (results: RunResult[], median: Measure): RunResult =>
  [...results].sort((a, b) => Math.abs(a.summary.measure.performance - median.performance) - Math.abs(b.summary.measure.performance - median.performance))[0];

type Audited = { page: PageResult; lighthouseVersion: string };

async function auditPage(browser: PerfBrowser, o: RunOptions, route: string, formFactor: FormFactor, lh: Awaited<ReturnType<typeof loadLighthouse>>): Promise<Audited> {
  const url = new URL(route, o.baseUrl).href;
  const key = fileKey(route, formFactor);
  const log = o.log ?? console.log;
  const seen = await visit(browser.page, url, formFactor);
  const results: RunResult[] = [];
  for (let i = 0; i < o.perf.runs; i += 1) {
    results.push(await runLighthouse(url, formFactor, browser.port, lh));
    log(`  ${pageKey(route, formFactor)} run ${i + 1}/${o.perf.runs}: score ${results[i].summary.measure.performance}, LCP ${Math.round(results[i].summary.measure.lcpMs)} ms`);
  }
  const runs = results.map((r) => r.summary.measure);
  const measure = medianMeasure(runs);
  const rep = representative(results, measure);
  const base = o.baseline?.run.pages.find((p) => p.route === route && p.formFactor === formFactor) ?? null;
  const verdicts = [...judgeBudgets(measure, o.perf.budgets), ...judgeRegression(measure, base?.measure ?? null, o.perf.regression)];

  const files: PageResult['files'] = { report: rep.html ? `reports/${key}.html` : null, screenshot: seen.screenshot ? `screenshots/${key}.png` : null, lhr: `lhr/${key}.json` };
  if (files.report) fs.writeFileSync(path.join(o.out, files.report), rep.html);
  fs.writeFileSync(path.join(o.out, files.lhr!), JSON.stringify(rep.lhr));
  if (files.screenshot) fs.writeFileSync(path.join(o.out, files.screenshot), seen.screenshot!);

  let diff: number | null = null;
  const baseShot = base?.files.screenshot && o.baseline ? path.join(o.baseline.dir, base.files.screenshot) : null;
  if (seen.screenshot && baseShot && fs.existsSync(baseShot)) {
    diff = await pixelDiff(browser.page, fs.readFileSync(baseShot), seen.screenshot);
    if (diff !== null && diff > o.perf.regression.pixels) {
      verdicts.push({ metric: 'performance', value: diff, limit: o.perf.regression.pixels, kind: 'regression', text: `${(diff * 100).toFixed(1)}% of the screenshot changed since the last run (allowed ${o.perf.regression.pixels * 100}%)` });
    }
  }
  const visitRecord = { consoleErrors: seen.consoleErrors, pageErrors: seen.pageErrors, failedRequests: seen.failedRequests, url: seen.url };
  const page = { route, formFactor, url: seen.url || url, measure, runs, diagnostics: rep.summary.diagnostics, visit: visitRecord, pixelDiff: diff, verdicts, passed: verdicts.length === 0, files };
  return { page, lighthouseVersion: rep.summary.lighthouseVersion };
}

export async function runPerf(o: RunOptions): Promise<PerfRun> {
  const log = o.log ?? console.log;
  for (const dir of ['reports', 'lhr', 'screenshots']) fs.mkdirSync(path.join(o.out, dir), { recursive: true });
  const lh = await loadLighthouse();
  const startedAt = new Date().toISOString();
  const browser = await launch(await loadSetup(o.root, o.perf.setup), o.persona, o.baseUrl);
  try {
    const { routes, discovered } = await discover(browser, o);
    log(`Routes: ${discovered.configured} configured, ${discovered.sitemap} from the sitemap, ${discovered.crawled} found by the crawl.`);
    log(`Auditing ${routes.length} route(s) on ${o.perf.formFactors.join(' and ')}, ${o.perf.runs} run(s) each: ${routes.join(', ')}`);
    const pages: PageResult[] = [];
    let lighthouseVersion = '';
    for (const route of routes) {
      for (const formFactor of o.perf.formFactors) {
        const audited = await auditPage(browser, o, route, formFactor, lh);
        pages.push(audited.page);
        lighthouseVersion = audited.lighthouseVersion || lighthouseVersion;
      }
    }
    const run: PerfRun = {
      app: o.appName,
      baseUrl: o.baseUrl,
      persona: o.persona,
      startedAt,
      finishedAt: new Date().toISOString(),
      routes,
      discovered,
      settings: { runs: o.perf.runs, formFactors: o.perf.formFactors, budgets: o.perf.budgets, regression: o.perf.regression },
      pages,
      passed: pages.every((p) => p.passed),
      advisory: !o.perf.required,
      lighthouseVersion,
      commit: o.commit ?? null,
      runUrl: o.runUrl ?? null,
      baselineFrom: o.baseline?.run.finishedAt ?? null,
    };
    fs.writeFileSync(path.join(o.out, 'perf.json'), `${JSON.stringify(run, null, 2)}\n`);
    return run;
  } finally {
    await browser.close();
  }
}
