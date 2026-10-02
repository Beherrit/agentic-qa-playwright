import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ROOT } from '../lib/paths.ts';

// An empty run folder of its own, so nothing here can read or touch a real run.
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cli-'));

type Run = { status: number | null; stdout: string; stderr: string };

/** Runs the CLI. The runs start together, since each one spends most of its time loading the pipeline. */
function cli(...args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'agents', 'cli.ts'), ...args], { cwd: ROOT, env: { ...process.env, QA_RUN_DIR: runDir } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

describe('command line', () => {
  it('prints the help and exits 0', async () => {
    const [help, word] = await Promise.all([cli('--help'), cli('help')]);
    for (const run of [help, word]) {
      assert.equal(run.status, 0);
      assert.match(run.stdout, /^Usage: npm run pipeline -- <command> \[options\]/);
    }
    for (const command of ['doctor', 'draft', 'analyze', 'tests', 'all', 'intake', 'requirements', 'technical', 'plan', 'critic', 'reconcile', 'check-plan', 'generate', 'apply', 'review', 'rework', 'report', 'notify']) {
      assert.match(help.stdout, new RegExp(`\\b${command}\\b`), command);
    }
    assert.match(help.stdout, /Exit codes: 0 done, 1 a stage or a check failed, 2 the command line was wrong\./);
  });

  it('exits 2 for a wrong command line and says how to get help, and 1 when a stage cannot go on', async () => {
    const wrong = [[], ['nope'], ['analyze', '--bogus'], ['notify', 'x'], ['toString']];
    const [stopped, ...runs] = await Promise.all([cli('check-plan'), ...wrong.map((args) => cli(...args))]);
    runs.forEach((run, i) => {
      assert.equal(run.status, 2, wrong[i].join(' '));
      assert.match(run.stderr, /npm run pipeline -- --help/);
    });
    assert.equal(stopped.status, 1);
    assert.match(stopped.stderr.trim().split('\n').pop() ?? '', /no test plan yet/);
  });
});
