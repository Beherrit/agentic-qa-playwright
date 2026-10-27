import fs from 'node:fs';
import path from 'node:path';
import { parseTestLog } from './tests.ts';
import type { TestEntry } from './types.ts';

/** File helpers for agents/history.ts: reading untrusted JSON with a size cap, and the test rows beside an entry. */

/** The parsed file, or undefined when it is missing, too big or not JSON. */
export function readJson(file: string, maxBytes: number): unknown {
  try {
    if (fs.statSync(file).size > maxBytes) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Where the test rows of a run sit next to its entry file: `entry.json` has `entry.tests.jsonl`. */
export const companionFile = (entryFile: string): string => `${entryFile.replace(/\.json$/, '')}.tests.jsonl`;

/** The rows in a jsonl file, [] when it does not exist. Every row is re-checked. */
export const readTestRows = (file: string): TestEntry[] => (fs.existsSync(file) ? parseTestLog(fs.readFileSync(file, 'utf8')) : []);

/** Writes `content` to `rel` under `dir`, making the folders. */
export function writeUnder(dir: string, rel: string, content: string): void {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
