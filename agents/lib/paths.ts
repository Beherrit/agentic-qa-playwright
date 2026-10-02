import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where a pipeline run keeps its working files. Each CI job passes this folder to the next as an artifact. */
export const RUN_DIR = path.resolve(ROOT, process.env.QA_RUN_DIR || 'qa-run');

export const PROMPTS_DIR = path.join(ROOT, 'agents', 'prompts');

type Config = {
  app: { name: string; baseUrl: string; brief: string };
  conventions: string;
  /** The only folders generated code may live in. The scope gate enforces it. */
  writable: string[];
  /** A test plan scoring below this stops the pipeline before any code is written. */
  minPlanScore: number;
  /** How many times in a row new tests must pass before they count as stable. */
  stabilityRuns: number;
};

/** Everything specific to the project under test lives in qa.config.json. The agents themselves are generic. */
export const config: Config = JSON.parse(fs.readFileSync(path.join(ROOT, 'qa.config.json'), 'utf8'));

export const projectDoc = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');
