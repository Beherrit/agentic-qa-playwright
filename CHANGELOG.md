# Changelog

What changed, newest first, reconstructed from the git history. There are no version numbers yet: the pipeline is
deployed from `main`, so each entry is dated by its commits.

## Unreleased

### Fixed

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
  and the analyst's questions in up to `intake.maxRounds` rounds, writes the ticket with the answers under "Questions
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
