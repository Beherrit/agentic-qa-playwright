import { parseArgs } from 'node:util';
import { doctor } from './doctor.ts';
import { draft as writeTicket } from './draft.ts';
import { analyze as runAnalysis, intake, type RequirementInput } from './flow.ts';
import { config } from './lib/paths.ts';
import * as stages from './stages.ts';

/**
 * Runs the pipeline, one stage at a time or a whole half at once.
 *
 *   Check a checkout is ready:           npm run pipeline -- doctor
 *   In CI each stage is its own job:     npm run pipeline -- requirements
 *   On your machine, from a ticket:      npm run pipeline -- analyze --source jira --ref SHOP-12
 *   Write a ticket from a wish:          npm run pipeline -- draft --text "I want shoppers to save a wishlist" [--source github] [--yes]
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
    answers: { type: 'string' }, // draft: a file with answers to the writer's questions
    yes: { type: 'boolean', default: false }, // draft: file the ticket without asking
    'test-first': { type: 'boolean', default: false },
  },
});

const input = (): RequirementInput => ({
  source: values.source,
  ref: values.ref,
  title: values.title,
  text: values.text,
  file: values.file,
  testFirst: values['test-first'],
});

/** Stops the run with a message, without a stack trace. The job turns red and the message is the last line. */
function stop(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

const runUrl = (): string | null => process.env.RUN_URL || null;

/** The first half. A local run posts its analysis when the source is a tracker, as the README says. */
const analyze = (): Promise<boolean> => runAnalysis(input(), { post: true, runUrl: runUrl() });

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
  intake: () => intake(input()),
  draft: () => writeTicket({ text: values.text, file: values.file, source: values.source, answers: values.answers, yes: values.yes }),
  requirements: stages.requirements,
  technical: stages.technical,
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
