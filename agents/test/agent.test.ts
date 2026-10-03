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

type Result = { structured_output?: unknown; result?: string; cost: number; turns: number };

/** A stand-in for the SDK: one scripted result per query() call, and a record of what each call asked for. */
function fakeQuery(results: Result[]): { query: QueryFn; calls: { prompt: string; resume?: string; maxTurns?: number }[] } {
  const calls: { prompt: string; resume?: string; maxTurns?: number }[] = [];
  const query = (({ prompt, options }: { prompt: string; options: { resume?: string; maxTurns?: number } }) => {
    calls.push({ prompt, resume: options.resume, maxTurns: options.maxTurns });
    const scripted = results[calls.length - 1];
    async function* messages() {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Working.' }] } };
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
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
});
