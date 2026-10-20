import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runAgent } from '../agent.ts';
import { prompt } from '../store.ts';
import { FormFactor } from './schema.ts';
import type { PageResult, PerfRun } from './run.ts';
import { pageKey } from './stats.ts';

/**
 * The one place a model is asked anything about performance, and only after the gate has failed: given the
 * failing pages, what Lighthouse blamed, the last run's numbers and the commits since, say what caused each
 * regression, or say that it cannot. Every claim must name audit ids that exist in the page's own Lighthouse
 * report; a finding that cites one that does not is dropped before anyone reads it.
 */

export const PerfFinding = z.object({
  route: z.string().min(1),
  formFactor: FormFactor,
  /** One sentence: what changed on the page that made the metric worse. */
  cause: z.string().min(1).max(400),
  /** Lighthouse audit ids the cause rests on, e.g. "render-blocking-resources". From the report, not from memory. */
  auditIds: z.array(z.string().min(1)).min(1).max(8),
  /** What in the report or the diff shows it: a file, a URL, an element, a number. */
  evidence: z.string().min(1).max(600),
  confidence: z.enum(['high', 'medium', 'low']),
  /** The one change a developer would make first. */
  action: z.string().min(1).max(300),
});
export const PerfAnalysis = z.object({
  findings: z.array(PerfFinding).max(20),
  /** Failures the evidence does not explain. Saying so is the right answer when it is true. */
  unattributed: z.array(z.object({ route: z.string().min(1), formFactor: FormFactor, why: z.string().min(1).max(300) })).max(20),
});
export type PerfAnalysis = z.infer<typeof PerfAnalysis>;
export type Checked = { kept: PerfAnalysis['findings']; dropped: string[] };

/** Keeps the findings about a page that failed, whose audit ids all exist in that page's report. */
export function checkFindings(analysis: PerfAnalysis, failing: PageResult[], auditIds: Map<string, Set<string>>): Checked {
  const kept: PerfAnalysis['findings'] = [];
  const dropped: string[] = [];
  for (const f of analysis.findings) {
    const key = pageKey(f.route, f.formFactor);
    if (!failing.some((p) => p.route === f.route && p.formFactor === f.formFactor)) {
      dropped.push(`${key}: not a failing page`);
      continue;
    }
    const known = auditIds.get(key);
    const unknown = f.auditIds.filter((id) => !known?.has(id));
    if (unknown.length) {
      dropped.push(`${key}: cites audits the report does not have (${unknown.join(', ')})`);
      continue;
    }
    kept.push(f);
  }
  return { kept, dropped };
}

/** The audit ids each failing page's report holds, read from the full Lighthouse JSON the run kept. */
export function auditIdsFor(out: string, pages: PageResult[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const p of pages) {
    if (!p.files.lhr) continue;
    try {
      const lhr = JSON.parse(fs.readFileSync(path.join(out, p.files.lhr), 'utf8')) as { audits?: Record<string, unknown> };
      map.set(pageKey(p.route, p.formFactor), new Set(Object.keys(lhr.audits ?? {})));
    } catch {
      // No report, no checkable claims: findings about this page are dropped.
    }
  }
  return map;
}

/** The commits between the baseline and this run, when both are known and in this repository. */
export function commitsBetween(root: string, from: string | null, to: string | null): string {
  if (!from || !to || from === to) return '';
  const log = spawnSync('git', ['log', '--oneline', '--no-decorate', `${from}..${to}`], { cwd: root, encoding: 'utf8' });
  const stat = spawnSync('git', ['diff', '--stat', from, to], { cwd: root, encoding: 'utf8' });
  if (log.status !== 0) return '';
  return `${log.stdout.trim().split('\n').slice(0, 40).join('\n')}\n\n${stat.stdout.trim().split('\n').slice(-30).join('\n')}`.trim();
}

function describePage(p: PageResult, base: PageResult | undefined, out: string): string {
  const lines = [
    `### ${pageKey(p.route, p.formFactor)}`,
    `Failed: ${p.verdicts.map((v) => v.text).join('; ')}`,
    `Median now: ${JSON.stringify(p.measure)}`,
    base ? `Median last run: ${JSON.stringify(base.measure)}` : 'No previous run to compare with.',
    `Lighthouse points at: ${JSON.stringify(p.diagnostics)}`,
    base ? `Last run pointed at: ${JSON.stringify(base.diagnostics)}` : '',
    p.visit.consoleErrors.length || p.visit.failedRequests.length ? `Playwright saw: ${JSON.stringify({ consoleErrors: p.visit.consoleErrors, failedRequests: p.visit.failedRequests })}` : '',
    p.files.lhr ? `Full Lighthouse report (JSON): ${path.join(out, p.files.lhr)}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

export function analysisMarkdown(checked: Checked, analysis: PerfAnalysis): string {
  const lines = ['### What the analyst attributes', ''];
  if (!checked.kept.length) lines.push('Nothing with evidence that checks out.');
  for (const f of checked.kept) {
    lines.push(`- **${pageKey(f.route, f.formFactor)}** (${f.confidence}): ${f.cause} Evidence: ${f.evidence} Audits: ${f.auditIds.map((id) => `\`${id}\``).join(', ')}. Do first: ${f.action}`);
  }
  for (const u of analysis.unattributed) lines.push(`- **${pageKey(u.route, u.formFactor)}**: not attributed. ${u.why}`);
  if (checked.dropped.length) lines.push('', `Dropped ${checked.dropped.length} finding(s) whose claims did not check out: ${checked.dropped.join('; ')}.`);
  return lines.join('\n');
}

/** Runs the analyst over the failing pages and returns the checked result as markdown. */
export async function analyse(run: PerfRun, baseline: PerfRun | null, out: string, root: string): Promise<string> {
  const failing = run.pages.filter((p) => !p.passed);
  if (!failing.length) return '';
  const commits = commitsBetween(root, baseline?.commit ?? null, run.commit);
  const task = [
    `App: ${run.app} at ${run.baseUrl}${run.persona ? `, signed in as ${run.persona}` : ''}.`,
    `Budgets: ${JSON.stringify(run.settings.budgets)}. Allowed regression: ${JSON.stringify(run.settings.regression)}.`,
    commits ? `Commits since the last run:\n${commits}` : 'The code that changed is not in this repository (or there is no earlier run), so attribute to what the page does, not to a commit.',
    '',
    ...failing.map((p) => describePage(p, baseline?.pages.find((b) => b.route === p.route && b.formFactor === p.formFactor), out)),
  ].join('\n');
  // The runner logs the call in the ledger itself.
  const { output } = await runAgent({ role: 'performance-analyst', instructions: prompt('performance-analyst'), task, schema: PerfAnalysis, access: 'read', maxTurns: 25 });
  const checked = checkFindings(output, failing, auditIdsFor(out, failing));
  fs.writeFileSync(path.join(out, 'analysis.json'), `${JSON.stringify({ ...output, dropped: checked.dropped }, null, 2)}\n`);
  return analysisMarkdown(checked, output);
}
