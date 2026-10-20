import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkParity, checkRules, mutateExpect, riskGuidance, type Dropped, type Mapping } from '../lib/migrate/parity.ts';
import { RISKS, type Inventory } from '../lib/migrate/types.ts';

describe('checkParity', () => {
  const SRC = 'def test_one():\n    assert page.title == "Shop"\n    assert   count == 6\ndef test_two():\n    assert ok\n';
  const TGT = "import { test, expect } from '../fixtures/test.ts';\ntest('one', async ({ page }) => {\n  await expect(page).toHaveTitle('Shop');\n  expect(count).toBe(6);\n});\n";
  const inventory: Inventory = {
    root: '/src',
    language: 'python',
    framework: 'pytest',
    configFiles: [],
    assertionHelpers: [],
    totals: { tests: 2, assertions: 3, files: 1, risks: { 'shared-driver': 0, ordered: 0, 'static-state': 0, sleep: 0, 'implicit-wait': 0, 'retry-loop': 0, grid: 0 } },
    files: [{ path: 'tests/test_a.py', kind: 'test', language: 'python', lines: 5, tests: [{ name: 'test_one', line: 1, assertions: 2 }, { name: 'test_two', line: 4, assertions: 1 }], assertions: 3, imports: [], login: false, risks: [] }],
  };
  const wave = { sources: ['tests/test_a.py'] };
  const mapping: Mapping = {
    source: { file: 'tests/test_a.py', name: 'test_one' },
    target: { file: 'specs/a.spec.ts', title: 'one' },
    assertions: [{ source: 'assert page.title == "Shop"', target: "await expect(page).toHaveTitle('Shop');" }, { source: 'assert count == 6', target: 'expect(count).toBe(6);' }],
  };
  const dropped: Dropped = { source: { file: 'tests/test_a.py', name: 'test_two' }, reason: 'covered by the API suite' };
  const reads = (target: string | null = TGT) => [(f: string) => (f === 'tests/test_a.py' ? SRC : null), (f: string) => (f === 'specs/a.spec.ts' ? target : null)] as const;
  const run = (tests: Mapping[], drops: Dropped[], target?: string | null) => checkParity(wave, inventory, { tests, dropped: drops }, ...reads(target));

  it('passes when every test is mapped or dropped and every assertion is found', () => {
    const report = run([mapping], [dropped]);
    assert.deepEqual(report.problems, []);
    assert.deepEqual([report.passed, report.covered, report.total, report.mapped], [true, 2, 2, 1]);
  });

  it('rule a: a test that is missing or listed twice, or one the inventory never found', () => {
    assert.match(run([mapping], []).problems.join('\n'), /"test_two" is neither converted nor dropped/);
    assert.match(run([mapping, mapping], [dropped]).problems.join('\n'), /"test_one" is listed 2 times/);
    const invented = { ...mapping, source: { file: 'tests/test_a.py', name: 'test_ghost' } };
    assert.match(run([mapping, invented], [dropped]).problems.join('\n'), /"test_ghost" is not a test the inventory found/);
  });

  it('rule b: a dropped test needs a reason', () => {
    assert.match(run([mapping], [{ ...dropped, reason: '  ' }]).problems.join('\n'), /dropped with no reason/);
  });

  it('rule c: fewer assertions than the old test had', () => {
    const thin = { ...mapping, assertions: mapping.assertions.slice(0, 1) };
    assert.match(run([thin], [dropped]).problems.join('\n'), /2 assertions in the old test, only 1 mapped/);
  });

  it('rule d: quoted assertions must be in the files, whitespace aside', () => {
    const wrongSource = { ...mapping, assertions: [{ source: 'assert nothing', target: 'expect(count).toBe(6);' }, mapping.assertions[1]] };
    assert.match(run([wrongSource], [dropped]).problems.join('\n'), /old assertion not found.*assert nothing/);
    const wrongTarget = { ...mapping, assertions: [mapping.assertions[0], { source: 'assert count == 6', target: 'expect(count).toBe(7);' }] };
    assert.match(run([wrongTarget], [dropped]).problems.join('\n'), /new assertion not found.*toBe\(7\)/);
  });

  it('rule e: the target file and a test with the title must exist', () => {
    assert.match(run([mapping], [dropped], null).problems.join('\n'), /target file specs\/a\.spec\.ts does not exist/);
    const retitled = { ...mapping, target: { ...mapping.target, title: 'other' } };
    assert.match(run([retitled], [dropped]).problems.join('\n'), /no test titled "other"/);
    assert.deepEqual(run([mapping], [dropped], TGT.replace("test('one'", 'test("one"')).problems, []);
    assert.deepEqual(run([mapping], [dropped], TGT.replace("test('one'", 'test(`one`')).problems, []);
  });

  it('rule f: the target must import the shared test or Playwright', () => {
    assert.match(run([mapping], [dropped], TGT.replace(/^import.*\n/, "import { test, expect } from 'vitest';\n")).problems.join('\n'), /does not import from fixtures\/test\.ts or @playwright\/test/);
    assert.deepEqual(run([mapping], [dropped], TGT.replace('../fixtures/test.ts', '@playwright/test')).problems, []);
  });
});

describe('checkParity with a split file', () => {
  const inventory: Inventory = {
    root: '/src',
    language: 'python',
    framework: 'pytest',
    configFiles: [],
    assertionHelpers: [],
    totals: { tests: 2, assertions: 2, files: 1, risks: { 'shared-driver': 0, ordered: 0, 'static-state': 0, sleep: 0, 'implicit-wait': 0, 'retry-loop': 0, grid: 0 } },
    files: [{ path: 'tests/test_a.py', kind: 'test', language: 'python', lines: 4, tests: [{ name: 'test_one', line: 1, assertions: 1 }, { name: 'test_two', line: 3, assertions: 1 }], assertions: 2, imports: [], login: false, risks: [] }],
  };
  const SRC = 'def test_one():\n    assert a\ndef test_two():\n    assert b\n';
  const TGT = "import { test, expect } from '@playwright/test';\ntest('one', async () => {\n  expect(a).toBe(1);\n});\ntest('two', async () => {\n  expect(b).toBe(1);\n});\n";
  const map = (name: string, title: string, source: string, target: string): Mapping => ({ source: { file: 'tests/test_a.py', name }, target: { file: 'specs/a.spec.ts', title }, assertions: [{ source, target }] });
  const one = map('test_one', 'one', 'assert a', 'expect(a).toBe(1);');
  const two = map('test_two', 'two', 'assert b', 'expect(b).toBe(1);');
  const run = (names: string[] | undefined, tests: Mapping[], dropped: Dropped[] = []) =>
    checkParity({ sources: ['tests/test_a.py'], names }, inventory, { tests, dropped }, (f) => (f === 'tests/test_a.py' ? SRC : null), (f) => (f === 'specs/a.spec.ts' ? TGT : null));

  it('expects only the named tests of the file', () => {
    const report = run(['test_one'], [one]);
    assert.deepEqual(report.problems, []);
    assert.deepEqual([report.passed, report.covered, report.total, report.mapped], [true, 1, 1, 1]);
  });

  it('still reports a named test that was not converted', () => {
    assert.match(run(['test_one', 'test_two'], [one]).problems.join('\n'), /"test_two" is neither converted nor dropped/);
  });

  it('reports a mapping or a dropped entry for a test of the same file that is not in this wave', () => {
    assert.match(run(['test_one'], [one, two]).problems.join('\n'), /"test_two" is not in this wave/);
    assert.match(run(['test_one'], [one], [{ source: { file: 'tests/test_a.py', name: 'test_two' }, reason: 'later' }]).problems.join('\n'), /"test_two" is not in this wave/);
    assert.match(run(['test_two'], [one, two]).problems.join('\n'), /"test_one" is not in this wave/);
  });

  it('with no names, expects the whole file as before', () => {
    assert.deepEqual(run(undefined, [one, two]).problems, []);
    assert.match(run(undefined, [one]).problems.join('\n'), /"test_two" is neither converted nor dropped/);
  });
});

describe('riskGuidance', () => {
  it('has one sentence for every risk', () => {
    for (const risk of RISKS) {
      const text = riskGuidance(risk);
      assert.ok(text.endsWith('.'), risk);
      assert.equal(text.split('. ').length, 1, risk);
    }
    assert.match(riskGuidance('shared-driver'), /fixture/);
    assert.match(riskGuidance('ordered'), /no test relies on an earlier one/);
    assert.match(riskGuidance('grid'), /workers/);
    assert.match(riskGuidance('sleep'), /locator or an expect/);
  });
});

describe('checkRules', () => {
  const bad = (code: string): string[] => checkRules('a.spec.ts', code);

  it('accepts a plain parallel-safe test', () => {
    assert.deepEqual(bad("import { test, expect } from '@playwright/test';\ntest('x', async ({ page }) => {\n  await page.goto('/cart');\n  await expect(page).toHaveURL(/cart/);\n});\n"), []);
  });

  it('flags each rule with its line', () => {
    const cases: [string, RegExp][] = [
      ["test.describe.configure({ mode: 'serial' });", /serial/],
      ['test.describe.configure({ mode: "serial" });', /serial/],
      ["test.describe.serial('x', () => {});", /serial/],
      ["test.only('x', async () => {});", /\.only/],
      ["test.describe.only('x', () => {});", /\.only/],
      ["test.skip('x', async () => {});", /skipped/],
      ["test.fixme(true, 'later');", /skipped/],
      ['await page.waitForTimeout(500);', /waitForTimeout/],
      ["await page.waitForSelector('.x');", /waitForSelector/],
      ['await sleep(100);', /sleep/],
      ['process.exit(1);', /process\.exit/],
      ["await page.goto('http://localhost:3000/cart');", /absolute URL/],
      ['await page.goto(`https://shop.test/cart`);', /absolute URL/],
    ];
    for (const [code, expected] of cases) {
      const problems = bad(`// header\n${code}\n`);
      assert.equal(problems.length, 1, code);
      assert.match(problems[0], expected);
      assert.ok(problems[0].startsWith('a.spec.ts:2:'), problems[0]);
    }
  });

  it('flags module-level state that tests assign, but not a constant or a local', () => {
    const shared = bad("let cart = 0;\ntest('x', async () => {\n  cart = 1;\n});\n");
    assert.equal(shared.length, 1);
    assert.match(shared[0], /^a\.spec\.ts:1: "cart" is module-level state/);
    assert.deepEqual(bad("const base = 1;\nlet unused = 0;\ntest('x', async () => {\n  let local = 1;\n  local = 2;\n  expect(local === 2).toBe(true);\n});\n"), []);
  });

  it('ignores commented-out code', () => {
    assert.deepEqual(bad('// await page.waitForTimeout(1);\n  * test.only is bad\n'), []);
  });
});

describe('mutateExpect', () => {
  const FILE = [
    "import { test, expect } from '@playwright/test';",
    "test('first', async ({ page }) => {",
    '  await page.goto("/");',
    '  await expect(page.getByRole(\'heading\', { name: "A (b)" })).toBeVisible();',
    '  expect.soft(page).toHaveURL(/x/);',
    '});',
    "test('second', async ({ page }) => {",
    '  await expect(page.locator("#x")).not.toBeVisible();',
    '});',
    "test('quiet', async () => {});",
    '',
  ].join('\n');

  it('inserts .not after the first expect call, skipping parentheses inside strings', () => {
    const result = mutateExpect(FILE, 'first');
    assert.ok(result);
    assert.equal(result.line, 4);
    assert.equal(result.original, 'await expect(page.getByRole(\'heading\', { name: "A (b)" })).toBeVisible();');
    assert.ok(result.mutated.includes('{ name: "A (b)" })).not.toBeVisible();'));
    assert.equal(result.mutated.length, FILE.length + 4);
  });

  it('removes .not when the assertion has it', () => {
    const result = mutateExpect(FILE, 'second');
    assert.ok(result);
    assert.equal(result.line, 8);
    assert.ok(result.mutated.includes('expect(page.locator("#x")).toBeVisible();'));
    assert.equal(result.mutated.length, FILE.length - 4);
  });

  it('gives an assertion with an argument a wrong value, so a waiting assertion waits and fails', () => {
    const soft = mutateExpect("test('s', async () => {\n  expect.soft(a).toBe(1);\n});\n", 's');
    assert.equal(soft?.mutated, "test('s', async () => {\n  expect.soft(a).toBe('__mutant__');\n});\n");
    assert.equal(soft?.how, 'wrong value');
    const list = mutateExpect("test('l', async ({ cartPage }) => {\n  await expect(cartPage.itemNames).toHaveText([BACKPACK, 'x (y)']);\n});\n", 'l');
    assert.ok(list?.mutated.includes("toHaveText('__mutant__');"));
    const count = mutateExpect("test('c', async ({ p }) => {\n  await expect(p.items).toHaveCount(1);\n});\n", 'c');
    assert.ok(count?.mutated.includes('toHaveCount(987654);'));
    assert.equal(mutateExpect(FILE, 'first')?.how, 'added .not');
    assert.equal(mutateExpect(FILE, 'second')?.how, 'dropped .not');
  });

  it('returns null for a test with no expect or no such test', () => {
    assert.equal(mutateExpect(FILE, 'quiet'), null);
    assert.equal(mutateExpect(FILE, 'missing'), null);
  });

  it('stays inside the named test', () => {
    const result = mutateExpect("test('a', async () => {\n  await go();\n});\ntest('b', async () => {\n  expect(1).toBe(1);\n});\n", 'a');
    assert.equal(result, null);
  });
});
