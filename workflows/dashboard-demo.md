# Demo script: the dashboards in five minutes

For showing the live site, <https://beherrit.github.io/agentic-qa-playwright/>. Nothing needs to run during the
demo; everything on the page was produced by workflows that already ran. The longer walkthrough of the pipeline
itself is [demo-script.md](demo-script.md); the QA detail is [docs/DEMO.md](../docs/DEMO.md).

The one line: **every number on this site was measured or counted by code, the agents only ever explain, and the
page rebuilds itself from two branches whenever a run finishes. There is no server and nothing to log in to.**

## 0. What you are looking at (30 seconds)

Open the root. Say: one static site, built by GitHub Actions from two branches the pipeline writes to. The root is
the executive summary: year-to-date figures, what the failures turned out to be, CI efficiency and a 30-day trend.
Three places sit under it: `pipeline/` (the pipeline's own run history), `projects/<slug>/` (one page per project
the regression suite covers) and `perf/` (performance). The history lives on `qa-history`, the performance page on
`qa-perf`, and a third workflow stitches them together and deploys. No database, no hosting bill, and the HTML has
no external scripts, so it works on a locked-down laptop.

## 1. Run history: what the pipeline costs and how often it is right (1 minute)

Open `/pipeline/`; this used to be the root. Point at the tiles: runs, how often the gates passed, how often the reviewer approved first time, the average cost
per run. Then the seven-day rollup underneath: cost per role, the tickets that cost the most, the gates that
blocked. Say: this is the manager's view. Each row below is one run of the analysis or test half, with the plan
score, every gate's verdict, the review verdict, agent time and estimated cost, and a link to the run.

Type a ticket key into the filter. The table narrows to that ticket's runs. Say: the data is in the page itself,
read back from a JSON block; the filter is thirty lines of script and nothing is fetched.

## 1b. A project page (1 minute)

Open `/projects/<slug>/`. Start at the recent runs table: one row per regression run with pass rate and duration.
Then the regressions table, which lists exactly the tests that passed last run and failed in this one, with the
first line of the error. Point at the failure clusters: the same error across several tests and runs is one cause,
not five. Type a test name or a browser into the filter in Test health and the table narrows; the data is in the
page, nothing is fetched.

## 2. Performance: the pages a shopper actually sees (1.5 minutes)

Open `/perf/`. The tiles first: page audits in the last run, how many failed, the median score, the worst LCP,
console and request errors. Then the table, worst page first.

Point at the inventory page on mobile. Say what the row says: the score, the LCP, a layout shift of 0.7 where 0.1
is the budget, and in the Why column the budget it broke. Click the full report link, which is the Lighthouse
report of the median of three runs, and show the layout shift element: the product list. Say: that is a real
rendering issue a shopper on a phone feels, found before anyone complained.

Back on the table, point at the Errors column. Every deep link on this shop goes through the host's 404 page and a
redirect, which costs most of a second on mobile. Say: Lighthouse alone would have reported the timing; Playwright
on the same visit caught the console error that explains it.

Point at the score trend sparklines, one per page, and the two charts: median score per run, worst LCP per run.
Say: a regression shows up here as a bar that drops, and the gate fails the run when a page gets worse than the
last one by more than the configured amount, before anyone has to look at a chart.

## 3. Why the numbers can be trusted (1 minute)

Say it plainly: nothing on either page is a model's opinion. The scores come from Lighthouse, the median of three
runs because one run is noise. The budgets and the allowed regression are numbers a person wrote in
`qa.config.json`. The gate results are commands that passed or failed.

Then the one place a model appears: when a page fails, the performance analyst is asked to say why. Open the run's
summary on GitHub and show its findings. Point out that each one names Lighthouse audit ids, and say: a finding
that names an audit the report does not contain, or a page that passed, is dropped by code before anyone reads it.
In the first run on GitHub the analyst attributed one page, the home page's render-blocking font stylesheet, and
said of the other four that the evidence did not single out a cause. Saying "I cannot tell" is the answer the
prompt asks for, and it is cheaper than a confident guess. That is what "no slop" means in practice.

## 4. How it stays current (30 seconds)

Open the Actions tab. Say: the history page updates whenever QA analysis, QA tests or Regression finishes; the
performance page whenever Performance finishes; the site redeploys after either. Performance is on demand only
for now, by choice, until the budgets have settled; one line in the workflow adds a schedule or a pull request
trigger.

## 5. Questions that come up (30 seconds)

- *Can we point it at our app?* Yes. `npx agentic-qa init` writes the config and the caller workflows into any
  Playwright project; the performance gate needs `lighthouse` installed and a sign-in module of a few lines.
- *What does a run cost?* The history page says, per run and per role. The performance analyst costs around fifteen
  cents when it runs, and it only runs after a failure.
- *Is this a dashboard product?* No. It is two HTML files written by the pipeline and served by GitHub Pages. The
  value is in what feeds them.
