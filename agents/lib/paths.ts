import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { PKG_ROOT } from './pkg.ts';

export const CONFIG_FILE = 'qa.config.json';

/**
 * The project under test is the nearest folder above the working directory that holds qa.config.json, or the
 * folder QA_PROJECT_ROOT names. With neither, it is the working directory itself, which is where `init` writes
 * the config. The engine never looks for the project next to its own code: installed as a dependency, its own
 * code is inside node_modules.
 */
export function findProjectRoot(from: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  if (env.QA_PROJECT_ROOT) return path.resolve(env.QA_PROJECT_ROOT);
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(from);
    dir = parent;
  }
}

export const ROOT = findProjectRoot();

/** Where a pipeline run keeps its working files. Each CI job passes this folder to the next as an artifact. */
export const RUN_DIR = path.resolve(ROOT, process.env.QA_RUN_DIR || 'qa-run');

export const PROMPTS_DIR = path.join(PKG_ROOT, 'agents', 'prompts');
export const TEMPLATES_DIR = path.join(PKG_ROOT, 'templates');

/**
 * A version of the app known to be broken, which the new tests are run against. `env` is how the demo does it:
 * Swag Labs ships accounts that break the shop. `initScript` and `routes` work on any app: a script run on every
 * page before the app's own, and requests answered or dropped before they reach the server. The shared fixture
 * reads them from QA_FAULT (see templates/fixtures/fault.ts).
 */
export const TargetSchema = z.object({
  name: z.string().min(1),
  env: z.record(z.string(), z.string()).default({}),
  initScript: z.string().optional().describe('A JavaScript file, relative to the project root, added to every page'),
  routes: z
    .array(
      z.object({
        url: z.string().min(1).describe('A glob the request URL must match, as page.route takes it'),
        abort: z.boolean().default(false),
        status: z.number().int().optional(),
        body: z.string().optional(),
        contentType: z.string().optional(),
      }),
    )
    .default([]),
});
export type Target = z.infer<typeof TargetSchema>;

/** Everything specific to the project under test. The agents themselves are generic. */
export const ConfigSchema = z.object({
  app: z.object({
    name: z.string().min(1),
    baseUrl: z.url(),
    brief: z.string().min(1),
    /**
     * For requirements that arrive as pull requests: where the change is deployed, with {number} and {branch}
     * filled in, e.g. "https://pr-{number}.preview.example.com". Without it the tests run against baseUrl.
     */
    previewUrl: z.string().optional(),
  }),
  conventions: z.string().min(1),
  /** The only folders generated code may live in. The scope gate enforces it. */
  writable: z.array(z.string().min(1)).min(1),
  /** A test plan scoring below this stops the pipeline before any code is written. */
  minPlanScore: z.number().min(0).max(100),
  /** How many times in a row new tests must pass before they count as stable. */
  stabilityRuns: z.number().int().min(1),
  /** How the suite is laid out and run. The defaults are this repository's. */
  suite: z
    .object({
      specGlob: z.string().default('tests/**/*.spec.ts'),
      /** Where specs import `test` and `expect` from. */
      testImport: z.string().default('fixtures/test.ts'),
      /** The commands the gates run and the engineer may run. `test` has to be Playwright: the gates add flags to it. */
      commands: z
        .object({
          test: z.string().default('npx playwright test'),
          typecheck: z.string().default('npx tsc --noEmit'),
          lint: z.string().default('npx eslint'),
        })
        .prefault({}),
    })
    .prefault({}),
  /**
   * The accounts the suite can sign in as. The pipeline passes the chosen one as QA_PERSONA; `envVar` is the
   * variable the suite itself reads, so a suite that already has one keeps it.
   */
  personas: z
    .object({
      envVar: z.string().min(1).default('QA_PERSONA'),
      default: z.string().default(''),
      list: z.array(z.string()).default([]),
    })
    .prefault({}),
  /**
   * How to sign in when the app needs more than a form: a command that saves a Playwright storage state (a setup
   * project, usually), and the file it writes. The agents' browser starts from the same state.
   */
  auth: z
    .object({
      setup: z.string().nullable().default(null),
      storageState: z.string().nullable().default(null),
    })
    .prefault({}),
  sensitivity: z.object({ required: z.boolean().default(false), targets: z.array(TargetSchema).default([]) }).prefault({}),
  accessibility: z.object({ enabled: z.boolean().default(false), required: z.boolean().default(false) }).prefault({}),
  /**
   * The full-suite gate. New tests must pass first time. An existing test that fails gets one retry when this is
   * on; passing then counts as flaky and is reported, not blocked. Off, any failure in the suite blocks.
   */
  gates: z.object({ retryExistingOnce: z.boolean().default(true) }).prefault({}),
  autoRun: z.object({ analysisWhenWriterFiles: z.boolean().default(false), testsWhenPlanIsReady: z.boolean().default(false) }).prefault({}),
  /** The most a single pipeline run may spend on agents, in dollars as the SDK estimates them. 0 is no cap. */
  budget: z.object({ maxUsdPerRun: z.number().min(0).default(0) }).prefault({}),
  /** A model per agent role, e.g. { "plan-critic": "haiku" }. Falls back to QA_AGENT_MODEL, then sonnet. */
  models: z.record(z.string(), z.string()).default({}),
  jira: z
    .object({
      /** Custom fields to read along with the description, by display name, e.g. acceptance criteria. */
      fields: z.record(z.string(), z.string()).default({}),
      /** The project new tickets are filed in and open tickets are listed from. */
      project: z.string().optional(),
    })
    .prefault({}),
});
export type Config = z.infer<typeof ConfigSchema>;

/** Reads and checks a config file. The error names the file and every field that is wrong. */
export function loadConfig(file: string): Config {
  if (!fs.existsSync(file)) {
    throw new Error(`No ${CONFIG_FILE} in ${path.dirname(file)}. Run \`npx agentic-qa init\` there, or set QA_PROJECT_ROOT.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${file} has problems:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export const config: Config = loadConfig(path.join(ROOT, CONFIG_FILE));

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
