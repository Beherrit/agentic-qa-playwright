import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_LAYERS, LayersSchema } from './layers.ts';
import { PerfSchema } from './perf/schema.ts';
import { TiersSchema } from './tiers.ts';
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
  probe: z.string().optional().describe('A JavaScript expression, evaluated in the page, that is true when the fault has taken effect'),
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
  /**
   * The saboteur: a critic that breaks the feature under test on purpose, one criterion at a time, and runs the new
   * tests against each break. A criterion whose tests all stay green has tests that prove nothing.
   */
  sabotage: z
    .object({ enabled: z.boolean(), required: z.boolean(), maxFaults: z.number().int().min(1).max(12) })
    .prefault({ enabled: true, required: true, maxFaults: 8 }),
  accessibility: z.object({ enabled: z.boolean().default(false), required: z.boolean().default(false) }).prefault({}),
  /** Lighthouse over the app's routes, through Playwright's browser. The fields are in agents/lib/perf/schema.ts. */
  perf: PerfSchema.prefault({}),
  /**
   * The full-suite gate. New tests must pass first time. An existing test that fails gets one retry when this is
   * on; passing then counts as flaky and is reported, not blocked. Off, any failure in the suite blocks.
   */
  gates: z
    .object({
      retryExistingOnce: z.boolean().default(true),
      /**
       * Run the suite in a random order in the full-suite and stability gates (Playwright 1.64's `--shuffle`), so a
       * test that only passes after another one fails here and not in a month. The seed is in the gate report, so
       * `npx playwright test --shuffle <seed>` repeats the same order. Ignored on a Playwright older than 1.64.
       */
      shuffle: z.boolean().default(true),
    })
    .prefault({}),
  /**
   * The safety screen every requirement passes before an agent acts on it: fixed rules first, then (with `screener`)
   * a read-only agent that judges what the rules cannot. Turn `enabled` off only on a project that trusts every author.
   */
  safety: z.object({ enabled: z.boolean().default(true), screener: z.boolean().default(true) }).prefault({}),
  /**
   * The browser the agents get (the Playwright MCP server), beyond the per-role tool lists in agents/lib/agent.ts.
   * `allowedOrigins`: when set, the browser may request only these origins and the app's own; anything else is
   * refused at the network, not merely by the safety screen. Left empty, everything is allowed, because an app's
   * CDN and third-party scripts are not knowable in advance; fill it in once they are. `blockedOrigins` is for
   * analytics and the like, and wins over the allowlist. `webmcp` offers the agents the tools a page registers through
   * the WebMCP API; off until a product decides to expose some.
   */
  browser: z
    .object({
      allowedOrigins: z.array(z.string()).default([]),
      blockedOrigins: z.array(z.string()).default([]),
      webmcp: z.boolean().default(false),
      actionTimeoutMs: z.number().int().positive().default(5_000),
      navigationTimeoutMs: z.number().int().positive().default(30_000),
    })
    .prefault({}),
  /** The conversation that turns a wish into a ticket (`npx agentic-qa intake`): how many rounds of questions at most. */
  intake: z
    .object({
      maxRounds: z.number().int().min(1).max(6).default(3),
      /** The most skeptic questions put to the person per round; the rest are taken as assumed and listed on the ticket. */
      maxQuestions: z.number().int().min(1).max(20).default(5),
    })
    .prefault({}),
  autoRun: z.object({ analysisWhenWriterFiles: z.boolean().default(false), testsWhenPlanIsReady: z.boolean().default(false) }).prefault({}),
  /**
   * The most a single pipeline run may spend on agents, in dollars as the SDK estimates them, and the most a day's
   * runs may add up to on the history page before it warns. 0 is no cap.
   */
  budget: z
    .object({
      maxUsdPerRun: z.number().min(0).default(0),
      maxUsdPerDay: z.number().min(0).default(0),
      /** The most one agent call may cost, by tier, e.g. { "decide": 2, "build": 5 }. Unset is no cap of its own. */
      maxUsdPerAgent: z
        .object({ decide: z.number().min(0).optional(), build: z.number().min(0).optional(), research: z.number().min(0).optional(), read: z.number().min(0).optional() })
        .default({}),
    })
    .prefault({}),
  /**
   * A big item: a requirement with this many criteria or more, or a high risk. The analysis says so, and the tests of
   * a big item never start by themselves: a person reads the plan and adds the label.
   */
  bigItem: z
    .object({
      criteria: z.number().int().min(1).default(10),
      highRisk: z.boolean().default(true),
    })
    .prefault({}),
  /**
   * Where test cases can live, cheapest first: the browser suite this pipeline writes, and the layers other people own
   * (unit, component, API, contract) and manual. The fields are in agents/lib/layers.ts. Without a list, the plan uses
   * e2e, lower-layer and manual.
   */
  layers: LayersSchema.default(DEFAULT_LAYERS),
  /**
   * What the analysis reads beyond the ticket itself, in the intake job (which holds the tracker token): the parent,
   * child and linked tickets, and the Figma frames the ticket links to when FIGMA_TOKEN is set. All of it reaches the
   * agents as material to analyse, never as instructions, and only after the same fixed safety rules as the ticket.
   */
  context: z
    .object({
      related: z.boolean().default(true),
      /** The most related tickets read in full; the rest are listed by title. */
      maxRelated: z.number().int().min(0).max(20).default(8),
      /** The most characters kept from each related ticket or design. */
      maxChars: z.number().int().min(500).max(20_000).default(3_000),
      figma: z.boolean().default(true),
    })
    .prefault({}),
  /**
   * One task per layer under the ticket, holding that layer's test cases as a checklist (`npx agentic-qa tasks`).
   * Created again only when the plan changed, never duplicated. With `enabled` it happens when the analysis is posted.
   */
  tasks: z
    .object({
      enabled: z.boolean().default(false),
      /** Only these layer ids. Empty is every layer that has cases. */
      layers: z.array(z.string()).default([]),
    })
    .prefault({}),
  /**
   * A model per agent role, e.g. { "plan-critic": "haiku" }; "*" is every role not named. Either one overrides the
   * role's tier, and so does the repository variable QA_AGENT_MODEL. Leave it empty to run every role on its tier.
   */
  models: z.record(z.string(), z.string()).default({}),
  /** The model of each tier (decide, build, research, read) and its fallback. agents/lib/tiers.ts has the defaults. */
  tiers: TiersSchema,
  jira: z
    .object({
      /** Custom fields to read along with the description, by display name, e.g. acceptance criteria. */
      fields: z.record(z.string(), z.string()).default({}),
      /** The project new tickets are filed in and open tickets are listed from. */
      project: z.string().optional(),
      /** The issue type of the per-layer tasks, as the project calls it: Subtask, Sub-task, or a team's own. */
      subtaskType: z.string().default('Subtask'),
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
  refused: 'qa-refused',
} as const;
