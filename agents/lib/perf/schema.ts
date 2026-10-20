import { z } from 'zod';

/**
 * The `perf` section of qa.config.json: which routes Lighthouse audits, how often, and what counts as too slow.
 * Every threshold is a number a person chose; nothing in the gate asks a model what "slow" means.
 */

export const FormFactor = z.enum(['mobile', 'desktop']);
export type FormFactor = z.infer<typeof FormFactor>;

/** The limits one page must stay inside. Lighthouse's own "good" thresholds are the defaults. */
export const Budgets = z.object({
  /** The Lighthouse performance score, 0 to 100. */
  performance: z.number().min(0).max(100).default(90),
  lcpMs: z.number().positive().default(2_500),
  cls: z.number().min(0).default(0.1),
  tbtMs: z.number().positive().default(200),
});
export type Budgets = z.infer<typeof Budgets>;

/** How much worse than the last recorded run a page may get before that alone fails it. */
export const Regression = z.object({
  /** Score points lost. */
  score: z.number().min(0).default(5),
  lcpPercent: z.number().min(0).default(20),
  /** Absolute change in CLS. */
  cls: z.number().min(0).default(0.05),
  tbtPercent: z.number().min(0).default(30),
  /** Share of the screenshot's pixels that may differ from the last run's, 0 to 1. */
  pixels: z.number().min(0).max(1).default(0.02),
});
export type Regression = z.infer<typeof Regression>;

export const PerfSchema = z.object({
  enabled: z.boolean().default(false),
  /** Whether a failed budget or a regression blocks. Off, the gate reports and the run goes on. */
  required: z.boolean().default(false),
  /** Paths, relative to app.baseUrl, always audited. The crawl adds to these. */
  routes: z.array(z.string().min(1)).default(['/']),
  /** The short list a pull request run audits. Empty means the same as `routes`. */
  critical: z.array(z.string().min(1)).default([]),
  crawl: z
    .object({
      /** Follow same-origin links from the routes, this many pages at most. 0 turns the crawl off. */
      maxPages: z.number().int().min(0).max(200).default(20),
      /** Read /sitemap.xml too. */
      sitemap: z.boolean().default(true),
    })
    .prefault({}),
  /** Lighthouse runs per page and form factor. The median is what the gate judges; one run is noise. */
  runs: z.number().int().min(1).max(9).default(3),
  formFactors: z.array(FormFactor).min(1).default(['mobile', 'desktop']),
  budgets: Budgets.prefault({}),
  regression: Regression.prefault({}),
  /**
   * A module the browser runs before the first page: `export default async (page, persona) => { ... }`, signing in
   * as the suite does. Relative to the project root. Without it, pages behind a login are audited signed out.
   */
  setup: z.string().nullable().default(null),
  /** Ask the performance analyst to attribute a failure. Only runs when a budget or a regression fires. */
  analyst: z.boolean().default(true),
});
export type PerfConfig = z.infer<typeof PerfSchema>;
