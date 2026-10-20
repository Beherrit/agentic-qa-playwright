import type { Budgets, FormFactor, Regression } from './schema.ts';

/**
 * The numbers the gate judges and how it judges them. Pure functions only, so agents/test/ can check every rule.
 * A `Measure` is one Lighthouse run boiled down; a `PageResult` is the median of several, judged.
 */

export type Measure = { performance: number; lcpMs: number; cls: number; tbtMs: number; fcpMs: number; speedIndexMs: number };
export const METRICS = ['performance', 'lcpMs', 'cls', 'tbtMs', 'fcpMs', 'speedIndexMs'] as const;
export type Metric = (typeof METRICS)[number];

export type Verdict = { metric: Metric; value: number; limit: number; kind: 'budget' | 'regression'; text: string };

/** The middle value; the mean of the two middle ones when the count is even. */
export function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One measure per metric, each the median across runs. */
export function medianMeasure(runs: Measure[]): Measure {
  const out = {} as Measure;
  for (const metric of METRICS) out[metric] = median(runs.map((r) => r[metric]));
  return out;
}

export const UNITS: Record<Metric, (n: number) => string> = {
  performance: (n) => String(Math.round(n)),
  lcpMs: (n) => `${(n / 1000).toFixed(2)} s`,
  cls: (n) => n.toFixed(3),
  tbtMs: (n) => `${Math.round(n)} ms`,
  fcpMs: (n) => `${(n / 1000).toFixed(2)} s`,
  speedIndexMs: (n) => `${(n / 1000).toFixed(2)} s`,
};

const LABELS: Record<Metric, string> = { performance: 'performance score', lcpMs: 'LCP', cls: 'CLS', tbtMs: 'TBT', fcpMs: 'FCP', speedIndexMs: 'speed index' };

/** Which budgets a measure breaks. The score must stay at or above its limit; the rest at or below. */
export function judgeBudgets(m: Measure, budgets: Budgets): Verdict[] {
  const out: Verdict[] = [];
  const over = (metric: Metric, value: number, limit: number) =>
    out.push({ metric, value, limit, kind: 'budget', text: `${LABELS[metric]} ${UNITS[metric](value)}, budget ${UNITS[metric](limit)}` });
  if (m.performance < budgets.performance) over('performance', m.performance, budgets.performance);
  if (m.lcpMs > budgets.lcpMs) over('lcpMs', m.lcpMs, budgets.lcpMs);
  if (m.cls > budgets.cls) over('cls', m.cls, budgets.cls);
  if (m.tbtMs > budgets.tbtMs) over('tbtMs', m.tbtMs, budgets.tbtMs);
  return out;
}

/** How a measure got worse than the baseline, past what the config allows. Better is never a regression. */
export function judgeRegression(m: Measure, base: Measure | null, allowed: Regression): Verdict[] {
  if (!base) return [];
  const out: Verdict[] = [];
  const worse = (metric: Metric, limit: number, text: string) => out.push({ metric, value: m[metric], limit, kind: 'regression', text });
  if (base.performance - m.performance > allowed.score) {
    worse('performance', base.performance - allowed.score, `performance score ${Math.round(m.performance)}, was ${Math.round(base.performance)} (allowed drop ${allowed.score})`);
  }
  const lcpLimit = base.lcpMs * (1 + allowed.lcpPercent / 100);
  if (m.lcpMs > lcpLimit) worse('lcpMs', lcpLimit, `LCP ${UNITS.lcpMs(m.lcpMs)}, was ${UNITS.lcpMs(base.lcpMs)} (+${allowed.lcpPercent}% allowed)`);
  if (m.cls - base.cls > allowed.cls) worse('cls', base.cls + allowed.cls, `CLS ${UNITS.cls(m.cls)}, was ${UNITS.cls(base.cls)} (+${allowed.cls} allowed)`);
  const tbtLimit = base.tbtMs * (1 + allowed.tbtPercent / 100);
  // A baseline of a few milliseconds would make any noise a regression, so the budget is the floor.
  if (m.tbtMs > tbtLimit && m.tbtMs > 50) worse('tbtMs', tbtLimit, `TBT ${UNITS.tbtMs(m.tbtMs)}, was ${UNITS.tbtMs(base.tbtMs)} (+${allowed.tbtPercent}% allowed)`);
  return out;
}

export const pageKey = (route: string, formFactor: FormFactor): string => `${formFactor} ${route}`;
