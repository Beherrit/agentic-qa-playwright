import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { z } from 'zod';

// The run folder is fixed when paths.ts loads, so it is pointed at a temp dir before the engine is imported.
process.env.QA_RUN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-agent-'));
const { ANSWER_NUDGE, runAgent } = await import('../lib/agent.ts');
type QueryFn = Parameters<typeof runAgent>[1];

const Answer = z.object({ summary: z.string() });

type Result = { structured_output?: unknown; result?: string; cost: number; turns: number; isError?: boolean; usage?: Record<string, unknown> };

/** A stand-in for the SDK: one scripted result per query() call, and a record of what each call asked for. */
type Call = { prompt: string; resume?: string; maxTurns?: number; model?: string; fallbackModel?: string; schema?: unknown };
function fakeQuery(results: Result[], usesTool = false): { query: QueryFn; calls: Call[] } {
  const calls: Call[] = [];
  type Asked = { resume?: string; maxTurns?: number; model?: string; fallbackModel?: string; outputFormat?: { schema?: unknown } };
  const query = (({ prompt, options }: { prompt: string; options: Asked }) => {
    calls.push({ prompt, resume: options.resume, maxTurns: options.maxTurns, model: options.model, fallbackModel: options.fallbackModel, schema: options.outputFormat?.schema });
    const scripted = results[calls.length - 1];
    async function* messages() {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Working.' }] } };
      if (usesTool) yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'tests/a.spec.ts' } }] } };
      yield {
        type: 'result',
        subtype: 'success',
        is_error: scripted.isError ?? false,
        modelUsage: scripted.usage ?? {},
        session_id: 'session-1',
        num_turns: scripted.turns,
        total_cost_usd: scripted.cost,
        result: scripted.result ?? '',
        structured_output: scripted.structured_output,
      };
    }
    return messages();
  }) as unknown as QueryFn;
  return { query, calls };
}

describe('runAgent', () => {
  it('returns the answer when the agent hands it in', async () => {
    const fake = fakeQuery([{ structured_output: { summary: 'done' }, cost: 0.1, turns: 5 }]);
    const run = await runAgent({ role: 'test-role', instructions: '', task: 'Do it.', schema: Answer, access: 'read' }, fake.query);
    assert.deepEqual(run.output, { summary: 'done' });
    assert.equal(run.turns, 5);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].resume, undefined);
  });

  it('resumes the session once and asks for the answer when the agent wrote a summary instead', async () => {
    const fake = fakeQuery([
      { result: 'I finished the tests.', cost: 0.2, turns: 30 },
      { structured_output: { summary: 'the tests' }, cost: 0.21, turns: 1 },
    ]);
    const run = await runAgent({ role: 'test-role', instructions: '', task: 'Do it.', schema: Answer, access: 'read' }, fake.query);
    assert.deepEqual(run.output, { summary: 'the tests' });
    assert.equal(fake.calls.length, 2);
    assert.equal(fake.calls[1].prompt, ANSWER_NUDGE);
    assert.equal(fake.calls[1].resume, 'session-1');
    assert.equal(fake.calls[1].maxTurns, 3);
    // Turns add up; the cost is the resumed session's running total, not the two added together.
    assert.equal(run.turns, 31);
    assert.equal(run.costUsd, 0.21);
  });

  it('gives up after one nudge', async () => {
    const fake = fakeQuery([
      { result: 'Summary.', cost: 0.2, turns: 30 },
      { result: 'Still a summary.', cost: 0.21, turns: 3 },
    ]);
    await assert.rejects(
      runAgent({ role: 'test-role', instructions: '', task: 'Do it.', schema: Answer, access: 'read' }, fake.query),
      /test-role answered in the wrong shape/,
    );
    assert.equal(fake.calls.length, 2);
  });

  const handoff = { summary: 'Did it.', decisions: [], escalations: ['Check the empty case'], confidence: 'medium', confidenceReason: 'One guess.' };
  const ledger = (): Record<string, unknown>[] => JSON.parse(fs.readFileSync(path.join(process.env.QA_RUN_DIR!, 'ledger.json'), 'utf8'));

  it('asks every role for a handoff, keeps it out of the answer, and writes it to the ledger with tier, model and tokens', async () => {
    const usage = { 'claude-opus-5-5': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 1000, cacheCreationInputTokens: 10 } };
    const fake = fakeQuery([{ structured_output: { summary: 'done', handoff }, cost: 0.3, turns: 4, usage }]);
    const run = await runAgent({ role: 'test-architect', instructions: '', task: 'Plan it.', schema: Answer, access: 'read' }, fake.query);
    assert.deepEqual(run.output, { summary: 'done' });
    assert.equal(fake.calls[0].model, 'claude-opus-5-5');
    assert.equal(fake.calls[0].fallbackModel, 'claude-sonnet-5-5');
    assert.match(JSON.stringify(fake.calls[0].schema), /"handoff"/);
    const last = ledger().at(-1)!;
    assert.equal(last.tier, 'build');
    assert.deepEqual(last.tokens, { input: 100, output: 50, cacheRead: 1000, cacheWrite: 10 });
    assert.deepEqual(last.handoff, handoff);
    assert.equal(last.outcome, 'ok');
  });

  it('runs the task again on the fallback when the account cannot use the tier\'s model', async () => {
    const fake = fakeQuery([
      { result: "There's an issue with the selected model (claude-fable-5-1). It may not exist or you may not have access to it.", isError: true, cost: 0, turns: 1 },
      { structured_output: { summary: 'reconciled', handoff }, cost: 0.2, turns: 3, usage: { 'claude-opus-5-5': { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } },
    ]);
    const run = await runAgent({ role: 'plan-reconciler', instructions: '', task: 'Reconcile.', schema: Answer, access: 'read' }, fake.query);
    assert.deepEqual(run.output, { summary: 'reconciled' });
    assert.deepEqual(
      fake.calls.map((c) => c.model),
      ['claude-fable-5-1', 'claude-opus-5-5'],
    );
    assert.equal(fake.calls[1].prompt, 'Reconcile.');
    assert.equal(run.record.fellBack, true);
    assert.equal(run.record.model, 'claude-opus-5-5');
    // The attempt on the unavailable model is in the ledger too, as a failed call.
    const [first, second] = ledger().slice(-2);
    assert.deepEqual([first.model, first.outcome, second.model, second.outcome], ['claude-fable-5-1', 'failed', 'claude-opus-5-5', 'ok']);
  });

  it('never runs a writing role again on the fallback once it has used a tool', async () => {
    const results = [{ result: 'API Error: 529 overloaded_error', isError: true, cost: 0.5, turns: 12 }];
    const fake = fakeQuery(results, true);
    await assert.rejects(runAgent({ role: 'automation-engineer', instructions: '', task: 'Write.', schema: Answer, access: 'write' }, fake.query), /overloaded/);
    assert.equal(fake.calls.length, 1);
  });

  it('does not fall back for a failure that is not about the model', async () => {
    const fake = fakeQuery([{ result: 'Invalid API key · Please run /login', isError: true, cost: 0, turns: 1 }]);
    await assert.rejects(runAgent({ role: 'plan-reconciler', instructions: '', task: 'Reconcile.', schema: Answer, access: 'read' }, fake.query), /Invalid API key/);
    assert.equal(fake.calls.length, 1);
    const last = ledger().at(-1)!;
    assert.equal(last.outcome, 'failed');
    assert.match(String(last.error), /Invalid API key/);
  });
});
