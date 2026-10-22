# Changelog

What changed, newest first, reconstructed from the git history. There are no version numbers yet: the pipeline is
deployed from `main`, so each entry is dated by its commits.

## Unreleased

### Added

- **Test layers for the whole team** (`layers` in `qa.config.json`). A project lists its layers cheapest first, each
  with what it proves, its tools, its owner and optionally the checkout its tests live in. The architect, critic and
  reconciler plan across them and can only answer with the project's ids; the architect may read the other layers'
  checkouts to find existing tests, named `<layer>:<path>` and checked on disk. The report hands each layer's cases
  to its owner. Without a list, `lower-layer`, `e2e` and `manual` apply as before.
- **Deep context** (`context`). The intake job reads the parent, children, subtasks and linked issues of a Jira
  ticket, the sub-issues and `#n` references of a GitHub issue, and, with `FIGMA_TOKEN`, the frames of linked Figma
  designs (frame names and on-screen words). Each piece passes the fixed safety rules or is left out with a note,
  and the screening agent reads all of it with the ticket. On GitHub only issues written by the repository's owners,
  members and collaborators are read; anyone else's is listed by number. **On by default:** `context.related` and
  `context.figma` send that linked text to the model along with the ticket. Set them to `false` to keep to the
  ticket alone.
- **Per-layer tasks** (`npx agentic-qa tasks`, `tasks.enabled`). One GitHub sub-issue or Jira subtask per layer,
  holding that layer's cases as a checklist; rewritten only when the plan changed, never closed by the pipeline.
- **A wider test design library**: pairwise sets, exploratory charters and ten failure lenses that error guessing,
  the critic's checklist and every charter start from.

- **The Selenium migration** (`npx agentic-qa migrate plan|run --from <old> --to <new>`). The old project is
  inventoried by code (language, runner, every test and its assertion count) and moved in fixed waves: settings,
  utilities and page objects, login, then one test module at a time, each gated before the next starts. The settings
  migrator answers with values and their evidence, and code writes the Playwright config from them. The test
  migrator writes one wave inside `tests/`, `pages/` and `fixtures/` and answers with a verbatim map from every old
  test and assertion to the new one, which the parity check looks up in the files. Gates: static rules (no serial
  mode, no `.only`, no skips, no sleeps, no shared state), types, lint, the new specs shuffled twice over with four
  workers, and one inverted assertion per test that must make the test fail. One fix round per wave; a failed
  suite is recorded and the next runs, a failed prerequisite stops the run. Built for Grid suites: the inventory
  marks each file's habits (shared driver, ordered tests, static state, sleeps, implicit waits, retry loops, the
  hub), each with a rule the migrator is given; assertion helpers count as assertions; files over ten tests are
  split into waves; `--limit` bounds a pilot; the report opens with waves passed first time, after a fix round,
  or failed. The proof is a Python, pytest and Selenium Grid fixture for Swag Labs under
  `agents/evals/fixtures/selenium-shop/`, with an ordered checkout flow on a shared session.

- **The performance gate** (`perf.yml`, on demand; `npm run perf -- run`). Playwright launches one Chromium with a
  debugging port and signs in with the project's own module (`perf.setup`); for every route (`perf.routes`, the
  sitemap, a bounded crawl of the signed-in pages) it records console errors, failed requests and a screenshot, and
  Lighthouse measures the page through the same browser, mobile and desktop, `perf.runs` times. The median is judged
  against `perf.budgets` and against the last recorded run (`perf.regression`, including the share of screenshot
  pixels that changed). The result goes on the `qa-perf` branch as `runs.jsonl`, a README, the last run's full
  reports and a self-contained `index.html`, ready for GitHub Pages. One agent, the performance analyst, runs only
  after a page failed and must cite audit ids that exist in the page's own report; anything else is dropped before it
  is shown. `npm run perf -- prove` audits two local pages, one clean and one with a render-blocking script and an
  unsized banner that arrives after first paint, and shows the gate fails the right one and names both faults.
  `lighthouse` is a dev dependency here and a host installs it only to turn the gate on.

- **The history page rolls up the last seven days**: runs, cost and cost per run, cost and average turns per role, the
  most expensive tickets, the gates that blocked, and today's spend against a new `budget.maxUsdPerDay`, which the
  history workflow warns about when it is over.
- **Two proving workflows.** `Compatibility` runs the unit tests, typecheck and lint on Linux, Windows and macOS with
  Node 22 and 24, and the packed-install test on Playwright 1.50 and the latest. `Second host` runs the whole pipeline
  against OWASP Juice Shop in a container every week, and its dry form (no agents) on pull requests. The host template's
  Playwright config now typechecks on older Playwright too.
- **Three browser levels for the agents**, each the smaller one plus what the job needs: `look` (read the page, the
  console and the network log), `test` (Playwright's preferred locator for an element and live checks of an
  assertion before it is written; the engineer and the healer) and `break` (answer, slow or drop requests and change
  cookies and storage, to try a fault before writing it; the saboteur). The Playwright MCP server starts with only
  the capabilities a level needs, WebMCP off, generated code only for the roles that write code, short action and
  navigation timeouts, and, when `browser.allowedOrigins` is set, no way to reach any origin but the app's own and
  the listed ones. The saboteur's prompt now treats network faults as a first choice where the break belongs there.
- **`init` scaffolds a suite in the recommended shape** for a project that has none: `playwright.config.ts` (reads
  the app's address from `qa.config.json`; Firefox and WebKit configured with `default: false`), `tsconfig.json`,
  `fixtures/test.ts` with a page-object fixture, `pages/BasePage.ts` and `pages/HomePage.ts`, a tagged
  `tests/smoke.spec.ts`, `.github/CODEOWNERS` for the shared layers, `.gitignore` and `.env.example`. Files that
  exist are kept, as before. The conventions now say what the layout is and which folders not to add, and
  `docs/project-structure.md` gives the reasoning.
- **The gates shuffle the suite.** Playwright 1.64's `--shuffle` runs the full-suite and stability gates in a
  random order, one seed per run, with the seed and the command that repeats it in the gate summary. A test that only
  passes after another one now fails in the pipeline, not in a month. `gates.shuffle` in `qa.config.json` turns it
  off; a host on an older Playwright is left alone. Playwright is bumped to 1.64; Firefox and WebKit are configured
  with `default: false`, so the gates run Chromium and `--project="*"` runs the rest. The conventions now cover
  `locator.within()`, `locator.visible()` and test locks for shared server-side state.
- **An example of the shape applied to a whole company** (`examples/company-agents/`): twelve role prompts (merge
  request describer and reviewer, ticket writer and enricher, release documenter, documentation drift checker, chat
  responder, alert triager, incident scribe, weekly digest, onboarding guide, and a general request screener), the
  schemas they answer in, a `co` CLI anyone in a company can run with adapters for GitHub, GitLab, Jira, Confluence,
  Slack and Teams, three-job workflows for GitHub Actions and GitLab CI that keep the model key and the tracker tokens
  in different jobs, eval cases including adversarial ones, and the guardrails and adoption guides. The fixed rules,
  identity checks and validators have unit tests under `npm run test:unit`.
- **The company agents read through MCP servers**, each in read-only mode with its tools allowlisted by name: GitHub
  (`github/github-mcp-server`), Atlassian (the official hosted server, Jira and Confluence), TestRail
  (`@bun913/mcp-testrail`) and Figma. Two roles with them: a test case writer that drafts manual cases into one
  TestRail section, and a design reviewer that lists where a merge request and its Figma frame disagree. `co doctor`
  reports what is missing. An onboarding container (`examples/company-agents/docker/`) for Mac and Windows carries
  Node, the Claude Code CLI, `co` and the servers, with a guided first run and an `.env.example` of every token name.

### Fixed

- **The expected-failures gate counts criteria, not tests.** Three tests marked as the same product bug (one per
  field) needed three bug reports and stopped a run; one bug per disputed criterion is now enough.

- **An agent that writes a summary instead of handing in its answer** (haiku did, after thirteen minutes of
  passing tests) is no longer a failed run. Its session is resumed with everything it did in context and asked for
  the answer alone, once, in three turns at most. The cost ledger records the whole session.

### Added

- **A safety screen** in front of every requirement. Fixed rules (`agents/lib/safety.ts`) catch text that asks for
  the repository to be deleted or rewritten, secrets or personal data to be sent somewhere, another site to be
  tested or attacked, the pipeline's own checks to be bypassed, or instructions aimed at the agents. If no rule
  objects, a read-only `request-screener` answers proceed, refuse or ask. A refusal posts its reasons, labels the
  ticket `qa-refused` and stops. `safety.enabled` and `safety.screener` in `qa.config.json` switch it. Five evaluation
  cases cover it.
- **`npx agentic-qa intake`**: a conversation that turns a wish into a ticket. It screens the wish, asks the skeptic's
  and the analyst's questions, at most `intake.maxQuestions` a round, in up to `intake.maxRounds` rounds, writes the ticket with the answers under "Questions
  and answers", and files it only on a yes. `--dry` files nothing, `--yes` never skips the screen. The MCP server has
  `qa_intake_start`, `qa_intake_answer` and `qa_intake_file`. With `--ref`, `intake` is still the CI stage that reads
  a ticket in.
- **A skeptic.** Before the analyst, a new role reads the story alone and lists every question a developer would
  have to guess the answer to, from three angles (a developer's guess, a frustrated user, the same thing twice),
  each with the answer the tests will assume. The questions are posted on the ticket, numbered after any blocking
  ones, and a `/qa-answer` comment re-runs the analysis on an analysed ticket too, not only a blocked one. The
  analyst folds the guesses into the assumptions and criteria, and once the skeptic has asked, its own open
  questions are blocking or dropped; the critic checks the plan tests them. An evaluation case covers the role.
- **A model for every role not named.** `models` in `qa.config.json` takes a `*` entry, so a project can keep
  sonnet for the roles that write code and put the reading roles on haiku. The demo stays on sonnet everywhere:
  haiku was tried, and the engineer took six times longer.
- **Answer and requeue.** A `/qa-answer` comment from a member of the project re-runs the analysis on a blocked
  ticket, with the questions and the answers in front of the analyst. The trigger and the intake both check the
  author. Jira gets an automation rule for it.
- **An install test** (`agents/test/install.sh`, part of Regression in this repository): the package is packed,
  installed into an empty project next to Playwright, set up and used. It found that Node refuses to run
  TypeScript from `node_modules`, so the bin now runs through `tsx`, a runtime dependency.
- **Flaky tests in the history.** Regression runs on the default branch are recorded on `qa-history` with the
  tests triage judged flaky; tests runs record the existing tests the full-suite gate retried. The traceability map
  ends with "Flaky lately".
- `.github/dependabot.yml`, an `npm audit` step for runtime dependencies, and a release procedure in CONTRIBUTING.

- **The engine is a tool a project installs.** `npx agentic-qa` is the command line; the package installs from git
  into any Playwright project; `npx agentic-qa init` writes the config, the documents, the four caller workflows,
  the issue form, `.mcp.json` and the fault fixture; the engine's workflows take `workflow_call`. Two roots: the
  package (prompts, templates) and the project (the nearest `qa.config.json`, or `QA_PROJECT_ROOT`).
- **`survey`:** an agent reads an existing suite and drafts the product brief, the conventions and the `suite`,
  `personas` and `auth` settings. Every path and command it names is checked before anything is written.
- **A pull request as a requirement** (`source: pr`): its description, files and diff are the ticket; the analyst
  derives behaviour from the change; the tests are opened against the pull request's own branch, and run against
  `app.previewUrl` when set.
- **Sign-in through a storage state** (`auth.setup`, `auth.storageState`), run once before the tests and before any
  agent gets a browser, which starts from it.
- **Fault injection** as a sensitivity target: an init script and route rules make a broken version of the app for
  one run, applied by `fixtures/fault.ts`. The demo has one that removes the cart badge.
- **Model providers and a budget:** `QA_PROVIDER_ENV` carries Bedrock or Vertex settings in one secret;
  `budget.maxUsdPerRun` stops a run at the cap and gives each agent what is left.
- **Azure DevOps Boards and Linear** as trackers, and `coverage --export junit|xray|testrail`.
- Commands `suite`, `check`, `coverage`, `triage`, `heal`, `history` and `mcp` on the one command line.

### Changed

- **The full-suite gate** gives an existing test that fails one retry by itself. Passing then is reported as flaky
  by name and does not block; failing again does, with a note that a shared page object may be the cause. New tests
  never get a retry. `gates.retryExistingOnce: false` restores the old behaviour.
- Third-party actions are pinned to commit SHAs. The setup action and the host callers use `@v1`, a pointer to the
  newest 1.x release, instead of `@main`.

- The config is read through a zod schema with defaults, so a host config can be five lines and `doctor` names
  every wrong field. `suite.commands`, `suite.specGlob`, `suite.testImport` and `personas.envVar` replace what used
  to be this repository's own shape; `QA_PERSONA` replaces `SAUCE_USER` in the engine and the workflows, and the
  suite receives it under the variable it reads.
- Code generation is three jobs: the engineer writes with the credentials, the gates run in a job with none, and
  the one fix round is a job of its own.
- The prompts no longer name `fixtures/personas.ts`; an agent signs in the way the product brief says, or starts
  from the storage state.
- The demo guide is written around a fresh end-to-end run (issue #17) and a two-minute install into another project.

## 2026-10-02, second pass (pull request #16)

### Added

- **Technical review**, a stage of its own between Requirements and Strategy (`1b Technical review` in
  `qa-analysis.yml`). Every ticket gets technical notes: tests that already cover it, page objects and locators,
  nearby behaviour at risk, related open tickets and a technical risk. A ticket writer's notes are read back and kept;
  other tickets get a read-only reviewer with a browser. Files, test titles and tickets are checked in code, and what
  fails a check is listed. The architect and the engineer receive the result.
- **MCP server** (`npm run mcp`): `qa_draft_ticket`, `qa_analyze`, `qa_coverage`, `qa_history`, `qa_doctor` and
  `qa_status` for Claude Desktop and Claude Code. No tool starts a workflow or adds a label.
- **Evaluation harness** (`npm run evals`, `agents/evals/`): ten canned cases for the ticket writer, the analyst and
  the technical reviewer, with checks in code and recorded answers for a dry run.
- `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, `SECURITY.md`, `CONTRIBUTING.md`, this changelog and a pull request
  template.
- `npm run check` (types, lint, unit tests) and `npm run pipeline -- --help`.
- `.mcp.json`, so Claude Code in this checkout finds the MCP server without `claude mcp add`.

### Changed

- Every report (analysis, pull request, gates, review, triage, healing, run history, traceability map) opens with a
  title, a bold verdict and a line of numbers, uses the same heading levels and words, and folds long tables behind a
  one-line summary.
- The strategy's "Nearby behaviour at risk" starts from the technical review's list.
- A regression guard counts only when the test title is in the file, not only the file.
- The CLI exits 2 for a wrong command line, 1 for a failed stage or check.
- README rewritten for a first read; stale claims fixed.

## 2026-10-02

### Added

- Auto-run: a ready ticket from the ticket writer starts its own analysis, and a plan that passes starts the test
  half (`autoRun` in `qa.config.json`).
- Ticket writer: a sentence in, a complete requirement ticket out, with technical notes and a risk rating, checked
  against the repository and the open tickets. The analysis takes its tickets as filed, and says so on the ticket.
- Demo guide: ten minutes through real tickets, pull requests and runs, including the writer's before and after.
- Proposal for answering the pipeline's questions on the ticket and having it run again.
- Run history on the `qa-history` branch, as a table and a one-file dashboard.
- Self-healing: tests triage found to be at fault are repaired and offered as a pull request, behind "nothing
  weakened" gates.
- Accessibility gate: an axe scan of the pages the new tests end on, advisory by default, never reported as a pass.
- The gate report and the sensitivity table in the pull request description.
- Regression risks per plan, a traceability map on every Regression run, and the `doctor` preflight check.
- Requirements from Jira or GitHub, reports back on the ticket, and test-first mode with a contract for developers.
- The first tests written by the pipeline: product sorting (REQ-1), merged through pull request #2.

### Fixed

- A refused browser tool no longer counts as a broken browser.
- A shell command counts as run only if the allowlist let it run.
- Test-first tests fail the way `test.fail()` expects: with an action timeout, a missing element fails the action
  and names the locator instead of timing the test out.
- The engineer is sent back once when it reports without having run its tests; a failed Playwright gate shows the
  first error and the list of failures instead of progress lines; a generated sort test that failed one run in four
  is made steady.
- A regression risk counts as guarded only when its guard is a real spec file.

### Removed

- The Pantry demo shop, added with the run history: Swag Labs stays the one app under test.

## 2026-10-01

### Added

- The baseline Playwright suite (19 tests over login, cart and checkout) and the agent pipeline.
- The GitHub Actions workflows, README and licence.

### Fixed

- What the first pipeline run showed: the Claude token read from the `POC` environment, one-line step outputs, and
  browser agents told where page snapshots are saved.
