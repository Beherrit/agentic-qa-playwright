import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fingerprint, LANDED } from '../lib/fingerprint.ts';
import { analysisMd, testsReadyMd } from '../lib/render.ts';
import type { Request, Requirements, Review, Strategy } from '../lib/schemas.ts';
import { planHealth } from '../lib/score.ts';
import { enforceVerdict } from '../stages.ts';

const criterion = (id: string, kind: 'happy' | 'negative' | 'edge') => ({ id, kind, given: 'g', when: 'w', then: 't' });

const requirements: Requirements = {
  title: 'Sort products',
  story: { asA: 'a shopper', iWant: 'to sort', soThat: 'I find things' },
  criteria: [criterion('AC-1', 'happy'), criterion('AC-2', 'negative'), criterion('AC-3', 'edge')],
  assumptions: [],
  outOfScope: [],
  openQuestions: [],
  risk: 'medium',
  riskReason: 'r',
};

const testCase = (id: string, criteria: string[], layer: 'e2e' | 'manual' = 'e2e') => ({
  id,
  title: id,
  criteria,
  technique: 'boundary-values' as const,
  layer,
  layerReason: 'r',
  priority: 'P1' as const,
  persona: 'standard_user',
  steps: ['s'],
  expected: 'e',
});

const strategy = (cases: ReturnType<typeof testCase>[]): Strategy => ({
  existingCoverage: [],
  siteNotes: '',
  contract: [],
  regressionRisks: [],
  cases,
  added: [],
  checklist: [
    { id: 'CK-1', coveredBy: ['TC-1'], note: '' },
    { id: 'CK-2', coveredBy: [], note: 'out of scope' },
  ],
  checklistItems: [
    { id: 'CK-1', mustCover: 'x', why: 'y', weight: 'must' },
    { id: 'CK-2', mustCover: 'x', why: 'y', weight: 'should' },
  ],
  summary: 's',
  health: { score: 0, parts: [] },
});

describe('planHealth', () => {
  it('scores a complete plan from the facts', () => {
    const health = planHealth(requirements, strategy([testCase('TC-1', ['AC-1', 'AC-2']), testCase('TC-2', ['AC-3'])]));
    // 40 (all criteria) + 30 * 2/3 (the must item counts double) + 20 (both unhappy) + 10 (none manual)
    assert.equal(health.score, 90);
  });

  it('marks down missing criteria and manual cases', () => {
    const health = planHealth(requirements, strategy([testCase('TC-1', ['AC-1']), testCase('TC-2', ['AC-2'], 'manual')]));
    // 40 * 2/3 + 30 * 2/3 + 20 * 1/2 + 10 * 1/2
    assert.equal(health.score, Math.round((40 * 2) / 3 + 20 + 10 + 5));
  });

  it('gives nothing for unhappy coverage when the requirement has no unhappy criteria', () => {
    const happyOnly = { ...requirements, criteria: [criterion('AC-1', 'happy')] };
    const health = planHealth(happyOnly, strategy([testCase('TC-1', ['AC-1'])]));
    assert.equal(health.parts.find((p) => p.name.startsWith('Negative'))!.value, 0);
  });
});

describe('enforceVerdict', () => {
  const review = (overrides: Partial<Review>): Review => ({
    verdict: 'approve',
    summary: 's',
    findings: [],
    criteria: [
      { id: 'AC-1', verified: true, comment: '' },
      { id: 'AC-2', verified: true, comment: '' },
    ],
    ...overrides,
  });

  it('keeps a clean approval', () => {
    assert.equal(enforceVerdict(review({}), ['AC-1', 'AC-2']).verdict, 'approve');
  });

  it('turns an approval with a major finding into a request for changes', () => {
    const findings = [{ severity: 'major' as const, file: 'f', line: 1, issue: 'i', suggestion: 's' }];
    assert.equal(enforceVerdict(review({ findings }), ['AC-1']).verdict, 'request-changes');
  });

  it('turns an approval with an unverified automated criterion into a request for changes', () => {
    const criteria = [
      { id: 'AC-1', verified: true, comment: '' },
      { id: 'AC-2', verified: false, comment: 'asserts nothing' },
    ];
    assert.equal(enforceVerdict(review({ criteria }), ['AC-1', 'AC-2']).verdict, 'request-changes');
  });

  it('does not hold a manual criterion against the tests', () => {
    const criteria = [
      { id: 'AC-1', verified: true, comment: '' },
      { id: 'AC-4', verified: false, comment: 'manual' },
    ];
    assert.equal(enforceVerdict(review({ criteria }), ['AC-1']).verdict, 'approve');
  });

  it('adds a finding for an automated criterion the reviewer skipped', () => {
    const result = enforceVerdict(review({}), ['AC-1', 'AC-2', 'AC-3']);
    assert.equal(result.verdict, 'request-changes');
    assert.match(result.findings.at(-1)!.issue, /AC-3/);
  });
});

describe('triage helpers', () => {
  it('recognises a marked test that now passes', () => {
    assert.ok(LANDED.test('Expected to fail, but passed.'));
    assert.ok(!LANDED.test('expect(locator).toHaveText() failed'));
  });

  it('gives each test a stable fingerprint', () => {
    assert.equal(fingerprint('Cart > the cart starts empty'), fingerprint('Cart > the cart starts empty'));
    assert.notEqual(fingerprint('a'), fingerprint('b'));
    assert.match(fingerprint('a'), /^[0-9a-f]{12}$/);
  });
});

describe('ticket reports', () => {
  const request: Request = {
    key: 'SHOP-12',
    source: 'jira',
    ref: 'SHOP-12',
    url: 'https://acme.atlassian.net/browse/SHOP-12',
    title: 'Sort products',
    body: 'b',
    mode: 'test-first',
  };

  it('says the analysis did not finish when nothing came back', () => {
    assert.match(analysisMd({ request, requirements: null, strategy: null, runUrl: 'https://run' }), /did not finish.*\[See the run\]\(https:\/\/run\)/);
  });

  it('asks the questions that block testing', () => {
    const blocked = { ...requirements, openQuestions: [{ question: 'Which currency?', blocking: true, why: 'w' }] };
    const md = analysisMd({ request, requirements: blocked, strategy: null, runUrl: null });
    assert.match(md, /Not ready to test yet/);
    assert.match(md, /Which currency\?/);
  });

  it('points to the next label when the plan is good, and shows the contract in test-first mode', () => {
    const plan = strategy([testCase('TC-1', ['AC-1', 'AC-2']), testCase('TC-2', ['AC-3'])]);
    plan.health = planHealth(requirements, plan);
    plan.contract = [{ element: 'the sort dropdown', locator: "getByTestId('sort')", exists: false }];
    const md = analysisMd({ request, requirements, strategy: plan, runUrl: null, compact: true });
    assert.match(md, /Ready for tests\.\*\* Plan health 90\/100/);
    assert.match(md, /qa-generate/);
    assert.match(md, /what the tests will look for/);
    assert.match(md, /no, to build/);
    assert.doesNotMatch(md, /<details>/, 'compact reports leave out the long sections');
  });

  it('says the plan is too weak when it scores below the pass mark', () => {
    const plan = strategy([testCase('TC-1', ['AC-1'], 'manual')]);
    plan.health = planHealth(requirements, plan);
    assert.match(analysisMd({ request, requirements, strategy: plan, runUrl: null }), /below the pass mark/);
  });

  it('reports a pull request, failed gates, or a broken run', () => {
    assert.match(testsReadyMd({ request, prUrl: 'https://pr', draft: false, gates: null, runUrl: null }), /https:\/\/pr[\s\S]*test-first/);
    const gates = { passed: false, changed: [], results: [{ name: 'Types', passed: false, summary: 'failed' }] };
    assert.match(testsReadyMd({ request, prUrl: null, draft: false, gates, runUrl: null }), /did not pass the quality gates[\s\S]*\| Types \|/);
    assert.match(testsReadyMd({ request, prUrl: null, draft: false, gates: null, runUrl: 'https://run' }), /did not finish/);
  });
});
