import type { Language, Risk } from './types.ts';

/**
 * The per-language regex tables the scanner reads. Kept apart from the functions that use them so a new language is
 * a change to this file only. Every pattern is applied to one line at a time.
 */

export const LANGUAGE_BY_EXTENSION: Record<string, Language> = {
  '.py': 'python',
  '.java': 'java',
  '.cs': 'csharp',
  '.js': 'javascript',
  '.ts': 'typescript',
  '.rb': 'ruby',
};

/** Lines that count as one assertion each. A line matching several patterns still counts once. */
export const ASSERTION_PATTERNS: Record<Language, RegExp[]> = {
  python: [/^\s*assert\b/, /self\.assert\w+\(/, /\bpytest\.fail\(/, /\bself\.fail\(/],
  java: [/Assert\.\w+\(/, /\bassert\w+\(/, /\bassertThat\(/, /\bsoftAssert\.\w+\(/i, /\.should\(/, /\bAssertions\.\w+\(/],
  csharp: [/Assert\.\w+\(/, /\.Should\(\)/, /\bExpect\(/],
  javascript: [/\bexpect\(/, /\bassert\.\w+\(/, /\bassert\(/, /\bshould\./, /\bchai\.(?:expect|assert|should)\b/],
  typescript: [/\bexpect\(/, /\bassert\.\w+\(/, /\bassert\(/, /\bshould\./, /\bchai\.(?:expect|assert|should)\b/],
  ruby: [/\bexpect\(/, /\.should\b/],
  unknown: [],
};

/**
 * A line that starts a test. Group 1 is the name when the name is on the same line. The annotation languages (java,
 * csharp) name the method on a later line, so their pattern only marks the annotation.
 */
export const TEST_PATTERNS: Record<Language, RegExp> = {
  python: /^\s*(?:async\s+)?def\s+(test\w*)\s*\(/,
  java: /^\s*@(?:Test|ParameterizedTest|RepeatedTest)\b/,
  csharp: /^\s*\[(?:Test|TestMethod|Fact|Theory|TestCase)\b/,
  javascript: /(?<![\w.$])(?:it|test)(?:\.\w+)?\s*\(\s*(['"`])((?:\.|(?!\1).)*)\1/,
  typescript: /(?<![\w.$])(?:it|test)(?:\.\w+)?\s*\(\s*(['"`])((?:\.|(?!\1).)*)\1/,
  ruby: /^\s*(?:it|specify|scenario)\s*\(?\s*(['"])((?:\.|(?!\1).)*)\1/,
  unknown: /(?!)/,
};

/** Where an annotated test's method name is, within a few lines after the annotation. */
export const METHOD_PATTERNS: Partial<Record<Language, RegExp>> = {
  java: /\bvoid\s+(\w+)\s*\(/,
  csharp: /\b(?:void|Task(?:<[^>]*>)?)\s+(\w+)\s*\(/,
};

export const IMPORT_PATTERNS: Partial<Record<Language, RegExp[]>> = {
  java: [/^\s*import\s+(?:static\s+)?([\w.*]+)\s*;/],
  csharp: [/^\s*using\s+(?:static\s+)?([\w.]+)\s*;/],
  javascript: [/\brequire\(\s*['"]([^'"]+)['"]\s*\)/, /\bfrom\s+['"]([^'"]+)['"]/, /^\s*import\s+['"]([^'"]+)['"]/],
  typescript: [/\brequire\(\s*['"]([^'"]+)['"]\s*\)/, /\bfrom\s+['"]([^'"]+)['"]/, /^\s*import\s+['"]([^'"]+)['"]/],
  ruby: [/^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/],
};

export const CONFIG_EXTENSIONS = /\.(?:ya?ml|json|properties|ini|toml|cfg|xml)$/i;
export const CONFIG_NAMES =
  /(?:^|\/)(?:[\w.-]*(?:config|settings)[\w.-]*|pytest\.ini|tox\.ini|testng[\w.-]*\.xml|pom\.xml|package\.json|requirements[\w.-]*\.txt|\.env\.example|[\w.-]+\.csproj|build\.gradle|\.rspec)$/i;
export const TEST_FILE_NAMES = /(?:^|\/)(?:test_[^/]*\.py|[^/]*_test\.py|[^/]*Tests?\.(?:java|cs)|[^/]*\.(?:spec|test)\.[jt]sx?|[^/]*_spec\.rb)$/;

/** Login, sign in or auth in a name or in code, in any casing style, without matching "catalog in" or "author". */
export const LOGIN_WORDS = /(?:(?<![A-Za-z])log|Log|LOG)[-_ ]?(?:in|In|IN)|[Ss]ign[-_ ]?[Ii]n|SIGN[-_ ]?IN|(?<![a-z])[Aa]uth(?!or)|AUTH/;

/** Folders the walk never enters: dependencies, build output, virtual environments, editor state. */
export const SKIPPED_DIRS = new Set(['node_modules', '.git', 'venv', '.venv', '__pycache__', 'target', 'bin', 'obj', 'build', 'dist', '.idea', '.vs']);

/**
 * One rule says a risk is present when `test` matches the file's text. `also` must match somewhere else in the same
 * file, and `min` is how many times `test` must match (default once). Rules under `any` run on every file, config
 * files included, because a hub URL or an implicit wait can sit in either.
 */
export type RiskRule = { risk: Risk; test: RegExp; also?: RegExp; min?: number };

const DRIVER_CREATED = /new\s+(?:ChromeDriver|RemoteWebDriver)|WebDriverManager/;

export const RISK_RULES: Partial<Record<Language | 'any', RiskRule[]>> = {
  any: [
    { risk: 'implicit-wait', test: /implicitly_wait\((?!\s*0*(?:\.0*)?\s*\))|implicitlyWait\(|ImplicitWait\s*=|\bimplicit:\s*[1-9]/ },
    { risk: 'grid', test: /webdriver\.Remote\(|RemoteWebDriver|command_executor|hub[_-]url|SELENIUM_HUB|4444\/wd\/hub|selenium-hub|DesiredCapabilities|usingServer\(/i },
  ],
  python: [
    { risk: 'shared-driver', test: /@pytest\.fixture\([^)\n]*scope\s*=\s*["'](?:class|session|module)["'][^)\n]*\)[^\n]*\n(?:[^\n]*\n){0,2}[^\n]*(?:driver|browser)/i },
    { risk: 'shared-driver', test: /^driver\s*=/m },
    { risk: 'ordered', test: /\bpytest\.mark\.(?:run\s*\(\s*order|order\b|dependency\b)/ },
    { risk: 'ordered', test: /\bdef\s+test_\d+_/, min: 2 },
    { risk: 'static-state', test: /^\s+global\s+\w+/m },
  ],
  java: [
    { risk: 'shared-driver', test: /\bstatic\s+(?:Remote)?WebDriver\b/ },
    { risk: 'shared-driver', test: /@(?:BeforeClass|BeforeAll|BeforeSuite)\b/, also: DRIVER_CREATED },
    { risk: 'ordered', test: /\bdependsOn(?:Methods|Groups)\b|\bpriority\s*=|@Order\(|@FixMethodOrder|@TestMethodOrder/ },
  ],
  csharp: [
    { risk: 'shared-driver', test: /\bstatic\s+IWebDriver\b|\[(?:OneTimeSetUp|ClassInitialize)\]/ },
    { risk: 'ordered', test: /[[,]\s*Order\(|\bPriority\b/ },
  ],
  javascript: [
    { risk: 'shared-driver', test: /\bbefore\s*\(/, also: /new\s+Builder\(\)/ },
    { risk: 'ordered', test: /\.serial\b|--sort\b/ },
  ],
};
RISK_RULES.typescript = RISK_RULES.javascript;

/** A line that sleeps for a fixed time, per language. */
export const SLEEP_PATTERNS: Partial<Record<Language, RegExp>> = {
  python: /\btime\.sleep\(|(?<![\w.])sleep\(/,
  java: /\bThread\.sleep\(/,
  csharp: /\bThread\.Sleep\(/,
  javascript: /\bsetTimeout\(|(?<![\w.$])sleep\(/,
  typescript: /\bsetTimeout\(|(?<![\w.$])sleep\(/,
  ruby: /(?<![\w.])sleep\s+\S/,
};

export const FIND_ELEMENT = /find_element|findElement|FindElement/;
export const LOOP_START = /^\s*(?:for|while|foreach|until)\b|\bloop\s+do\b/;

/** Declaration of a static non-final field (java, csharp); group 1 is the field name. */
export const STATIC_FIELD = /\bstatic\s+(?!final\b|readonly\b|const\b|void\b|class\b)[\w.?]+(?:<[^>;=(]*>)?(?:\[\])?\s+(\w+)\s*(?:;|=)/;

/** Files whose static fields are test state: tests and page objects, by name. */
export const STATIC_STATE_FILES = /(?:Test|Page)\w*\.(?:java|cs)$/;
