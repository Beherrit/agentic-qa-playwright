import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GateReport } from '../gates.ts';
import { healMd } from '../heal.ts';
import { coverageMap, coverageMd } from '../lib/coverage.ts';
import { buildEntry, historyMd } from '../lib/history.ts';
import { analysisMd, fold, gatesMd, landedMd, pullRequestMd, reviewMd, testsReadyMd, triageMd } from '../lib/render.ts';
import type { Generation, Request, Requirements, Review, Strategy, Triage } from '../lib/schemas.ts';
import type { TechnicalResult } from '../lib/technical.ts';

/** The first three paragraphs: the title, the verdict and the numbers behind it. */
function opening(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 3);
}

/** Every report opens the same way: an H2 title, a bold verdict, then a plain line of facts. */
function assertOpening(markdown: string, name: string): void {
  const [title, verdict, facts] = opening(markdown);
  assert.match(title, /^## \S/, `${name}: title`);
  assert.match(verdict, /^\*\*\S/, `${name}: verdict line`);
  assert.ok(facts && !/^(#|\||<details)/.test(facts), `${name}: a line of facts follows the verdict`);
}

const request: Request = { key: 'REQ-12', source: 'github', ref: '12', url: null, title: 'Sort products', body: 'b', mode: 'built' };
const criterion = (n: number, kind: 'happy' | 'negative' | 'edge' = 'happy') => ({ id: `AC-${n}`, kind, given: 'g', when: 'w', then: `then ${n}` });
const requirements = (count = 3): Requirements => ({
  title: 'Sort products',
  story: { asA: 'a shopper', iWant: 'to sort', soThat: 'I find things' },
  criteria: Array.from({ length: count }, (_, i) => criterion(i + 1, i === 1 ? 'negative' : i === 2 ? 'edge' : 'happy')),
  assumptions: [],
  outOfScope: [],
  openQuestions: [],
  risk: 'medium',
  riskReason: 'r',
});
const strategy = (criteria: string[]): Strategy => ({
  existingCoverage: [],
  siteNotes: 'notes',
  contract: [],
  regressionRisks: [{ area: 'the cart badge', why: 'same header', guardedBy: null }],
  cases: criteria.map((id, i) => ({
    id: `TC-${i + 1}`,
    title: `case ${i + 1}`,
    criteria: [id],
    technique: 'boundary-values' as const,
    layer: 'e2e' as const,
    layerReason: 'r',
    priority: 'P1' as const,
    persona: 'standard_user',
    steps: ['s'],
    expected: 'e',
  })),
  added: [],
  checklist: [{ id: 'CK-1', coveredBy: ['TC-1'], note: '' }],
  checklistItems: [{ id: 'CK-1', mustCover: 'x', why: 'y', weight: 'must' }],
  summary: 'A sound plan.',
  health: { score: 92, parts: [{ name: 'Acceptance criteria covered', weight: 40, value: 1, detail: 'all' }] },
});
const gates: GateReport = {
  passed: true,
  changed: ['tests/sort.spec.ts'],
  results: [
    { name: 'Scope', passed: true, summary: 'ok' },
    { name: 'Types', passed: true, summary: 'compiles' },
    { name: 'Sensitivity', passed: false, advisory: true, summary: 'never caught' },
  ],
};
const review: Review = { verdict: 'approve', summary: 'Good tests.', findings: [], criteria: [{ id: 'AC-1', verified: true, comment: '' }] };
const generation = (criteria: string[]): Generation => ({
  summary: 'Wrote the tests.',
  files: ['tests/sort.spec.ts'],
  automated: criteria.map((_, i) => ({ caseId: `TC-${i + 1}`, file: 'tests/sort.spec.ts', test: `t${i}` })),
  notAutomated: [],
  suspectedBugs: [],
});
const technical: TechnicalResult = {
  covered: [],
  pages: [],
  touches: [],
  related: [],
  notes: 'The select has a data-test id.',
  risk: 'low',
  riskReason: 'Isolated.',
  by: 'technical-reviewer',
  dropped: [],
};

describe('every report opens with a verdict a manager can read without scrolling', () => {
  const ids = ['AC-1', 'AC-2', 'AC-3'];
  const triage: Triage = {
    summary: 'One cause.',
    failures: [{ test: 't', file: 'tests/a.spec.ts:1', verdict: 'product-bug', confidence: 'high', evidence: 'e', nextStep: 'n' }],
    bugs: [{ title: 'Sorting ignores price', severity: 'major', steps: ['a'], expected: 'x', actual: 'y', tests: ['t'] }],
  };
  const reports: [string, string][] = [
    ['analysis', analysisMd({ request, requirements: requirements(), strategy: strategy(ids), technical, runUrl: null })],
    ['pull request', pullRequestMd({ request, requirements: requirements(), strategy: strategy(ids), generation: generation(ids), gates, review, round: 1, ledger: [], technical })],
    ['gates', gatesMd(gates)],
    ['review', reviewMd(review, 1)],
    ['triage', triageMd(triage)],
    ['healing', healMd({ summary: 's', fixes: [{ test: 't', file: 'pages/A.ts', cause: 'c', change: 'd' }], notFixed: [] }, gates, null)],
    ['history', historyMd([])],
    ['traceability', coverageMd(coverageMap({ suites: [] }))],
    ['landed', landedMd([{ test: 't', file: 'tests/a.spec.ts:1' }])],
    ['tests ready', testsReadyMd({ request, prUrl: 'https://pr', draft: false, gates, runUrl: null })],
  ];
  for (const [name, markdown] of reports) it(name, () => assertOpening(markdown, name));
});

describe('report shape', () => {
  it('folds a section behind its summary, or shows it under the same line', () => {
    assert.equal(fold('3 rows', 'table'), '<details><summary>3 rows</summary>\n\ntable\n\n</details>');
    assert.equal(fold('3 rows', 'table', true), '3 rows\n\ntable');
  });

  it('nests the parts of the analysis one level below its title, the technical review inside the requirements', () => {
    const md = analysisMd({ request, requirements: requirements(), strategy: strategy(['AC-1']), technical, runUrl: null, fromWriter: true });
    assert.match(md, /^## QA analysis: Sort products \(REQ-12\)/);
    assert.match(md, /\n### Requirements: Sort products/);
    assert.doesNotMatch(md, /\n#### Acceptance criteria/, 'criteria the writer filed are on the ticket already, not repeated');
    assert.match(md, /taken from the ticket above as written\. No analyst run\./);
    const analysed = analysisMd({ request, requirements: requirements(), strategy: strategy(['AC-1']), technical, runUrl: null });
    assert.match(analysed, /\n#### Acceptance criteria/, 'a hand-written ticket gets the full table');
    assert.match(md, /\n#### Technical review/);
    assert.match(md, /\n### Test strategy \(REQ-12\)/);
    assert.match(md, /ticket risk medium; technical risk low; 1 test case \(1 e2e\); 1 of 1 nearby behaviours unguarded\./);
  });

  it('puts the counts in the pull request opening and the closing keyword at the end', () => {
    const ids = ['AC-1', 'AC-2', 'AC-3'];
    const md = pullRequestMd({ request, requirements: requirements(), strategy: strategy(ids), generation: generation(ids), gates, review, round: 1, ledger: [{ role: 'r', turns: 1, seconds: 60, costUsd: 0.5 }] });
    assert.match(md, /3 tests for 3 criteria, 1 verified by the reviewer\. Gates: passed \(2 of 2 blocking\)\. Plan health 92\/100\. Estimated agent cost \$0\.50\./);
    assert.match(md, /\nCloses #12\n$/);
    assert.doesNotMatch(md, /<details><summary>3 of 3 criteria have a test/, 'a short traceability table stays open');
  });

  it('folds a long traceability table behind its summary line', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `AC-${i + 1}`);
    const md = pullRequestMd({ request, requirements: requirements(12), strategy: strategy(ids), generation: generation(ids), gates, review, round: 1, ledger: [] });
    assert.match(md, /<details><summary>12 of 12 criteria have a test; 1 verified by the reviewer\.<\/summary>/);
  });

  it('names the failed and advisory gates in the opening', () => {
    const failed = { ...gates, passed: false, results: [...gates.results, { name: 'Lint', passed: false, summary: 'x' }] };
    const md = gatesMd(failed);
    assert.match(md, /\*\*Verdict: failed\.\*\* 2 of 3 blocking gates passed\./);
    assert.match(md, /Failed: Lint\. Advisory, not passed: Sensitivity\./);
    assert.match(md, /\| Sensitivity \(advisory\) \| \*\*fail\*\* \| never caught \|/);
  });

  it('counts review findings by severity', () => {
    const findings = [
      { severity: 'major' as const, file: 'f', line: 1, issue: 'i', suggestion: 's' },
      { severity: 'nit' as const, file: 'f', line: null, issue: 'i', suggestion: 's' },
    ];
    assert.match(reviewMd({ ...review, verdict: 'request-changes', findings }, 2), /Findings: 0 blocker, 1 major, 0 minor, 1 nit\./);
  });

  it('folds a long run history and keeps the totals visible', () => {
    const META = { runUrl: '', workflow: 'analysis', conclusion: 'success', finishedAt: '2026-09-01T10:00:00Z' };
    const entries = Array.from({ length: 12 }, (_, i) => buildEntry({ ...META, runId: String(i + 1) }, { 'request.json': { key: `REQ-${i}`, title: 't' } }));
    const md = historyMd(entries);
    assert.match(md, /\*\*12 runs: 12 analysis, 0 tests, 0 regression\.\*\*/);
    assert.match(md, /### Totals[\s\S]*<details><summary>Show the runs<\/summary>/);
    assert.doesNotMatch(historyMd(entries.slice(0, 3)), /<details>/);
  });
});
