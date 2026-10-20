import { gatesMd, table } from '../render.ts';
import type { MigrationPlan, Wave } from './types.ts';
import type { WaveOutcome } from './waves.ts';

/**
 * The migration as people read it: a verdict, one line of numbers, then each wave with its mapping and gates.
 * Written to qa-run/migration/migration.md after every wave, so a stopped migration still has a readable state.
 */

export type WaveState = { id: string; status: 'passed' | 'failed' | 'pending'; attempts: number; summary: string; problem?: string };

export type Rollup = { firstTime: number; fixRound: number; failed: number; pending: number; total: number };

/** The numbers a pilot gives: how many waves passed first time, after a fix round, not at all, or are still to run. */
export function rollup(states: WaveState[]): Rollup {
  const out: Rollup = { firstTime: 0, fixRound: 0, failed: 0, pending: 0, total: states.length };
  for (const s of states) {
    if (s.status === 'passed') out[s.attempts > 1 ? 'fixRound' : 'firstTime'] += 1;
    else if (s.status === 'failed') out.failed += 1;
    else out.pending += 1;
  }
  return out;
}

const share = (n: number, total: number): string => (total ? `${Math.round((n / total) * 100)}%` : '-');

export function rollupLines(r: Rollup): string[] {
  const done = r.total - r.pending;
  return [
    `| Passed first time | ${r.firstTime} | ${share(r.firstTime, done)} of the waves run |`,
    `| Passed after a fix round | ${r.fixRound} | ${share(r.fixRound, done)} |`,
    `| Failed, needs a person | ${r.failed} | ${share(r.failed, done)} |`,
    `| Still to run | ${r.pending} | |`,
  ];
}

const md = (value: string): string => value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

export function waveMd(outcome: WaveOutcome): string {
  const { wave, conversion, parity, gates } = outcome;
  const lines = [`### ${wave.name} (${wave.kind}): ${outcome.passed ? 'passed' : 'FAILED'}${outcome.attempts > 1 ? ', after a fix round' : ''}`, '', outcome.summary + '.'];
  if (outcome.markdown) lines.push('', outcome.markdown);
  if (conversion) {
    lines.push('', conversion.summary, '');
    if (conversion.tests.length) {
      lines.push(
        table(
          ['Old test', 'New test', 'Assertions'],
          conversion.tests.map((t) => [`${md(t.source.name)}<br>\`${t.source.file}\``, `${md(t.target.title)}<br>\`${t.target.file}\``, String(t.assertions.length)]),
        ),
      );
    }
    if (conversion.dropped.length) lines.push('', 'Dropped:', ...conversion.dropped.map((d) => `- ${md(d.source.name)} (\`${d.source.file}\`): ${md(d.reason)}`));
    if (conversion.gaps.length) lines.push('', 'For a person to check:', ...conversion.gaps.map((g) => `- ${md(g)}`));
  }
  if (parity) {
    lines.push('', `**Parity: ${parity.passed ? 'every old test and assertion is accounted for' : `${parity.problems.length} problem(s)`}** (${parity.covered} of ${parity.total} old tests mapped, ${parity.mapped} assertions).`);
    if (parity.problems.length) lines.push('', ...parity.problems.map((p) => `- ${md(p)}`));
  }
  if (gates) lines.push('', gatesMd(gates, 4));
  return lines.join('\n');
}

function verdict(plan: MigrationPlan, states: WaveState[], r: Rollup): string {
  const kind = (id: string) => plan.waves.find((w) => w.id === id)?.kind;
  const prerequisite = states.find((s) => s.status === 'failed' && kind(s.id) !== 'suite');
  if (prerequisite) return `**Stopped at the "${prerequisite.id}" wave: ${prerequisite.summary}.** Every suite waits on it.`;
  if (r.failed === 0 && r.pending === 0) return '**Every wave passed. The suite is on Playwright.**';
  const parts = [`${r.firstTime + r.fixRound} of ${r.total} waves passed`, r.failed ? `${r.failed} failed and need a person` : '', r.pending ? `${r.pending} still to run` : ''];
  return `**${parts.filter(Boolean).join('; ')}.**`;
}

export function migrationMd(plan: MigrationPlan, states: WaveState[], sections: string[], source: string): string {
  const r = rollup(states);
  const tests = plan.waves.reduce((n, w) => n + w.tests, 0);
  const rows = plan.waves.map((w: Wave) => {
    const s = states.find((x) => x.id === w.id);
    return [w.id, w.kind, String(w.sources.length), String(w.tests), (w.risks ?? []).join(', ') || '-', s ? `${s.status}${s.attempts > 1 ? ' (fix round)' : ''}` : 'pending'];
  });
  const failed = states.filter((s) => s.status === 'failed');
  return [
    `## Selenium to Playwright: ${plan.language} ${plan.framework}`,
    '',
    verdict(plan, states, r),
    '',
    `${plan.waves.length} wave(s), ${tests} old test(s), from ${source}.`,
    '',
    '| | Waves | |',
    '|---|---:|---|',
    ...rollupLines(r),
    '',
    table(['Wave', 'Kind', 'Files', 'Tests', 'Risks', 'Status'], rows),
    ...(failed.length ? ['', '### Needs a person', '', table(['Wave', 'Why'], failed.map((s) => [s.id, (s.problem ?? s.summary).replace(/\|/g, '\\|')]))] : []),
    '',
    ...sections,
  ].join('\n');
}
