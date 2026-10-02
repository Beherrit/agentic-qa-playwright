# Changelog

What changed, newest first, reconstructed from the git history. There are no version numbers yet: the pipeline is
deployed from `main`, so each entry is dated by its commits.

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
