import fs from 'node:fs';
import path from 'node:path';
import { classify, detectFramework, detectLanguage, extensionOf, isConfig, type Sample } from './detect.ts';
import { countAssertions, detectRisks, extractImports, extractTests, findAssertionHelpers, mentionsLogin } from './extract.ts';
import { LANGUAGE_BY_EXTENSION, SKIPPED_DIRS } from './patterns.ts';
import { RISKS, type Inventory, type Language, type Risk, type SourceFile } from './types.ts';

/**
 * Reads an old test project and says what is in it: the language, the framework, and for every file what it is,
 * which tests it holds and how many assertions each makes. The counts are the yardstick the parity gate holds the
 * converted tests to, so they are taken once, here, before any agent has touched anything.
 */

export { classify, detectFramework, detectLanguage } from './detect.ts';
export { countAssertions, detectRisks, extractImports, extractTests, findAssertionHelpers } from './extract.ts';

const MAX_FILE_BYTES = 1_000_000;

/** Every file worth reading under the root, as paths relative to it with forward slashes, in a stable order. */
function walk(root: string, folder = ''): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(path.join(root, folder), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const rel = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('.')) out.push(...walk(root, rel));
    } else if (entry.isFile() && (LANGUAGE_BY_EXTENSION[extensionOf(rel)] || isConfig(rel))) {
      out.push(rel);
    }
  }
  return out;
}

function readSafe(file: string): string | null {
  try {
    return fs.statSync(file).size > MAX_FILE_BYTES ? null : fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

const languageOf = (rel: string): Language => LANGUAGE_BY_EXTENSION[extensionOf(rel)] ?? 'unknown';

/** Pass one: the assertion helpers the util and page files define, so pass two can count the calls to them. */
function assertionHelpers(samples: Sample[]): string[] {
  const names = new Set<string>();
  for (const { path: rel, content } of samples) {
    const language = languageOf(rel);
    const kind = classify(rel, content, extractTests(language, content).length > 0);
    if (kind === 'util' || kind === 'page') for (const name of findAssertionHelpers(language, content)) names.add(name);
  }
  return [...names];
}

function describeFile(rel: string, content: string, helpers: string[]): SourceFile {
  const language = languageOf(rel);
  const tests = extractTests(language, content, helpers);
  return {
    path: rel,
    kind: classify(rel, content, tests.length > 0),
    language,
    lines: content.split(/\r?\n/).length,
    tests,
    assertions: tests.length ? tests.reduce((sum, t) => sum + t.assertions, 0) : countAssertions(language, content),
    imports: extractImports(language, content),
    login: mentionsLogin(rel) || mentionsLogin(content),
    risks: detectRisks(language, content, rel),
  };
}

function countRisks(files: SourceFile[]): Record<Risk, number> {
  return Object.fromEntries(RISKS.map((risk) => [risk, files.filter((f) => f.risks.includes(risk)).length])) as Record<Risk, number>;
}

/** Scans a folder of old tests. The root must exist; unreadable or oversized files are left out. */
export function scanSource(root: string): Inventory {
  const rels = walk(root);
  const samples: Sample[] = [];
  for (const rel of rels) {
    const content = readSafe(path.join(root, rel));
    if (content !== null) samples.push({ path: rel, content });
  }
  const language = detectLanguage(samples.map((s) => s.path));
  const framework = detectFramework(language, samples);
  const helpers = assertionHelpers(samples);
  const files = samples.map((s) => describeFile(s.path, s.content, helpers));
  return {
    root,
    language,
    framework,
    files,
    configFiles: files.filter((f) => f.kind === 'config').map((f) => f.path),
    assertionHelpers: helpers,
    totals: {
      tests: files.reduce((sum, f) => sum + f.tests.length, 0),
      assertions: files.reduce((sum, f) => sum + f.assertions, 0),
      files: files.length,
      risks: countRisks(files),
    },
  };
}
