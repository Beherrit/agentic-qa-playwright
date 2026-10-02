import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT, RUN_DIR } from './paths.ts';

/**
 * Running the project's own suite: the configured commands, the environment a run gets, and signing in first
 * when the app needs it. Everything that runs tests, the gates, the healer, the `suite` command, goes through here.
 */

export const commands = config.suite.commands;

/** The test command with extra Playwright arguments. */
export const testCommand = (args = ''): string => `${commands.test}${args ? ` ${args}` : ''}`;

export const lintCommand = (paths: string[] = config.writable): string => `${commands.lint} ${paths.join(' ')}`.trim();

/**
 * The environment a test run gets on top of the process's own:
 * - the persona the pipeline chose (QA_PERSONA), handed to the suite under the variable it reads;
 * - the address of the build under test, when the requirement names one (a pull request's preview).
 */
export function suiteEnv(extra: Record<string, string> = {}, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  const persona = env.QA_PERSONA || env[config.personas.envVar];
  if (persona) out[config.personas.envVar] = persona;
  const base = env.QA_BASE_URL || requestBaseUrl();
  if (base) out.BASE_URL = base;
  return { ...out, ...extra };
}

/** The address the current run's requirement names, if any (a pull request's preview). Read from the run folder. */
function requestBaseUrl(): string {
  const file = path.join(RUN_DIR, 'request.json');
  if (!fs.existsSync(file)) return '';
  try {
    const value = (JSON.parse(fs.readFileSync(file, 'utf8')) as { baseUrl?: unknown }).baseUrl;
    return typeof value === 'string' && /^https?:\/\//.test(value) ? value : '';
  } catch {
    return '';
  }
}

/** The persona a run signed in as, for reports. Empty when it is the suite's default. */
export const currentPersona = (env: NodeJS.ProcessEnv = process.env): string => env.QA_PERSONA || env[config.personas.envVar] || '';

let signedIn = false;

/**
 * Runs the sign-in command once per process, when the config has one. The command is the project's own (a
 * Playwright setup project, usually) and writes the storage state the suite and the agents' browser start from.
 */
export function prepareAuth(): void {
  if (signedIn || !config.auth.setup) return;
  signedIn = true;
  console.log(`Signing in: ${config.auth.setup}`);
  const run = spawnSync(config.auth.setup, { cwd: ROOT, shell: true, encoding: 'utf8', env: { ...process.env, ...suiteEnv() } });
  if (run.status !== 0) throw new Error(`The sign-in command failed (${config.auth.setup}):\n${`${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-20).join('\n')}`);
  if (config.auth.storageState && !fs.existsSync(path.join(ROOT, config.auth.storageState))) {
    throw new Error(`The sign-in command ran but did not write ${config.auth.storageState}.`);
  }
}

/** The storage state file for a browser, when the config names one and it exists. */
export function storageStatePath(): string | null {
  if (!config.auth.storageState) return null;
  const file = path.join(ROOT, config.auth.storageState);
  return fs.existsSync(file) ? file : null;
}

/** The configured typecheck and lint commands over the whole project, as the `check` command. Returns the exit code. */
export function runChecks(): number {
  for (const command of [commands.typecheck, lintCommand(['.'])]) {
    console.log(`> ${command}`);
    const run = spawnSync(command, { cwd: ROOT, shell: true, stdio: 'inherit' });
    if (run.status !== 0) return run.status ?? 1;
  }
  return 0;
}

/** Runs the suite with the given Playwright arguments, as the `suite` command. Returns the exit code. */
export function runSuite(args: string[]): number {
  prepareAuth();
  const quoted = args.map((arg) => (/^[\w./=:@-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`)).join(' ');
  const run = spawnSync(testCommand(quoted), { cwd: ROOT, shell: true, stdio: 'inherit', env: { ...process.env, ...suiteEnv() } });
  return run.status ?? 1;
}
