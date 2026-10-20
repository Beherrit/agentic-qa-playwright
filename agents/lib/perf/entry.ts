import type { FormFactor } from './schema.ts';
import type { PerfRun } from './run.ts';

/**
 * One small line per performance run, kept in runs.jsonl on the qa-perf branch. Everything read back from the
 * file is checked before use: a string is capped, a number must be finite, and what does not fit is dropped.
 * Pure functions only, so agents/test/ checks them without files.
 */

export type PageEntry = {
  route: string;
  formFactor: FormFactor;
  performance: number;
  lcpMs: number;
  cls: number;
  tbtMs: number;
  passed: boolean;
  /** The verdicts' texts, a few at most. */
  failures: string[];
  errors: number;
  pixelDiff: number | null;
  report: string | null;
};

export type PerfEntry = {
  runId: string;
  runUrl: string;
  commit: string;
  finishedAt: string;
  persona: string;
  passed: boolean;
  advisory: boolean;
  routes: number;
  pages: PageEntry[];
};

const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]+/g;
const MAX_PAGES = 400;
const MAX_FAILURES = 5;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(CONTROL, ' ').trim().slice(0, max) : '');
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const isoDate = (v: unknown): string => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
};

export function buildEntry(run: PerfRun, meta: { runId: string; runUrl?: string | null; commit?: string | null }): PerfEntry {
  return {
    runId: text(meta.runId, 40),
    runUrl: text(meta.runUrl, 300),
    commit: text(meta.commit ?? run.commit, 40),
    finishedAt: isoDate(run.finishedAt) || new Date().toISOString(),
    persona: text(run.persona, 60),
    passed: run.passed,
    advisory: run.advisory,
    routes: run.routes.length,
    pages: run.pages.slice(0, MAX_PAGES).map((p) => ({
      route: text(p.route, 300),
      formFactor: p.formFactor,
      performance: Math.round(num(p.measure.performance)),
      lcpMs: Math.round(num(p.measure.lcpMs)),
      cls: Math.round(num(p.measure.cls) * 1000) / 1000,
      tbtMs: Math.round(num(p.measure.tbtMs)),
      passed: p.passed,
      failures: p.verdicts.slice(0, MAX_FAILURES).map((v) => text(v.text, 200)),
      errors: p.visit.consoleErrors.length + p.visit.pageErrors.length + p.visit.failedRequests.length,
      pixelDiff: p.pixelDiff === null ? null : Math.round(num(p.pixelDiff) * 1000) / 1000,
      report: p.files.report ? text(p.files.report, 200) : null,
    })),
  };
}

function cleanPage(raw: unknown): PageEntry | null {
  if (!isRecord(raw)) return null;
  const route = text(raw.route, 300);
  const formFactor = raw.formFactor === 'desktop' ? 'desktop' : raw.formFactor === 'mobile' ? 'mobile' : null;
  if (!route || !formFactor) return null;
  const report = text(raw.report, 200);
  return {
    route,
    formFactor,
    performance: Math.min(100, Math.max(0, Math.round(num(raw.performance)))),
    lcpMs: Math.max(0, num(raw.lcpMs)),
    cls: Math.max(0, num(raw.cls)),
    tbtMs: Math.max(0, num(raw.tbtMs)),
    passed: raw.passed === true,
    failures: Array.isArray(raw.failures) ? raw.failures.slice(0, MAX_FAILURES).map((f) => text(f, 200)).filter(Boolean) : [],
    errors: Math.max(0, Math.round(num(raw.errors))),
    pixelDiff: raw.pixelDiff === null || raw.pixelDiff === undefined ? null : Math.min(1, Math.max(0, num(raw.pixelDiff))),
    // Only a report inside the branch's own reports folder is ever linked.
    report: /^reports\/[A-Za-z0-9._-]+\.html$/.test(report) ? report : null,
  };
}

/** A usable entry from an untrusted value, or null. */
export function cleanEntry(raw: unknown): PerfEntry | null {
  if (!isRecord(raw)) return null;
  const runId = text(raw.runId, 40).replace(/[^A-Za-z0-9._-]/g, '');
  const finishedAt = isoDate(raw.finishedAt);
  if (!runId || !finishedAt) return null;
  return {
    runId,
    runUrl: text(raw.runUrl, 300),
    commit: text(raw.commit, 40).replace(/[^A-Za-z0-9]/g, ''),
    finishedAt,
    persona: text(raw.persona, 60),
    passed: raw.passed === true,
    advisory: raw.advisory !== false,
    routes: Math.max(0, Math.round(num(raw.routes))),
    pages: Array.isArray(raw.pages) ? raw.pages.slice(0, MAX_PAGES).map(cleanPage).filter((p): p is PageEntry => p !== null) : [],
  };
}

export function parseLog(content: string): PerfEntry[] {
  const out: PerfEntry[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = cleanEntry(JSON.parse(line));
      if (entry) out.push(entry);
    } catch {
      // A damaged line is dropped, not fatal: the rest of the history still renders.
    }
  }
  return out;
}

export const newestFirst = (entries: PerfEntry[]): PerfEntry[] => [...entries].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));

/** Adds a run, replacing an earlier record of the same run id. */
export function mergeEntries(existing: PerfEntry[], entry: PerfEntry): PerfEntry[] {
  return newestFirst([...existing.filter((e) => e.runId !== entry.runId), entry]);
}

export const entryKey = (p: { route: string; formFactor: FormFactor }): string => `${p.formFactor} ${p.route}`;
