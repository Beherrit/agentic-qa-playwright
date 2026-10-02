import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tagGrep } from './lib/keys.ts';
import { config, ROOT, RUN_DIR } from './lib/paths.ts';
import type { Generation, Request, Strategy } from './lib/schemas.ts';

/**
 * The checks generated code has to pass before a reviewer, human or otherwise, spends time on it.
 * Nothing in here asks a model for an opinion. Every gate is a command or a rule with a pass or fail answer.
 * The parsing is kept in small pure functions so agents/test/ can check it without git or a browser.
 */

/**
 * An advisory gate is reported but does not stop the run.
 * `output` is shown when the gate fails; `table` is markdown that is shown either way.
 */
export type Gate = { name: string; passed: boolean; summary: string; output?: string; table?: string; advisory?: boolean };
export type GateReport = { passed: boolean; results: Gate[]; changed: string[] };

type Shell = { ok: boolean; output: string };

function sh(command: string, env: Record<string, string> = {}): Shell {
  const run = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  return { ok: run.status === 0, output: `${run.stdout ?? ''}${run.stderr ?? ''}`.trim() };
}

const git = (...args: string[]): string =>
  spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout ?? '';

const tail = (text: string, lines = 40): string => text.split('\n').slice(-lines).join('\n');

// ── What changed ─────────────────────────────────────────────────────────────

export type Change = { status: string; file: string; from?: string };

/**
 * Parses `git status --porcelain -z`. With -z, paths are never quoted, and a rename or copy entry is followed
 * by an extra field holding the old path.
 */
export function parseStatus(output: string): Change[] {
  const fields = output.split('\0');
  const changes: Change[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const change: Change = { status: status.trim(), file: entry.slice(3) };
    if (/[RC]/.test(status)) change.from = fields[++i];
    changes.push(change);
  }
  return changes;
}

export const changedFiles = (): Change[] => parseStatus(git('status', '--porcelain', '-z', '--untracked-files=all'));

/** The change to the writable folders as one patch, new files included. It is how a change travels between CI jobs. */
export function currentPatch(): string {
  git('add', '-A', '--', ...config.writable);
  const diff = git('diff', '--cached', '--binary');
  git('reset', '-q');
  return diff;
}

export function savePatch(): void {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUN_DIR, 'changes.patch'), currentPatch());
}

/** The paths a patch touches, from `git apply --numstat -z`. A rename lists both the old and the new path. */
export function patchPaths(numstat: string): string[] {
  const fields = numstat.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const [added, removed, file] = fields[i].split('\t');
    if (added === undefined || removed === undefined || file === undefined) continue;
    if (file === '') paths.push(fields[++i], fields[++i]);
    else paths.push(file);
  }
  return paths.filter(Boolean);
}

/**
 * Applies the change that came from the agent jobs. The patch file passed through jobs where generated test code
 * ran, so it is checked again here: a path outside the writable folders means it was tampered with.
 */
export function applyPatch(): void {
  const patch = path.join(RUN_DIR, 'changes.patch');
  const listing = spawnSync('git', ['apply', '--numstat', '-z', patch], { cwd: ROOT, encoding: 'utf8' });
  if (listing.status !== 0) throw new Error(`Could not read the generated change:\n${listing.stderr}`);
  const outside = patchPaths(listing.stdout).filter((file) => !config.writable.some((dir) => file.startsWith(dir)));
  if (outside.length) throw new Error(`The generated change touches files outside ${config.writable.join(', ')}: ${outside.join(', ')}`);
  const result = sh(`git apply --whitespace=nowarn "${patch}"`);
  if (!result.ok) throw new Error(`Could not apply the generated change:\n${result.output}`);
}

// ── Scope ────────────────────────────────────────────────────────────────────

export function scopeProblems(changes: Change[], writable: string[]): string[] {
  const inside = (file: string): boolean => writable.some((dir) => file.startsWith(dir));
  const problems: string[] = [];
  for (const change of changes) {
    if (!inside(change.file)) problems.push(`${change.file} is outside ${writable.join(', ')}`);
    if (change.status.includes('D')) problems.push(`${change.file} was deleted`);
    if (change.from !== undefined) problems.push(`${change.from} was moved to ${change.file}`);
  }
  if (!changes.some((c) => c.file.endsWith('.spec.ts'))) problems.push('no spec file was added or changed');
  return problems;
}

/**
 * Parses `git diff --numstat -z` into lines removed per existing file. With -z paths are never quoted.
 * Binary files report "-" and are skipped.
 */
export function removedLines(numstat: string): { file: string; removed: number }[] {
  return numstat
    .split('\0')
    .map((entry) => entry.split('\t'))
    .filter(([, removed, file]) => file && /^\d+$/.test(removed) && Number(removed) > 0)
    .map(([, removed, file]) => ({ file, removed: Number(removed) }));
}

function scopeGate(changes: Change[]): Gate {
  // Existing files may grow but not change: rewriting a test, or a page object other tests rely on, is how a
  // suite gets quietly weaker. git diff without --cached only covers files that already existed.
  const rewritten = removedLines(git('diff', '--numstat', '-z', '--ignore-cr-at-eol', '--', ...config.writable));
  const problems = [
    ...scopeProblems(changes, config.writable),
    ...rewritten.map((r) => `${r.file}: ${r.removed} existing line(s) changed or removed; existing files may only grow`),
  ];
  return {
    name: 'Scope',
    passed: problems.length === 0,
    summary: problems.length ? problems.join('; ') : `files changed: ${changes.length}, all inside ${config.writable.join(', ')}, existing files only added to`,
  };
}

function commandGate(name: string, command: string, okSummary: string): Gate {
  const result = sh(command);
  return {
    name,
    passed: result.ok,
    summary: result.ok ? okSummary : `\`${command}\` failed`,
    output: result.ok ? undefined : tail(result.output),
  };
}

// ── Expected-failure markers ─────────────────────────────────────────────────

export type Marker = { line: string; reason: string | null };

/**
 * Finds every `test.fail(...)` the change adds. A marker turns a failing test green, so each one has to say why:
 *   test.fail(true, 'bug: AC-3 the total ignores tax')     the app disagrees with a criterion
 *   test.fail(true, 'not built yet: SHOP-12')              test-first: the feature does not exist yet
 */
export function addedMarkers(patch: string): Marker[] {
  // The added lines as one text, so a call wrapped over several lines is still read whole.
  const added = patch
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');

  // test.fail( [true,] ['reason'] and then "," or ")". The reason may contain escaped quotes.
  const call = /\btest(?:\.describe)?\.fail\s*\(\s*(true\s*,\s*)?(?:(['"`])((?:\\[\s\S]|(?!\2)[^\\])*)\2)?\s*([,)])?/g;
  return [...added.matchAll(call)].map((match) => {
    const [, condition, , text, next] = match;
    // test.fail('title', async () => ...) declares a test: its first string is a title, not a reason.
    const isTitle = text !== undefined && !condition && next === ',';
    return {
      line: added.slice(match.index).split('\n')[0].trim(),
      reason: text === undefined || isTitle ? null : text.replace(/\\([\s\S])/g, '$1'),
    };
  });
}

/** Added lines that skip or focus tests. A skipped test counts as passing, so it would get past the full-suite gate. */
export function addedSkips(patch: string): string[] {
  return patch
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .filter((line) => /\btest(?:\.describe)?(?:\.(?:serial|parallel))?\.(?:skip|fixme|only)\b/.test(line))
    .map((line) => line.slice(1).trim());
}

export function markerProblems(markers: Marker[], request: Pick<Request, 'key' | 'mode'>, suspectedBugs: number): string[] {
  const problems: string[] = [];
  const bugs = markers.filter((m) => m.reason?.startsWith('bug:'));
  const pending = markers.filter((m) => m.reason?.startsWith('not built yet:'));

  for (const marker of markers) {
    if (marker.reason === null) problems.push(`\`${marker.line}\` has no reason`);
    else if (!bugs.includes(marker) && !pending.includes(marker))
      problems.push(`\`${marker.line}\`: the reason must start with "bug: AC-n" or "not built yet: ${request.key}"`);
  }
  for (const marker of bugs) {
    if (!/\bAC-\d+\b/.test(marker.reason!)) problems.push(`\`${marker.line}\` does not name the criterion it disagrees with`);
  }
  if (bugs.length > suspectedBugs) {
    problems.push(`${bugs.length} tests are marked as product bugs but only ${suspectedBugs} suspected bugs were reported`);
  }
  if (request.mode === 'built' && pending.length) {
    problems.push(`${pending.length} tests are marked "not built yet", but this requirement is not in test-first mode`);
  }
  const names = new RegExp(`\\b${request.key}(?![0-9])`);
  for (const marker of pending) {
    if (!names.test(marker.reason!)) problems.push(`\`${marker.line}\` does not name ${request.key}`);
  }
  if (request.mode === 'test-first' && pending.length === 0) {
    problems.push(`test-first mode, but no test is marked "not built yet: ${request.key}"`);
  }
  return problems;
}

function markerGate(patch: string, request: Request, generation: Generation): Gate {
  const markers = addedMarkers(patch);
  const problems = [
    ...markerProblems(markers, request, generation.suspectedBugs.length),
    ...addedSkips(patch).map((line) => `\`${line}\` skips or focuses tests`),
  ];
  return {
    name: 'Expected failures',
    passed: problems.length === 0,
    summary: problems.length
      ? problems.join('; ')
      : markers.length
        ? `${markers.length} marked, each with a reason`
        : 'none marked',
  };
}

// ── Running the new tests ────────────────────────────────────────────────────

type JsonResult = { status: string; error?: { message?: string }; errors?: { message?: string }[]; annotations?: { type: string; description?: string }[] };
type JsonTest = { expectedStatus: string; status: string; annotations?: { type: string; description?: string }[]; results: JsonResult[] };
type JsonSuite = { title: string; specs?: { title: string; file?: string; tags?: string[]; tests: JsonTest[] }[]; suites?: JsonSuite[] };

export type TestOutcome = { file: string; title: string; status: string; expectedToFail: boolean; reasons: string[]; errors: string[] };

const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '');

/** Flattens a Playwright JSON report into one outcome per test (all repeats of it together). */
export function outcomes(report: { suites?: JsonSuite[] }): TestOutcome[] {
  const walk = (suite: JsonSuite, parents: string[]): TestOutcome[] => {
    const names = suite.title.endsWith('.ts') ? parents : [...parents, suite.title];
    const own = (suite.specs ?? []).flatMap((spec) =>
      spec.tests.map((test) => {
        const annotations = [...(test.annotations ?? []), ...test.results.flatMap((r) => r.annotations ?? [])];
        return {
          file: spec.file ?? '',
          title: [...names, spec.title].join(' > '),
          status: test.status,
          expectedToFail: test.expectedStatus === 'failed' || annotations.some((a) => a.type === 'fail'),
          reasons: annotations.filter((a) => a.type === 'fail').map((a) => a.description ?? ''),
          errors: test.results.flatMap((r) => [...(r.errors ?? []), ...(r.error ? [r.error] : [])]).map((e) => stripAnsi(e.message ?? '')),
        };
      }),
    );
    return [...own, ...(suite.suites ?? []).flatMap((child) => walk(child, names))];
  };
  return (report.suites ?? []).flatMap((suite) => walk(suite, []));
}

/**
 * An expected failure only counts if the test failed because the behaviour is missing or wrong:
 * an assertion that did not hold, an element that was not there. A crash in the test's own code also
 * "fails as expected", and would otherwise sail through.
 */
const WRONG_REASON =
  /\b(TypeError|ReferenceError|SyntaxError|RangeError)\b|is not a function|Cannot read propert|is not defined|net::ERR_|ECONNREFUSED|browser has been closed/i;

/**
 * A test written ahead of a feature has to fail on the page: an element it cannot find, or one that does not yet
 * say or do what the criterion wants. A test that fails without touching the page (expect(1).toBe(2)) would stay
 * "expected to fail" for ever, even after the feature lands.
 */
const ON_THE_PAGE = /getBy[A-Z]\w*\(|locator[.(]|Locator:|waiting for|toHaveURL|toHaveTitle|page\.goto/;

export function wrongReasons(results: TestOutcome[]): string[] {
  return results
    .filter((t) => t.expectedToFail)
    .flatMap((t) => {
      const bad = t.errors.find((e) => WRONG_REASON.test(e));
      if (bad) return [`"${t.title}" fails, but because of an error in the test or the run: ${bad.split('\n')[0].slice(0, 200)}`];
      const pending = t.reasons.some((r) => r.startsWith('not built yet:'));
      if (pending && !t.errors.some((e) => ON_THE_PAGE.test(e))) {
        return [
          `"${t.title}" is marked "not built yet" but its failure has nothing to do with the page, so it would never pass. End it on a web-first assertion against a locator, so the error shows what is missing`,
        ];
      }
      return [];
    });
}

/** Runs the tests matching a grep with a JSON report written to a temporary file, and returns both. */
function runJson(grep: string, extra: string, env: Record<string, string> = {}): Shell & { report: TestOutcome[] } {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-gate-')), 'report.json');
  const result = sh(`npx playwright test --grep "${grep}" --retries=0 --reporter=line,json ${extra}`, {
    ...env,
    PLAYWRIGHT_JSON_OUTPUT_NAME: file,
  });
  const report = fs.existsSync(file) ? outcomes(JSON.parse(fs.readFileSync(file, 'utf8'))) : [];
  return { ...result, report };
}

type ListedSuite = { specs?: { title: string; tags: string[] }[]; suites?: ListedSuite[] };

function listedSpecs(suite: ListedSuite): { title: string; tags: string[] }[] {
  return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(listedSpecs)];
}

/** Which criteria the plan sends to e2e that no test tagged with this requirement claims. */
export function missingCriteria(
  specs: { tags: string[] }[],
  key: string,
  strategy: Pick<Strategy, 'cases'>,
): { mine: number; wanted: string[]; missing: string[] } {
  const strip = (tag: string): string => tag.replace(/^@/, '');
  const mine = specs.filter((spec) => spec.tags.map(strip).includes(key));
  const claimed = new Set(mine.flatMap((spec) => spec.tags.map(strip)));
  const wanted = [...new Set(strategy.cases.filter((c) => c.layer === 'e2e').flatMap((c) => c.criteria))];
  return { mine: mine.length, wanted, missing: wanted.filter((criterion) => !claimed.has(criterion)) };
}

/** Every criterion the plan sends to e2e must be claimed by a test tagged with this requirement. */
function traceabilityGate(request: Request, strategy: Strategy): Gate {
  // The JSON goes to a file: anything a tool prints on stderr would otherwise end up in the middle of it.
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-list-')), 'list.json');
  const listing = sh('npx playwright test --list --reporter=json', { PLAYWRIGHT_JSON_OUTPUT_NAME: file });
  let specs: { title: string; tags: string[] }[];
  try {
    specs = (JSON.parse(fs.readFileSync(file, 'utf8')).suites as ListedSuite[]).flatMap(listedSpecs);
  } catch {
    return { name: 'Traceability', passed: false, summary: 'could not list the tests', output: tail(listing.output) };
  }

  const { mine, wanted, missing } = missingCriteria(specs, request.key, strategy);
  if (mine === 0) return { name: 'Traceability', passed: false, summary: `no test is tagged @${request.key}` };
  return {
    name: 'Traceability',
    passed: missing.length === 0,
    summary: missing.length
      ? `no @${request.key} test is tagged for ${missing.join(', ')}`
      : `tests tagged @${request.key}: ${mine}, covering ${wanted.join(', ')}`,
  };
}

/** For each test, which known-broken targets it caught. */
export type KillMatrix = { targets: string[]; tests: { title: string; caught: string[] }[] };

export function sensitivitySummary(matrix: KillMatrix): { caughtAny: boolean; summary: string; short: string; table: string } {
  const perTarget = matrix.targets.map((target) => {
    const n = matrix.tests.filter((t) => t.caught.includes(target)).length;
    return `${target}: ${n} of ${matrix.tests.length}`;
  });
  const blind = matrix.tests.filter((t) => t.caught.length === 0);
  const caughtAny = matrix.tests.some((t) => t.caught.length > 0);
  const table = `| Test | ${matrix.targets.join(' | ')} |\n|---|${matrix.targets.map(() => '---').join('|')}|\n${matrix.tests
    .map((t) => `| ${t.title} | ${matrix.targets.map((target) => (t.caught.includes(target) ? 'caught' : '-')).join(' | ')} |`)
    .join('\n')}`;
  const summary = `caught by ${perTarget.join(', ')}${blind.length ? `; never failed: ${blind.map((t) => `"${t.title}"`).join(', ')}` : ''}`;
  // For a table cell: the counts, with the names left to the table underneath.
  const short = `caught by ${perTarget.join(', ')}${blind.length ? `; ${blind.length} never failed (see the table)` : ''}`;
  return { caughtAny, summary, short, table };
}

/**
 * Runs the new tests against versions of the app known to be broken. A test that passes against every one of
 * them may be checking nothing. This answers, by running code, the question the reviewer otherwise answers by
 * reading it: would this test fail if the behaviour broke?
 */
function sensitivityGate(request: Request): Gate | null {
  const targets = config.sensitivity?.targets ?? [];
  if (targets.length === 0 || request.mode !== 'built') return null;

  const tests = new Map<string, string[]>();
  for (const target of targets) {
    const run = runJson(tagGrep(request.key), '', target.env);
    for (const outcome of run.report.filter((t) => !t.expectedToFail)) {
      const name = `${outcome.file}: ${outcome.title}`;
      const caught = tests.get(name) ?? [];
      if (outcome.status === 'unexpected') caught.push(target.name);
      tests.set(name, caught);
    }
  }
  const matrix: KillMatrix = { targets: targets.map((t) => t.name), tests: [...tests].map(([title, caught]) => ({ title, caught })) };
  const { caughtAny, short, table } = sensitivitySummary(matrix);
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUN_DIR, 'sensitivity.json'), `${JSON.stringify(matrix, null, 2)}\n`);
  return {
    name: 'Sensitivity',
    passed: caughtAny,
    advisory: !config.sensitivity?.required,
    summary: caughtAny ? short : `the new tests passed against every known-broken target; ${short}`,
    table,
  };
}

// ── All together ─────────────────────────────────────────────────────────────

export function runGates(request: Request, strategy: Strategy, generation: Generation): GateReport {
  const changes = changedFiles();
  const results: Gate[] = [
    scopeGate(changes),
    commandGate('Types', 'npx tsc --noEmit', 'compiles'),
    commandGate('Lint', `npx eslint ${config.writable.join(' ')}`, 'no lint errors'),
    markerGate(currentPatch(), request, generation),
  ];

  // No point starting a browser for code that does not compile.
  if (results.every((gate) => gate.passed)) {
    results.push(traceabilityGate(request, strategy));
    results.push(commandGate('Full suite', 'npx playwright test --retries=0 --reporter=line', 'every test in the suite passes'));

    const stability = runJson(tagGrep(request.key), `--repeat-each=${config.stabilityRuns}`);
    results.push({
      name: 'Stability',
      passed: stability.ok,
      summary: stability.ok ? `new tests gave the same result ${config.stabilityRuns} times in a row` : 'new tests did not give the same result every time',
      output: stability.ok ? undefined : tail(stability.output),
    });

    const wrong = wrongReasons(stability.report);
    const expected = stability.report.filter((t) => t.expectedToFail).length;
    if (expected) {
      results.push({
        name: request.mode === 'test-first' ? 'Red for the right reason' : 'Bugs fail for the right reason',
        passed: wrong.length === 0,
        summary: wrong.length ? wrong.join('; ') : `${expected} expected failures, each an assertion or a missing element`,
      });
    }

    const sensitivity = stability.ok ? sensitivityGate(request) : null;
    if (sensitivity) results.push(sensitivity);
  }

  return {
    passed: results.filter((gate) => !gate.advisory).every((gate) => gate.passed),
    results,
    changed: changes.map((c) => c.file),
  };
}
