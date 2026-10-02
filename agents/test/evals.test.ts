import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Case, casePassed, evalsMd, evaluate } from '../evals/checks.ts';
import { dryRun, loadCases, loadFixture } from '../evals/harness.ts';
import { ROOT } from '../lib/paths.ts';
import { repoAt } from '../lib/repo.ts';

const repo = repoAt(ROOT);
const cases = loadCases();
const byId = (id: string): Case => cases.find((c) => c.id === id)!;
/** A recorded answer with one thing changed, to prove the case's checks notice. */
const changed = (id: string, change: (answer: Record<string, unknown>) => void): Record<string, unknown> => {
  const answer = structuredClone(loadFixture(id)) as Record<string, unknown>;
  change(answer);
  return answer;
};
const fails = (id: string, answer: unknown): boolean => !casePassed(evaluate(byId(id), answer, repo));

describe('evaluation cases', () => {
  it('has 8 to 10 cases over the writer, the analyst and the technical reviewer', () => {
    assert.ok(cases.length >= 8 && cases.length <= 10, `${cases.length} cases`);
    assert.deepEqual([...new Set(cases.map((c) => c.stage))].sort(), ['draft', 'requirements', 'technical']);
    for (const id of ['clear-wish', 'vague-wish', 'duplicate-wish', 'already-built', 'not-built', 'contradictory-criteria', 'ticket-with-criteria']) {
      assert.ok(byId(id), id);
    }
  });

  it('passes every check against the recorded answers', () => {
    const results = dryRun(cases);
    const failed = results.filter((r) => !casePassed(r));
    assert.deepEqual(failed, [], JSON.stringify(failed, null, 2));
  });
});

describe('the checks catch a wrong answer', () => {
  it('a vague wish answered without a blocking question', () => {
    assert.ok(fails('vague-wish', changed('vague-wish', (a) => ((a.questions as { blocking: boolean }[])[0].blocking = false))));
  });

  it('a clear wish answered with a blocking question, a vague Then or no negative criterion', () => {
    assert.ok(fails('clear-wish', changed('clear-wish', (a) => ((a.questions as unknown[]) = [{ question: 'Why?', blocking: true, why: '' }]))));
    assert.ok(fails('clear-wish', changed('clear-wish', (a) => ((a.criteria as { then: string }[])[0].then = 'it works correctly'))));
    assert.ok(fails('clear-wish', changed('clear-wish', (a) => (a.criteria as { kind: string }[]).forEach((c) => (c.kind = 'happy')))));
  });

  it('the wrong answer to "is it built"', () => {
    assert.ok(fails('already-built', changed('already-built', (a) => (a.built = false))));
    assert.ok(fails('not-built', changed('not-built', (a) => (a.built = true))));
  });

  it('a duplicate that was not noticed', () => {
    assert.ok(fails('duplicate-wish', changed('duplicate-wish', (a) => (a.duplicates = []))));
  });

  it('renumbered or dropped criteria on a ticket that had them', () => {
    assert.ok(fails('ticket-with-criteria', changed('ticket-with-criteria', (a) => ((a.criteria as { id: string }[])[2].id = 'AC-9'))));
  });

  it('a technical review that names a test or a ticket that is not there', () => {
    assert.ok(fails('technical-sort', changed('technical-sort', (a) => ((a.covered as { test: string }[])[0].test = 'a title from memory'))));
    assert.ok(fails('technical-sort', changed('technical-sort', (a) => ((a.related as { ref: string }[])[0].ref = '99'))));
    assert.ok(fails('technical-sort', changed('technical-sort', (a) => (a.touches = []))));
  });

  it('an answer in the wrong shape', () => {
    const result = evaluate(byId('vague-wish'), { title: 'only a title' }, repo);
    assert.match(result.error ?? '', /does not match the draft schema/);
    assert.ok(!casePassed(result));
  });
});

describe('case files', () => {
  const base = { id: 'x', description: 'd', stage: 'draft', input: { wish: 'w' }, checks: [{ check: 'built', value: true }] };

  it('refuses an unknown check, a check for another stage, or a case without its input', () => {
    assert.ok(Case.safeParse(base).success);
    assert.ok(!Case.safeParse({ ...base, checks: [{ check: 'looks-good' }] }).success);
    assert.ok(!Case.safeParse({ ...base, checks: [{ check: 'covered-tests-exist' }] }).success);
    assert.ok(!Case.safeParse({ ...base, input: {} }).success);
    assert.ok(!Case.safeParse({ ...base, stage: 'technical', input: { title: 't', body: 'b' }, checks: [{ check: 'min-touches', min: 1 }] }).success);
  });
});

describe('evaluation report', () => {
  it('opens with the pass rate and lists what failed', () => {
    const md = evalsMd(
      [
        { id: 'a', stage: 'draft', checks: [{ check: 'built', passed: true, detail: '' }] },
        { id: 'b', stage: 'draft', checks: [{ check: 'built', passed: false, detail: 'built is true, false wanted' }] },
      ],
      'live',
    );
    assert.match(md, /^## Agent evaluations \(live agents\)\n\n\*\*Pass rate: 50%\.\*\* 1 of 2 cases passed every check\./);
    assert.match(md, /\| b \| draft \| 0 of 1 \| \*\*fail\*\* \| built: built is true, false wanted \|/);
  });

  it('runs from the command line without an agent, with the documented exit codes', () => {
    const run = (...args: string[]) => spawnSync(process.execPath, [path.join(ROOT, 'agents', 'evals', 'run.ts'), ...args], { cwd: ROOT, encoding: 'utf8' });
    const dry = run('--dry', '--case', 'vague-wish');
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /Pass rate: 100%/);
    assert.equal(run('--dry', '--case', 'no-such-case').status, 2);
    assert.equal(run('--repeat', '0').status, 2);
  });
});
