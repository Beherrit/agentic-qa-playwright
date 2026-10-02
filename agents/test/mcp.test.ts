import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { historyMd, parseRunLog } from '../lib/history.ts';
import { AnalyzeInput, draftText, DraftInput, HistoryInput, TOOLS } from '../lib/mcp-tools.ts';
import { ROOT } from '../lib/paths.ts';
import { pipelineIssues, pipelinePulls, stageOf, statusMd } from '../lib/status.ts';

describe('MCP tool input', () => {
  it('takes a wish, previews by default, and files only on GitHub', () => {
    assert.deepEqual(DraftInput.parse({ text: 'Shoppers can save a wishlist' }), { text: 'Shoppers can save a wishlist', source: 'local', file: false });
    assert.ok(DraftInput.safeParse({ text: 'Shoppers can save a wishlist', source: 'github', file: true }).success);
    assert.ok(!DraftInput.safeParse({ text: 'Shoppers can save a wishlist', file: true }).success, 'filing locally means nothing');
    assert.ok(!DraftInput.safeParse({ text: 'short' }).success);
    assert.ok(!DraftInput.safeParse({ text: 'Shoppers can save a wishlist', source: 'jira' }).success);
  });

  it('takes a requirement as text or as a ticket, never both or neither', () => {
    assert.ok(AnalyzeInput.safeParse({ text: 'As a shopper I want to sort the list' }).success);
    assert.ok(AnalyzeInput.safeParse({ source: 'github', ref: '12' }).success);
    assert.ok(AnalyzeInput.safeParse({ source: 'jira', ref: 'SHOP-12' }).success);
    for (const bad of [{}, { source: 'github' }, { ref: '12' }, { text: 'As a shopper I want to sort', source: 'github', ref: '1' }]) {
      assert.ok(!AnalyzeInput.safeParse(bad).success, JSON.stringify(bad));
    }
  });

  it('checks a ticket reference before it reaches gh or Jira', () => {
    for (const ref of ['12; rm -rf /', '0', '#12', '../1']) assert.ok(!AnalyzeInput.safeParse({ source: 'github', ref }).success, ref);
    for (const ref of ['shop-12', 'SHOP 12', 'SHOP-12/../x']) assert.ok(!AnalyzeInput.safeParse({ source: 'jira', ref }).success, ref);
  });

  it('caps the history listing', () => {
    assert.equal(HistoryInput.parse({}).limit, 10);
    assert.ok(!HistoryInput.safeParse({ limit: 500 }).success);
  });

  it('says in the description which tools spend the plan, and none promises a label', () => {
    for (const name of ['qa_draft_ticket', 'qa_analyze'] as const) assert.match(TOOLS[name].description, /spends the Claude plan/);
    for (const name of ['qa_coverage', 'qa_history', 'qa_doctor', 'qa_status'] as const) assert.match(TOOLS[name].description, /No agent|no agent/);
    assert.match(TOOLS.qa_analyze.description, /several minutes/);
    assert.match(TOOLS.qa_analyze.description, /changes no label/);
  });
});

describe('MCP answers', () => {
  const result = { preview: '# Requirement: Save a wishlist\n\nbody', problems: [], labels: ['qa-test-first'], filed: null };

  it('tells a preview how to file it', () => {
    assert.match(draftText(result, DraftInput.parse({ text: 'Shoppers can save a wishlist', source: 'github' })), /Not filed\. Call qa_draft_ticket again with file: true/);
    assert.match(draftText(result, DraftInput.parse({ text: 'Shoppers can save a wishlist' })), /this was a preview/);
  });

  it('says which labels a person should add after filing', () => {
    const filed = { ...result, filed: { ref: '40', url: 'https://github.com/o/r/issues/40' } };
    const text = draftText(filed, DraftInput.parse({ text: 'Shoppers can save a wishlist', source: 'github', file: true }));
    assert.match(text, /Filed: https:\/\/github\.com\/o\/r\/issues\/40\. No label was added\. Add `qa-test-first`.*Add `qa-pipeline`/);
  });

  it('lists the newest runs and keeps the totals over all of them', () => {
    const line = (id: number) => JSON.stringify({ runId: String(id), workflow: 'analysis', finishedAt: `2026-09-${String(id).padStart(2, '0')}T10:00:00Z`, key: `REQ-${id}` });
    const entries = parseRunLog([line(1), 'not json', line(2), line(3)].join('\n'));
    assert.equal(entries.length, 3);
    const md = historyMd(entries, 2);
    assert.match(md, /- Runs: 3 \(3 analysis, 0 tests\)/);
    assert.match(md, /The newest 2 of 3 runs, newest first\./);
    assert.ok(md.includes('REQ-3') && md.includes('REQ-2') && !md.includes('REQ-1 '));
  });
});

describe('pipeline status', () => {
  const issues = [
    { ref: '3', title: 'Make checkout better', url: null, labels: ['qa-needs-info'] },
    { ref: '4', title: 'Search | products', url: 'https://github.com/o/r/issues/4', labels: ['qa-analyzed', 'qa-test-first', 'enhancement'] },
    { ref: '5', title: 'A bug', url: null, labels: ['bug'] },
  ];
  const pulls = [
    { number: 9, title: 'fix(tests): repair', url: null, branch: 'qa/heal-123', draft: false },
    { number: 10, title: 'test: Search', url: null, branch: 'qa/req-4', draft: true },
    { number: 20, title: 'docs', url: null, branch: 'cloud/improvements', draft: false },
  ];

  it('keeps tickets with a pipeline label and the pipeline branches', () => {
    assert.deepEqual(pipelineIssues(issues).map((i) => i.ref), ['3', '4']);
    assert.deepEqual(pipelinePulls(pulls).map((p) => p.number), [9, 10]);
  });

  it('names the stage from the labels', () => {
    assert.equal(stageOf(['qa-needs-info']), 'waiting for answers');
    assert.equal(stageOf(['qa-analyzed', 'qa-generate']), 'tests being written');
    assert.equal(stageOf(['qa-test-first']), 'marked test-first, not started');
  });

  it('renders both tables and keeps a pipe inside its cell', () => {
    const md = statusMd(issues, pulls);
    assert.match(md, /2 open ticket\(s\) with a pipeline label, 2 open pull request\(s\)/);
    assert.match(md, /\| #4 \| \[Search \\\| products\]\(https:\/\/github\.com\/o\/r\/issues\/4\) \| analysed, ready for tests \| qa-analyzed, qa-test-first \|/);
    assert.match(md, /\| #10 \| test: Search \| `qa\/req-4` \| draft \|/);
    assert.match(statusMd([], []), /### Tickets\n\nNone\./);
  });
});

/** Starts the real server and talks to it over stdio, the way Claude Desktop and Claude Code do. */
describe('MCP server over stdio', () => {
  it('answers initialize and tools/list, and refuses bad arguments without running anything', { timeout: 20_000 }, async () => {
    const child = spawn(process.execPath, [path.join(ROOT, 'agents', 'mcp.ts')], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    const replies = new Map<number, { result?: Record<string, unknown>; error?: unknown }>();
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        // Anything on stdout that is not JSON-RPC would break a real client, so it fails the test.
        const message = JSON.parse(line);
        if (typeof message.id === 'number') replies.set(message.id, message);
      }
    });
    const send = (message: object): void => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    };
    const reply = async (id: number) => {
      for (let waited = 0; waited < 15_000; waited += 25) {
        if (replies.has(id)) return replies.get(id)!;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`no reply to request ${id}`);
    };

    try {
      send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke-test', version: '0' } } });
      const init = await reply(1);
      assert.equal((init.result?.serverInfo as { name: string }).name, 'agentic-qa');
      send({ method: 'notifications/initialized' });

      send({ id: 2, method: 'tools/list' });
      const tools = (await reply(2)).result?.tools as { name: string; inputSchema: { type: string }; annotations?: { readOnlyHint?: boolean } }[];
      assert.deepEqual(tools.map((t) => t.name).sort(), Object.keys(TOOLS).sort());
      for (const tool of tools) assert.equal(tool.inputSchema.type, 'object', tool.name);
      assert.equal(tools.find((t) => t.name === 'qa_status')?.annotations?.readOnlyHint, true);

      send({ id: 3, method: 'tools/call', params: { name: 'qa_analyze', arguments: {} } });
      const refused = await reply(3);
      const text = JSON.stringify(refused);
      assert.match(text, /Give the requirement as text, or as source and ref/);
    } finally {
      child.kill();
    }
  });
});
