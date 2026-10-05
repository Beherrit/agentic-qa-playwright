import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TestOutcome } from '../gates.ts';
import { anyVisible, checkedFaults, criteriaStrength, faultFiles, sabotageSummary, verdicts, type FaultRun, type SabotageFault } from '../lib/sabotage.ts';

const fault = (name: string, criterion: string, over: Partial<SabotageFault> = {}): SabotageFault => ({
  name,
  criterion,
  what: `the app breaks ${criterion}`,
  script: 'new MutationObserver(() => {}).observe(document, { childList: true });',
  probe: 'true',
  routes: [],
  ...over,
});

const outcome = (title: string, tags: string[], status = 'expected', over: Partial<TestOutcome> = {}): TestOutcome => ({
  file: 'tests/x.spec.ts',
  title,
  tags,
  status,
  expectedToFail: false,
  reasons: [],
  errors: [],
  probeVisible: null,
  ...over,
});

const run = (outcomes: TestOutcome[], visible: boolean | null): FaultRun => ({ outcomes, visible });

describe('checkedFaults', () => {
  const ids = ['AC-1', 'AC-2', 'AC-3'];

  it('keeps a good fault and drops what the gate cannot use, with a reason each', () => {
    const { kept, dropped } = checkedFaults(
      [
        fault('badge-never-shows', 'AC-1'),
        fault('not-a-criterion', 'AC-9'),
        fault('Bad_Name', 'AC-2'),
        fault('ab', 'AC-2'),
        fault('badge-never-shows', 'AC-3'),
        fault('empty-script', 'AC-2', { script: '  ' }),
        fault('empty-probe', 'AC-2', { probe: '' }),
      ],
      ids,
    );
    assert.deepEqual(kept.map((f) => f.name), ['badge-never-shows']);
    assert.equal(dropped.length, 6);
    assert.match(dropped[0], /AC-9 is not a criterion/);
    assert.match(dropped[1], /not a slug/);
    assert.match(dropped[3], /used twice/);
    assert.match(dropped[4], /script is empty/);
    assert.match(dropped[5], /probe is empty/);
  });

  it('stops at the limit', () => {
    const { kept, dropped } = checkedFaults([fault('first-fault', 'AC-1'), fault('second-fault', 'AC-2')], ids, 1);
    assert.deepEqual(kept.map((f) => f.name), ['first-fault']);
    assert.match(dropped[0], /over the limit of 1/);
  });
});

describe('faultFiles', () => {
  it('writes one file per fault, led by a line that names the criterion and what is wrong', () => {
    const [file] = faultFiles([fault('sort-ignores-choice', 'AC-3', { what: 'Sorting\nignores the choice.', script: 'doIt();\n\n' })]);
    assert.equal(file.path, 'qa-run/faults/sort-ignores-choice.js');
    assert.equal(file.content, '// AC-3: Sorting ignores the choice.\ndoIt();\n');
  });
});

describe('verdicts', () => {
  const caught = fault('caught-one', 'AC-1');
  const missed = fault('missed-one', 'AC-2');
  const dud = fault('dud-one', 'AC-3');
  const untested = fault('untested-one', 'AC-4');

  const all = verdicts([caught, missed, dud, untested], {
    'caught-one': run([outcome('a', ['REQ-1', 'AC-1'], 'unexpected'), outcome('b', ['REQ-1', 'AC-1'])], true),
    'missed-one': run([outcome('c', ['REQ-1', '@AC-2'])], true),
    'dud-one': run([outcome('d', ['REQ-1', 'AC-3'])], false),
    'untested-one': run([outcome('e', ['REQ-1', 'AC-1'])], true),
  });

  it('caught when a test for the criterion failed', () => {
    assert.equal(all[0].verdict, 'caught');
    assert.deepEqual(all[0].failed, ['a']);
  });

  it('missed when none failed and the breakage was visible, with or without the @ in the tag', () => {
    assert.equal(all[1].verdict, 'missed');
  });

  it('dud when none failed and the breakage was not visible, or no probe said anything', () => {
    assert.equal(all[2].verdict, 'dud');
    const unknown = verdicts([dud], { 'dud-one': run([outcome('d', ['AC-3'])], null) });
    assert.equal(unknown[0].verdict, 'dud');
  });

  it('untested when no test carries the criterion', () => {
    assert.equal(all[3].verdict, 'untested');
  });

  it('ignores tests that are expected to fail, and tests for other criteria', () => {
    const [v] = verdicts([caught], {
      'caught-one': run([outcome('x', ['AC-1'], 'unexpected', { expectedToFail: true }), outcome('y', ['AC-2'], 'unexpected')], true),
    });
    assert.equal(v.verdict, 'untested');
  });

  it('a fault that never ran is untested', () => {
    assert.equal(verdicts([caught], {})[0].verdict, 'untested');
  });

  it('rolls up per criterion: weak when every fault was missed, strong when any was caught, unproven otherwise', () => {
    const faults = [fault('one-a', 'AC-1'), fault('one-b', 'AC-1'), fault('two-a', 'AC-2'), fault('two-b', 'AC-2'), fault('three-a', 'AC-3'), fault('three-b', 'AC-3')];
    const t = (id: string) => outcome('t', [id]);
    const f = (id: string) => outcome('t', [id], 'unexpected');
    const rolled = criteriaStrength(
      verdicts(faults, {
        'one-a': run([t('AC-1')], true),
        'one-b': run([t('AC-1')], true),
        'two-a': run([t('AC-2')], true),
        'two-b': run([f('AC-2')], true),
        'three-a': run([t('AC-3')], true),
        'three-b': run([t('AC-3')], false),
      }),
    );
    assert.deepEqual(rolled, [
      { criterion: 'AC-1', strength: 'weak' },
      { criterion: 'AC-2', strength: 'strong' },
      { criterion: 'AC-3', strength: 'unproven' },
    ]);
  });
});

describe('sabotageSummary', () => {
  const v = (name: string, criterion: string, verdict: 'caught' | 'missed' | 'dud' | 'untested', failed: string[] = []) => ({
    name,
    criterion,
    what: 'it | breaks',
    verdict,
    visible: verdict === 'dud' ? false : verdict === 'untested' ? null : true,
    failed,
  });

  it('counts the verdicts and fails when a fault was missed', () => {
    const rows = [v('a', 'AC-1', 'caught'), v('b', 'AC-2', 'caught'), v('c', 'AC-3', 'caught'), v('d', 'AC-4', 'caught'), v('e', 'AC-5', 'missed'), v('f', 'AC-6', 'dud')];
    const { passed, short } = sabotageSummary(rows);
    assert.equal(passed, false);
    assert.equal(short, 'broke 6 criteria: 4 caught, 1 missed, 1 dud');
  });

  it('passes with duds and untested criteria, and says so', () => {
    const { passed, short } = sabotageSummary([v('a', 'AC-1', 'caught'), v('b', 'AC-2', 'untested')]);
    assert.equal(passed, true);
    assert.equal(short, 'broke 2 criteria: 1 caught, 0 missed, 0 dud, 1 untested');
  });

  it('counts faults and criteria apart when a criterion has two faults', () => {
    assert.match(sabotageSummary([v('a', 'AC-1', 'caught'), v('b', 'AC-1', 'dud')]).short, /^broke 2 faults across 1 criterion: /);
  });

  it('lists missed rows first and escapes pipes in the cells', () => {
    const { table } = sabotageSummary([v('a', 'AC-1', 'caught', ['Cart > counts']), v('b', 'AC-2', 'missed'), v('c', 'AC-3', 'dud')]);
    const lines = table.split('\n');
    assert.equal(lines[0], '| Fault | Breaks | What the app does wrong | Fault visible | Tests that failed | Verdict |');
    assert.equal(lines[2], '| b | AC-2 | it \\| breaks | yes | - | **missed** |');
    assert.match(lines[3], /^\| c \| AC-3 .* \| no \| - \| dud \|$/);
    assert.match(lines[4], /^\| a \| AC-1 .* \| Cart > counts \| caught \|$/);
  });
});

describe('anyVisible', () => {
  it('is true if any test saw the breakage, false if some probes ran and none did, null if none ran', () => {
    assert.equal(anyVisible([outcome('a', [], 'expected', { probeVisible: false }), outcome('b', [], 'expected', { probeVisible: true })]), true);
    assert.equal(anyVisible([outcome('a', [], 'expected', { probeVisible: false }), outcome('b', [])]), false);
    assert.equal(anyVisible([outcome('a', [])]), null);
    assert.equal(anyVisible([]), null);
  });
});
