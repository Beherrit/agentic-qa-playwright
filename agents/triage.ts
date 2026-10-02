import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runAgent } from './lib/agent.ts';
import { config, ROOT } from './lib/paths.ts';
import { bugMd, triageMd } from './lib/render.ts';
import { Triage } from './lib/schemas.ts';
import { jobSummary, prompt, save, setOutput } from './lib/store.ts';

/**
 * Reads a failed Playwright run and has an agent work out what each failure means.
 * Usage: npm run triage            (reads test-results/results.json)
 */

type JsonResult = { status: string; retry: number; error?: { message?: string }; attachments?: { name: string; path?: string }[] };
type JsonSpec = { title: string; file: string; line: number; tests: { status: string; results: JsonResult[] }[] };
type JsonSuite = { title: string; specs?: JsonSpec[]; suites?: JsonSuite[] };

type Failure = { test: string; file: string; flaky: boolean; error: string; evidence: string[] };

const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '');

function failures(suite: JsonSuite, parents: string[] = []): Failure[] {
  // The top-level suite is the file itself; its title adds nothing to a test's name.
  const names = suite.title.endsWith('.ts') ? parents : [...parents, suite.title];
  const own = (suite.specs ?? []).flatMap((spec) =>
    spec.tests
      .filter((test) => test.status === 'unexpected' || test.status === 'flaky')
      .map((test) => {
        const failed = test.results.find((result) => result.status !== 'passed') ?? test.results[0];
        return {
          test: [...names, spec.title].join(' > '),
          file: `tests/${spec.file}:${spec.line}`,
          flaky: test.status === 'flaky',
          error: stripAnsi(failed.error?.message ?? 'no error message').slice(0, 1500),
          evidence: (failed.attachments ?? [])
            .filter((attachment) => attachment.path && /error-context|screenshot/.test(attachment.name))
            .map((attachment) => path.relative(ROOT, attachment.path!).replaceAll('\\', '/')),
        };
      }),
  );
  return [...own, ...(suite.suites ?? []).flatMap((child) => failures(child, names))];
}

const resultsFile = path.join(ROOT, 'test-results', 'results.json');
if (!fs.existsSync(resultsFile)) {
  console.error('test-results/results.json not found. Run the tests first.');
  process.exit(1);
}

const failed = (JSON.parse(fs.readFileSync(resultsFile, 'utf8')).suites as JsonSuite[]).flatMap((suite) => failures(suite));
if (failed.length === 0) {
  console.log('Nothing failed. Nothing to triage.');
  process.exit(0);
}

const persona = process.env.SAUCE_USER || 'the default persona';
const { output } = await runAgent({
  role: 'failure-triager',
  instructions: prompt('failure-triager'),
  task: `${failed.length} tests failed in a regression run against ${config.app.name} (${config.app.baseUrl}), signed in as ${persona}.

<failures>
${JSON.stringify(failed, null, 2)}
</failures>

The paths under "evidence" are files you can read. Start there.`,
  schema: Triage,
  access: 'read',
  maxTurns: 50,
});

// A stable id per bug, built from the tests it breaks. The workflow uses it to avoid filing the same bug twice.
const bugs = output.bugs.map((bug) => ({
  ...bug,
  fingerprint: createHash('sha1').update([...bug.tests].sort().join('|')).digest('hex').slice(0, 12),
  body: bugMd(bug),
}));

const markdown = triageMd(output);
save('triage.json', { ...output, bugs });
save('triage.md', markdown);
jobSummary(markdown);
setOutput('bugs', bugs.length);
console.log(`\n${markdown}`);
