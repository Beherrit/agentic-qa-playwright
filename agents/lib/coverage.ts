import { KEY } from './keys.ts';

/**
 * The standing answer to "which requirement does this test exist for, and is it passing?".
 * Built from the tags the tests carry (@REQ-12 or @SHOP-123, and @AC-n), with no model involved.
 */

type ReportTest = { status: string; expectedStatus: string };
type ReportSpec = { title: string; file?: string; tags?: string[]; tests: ReportTest[] };
type ReportSuite = { title: string; specs?: ReportSpec[]; suites?: ReportSuite[] };

type State = 'passing' | 'expected-failure' | 'failing' | 'flaky' | 'not-run';

export type Tally = { tests: number; passing: number; expectedFailures: number; failing: number; flaky: number };
export type RequirementCoverage = Tally & { key: string; criteria: { id: string; tests: string[] }[] };
export type CoverageMap = { ran: boolean; requirements: RequirementCoverage[]; untagged: Tally };

const CRITERION = /^AC-\d+$/;
const strip = (tag: string): string => tag.replace(/^@/, '');

function stateOf(spec: ReportSpec): State {
  const statuses = spec.tests.map((test) => test.status);
  if (statuses.includes('unexpected')) return 'failing';
  if (statuses.includes('flaky')) return 'flaky';
  if (statuses.length === 0 || statuses.every((status) => status === 'skipped')) return 'not-run';
  return spec.tests.some((test) => test.expectedStatus === 'failed') ? 'expected-failure' : 'passing';
}

const emptyTally = (): Tally => ({ tests: 0, passing: 0, expectedFailures: 0, failing: 0, flaky: 0 });

function count(tally: Tally, state: State): void {
  tally.tests += 1;
  if (state === 'passing') tally.passing += 1;
  if (state === 'expected-failure') tally.expectedFailures += 1;
  if (state === 'failing') tally.failing += 1;
  if (state === 'flaky') tally.flaky += 1;
}

/** Reads a Playwright JSON report: one from a run, or one from `--list`, where nothing has a result yet. */
export function coverageMap(report: { suites?: ReportSuite[] }): CoverageMap {
  const specs: (ReportSpec & { name: string })[] = [];
  const walk = (suite: ReportSuite, parents: string[]): void => {
    const names = suite.title.endsWith('.ts') ? parents : [...parents, suite.title];
    for (const spec of suite.specs ?? []) specs.push({ ...spec, name: [...names, spec.title].join(' > ') });
    for (const child of suite.suites ?? []) walk(child, names);
  };
  for (const suite of report.suites ?? []) walk(suite, []);

  const byKey = new Map<string, RequirementCoverage>();
  const untagged = emptyTally();
  let ran = false;

  for (const spec of specs) {
    const tags = (spec.tags ?? []).map(strip);
    const keys = tags.filter((tag) => KEY.test(tag) && !CRITERION.test(tag));
    const criteria = tags.filter((tag) => CRITERION.test(tag));
    const state = stateOf(spec);
    if (state !== 'not-run') ran = true;

    if (keys.length === 0) count(untagged, state);
    for (const key of keys) {
      const entry = byKey.get(key) ?? { key, ...emptyTally(), criteria: [] };
      count(entry, state);
      for (const id of criteria) {
        const criterion = entry.criteria.find((c) => c.id === id) ?? entry.criteria[entry.criteria.push({ id, tests: [] }) - 1];
        criterion.tests.push(spec.name);
      }
      byKey.set(key, entry);
    }
  }

  const number = (id: string): number => Number(id.split('-').pop());
  const requirements = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  for (const requirement of requirements) requirement.criteria.sort((a, b) => number(a.id) - number(b.id));
  return { ran, requirements, untagged };
}

/** What the run history says about flakiness: tests and how often, over the newest runs that could say. */
export type FlakeTrend = { test: string; count: number; runs: number }[];

export function flakeTrendMd(trend: FlakeTrend): string {
  if (!trend.length) return '';
  const runs = trend[0].runs;
  return `\n### Flaky lately\n\n${trend.length} test(s) failed and then passed in the last ${runs} recorded run(s). A test here needs a look before it blocks someone.\n\n${trend
    .map((f) => `- ${f.test} (${f.count} of ${runs})`)
    .join('\n')}\n`;
}

export function coverageMd(map: CoverageMap, trend: FlakeTrend = []): string {
  const results = (t: Tally): string => (map.ran ? ` ${t.passing} | ${t.expectedFailures} | ${t.failing} | ${t.flaky} |` : '');
  const header = map.ran
    ? '| Requirement | Criteria with a test | Tests | Passing | Expected failures | Failing | Flaky |\n|---|---|---|---|---|---|---|'
    : '| Requirement | Criteria with a test | Tests |\n|---|---|---|';

  const rows = map.requirements.map((r) => `| ${r.key} | ${r.criteria.map((c) => c.id).join(', ') || 'none tagged'} | ${r.tests} |${results(r)}`);
  if (map.untagged.tests) rows.push(`| (no ticket) | | ${map.untagged.tests} |${results(map.untagged)}`);

  const expected = map.requirements.reduce((sum, r) => sum + r.expectedFailures, 0) + map.untagged.expectedFailures;
  const detail = map.requirements
    .map(
      (r) =>
        `<details><summary>${r.key}: which test proves which criterion</summary>\n\n${r.criteria
          .map((c) => `**${c.id}**\n${c.tests.map((test) => `- ${test}`).join('\n')}`)
          .join('\n\n')}\n\n</details>`,
    )
    .join('\n\n');

  const tagged = map.requirements.reduce((sum, r) => sum + r.tests, 0);
  const all: Tally = [...map.requirements, map.untagged].reduce(
    (t, r) => ({
      tests: t.tests + r.tests,
      passing: t.passing + r.passing,
      expectedFailures: t.expectedFailures + r.expectedFailures,
      failing: t.failing + r.failing,
      flaky: t.flaky + r.flaky,
    }),
    emptyTally(),
  );
  const verdict = map.ran
    ? `**Last run: ${all.failing ? `${all.failing} failing` : 'nothing failing'}.** ${all.passing} passing, ${all.expectedFailures} expected failures, ${all.flaky} flaky, of ${all.tests} tests.`
    : `**No results yet: these are the tests as listed.** Run the suite to see how they do.`;
  return `## Traceability map

${verdict}

${map.requirements.length} ticket(s) with tests: ${tagged} tests claim ${map.requirements.reduce((sum, r) => sum + r.criteria.length, 0)} criteria; ${map.untagged.tests} tests belong to no ticket.

${header.replace('| Requirement |', '| Ticket |')}
${rows.join('\n')}
${expected ? `\n${expected} expected failure(s): tests marked with \`test.fail()\` for a known bug or a feature not built yet. They are debts, not passes.\n` : ''}${flakeTrendMd(trend)}
${detail}
`;
}
