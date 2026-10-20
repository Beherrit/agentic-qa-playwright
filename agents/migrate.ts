import fs from 'node:fs';
import path from 'node:path';
import { scanSource } from './lib/migrate/inventory.ts';
import { planMigration, waveSummary } from './lib/migrate/plan.ts';
import { migrationMd, waveMd, type WaveState } from './lib/migrate/report.ts';
import type { MigrationPlan } from './lib/migrate/types.ts';
import { runCodeWave, runSettingsWave, type WaveOutcome } from './lib/migrate/waves.ts';
import { ROOT, RUN_DIR } from './lib/paths.ts';
import { playwrightVersion } from './lib/suite.ts';
import { jobSummary } from './lib/store.ts';

/**
 * The Selenium migration, run from the new project (the CLI points QA_PROJECT_ROOT at it):
 *   npx agentic-qa migrate plan --from <old project>             inventory and the waves, no agent
 *   npx agentic-qa migrate run --from <old project> [--wave id]  settings, utilities, login, then one suite at a time
 * Each wave has to pass its gates before the next starts. State is kept in qa-run/migration/, so a rerun carries on
 * from the first wave that has not passed; --wave runs one wave again.
 */

const DIR = path.join(RUN_DIR, 'migration');
const STATE = path.join(DIR, 'state.json');

type State = { source: string; plan: MigrationPlan; waves: WaveState[]; sections: Record<string, string> };

const write = (file: string, content: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

function loadState(source: string): State {
  if (fs.existsSync(STATE)) {
    const state = JSON.parse(fs.readFileSync(STATE, 'utf8')) as State;
    if (path.resolve(state.source) === path.resolve(source)) return state;
  }
  const inventory = scanSource(source);
  const plan = planMigration(inventory);
  write(path.join(DIR, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  return { source, plan, waves: plan.waves.map((w) => ({ id: w.id, status: 'pending', attempts: 0, summary: '' })), sections: {} };
}

function saveState(state: State): void {
  write(STATE, `${JSON.stringify(state, null, 2)}\n`);
  const sections = state.plan.waves.map((w) => state.sections[w.id]).filter(Boolean);
  write(path.join(DIR, 'migration.md'), `${migrationMd(state.plan, state.waves, sections, state.source)}\n`);
}

export function plan(source: string): string {
  const inventory = scanSource(source);
  const migration = planMigration(inventory);
  write(path.join(DIR, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  write(path.join(DIR, 'plan.json'), `${JSON.stringify(migration, null, 2)}\n`);
  const text = [
    `${inventory.language} ${inventory.framework}: ${inventory.totals.files} file(s), ${inventory.totals.tests} test(s), ${inventory.totals.assertions} assertion(s).`,
    '',
    waveSummary(migration),
  ].join('\n');
  write(path.join(DIR, 'plan.md'), `${text}\n`);
  return text;
}

function record(state: State, outcome: WaveOutcome): void {
  const entry = state.waves.find((w) => w.id === outcome.wave.id)!;
  entry.status = outcome.passed ? 'passed' : 'failed';
  // Attempts add up across reruns, so a wave that passed only after a person stepped in is never counted as first time.
  entry.attempts += outcome.attempts;
  entry.summary = outcome.summary;
  // The first thing a person would look at: a parity problem, or the gate that failed.
  const gate = outcome.gates?.results.find((g) => !g.passed);
  entry.problem = outcome.parity?.problems[0] ?? (gate ? `${gate.name}: ${gate.summary}` : undefined);
  state.sections[outcome.wave.id] = waveMd(outcome);
  if (outcome.conversion) write(path.join(DIR, `${outcome.wave.id}.json`), `${JSON.stringify(outcome, null, 2)}\n`);
  saveState(state);
}

/**
 * Runs the waves in order from the first that has not passed, or the one named, at most `limit` of them. The
 * settings, utilities and login waves are prerequisites and stop the run when they fail; a suite wave that fails
 * is recorded and the next suite runs, so one bad module does not hold a thousand tests. Returns true when every
 * wave has passed.
 */
export async function run(source: string, only?: string, limit = Infinity): Promise<boolean> {
  if (!playwrightVersion(ROOT)) throw new Error(`${ROOT} has no @playwright/test installed. Run npm install there first.`);
  const state = loadState(source);
  const inventory = scanSource(source);
  if (only && !state.plan.waves.some((w) => w.id === only)) throw new Error(`No wave "${only}". Waves: ${state.plan.waves.map((w) => w.id).join(', ')}.`);
  const pending = state.plan.waves.filter((w) => state.waves.find((s) => s.id === w.id)?.status !== 'passed');
  const todo = (only ? state.plan.waves.filter((w) => w.id === only) : pending).slice(0, limit);
  if (!todo.length) {
    console.log('Every wave has passed already. Delete qa-run/migration/state.json to start over.');
    return true;
  }
  console.log(`Migrating from ${source}: ${todo.length} of ${pending.length} pending wave(s) this run (${todo.map((w) => w.id).join(', ')}).`);
  for (const wave of todo) {
    console.log(`\n--- Wave ${wave.id} (${wave.kind}): ${wave.sources.length} file(s), ${wave.tests} test(s)${wave.risks?.length ? `, risks: ${wave.risks.join(', ')}` : ''}`);
    const previous = state.waves.filter((s) => s.status === 'passed').map((s) => s.id);
    const outcome = wave.kind === 'settings' ? await runSettingsWave(source, inventory, wave) : await runCodeWave(source, inventory, wave, previous);
    record(state, outcome);
    console.log(`${outcome.passed ? 'Passed' : 'FAILED'}: ${outcome.summary}`);
    if (!outcome.passed && wave.kind !== 'suite') {
      console.log(`The ${wave.kind} wave is a prerequisite for every suite. Stopping here.`);
      break;
    }
  }
  const markdown = fs.readFileSync(path.join(DIR, 'migration.md'), 'utf8');
  jobSummary(markdown);
  console.log(`\n${markdown}`);
  return state.waves.every((w) => w.status === 'passed');
}
