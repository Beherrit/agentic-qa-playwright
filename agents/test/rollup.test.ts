import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { historyMd, rollup, rollupMd, type RunEntry } from '../lib/history.ts';

const now = new Date('2026-10-16T12:00:00Z');

function entry(over: Partial<RunEntry>): RunEntry {
  return {
    runId: '1',
    runUrl: '',
    workflow: 'tests',
    conclusion: 'success',
    finishedAt: '2026-10-16T09:00:00Z',
    key: 'REQ-1',
    title: 't',
    source: 'github',
    mode: 'built',
    criteria: 3,
    cases: 4,
    planScore: 80,
    gates: [],
    gatesPassed: true,
    verdict: 'approve',
    reviewRounds: 1,
    findings: 0,
    suspectedBugs: 0,
    testsWritten: 2,
    agents: [],
    costUsd: 0,
    agentSeconds: 0,
    flaky: [],
    failedTests: null,
    ...over,
  };
}

const entries: RunEntry[] = [
  entry({ runId: 'a', costUsd: 1.5, agents: [{ role: 'test-architect', turns: 20, seconds: 100, costUsd: 0.5 }, { role: 'automation-engineer', turns: 60, seconds: 600, costUsd: 1 }] }),
  entry({ runId: 'b', key: 'REQ-2', finishedAt: '2026-10-14T09:00:00Z', conclusion: 'failure', costUsd: 2, gates: [{ name: 'Full suite', passed: false, advisory: false }, { name: 'Accessibility', passed: false, advisory: true }], agents: [{ role: 'automation-engineer', turns: 80, seconds: 900, costUsd: 2 }] }),
  entry({ runId: 'c', key: 'REQ-3', finishedAt: '2026-09-01T09:00:00Z', costUsd: 9 }),
];

describe('the last-days rollup', () => {
  it('counts only the window, sums by role and ticket, and names the blocking gates', () => {
    const r = rollup(entries, 7, now);
    assert.equal(r.runs, 2);
    assert.equal(r.failedRuns, 1);
    assert.equal(r.costUsd, 3.5);
    assert.equal(r.avgCostUsd, 1.75);
    assert.equal(r.todayUsd, 1.5);
    assert.deepEqual(r.byRole[0], { role: 'automation-engineer', runs: 2, avgTurns: 70, avgSeconds: 750, costUsd: 3 });
    assert.deepEqual(r.byTicket.map((t) => t.key), ['REQ-2', 'REQ-1']);
    assert.deepEqual(r.failedGates, [{ name: 'Full suite', count: 1 }], 'advisory gates do not count');
  });

  it('says when today is over the daily cap, and nothing about a cap when there is none', () => {
    const r = rollup(entries, 7, now);
    assert.match(rollupMd(r, 1).join('\n'), /\$1\.50 of a \$1\.00 daily cap, over it/);
    assert.doesNotMatch(rollupMd(r, 0).join('\n'), /cap/);
  });

  it('appears on the history page between the totals and the runs', () => {
    const page = historyMd(entries, undefined, 10);
    assert.ok(page.indexOf('### Totals') < page.indexOf('### Last 7 days') && page.indexOf('### Last 7 days') < page.indexOf('### Runs'));
  });

  it('is empty but well formed with no runs', () => {
    const r = rollup([], 7, now);
    assert.equal(r.runs, 0);
    assert.equal(r.avgCostUsd, null);
    assert.ok(rollupMd(r).join('\n').includes('0 runs'));
  });
});
