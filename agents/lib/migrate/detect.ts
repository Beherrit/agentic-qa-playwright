import { CONFIG_EXTENSIONS, CONFIG_NAMES, LANGUAGE_BY_EXTENSION, TEST_FILE_NAMES } from './patterns.ts';
import type { FileKind, Framework, Language } from './types.ts';

/**
 * What the old project is: its language by majority of source files, its test framework by markers, and what each
 * file is for. Pure, so tests can feed in strings and paths without a folder.
 */

export const extensionOf = (path: string): string => /\.[^./]+$/.exec(path)?.[0].toLowerCase() ?? '';

/** The language most source files are written in. Ties go to the one seen first; no source files is unknown. */
export function detectLanguage(paths: string[]): Language {
  const counts = new Map<Language, number>();
  for (const path of paths) {
    const language = LANGUAGE_BY_EXTENSION[extensionOf(path)];
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  let best: Language = 'unknown';
  let most = 0;
  for (const [language, n] of counts) {
    if (n > most) {
      best = language;
      most = n;
    }
  }
  return best;
}

export type Sample = { path: string; content: string };

const anyContent = (samples: Sample[], pattern: RegExp): boolean => samples.some((sample) => pattern.test(sample.content));
const hasName = (samples: Sample[], name: RegExp): boolean => samples.some((sample) => name.test(sample.path));

function javaScriptFramework(samples: Sample[]): Framework {
  const manifest = samples
    .filter((s) => /(?:^|\/)package\.json$/.test(s.path))
    .map((s) => s.content)
    .join('\n');
  const jest = /"jest"|"ts-jest"|"@jest\//.test(manifest) || anyContent(samples, /@jest\/globals|\bjest\./);
  const mocha = /"mocha"/.test(manifest) || anyContent(samples, /require\(\s*['"]mocha['"]|from\s+['"]mocha['"]/);
  if (mocha && !jest) return 'mocha';
  if (jest) return 'jest';
  return anyContent(samples, /\b(?:describe|it)\s*\(/) ? 'mocha' : 'unknown';
}

function pythonFramework(samples: Sample[]): Framework {
  if (hasName(samples, /(?:^|\/)(?:pytest\.ini|conftest\.py)$/) || anyContent(samples, /^\s*(?:import|from)\s+pytest\b|\[tool:pytest\]/m)) return 'pytest';
  if (anyContent(samples, /unittest\.TestCase|from\s+unittest\s+import/)) return 'unittest';
  return anyContent(samples, /^\s*def\s+test_/m) ? 'pytest' : 'unknown';
}

/** The test framework, from the language and what the files say. Falls back to unknown rather than guessing. */
export function detectFramework(language: Language, samples: Sample[]): Framework {
  switch (language) {
    case 'python':
      return pythonFramework(samples);
    case 'java':
      if (anyContent(samples, /org\.testng/) || hasName(samples, /(?:^|\/)testng[\w.-]*\.xml$/)) return 'testng';
      return anyContent(samples, /org\.junit/) ? 'junit' : 'unknown';
    case 'csharp':
      if (anyContent(samples, /\[TestMethod\]|Microsoft\.VisualStudio\.TestTools/)) return 'mstest';
      return anyContent(samples, /\[Test\]|\[TestFixture\]|NUnit/) ? 'nunit' : 'unknown';
    case 'javascript':
    case 'typescript':
      return javaScriptFramework(samples);
    case 'ruby':
      return anyContent(samples, /\bRSpec\b|require\s+['"]rspec|spec_helper/) || hasName(samples, /(?:^|\/)\.rspec$/) ? 'rspec' : 'unknown';
    default:
      return 'unknown';
  }
}

/** Settings and manifests: data files named like configuration, plus the well-known manifests. */
export function isConfig(path: string): boolean {
  if (!CONFIG_NAMES.test(path)) return false;
  return CONFIG_EXTENSIONS.test(path) || /requirements[\w.-]*\.txt$|\.env\.example$|\.rspec$/.test(path);
}

const UTIL_FOLDER = /(?:^|\/)[^/]*(?:util|helper|common|support|lib)[^/]*\//i;

/**
 * What a file is for. Configuration wins by name, then tests (by convention or by holding a test), then pages, then
 * utilities; a file that is none of those is "other". `hasTests` is whether the content defined any test.
 */
export function classify(path: string, content: string, hasTests: boolean): FileKind {
  if (isConfig(path)) return 'config';
  if (!LANGUAGE_BY_EXTENSION[extensionOf(path)]) return 'other';
  if (TEST_FILE_NAMES.test(path) || hasTests) return 'test';
  if (/page/i.test(path) || /\bclass\s+\w+Page\b/.test(content)) return 'page';
  if (UTIL_FOLDER.test(path) || /(?:^|\/)conftest\.py$/.test(path) || /(?:util|helper)s?\.\w+$/i.test(path)) return 'util';
  return 'other';
}
