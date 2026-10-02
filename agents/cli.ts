import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { config } from './lib/paths.ts';
import { Request } from './lib/schemas.ts';
import { save } from './lib/store.ts';
import * as stages from './stages.ts';

/**
 * Runs the pipeline, one stage at a time or all at once.
 *
 *   In CI each stage is its own job:   npm run pipeline -- requirements
 *   On your machine, start to finish:  npm run pipeline -- all --title "Sort products" --text "As a shopper ..."
 */

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    issue: { type: 'string' }, // path to the JSON from `gh issue view --json number,title,body`
    title: { type: 'string' },
    text: { type: 'string' },
    file: { type: 'string' },
  },
});

function intake(): void {
  let request: Request;
  if (values.issue) {
    const issue = JSON.parse(fs.readFileSync(values.issue, 'utf8'));
    request = { key: `REQ-${issue.number}`, issue: issue.number, title: issue.title, body: issue.body ?? '' };
  } else {
    const body = values.file ? fs.readFileSync(values.file, 'utf8') : values.text;
    if (!body) throw new Error('Give the requirement with --issue <json>, --text "<words>" or --file <path>.');
    request = { key: 'REQ-0', issue: null, title: values.title ?? body.split('\n')[0].slice(0, 80), body };
  }
  save('request.json', Request.parse(request));
  console.log(`Requirement ${request.key}: ${request.title}`);
}

/** Stops the run with a message, without a stack trace. The job turns red and the message is the last line. */
function stop(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

async function all(): Promise<void> {
  intake();
  if (!(await stages.requirements())) {
    stop('The requirement has open questions that block testing. See qa-run/requirements.md.');
  }
  await Promise.all([stages.plan(), stages.critic()]);
  if (!(await stages.reconcile())) {
    stop(`The plan scored below ${config.minPlanScore}. See qa-run/strategy.md.`);
  }
  if (!(await stages.generate())) {
    stop('The generated tests did not pass the quality gates. See qa-run/gates.md.');
  }
  if ((await stages.review()).verdict !== 'approve') {
    await stages.rework();
  }
  stages.report();
  console.log('\nDone. The pull request description is in qa-run/pull-request.md and the change is in your working tree.');
}

const commands: Record<string, () => unknown> = {
  intake,
  requirements: stages.requirements,
  plan: stages.plan,
  critic: stages.critic,
  reconcile: async () => (await stages.reconcile()) || stop(`The plan scored below ${config.minPlanScore}.`),
  generate: async () => (await stages.generate()) || stop('The generated tests did not pass the quality gates.'),
  apply: stages.applyPatch,
  review: stages.review,
  rework: stages.rework,
  report: stages.report,
  all,
};

const command = commands[positionals[0]];
if (!command) stop(`Usage: npm run pipeline -- <${Object.keys(commands).join('|')}>`);

try {
  await command();
} catch (error) {
  stop(error instanceof Error ? error.message : String(error));
}
