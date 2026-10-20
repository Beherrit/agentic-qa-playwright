import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { countAssertions, detectRisks, extractTests, findAssertionHelpers, scanSource } from '../lib/migrate/inventory.ts';
import { MAX_TESTS_PER_WAVE, planMigration } from '../lib/migrate/plan.ts';
import { RISKS, type Inventory, type Risk, type SourceFile } from '../lib/migrate/types.ts';

const NO_RISKS = Object.fromEntries(RISKS.map((risk) => [risk, 0])) as Record<Risk, number>;
const risks = (language: Parameters<typeof detectRisks>[0], content: string, filePath = 'x'): Risk[] => detectRisks(language, content, filePath);

describe('detectRisks: python', () => {
  it('shared-driver: a wide fixture that makes a driver, or a module-level driver', () => {
    assert.deepEqual(risks('python', '@pytest.fixture(scope="class")\ndef driver(request):\n    d = webdriver.Chrome()\n    yield d\n'), ['shared-driver']);
    assert.deepEqual(risks('python', "@pytest.fixture(scope='session')\ndef browser():\n    pass\n"), ['shared-driver']);
    assert.deepEqual(risks('python', 'driver = None\n\ndef setup():\n    pass\n'), ['shared-driver']);
    assert.deepEqual(risks('python', '@pytest.fixture(scope="session")\ndef config():\n    return {}\n'), []);
    assert.deepEqual(risks('python', '@pytest.fixture\ndef driver():\n    yield 1\n'), []);
  });

  it('ordered: order and dependency marks, or numbered test methods', () => {
    assert.deepEqual(risks('python', '@pytest.mark.run(order=1)\ndef test_a(): pass'), ['ordered']);
    assert.deepEqual(risks('python', '@pytest.mark.order(2)\ndef test_a(): pass'), ['ordered']);
    assert.deepEqual(risks('python', '@pytest.mark.dependency(depends=["a"])\ndef test_b(): pass'), ['ordered']);
    assert.deepEqual(risks('python', 'class T:\n    def test_01_login(self): pass\n    def test_02_cart(self): pass\n'), ['ordered']);
    assert.deepEqual(risks('python', 'class T:\n    def test_01_login(self): pass\n    def test_cart(self): pass\n'), []);
  });

  it('static-state, sleep and implicit-wait', () => {
    assert.deepEqual(risks('python', 'count = 0\ndef bump():\n    global count\n    count += 1\n'), ['static-state']);
    assert.deepEqual(risks('python', 'import time\ntime.sleep(2)\n'), ['sleep']);
    assert.deepEqual(risks('python', 'from time import sleep\nsleep(1)\n'), ['sleep']);
    assert.deepEqual(risks('python', 'driver.implicitly_wait(10)\n'), ['implicit-wait']);
    assert.deepEqual(risks('python', 'driver.implicitly_wait(config["timeouts"]["implicit"])\n'), ['implicit-wait']);
    assert.deepEqual(risks('python', 'driver.implicitly_wait(0)\n'), []);
  });

  it('retry-loop: a loop with a sleep and a lookup close together, not either alone', () => {
    const retry = 'for attempt in range(3):\n    try:\n        el = driver.find_element(By.ID, "x")\n        break\n    except Exception:\n        time.sleep(1)\n';
    assert.deepEqual(risks('python', retry), ['sleep', 'retry-loop']);
    assert.deepEqual(risks('python', 'time.sleep(1)\nel = driver.find_element(By.ID, "x")\n'), ['sleep']);
    assert.deepEqual(risks('python', 'for a in range(3):\n    el = driver.find_element(By.ID, "x")\n'), []);
  });

  it('grid: a remote driver or a hub setting, in code or in a config file', () => {
    assert.deepEqual(risks('python', 'driver = webdriver.Remote(command_executor="http://selenium-hub:4444/wd/hub", options=o)\n'), ['shared-driver', 'grid']);
    assert.deepEqual(risks('unknown', 'grid:\n  hub_url: http://hub:4444\n', 'config.yaml'), ['grid']);
    assert.deepEqual(risks('unknown', 'SELENIUM_HUB=http://hub\n', '.env.example'), ['grid']);
    assert.deepEqual(risks('python', 'caps = DesiredCapabilities.CHROME\n'), ['grid']);
  });

  it('a quiet file has no risks', () => {
    assert.deepEqual(risks('python', 'def test_a(driver):\n    assert driver.title\n'), []);
  });
});

describe('detectRisks: java', () => {
  it('shared-driver: a static driver, or a class-level setup that makes one', () => {
    assert.deepEqual(risks('java', 'public class T { static WebDriver driver; }'), ['shared-driver']);
    assert.deepEqual(risks('java', 'private static RemoteWebDriver d;'), ['shared-driver', 'grid']);
    assert.deepEqual(risks('java', '@BeforeClass\npublic void up() { driver = new ChromeDriver(); }'), ['shared-driver']);
    assert.deepEqual(risks('java', '@BeforeAll\nstatic void up() { WebDriverManager.chromedriver().setup(); }'), ['shared-driver']);
    assert.deepEqual(risks('java', '@BeforeClass\npublic void up() { seedDatabase(); }'), []);
  });

  it('ordered: dependency, priority and order annotations, and a testng file that preserves order', () => {
    assert.deepEqual(risks('java', '@Test(dependsOnMethods = {"login"})\nvoid cart() {}'), ['ordered']);
    assert.deepEqual(risks('java', '@Test(priority = 2)\nvoid cart() {}'), ['ordered']);
    assert.deepEqual(risks('java', '@Order(1)\n@Test void a() {}'), ['ordered']);
    assert.deepEqual(risks('java', '@FixMethodOrder(MethodSorters.NAME_ASCENDING)\nclass T {}'), ['ordered']);
    assert.deepEqual(risks('java', '@TestMethodOrder(OrderAnnotation.class)\nclass T {}'), ['ordered']);
    assert.deepEqual(risks('unknown', '<suite name="s" preserve-order="true"></suite>', 'testng.xml'), ['ordered']);
    assert.deepEqual(risks('unknown', '<suite name="s" preserve-order="false"></suite>', 'testng.xml'), []);
  });

  it('static-state: a static non-final field that a method assigns, in a test or page file only', () => {
    const body = 'public class CartTest {\n  private static int counter;\n  @Test public void a() {\n    counter = counter + 1;\n  }\n}\n';
    assert.deepEqual(risks('java', body, 'src/CartTest.java'), ['static-state']);
    assert.deepEqual(risks('java', body, 'src/Cart.java'), []);
    assert.deepEqual(risks('java', body.replace('static int', 'static final int'), 'src/CartTest.java'), []);
    assert.deepEqual(risks('java', 'class CartPage {\n  static int hits = 0;\n  void click() {\n    hits++;\n  }\n}\n', 'src/CartPage.java'), ['static-state']);
    assert.deepEqual(risks('java', 'class CartPage {\n  static int hits = 0;\n  void click() {}\n}\n', 'src/CartPage.java'), []);
  });

  it('sleep, implicit-wait, retry-loop and grid', () => {
    assert.deepEqual(risks('java', 'Thread.sleep(500);'), ['sleep']);
    assert.deepEqual(risks('java', 'driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(5));'), ['implicit-wait']);
    const retry = 'for (int i = 0; i < 3; i++) {\n  try { driver.findElement(By.id("x")); break; }\n  catch (Exception e) { Thread.sleep(500); }\n}\n';
    assert.deepEqual(risks('java', retry), ['sleep', 'retry-loop']);
    assert.deepEqual(risks('java', 'driver = new RemoteWebDriver(new URL("http://localhost:4444/wd/hub"), caps);'), ['grid']);
  });
});

describe('detectRisks: csharp, javascript and ruby', () => {
  it('csharp', () => {
    assert.deepEqual(risks('csharp', 'static IWebDriver driver;'), ['shared-driver']);
    assert.deepEqual(risks('csharp', '[OneTimeSetUp] public void Up() {}'), ['shared-driver']);
    assert.deepEqual(risks('csharp', '[ClassInitialize] public static void Up(TestContext c) {}'), ['shared-driver']);
    assert.deepEqual(risks('csharp', '[Test, Order(1)]\npublic void A() {}'), ['ordered']);
    assert.deepEqual(risks('csharp', '[Order(1)]\n[Test] public void A() {}'), ['ordered']);
    assert.deepEqual(risks('csharp', 'Thread.Sleep(100);'), ['sleep']);
    assert.deepEqual(risks('csharp', 'driver.Manage().Timeouts().ImplicitWait = TimeSpan.FromSeconds(5);'), ['implicit-wait']);
    assert.deepEqual(risks('csharp', 'class CartTests {\n  static int total;\n  [Test] public void A() {\n    total += 2;\n  }\n}\n', 'CartTests.cs'), ['static-state']);
  });

  it('javascript and typescript', () => {
    assert.deepEqual(risks('javascript', "before(async () => { driver = await new Builder().forBrowser('chrome').build(); });"), ['shared-driver']);
    assert.deepEqual(risks('javascript', 'before(() => seed());'), []);
    assert.deepEqual(risks('typescript', "describe.serial('flow', () => {});"), ['ordered']);
    assert.deepEqual(risks('javascript', 'await new Promise((r) => setTimeout(r, 500));'), ['sleep']);
    assert.deepEqual(risks('javascript', 'await sleep(500);'), ['sleep']);
    assert.deepEqual(risks('javascript', 'driver.manage().setTimeouts({ implicit: 5000 });'), ['implicit-wait']);
  });

  it('ruby sleeps', () => {
    assert.deepEqual(risks('ruby', "click_button 'Go'\nsleep 2\n"), ['sleep']);
    assert.deepEqual(risks('ruby', 'asleep = 1\n'), []);
  });
});

describe('assertion helpers', () => {
  const UTIL = ['def open_page(driver):', '    driver.get(URL)', '', 'def check_cart(driver, n):', '    count = len(driver.find_elements(By.CSS_SELECTOR, ".item"))', '    assert count == n', '', 'def later():', '    pass', ''].join('\n');

  it('python: finds a def whose body asserts, and not one that only acts', () => {
    assert.deepEqual(findAssertionHelpers('python', UTIL), ['check_cart']);
  });

  it('a test that calls a helper makes its assertions', () => {
    const test = 'def test_cart(driver):\n    open_page(driver)\n    check_cart(driver, 2)\n    assert driver.title\n';
    assert.equal(extractTests('python', test)[0].assertions, 1);
    assert.equal(extractTests('python', test, ['check_cart'])[0].assertions, 2);
    assert.equal(extractTests('python', 'def test_x(d):\n    checks.check_cart(d, 1)\n', ['check_cart'])[0].assertions, 1);
    assert.equal(countAssertions('python', 'def check_cart(d):\n    pass', ['check_cart']), 0);
    assert.equal(countAssertions('python', 'recheck_cart(d)\nx = 1', ['check_cart']), 0);
  });

  it('java: finds a method with the body on the same line or in braces', () => {
    const util = 'public class Checks {\n  public static void assertCartCount(WebDriver d, int n) {\n    Assert.assertEquals(d.findElements(By.id("i")).size(), n);\n  }\n  public void open() { driver.get(URL); }\n  void abstractOne();\n}\n';
    assert.deepEqual(findAssertionHelpers('java', util), ['assertCartCount']);
  });

  it('csharp: finds a method whose brace is on the next line', () => {
    const util = 'class Checks\n{\n    public void CheckBadge(int n)\n    {\n        Assert.AreEqual(n, 1);\n    }\n    public void Open()\n    {\n        driver.Url = "x";\n    }\n}\n';
    assert.deepEqual(findAssertionHelpers('csharp', util), ['CheckBadge']);
  });

  it('javascript: functions, arrow functions and expression bodies', () => {
    const util = [
      "function checkTitle(t) { expect(t).toBe('x'); }",
      'const verify = async (p) => {',
      '  await expect(p).toBeVisible();',
      '};',
      'const quick = (x) => expect(x).toBe(1);',
      'const noop = () => 1;',
      'if (ready) {',
      '  expect(1).toBe(1);',
      '}',
    ].join('\n');
    assert.deepEqual(findAssertionHelpers('javascript', util), ['checkTitle', 'verify', 'quick']);
  });

  it('the widened patterns count', () => {
    assert.equal(countAssertions('python', 'pytest.fail("no")\nself.fail("no")'), 2);
    assert.equal(countAssertions('java', 'softAssert.assertEquals(1, 1);\nassertAll();\nAssertions.assertTrue(x);\nx.should(be);'), 4);
    assert.equal(countAssertions('java', 'SoftAssert softAssert = new SoftAssert();'), 0);
    assert.equal(countAssertions('csharp', 'Expect(x, Is.True);\nAssert.That(x);\nx.Should().Be(1);'), 3);
    assert.equal(countAssertions('javascript', 'x.should.equal(1);\nchai.expect(1).to.equal(1);\nassert.ok(x);'), 3);
  });

  it('scanSource counts helper calls in tests and totals the risks', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risks-'));
    try {
      const files = {
        'pytest.ini': '[pytest]',
        'utils/checks.py': 'def check_cart(driver, n):\n    assert n == 1\n',
        'tests/test_a.py': 'def test_a(driver):\n    check_cart(driver, 1)\n    assert driver\n',
        'tests/test_b.py': 'import time\n\ndef test_b(driver):\n    time.sleep(1)\n    assert driver\n',
      };
      for (const [name, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
        fs.writeFileSync(path.join(root, name), body);
      }
      const inventory = scanSource(root);
      assert.deepEqual(inventory.assertionHelpers, ['check_cart']);
      assert.equal(inventory.files.find((f) => f.path === 'tests/test_a.py')?.tests[0].assertions, 2);
      assert.deepEqual(inventory.files.find((f) => f.path === 'tests/test_b.py')?.risks, ['sleep']);
      assert.deepEqual(inventory.totals.risks, { ...NO_RISKS, sleep: 1 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('planMigration: chunking and risks', () => {
  const tests = (count: number, assertionsOf: (n: number) => number) => Array.from({ length: count }, (_, i) => ({ name: `t${i + 1}`, line: i + 1, assertions: assertionsOf(i + 1) }));
  const suite = (p: string, count: number, assertionsOf: (n: number) => number, over: Partial<SourceFile> = {}): SourceFile => {
    const list = tests(count, assertionsOf);
    return { path: p, kind: 'test', language: 'python', lines: 100, tests: list, assertions: list.reduce((n, t) => n + t.assertions, 0), imports: [], login: false, risks: [], ...over };
  };
  const inventory: Inventory = {
    root: '/src',
    language: 'python',
    framework: 'pytest',
    configFiles: [],
    assertionHelpers: [],
    totals: { tests: 0, assertions: 0, files: 0, risks: NO_RISKS },
    files: [
      suite('tests/test_big.py', 23, (n) => n, { risks: ['grid', 'sleep'] }),
      suite('tests/test_edge.py', 10, () => 1),
      suite('tests/test_small.py', 2, () => 1, { risks: ['ordered'] }),
      { ...suite('pages/a_page.py', 0, () => 0, { risks: ['ordered'] }), kind: 'page' },
      { ...suite('utils/waits.py', 0, () => 0, { risks: ['grid'] }), kind: 'util' },
    ],
  };
  const plan = planMigration(inventory);

  it('splits a file of 23 tests into waves of 10, 10 and 3, with the names each covers', () => {
    assert.equal(MAX_TESTS_PER_WAVE, 10);
    const big = plan.waves.filter((w) => w.sources[0] === 'tests/test_big.py');
    assert.deepEqual(big.map((w) => w.id), ['suite-test_big-1', 'suite-test_big-2', 'suite-test_big-3']);
    assert.deepEqual(big.map((w) => w.tests), [10, 10, 3]);
    assert.deepEqual(big.map((w) => w.assertions), [55, 155, 66]);
    assert.deepEqual(big[0].names, tests(10, () => 0).map((t) => t.name));
    assert.deepEqual(big[2].names, ['t21', 't22', 't23']);
    assert.deepEqual(big.map((w) => w.name), ['test_big (part 1 of 3)', 'test_big (part 2 of 3)', 'test_big (part 3 of 3)']);
    assert.ok(big.every((w) => w.kind === 'suite'));
  });

  it('keeps a file of ten tests whole, and orders suites by assertions with chunks together', () => {
    const edge = plan.waves.find((w) => w.id === 'suite-test_edge');
    assert.ok(edge);
    assert.equal(edge.names, undefined);
    assert.equal(edge.tests, 10);
    const suites = plan.waves.filter((w) => w.kind === 'suite').map((w) => w.id);
    assert.deepEqual(suites, ['suite-test_small', 'suite-test_edge', 'suite-test_big-1', 'suite-test_big-2', 'suite-test_big-3']);
  });

  it('gives every wave the union of its sources risks, in the order of RISKS', () => {
    const byId = new Map(plan.waves.map((w) => [w.id, w.risks]));
    assert.deepEqual(byId.get('utils'), ['ordered', 'grid']);
    assert.deepEqual(byId.get('suite-test_small'), ['ordered']);
    assert.deepEqual(byId.get('suite-test_edge'), []);
    assert.deepEqual(byId.get('suite-test_big-2'), ['sleep', 'grid']);
  });
});
