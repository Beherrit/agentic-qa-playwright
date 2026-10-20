import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Gate, GateReport } from '../../gates.ts';
import { commands, lintCommand, supportsShuffle, testCommand } from '../suite.ts';
import { checkRules, mutateExpect } from './parity.ts';
import type { Conversion } from './schemas.ts';

/**
 * What a converted wave has to pass before the next one starts. Nothing here asks a model. The rules check reads
 * the new files; the types and lint checks run the project's own commands; the run executes the new specs
 * shuffled with four workers, twice, so a test that leans on another one fails here; and the mutation check
 * inverts one assertion per test and runs it again, which must fail, or the assertion was never able to.
 */

const WORKERS = 4;
const MAX_MUTANTS = 12;

type Shell = { ok: boolean; output: string };

function sh(command: string, cwd: string, env: Record<string, string> = {}): Shell {
  const run = spawnSync(command, { cwd, shell: true, encoding: 'utf8', env: { ...process.env, ...env, CI: '' }, maxBuffer: 64 * 1024 * 1024 });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
  return { ok: run.status === 0, output: output.split('\n').slice(-40).join('\n') };
}

const commandGate = (name: string, command: string, cwd: string, passText: string): Gate => {
  const run = sh(command, cwd);
  return { name, passed: run.ok, summary: run.ok ? passText : `\`${command}\` failed`, output: run.ok ? undefined : run.output };
};

/** The static rules over every file the conversion wrote. */
function rulesGate(target: string, files: Conversion['files']): Gate {
  const problems: string[] = [];
  for (const file of files) {
    const full = path.join(target, file.path);
    if (!fs.existsSync(full)) {
      problems.push(`${file.path}: listed as written but does not exist`);
      continue;
    }
    problems.push(...checkRules(file.path, fs.readFileSync(full, 'utf8')));
  }
  return { name: 'Rules', passed: problems.length === 0, summary: problems.length ? `${problems.length} problem(s)` : 'parallel-safe, no skips, no sleeps', output: problems.length ? problems.join('\n') : undefined };
}

/** Lint runs when the target has an ESLint config; the rules gate stands in otherwise. */
function lintGate(target: string): Gate {
  const hasConfig = fs.readdirSync(target).some((name) => /^eslint\.config\.(m?js|ts)$/.test(name) || name === '.eslintrc.json');
  if (!hasConfig) return { name: 'Lint', passed: true, summary: 'skipped: the project has no ESLint config yet' };
  return commandGate('Lint', lintCommand(), target, 'no lint errors');
}

const quote = (file: string): string => `"${file}"`;

/** One assertion per test inverted; the test must fail. The file is put back whatever happens. */
function mutationGate(target: string, tests: Conversion['tests']): Gate {
  const results: string[] = [];
  let survived = 0;
  for (const mapping of tests.slice(0, MAX_MUTANTS)) {
    const full = path.join(target, mapping.target.file);
    if (!fs.existsSync(full)) continue;
    const original = fs.readFileSync(full, 'utf8');
    const mutant = mutateExpect(original, mapping.target.title);
    if (!mutant) {
      survived += 1;
      results.push(`${mapping.target.title}: has no expect to invert`);
      continue;
    }
    try {
      fs.writeFileSync(full, mutant.mutated);
      const escaped = mapping.target.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const run = sh(testCommand(`${quote(mapping.target.file)} --grep "${escaped}" --retries=0 --workers=1 --reporter=line`), target);
      if (run.ok) {
        survived += 1;
        results.push(`${mapping.target.title}: still passed with line ${mutant.line} made wrong (${mutant.how}): ${mutant.original.trim()}`);
      }
    } finally {
      fs.writeFileSync(full, original);
    }
  }
  const tried = Math.min(tests.length, MAX_MUTANTS);
  return {
    name: 'Catches a wrong result',
    passed: survived === 0,
    summary: survived ? `${survived} of ${tried} test(s) still passed with an assertion inverted` : `${tried} test(s) each failed when one assertion was inverted`,
    output: results.length ? results.join('\n') : undefined,
  };
}

export function runWaveGates(target: string, conversion: Conversion): GateReport {
  const specs = [...new Set(conversion.tests.map((t) => t.target.file))];
  const results: Gate[] = [rulesGate(target, conversion.files), commandGate('Types', commands.typecheck, target, 'compiles'), lintGate(target)];
  if (results.every((g) => g.passed) && specs.length) {
    const shuffle = supportsShuffle() ? ' --shuffle' : '';
    const run = sh(testCommand(`${specs.map(quote).join(' ')} --workers=${WORKERS} --repeat-each=2 --retries=0 --reporter=line${shuffle}`), target);
    results.push({
      name: 'Runs in parallel',
      passed: run.ok,
      summary: run.ok ? `${specs.length} spec(s) pass twice over, shuffled, with ${WORKERS} workers` : 'the new specs fail',
      output: run.ok ? undefined : run.output,
    });
    if (run.ok) results.push(mutationGate(target, conversion.tests));
  }
  return { passed: results.every((g) => g.passed), results, changed: conversion.files.map((f) => f.path) };
}
