import fs from 'node:fs';
import path from 'node:path';
import { PROMPTS_DIR, RUN_DIR } from './paths.ts';

const file = (name: string): string => path.join(RUN_DIR, name);

export function save(name: string, data: unknown): void {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const text = typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(file(name), text);
}

export function load<T>(name: string): T {
  if (!fs.existsSync(file(name))) {
    throw new Error(`${name} is missing from ${RUN_DIR}. Did the earlier stage run?`);
  }
  return JSON.parse(fs.readFileSync(file(name), 'utf8')) as T;
}

export const exists = (name: string): boolean => fs.existsSync(file(name));
export const loadText = (name: string): string => fs.readFileSync(file(name), 'utf8');

export const prompt = (role: string): string => fs.readFileSync(path.join(PROMPTS_DIR, `${role}.md`), 'utf8');

export type RunRecord = { role: string; turns: number; seconds: number; costUsd: number };

/** Every agent call is logged here, so the pull request can say what the run took. */
export function recordRun(run: RunRecord): void {
  const ledger = exists('ledger.json') ? load<RunRecord[]>('ledger.json') : [];
  ledger.push(run);
  save('ledger.json', ledger);
}

/** Hands a value to later workflow steps. Does nothing outside GitHub Actions. */
export function setOutput(name: string, value: string | number | boolean): void {
  // One line per output. A value with a line break in it could otherwise smuggle in a second output.
  const line = String(value).replace(/[\r\n]+/g, ' ');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${line}\n`);
}

/** Adds to the job's summary page. Does nothing outside GitHub Actions. */
export function jobSummary(markdown: string): void {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n\n`);
}
