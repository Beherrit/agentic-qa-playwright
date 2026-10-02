import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT, RUN_DIR } from './lib/paths.ts';
import type { Request, Strategy } from './lib/schemas.ts';

/**
 * The checks generated code has to pass before a reviewer, human or otherwise, spends time on it.
 * Nothing in here asks a model for an opinion. Every gate is a command with a pass or fail answer.
 */

export type Gate = { name: string; passed: boolean; summary: string; output?: string };
export type GateReport = { passed: boolean; results: Gate[]; changed: string[] };

type Shell = { ok: boolean; output: string };

function sh(command: string): Shell {
  const run = spawnSync(command, { cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: run.status === 0, output: `${run.stdout ?? ''}${run.stderr ?? ''}`.trim() };
}

const tail = (text: string, lines = 40): string => text.split('\n').slice(-lines).join('\n');

type Change = { status: string; file: string };

export function changedFiles(): Change[] {
  return sh('git status --porcelain --untracked-files=all')
    .output.split('\n')
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2).trim(), file: line.slice(3).trim().replace(/^"|"$/g, '') }));
}

/** Writes everything the agent changed to one patch file, which is how the change travels between CI jobs. */
export function savePatch(): void {
  const dirs = config.writable.join(' ');
  sh(`git add -A -- ${dirs}`);
  const diff = spawnSync('git', ['diff', '--cached', '--binary'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUN_DIR, 'changes.patch'), diff.stdout);
  sh('git reset -q');
}

export function applyPatch(): void {
  const patch = path.join(RUN_DIR, 'changes.patch');
  const result = sh(`git apply --whitespace=nowarn "${patch}"`);
  if (!result.ok) throw new Error(`Could not apply the generated change:\n${result.output}`);
}

function scopeGate(changes: Change[]): Gate {
  const outside = changes.filter((c) => !config.writable.some((dir) => c.file.startsWith(dir)));
  const deleted = changes.filter((c) => c.status.includes('D'));
  const specs = changes.filter((c) => c.file.endsWith('.spec.ts'));
  const problems = [
    ...outside.map((c) => `${c.file} is outside ${config.writable.join(', ')}`),
    ...deleted.map((c) => `${c.file} was deleted`),
    ...(specs.length ? [] : ['no spec file was added or changed']),
  ];
  return {
    name: 'Scope',
    passed: problems.length === 0,
    summary: problems.length ? problems.join('; ') : `${changes.length} files, all inside ${config.writable.join(', ')}`,
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

type ListedSuite = { specs?: { title: string; tags: string[] }[]; suites?: ListedSuite[] };

function listedSpecs(suite: ListedSuite): { title: string; tags: string[] }[] {
  return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(listedSpecs)];
}

/** Every criterion the plan sends to e2e must be claimed by a test tagged with this requirement. */
function traceabilityGate(request: Request, strategy: Strategy): Gate {
  const listing = sh('npx playwright test --list --reporter=json');
  let specs: { title: string; tags: string[] }[];
  try {
    const json = listing.output.slice(listing.output.indexOf('{'));
    specs = (JSON.parse(json).suites as ListedSuite[]).flatMap(listedSpecs);
  } catch {
    return { name: 'Traceability', passed: false, summary: 'could not list the tests', output: tail(listing.output) };
  }

  const strip = (tag: string): string => tag.replace(/^@/, '');
  const mine = specs.filter((spec) => spec.tags.map(strip).includes(request.key));
  const claimed = new Set(mine.flatMap((spec) => spec.tags.map(strip)));
  const wanted = [...new Set(strategy.cases.filter((c) => c.layer === 'e2e').flatMap((c) => c.criteria))];
  const missing = wanted.filter((criterion) => !claimed.has(criterion));

  if (mine.length === 0) {
    return { name: 'Traceability', passed: false, summary: `no test is tagged @${request.key}` };
  }
  return {
    name: 'Traceability',
    passed: missing.length === 0,
    summary: missing.length
      ? `no @${request.key} test is tagged for ${missing.join(', ')}`
      : `${mine.length} tests tagged @${request.key} cover ${wanted.join(', ')}`,
  };
}

export function runGates(request: Request, strategy: Strategy): GateReport {
  const changes = changedFiles();
  const results: Gate[] = [scopeGate(changes)];

  results.push(commandGate('Types', 'npx tsc --noEmit', 'compiles'));
  results.push(commandGate('Lint', `npx eslint ${config.writable.join(' ')}`, 'no lint errors'));

  // No point starting a browser for code that does not compile.
  if (results.every((gate) => gate.passed)) {
    results.push(traceabilityGate(request, strategy));
    results.push(commandGate('Full suite', 'npx playwright test --retries=0 --reporter=line', 'every test in the suite passes'));
    results.push(
      commandGate(
        'Stability',
        `npx playwright test --grep "@${request.key}" --repeat-each=${config.stabilityRuns} --retries=0 --reporter=line`,
        `new tests passed ${config.stabilityRuns} times in a row`,
      ),
    );
  }

  return { passed: results.every((gate) => gate.passed), results, changed: changes.map((c) => c.file) };
}
