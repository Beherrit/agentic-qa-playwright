import { KEY } from './keys.ts';

/**
 * The suite's results in the shapes test management tools import, built from the same Playwright JSON report as
 * the traceability map, so the requirement and criteria tags travel with every test:
 *   junit     JUnit XML with the tags as properties, which most tools and dashboards read
 *   xray      Xray's JSON import, with each test's summary and its Jira requirement when the tag is a Jira key
 *   testrail  A CSV for TestRail's case import, with the requirement and criteria as references
 */

export type ExportFormat = 'junit' | 'xray' | 'testrail';
export const FORMATS: ExportFormat[] = ['junit', 'xray', 'testrail'];

type ReportResult = { status: string; duration?: number; error?: { message?: string } };
type ReportTest = { status: string; expectedStatus: string; results?: ReportResult[] };
type ReportSpec = { title: string; file?: string; line?: number; tags?: string[]; tests: ReportTest[] };
type ReportSuite = { title: string; specs?: ReportSpec[]; suites?: ReportSuite[] };

export type Outcome = 'passed' | 'failed' | 'flaky' | 'skipped' | 'expected-failure';
export type ExportedTest = { file: string; name: string; requirement: string | null; criteria: string[]; outcome: Outcome; seconds: number; message: string };

const CRITERION = /^AC-\d+$/;
const strip = (tag: string): string => tag.replace(/^@/, '');
const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '');

function outcomeOf(spec: ReportSpec): Outcome {
  const statuses = spec.tests.map((t) => t.status);
  if (statuses.includes('unexpected')) return 'failed';
  if (statuses.includes('flaky')) return 'flaky';
  if (statuses.length === 0 || statuses.every((s) => s === 'skipped')) return 'skipped';
  return spec.tests.some((t) => t.expectedStatus === 'failed') ? 'expected-failure' : 'passed';
}

/** One row per test, from a run's report. */
export function exportedTests(report: { suites?: ReportSuite[] }): ExportedTest[] {
  const out: ExportedTest[] = [];
  const walk = (suite: ReportSuite, parents: string[]): void => {
    const names = suite.title.endsWith('.ts') ? parents : [...parents, suite.title];
    for (const spec of suite.specs ?? []) {
      const tags = (spec.tags ?? []).map(strip);
      const results = spec.tests.flatMap((t) => t.results ?? []);
      out.push({
        file: spec.file ?? '',
        name: [...names, spec.title].join(' > '),
        requirement: tags.find((t) => KEY.test(t) && !CRITERION.test(t)) ?? null,
        criteria: tags.filter((t) => CRITERION.test(t)),
        outcome: outcomeOf(spec),
        seconds: results.reduce((sum, r) => sum + (r.duration ?? 0), 0) / 1000,
        message: stripAnsi(results.find((r) => r.error?.message)?.error?.message ?? '').split('\n')[0].slice(0, 300),
      });
    }
    for (const child of suite.suites ?? []) walk(child, names);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return out;
}

const xml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function junitXml(tests: ExportedTest[]): string {
  const byFile = new Map<string, ExportedTest[]>();
  for (const t of tests) byFile.set(t.file, [...(byFile.get(t.file) ?? []), t]);
  const suites = [...byFile].map(([file, own]) => {
    const failures = own.filter((t) => t.outcome === 'failed').length;
    const skipped = own.filter((t) => t.outcome === 'skipped').length;
    const cases = own.map((t) => {
      const props = [
        ...(t.requirement ? [`<property name="requirement" value="${xml(t.requirement)}"/>`] : []),
        ...(t.criteria.length ? [`<property name="criteria" value="${xml(t.criteria.join(' '))}"/>`] : []),
        `<property name="outcome" value="${t.outcome}"/>`,
      ];
      const body =
        t.outcome === 'failed'
          ? `<failure message="${xml(t.message)}"/>`
          : t.outcome === 'skipped'
            ? '<skipped/>'
            : t.outcome === 'flaky'
              ? `<system-out>flaky: passed on retry</system-out>`
              : '';
      return `    <testcase name="${xml(t.name)}" classname="${xml(file)}" time="${t.seconds.toFixed(3)}">\n      <properties>${props.join('')}</properties>\n      ${body}\n    </testcase>`;
    });
    return `  <testsuite name="${xml(file)}" tests="${own.length}" failures="${failures}" skipped="${skipped}">\n${cases.join('\n')}\n  </testsuite>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="${tests.length}" failures="${tests.filter((t) => t.outcome === 'failed').length}">\n${suites.join('\n')}\n</testsuites>\n`;
}

/** Xray Cloud's JSON import. A requirement that is a Jira key becomes the test's requirement; REQ-n and PR-n are not Jira issues. */
export function xrayJson(tests: ExportedTest[]): string {
  const status = { passed: 'PASSED', failed: 'FAILED', flaky: 'PASSED', skipped: 'TODO', 'expected-failure': 'PASSED' } as const;
  const jiraKey = (key: string | null): boolean => key !== null && !/^(REQ|PR|ADO)-/.test(key);
  return `${JSON.stringify(
    {
      tests: tests.map((t) => ({
        testInfo: {
          summary: t.name,
          type: 'Generic',
          definition: `${t.file}: ${t.name}`,
          ...(jiraKey(t.requirement) ? { requirementKeys: [t.requirement] } : {}),
          ...(t.criteria.length ? { labels: t.criteria } : {}),
        },
        status: status[t.outcome],
        comment: [t.outcome === 'expected-failure' ? 'Expected failure (test.fail): the app disagrees with the criterion, or the feature is not built yet.' : '', t.message]
          .filter(Boolean)
          .join(' '),
      })),
    },
    null,
    2,
  )}\n`;
}

/** A CSV for TestRail's case import: title, section, references and the last result. */
export function testrailCsv(tests: ExportedTest[]): string {
  const cell = (text: string): string => `"${text.replace(/"/g, '""')}"`;
  const rows = tests.map((t) =>
    [t.name, t.file, [t.requirement, ...t.criteria].filter(Boolean).join(', '), 'Automated', t.outcome, t.message].map(cell).join(','),
  );
  return `Title,Section,References,Type,Last result,Message\n${rows.join('\n')}\n`;
}

export function exportAs(format: string, tests: ExportedTest[]): { name: string; text: string } {
  if (format === 'junit') return { name: 'coverage.junit.xml', text: junitXml(tests) };
  if (format === 'xray') return { name: 'coverage.xray.json', text: xrayJson(tests) };
  if (format === 'testrail') return { name: 'coverage.testrail.csv', text: testrailCsv(tests) };
  throw new Error(`Unknown export format "${format}". Use ${FORMATS.join(', ')}.`);
}
