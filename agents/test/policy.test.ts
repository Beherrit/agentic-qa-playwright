import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bigItem } from '../lib/big-item.ts';
import { beyondPolicy, DEFAULT_POLICY, policyOf } from '../lib/policy.ts';
import { escalations, nearLimit } from '../lib/report.ts';

describe('role policies', () => {
  it('lets a stage give a role less than its policy, never more', () => {
    assert.deepEqual(beyondPolicy('code-reviewer', { access: 'read', browser: null, maxTurns: 10 }), []);
    assert.deepEqual(beyondPolicy('saboteur', { access: 'read', browser: 'look' }), []);
    assert.deepEqual(beyondPolicy('code-reviewer', { access: 'write', browser: 'break', maxTurns: 99, readDirs: ['/elsewhere'] }), [
      'write access',
      'the break browser (at most none)',
      '99 turns (at most 30)',
      'other repositories',
    ]);
    assert.deepEqual(beyondPolicy('technical-reviewer', { access: 'read', browser: 'test' }), ['the test browser (at most look)']);
    // The architect may read the other layers' checkouts; an empty list is no request at all.
    assert.deepEqual(beyondPolicy('test-architect', { access: 'read', browser: 'look', readDirs: ['/work/web'] }), []);
    assert.deepEqual(beyondPolicy('plan-critic', { access: 'read', browser: null, readDirs: [] }), []);
  });

  it('gives a role nobody listed the least', () => {
    assert.deepEqual(policyOf('a-new-role'), DEFAULT_POLICY);
    assert.deepEqual(beyondPolicy('a-new-role', { access: 'write', browser: 'look' }), ['write access', 'the look browser (at most none)']);
  });
});

describe('big items', () => {
  const settings = { criteria: 10, highRisk: true };
  const criteria = (n: number): unknown[] => Array.from({ length: n });
  it('is a big item at the criteria count or at high risk, and says why', () => {
    assert.equal(bigItem({ criteria: criteria(4), risk: 'medium' }, settings), null);
    assert.equal(bigItem({ criteria: criteria(10), risk: 'low' }, settings), '10 criteria (10 or more)');
    assert.equal(bigItem({ criteria: criteria(12), risk: 'high' }, settings), '12 criteria (10 or more) and high ticket risk');
    assert.equal(bigItem({ criteria: criteria(3), risk: 'high' }, { criteria: 10, highRisk: false }), null);
    assert.equal(bigItem(null, settings), null);
  });
});

describe('turn limits in the report', () => {
  it('flags a call that used nine tenths of its turns', () => {
    const near = { role: 'automation-engineer', turns: 72, maxTurns: 80, seconds: 1, costUsd: 0, outcome: 'ok' as const };
    assert.equal(nearLimit(near), true);
    assert.equal(nearLimit({ ...near, turns: 71 }), false);
    assert.equal(nearLimit({ ...near, maxTurns: undefined }), false);
    assert.match(escalations([near]).join(), /used 72 of its 80 turns/);
    // The nudge for a forgotten answer runs under its own limit.
    assert.equal(nearLimit({ ...near, turns: 81, nudgeTurns: 3 }), true);
    assert.match(escalations([{ ...near, turns: 81, nudgeTurns: 3 }]).join(), /used 78 of its 80 turns/);
    assert.equal(nearLimit({ ...near, turns: 74, nudgeTurns: 3 }), false);
  });
});

describe('the budget of one call', async () => {
  const { callBudget } = await import('../lib/agent.ts');
  it('is the smaller of the run\'s remainder and the tier\'s cap, less what an earlier attempt spent', () => {
    assert.equal(callBudget(null, null), null);
    assert.equal(callBudget(12, null), 12);
    assert.equal(callBudget(null, 5), 5);
    assert.equal(callBudget(12, 5), 5);
    assert.equal(callBudget(3, 5), 3);
    // A fallback after a first attempt that spent 2 of a 5 cap gets 3, even with the run's 12 left.
    assert.equal(callBudget(12, 5, 2), 3);
    assert.equal(callBudget(12, 5, 7), 0);
  });
});
