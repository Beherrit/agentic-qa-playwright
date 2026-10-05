import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { targetEnv } from './lib/fault.ts';
import { tagGrep } from './lib/keys.ts';
import { config, ROOT, RUN_DIR, type Target } from './lib/paths.ts';
import { anyVisible, sabotageSummary, verdicts, type FaultRun } from './lib/sabotage.ts';
import type { Generation, Request, Sabotage, Strategy } from './lib/schemas.ts';
import { exists, load } from './lib/store.ts';
import { commands, lintCommand, prepareAuth, suiteEnv, testCommand } from './lib/suite.ts';

/**
 * The checks generated code has to pass before a reviewer, human or otherwise, spends time on it.
 * Nothing in here asks a model for an opinion. Every gate is a command or a rule with a pass or fail answer.
 * The parsing is kept in small pure functions so agents/test/ can check it without git or a browser.
 */

/**
 * An advisory gate is reported but does not stop the run.
 * `output` is shown when the gate fails; `table` is markdown that is shown either way.
 */
export type Gate = {
  name: string;
  passed: boolean;
  summary: string;
  output?: string;
  table?: string;
  advisory?: boolean;
  /** Existing tests that failed once and passed on their retry. Reported, and kept in the run history. */
  flaky?: string[];
};
export type GateReport = { passed: boolean; results: Gate[]; changed: string[] };

type Shell = { ok: boolean; output: string };

function sh(command: string, env: Record<string, string> = {}): Shell {
  const run = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...suiteEnv(), ...env },
  });
  return { ok: run.status === 0, output: `${run.stdout ?? ''}${run.stderr ?? ''}`.trim() };
}

const git = (...args: string[]): string =>
  spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout ?? '';

const tail = (text: string, lines = 40): string => text.split('\n').slice(-lines).join('\n');

/**
 * The part of a failed Playwright run worth reading: the first error in full, and the list of what failed.
 * The plain tail of the output is mostly progress lines, which tell the engineer nothing.
 */
export function failureDigest(output: string): string {
  const lines = stripAnsi(output).split('\n').filter((line) => !/^\s*\[\d+\/\d+\]/.test(line));
  const firstError = lines.findIndex((line) => /^\s+1\) /.test(line));
  const summary = lines.map((line) => /^\s+\d+ (failed|flaky|interrupted)\b/.test(line)).lastIndexOf(true);
  if (firstError === -1 || summary === -1) return tail(lines.join('\n'));
  const nextError = lines.findIndex((line, i) => i > firstError && /^\s+2\) /.test(line));
  const error = lines.slice(firstError, Math.min(nextError === -1 ? summary : nextError, firstError + 30));
  return [...error, '', ...lines.slice(summary, summary + 40)].join('\n').trim();
}

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

export function savePatch(name = 'changes.patch'): void {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUN_DIR, name), currentPatch());
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
export function applyPatch(name = 'changes.patch'): void {
  const patch = path.join(RUN_DIR, name);
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
    output: result.ok ? undefined : command.startsWith(commands.test) ? failureDigest(result.output) : tail(result.output),
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

type JsonResult = {
  status: string;
  error?: { message?: string };
  errors?: { message?: string }[];
  annotations?: { type: string; description?: string }[];
  attachments?: { name: string; body?: string }[];
};
type JsonTest = { expectedStatus: string; status: string; annotations?: { type: string; description?: string }[]; results: JsonResult[] };
type JsonSuite = { title: string; specs?: { title: string; file?: string; tags?: string[]; tests: JsonTest[] }[]; suites?: JsonSuite[] };

export type TestOutcome = { file: string; title: string; tags: string[]; status: string; expectedToFail: boolean; reasons: string[]; errors: string[]; probeVisible: boolean | null };

const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '');

/**
 * What the fault-probe attachments of a test said (see fixtures/fault.ts): true if any repeat saw the breakage,
 * false if some were attached and none did, null when the test attached none.
 */
function probeVisible(results: JsonResult[]): boolean | null {
  const seen: boolean[] = [];
  for (const result of results)
    for (const attachment of result.attachments ?? []) {
      if (attachment.name !== 'fault-probe' || !attachment.body) continue;
      try {
        seen.push((JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8')) as { visible?: unknown }).visible === true);
      } catch {
        // An attachment that is not valid JSON says nothing.
      }
    }
  return seen.length === 0 ? null : seen.some(Boolean);
}

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
          tags: (spec.tags ?? []).map((tag) => tag.replace(/^@/, '')),
          status: test.status,
          expectedToFail: test.expectedStatus === 'failed' || annotations.some((a) => a.type === 'fail'),
          reasons: annotations.filter((a) => a.type === 'fail').map((a) => a.description ?? ''),
          errors: test.results.flatMap((r) => [...(r.errors ?? []), ...(r.error ? [r.error] : [])]).map((e) => stripAnsi(e.message ?? '')),
          probeVisible: probeVisible(test.results),
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

/** Runs the suite with the given arguments and a JSON report written to a temporary file, and returns both. */
function runJson(args: string, env: Record<string, string> = {}): Shell & { report: TestOutcome[] } {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-gate-')), 'report.json');
  const result = sh(testCommand(`--retries=0 --reporter=line,json ${args}`.trim()), {
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
  const listing = sh(testCommand('--list --reporter=json'), { PLAYWRIGHT_JSON_OUTPUT_NAME: file });
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

// ── The whole suite ──────────────────────────────────────────────────────────

/** The failures in a run, split into this requirement's tests and everyone else's. */
export function splitFailures(report: TestOutcome[], key: string): { mine: TestOutcome[]; existing: TestOutcome[] } {
  const failed = report.filter((t) => t.status === 'unexpected');
  return { mine: failed.filter((t) => t.tags.includes(key)), existing: failed.filter((t) => !t.tags.includes(key)) };
}

/** A --grep that runs exactly these tests again. Playwright matches it against the titles joined by spaces. */
export function grepFor(titles: string[]): string {
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return titles.map((title) => `${title.split(' > ').map(escape).join(' ')}$`).join('|');
}

const names = (tests: TestOutcome[]): string => tests.map((t) => `"${t.title}"`).join(', ');

/**
 * Every test in the suite has to pass. A new test gets no second chance. An existing test that fails is run once
 * more, by itself: if it passes then, it was flaky and the gate says so by name without blocking, so a flake
 * elsewhere in the suite does not sink a change that did not touch it. If it fails again, something this change
 * did (a page object, a fixture) broke it, and the gate blocks. `gates.retryExistingOnce` turns the retry off.
 */
function fullSuiteGate(request: Request): Gate {
  const first = runJson('');
  if (first.ok) return { name: 'Full suite', passed: true, summary: 'every test in the suite passes' };
  const { mine, existing } = splitFailures(first.report, request.key);
  if (mine.length || existing.length === 0 || !config.gates.retryExistingOnce) {
    return {
      name: 'Full suite',
      passed: false,
      summary: mine.length ? `${mine.length} of the new tests fail: ${names(mine)}` : existing.length ? `${existing.length} existing test(s) fail: ${names(existing)}` : 'the suite does not pass',
      output: failureDigest(first.output),
    };
  }
  const retry = runJson(`--grep "${grepFor(existing.map((t) => t.title))}"`);
  const still = retry.report.filter((t) => t.status === 'unexpected');
  if (still.length || !retry.ok) {
    return {
      name: 'Full suite',
      passed: false,
      summary: `${still.length} existing test(s) fail on a retry too: ${names(still)}. This change did not write them, so a page object or fixture it touched may have broken them`,
      output: failureDigest(retry.output),
    };
  }
  return {
    name: 'Full suite',
    passed: true,
    summary: `every test passes; ${existing.length} existing test(s) failed once and passed on a retry, so they are flaky, not this change's: ${names(existing)}`,
    flaky: existing.map((t) => t.title),
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
    const run = runJson(`--grep "${tagGrep(request.key)}"`, targetEnv(target));
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

// ── Saboteur ─────────────────────────────────────────────────────────────────

/**
 * Runs the new tests against each fault the saboteur wrote (qa-run/sabotage.json), one run per fault. A fault that
 * was visible on the page while every test for its criterion stayed green is a test that cannot tell a working
 * feature from a broken one. The fault's own probe, attached by the tests' page fixture, says whether it was visible.
 */
function sabotageGate(request: Request): Gate | null {
  if (request.mode !== 'built' || !config.sabotage.enabled) return null;
  const advisory = !config.sabotage.required;
  const faults = exists('sabotage.json') ? load<{ faults: Sabotage['faults'] }>('sabotage.json').faults : [];
  if (faults.length === 0) return { name: 'Sabotage', passed: true, advisory: true, summary: 'the saboteur wrote no usable faults, so nothing was broken on purpose' };

  const runs: Record<string, FaultRun> = {};
  for (const fault of faults) {
    const target: Target = { name: fault.name, env: {}, initScript: `qa-run/faults/${fault.name}.js`, routes: fault.routes.map((r) => ({ ...r })), probe: fault.probe };
    const run = runJson(`--grep "${tagGrep(request.key)}"`, targetEnv(target));
    runs[fault.name] = { outcomes: run.report, visible: anyVisible(run.report) };
  }
  const all = verdicts(faults, runs);
  const { passed, short, table } = sabotageSummary(all);
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUN_DIR, 'sabotage-results.json'), `${JSON.stringify(all, null, 2)}\n`);
  return { name: 'Sabotage', passed, advisory, summary: short, table };
}

// ── Accessibility ────────────────────────────────────────────────────────────

type A11yItem = { rule: string; impact: string; help: string; helpUrl: string; elements: number };
type A11yScan = { url: string; violations: A11yItem[]; incomplete: A11yItem[] };
type AttachedSuite = { specs?: { tests: { results: { attachments?: { name: string; body?: string }[] }[] }[] }[]; suites?: AttachedSuite[] };

export type A11yFinding = A11yItem & { pages: string[] };
export type A11yReport = { pages: string[]; violations: A11yFinding[]; review: A11yFinding[] };

/** Collects the axe scans the tests attached, and merges findings for the same rule across pages. */
export function a11yReport(report: { suites?: AttachedSuite[] }): A11yReport {
  const scans: A11yScan[] = [];
  const walk = (suite: AttachedSuite): void => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests)
        for (const result of test.results)
          for (const attachment of result.attachments ?? []) {
            if (attachment.name !== 'a11y' || !attachment.body) continue;
            try {
              scans.push(JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8')));
            } catch {
              // An attachment that is not valid JSON is not a scan.
            }
          }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);

  // The same page is scanned once per test that ends on it. Count each page once, without its query string.
  const page = (url: string): string => url.split(/[?#]/)[0];
  const merge = (pick: (scan: A11yScan) => A11yItem[]): A11yFinding[] => {
    const byRule = new Map<string, A11yFinding>();
    for (const scan of scans)
      for (const item of pick(scan) ?? []) {
        const found = byRule.get(item.rule) ?? { ...item, elements: 0, pages: [] };
        if (!found.pages.includes(page(scan.url))) found.pages.push(page(scan.url));
        found.elements = Math.max(found.elements, item.elements);
        byRule.set(item.rule, found);
      }
    const order = ['critical', 'serious', 'moderate', 'minor', 'unknown'];
    return [...byRule.values()].sort((a, b) => order.indexOf(a.impact) - order.indexOf(b.impact));
  };

  return { pages: [...new Set(scans.map((scan) => page(scan.url)))], violations: merge((s) => s.violations), review: merge((s) => s.incomplete) };
}

/**
 * There is no "accessible" verdict here on purpose. An automated scan finds only part of what WCAG asks for,
 * so the gate reports what was found and what needs a person, and never says a page passed.
 */
export function a11ySummary(report: A11yReport): { summary: string; table: string } {
  const pages = `${report.pages.length} page(s) scanned`;
  const rows = [
    ...report.violations.map((f) => `| violation | ${f.impact} | [${f.rule}](${f.helpUrl}): ${f.help} | ${f.elements} | ${f.pages.join('<br>')} |`),
    ...report.review.map((f) => `| needs a person | ${f.impact} | [${f.rule}](${f.helpUrl}): ${f.help} | ${f.elements} | ${f.pages.join('<br>')} |`),
  ];
  const table = `${pages}: ${report.pages.join(', ') || 'none'}\n\n${
    rows.length ? `| | Impact | Rule | Elements | Pages |\n|---|---|---|---|---|\n${rows.join('\n')}` : 'axe reported nothing on these pages.'
  }\n\nAn automated scan checks only part of WCAG. No findings is not the same as accessible.`;
  const serious = report.violations.filter((f) => f.impact === 'critical' || f.impact === 'serious').length;
  const summary = report.violations.length
    ? `${report.violations.length} rule(s) violated (${serious} serious or critical), ${report.review.length} need a person; ${pages}`
    : `no violations detected by axe, ${report.review.length} need a person; ${pages}. Not a pass: automation covers part of WCAG`;
  return { summary, table };
}

/**
 * Scans the pages the new tests end on. The tests attach an axe scan when QA_A11Y is set (see fixtures/test.ts),
 * so the scan happens on real states of the app, signed in, mid-journey, not only on the front page.
 */
function accessibilityGate(request: Request): Gate | null {
  if (!config.accessibility?.enabled || request.mode !== 'built') return null;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-a11y-')), 'report.json');
  sh(testCommand(`--grep "${tagGrep(request.key)}" --retries=0 --reporter=json`), { QA_A11Y: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: file });
  if (!fs.existsSync(file)) return { name: 'Accessibility', passed: false, advisory: true, summary: 'the scan run produced no report' };

  const report = a11yReport(JSON.parse(fs.readFileSync(file, 'utf8')));
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUN_DIR, 'accessibility.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (report.pages.length === 0) {
    return { name: 'Accessibility', passed: false, advisory: true, summary: 'no page was scanned: the tests attached no axe results' };
  }
  const { summary, table } = a11ySummary(report);
  return { name: 'Accessibility', passed: report.violations.length === 0, advisory: !config.accessibility.required, summary, table };
}

// ── Healing ──────────────────────────────────────────────────────────────────

/**
 * How many assertions a patch removes and adds, per file. A repair may reword an assertion (one out, one in)
 * but a file that ends up with fewer than it had has been weakened, not healed.
 */
export function assertionBalance(patch: string): { file: string; removed: number; added: number }[] {
  const files = new Map<string, { removed: number; added: number }>();
  let current = '';
  for (const line of patch.split('\n')) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line) ?? /^--- a\/(.+)$/.exec(line);
    if (header) {
      current = header[1];
      continue;
    }
    if (!current || !/\bexpect\s*[.(]/.test(line)) continue;
    const tally = files.get(current) ?? { removed: 0, added: 0 };
    if (line.startsWith('-')) tally.removed += 1;
    if (line.startsWith('+')) tally.added += 1;
    files.set(current, tally);
  }
  return [...files].map(([file, tally]) => ({ file, ...tally }));
}

/**
 * The gates for a repair. Unlike new tests, a repair has to change existing lines, so the "only grow" rule does
 * not apply. What replaces it: nothing may be skipped, marked as an expected failure, or left with fewer
 * assertions than it had.
 */
export function runHealGates(files: string[], env: Record<string, string> = {}): GateReport {
  prepareAuth();
  const changes = changedFiles();
  const patch = currentPatch();
  const inside = (file: string): boolean => config.writable.some((dir) => file.startsWith(dir));
  const scope = [
    ...changes.filter((c) => !inside(c.file)).map((c) => `${c.file} is outside ${config.writable.join(', ')}`),
    ...changes.filter((c) => c.status.includes('D') || c.from !== undefined).map((c) => `${c.file} was deleted or moved`),
    ...(changes.length ? [] : ['nothing was changed']),
  ];
  const weakened = [
    ...addedSkips(patch).map((line) => `\`${line}\` skips or focuses tests`),
    ...addedMarkers(patch).map((marker) => `\`${marker.line}\` marks a test as an expected failure`),
    ...assertionBalance(patch)
      .filter((f) => f.added < f.removed)
      .map((f) => `${f.file} lost assertions: ${f.removed} removed, ${f.added} added`),
  ];

  const results: Gate[] = [
    { name: 'Scope', passed: scope.length === 0, summary: scope.length ? scope.join('; ') : `files changed: ${changes.map((c) => c.file).join(', ')}` },
    { name: 'Nothing weakened', passed: weakened.length === 0, summary: weakened.length ? weakened.join('; ') : 'no skips, no expected-failure markers, no assertions lost' },
    commandGate('Types', commands.typecheck, 'compiles'),
    commandGate('Lint', lintCommand(), 'no lint errors'),
  ];

  if (results.every((gate) => gate.passed)) {
    const healed = sh(testCommand(`${files.map((file) => `"${file}"`).join(' ')} --repeat-each=${config.stabilityRuns} --retries=0 --reporter=line`), env);
    results.push({
      name: 'Healed tests',
      passed: healed.ok,
      summary: healed.ok ? `the repaired files pass ${config.stabilityRuns} times in a row` : 'the repaired files still fail',
      output: healed.ok ? undefined : failureDigest(healed.output),
    });
    const suite = sh(testCommand('--retries=0 --reporter=line'), env);
    results.push({
      name: 'Full suite',
      passed: suite.ok,
      summary: suite.ok ? 'every test in the suite passes' : 'the suite does not pass',
      output: suite.ok ? undefined : failureDigest(suite.output),
    });
  }
  return { passed: results.every((gate) => gate.passed), results, changed: changes.map((c) => c.file) };
}

// ── All together ─────────────────────────────────────────────────────────────

export function runGates(request: Request, strategy: Strategy, generation: Generation): GateReport {
  prepareAuth();
  const changes = changedFiles();
  const results: Gate[] = [
    scopeGate(changes),
    commandGate('Types', commands.typecheck, 'compiles'),
    commandGate('Lint', lintCommand(), 'no lint errors'),
    markerGate(currentPatch(), request, generation),
  ];

  // No point starting a browser for code that does not compile.
  if (results.every((gate) => gate.passed)) {
    results.push(traceabilityGate(request, strategy));
    results.push(fullSuiteGate(request));

    const stability = runJson(`--grep "${tagGrep(request.key)}" --repeat-each=${config.stabilityRuns}`);
    results.push({
      name: 'Stability',
      passed: stability.ok,
      summary: stability.ok ? `new tests gave the same result ${config.stabilityRuns} times in a row` : 'new tests did not give the same result every time',
      output: stability.ok ? undefined : failureDigest(stability.output),
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

    const sabotage = stability.ok ? sabotageGate(request) : null;
    if (sabotage) results.push(sabotage);

    const accessibility = stability.ok ? accessibilityGate(request) : null;
    if (accessibility) results.push(accessibility);
  }

  return {
    passed: results.filter((gate) => !gate.advisory).every((gate) => gate.passed),
    results,
    changed: changes.map((c) => c.file),
  };
}
