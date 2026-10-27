/**
 * The executive summary: the site root. At-a-glance figures counted from the test rows (tests.jsonl) and the
 * pipeline's own run entries, no filters, always current. Pure: rows and entries in, one HTML document out.
 */
import { summary, type RunEntry } from '../history.ts';
import { areaChart, card, count, dateText, delta, hours, meter, pageShell, pct, relLink, secs, stat, stats, table } from './html.ts';
import { dailyTrend, distinctTests, durations, hoursSaved, inWindow, passRate, projects, retries, runTotals, verdicts } from './stats.ts';
import type { TestEntry } from './types.ts';

export type SummaryOptions = {
  rows: TestEntry[];
  runs: RunEntry[];
  projects: { slug: string; name: string }[];
  manualMinutesPerTest: number;
  now?: Date;
};

const MS_PER_HOUR = 3_600_000;
const dollars = (n: number): string => `$${n.toFixed(2)}`;

/** Rows that finished in the current calendar year (UTC). */
const thisYear = (rows: TestEntry[], now: Date): TestEntry[] => rows.filter((r) => new Date(Date.parse(r.finishedAt)).getUTCFullYear() === now.getUTCFullYear());

function yearToDate(rows: TestEntry[], minutes: number, now: Date): string {
  const year = thisYear(rows, now);
  const saved =
    minutes > 0
      ? stat('QA hours saved', hours(hoursSaved(year, minutes) * MS_PER_HOUR), `at ${minutes} min per test run by hand, set in qa.config.json`)
      : stat('QA hours saved', 'not estimated', 'set history.manualMinutesPerTest in qa.config.json');
  return card(
    'Year to date',
    String(now.getUTCFullYear()),
    stats([
      saved,
      stat('Test runs', count(runTotals(year).length)),
      stat('Pass rate', pct(passRate(year))),
      stat('Test coverage', count(distinctTests(year)), 'unique tests'),
    ]),
  );
}

function failures(rows: TestEntry[], now: Date): string {
  const v = verdicts(inWindow(rows, 90, now));
  const unseen = v.unclassified > 0 ? `<p class="muted">${count(v.unclassified)} failures triage did not see.</p>` : '';
  const signal = meter('Signal: real bugs among classified failures', v.signal === null ? null : v.signal / 100, pct(v.signal));
  const row = stats([
    stat('Real bugs', count(v.productBug)),
    stat('Test defects', count(v.testDefect)),
    stat('Environment', count(v.environment)),
    stat('Flaky', count(v.flaky)),
  ]);
  return card('What the failures were', 'last 90 days, as triage judged them', `${row}\n${signal}\n${unseen}`);
}

function efficiency(rows: TestEntry[], now: Date): string {
  const year = thisYear(rows, now);
  const d = durations(year);
  const r = retries(year);
  return card(
    'CI efficiency',
    'year to date',
    stats([
      stat('Median test duration', secs(d.medianMs)),
      stat('P95 test duration', secs(d.p95Ms)),
      stat('Retry success rate', pct(r.successRate), `${count(r.retried)} retried, ${count(r.recovered)} recovered`),
      stat('Retry waste', hours(r.wastedMs), `${count(r.extraAttempts)} extra attempts`),
    ]),
  );
}

function recentTrend(rows: TestEntry[], now: Date): string {
  const month = inWindow(rows, 30, now);
  const week = passRate(inWindow(rows, 7, now));
  const base = passRate(month);
  const dir = week === null || base === null || week === base ? 'flat' : week > base ? 'up' : 'down';
  const ran = month.filter((r) => r.status !== 'skipped').length;
  const skipped = month.filter((r) => r.status === 'skipped').length;
  const row = stats([
    stat('Last 7 days pass rate', pct(week), undefined, { text: delta(week, base, '30 day pass rate'), dir }),
    stat('Tests run', count(ran), 'last 30 days'),
    stat('Failures', count(month.filter((r) => r.status === 'failed').length), 'last 30 days'),
    stat('Skipped', month.length ? pct((skipped / month.length) * 100) : '-', `${count(skipped)} of ${count(month.length)} rows`),
  ]);
  const chart = areaChart({
    title: 'Pass rate per day, all projects',
    points: dailyTrend(rows, 30, now).map((t) => ({ label: dateText(t.finishedAt), value: t.passRate })),
    max: 100,
    target: 95,
    format: (n) => pct(n),
    yLabel: 'Pass rate (%)',
  });
  return card('Recent trend', 'last 30 days', `${row}\n${chart}`);
}

function projectTable(rows: TestEntry[], names: Map<string, string>, now: Date): string {
  const body = projects(rows, now).map((p) => [
    { html: relLink(`projects/${p.project}/`, names.get(p.project) ?? p.project) },
    count(p.runs),
    dateText(p.lastFinishedAt),
    pct(p.lastPassRate),
    pct(p.passRate30d),
    count(p.tests),
    count(p.flaky),
  ]);
  const columns = ['Project', 'Runs', 'Last run', 'Last pass rate', '30-day pass rate', 'Tests', 'Flaky (30d)'];
  return card('Projects', '', table(columns, body, { numeric: [1, 3, 4, 5, 6], empty: 'No regression run has been recorded yet.' }));
}

function pipeline(runs: RunEntry[]): string {
  const s = summary(runs);
  const gated = runs.filter((e) => e.gatesPassed !== null);
  const passed = gated.filter((e) => e.gatesPassed === true).length;
  const items = stats([
    stat('Analysis runs', count(s.analysisRuns)),
    stat('Tests runs', count(s.testsRuns)),
    stat('Gates passed', gated.length ? pct((passed / gated.length) * 100) : '-', `${count(passed)} of ${count(gated.length)} runs that reached the gates`),
    stat('Estimated cost', dollars(s.totalCostUsd), 'all pipeline runs'),
  ]);
  return card('Pipeline', 'the agentic half', `${items}\n<p>${relLink('pipeline/', 'Open the run history')}</p>`);
}

export function summaryHtml(opts: SummaryOptions): string {
  const now = opts.now ?? new Date();
  const names = new Map(opts.projects.map((p) => [p.slug, p.name]));
  const body = [
    yearToDate(opts.rows, opts.manualMinutesPerTest, now),
    failures(opts.rows, now),
    efficiency(opts.rows, now),
    recentTrend(opts.rows, now),
    projectTable(opts.rows, names, now),
    pipeline(opts.runs),
  ].join('\n');
  return pageShell({
    title: 'QA executive summary',
    intro: "Every number on this page was counted by code from the suite's own reports; each block's caption says the time window it covers.",
    nav: [
      { href: 'pipeline/', text: 'Pipeline run history' },
      ...opts.projects.map((p) => ({ href: `projects/${p.slug}/`, text: p.name })),
      { href: 'perf/', text: 'Performance' },
    ],
    body,
  });
}
