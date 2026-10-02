import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { faultFromEnv, faultOf, targetEnv } from '../lib/fault.ts';
import { TargetSchema } from '../lib/paths.ts';

describe('fault injection', () => {
  const env = TargetSchema.parse({ name: 'problem_user', env: { SAUCE_USER: 'problem_user' } });
  const fault = TargetSchema.parse({
    name: 'no-badge',
    initScript: 'fixtures/faults/no-badge.js',
    routes: [{ url: '**/api/cart', status: 500, body: '{}' }, { url: '**/analytics/**', abort: true }],
  });

  it('a target that is only variables carries no fault', () => {
    assert.equal(faultOf(env), null);
    assert.deepEqual(targetEnv(env), { SAUCE_USER: 'problem_user' });
  });

  it('a fault travels to the suite as QA_FAULT, next to the variables', () => {
    const out = targetEnv(fault);
    assert.deepEqual(Object.keys(out), ['QA_FAULT']);
    assert.deepEqual(faultFromEnv(out.QA_FAULT), {
      initScript: 'fixtures/faults/no-badge.js',
      routes: [
        { url: '**/api/cart', abort: false, status: 500, body: '{}' },
        { url: '**/analytics/**', abort: true },
      ],
    });
  });

  it('the fixture ignores anything that is not a fault', () => {
    assert.equal(faultFromEnv(undefined), null);
    assert.equal(faultFromEnv(''), null);
    assert.equal(faultFromEnv('not json'), null);
    assert.equal(faultFromEnv('{"routes":[{"nope":1}]}'), null);
    assert.deepEqual(faultFromEnv('{"routes":[{"url":"**/x"}]}'), { routes: [{ url: '**/x', abort: false }] });
  });
});
