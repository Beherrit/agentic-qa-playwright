import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEntry, cleanEntry, historyHtml, historyMd, mergeEntries, summary, type RunEntry } from '../lib/history.ts';

const META = {
  runId: 123,
  runUrl: 'https://github.com/acme/shop/actions/runs/123',
  workflow: 'tests',
  conclusion: 'success',
  finishedAt: '2026-10-01T12:30:00Z',
};

const FILES = {
  'request.json': { key: 'SHOP-7', source: 'jira', title: 'Sort by price', mode: 'built', body: 'ignored' },
  'requirements.json': { criteria: [{}, {}, {}, {}] },
  'strategy.json': { cases: [{}, {}, {}], health: { score: 87.4 } },
  'generation.json': { automated: [{}, {}], suspectedBugs: ['x'] },
  'gates.json': {
    passed: false,
    results: [
      { name: 'lint', passed: true },
      { name: 'stability', passed: false },
      { name: 'mutation', passed: false, advisory: true },
    ],
  },
  'review.json': { verdict: 'approve', findings: [{}, {}] },
  'round.json': { round: 2 },
  'ledger.json': [
    { role: 'engineer', turns: 12, seconds: 90, costUsd: 0.5 },
    { role: 'reviewer', turns: 4, seconds: 30, costUsd: 0.25 },
  ],
};

function entry(over: Partial<RunEntry> = {}): RunEntry {
  return { ...buildEntry(META, FILES), ...over };
}

describe('buildEntry', () => {
  it('reads a complete run', () => {
    const e = buildEntry(META, FILES);
    assert.equal(e.runId, '123');
    assert.equal(e.workflow, 'tests');
    assert.equal(e.finishedAt, '2026-10-01T12:30:00.000Z');
    assert.equal(e.key, 'SHOP-7');
    assert.equal(e.title, 'Sort by price');
    assert.equal(e.source, 'jira');
    assert.equal(e.mode, 'built');
    assert.equal(e.criteria, 4);
    assert.equal(e.cases, 3);
    assert.equal(e.planScore, 87);
    assert.equal(e.gatesPassed, false);
    assert.deepEqual(e.gates[1], { name: 'stability', passed: false, advisory: false });
    assert.equal(e.gates[2].advisory, true);
    assert.equal(e.verdict, 'approve');
    assert.equal(e.reviewRounds, 2);
    assert.equal(e.findings, 2);
    assert.equal(e.suspectedBugs, 1);
    assert.equal(e.testsWritten, 2);
    assert.equal(e.costUsd, 0.75);
    assert.equal(e.agentSeconds, 120);
  });

  it('leaves fields empty when files are missing', () => {
    const e = buildEntry({ ...META, workflow: 'analysis' }, { 'request.json': { key: 'REQ-1', title: 'T' } });
    assert.equal(e.workflow, 'analysis');
    assert.equal(e.planScore, null);
    assert.equal(e.criteria, null);
    assert.deepEqual(e.gates, []);
    assert.equal(e.gatesPassed, null);
    assert.equal(e.verdict, null);
    assert.equal(e.reviewRounds, null);
    assert.equal(e.costUsd, 0);
  });

  it('never throws on rubbish', () => {
    const rubbish = { 'request.json': 'text', 'strategy.json': [1], 'gates.json': null, 'ledger.json': 5, 'review.json': 7 };
    const e = buildEntry({ runId: {}, runUrl: 5, workflow: null, conclusion: [], finishedAt: 'never' }, rubbish);
    assert.equal(e.runId, '');
    assert.equal(e.runUrl, '');
    assert.equal(e.finishedAt, '');
    assert.equal(e.conclusion, 'unknown');
    assert.equal(e.key, null);
  });

  it('treats hostile values as data', () => {
    const files = {
      ...FILES,
      'request.json': { key: 'K', title: `<script>alert(1)</script> | ${'x'.repeat(500)}`, source: 'evil', mode: 'rm -rf' },
      'gates.json': { passed: 'yes', results: 'not an array' },
      'ledger.json': [
        { role: 'engineer', turns: 'NaN', seconds: Infinity, costUsd: 'NaN' },
        { role: 'reviewer', turns: 1, seconds: 10, costUsd: '0.5' },
        'junk',
      ],
      'strategy.json': { cases: [], health: { score: 9999 } },
    };
    const e = buildEntry({ ...META, runUrl: 'javascript:alert(1)' }, files);
    assert.ok(e.title !== null && e.title.length === 200);
    assert.ok(e.title.startsWith('<script>'), 'kept as text, to be escaped on output');
    assert.equal(e.source, null);
    assert.equal(e.mode, null);
    assert.deepEqual(e.gates, []);
    assert.equal(e.gatesPassed, null);
    assert.equal(e.runUrl, '');
    assert.equal(e.planScore, 100);
    assert.equal(e.agents.length, 2);
    assert.equal(e.agents[0].costUsd, 0);
    assert.equal(e.costUsd, 0.5);
    assert.ok(Number.isFinite(e.agentSeconds));
  });

  it('survives a round trip through cleanEntry', () => {
    const e = buildEntry(META, FILES);
    assert.deepEqual(cleanEntry(JSON.parse(JSON.stringify(e))), e);
    assert.equal(cleanEntry({ title: 'no id' }), null);
  });
});

describe('mergeEntries', () => {
  it('adds a new run and puts the newest first', () => {
    const old = entry({ runId: '1', finishedAt: '2026-09-01T00:00:00.000Z' });
    const fresh = entry({ runId: '2', finishedAt: '2026-10-01T00:00:00.000Z' });
    assert.deepEqual(mergeEntries([old], fresh).map((e) => e.runId), ['2', '1']);
    assert.deepEqual(mergeEntries([fresh], old).map((e) => e.runId), ['2', '1']);
  });

  it('replaces a run with the same id', () => {
    const first = entry({ runId: '1', conclusion: 'failure' });
    const again = entry({ runId: '1', conclusion: 'success' });
    const merged = mergeEntries([first], again);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].conclusion, 'success');
  });
});

describe('summary', () => {
  const entries = [
    entry({ runId: '1', workflow: 'analysis', planScore: 80, costUsd: 1, agentSeconds: 60, gates: [], gatesPassed: null, verdict: null, reviewRounds: null }),
    entry({ runId: '2', verdict: 'approve', reviewRounds: 1, gatesPassed: true, planScore: 90, costUsd: 2, agentSeconds: 120 }),
    entry({ runId: '3', verdict: 'approve', reviewRounds: 2, gatesPassed: true, planScore: 100, costUsd: 3, agentSeconds: 180 }),
    entry({
      runId: '4',
      verdict: null,
      reviewRounds: null,
      gatesPassed: false,
      planScore: null,
      costUsd: 0,
      agentSeconds: 0,
      gates: [
        { name: 'stability', passed: false, advisory: false },
        { name: 'mutation', passed: false, advisory: true },
      ],
    }),
  ];

  it('totals the runs', () => {
    const s = summary(entries);
    assert.equal(s.runs, 4);
    assert.equal(s.analysisRuns, 1);
    assert.equal(s.testsRuns, 3);
    assert.equal(s.avgPlanScore, 90);
    assert.equal(s.totalCostUsd, 6);
    assert.equal(s.avgCostUsd, 1.5);
    assert.equal(s.avgSeconds, 90);
  });

  it('splits the tests runs by how the review went', () => {
    const s = summary(entries);
    assert.equal(s.approvedFirst, 1);
    assert.equal(s.approvedAfterRework, 1);
    assert.equal(s.notApproved, 1);
    assert.equal(s.approvedFirstRate, 1 / 3);
    assert.equal(s.gatePassRate, 2 / 3);
  });

  it('names the gate that fails most, ignoring advisory ones', () => {
    assert.deepEqual(summary(entries).topFailedGate, { name: 'stability', count: 3 });
  });

  it('copes with no runs', () => {
    const s = summary([]);
    assert.equal(s.runs, 0);
    assert.equal(s.gatePassRate, null);
    assert.equal(s.avgCostUsd, null);
    assert.equal(s.topFailedGate, null);
  });
});

describe('pages', () => {
  const hostile = entry({ runId: '9', title: '<script>alert(1)</script> a|b', key: '"><img src=x onerror=alert(1)>' });

  it('escapes a script in a title in the HTML', () => {
    const html = historyHtml([hostile]);
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    // The embedded data has no raw "<" either: only the two real script blocks open in the page.
    assert.equal(html.match(/<script/g)?.length, 2);
    assert.ok(html.includes('\\u003cscript>alert(1)'));
  });

  it('never emits a javascript: link', () => {
    const bad = entry({ runId: '8', runUrl: 'javascript:alert(1)' });
    const sneaky = buildEntry({ ...META, runId: '7', runUrl: 'https://github.com/x" onmouseover="alert(1)' }, FILES);
    const html = historyHtml([bad, sneaky]);
    const md = historyMd([bad, sneaky]);
    assert.ok(!/javascript:/i.test(html.replace(/\\u003c/g, '')) || !/href="javascript:/i.test(html));
    assert.ok(!/href="javascript:/i.test(html));
    assert.ok(!md.includes('](javascript:'));
    assert.ok(!html.includes('onmouseover'));
  });

  it('only links to github.com', () => {
    const html = historyHtml([entry({ runId: '5' })]);
    assert.ok(html.includes('href="https://github.com/acme/shop/actions/runs/123"'));
  });

  it('keeps the markdown table intact', () => {
    const md = historyMd([hostile]);
    const row = md.split('\n').find((line) => line.includes('alert'));
    assert.ok(row);
    assert.ok(!row.includes('<script>'));
    assert.equal(row.replace(/\\\|/g, '').split('|').length, 12);
  });

  it('renders with no runs', () => {
    assert.ok(historyHtml([]).includes('No runs recorded yet.'));
    assert.ok(historyMd([]).includes('No runs recorded yet.'));
  });
});
