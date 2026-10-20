import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { classify, countAssertions, detectFramework, detectLanguage, extractImports, extractTests, scanSource } from '../lib/migrate/inventory.ts';
import { planMigration, waveSummary } from '../lib/migrate/plan.ts';
import { RISKS, type Inventory, type Risk, type SourceFile } from '../lib/migrate/types.ts';

const PY = ['import pytest', 'from pages.login_page import LoginPage', 'class TestShop:', '    def test_a(self):', '        assert 1 == 1', '        self.assertEqual(1, 1)', 'def test_b():', '    x = 2', '    assert x', ''].join('\n');
const JAVA = ['import org.junit.Test;', 'import static org.junit.Assert.*;', 'public class CartTest {', '  @Test', '  public void addsItem() {', '    assertEquals(1, 1);', '    Assert.assertTrue(true);', '  }', '  @Test public void emptiesCart() throws Exception { assertThat(1); }', '}'].join('\n');
const CS = ['using NUnit.Framework;', 'using System;', '[TestFixture] public class CartTests {', '  [Test]', '  public void AddsItem() {', '    Assert.AreEqual(1, 1);', '    x.Should().Be(1);', '  }', '  [Fact]', '  public async Task Empties() { Assert.True(true); }', '}'].join('\n');
const JS = ["const { expect } = require('chai');", "describe('cart', () => {", "  it('adds an item', () => {", '    expect(1).to.equal(1);', '    assert.ok(true);', '  });', '  test("empties", () => { expect(2); });', '  latest("not a test");', '  /x/.test("y");', '});'].join('\n');
const RB = ["require 'rspec'", "require_relative 'spec_helper'", "describe 'cart' do", "  it 'adds an item' do", '    expect(1).to eq(1)', '    cart.should be_empty', '  end', 'end'].join('\n');

const NO_RISKS = Object.fromEntries(RISKS.map((risk) => [risk, 0])) as Record<Risk, number>;

const file = (over: Partial<SourceFile> & { path: string }): SourceFile => ({ kind: 'test', language: 'python', lines: 10, tests: [], assertions: 0, imports: [], login: false, risks: [], ...over });
const withTests = (p: string, names: [string, number][], over: Partial<SourceFile> = {}): SourceFile =>
  file({ path: p, tests: names.map(([name, assertions], i) => ({ name, line: i + 1, assertions })), assertions: names.reduce((n, [, a]) => n + a, 0), ...over });

describe('detect', () => {
  it('picks the language by majority of source files', () => {
    assert.equal(detectLanguage(['a.py', 'b.py', 'c.java', 'x.json']), 'python');
    assert.equal(detectLanguage(['A.java', 'B.cs', 'C.cs']), 'csharp');
    assert.equal(detectLanguage(['a.ts', 'b.js', 'c.ts']), 'typescript');
    assert.equal(detectLanguage(['a.rb']), 'ruby');
    assert.equal(detectLanguage(['readme.md']), 'unknown');
  });

  it('names the framework from its markers', () => {
    assert.equal(detectFramework('python', [{ path: 'conftest.py', content: '' }]), 'pytest');
    assert.equal(detectFramework('python', [{ path: 't.py', content: 'import unittest\nclass A(unittest.TestCase): pass' }]), 'unittest');
    assert.equal(detectFramework('java', [{ path: 'A.java', content: 'import org.testng.annotations.Test;' }]), 'testng');
    assert.equal(detectFramework('java', [{ path: 'A.java', content: 'import org.junit.Test;' }]), 'junit');
    assert.equal(detectFramework('csharp', [{ path: 'A.cs', content: '[TestMethod]' }]), 'mstest');
    assert.equal(detectFramework('csharp', [{ path: 'A.cs', content: '[TestFixture]' }]), 'nunit');
    assert.equal(detectFramework('javascript', [{ path: 'package.json', content: '{"devDependencies":{"mocha":"1"}}' }]), 'mocha');
    assert.equal(detectFramework('typescript', [{ path: 'package.json', content: '{"devDependencies":{"jest":"1"}}' }]), 'jest');
    assert.equal(detectFramework('ruby', [{ path: 'a_spec.rb', content: "require 'rspec'" }]), 'rspec');
    assert.equal(detectFramework('unknown', []), 'unknown');
  });

  it('classifies files by name first and content second', () => {
    assert.equal(classify('config.yaml', '', false), 'config');
    assert.equal(classify('pom.xml', '', false), 'config');
    assert.equal(classify('requirements.txt', '', false), 'config');
    assert.equal(classify('tests/test_cart.py', '', false), 'test');
    assert.equal(classify('src/CartTests.cs', '', false), 'test');
    assert.equal(classify('cart.spec.ts', '', false), 'test');
    assert.equal(classify('src/misc.js', "it('x', () => {})", true), 'test');
    assert.equal(classify('pages/cart.py', '', false), 'page');
    assert.equal(classify('src/Cart.java', 'public class CartPage {}', false), 'page');
    assert.equal(classify('utils/waits.py', '', false), 'util');
    assert.equal(classify('conftest.py', '', false), 'util');
    assert.equal(classify('src/model.py', '', false), 'other');
    assert.equal(classify('notes.txt', '', false), 'other');
  });
});

describe('extract', () => {
  it('reads python tests, including those in classes, with their assertions', () => {
    const tests = extractTests('python', PY);
    assert.deepEqual(tests, [{ name: 'test_a', line: 4, assertions: 2 }, { name: 'test_b', line: 7, assertions: 1 }]);
    assert.deepEqual(extractImports('python', PY), ['pytest', 'pages.login_page']);
    assert.deepEqual(extractImports('python', 'import os, sys as s\nfrom . import x\nfrom ..a.b import c'), ['os', 'sys', '.', '..a.b']);
  });

  it('reads java methods that follow an annotation, on the next line or the same one', () => {
    assert.deepEqual(extractTests('java', JAVA).map((t) => [t.name, t.assertions]), [['addsItem', 2], ['emptiesCart', 1]]);
    assert.deepEqual(extractImports('java', JAVA), ['org.junit.Test', 'org.junit.Assert.*']);
  });

  it('reads csharp methods annotated Test and Fact', () => {
    assert.deepEqual(extractTests('csharp', CS).map((t) => [t.name, t.assertions]), [['AddsItem', 2], ['Empties', 1]]);
    assert.deepEqual(extractImports('csharp', CS), ['NUnit.Framework', 'System']);
  });

  it('reads it and test titles in javascript and ignores lookalikes', () => {
    const tests = extractTests('javascript', JS);
    assert.deepEqual(tests.map((t) => [t.name, t.assertions]), [['adds an item', 2], ['empties', 1]]);
    assert.deepEqual(extractImports('javascript', JS), ['chai']);
    assert.deepEqual(extractImports('typescript', "import { a } from './a.ts';\nimport 'side';"), ['./a.ts', 'side']);
  });

  it('reads ruby it blocks', () => {
    assert.deepEqual(extractTests('ruby', RB).map((t) => [t.name, t.assertions]), [['adds an item', 2]]);
    assert.deepEqual(extractImports('ruby', RB), ['rspec', 'spec_helper']);
  });

  it('counts a line once however many patterns it matches', () => {
    assert.equal(countAssertions('python', 'assert x\nself.assertTrue(y)\nassert z; self.assertEqual(1, 1)\nprint(1)'), 3);
    assert.equal(countAssertions('typescript', 'await expect(a).toBe(1);\nassert.equal(1, 1);\nassert(x);'), 3);
    assert.equal(countAssertions('unknown', 'assert x'), 0);
  });
});

describe('scanSource', () => {
  it('walks a folder, skips dependency folders and hidden ones, and totals tests', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
    try {
      for (const [name, body] of Object.entries({ 'pytest.ini': '[pytest]', 'tests/test_a.py': PY, 'pages/home_page.py': 'class HomePage: pass', 'node_modules/x/test_z.py': PY, '.hidden/test_h.py': PY, 'venv/test_v.py': PY })) {
        fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
        fs.writeFileSync(path.join(root, name), body);
      }
      const inventory = scanSource(root);
      assert.equal(inventory.language, 'python');
      assert.equal(inventory.framework, 'pytest');
      assert.deepEqual(inventory.configFiles, ['pytest.ini']);
      assert.deepEqual(inventory.files.map((f) => f.path), ['pages/home_page.py', 'pytest.ini', 'tests/test_a.py']);
      assert.deepEqual(inventory.totals, { tests: 2, assertions: 3, files: 3, risks: NO_RISKS });
      assert.deepEqual(inventory.assertionHelpers, []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('planMigration', () => {
  const inventory: Inventory = {
    root: '/src',
    language: 'python',
    framework: 'pytest',
    configFiles: ['config.yaml'],
    assertionHelpers: [],
    totals: { tests: 0, assertions: 0, files: 0, risks: NO_RISKS },
    files: [
      file({ path: 'config.yaml', kind: 'config', language: 'unknown' }),
      withTests('tests/test_big.py', [['a', 5], ['b', 4]]),
      withTests('tests/test_small.py', [['c', 1]]),
      withTests('tests/test_login.py', [['d', 2]], { login: true }),
      file({ path: 'pages/cart_page.py', kind: 'page' }),
      file({ path: 'pages/login_page.py', kind: 'page', login: true }),
      file({ path: 'utils/waits.py', kind: 'util' }),
      file({ path: 'model.py', kind: 'other' }),
    ],
  };

  it('orders settings, utils, login, then suites smallest first', () => {
    const plan = planMigration(inventory);
    assert.deepEqual(plan.waves.map((w) => w.id), ['settings', 'utils', 'login', 'suite-test_small', 'suite-test_big']);
    assert.deepEqual(plan.waves.map((w) => w.kind), ['settings', 'utils', 'login', 'suite', 'suite']);
    assert.deepEqual(plan.waves[1].sources, ['pages/cart_page.py', 'utils/waits.py']);
    assert.deepEqual(plan.waves[2].sources, ['pages/login_page.py', 'tests/test_login.py']);
    assert.deepEqual([plan.waves[4].tests, plan.waves[4].assertions], [2, 9]);
    assert.equal(plan.language, 'python');
  });

  it('leaves out waves that would be empty and keeps suite ids unique', () => {
    const small: Inventory = { ...inventory, configFiles: [], files: [withTests('a/test_x.py', [['t', 1]]), withTests('b/test_x.py', [['t', 1]])] };
    const ids = planMigration(small).waves.map((w) => w.id);
    assert.equal(ids.length, 2);
    assert.equal(new Set(ids).size, 2);
    assert.ok(ids.every((id) => id.startsWith('suite-')));
  });

  it('renders a markdown table', () => {
    const lines = waveSummary(planMigration(inventory)).split('\n');
    assert.equal(lines[0], '| Wave | Kind | Sources | Tests | Assertions |');
    assert.equal(lines.length, 2 + 5);
    assert.ok(lines.some((l) => l.startsWith('| test_big | suite | tests/test_big.py | 2 | 9 |')));
  });
});

const SHOP = path.resolve(import.meta.dirname, '../evals/fixtures/selenium-shop');

describe('the selenium-shop fixture', () => {
  it('scans to python and pytest with the login file and a plan that starts settings, utils, login', (t) => {
    if (!fs.existsSync(SHOP)) return t.skip('fixture folder not present');
    const inventory = scanSource(SHOP);
    assert.equal(inventory.language, 'python');
    assert.equal(inventory.framework, 'pytest');
    assert.ok(inventory.files.filter((f) => f.kind === 'test').length >= 3);
    assert.ok(inventory.totals.tests >= 8);
    assert.equal(inventory.files.find((f) => f.path === 'tests/test_login.py')?.tests.length, 3);
    const plan = planMigration(inventory);
    assert.deepEqual(plan.waves.slice(0, 3).map((w) => w.kind), ['settings', 'utils', 'login']);
    assert.ok(plan.waves.slice(3).length >= 2 && plan.waves.slice(3).every((w) => w.kind === 'suite'));
  });
});
