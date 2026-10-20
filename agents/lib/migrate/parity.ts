import type { Conversion } from './schemas.ts';
import type { Inventory, SourceTest } from './types.ts';

/**
 * The assertion-parity check: did every old test come across, and did every old assertion? The agent that converted
 * the tests wrote the map, so none of it is believed. Each claim is looked up in the files themselves, and the old
 * counts come from the inventory taken before the agent started. Pure: the caller passes readers for the two roots.
 */

export { checkRules, riskGuidance } from './rules.ts';
export { mutateExpect } from './mutate.ts';

export type Mapping = Conversion['tests'][number];
export type Dropped = Conversion['dropped'][number];

export type ParityReport = {
  passed: boolean;
  problems: string[];
  /** Old tests accounted for, either converted or dropped with a reason. */
  covered: number;
  /** Old tests the wave's source files hold. */
  total: number;
  /** Old tests with a converted counterpart. */
  mapped: number;
};

type Expected = SourceTest & { file: string };
type Reader = (file: string) => string | null;
type Scope = { sources: string[]; names?: string[] };
type Claim = { conversion: { tests: Mapping[]; dropped: Dropped[] }; readSource: Reader; readTarget: Reader };

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const key = (file: string, name: string): string => `${file}\u0000${name}`;

/** Whether the file declares a test with this title, in any of the three string styles. */
export function hasTestTitle(content: string, title: string): boolean {
  return ["'", '"', '`'].some((quote) => {
    const literal = quote + title.split(quote).join(`\\${quote}`) + quote;
    return new RegExp(`\\b(?:test|it)(?:\\.\\w+)*\\s*\\(\\s*${escapeRegExp(literal)}`).test(content);
  });
}

/** Imports the shared `test` or Playwright's own. Anything else means the fixtures are not in play. */
export const importsTestBase = (content: string): boolean =>
  /(?:from|import|require\()\s*\(?\s*['"](?:[^'"]*\/)?fixtures\/test(?:\.ts)?['"]|(?:from|require\()\s*['"]@playwright\/test['"]/.test(content);

/** The old tests the wave's files hold, and the ones this wave answers for: all of them, or the named ones when the file was split. */
function expectedTests(wave: Scope, inventory: Inventory): { all: Expected[]; expected: Expected[] } {
  const all = inventory.files.filter((f) => wave.sources.includes(f.path)).flatMap((f) => f.tests.map((t) => ({ ...t, file: f.path })));
  return { all, expected: wave.names ? all.filter((t) => wave.names?.includes(t.name)) : all };
}

function accounting(wave: Scope, inventory: Inventory, claim: Claim, problems: string[]): Expected[] {
  const { all, expected } = expectedTests(wave, inventory);
  const seen = new Map<string, number>();
  for (const t of claim.conversion.tests) seen.set(key(t.source.file, t.source.name), (seen.get(key(t.source.file, t.source.name)) ?? 0) + 1);
  for (const d of claim.conversion.dropped) seen.set(key(d.source.file, d.source.name), (seen.get(key(d.source.file, d.source.name)) ?? 0) + 1);
  for (const t of expected) {
    const n = seen.get(key(t.file, t.name)) ?? 0;
    if (n === 0) problems.push(`${t.file}: test "${t.name}" is neither converted nor dropped`);
    if (n > 1) problems.push(`${t.file}: test "${t.name}" is listed ${n} times`);
  }
  const known = new Set(expected.map((t) => key(t.file, t.name)));
  const elsewhere = new Set(all.map((t) => key(t.file, t.name)));
  for (const k of seen.keys()) {
    const [file, name] = k.split('\u0000');
    if (known.has(k)) continue;
    problems.push(elsewhere.has(k) ? `${file}: "${name}" is not in this wave; it belongs to another part of the file` : `${file}: "${name}" is not a test the inventory found in this wave`);
  }
  return expected;
}

function checkMapping(m: Mapping, expected: Expected[], claim: Claim, problems: string[]): void {
  const label = `${m.source.file} "${m.source.name}"`;
  const old = expected.find((t) => t.file === m.source.file && t.name === m.source.name);
  if (old && m.assertions.length < old.assertions) problems.push(`${label}: ${old.assertions} assertions in the old test, only ${m.assertions.length} mapped`);
  const source = claim.readSource(m.source.file);
  const target = claim.readTarget(m.target.file);
  if (target === null) {
    problems.push(`${label}: target file ${m.target.file} does not exist`);
    return;
  }
  if (!hasTestTitle(target, m.target.title)) problems.push(`${label}: ${m.target.file} has no test titled "${m.target.title}"`);
  const sourceText = source === null ? null : squash(source);
  const targetText = squash(target);
  for (const a of m.assertions) {
    if (sourceText === null || !sourceText.includes(squash(a.source))) problems.push(`${label}: old assertion not found in ${m.source.file}: ${a.source}`);
    if (!targetText.includes(squash(a.target))) problems.push(`${label}: new assertion not found in ${m.target.file}: ${a.target}`);
  }
}

/** Checks one wave's conversion against the inventory and the files. Every problem is a line a person can act on. */
export function checkParity(
  wave: Scope,
  inventory: Inventory,
  conversion: { tests: Mapping[]; dropped: Dropped[] },
  readSource: Reader,
  readTarget: Reader,
): ParityReport {
  const problems: string[] = [];
  const claim: Claim = { conversion, readSource, readTarget };
  const expected = accounting(wave, inventory, claim, problems);
  for (const d of conversion.dropped) if (!d.reason.trim()) problems.push(`${d.source.file} "${d.source.name}": dropped with no reason`);
  for (const m of conversion.tests) checkMapping(m, expected, claim, problems);
  for (const file of new Set(conversion.tests.map((m) => m.target.file))) {
    const content = readTarget(file);
    if (content !== null && !importsTestBase(content)) problems.push(`${file}: does not import from fixtures/test.ts or @playwright/test`);
  }
  const done = new Set([...conversion.tests, ...conversion.dropped].map((x) => key(x.source.file, x.source.name)));
  const mapped = new Set(conversion.tests.map((x) => key(x.source.file, x.source.name)));
  return {
    passed: problems.length === 0,
    problems,
    covered: expected.filter((t) => done.has(key(t.file, t.name))).length,
    total: expected.length,
    mapped: expected.filter((t) => mapped.has(key(t.file, t.name))).length,
  };
}
