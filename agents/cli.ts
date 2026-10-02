import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { doctor } from './doctor.ts';
import { artifactFor, keyFor, type SourceName } from './lib/keys.ts';
import { config } from './lib/paths.ts';
import { Request } from './lib/schemas.ts';
import { exists, reset, save, setOutput } from './lib/store.ts';
import { intakeTicket } from './sources/index.ts';
import * as stages from './stages.ts';

/**
 * Runs the pipeline, one stage at a time or a whole half at once.
 *
 *   Check a checkout is ready:           npm run pipeline -- doctor
 *   In CI each stage is its own job:     npm run pipeline -- requirements
 *   On your machine, from a ticket:      npm run pipeline -- analyze --source jira --ref SHOP-12
 *   On your machine, from plain words:   npm run pipeline -- all --title "Sort products" --text "As a shopper ..."
 *
 * Add --test-first to a local run when the feature is not built yet. A ticket says so itself, with the
 * qa-test-first label or the issue form.
 */

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: 'string' }, // github or jira
    ref: { type: 'string' }, // issue number or ticket key
    title: { type: 'string' },
    text: { type: 'string' },
    file: { type: 'string' },
    'test-first': { type: 'boolean', default: false },
  },
});

async function intake(): Promise<void> {
  let request: Request;
  // An empty --source (a dispatch event without one) is an error, not a quiet fall back to a local run.
  if (values.source !== undefined && values.source !== 'local') {
    if (!values.ref) throw new Error('Give the ticket with --ref (an issue number or a ticket key).');
    request = await intakeTicket(values.source as SourceName, values.ref);
  } else {
    const body = values.file ? fs.readFileSync(values.file, 'utf8') : values.text;
    if (!body) throw new Error('Give the requirement with --source and --ref, or with --text "<words>" or --file <path>.');
    request = Request.parse({
      key: keyFor('local', ''),
      source: 'local',
      ref: 'local',
      url: null,
      title: values.title ?? body.split('\n')[0].slice(0, 80),
      body,
      mode: values['test-first'] ? 'test-first' : 'built',
    });
  }
  // A new requirement starts from an empty run folder, so nothing left by the last one is mistaken for its own.
  reset();
  save('request.json', request);
  setOutput('key', request.key);
  setOutput('artifact', artifactFor(request.key));
  setOutput('mode', request.mode);
  console.log(`Requirement ${request.key} (${request.mode}): ${request.title}`);
}

/** Stops the run with a message, without a stack trace. The job turns red and the message is the last line. */
function stop(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

const runUrl = (): string | null => process.env.RUN_URL || null;

/** The first half: requirement in, scored plan out. No test code. */
async function analyze(): Promise<boolean> {
  if (!exists('request.json') || values.source !== undefined || values.text || values.file) await intake();
  let ok = await stages.requirements();
  if (ok) {
    await Promise.all([stages.plan(), stages.critic()]);
    ok = await stages.reconcile();
  }
  await stages.notifyAnalysis(runUrl());
  return ok;
}

/** The second half: plan in, reviewed tests out. */
async function tests(): Promise<void> {
  const problem = stages.planProblem();
  if (problem) stop(problem);
  if (!(await stages.generate())) {
    await stages.notifyTests(runUrl(), null);
    stop('The generated tests did not pass the quality gates. See qa-run/gates.md.');
  }
  if ((await stages.review()).verdict !== 'approve') await stages.rework();
  stages.report();
  // Nothing goes to the ticket from here: on your own machine there is no pull request to point it at.
  console.log('\nDone. The pull request description is in qa-run/pull-request.md and the change is in your working tree.');
}

const commands: Record<string, () => unknown> = {
  doctor: async () => (await doctor()) || process.exit(1),
  intake,
  requirements: stages.requirements,
  plan: stages.plan,
  critic: stages.critic,
  reconcile: async () => (await stages.reconcile()) || stop(`The plan scored below ${config.minPlanScore}.`),
  'check-plan': () => {
    const problem = stages.planProblem();
    if (problem) stop(problem);
  },
  generate: async () => (await stages.generate()) || stop('The generated tests did not pass the quality gates.'),
  // `apply` takes the generated tests; `apply heal.patch` takes a repair from the healer.
  apply: () => stages.applyPatch(positionals[1] === 'heal.patch' ? 'heal.patch' : 'changes.patch'),
  review: stages.review,
  rework: stages.rework,
  report: stages.report,
  notify: async () => {
    const what = positionals[1];
    if (what === 'analysis') return stages.notifyAnalysis(runUrl());
    if (what === 'tests') return stages.notifyTests(runUrl(), process.env.PR_URL || null);
    stop('Usage: npm run pipeline -- notify <analysis|tests>');
  },
  analyze: async () => (await analyze()) || stop('The analysis did not reach a usable plan. See qa-run/analysis.md.'),
  tests,
  all: async () => {
    if (!(await analyze())) stop('The analysis did not reach a usable plan. See qa-run/analysis.md.');
    await tests();
  },
};

const command = commands[positionals[0]];
if (!command) stop(`Usage: npm run pipeline -- <${Object.keys(commands).join('|')}>`);

try {
  await command();
} catch (error) {
  stop(error instanceof Error ? error.message : String(error));
}
