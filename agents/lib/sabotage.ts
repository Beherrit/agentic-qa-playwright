import type { TestOutcome } from '../gates.ts';
import type { Sabotage } from './schemas.ts';

/**
 * The saboteur breaks the feature under test on purpose, one acceptance criterion at a time, and the gate runs the
 * new tests against each break. A criterion whose tests all stay green while its behaviour is broken has tests that
 * prove nothing. Everything here is pure, so agents/test/ can check it without an agent or a browser.
 */

export type SabotageFault = Sabotage['faults'][number];

/** One run of the new tests against one fault. `visible` is what the tests' fault-probe attachments said, or null when none was attached. */
export type FaultRun = { outcomes: TestOutcome[]; visible: boolean | null };

export type Verdict = 'caught' | 'missed' | 'dud' | 'untested';
export type FaultVerdict = { name: string; criterion: string; what: string; verdict: Verdict; visible: boolean | null; failed: string[] };
export type CriterionStrength = { criterion: string; strength: 'weak' | 'strong' | 'unproven' };

const SLUG = /^[a-z][a-z0-9-]{2,39}$/;

/** Keeps the faults the gate can use, and says why it dropped the others. The agent's word is not taken for any of it. */
export function checkedFaults(
  faults: SabotageFault[],
  criterionIds: string[],
  max = Infinity,
): { kept: SabotageFault[]; dropped: string[] } {
  const kept: SabotageFault[] = [];
  const dropped: string[] = [];
  for (const fault of faults) {
    const name = fault.name || '(no name)';
    if (!criterionIds.includes(fault.criterion)) dropped.push(`${name}: ${fault.criterion || 'no criterion'} is not a criterion of this requirement`);
    else if (!SLUG.test(fault.name)) dropped.push(`${name}: the name is not a slug of 3 to 40 characters`);
    else if (kept.some((k) => k.name === fault.name)) dropped.push(`${name}: the name is used twice`);
    else if (!fault.script.trim()) dropped.push(`${name}: the script is empty`);
    else if (!fault.probe.trim()) dropped.push(`${name}: the probe is empty`);
    else if (kept.length >= max) dropped.push(`${name}: over the limit of ${max} faults`);
    else kept.push(fault);
  }
  return { kept, dropped };
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The files to write, relative to the project root. Each starts with a line saying what it breaks. */
export function faultFiles(faults: SabotageFault[]): { path: string; content: string }[] {
  return faults.map((fault) => ({
    path: `qa-run/faults/${fault.name}.js`,
    content: `// ${fault.criterion}: ${oneLine(fault.what)}\n${fault.script.trimEnd()}\n`,
  }));
}

const tagged = (outcome: TestOutcome, criterion: string): boolean => outcome.tags.some((tag) => tag.replace(/^@/, '') === criterion);

/** Whether the tests' probes saw the breakage: true if any did, false if some were attached and none did, null if none were. */
export function anyVisible(outcomes: TestOutcome[]): boolean | null {
  const seen = outcomes.map((o) => o.probeVisible).filter((v): v is boolean => v !== null);
  return seen.length === 0 ? null : seen.some(Boolean);
}

/**
 * One verdict per fault. A test that is expected to fail says nothing about a fault, so only the others count.
 *   caught    a test for the criterion failed under the fault
 *   missed    none failed, and the breakage was on the page for the tests to see
 *   dud       none failed, and the breakage was never visible: the fault says nothing about the tests
 *   untested  no test carries the criterion's tag
 */
export function verdicts(faults: SabotageFault[], runs: Record<string, FaultRun>): FaultVerdict[] {
  return faults.map((fault) => {
    const run = runs[fault.name] ?? { outcomes: [], visible: null };
    const own = run.outcomes.filter((o) => !o.expectedToFail && tagged(o, fault.criterion));
    const failed = own.filter((o) => o.status === 'unexpected').map((o) => o.title);
    const verdict: Verdict = own.length === 0 ? 'untested' : failed.length ? 'caught' : run.visible === true ? 'missed' : 'dud';
    return { name: fault.name, criterion: fault.criterion, what: fault.what, verdict, visible: run.visible, failed };
  });
}

/** Per criterion: weak if every fault for it was missed, strong if any was caught, unproven otherwise. */
export function criteriaStrength(all: FaultVerdict[]): CriterionStrength[] {
  const ids = [...new Set(all.map((v) => v.criterion))];
  return ids.map((criterion) => {
    const own = all.filter((v) => v.criterion === criterion);
    const strength = own.some((v) => v.verdict === 'caught') ? 'strong' : own.every((v) => v.verdict === 'missed') ? 'weak' : 'unproven';
    return { criterion, strength };
  });
}

const RANK: Record<Verdict, number> = { missed: 0, dud: 1, untested: 2, caught: 3 };
const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The gate's answer. It fails when any fault was missed; a dud or an untested criterion does not block. */
export function sabotageSummary(all: FaultVerdict[]): { passed: boolean; short: string; table: string } {
  const count = (verdict: Verdict): number => all.filter((v) => v.verdict === verdict).length;
  const criteria = new Set(all.map((v) => v.criterion)).size;
  const counts = (['caught', 'missed', 'dud', 'untested'] as const).filter((v) => count(v) > 0 || v !== 'untested').map((v) => `${count(v)} ${v}`);
  const broke = criteria === all.length ? plural(criteria, 'criterion', 'criteria') : `${plural(all.length, 'fault', 'faults')} across ${plural(criteria, 'criterion', 'criteria')}`;
  const rows = [...all]
    .sort((a, b) => RANK[a.verdict] - RANK[b.verdict])
    .map((v) => {
      const visible = v.visible === null ? 'unknown' : v.visible ? 'yes' : 'no';
      const failed = v.failed.length ? v.failed.map(cell).join('<br>') : '-';
      return `| ${cell(v.name)} | ${v.criterion} | ${cell(v.what)} | ${visible} | ${failed} | ${v.verdict === 'missed' ? '**missed**' : v.verdict} |`;
    });
  const table = `| Fault | Breaks | What the app does wrong | Fault visible | Tests that failed | Verdict |\n|---|---|---|---|---|---|\n${rows.join('\n')}`;
  return { passed: count('missed') === 0, short: `broke ${broke}: ${counts.join(', ')}`, table };
}
