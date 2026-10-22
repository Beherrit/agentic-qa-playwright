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
  intake                 Talk it through first: a safety screen, then the questions a developer would guess at, then the ticket
  analyze                The analysis half: requirements, technical review, plan and score
  tests                  The test half, from the analysis in qa-run/: code, gates, review, pull request text
  tasks                  One task per test layer under the ticket, from the plan in qa-run/; --layers to choose, --dry to preview
  all                    Both halves, start to finish. Start from a clean working tree
  suite [args]           Run the suite with the configured command, signed in and as QA_PERSONA; args go to Playwright
  check                  The configured typecheck and lint commands
  coverage               The traceability map: which ticket each test exists for, and how it did last run
  triage                 Classify the failures in test-results/results.json (runs an agent)
  heal                   Repair the test defects triage found (runs an agent)
  perf run               Lighthouse over the app's routes through the signed-in browser; --scope critical for the short list
  perf render <dir> [qa-run/perf]   The qa-perf branch: runs.jsonl, README.md, index.html, the last run's full reports
  perf prove             Audit two local pages, one broken on purpose, and show the gate catches the broken one
  migrate plan --from <old> --to <new>   Inventory a Selenium project and the waves it will be moved in (no agent)
  migrate run --from <old> --to <new>    Move it: settings, utilities, login, then one suite at a time, each gated; --wave <id> reruns one
  mcp                    Serve the pipeline over MCP on stdio, for Claude Desktop or Claude Code

One stage at a time, as the CI jobs run them
  intake --ref (reads a ticket; without --ref it is the conversation above), requirements, technical, plan, critic, reconcile, check-plan,
  generate (or write, sabotage, gates, fix as four jobs), apply [heal.patch], review, rework, report, notify <analysis|tests>,
  history record <qa-run dir> <out file> | render <history dir> [entry file]

Options
  --source <name>        Where the requirement lives, with --ref: github, jira, pr, azure or linear
  --ref <ref>            The issue, pull request or work item number, or the Jira or Linear key
  --export <format>      coverage: also write junit, xray or testrail to qa-run/
  --scope <all|critical> perf run: every route with the crawl, or only perf.critical (a pull request run)
  --baseline <dir>       perf run: a checkout of the qa-perf branch, to judge regressions against its last run
  --from <dir>           migrate: the Selenium project to read
  --to <dir>             migrate: the Playwright project to write (set up with init when it has no qa.config.json)
  --wave <id>            migrate run: run this one wave again
  --limit <n>            migrate run: at most this many waves this run (a pilot of a big suite)
  --text <words>         The requirement or the wish as text
  --file <path>          The requirement or the wish from a file
  --title <title>        A title for a requirement given as text
  --test-first           The feature is not built yet (a ticket says so itself)
  --answers <path>       draft: answers to the writer's blocking questions
  --rounds <n>           intake: at most this many rounds of questions (1 to 6; default from qa.config.json, 3)
  --dry                  intake: do everything except file the ticket; tasks: say what would change, change nothing
  --layers <ids>         tasks: only these layers, comma-separated, e.g. component,manual
  --yes                  draft, intake: file the ticket without asking; survey: write the drafts over existing documents
  --force                init: overwrite files that exist
  -h, --help             This text

Examples
  npx agentic-qa init
  npx agentic-qa analyze --source jira --ref SHOP-12
  npx agentic-qa all --title "Sort products" --text "As a shopper I want to ..."
  npx agentic-qa draft --text "I want shoppers to save a wishlist" --source github
  npx agentic-qa intake --text "Shoppers can save a wishlist" --source github
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
        yes: { type: 'boolean', default: false }, // draft, intake: file the ticket without asking; survey: overwrite
        rounds: { type: 'string' }, // intake: the most rounds of questions
        dry: { type: 'boolean', default: false }, // intake: file nothing; tasks: change nothing
        layers: { type: 'string' }, // tasks: only these layer ids
        force: { type: 'boolean', default: false }, // init: overwrite
        export: { type: 'string' }, // coverage: junit, xray or testrail
        scope: { type: 'string' }, // perf run: all or critical
        baseline: { type: 'string' }, // perf run: a checkout of the qa-perf branch
        from: { type: 'string' }, // migrate: the Selenium project
        to: { type: 'string' }, // migrate: the Playwright project
        wave: { type: 'string' }, // migrate run: one wave
        limit: { type: 'string' }, // migrate run: at most this many waves this run
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
  // With --ref this is the CI stage that reads a ticket in. Without one it is the conversation that writes a ticket.
  intake: async () => {
    if (values.ref !== undefined) return (await import('./flow.ts')).intake(input());
    const rounds = values.rounds === undefined ? undefined : Number(values.rounds);
    if (rounds !== undefined && (!Number.isInteger(rounds) || rounds < 1 || rounds > 6)) usage('--rounds takes a whole number from 1 to 6.');
    const { intake } = await import('./intake.ts');
    const code = await intake({ text: values.text, file: values.file, source: values.source, rounds, yes: values.yes, dry: values.dry });
    if (code !== 0) process.exit(code);
  },
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
  sabotage: async () => (await stages()).sabotage(),
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
  tasks: async () => {
    const { syncTasks } = await import('./tasks.ts');
    const layers = values.layers?.split(',').map((id) => id.trim()).filter(Boolean);
    await syncTasks({ layers, dry: values.dry });
  },
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
  perf: async () => {
    const { perfCommand } = await import('./perf.ts');
    const code = await perfCommand(positionals.slice(1), { scope: values.scope, baseline: values.baseline });
    if (code === 1) stop('The performance gate failed. See qa-run/perf/perf.md.');
    if (code) process.exit(code);
  },
  // The new project is the project root for everything that follows, so it is chosen before any config loads.
  migrate: async () => {
    const what = positionals[1];
    if (!['plan', 'run'].includes(what ?? '') || !values.from || !values.to) usage('Usage: npx agentic-qa migrate <plan|run> --from <old project> --to <new project> [--wave <id>]');
    const { resolve } = await import('node:path');
    const { existsSync } = await import('node:fs');
    const source = resolve(values.from!);
    const target = resolve(values.to!);
    if (!existsSync(source)) usage(`--from ${source} does not exist.`);
    if (!existsSync(resolve(target, 'qa.config.json'))) {
      const { initProject } = await import('./init.ts');
      const result = initProject(target);
      console.log(`Set up ${target}: ${result.written.length} file(s) written.`);
    }
    process.env.QA_PROJECT_ROOT = target;
    const { plan, run } = await import('./migrate.ts');
    if (what === 'plan') return console.log(plan(source));
    const limit = values.limit === undefined ? Infinity : Number(values.limit);
    if (!Number.isInteger(limit) && limit !== Infinity) usage('--limit takes a whole number.');
    if (!(await run(source, values.wave, limit))) stop('Not every wave has passed. See qa-run/migration/migration.md in the new project.');
  },
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
