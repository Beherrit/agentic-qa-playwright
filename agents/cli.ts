import { parseArgs } from 'node:util';

/**
 * The engine's command line: `npx agentic-qa <command>` in a project that has the engine installed, or
 * `npm run pipeline -- <command>` in this repository. `--help` lists it all.
 *
 * Every command loads only what it needs, so `init` and `--help` work in a folder with no config yet, and the MCP
 * server answers at once.
 *
 * Exit codes: 0 done, 1 a stage or a check failed (the last line says why), 2 the command line was wrong.
 */

const HELP = `Usage: npx agentic-qa <command> [options]

Setting up
  init                   Write qa.config.json, the two documents, the workflows and .mcp.json into this project
  survey                 Read the existing suite and draft the product brief and conventions from it (runs an agent)
  doctor                 Check this project is ready: config, documents, browser, the app, credentials

On your machine
  draft                  Write a requirement ticket from a wish (--text or --file); --source github --yes files it
  analyze                The analysis half: requirements, technical review, plan and score
  tests                  The test half, from the analysis in qa-run/: code, gates, review, pull request text
  all                    Both halves, start to finish. Start from a clean working tree
  suite [args]           Run the suite with the configured command, signed in and as QA_PERSONA; args go to Playwright
  check                  The configured typecheck and lint commands
  coverage               The traceability map: which ticket each test exists for, and how it did last run
  triage                 Classify the failures in test-results/results.json (runs an agent)
  heal                   Repair the test defects triage found (runs an agent)
  mcp                    Serve the pipeline over MCP on stdio, for Claude Desktop or Claude Code

One stage at a time, as the CI jobs run them
  intake, requirements, technical, plan, critic, reconcile, check-plan,
  generate (or write, gates, fix as three jobs), apply [heal.patch], review, rework, report, notify <analysis|tests>,
  history record <qa-run dir> <out file> | render <history dir> [entry file]

Options
  --source <name>        Where the requirement lives, with --ref: github, jira, pr, azure or linear
  --ref <ref>            The issue, pull request or work item number, or the Jira or Linear key
  --export <format>      coverage: also write junit, xray or testrail to qa-run/
  --text <words>         The requirement or the wish as text
  --file <path>          The requirement or the wish from a file
  --title <title>        A title for a requirement given as text
  --test-first           The feature is not built yet (a ticket says so itself)
  --answers <path>       draft: answers to the writer's blocking questions
  --yes                  draft: file the ticket without asking; survey: write the drafts over existing documents
  --force                init: overwrite files that exist
  -h, --help             This text

Examples
  npx agentic-qa init
  npx agentic-qa analyze --source jira --ref SHOP-12
  npx agentic-qa all --title "Sort products" --text "As a shopper I want to ..."
  npx agentic-qa draft --text "I want shoppers to save a wishlist" --source github
  npx agentic-qa suite --grep @REQ-12

Exit codes: 0 done, 1 a stage or a check failed, 2 the command line was wrong.
Stages that run an agent need a signed-in Claude Code CLI, CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY, or a
provider's settings in QA_PROVIDER_ENV (Bedrock, Vertex).`;

/** A wrong command line. Says what was wrong and how to ask for help. */
function usage(message: string): never {
  console.error(`${message}\nRun \`npx agentic-qa --help\` for the commands and options.`);
  process.exit(2);
}

/** Stops the run with a message, without a stack trace. The job turns red and the message is the last line. */
function stop(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

// `suite` hands everything after it to Playwright untouched, so its options are not parsed here.
const raw = process.argv.slice(2);
if (raw[0] === 'suite') {
  const { runSuite } = await import('./lib/suite.ts');
  process.exit(runSuite(raw.slice(1)));
}

function parse() {
  try {
    return parseArgs({
      args: raw,
      allowPositionals: true,
      options: {
        source: { type: 'string' }, // github, jira or pr
        ref: { type: 'string' }, // issue number, pull request number or ticket key
        title: { type: 'string' },
        text: { type: 'string' },
        file: { type: 'string' },
        answers: { type: 'string' }, // draft: a file with answers to the writer's questions
        yes: { type: 'boolean', default: false }, // draft: file the ticket without asking; survey: overwrite
        force: { type: 'boolean', default: false }, // init: overwrite
        export: { type: 'string' }, // coverage: junit, xray or testrail
        'test-first': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    return usage(error instanceof Error ? error.message : String(error));
  }
}

const { positionals, values } = parse();

if (values.help || positionals[0] === 'help') {
  console.log(HELP);
  process.exit(0);
}
if (!positionals[0]) usage('Name a command.');

const input = () => ({
  source: values.source,
  ref: values.ref,
  title: values.title,
  text: values.text,
  file: values.file,
  testFirst: values['test-first'],
});

const runUrl = (): string | null => process.env.RUN_URL || null;

const stages = () => import('./stages.ts');

/** The first half. A local run posts its analysis when the source is a tracker, as the README says. */
async function analyze(): Promise<boolean> {
  const { analyze: run } = await import('./flow.ts');
  return run(input(), { post: true, runUrl: runUrl() });
}

/** The second half: plan in, reviewed tests out. */
async function tests(): Promise<void> {
  const s = await stages();
  const problem = s.planProblem();
  if (problem) stop(problem);
  if (!(await s.generate())) {
    await s.notifyTests(runUrl(), null);
    stop('The generated tests did not pass the quality gates. See qa-run/gates.md.');
  }
  if ((await s.review()).verdict !== 'approve') await s.rework();
  s.report();
  // Nothing goes to the ticket from here: on your own machine there is no pull request to point it at.
  console.log('\nDone. The pull request description is in qa-run/pull-request.md and the change is in your working tree.');
}

const commands: Record<string, () => Promise<unknown>> = {
  // Runs before there is a config, so it loads nothing that reads one.
  init: async () => {
    const { initProject, nextSteps } = await import('./init.ts');
    const result = initProject(process.cwd(), { force: values.force });
    console.log(nextSteps(result));
  },
  survey: async () => {
    const { survey } = await import('./survey.ts');
    await survey({ write: values.yes });
  },
  doctor: async () => {
    const { doctor } = await import('./doctor.ts');
    if (!(await doctor())) process.exit(1);
  },
  draft: async () => {
    const { draft } = await import('./draft.ts');
    await draft({ text: values.text, file: values.file, source: values.source, answers: values.answers, yes: values.yes });
  },
  intake: async () => (await import('./flow.ts')).intake(input()),
  requirements: async () => (await stages()).requirements(),
  technical: async () => (await stages()).technical(),
  plan: async () => (await stages()).plan(),
  critic: async () => (await stages()).critic(),
  reconcile: async () => {
    const { config } = await import('./lib/paths.ts');
    if (!(await (await stages()).reconcile())) stop(`The plan scored below ${config.minPlanScore}.`);
  },
  'check-plan': async () => {
    const problem = (await stages()).planProblem();
    if (problem) stop(problem);
  },
  generate: async () => {
    if (!(await (await stages()).generate())) stop('The generated tests did not pass the quality gates.');
  },
  write: async () => (await stages()).write(),
  gates: async () => (await stages()).gates(),
  fix: async () => (await stages()).fix(),
  // `apply` takes the generated tests; `apply heal.patch` takes a repair from the healer.
  apply: async () => (await stages()).applyPatch(positionals[1] === 'heal.patch' ? 'heal.patch' : 'changes.patch'),
  review: async () => (await stages()).review(),
  rework: async () => (await stages()).rework(),
  report: async () => (await stages()).report(),
  notify: async () => {
    const s = await stages();
    const what = positionals[1];
    if (what === 'analysis') return s.notifyAnalysis(runUrl());
    if (what === 'tests') return s.notifyTests(runUrl(), process.env.PR_URL || null);
    usage('Usage: npx agentic-qa notify <analysis|tests>');
  },
  analyze: async () => {
    if (!(await analyze())) stop('The analysis did not reach a usable plan. See qa-run/analysis.md.');
  },
  tests,
  all: async () => {
    if (!(await analyze())) stop('The analysis did not reach a usable plan. See qa-run/analysis.md.');
    await tests();
  },
  check: async () => {
    const { runChecks } = await import('./lib/suite.ts');
    process.exit(runChecks());
  },
  coverage: async () => {
    const { coverageReport, exportResults } = await import('./coverage.ts');
    const { jobSummary } = await import('./lib/store.ts');
    const markdown = coverageReport();
    jobSummary(markdown);
    console.log(markdown);
    if (values.export) console.log(`\nWrote ${exportResults(values.export)}`);
  },
  triage: async () => (await import('./triage.ts')).triage(),
  heal: async () => (await import('./heal.ts')).heal(),
  history: async () => {
    const { record, render } = await import('./history.ts');
    const [, what, first, second] = positionals;
    if (what === 'record' && first && second) return record(first, second);
    if (what === 'render' && first) return render(first, second);
    usage('Usage: npx agentic-qa history record <qa-run dir> <out file> | render <history dir> [entry file]');
  },
  mcp: async () => {
    const { createServer } = await import('./mcp.ts');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    await createServer().connect(new StdioServerTransport());
  },
};

const command = Object.hasOwn(commands, positionals[0]) ? commands[positionals[0]] : undefined;
if (!command) usage(`Unknown command "${positionals[0]}".`);

try {
  await command();
} catch (error) {
  stop(error instanceof Error ? error.message : String(error));
}
