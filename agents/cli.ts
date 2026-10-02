import { parseArgs } from 'node:util';
import { doctor } from './doctor.ts';
import { draft as writeTicket } from './draft.ts';
import { analyze as runAnalysis, intake, type RequirementInput } from './flow.ts';
import { config } from './lib/paths.ts';
import * as stages from './stages.ts';

/**
 * Runs the pipeline, one stage at a time or a whole half at once. `npm run pipeline -- --help` lists it all.
 *
 * Exit codes: 0 done, 1 a stage or a check failed (the last line says why), 2 the command line was wrong.
 */

const HELP = `Usage: npm run pipeline -- <command> [options]

On your machine
  doctor                 Check this checkout is ready: config, documents, browser, the app, credentials
  draft                  Write a requirement ticket from a wish (--text or --file); --source github --yes files it
  analyze                The analysis half: requirements, technical review, plan and score
  tests                  The test half, from the analysis in qa-run/: code, gates, review, pull request text
  all                    Both halves, start to finish. Start from a clean working tree

One stage at a time, as the CI jobs run them
  intake, requirements, technical, plan, critic, reconcile, check-plan,
  generate, apply [heal.patch], review, rework, report, notify <analysis|tests>

Options
  --source github|jira   Where the ticket lives, with --ref
  --ref <ref>            The issue number (github) or the ticket key (jira)
  --text <words>         The requirement or the wish as text
  --file <path>          The requirement or the wish from a file
  --title <title>        A title for a requirement given as text
  --test-first           The feature is not built yet (a ticket says so itself)
  --answers <path>       draft: answers to the writer's blocking questions
  --yes                  draft: file the ticket without asking
  -h, --help             This text

Examples
  npm run pipeline -- analyze --source jira --ref SHOP-12
  npm run pipeline -- all --title "Sort products" --text "As a shopper I want to ..."
  npm run pipeline -- draft --text "I want shoppers to save a wishlist" --source github

Exit codes: 0 done, 1 a stage or a check failed, 2 the command line was wrong.
Stages that run an agent need a signed-in Claude Code CLI, CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY.`;

/** A wrong command line. Says what was wrong and how to ask for help. */
function usage(message: string): never {
  console.error(`${message}\nRun \`npm run pipeline -- --help\` for the commands and options.`);
  process.exit(2);
}

function parse() {
  try {
    return parseArgs({
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
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    return usage(error instanceof Error ? error.message : String(error));
  }
}

const { positionals, values } = parse();

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
    usage('Usage: npm run pipeline -- notify <analysis|tests>');
  },
  analyze: async () => (await analyze()) || stop('The analysis did not reach a usable plan. See qa-run/analysis.md.'),
  tests,
  all: async () => {
    if (!(await analyze())) stop('The analysis did not reach a usable plan. See qa-run/analysis.md.');
    await tests();
  },
};

if (values.help || positionals[0] === 'help') {
  console.log(HELP);
  process.exit(0);
}
if (!positionals[0]) usage('Name a command.');
const command = Object.hasOwn(commands, positionals[0]) ? commands[positionals[0]] : undefined;
if (!command) usage(`Unknown command "${positionals[0]}".`);

try {
  await command();
} catch (error) {
  stop(error instanceof Error ? error.message : String(error));
}
