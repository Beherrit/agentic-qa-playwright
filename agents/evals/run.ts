import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

/**
 * Runs the agent evaluations.
 *
 *   npm run evals -- --dry               the checks against the recorded answers in agents/evals/fixtures. No agent.
 *   npm run evals                        every case through the real agent stage. Spends the plan or API budget.
 *   npm run evals -- --case vague-wish   one case
 *   npm run evals -- --repeat 3          each case three times, since the agents are not deterministic
 *
 * Exit code 0 when every case passed, 1 when one did not, 2 for a usage error.
 */

const USAGE = 'Usage: npm run evals -- [--dry] [--case <id>] [--repeat <n>]';

let args: ReturnType<typeof parse>;
function parse() {
  return parseArgs({
    options: {
      dry: { type: 'boolean', default: false },
      case: { type: 'string' },
      repeat: { type: 'string', default: '1' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  }).values;
}
try {
  args = parse();
} catch (error) {
  console.error(`${error instanceof Error ? error.message : error}\n${USAGE}`);
  process.exit(2);
}
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}
const repeat = Number(args.repeat);
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) {
  console.error(`--repeat takes a whole number from 1 to 10.\n${USAGE}`);
  process.exit(2);
}

// A live run's agents record their cost in the run folder. Use a fresh one, so the evaluation never touches the
// run in qa-run/. This has to happen before the pipeline modules are loaded, because they read it once.
const runDir = args.dry ? '' : fs.mkdtempSync(path.join(os.tmpdir(), 'qa-evals-'));
if (runDir) process.env.QA_RUN_DIR = runDir;

const { dryRun, liveRun, loadCases } = await import('./harness.ts');
const { casePassed, evalsMd } = await import('./checks.ts');

let cases = loadCases();
if (args.case) {
  cases = cases.filter((c) => c.id === args.case);
  if (cases.length === 0) {
    console.error(`No case "${args.case}". The cases are in agents/evals/cases.`);
    process.exit(2);
  }
}

const results = args.dry ? dryRun(cases) : await liveRun(cases, repeat);
console.log(evalsMd(results, args.dry ? 'dry' : 'live'));

if (!args.dry) {
  const ledger = path.join(runDir, 'ledger.json');
  const runs = fs.existsSync(ledger) ? (JSON.parse(fs.readFileSync(ledger, 'utf8')) as { costUsd: number; seconds: number }[]) : [];
  const cost = runs.reduce((sum, run) => sum + run.costUsd, 0);
  console.log(`${runs.length} agent runs, estimated cost $${cost.toFixed(2)}, ${Math.round(runs.reduce((s, r) => s + r.seconds, 0) / 60)} min. Ledger: ${ledger}`);
}
process.exit(results.every(casePassed) ? 0 : 1);
