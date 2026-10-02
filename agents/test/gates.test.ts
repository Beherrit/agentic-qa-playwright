import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addedMarkers,
  addedSkips,
  grepFor,
  patchPaths,
  splitFailures,
  markerProblems,
  missingCriteria,
  outcomes,
  parseStatus,
  removedLines,
  scopeProblems,
  sensitivitySummary,
  wrongReasons,
} from '../gates.ts';
import { tagGrep } from '../lib/keys.ts';

const WRITABLE = ['tests/', 'pages/', 'fixtures/'];

describe('parseStatus', () => {
  it('keeps the first letter of a path whose index column is blank', () => {
    // The bug the first pipeline run found: " M fixtures/test.ts" lost its "f".
    assert.deepEqual(parseStatus(' M fixtures/test.ts\0'), [{ status: 'M', file: 'fixtures/test.ts' }]);
  });

  it('reads untracked files', () => {
    assert.deepEqual(parseStatus('?? tests/sorting.spec.ts\0'), [{ status: '??', file: 'tests/sorting.spec.ts' }]);
  });

  it('reads a rename as the new path plus where it came from', () => {
    assert.deepEqual(parseStatus('R  tests/new.spec.ts\0tests/old.spec.ts\0?? pages/X.ts\0'), [
      { status: 'R', file: 'tests/new.spec.ts', from: 'tests/old.spec.ts' },
      { status: '??', file: 'pages/X.ts' },
    ]);
  });

  it('keeps spaces in paths, which -z never quotes', () => {
    assert.deepEqual(parseStatus('?? tests/my file.spec.ts\0'), [{ status: '??', file: 'tests/my file.spec.ts' }]);
  });
});

describe('scopeProblems', () => {
  it('passes a new spec inside the writable folders', () => {
    assert.deepEqual(scopeProblems([{ status: '??', file: 'tests/a.spec.ts' }], WRITABLE), []);
  });

  it('rejects a change outside the writable folders', () => {
    const problems = scopeProblems(
      [
        { status: '??', file: 'tests/a.spec.ts' },
        { status: 'M', file: 'playwright.config.ts' },
      ],
      WRITABLE,
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /playwright\.config\.ts is outside/);
  });

  it('rejects deletions and moves', () => {
    const problems = scopeProblems(
      [
        { status: 'D', file: 'tests/login.spec.ts' },
        { status: 'R', file: 'tests/b.spec.ts', from: 'tests/a.spec.ts' },
      ],
      WRITABLE,
    );
    assert.ok(problems.some((p) => /login\.spec\.ts was deleted/.test(p)));
    assert.ok(problems.some((p) => /a\.spec\.ts was moved/.test(p)));
  });

  it('needs at least one spec file', () => {
    assert.deepEqual(scopeProblems([{ status: 'M', file: 'pages/CartPage.ts' }], WRITABLE), ['no spec file was added or changed']);
  });
});

describe('removedLines', () => {
  it('flags existing files that lost lines, including page objects, and skips binaries', () => {
    const numstat = ['12\t0\ttests/cart.spec.ts', '3\t2\ttests/login.spec.ts', '4\t4\tpages/CartPage.ts', '-\t-\ttests/img.png', ''].join('\0');
    assert.deepEqual(removedLines(numstat), [
      { file: 'tests/login.spec.ts', removed: 2 },
      { file: 'pages/CartPage.ts', removed: 4 },
    ]);
  });

  it('reads unusual file names unquoted', () => {
    assert.deepEqual(removedLines('1\t1\ttests/café.spec.ts\0'), [{ file: 'tests/café.spec.ts', removed: 1 }]);
  });
});

describe('patchPaths', () => {
  it('lists every path a patch touches, both sides of a rename', () => {
    const numstat = ['3\t0\ttests/a.spec.ts', '0\t0\t', 'tests/old.spec.ts', 'agents/stages.ts', '1\t1\tpackage.json', ''].join('\0');
    assert.deepEqual(patchPaths(numstat), ['tests/a.spec.ts', 'tests/old.spec.ts', 'agents/stages.ts', 'package.json']);
  });
});

describe('addedSkips', () => {
  it('finds added skips and focuses, not removed ones or test.fail', () => {
    const patch = ['+    test.skip();', "+  test.describe.only('x', () => {", '+test.fixme(true);', "+test.fail(true, 'bug: AC-1 x');", '-test.skip();'].join('\n');
    assert.deepEqual(addedSkips(patch), ['test.skip();', "test.describe.only('x', () => {", 'test.fixme(true);']);
  });
});

describe('expected-failure markers', () => {
  const patch = (...lines: string[]): string => ['+++ b/tests/x.spec.ts', ...lines.map((l) => `+${l}`), '-    test.fail();'].join('\n');
  const built = { key: 'SHOP-12', mode: 'built' as const };
  const testFirst = { key: 'SHOP-12', mode: 'test-first' as const };

  it('finds added markers and their reasons, not removed ones', () => {
    const markers = addedMarkers(patch("    test.fail(true, 'bug: AC-3 the total ignores tax');", '    test.fail();'));
    assert.deepEqual(
      markers.map((m) => m.reason),
      ['bug: AC-3 the total ignores tax', null],
    );
  });

  it('accepts a bug marker that names a criterion and was reported', () => {
    const markers = addedMarkers(patch("test.fail(true, 'bug: AC-3 tax missing (shows $0.00)');"));
    assert.deepEqual(markerProblems(markers, built, 1), []);
  });

  it('rejects a marker without a reason', () => {
    assert.match(markerProblems(addedMarkers(patch('test.fail();')), built, 0).join(), /has no reason/);
  });

  it('rejects more bug markers than reported bugs', () => {
    const markers = addedMarkers(patch("test.fail(true, 'bug: AC-1 x');", "test.fail(true, 'bug: AC-2 y');"));
    assert.match(markerProblems(markers, built, 1).join(), /only 1 suspected bugs/);
  });

  it('rejects a bug marker that does not name its criterion', () => {
    assert.match(markerProblems(addedMarkers(patch("test.fail(true, 'bug: broken');")), built, 1).join(), /does not name the criterion/);
  });

  it('rejects "not built yet" when the feature is built', () => {
    assert.match(markerProblems(addedMarkers(patch("test.fail(true, 'not built yet: SHOP-12');")), built, 0).join(), /not in test-first mode/);
  });

  it('needs at least one "not built yet" marker in test-first mode, naming the right key', () => {
    assert.match(markerProblems([], testFirst, 0).join(), /no test is marked/);
    assert.match(markerProblems(addedMarkers(patch("test.fail(true, 'not built yet: SHOP-1');")), testFirst, 0).join(), /does not name SHOP-12/);
    assert.deepEqual(markerProblems(addedMarkers(patch("test.fail(true, 'not built yet: SHOP-12');")), testFirst, 0), []);
  });

  it('rejects an unknown reason', () => {
    assert.match(markerProblems(addedMarkers(patch("test.fail(true, 'flaky on CI');")), built, 0).join(), /must start with/);
  });
});

describe('the outcome of a Playwright JSON report', () => {
  const report = {
    suites: [
      {
        title: 'sorting.spec.ts',
        suites: [
          {
            title: 'Product sorting',
            specs: [
              {
                title: 'sorts by price',
                tests: [
                  {
                    expectedStatus: 'failed',
                    status: 'expected',
                    annotations: [{ type: 'fail', description: 'not built yet: SHOP-12' }],
                    results: [{ status: 'failed', errors: [{ message: "\u001b[31mError: expect(locator).toBeVisible() failed\u001b[39m\nLocator: getByTestId('sort')" }] }],
                  },
                ],
              },
              {
                title: 'keeps the order after a reload',
                tests: [
                  {
                    expectedStatus: 'failed',
                    status: 'expected',
                    results: [{ status: 'failed', errors: [{ message: "TypeError: Cannot read properties of undefined (reading 'click')" }] }],
                  },
                ],
              },
              { title: 'lists six products', tests: [{ expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed' }] }] },
            ],
          },
        ],
      },
    ],
  };

  it('flattens tests with their full titles, markers and errors', () => {
    const [first, , third] = outcomes(report);
    assert.equal(first.title, 'Product sorting > sorts by price');
    assert.equal(first.expectedToFail, true);
    assert.deepEqual(first.reasons, ['not built yet: SHOP-12']);
    assert.match(first.errors[0], /^Error: expect/);
    assert.equal(third.expectedToFail, false);
  });

  it('accepts an expected failure caused by the app, rejects one caused by the test', () => {
    const problems = wrongReasons(outcomes(report));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /keeps the order after a reload.*TypeError/);
  });

  it('rejects a "not built yet" test whose failure never touches the page', () => {
    const outcome = {
      file: 'x.spec.ts',
      title: 'search finds the backpack',
      tags: [],
      status: 'expected',
      expectedToFail: true,
      reasons: ['not built yet: SHOP-12'],
      errors: ['Error: expect(received).toBe(expected)\n\nExpected: 2\nReceived: 1'],
    };
    assert.match(wrongReasons([outcome]).join(), /nothing to do with the page/);
    const onThePage = { ...outcome, errors: ["Error: locator.fill: Test timeout of 30000ms exceeded.\nCall log:\n  - waiting for getByRole('searchbox')"] };
    assert.deepEqual(wrongReasons([onThePage]), []);
  });
});

describe('traceability', () => {
  const strategy = {
    cases: [
      { layer: 'e2e', criteria: ['AC-1', 'AC-2'] },
      { layer: 'e2e', criteria: ['AC-3'] },
      { layer: 'manual', criteria: ['AC-4'] },
    ],
  } as Parameters<typeof missingCriteria>[2];

  it('lists e2e criteria no tagged test claims, and ignores other levels', () => {
    const specs = [{ tags: ['@SHOP-12', '@AC-1'] }, { tags: ['@SHOP-12', '@AC-2'] }, { tags: ['@SHOP-120', '@AC-3'] }];
    assert.deepEqual(missingCriteria(specs, 'SHOP-12', strategy), { mine: 2, wanted: ['AC-1', 'AC-2', 'AC-3'], missing: ['AC-3'] });
  });
});

describe('tagGrep', () => {
  it('matches the requirement and not a longer key that starts the same way', () => {
    const grep = new RegExp(tagGrep('REQ-1'));
    assert.ok(grep.test('Sorting @REQ-1 @AC-2 sorts by price'));
    assert.ok(!grep.test('Sorting @REQ-12 @AC-2 sorts by price'));
    assert.ok(!grep.test('Sorting @REQ-100'));
  });
});

describe('a key inside a marker', () => {
  it('does not accept a longer key as the right one', () => {
    const marker = [{ line: "test.fail(true, 'not built yet: SHOP-12')", reason: 'not built yet: SHOP-12' }];
    assert.match(markerProblems(marker, { key: 'SHOP-1', mode: 'test-first' }, 0).join(), /does not name SHOP-1/);
  });
});

describe('sensitivity', () => {
  it('reports which targets each test caught and names the tests that never failed', () => {
    const result = sensitivitySummary({
      targets: ['problem_user', 'error_user'],
      tests: [
        { title: 'sorts by price', caught: ['problem_user', 'error_user'] },
        { title: 'shows the dropdown', caught: [] },
      ],
    });
    assert.equal(result.caughtAny, true);
    assert.match(result.summary, /problem_user: 1 of 2/);
    assert.match(result.summary, /never failed: "shows the dropdown"/);
    assert.match(result.table, /\| sorts by price \| caught \| caught \|/);
  });

  it('says so when nothing was caught', () => {
    assert.equal(sensitivitySummary({ targets: ['problem_user'], tests: [{ title: 't', caught: [] }] }).caughtAny, false);
  });
});

describe('the full-suite gate', () => {
  const outcome = (title: string, tags: string[], status = 'unexpected') => ({ file: 'f.spec.ts', title, tags, status, expectedToFail: false, reasons: [], errors: [] });

  it('tells this requirement\'s failures from everyone else\'s by the tag', () => {
    const report = [outcome('Cart > new', ['REQ-17', 'AC-1']), outcome('Sort > old', ['REQ-1']), outcome('Login > fine', ['REQ-1'], 'expected')];
    const { mine, existing } = splitFailures(report, 'REQ-17');
    assert.deepEqual(mine.map((t) => t.title), ['Cart > new']);
    assert.deepEqual(existing.map((t) => t.title), ['Sort > old']);
    assert.deepEqual(splitFailures(report, 'REQ-170').mine, [], 'REQ-17 is not REQ-170');
  });

  it('builds a grep that runs exactly the failed tests again', () => {
    const grep = grepFor(['Sort > the right product opens (cheap)', 'Cart > badge']);
    assert.equal(grep, 'Sort the right product opens \\(cheap\\)$|Cart badge$');
    assert.match('chromium sort.spec.ts Sort the right product opens (cheap)', new RegExp(grep));
    assert.doesNotMatch('chromium sort.spec.ts Sort the right product opens (cheap) twice', new RegExp(grep));
  });
});
