import type { FormFactor } from './schema.ts';
import type { Measure } from './stats.ts';

/**
 * One Lighthouse run against a Chromium that Playwright launched, and the small summary the gate keeps of it.
 * Lighthouse attaches to the browser's debugging port, so it sees the same cookies the sign-in left: pages behind
 * a login are audited as the signed-in user sees them. The summary is pure, so agents/test/ checks it on a fixture.
 */

export type Item = Record<string, unknown>;
export type Audit = {
  id: string;
  title?: string;
  score?: number | null;
  scoreDisplayMode?: string;
  numericValue?: number;
  displayValue?: string;
  details?: { items?: Item[] };
};
/** The parts of a Lighthouse result this module reads. The real object has far more. */
export type Lhr = {
  requestedUrl?: string;
  finalDisplayedUrl?: string;
  lighthouseVersion?: string;
  runWarnings?: string[];
  runtimeError?: { code: string; message: string };
  categories: { performance?: { score: number | null } };
  audits: Record<string, Audit>;
};

export type Diagnostics = {
  lcpElement: string | null;
  layoutShifts: { element: string; score: number }[];
  renderBlocking: { url: string; wastedMs: number }[];
  unsizedImages: string[];
  thirdParty: { entity: string; blockingMs: number; transferKb: number }[];
  /** Scripts that kept the main thread busy for 100 ms or more (bootup-time), heaviest first. */
  heavyScripts: { url: string; cpuMs: number }[];
  /** Every performance audit that did not pass, worst first: what a developer would open the full report for. */
  failed: { id: string; title: string; score: number; displayValue: string }[];
  warnings: string[];
  error: string | null;
};
export type Summary = { measure: Measure; diagnostics: Diagnostics; auditIds: string[]; lighthouseVersion: string; finalUrl: string };

const MAX_ITEMS = 10;
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const items = (audit: Audit | undefined): Item[] => (Array.isArray(audit?.details?.items) ? audit.details.items.slice(0, 50) : []);
const selector = (item: Item): string => {
  const node = item.node as Item | undefined;
  return str(node?.selector) || str(node?.snippet) || str(item.url);
};

/**
 * Every element an audit's details name, in order. Lighthouse 12 puts them under `node` in table rows; the 13
 * insight audits put `{type: "node", selector}` items in lists, sometimes inside a nested table. Both are read.
 */
function nodes(audit: Audit | undefined): Item[] {
  const out: Item[] = [];
  const walk = (list: Item[], depth: number) => {
    for (const item of list) {
      if (item.node) out.push(item);
      else if (item.type === 'node' && typeof item.selector === 'string') out.push({ node: item, score: item.score });
      if (depth < 2 && Array.isArray(item.items)) walk(item.items as Item[], depth + 1);
    }
  };
  walk(items(audit), 0);
  return out;
}

/** The first audit of the list that exists in this report: the 13 insight name, then the older name. */
const pick = (a: Record<string, Audit>, ...ids: string[]): Audit | undefined => ids.map((id) => a[id]).find(Boolean);

export function summarize(lhr: Lhr): Summary {
  const a = lhr.audits;
  const metric = (id: string) => num(a[id]?.numericValue);
  const measure: Measure = {
    performance: Math.round(num(lhr.categories.performance?.score) * 100),
    lcpMs: metric('largest-contentful-paint'),
    cls: metric('cumulative-layout-shift'),
    tbtMs: metric('total-blocking-time'),
    fcpMs: metric('first-contentful-paint'),
    speedIndexMs: metric('speed-index'),
  };
  const failed = Object.values(a)
    .filter((audit) => typeof audit.score === 'number' && audit.score < 0.9 && audit.scoreDisplayMode !== 'informative' && audit.scoreDisplayMode !== 'manual')
    .sort((x, y) => (x.score ?? 1) - (y.score ?? 1))
    .slice(0, 15)
    .map((audit) => ({ id: audit.id, title: str(audit.title), score: audit.score ?? 0, displayValue: str(audit.displayValue) }));
  const shifts = nodes(pick(a, 'layout-shifts', 'layout-shift-elements'));
  const diagnostics: Diagnostics = {
    lcpElement: nodes(pick(a, 'largest-contentful-paint-element', 'lcp-breakdown-insight')).map(selector).find(Boolean) ?? null,
    layoutShifts: (shifts.length ? shifts : nodes(a['cls-culprits-insight'])).slice(0, MAX_ITEMS).map((i) => ({ element: selector(i), score: num(i.score) })),
    renderBlocking: items(pick(a, 'render-blocking-insight', 'render-blocking-resources'))
      .slice(0, MAX_ITEMS)
      .map((i) => ({ url: str(i.url, 300), wastedMs: num(i.wastedMs) })),
    unsizedImages: items(a['unsized-images']).slice(0, MAX_ITEMS).map(selector).filter(Boolean),
    thirdParty: items(pick(a, 'third-parties-insight', 'third-party-summary'))
      .slice(0, MAX_ITEMS)
      .map((i) => ({ entity: str((i.entity as Item)?.text ?? i.entity, 80), blockingMs: num(i.mainThreadTime ?? i.blockingTime), transferKb: Math.round(num(i.transferSize) / 1024) })),
    heavyScripts: items(a['bootup-time'])
      .filter((i) => num(i.total) >= 100)
      .slice(0, 5)
      .map((i) => ({ url: str(i.url, 300), cpuMs: Math.round(num(i.total)) })),
    failed,
    warnings: (lhr.runWarnings ?? []).map((w) => str(w, 300)),
    error: lhr.runtimeError ? `${lhr.runtimeError.code}: ${str(lhr.runtimeError.message, 300)}` : null,
  };
  return { measure, diagnostics, auditIds: Object.keys(a), lighthouseVersion: str(lhr.lighthouseVersion, 20), finalUrl: str(lhr.finalDisplayedUrl ?? lhr.requestedUrl, 500) };
}

type LighthouseModule = {
  default: (url: string, flags: Record<string, unknown>, config?: unknown) => Promise<{ lhr: Lhr; report: string | string[] } | undefined>;
  desktopConfig: unknown;
};

/** The lighthouse package, loaded when first needed: a host that never turns the gate on need not install it. */
export async function loadLighthouse(): Promise<LighthouseModule> {
  try {
    return (await import('lighthouse')) as unknown as LighthouseModule;
  } catch {
    throw new Error('The performance gate needs the lighthouse package: npm install --save-dev lighthouse');
  }
}

export type RunResult = { summary: Summary; lhr: Lhr; html: string };

/**
 * Audits one URL through the browser listening on `port`. Lighthouse's default reset clears the HTTP cache,
 * service workers and cache storage before each run, so every run is a cold load, and leaves cookies and local
 * storage alone, so the sign-in survives. (Turning the reset off would measure the cache Playwright just warmed.)
 */
export async function runLighthouse(url: string, formFactor: FormFactor, port: number, lh: LighthouseModule): Promise<RunResult> {
  const flags = {
    port,
    output: ['json', 'html'],
    onlyCategories: ['performance'],
    // Lighthouse's own log goes nowhere: a failed run still shows up as `runtimeError` in the result and the summary.
    logLevel: 'silent',
    formFactor,
    maxWaitForLoad: 45_000,
  };
  // Lighthouse's trace engine prints a "LanternError" stack straight to the console on some redirected pages and
  // carries on; the result is complete. That one message is dropped for the length of the run, nothing else.
  const consoleError = console.error;
  console.error = (...args: unknown[]) => {
    if (!/LanternError|^\s+at /.test(String(args[0] ?? ''))) consoleError(...args);
  };
  let result;
  try {
    result = await lh.default(url, flags, formFactor === 'desktop' ? lh.desktopConfig : undefined);
  } finally {
    console.error = consoleError;
  }
  if (!result) throw new Error(`Lighthouse returned nothing for ${url}`);
  const html = Array.isArray(result.report) ? (result.report[1] ?? '') : '';
  return { summary: summarize(result.lhr), lhr: result.lhr, html };
}
