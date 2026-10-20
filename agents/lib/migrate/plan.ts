import { RISKS, type Inventory, type MigrationPlan, type Risk, type SourceFile, type Wave, type WaveKind } from './types.ts';

/**
 * The order the old project is converted in. Settings first because everything else needs a config to run against;
 * then pages and utilities, because tests import them; then sign-in, because every other test depends on it working;
 * then the remaining test files, smallest first, so the cheap wins land before the hard ones. A test file with more than
 * `MAX_TESTS_PER_WAVE` tests is split into several waves, kept together and in order, so one agent turn stays a size it can finish.
 */

export const MAX_TESTS_PER_WAVE = 10;

const sum = <T>(items: T[], pick: (item: T) => number): number => items.reduce((total, item) => total + pick(item), 0);

/** The risks any of the files show, in the order of RISKS. */
const unionRisks = (files: SourceFile[]): Risk[] => RISKS.filter((risk) => files.some((f) => f.risks.includes(risk)));

function wave(id: string, kind: WaveKind, name: string, files: SourceFile[], sources: string[] = files.map((f) => f.path)): Wave {
  return { id, kind, name, sources, tests: sum(files, (f) => f.tests.length), assertions: sum(files, (f) => f.assertions), risks: unionRisks(files) };
}

/** `tests/test_inventory.py` becomes `test_inventory`. */
const stem = (path: string): string => (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '');

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9_]+/g, '-').replace(/^-+|-+$/g, '') || 'file';

/** Suite wave ids, unique even when two folders hold a file of the same name. */
function suiteId(file: SourceFile, taken: Set<string>): string {
  let id = `suite-${slug(stem(file.path))}`;
  if (taken.has(id)) id = `suite-${slug(file.path.replace(/\.[^.]+$/, ''))}`;
  for (let n = 2; taken.has(id); n++) id = `suite-${slug(stem(file.path))}-${n}`;
  taken.add(id);
  return id;
}

/** One suite wave for a small file, or several for a big one, each covering at most MAX_TESTS_PER_WAVE named tests. */
function suiteWaves(file: SourceFile, taken: Set<string>): Wave[] {
  const id = suiteId(file, taken);
  if (file.tests.length <= MAX_TESTS_PER_WAVE) return [wave(id, 'suite', stem(file.path), [file])];
  const parts = Math.ceil(file.tests.length / MAX_TESTS_PER_WAVE);
  return Array.from({ length: parts }, (_, n) => {
    const tests = file.tests.slice(n * MAX_TESTS_PER_WAVE, (n + 1) * MAX_TESTS_PER_WAVE);
    let chunkId = `${id}-${n + 1}`;
    while (taken.has(chunkId)) chunkId += '-x';
    taken.add(chunkId);
    const name = `${stem(file.path)} (part ${n + 1} of ${parts})`;
    return { id: chunkId, kind: 'suite', name, sources: [file.path], tests: tests.length, assertions: sum(tests, (x) => x.assertions), names: tests.map((x) => x.name), risks: unionRisks([file]) };
  });
}

/** The waves for an inventory, in the order they run. A wave with nothing in it is left out. */
export function planMigration(inventory: Inventory): MigrationPlan {
  const byPath = new Map(inventory.files.map((f) => [f.path, f]));
  const support = inventory.files.filter((f) => f.kind === 'page' || f.kind === 'util');
  const tests = inventory.files.filter((f) => f.kind === 'test');
  const loginTests = tests.filter((f) => f.login);
  const loginSupport = support.filter((f) => f.login);
  const waves: Wave[] = [];

  if (inventory.configFiles.length) {
    const configs = inventory.configFiles.map((p) => byPath.get(p)).filter((f): f is SourceFile => Boolean(f));
    waves.push(wave('settings', 'settings', 'settings', configs, inventory.configFiles));
  }
  const plain = support.filter((f) => !f.login);
  if (plain.length) waves.push(wave('utils', 'utils', 'utils', plain));
  if (loginSupport.length + loginTests.length) waves.push(wave('login', 'login', 'login', [...loginSupport, ...loginTests]));

  const taken = new Set<string>();
  const rest = tests.filter((f) => !f.login).sort((a, b) => a.assertions - b.assertions || a.path.localeCompare(b.path));
  for (const file of rest) waves.push(...suiteWaves(file, taken));
  return { language: inventory.language, framework: inventory.framework, waves };
}

const cell = (text: string): string => text.replace(/\|/g, '\\|');

function sourcesCell(sources: string[]): string {
  if (sources.length === 0) return '-';
  return cell(sources.length <= 3 ? sources.join(', ') : `${sources.length} files`);
}

/** The plan as a markdown table, one row per wave. */
export function waveSummary(plan: MigrationPlan): string {
  const rows = plan.waves.map((w) => `| ${cell(w.name)} | ${w.kind} | ${sourcesCell(w.sources)} | ${w.tests} | ${w.assertions} |`);
  return ['| Wave | Kind | Sources | Tests | Assertions |', '| --- | --- | --- | ---: | ---: |', ...rows].join('\n');
}
