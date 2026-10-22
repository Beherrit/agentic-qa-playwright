import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { handoffIn, withHandoff } from '../lib/handoff.ts';
import { agentCard, byTier, escalations, leadMd, runReportMd } from '../lib/report.ts';
import type { RunRecord } from '../lib/store.ts';
import { isModelUnavailable, resolveModel, tierOf } from '../lib/tiers.ts';

describe('model tiers', () => {
  it('runs each role on its tier with the tier\'s fallback', () => {
    assert.deepEqual(resolveModel('code-reviewer', {}, {}), { tier: 'decide', model: 'claude-fable-5-1', fallback: 'claude-opus-5-5', source: 'tier' });
    assert.equal(resolveModel('automation-engineer', {}, {}).model, 'claude-opus-5-5');
    assert.equal(resolveModel('skeptic', {}, {}).model, 'claude-sonnet-5-5');
    // Every fallback is a model the SDK knows.
    assert.equal(resolveModel('skeptic', {}, {}).fallback, 'claude-opus-5-5');
  });

  it('lets a person override, most specific first, and says who did', () => {
    const models = { '*': 'haiku', 'code-reviewer': 'claude-opus-5-5' };
    assert.deepEqual(resolveModel('code-reviewer', { models }, { QA_AGENT_MODEL: 'sonnet' }), {
      tier: 'decide',
      model: 'claude-opus-5-5',
      // A person's choice runs alone: no quiet switch to another model.
      fallback: '',
      source: 'role',
    });
    assert.equal(resolveModel('code-reviewer', { models: { '*': 'haiku' } }, {}).fallback, '');
    assert.equal(resolveModel('skeptic', { models }, { QA_AGENT_MODEL: 'sonnet' }).source, 'all-roles');
    assert.equal(resolveModel('skeptic', {}, { QA_AGENT_MODEL: 'sonnet' }).source, 'QA_AGENT_MODEL');
    assert.deepEqual(resolveModel('plan-reconciler', { tiers: { decide: { model: 'claude-opus-5-5', fallback: '' } } }, {}), {
      tier: 'decide',
      model: 'claude-opus-5-5',
      fallback: '',
      source: 'tier',
    });
  });

  it('runs a role nobody listed as research', () => {
    assert.equal(tierOf('a-new-role'), 'research');
  });

  it('falls back only when the model itself was out of reach', () => {
    assert.equal(isModelUnavailable('API Error: 529 {"type":"overloaded_error"}'), true);
    assert.equal(isModelUnavailable('There\'s an issue with the selected model (claude-fable-5-1). It may not exist or you may not have access to it.'), true);
    assert.equal(isModelUnavailable('{"type":"not_found_error","message":"model: claude-fable-5-1"}'), true);
    assert.equal(isModelUnavailable('Your organization does not have access to the model'), true);
    assert.equal(isModelUnavailable('Invalid API key · Please run /login'), false);
    assert.equal(isModelUnavailable('answered in the wrong shape'), false);
  });
});

describe('the handoff', () => {
  const Answer = z.object({ cases: z.array(z.string()) });
  const handoff = { summary: 'Planned it.', decisions: ['Kept TC-3 at e2e: it needs two pages'], escalations: [], confidence: 'high' as const, confidenceReason: 'Walked every step.' };

  it('is added to an object answer and taken off again by the role\'s own schema', () => {
    const wrapped = withHandoff(Answer);
    const raw = { cases: ['TC-1'], handoff };
    assert.equal(wrapped.safeParse(raw).success, true);
    // Optional where the CLI enforces it, so a forgotten handoff never costs the answer.
    assert.equal(wrapped.safeParse({ cases: [] }).success, true);
    assert.deepEqual(Answer.parse(raw), { cases: ['TC-1'] });
    assert.deepEqual(handoffIn(raw), handoff);
  });

  it('is null when missing or malformed, never an error', () => {
    assert.equal(handoffIn({ cases: [] }), null);
    assert.equal(handoffIn({ handoff: { summary: 1 } }), null);
    assert.equal(handoffIn('text'), null);
  });

  it('leaves a schema that is not an object alone', () => {
    const list = z.array(z.string());
    assert.equal(withHandoff(list), list);
  });
});

describe('the run report', () => {
  const ledger: RunRecord[] = [
    {
      role: 'requirements-analyst',
      turns: 6,
      seconds: 40,
      costUsd: 0.12,
      tier: 'research',
      model: 'claude-sonnet-5-5',
      modelSource: 'tier',
      tokens: { input: 1200, output: 800, cacheRead: 20000, cacheWrite: 3000 },
      outcome: 'ok',
      handoff: {
        summary: 'Wrote six criteria.',
        decisions: ['Treated the postal code as free text'],
        escalations: ['The ticket does not say whether whitespace counts as empty'],
        confidence: 'medium',
        confidenceReason: 'One rule is a guess.',
      },
    },
    {
      role: 'plan-reconciler',
      turns: 2,
      seconds: 30,
      costUsd: 0.4,
      tier: 'decide',
      model: 'claude-opus-5-5',
      modelSource: 'tier',
      fellBack: true,
      tokens: { input: 5000, output: 2000, cacheRead: 0, cacheWrite: 0 },
      outcome: 'ok',
      handoff: { summary: 'Added TC-9.', decisions: [], escalations: [], confidence: 'low', confidenceReason: 'The checklist and plan disagree on scope.' },
    },
    { role: 'code-reviewer', turns: 1, seconds: 5, costUsd: 0, tier: 'decide', model: 'claude-fable-5-1', modelSource: 'QA_AGENT_MODEL', outcome: 'failed', error: 'code-reviewer failed: login expired', handoff: null },
    // A ledger line from before tiers.
    { role: 'skeptic', turns: 3, seconds: 20, costUsd: 0.05 },
  ];

  it('totals by tier, in tier order, with old lines as untiered', () => {
    assert.deepEqual(
      byTier(ledger).map((t) => [t.tier, t.calls]),
      [
        ['decide', 2],
        ['research', 1],
        ['untiered', 1],
      ],
    );
  });

  it('collects what every agent escalated, plus failures, fallbacks and low confidence', () => {
    const raised = escalations(ledger);
    assert.equal(raised.length, 4);
    assert.match(raised.join('\n'), /whitespace counts as empty/);
    assert.match(raised.join('\n'), /plan-reconciler\*\* ran on its fallback/);
    assert.match(raised.join('\n'), /plan-reconciler\*\* has low confidence/);
    assert.match(raised.join('\n'), /code-reviewer\*\* failed: code-reviewer failed: login expired/);
  });

  it('writes the lead\'s card and one card per agent', () => {
    const md = runReportMd(ledger, { title: 'QA analysis of #57', verdict: 'Ready for tests.', decisions: ['Scored the plan 86/100.'] });
    assert.match(md, /### Lead: QA analysis of #57/);
    assert.match(md, /4 agent call\(s\)/);
    assert.match(md, /Decided by the pipeline, not an agent:\*\*\n\n- Scored the plan 86\/100\./);
    assert.match(md, /\| decide \| settles something/);
    assert.match(md, /#### 1\. requirements-analyst/);
    assert.match(md, /#### 3\. code-reviewer \(failed\)/);
    assert.match(agentCard(ledger[2], 3), /set for every role by QA_AGENT_MODEL/);
    assert.match(agentCard(ledger[1], 2), /\*\*fell back\*\*/);
    assert.match(agentCard(ledger[0], 1), /1\.2k in, 800 out, 20k from cache/);
  });

  it('says plainly when nothing was escalated', () => {
    assert.match(leadMd([ledger[3]], { title: 't', verdict: 'v' }), /nothing was escalated/);
  });
});

describe('the size of what is posted', async () => {
  const { analysisMd, COMMENT_LIMIT, fitted, reportFold } = await import('../lib/render.ts');
  const handoff = { summary: 'x'.repeat(4000), decisions: [], escalations: [], confidence: 'high' as const, confidenceReason: 'r' };
  const ledger: RunRecord[] = Array.from({ length: 8 }, (_, i) => ({ role: `role-${i}`, turns: 1, seconds: 1, costUsd: 0, tier: 'build', model: 'm', outcome: 'ok', handoff }));
  const notes = { title: 't', verdict: 'v' };

  it('keeps every agent\'s card when it fits, and only the lead\'s card when it does not', () => {
    assert.match(reportFold(ledger.slice(0, 1), notes), /#### 1\. role-0/);
    assert.doesNotMatch(reportFold(ledger, notes), /#### 1\. role-0/);
    assert.match(reportFold(ledger, notes), /run-report\.md/);
  });

  it('keeps a comment under GitHub\'s limit', () => {
    assert.ok(COMMENT_LIMIT < 65_536);
    const request = { key: 'REQ-1', title: 't', source: 'github', ref: '1', body: '', mode: 'built' } as unknown as Parameters<typeof analysisMd>[0]['request'];
    assert.ok(analysisMd({ request, requirements: null, strategy: null, runUrl: null, ledger }).length < COMMENT_LIMIT);
  });

  it('gives up detail one level at a time, and cuts the last level only when nothing else fits', () => {
    const sizes = [90_000, 70_000, 40_000];
    const seen: number[] = [];
    const text = fitted((level) => {
      seen.push(level);
      return `L${level}\n${'y'.repeat(sizes[level])}`;
    }, 2);
    assert.deepEqual(seen, [0, 1, 2]);
    assert.ok(text.startsWith('L2'));
    const cut = fitted(() => `${'z\n'.repeat(40_000)}`, 1);
    assert.ok(cut.length <= COMMENT_LIMIT);
    assert.match(cut, /Cut short to fit GitHub's size limit/);
  });
});
