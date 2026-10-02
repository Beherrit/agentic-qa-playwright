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
  /**
   * Known-broken versions of the app. New tests are run against each one: a test that passes against all of
   * them may not be checking anything. Each target is a set of environment variables for the test run.
   */
  sensitivity?: { required: boolean; targets: { name: string; env: Record<string, string> }[] };
  /**
   * Accessibility: an axe scan of the pages the new tests end on. Reported on the pull request; it only stops a
   * run when required is true.
   */
  accessibility?: { enabled: boolean; required: boolean };
  /**
   * The two hand-offs that are otherwise a person adding a label. With both on, the only human gate left is the
   * pull request. A ticket with open questions or a weak plan still stops either way.
   */
  autoRun?: { analysisWhenWriterFiles: boolean; testsWhenPlanIsReady: boolean };
  /** A model per agent role, e.g. { "plan-critic": "haiku" }. Falls back to QA_AGENT_MODEL, then sonnet. */
  models?: Record<string, string>;
  /** Jira only: custom fields to read along with the description, by display name, e.g. acceptance criteria. */
  jira?: { fields?: Record<string, string> };
};

/** Everything specific to the project under test lives in qa.config.json. The agents themselves are generic. */
export const config: Config = JSON.parse(fs.readFileSync(path.join(ROOT, 'qa.config.json'), 'utf8'));

export const projectDoc = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');

/**
 * The labels that drive the pipeline. The same names work on GitHub issues and Jira tickets.
 * The workflows test for `analyze` and `generate` by name, so change them there too.
 */
export const LABELS = {
  analyze: 'qa-pipeline',
  generate: 'qa-generate',
  testFirst: 'qa-test-first',
  needsInfo: 'qa-needs-info',
  analyzed: 'qa-analyzed',
} as const;
