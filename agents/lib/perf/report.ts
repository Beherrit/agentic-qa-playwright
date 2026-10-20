import type { PageResult, PerfRun } from './run.ts';
import { pageKey, UNITS } from './stats.ts';

/**
 * The run as people read it: a title, a bold verdict, one line of numbers, then the pages worst first. The same
 * markdown goes to qa-run/perf/perf.md and the job's summary page. Pure, so agents/test/ can check it.
 */

const md = (value: string): string => value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

/** Pages that failed first, then by score, lowest first. */
export const worstFirst = (pages: PageResult[]): PageResult[] =>
  [...pages].sort((a, b) => Number(a.passed) - Number(b.passed) || a.measure.performance - b.measure.performance);

export function verdictLine(run: PerfRun): string {
  const failing = run.pages.filter((p) => !p.passed);
  if (!run.pages.length) return '**No page was audited.**';
  if (!failing.length) return `**Every page is inside its budgets${run.baselineFrom ? ' and no worse than the last run' : ''}.**`;
  const what = run.advisory ? 'advisory: the run goes on' : 'blocking';
  return `**${failing.length} of ${run.pages.length} page audits failed** (${what}).`;
}

export function numbersLine(run: PerfRun): string {
  const scores = run.pages.map((p) => p.measure.performance);
  const lcps = run.pages.map((p) => p.measure.lcpMs);
  const errors = run.pages.reduce((n, p) => n + p.visit.consoleErrors.length + p.visit.pageErrors.length, 0);
  const parts = [
    `${run.routes.length} route(s) on ${run.settings.formFactors.join(' and ')}`,
    `${run.settings.runs} Lighthouse run(s) per page, median judged`,
    scores.length ? `scores ${Math.min(...scores)} to ${Math.max(...scores)}` : '',
    lcps.length ? `worst LCP ${UNITS.lcpMs(Math.max(...lcps))}` : '',
    `${errors} console or page error(s)`,
    run.discovered.crawled || run.discovered.sitemap ? `${run.discovered.sitemap} from the sitemap, ${run.discovered.crawled} crawled` : 'no crawl',
  ];
  return parts.filter(Boolean).join('; ') + '.';
}

function pageRow(p: PageResult): string {
  const problems = p.verdicts.map((v) => v.text);
  const errors = p.visit.consoleErrors.length + p.visit.pageErrors.length;
  const diff = p.pixelDiff === null ? '-' : `${(p.pixelDiff * 100).toFixed(1)}%`;
  return `| ${p.passed ? 'pass' : 'FAIL'} | ${md(pageKey(p.route, p.formFactor))} | ${UNITS.performance(p.measure.performance)} | ${UNITS.lcpMs(p.measure.lcpMs)} | ${UNITS.cls(p.measure.cls)} | ${UNITS.tbtMs(p.measure.tbtMs)} | ${errors} | ${diff} | ${md(problems.join('; ') || '-')} |`;
}

/** What Lighthouse blamed on a failing page, as a short list under the table. */
function diagnosticsLines(p: PageResult): string[] {
  const d = p.diagnostics;
  const out: string[] = [];
  if (d.lcpElement) out.push(`LCP element: \`${md(d.lcpElement)}\``);
  if (d.layoutShifts.length) out.push(`layout shifts: ${d.layoutShifts.map((s) => `\`${md(s.element)}\` (${s.score.toFixed(3)})`).join(', ')}`);
  if (d.renderBlocking.length) out.push(`render-blocking: ${d.renderBlocking.map((r) => `${md(r.url.replace(/^https?:\/\/[^/]+/, ''))} (${Math.round(r.wastedMs)} ms)`).join(', ')}`);
  if (d.unsizedImages.length) out.push(`unsized images: ${d.unsizedImages.map((s) => `\`${md(s)}\``).join(', ')}`);
  if (d.heavyScripts.length) out.push(`main thread: ${d.heavyScripts.map((s) => `${md(s.url.replace(/^https?:\/\/[^/]+/, ''))} (${s.cpuMs} ms)`).join(', ')}`);
  if (d.failed.length) out.push(`failed audits: ${d.failed.map((f) => `${f.id}${f.displayValue ? ` (${md(f.displayValue)})` : ''}`).join(', ')}`);
  if (p.visit.consoleErrors.length) out.push(`console: ${p.visit.consoleErrors.slice(0, 3).map(md).join(' / ')}`);
  if (p.visit.failedRequests.length) out.push(`failed requests: ${p.visit.failedRequests.slice(0, 3).map((r) => `${r.status} ${md(r.url)}`).join(', ')}`);
  if (d.error) out.push(`Lighthouse error: ${md(d.error)}`);
  return out;
}

export function perfMarkdown(run: PerfRun, analysis = ''): string {
  const pages = worstFirst(run.pages);
  const lines = [
    `## Performance: ${run.app}`,
    '',
    verdictLine(run),
    '',
    numbersLine(run),
    '',
    '| | Page | Score | LCP | CLS | TBT | Errors | Changed | Why |',
    '|---|---|---|---|---|---|---|---|---|',
    ...pages.map(pageRow),
  ];
  const failing = pages.filter((p) => !p.passed);
  if (failing.length) {
    lines.push('', '### What Lighthouse points at', '');
    for (const p of failing) {
      const details = diagnosticsLines(p);
      lines.push(`**${md(pageKey(p.route, p.formFactor))}**${p.files.report ? ` ([report](${p.files.report}))` : ''}`, ...details.map((d) => `- ${d}`), '');
    }
  }
  if (analysis) lines.push('', analysis);
  lines.push('', `Budgets: score ≥ ${run.settings.budgets.performance}, LCP ≤ ${UNITS.lcpMs(run.settings.budgets.lcpMs)}, CLS ≤ ${run.settings.budgets.cls}, TBT ≤ ${UNITS.tbtMs(run.settings.budgets.tbtMs)}.${run.baselineFrom ? ` Baseline: the run of ${run.baselineFrom.slice(0, 16).replace('T', ' ')} UTC.` : ' No baseline yet: regressions start with the next run.'}${run.lighthouseVersion ? ` Lighthouse ${run.lighthouseVersion}.` : ''}`);
  return lines.join('\n');
}
