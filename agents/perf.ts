import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { analyse } from './lib/perf/analyst.ts';
import { dashboardHtml, dashboardMd } from './lib/perf/dashboard.ts';
import { buildEntry, mergeEntries, newestFirst, parseLog, type PerfEntry } from './lib/perf/entry.ts';
import { perfMarkdown } from './lib/perf/report.ts';
import { loadBaseline, runPerf, type PerfRun } from './lib/perf/run.ts';
import { config, ROOT, RUN_DIR } from './lib/paths.ts';
import { jobSummary, setOutput } from './lib/store.ts';
import { currentPersona } from './lib/suite.ts';

/**
 * The performance gate, as .github/workflows/perf.yml runs it:
 *   npx agentic-qa perf run [--scope all|critical] [--baseline <dir>]   audit, judge, write qa-run/perf/
 *   npx agentic-qa perf render <dir> [qa-run/perf]                       the qa-perf branch: runs.jsonl, README.md, index.html
 *   npx agentic-qa perf prove                                            audit two local pages, one broken on purpose
 * `run` exits 1 only when something failed and perf.required is on; otherwise the result is advisory.
 */

export const PERF_DIR = path.join(RUN_DIR, 'perf');

const headCommit = (): string | null => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return git.status === 0 ? git.stdout.trim() : null;
};

export async function run(options: { scope?: string; baseline?: string }): Promise<number> {
  if (!config.perf.enabled) {
    console.log('perf.enabled is off in qa.config.json. Nothing to do.');
    return 0;
  }
  const scope = options.scope === 'critical' ? 'critical' : 'all';
  const baseline = loadBaseline(options.baseline ? path.resolve(ROOT, options.baseline) : null);
  fs.rmSync(PERF_DIR, { recursive: true, force: true });
  const result = await runPerf({
    root: ROOT,
    baseUrl: process.env.QA_BASE_URL || config.app.baseUrl,
    appName: config.app.name,
    perf: config.perf,
    persona: currentPersona() || config.personas.default,
    scope,
    out: PERF_DIR,
    baseline,
    commit: headCommit(),
    runUrl: process.env.RUN_URL || null,
  });
  const analysis = !result.passed && config.perf.analyst ? await analyse(result, baseline?.run ?? null, PERF_DIR, ROOT).catch((error: unknown) => `The analyst did not finish: ${error instanceof Error ? error.message : String(error)}`) : '';
  const markdown = perfMarkdown(result, analysis);
  fs.writeFileSync(path.join(PERF_DIR, 'perf.md'), `${markdown}\n`);
  jobSummary(markdown);
  console.log(`\n${markdown}`);
  setOutput('passed', result.passed);
  return result.passed || result.advisory ? 0 : 1;
}

const readLog = (file: string): PerfEntry[] => (fs.existsSync(file) ? parseLog(fs.readFileSync(file, 'utf8')) : []);

/** Copies a run's folder into the branch: the full reports (replacing the last run's) and the baseline files. */
function adopt(dir: string, from: string): void {
  for (const sub of ['reports', 'latest']) fs.rmSync(path.join(dir, sub), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'latest', 'screenshots'), { recursive: true });
  fs.cpSync(path.join(from, 'reports'), path.join(dir, 'reports'), { recursive: true });
  fs.copyFileSync(path.join(from, 'perf.json'), path.join(dir, 'latest', 'perf.json'));
  if (fs.existsSync(path.join(from, 'screenshots'))) fs.cpSync(path.join(from, 'screenshots'), path.join(dir, 'latest', 'screenshots'), { recursive: true });
}

export function render(dir: string, from?: string): void {
  fs.mkdirSync(dir, { recursive: true });
  let entries = newestFirst(readLog(path.join(dir, 'runs.jsonl')));
  if (from) {
    const file = path.join(from, 'perf.json');
    if (!fs.existsSync(file)) throw new Error(`${file} is missing. Did \`perf run\` finish?`);
    const perfRun = JSON.parse(fs.readFileSync(file, 'utf8')) as PerfRun;
    const runId = process.env.RUN_ID || perfRun.finishedAt.replace(/[-:.TZ]/g, '').slice(0, 14);
    entries = mergeEntries(entries, buildEntry(perfRun, { runId, runUrl: process.env.RUN_URL || perfRun.runUrl, commit: perfRun.commit }));
    adopt(dir, from);
  }
  fs.writeFileSync(path.join(dir, 'runs.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
  fs.writeFileSync(path.join(dir, 'README.md'), dashboardMd(entries, config.app.name));
  fs.writeFileSync(path.join(dir, 'index.html'), dashboardHtml(entries, config.app.name));
  // Keeps GitHub Pages from running the folder through Jekyll.
  fs.writeFileSync(path.join(dir, '.nojekyll'), '');
  console.log(`Performance history has ${entries.length} run(s). Page: ${path.join(dir, 'index.html')}`);
}

export async function perfCommand(args: string[], options: { scope?: string; baseline?: string }): Promise<number> {
  const [what, first, second] = args;
  if (what === 'run') return run(options);
  if (what === 'render' && first) {
    render(path.resolve(ROOT, first), second ? path.resolve(ROOT, second) : undefined);
    return 0;
  }
  if (what === 'prove') return (await import('./lib/perf/prove.ts')).prove(ROOT);
  console.error('Usage: npx agentic-qa perf run [--scope all|critical] [--baseline <dir>] | render <dir> [qa-run/perf] | prove');
  return 2;
}
