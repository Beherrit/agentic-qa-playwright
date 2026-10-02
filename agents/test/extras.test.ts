import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { configChecks } from '../doctor.ts';
import { addedMarkers, sensitivitySummary } from '../gates.ts';
import { coverageMap, coverageMd } from '../lib/coverage.ts';
import { canonicalTests, fingerprint } from '../lib/fingerprint.ts';
import { gatesMd, strategyMd } from '../lib/render.ts';
import type { Request, Strategy } from '../lib/schemas.ts';
import { adfToMarkdown } from '../sources/adf.ts';

const added = (...lines: string[]): string => lines.map((line) => `+${line}`).join('\n');

describe('expected-failure markers, as people really write them', () => {
  it('reads a call wrapped over several lines', () => {
    const markers = addedMarkers(added('    test.fail(', '      true,', "      'bug: AC-3 the total ignores tax',", '    );'));
    assert.deepEqual(markers.map((m) => m.reason), ['bug: AC-3 the total ignores tax']);
  });

  it('reads a reason with a quote in it', () => {
    const markers = addedMarkers(added("test.fail(true, 'bug: AC-2 the list doesn\\'t re-sort');", 'test.fail(true, "bug: AC-4 it\'s reversed");'));
    assert.deepEqual(markers.map((m) => m.reason), ["bug: AC-2 the list doesn't re-sort", "bug: AC-4 it's reversed"]);
  });

  it('does not take the title of a declared failing test for a reason', () => {
    const [marker] = addedMarkers(added("test.fail('bug: AC-1 sorts wrongly', async ({ page }) => {"));
    assert.equal(marker.reason, null);
  });

  it('finds no reason in a bare marker or a condition without one', () => {
    assert.deepEqual(addedMarkers(added('test.fail();', 'test.fail(true);')).map((m) => m.reason), [null, null]);
  });
});

describe('bug fingerprints', () => {
  const failures = [
    { test: 'Cart > removing an item in the cart leaves the others', file: 'tests/cart.spec.ts:37' },
    { test: 'Checkout > Last Name is required', file: 'tests/checkout.spec.ts:45' },
  ];

  it('gives the same fingerprint however the agent words the test name', () => {
    const first = canonicalTests(['Cart > removing an item in the cart leaves the others'], failures);
    const second = canonicalTests(['removing an item in the cart leaves the others'], failures);
    const third = canonicalTests(['cart: Removing an item in the cart leaves the others.'], failures);
    assert.deepEqual(first, ['tests/cart.spec.ts > Cart > removing an item in the cart leaves the others']);
    assert.deepEqual(second, first);
    assert.deepEqual(third.map(fingerprint), first.map(fingerprint));
  });

  it('does not change when the test moves to another line, and keeps a name it cannot place', () => {
    const moved = [{ ...failures[1], file: 'tests/checkout.spec.ts:61' }];
    assert.deepEqual(canonicalTests(['Last Name is required'], moved), canonicalTests(['Last Name is required'], failures));
    assert.deepEqual(canonicalTests(['something else entirely'], failures), ['something else entirely']);
  });
});

describe('traceability map', () => {
  const spec = (title: string, tags: string[], status: string, expectedStatus = 'passed') => ({ title, tags, tests: [{ status, expectedStatus }] });
  const report = {
    suites: [
      {
        title: 'sorting.spec.ts',
        suites: [
          {
            title: 'Sorting',
            specs: [
              spec('sorts by price', ['REQ-1', 'AC-2'], 'expected'),
              spec('sorts for the broken account', ['@REQ-1', '@AC-10', '@AC-2'], 'expected', 'failed'),
              spec('keeps the order', ['REQ-1', 'AC-7'], 'unexpected'),
            ],
          },
        ],
      },
      { title: 'cart.spec.ts', specs: [spec('the cart starts empty', [], 'expected'), spec('search', ['SHOP-12', 'AC-1'], 'flaky')] },
    ],
  };

  it('groups tests by requirement and criterion, and counts how they did', () => {
    const map = coverageMap(report);
    const [req, shop] = map.requirements;
    assert.equal(map.ran, true);
    assert.deepEqual([req.key, req.tests, req.passing, req.expectedFailures, req.failing], ['REQ-1', 3, 1, 1, 1]);
    assert.deepEqual(req.criteria.map((c) => c.id), ['AC-2', 'AC-7', 'AC-10']);
    assert.deepEqual(req.criteria[0].tests, ['Sorting > sorts by price', 'Sorting > sorts for the broken account']);
    assert.deepEqual([shop.key, shop.flaky], ['SHOP-12', 1]);
    assert.equal(map.untagged.tests, 1);
  });

  it('leaves the result columns out when the report is only a listing', () => {
    const listed = coverageMap({ suites: [{ title: 'a.spec.ts', specs: [spec('t', ['REQ-3', 'AC-1'], 'skipped')] }] });
    assert.equal(listed.ran, false);
    assert.doesNotMatch(coverageMd(listed), /Passing/);
    assert.match(coverageMd(coverageMap(report)), /\| REQ-1 \| AC-2, AC-7, AC-10 \| 3 \| 1 \| 1 \| 1 \| 0 \|/);
  });
});

describe('doctor', () => {
  const good = {
    app: { name: 'Shop', baseUrl: 'https://shop.example', brief: 'docs/brief.md' },
    conventions: 'docs/conventions.md',
    writable: ['tests/', 'pages/'],
    minPlanScore: 70,
    stabilityRuns: 3,
    sensitivity: { required: false, targets: [{ name: 'broken', env: {} }] },
  };

  it('passes a complete configuration', () => {
    assert.ok(configChecks(good, () => true).every((check) => check.level === 'ok'));
  });

  it('names what is missing', () => {
    const checks = configChecks({ ...good, writable: ['tests'], sensitivity: undefined }, (file) => file !== 'docs/brief.md');
    const level = (name: string) => checks.find((check) => check.name === name)?.level;
    assert.equal(level('Project documents'), 'fail');
    assert.equal(level('Writable folders'), 'fail');
    assert.equal(level('Sensitivity targets'), 'warn');
  });
});

describe('reports', () => {
  const request: Request = { key: 'REQ-1', source: 'github', ref: '1', url: null, title: 't', body: '', mode: 'built' };
  const strategy: Strategy = {
    existingCoverage: [],
    siteNotes: '',
    contract: [],
    regressionRisks: [
      { area: 'the cart badge', why: 'same header', guardedBy: 'tests/cart.spec.ts: adding items updates the cart badge' },
      { area: 'the product detail link', why: 'same card', guardedBy: null },
    ],
    cases: [],
    added: [],
    checklist: [],
    checklistItems: [],
    summary: 's',
    health: { score: 90, parts: [] },
  };

  it('shows nearby behaviour at risk and says what nothing guards', () => {
    const markdown = strategyMd(request, strategy);
    assert.match(markdown, /1 of 2 have no existing test/);
    assert.match(markdown, /\| the product detail link \| same card \| \*\*nothing\*\* \|/);
    assert.doesNotMatch(strategyMd(request, { ...strategy, regressionRisks: [] }), /Nearby behaviour/);
  });

  it('shows the sensitivity table even when the gate passes', () => {
    const { short, table } = sensitivitySummary({ targets: ['broken'], tests: [{ title: 'a', caught: ['broken'] }, { title: 'b', caught: [] }] });
    const markdown = gatesMd({ passed: true, changed: [], results: [{ name: 'Sensitivity', passed: true, advisory: true, summary: short, table }] });
    assert.match(markdown, /1 never failed \(see the table\)/);
    assert.match(markdown, /Sensitivity: test by test/);
    assert.match(markdown, /\| b \| - \|/);
  });

  it('keeps link targets and code from a Jira description', () => {
    const text = (value: string, type?: string, attrs?: Record<string, unknown>) => ({ type: 'text', text: value, marks: type ? [{ type, attrs }] : undefined });
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [text('See '), text('the design', 'link', { href: 'https://example.com/d' }), text(' and use '), text('data-test="sort"', 'code')] }] };
    assert.equal(adfToMarkdown(doc), 'See [the design](https://example.com/d) and use `data-test="sort"`');
  });
});
