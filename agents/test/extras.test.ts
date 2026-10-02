import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { configChecks } from '../doctor.ts';
import { a11yReport, a11ySummary, addedMarkers, assertionBalance, failureDigest, sensitivitySummary } from '../gates.ts';
import { defects, specFiles } from '../heal.ts';
import { coverageMap, coverageMd } from '../lib/coverage.ts';
import { canonicalTests, fingerprint } from '../lib/fingerprint.ts';
import { gatesMd, strategyMd } from '../lib/render.ts';
import type { Request, Strategy } from '../lib/schemas.ts';
import { adfToMarkdown } from '../sources/adf.ts';
import { checkedRisks, ranTheTests } from '../stages.ts';

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

  it('counts a risk as guarded only when the guard is a spec file that exists', () => {
    const risk = (guardedBy: string | null) => ({ area: 'a', why: 'w', guardedBy });
    const checked = checkedRisks(
      [
        risk('tests/cart.spec.ts: adding items updates the cart badge'),
        risk('tests/gone.spec.ts: something'),
        risk('tests/cart.spec.ts (not read in detail)'),
        risk(null),
      ],
      (file) => file === 'tests/cart.spec.ts',
    );
    assert.deepEqual(checked.map((r) => r.guardedBy), ['tests/cart.spec.ts: adding items updates the cart badge', null, null, null]);
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

describe('accessibility', () => {
  const scan = (url: string, violations: object[], incomplete: object[] = []) => ({
    name: 'a11y',
    body: Buffer.from(JSON.stringify({ url, violations, incomplete })).toString('base64'),
  });
  const item = (rule: string, impact: string, elements = 1) => ({ rule, impact, help: `${rule} help`, helpUrl: `https://rules.example/${rule}`, elements });
  const report = (...attachments: { name: string; body?: string }[]) => ({
    suites: [{ suites: [{ specs: [{ tests: [{ results: [{ attachments: [...attachments, { name: 'screenshot' }, { name: 'a11y', body: 'not json' }] }] }] }] }] }],
  });

  it('merges the same rule across pages, counts a page once, and puts the worst first', () => {
    const found = a11yReport(
      report(
        scan('https://shop.example/cart?x=1', [item('label', 'minor')], [item('color-contrast', 'serious', 3)]),
        scan('https://shop.example/cart', [item('image-alt', 'critical', 2), item('label', 'minor', 4)]),
        scan('https://shop.example/', [item('label', 'minor')]),
      ),
    );
    assert.deepEqual(found.pages, ['https://shop.example/cart', 'https://shop.example/']);
    assert.deepEqual(found.violations.map((v) => [v.rule, v.elements, v.pages.length]), [['image-alt', 2, 1], ['label', 4, 2]]);
    assert.deepEqual(found.review.map((v) => v.rule), ['color-contrast']);
  });

  it('never calls a clean scan a pass', () => {
    const clean = a11ySummary(a11yReport(report(scan('https://shop.example/', []))));
    assert.match(clean.summary, /no violations detected by axe.*Not a pass/);
    assert.match(clean.table, /No findings is not the same as accessible/);
    const dirty = a11ySummary(a11yReport(report(scan('https://shop.example/', [item('image-alt', 'critical')]))));
    assert.match(dirty.summary, /1 rule\(s\) violated \(1 serious or critical\)/);
    assert.match(dirty.table, /\| violation \| critical \| \[image-alt\]/);
  });
});

describe('self-healing', () => {
  const patch = [
    '--- a/pages/CheckoutPage.ts',
    '+++ b/pages/CheckoutPage.ts',
    "-    this.postalCode = page.getByPlaceholder('Postal Code');",
    "+    this.postalCode = page.getByPlaceholder('Zip/Postal Code');",
    '--- a/tests/checkout.spec.ts',
    '+++ b/tests/checkout.spec.ts',
    "-    await expect(checkoutPage.total).toHaveText('Total: $41.02');",
    '-    await expect(checkoutPage.cartBadge).toBeHidden();',
    "+    await expect(checkoutPage.total).toHaveText('Total: $41.01');",
  ].join('\n');

  it('counts assertions removed and added per file, so a repair that drops one is caught', () => {
    assert.deepEqual(assertionBalance(patch), [{ file: 'tests/checkout.spec.ts', removed: 2, added: 1 }]);
  });

  const failure = (test: string, verdict: string, confidence: string) => ({ test, file: 'tests/checkout.spec.ts:45', verdict, confidence, evidence: 'e', nextStep: 'n' });
  const triage = {
    summary: '',
    bugs: [],
    failures: [
      failure('Checkout > Postal Code is required', 'test-defect', 'high'),
      failure('Checkout > the total is the item total plus tax', 'product-bug', 'high'),
      failure('Cart > the cart starts empty', 'test-defect', 'low'),
      failure('Login > logging out returns to the login page', 'flaky', 'medium'),
    ],
    reported: [{ test: 'Checkout > Postal Code is required', file: 'tests/checkout.spec.ts:45', error: 'waiting for getByPlaceholder', evidence: ['test-results/x/error-context.md'] }],
  } as Parameters<typeof defects>[0];

  it('hands the healer only test defects triage was reasonably sure of, with what Playwright reported', () => {
    const picked = defects(triage);
    assert.deepEqual(picked.map((d) => d.test), ['Checkout > Postal Code is required']);
    assert.equal(picked[0].error, 'waiting for getByPlaceholder');
    assert.deepEqual(specFiles(picked), ['tests/checkout.spec.ts']);
  });
});

describe('what goes back to the engineer', () => {
  it('shows the first error and the list of failures, not the progress lines', () => {
    const output = [
      '[1/64] [chromium] › tests/cart.spec.ts:7:3 › Cart › the cart starts empty',
      '  1) [chromium] › tests/search.spec.ts:12:3 › Product search › finds the backpack',
      '    Test timeout of 30000ms exceeded.',
      '    Error: locator.fill: Test timeout of 30000ms exceeded.',
      '[2/64] [chromium] › tests/cart.spec.ts:11:3 › Cart › adding items updates the cart badge',
      '  2) [chromium] › tests/search.spec.ts:20:3 › Product search › shows no results',
      '    Test timeout of 30000ms exceeded.',
      '  2 failed',
      '    [chromium] › tests/search.spec.ts:12:3 › Product search › finds the backpack',
      '    [chromium] › tests/search.spec.ts:20:3 › Product search › shows no results',
      '  62 passed (2.9m)',
    ].join('\n');
    const digest = failureDigest(output);
    assert.match(digest, /^1\) \[chromium\] › tests\/search\.spec\.ts:12:3/);
    assert.match(digest, /locator\.fill: Test timeout/);
    assert.match(digest, /2 failed\n\s+\[chromium\] › tests\/search\.spec\.ts:12:3/);
    assert.doesNotMatch(digest, /\[1\/64\]|2\) \[chromium\]/);
  });

  it('knows whether the engineer ran the tests', () => {
    assert.equal(ranTheTests(['cat pages/InventoryPage.ts', 'npx tsc --noEmit && npx playwright test tests/sort.spec.ts --reporter=line']), true);
    assert.equal(ranTheTests(['ls tests', 'grep -n fail tests/search.spec.ts']), false);
  });
});
