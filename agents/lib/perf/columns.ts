/**
 * The columns of the performance page's two tables, each with a plain-language explanation. The page shows the
 * explanation on hover over the column name and in a legend under the table, so a reader who has never met
 * Lighthouse can tell what a number means. README.md on the branch gets the same legend as a list.
 */

export type Column = { label: string; help: string };

/** One row per page and device of the last run. */
export const PAGE_COLUMNS: Column[] = [
  { label: '', help: 'pass when the page met every budget and did not regress against the previous run; FAIL otherwise.' },
  { label: 'Page', help: 'The route, and the device it was audited as: mobile (a throttled phone) or desktop.' },
  { label: 'Score', help: 'Lighthouse performance score, 0 to 100, the median of several runs of the page. 90 and up is good, 50 to 89 needs work, under 50 is poor.' },
  { label: 'LCP', help: 'Largest Contentful Paint: how long until the biggest thing on the page (a hero image, the main heading) was on screen. Under 2.5 seconds is good, over 4 is poor.' },
  { label: 'CLS', help: 'Cumulative Layout Shift: how much the content jumped around while loading. 0 means nothing moved; under 0.1 is good, over 0.25 is poor.' },
  { label: 'TBT', help: 'Total Blocking Time: how long the page was too busy running scripts to react to a tap or click. Under 200 ms is good, over 600 ms is poor.' },
  { label: 'Errors', help: 'Console errors, page errors and failed requests the browser saw while the page was visited. Counted by Playwright, not by Lighthouse.' },
  { label: 'Changed', help: 'How different the page looked from the previous run: the share of screenshot pixels that changed. A dash means there was no previous run to compare with.' },
  { label: 'Score trend', help: 'This page\'s score over recent runs, oldest on the left, newest on the right.' },
  { label: 'Why', help: 'What failed: the budget the page broke, or how far it regressed from the previous run. A dash means it passed.' },
  { label: 'Full report', help: 'The full Lighthouse report of the median run, with every audit behind the score and what to fix.' },
];

/** One row per run, newest first. */
export const RUN_COLUMNS: Column[] = [
  { label: 'Date (UTC)', help: 'When the run finished.' },
  { label: 'Result', help: 'How many pages passed. "advisory" means a failure was reported but did not turn the run red.' },
  { label: 'Median score', help: 'The middle performance score across every page of the run.' },
  { label: 'Worst LCP', help: 'The slowest Largest Contentful Paint of any page in the run.' },
  { label: 'Persona', help: 'The account the browser was signed in as during the audit.' },
  { label: 'Commit', help: 'The code that was audited.' },
  { label: 'Run', help: 'The GitHub Actions run that produced it, with the logs and the downloadable reports.' },
];
