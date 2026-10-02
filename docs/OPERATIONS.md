# Operations

How to run the pipeline day to day: what the labels do, what the switches are, and what to do when something stops.
For how the parts fit together, see [ARCHITECTURE.md](ARCHITECTURE.md). For first-time setup, see the README.

## Labels

The same names work on GitHub issues and Jira tickets. On GitHub only people with triage rights can add a label.

| Label | Who adds it | What it does |
|---|---|---|
| `qa-pipeline` | A person, or the ticket writer when `autoRun.analysisWhenWriterFiles` is on and the ticket is ready | Starts the analysis. The analysis removes it when it finishes, so adding it again starts a fresh one |
| `qa-needs-info` | The pipeline | The analysis stopped on a blocking question, or the ticket writer's draft was not ready. Answer on the ticket, then add `qa-pipeline` again |
| `qa-analyzed` | The pipeline | The plan passed the pass mark. The ticket is ready for tests |
| `qa-generate` | A person, or the analysis when `autoRun.testsWhenPlanIsReady` is on | Starts the test half from the latest analysis of the ticket. Removed when the half finishes |
| `qa-test-first` | A person, or the ticket writer when the feature is not built | Tests are written before the feature, against a contract. The issue form answer "No, write the tests first" does the same |

The pipeline creates `qa-needs-info` and `qa-analyzed` the first time it needs them; create the other three once.

## Switches

Everything specific to the app is in `qa.config.json`. `npm run doctor` checks it.

| Setting | This repository | When it is missing | What it does |
|---|---|---|---|
| `app.name`, `app.baseUrl`, `app.brief` | Swag Labs | doctor fails | The app under test and the product brief the agents read |
| `conventions` | `docs/test-conventions.md` | doctor fails | The rules the engineer writes to and the reviewer checks against |
| `writable` | `tests/`, `pages/`, `fixtures/` | doctor fails | The only folders generated code may touch |
| `minPlanScore` | 70 | doctor fails | A plan below it does not go on to the test half |
| `stabilityRuns` | 3 | doctor fails | How many times in a row new tests (and repairs) must give the same result |
| `sensitivity.targets` | `problem_user`, `error_user` | gate skipped | Known-broken versions of the app, each a set of environment variables |
| `sensitivity.required` | false | advisory | Whether the sensitivity gate blocks |
| `accessibility.enabled` | true | gate off | Scan the pages the new tests end on with axe |
| `accessibility.required` | false | advisory | Whether the accessibility gate blocks |
| `autoRun.analysisWhenWriterFiles` | true | off | A ready ticket from the ticket writer starts its own analysis |
| `autoRun.testsWhenPlanIsReady` | true | off | A plan that passes starts the test half without a person adding `qa-generate` |
| `models` | `{}` | `QA_AGENT_MODEL`, then `sonnet` | A model per role, for example `{ "plan-critic": "haiku" }` |
| `jira.fields` | `{}` | description only | Jira custom fields to read with the description, by display name |

Repository variables and environment: `QA_AGENT_MODEL` picks the model for every role. Locally, `QA_RUN_DIR` moves
the run folder (default `qa-run/`), `BASE_URL` overrides the app address and `SAUCE_USER` picks the persona.

## When a stage fails

Every run says so on the ticket, whatever state it ended in, with a link to the run. From there:

1. **The job log.** Open the red job. Each agent's work is printed as it happens: `=== role ===`, then one line per
   tool call (`> Read tests/cart.spec.ts`), `!` for a tool that failed or was refused, and `=== role done ===` with
   turns and time. The last line of a failed job is the reason, written for a person.
2. **The job summary.** The run's summary page has the markdown each stage produced: requirements, technical review,
   strategy, gate report, review.
3. **The artifacts.** At the bottom of the run page.

| Artifact | From | Holds |
|---|---|---|
| `qa-run` | every pipeline job | The run folder: `request.json`, `requirements.*`, `technical.*`, `strategy.*`, `gates.*`, `review*`, `changes.patch`, `ledger.json` (each agent's turns, time and cost) |
| `qa-plan`, `qa-critic` | 2a and 2b | The architect's plan and the critic's checklist, before they are reconciled |
| `qa-analysis-<key>` | QA analysis, 3 | The finished analysis, which the test half picks up |
| `generate-playwright-output` | QA tests, 1, on failure | Playwright's report and `test-results/` (traces, screenshots), kept 14 days |
| `playwright-report`, `test-results` | Regression | The suite's report and failure evidence |
| `triage`, `heal` | Regression | The triage verdicts and bug reports; the repair patch and its gate report |

| What the log says | What to do |
|---|---|
| `No Claude credentials` | Add `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` to the `POC` environment |
| `<role> answered in the wrong shape` | The answer did not match its schema. Re-run the job; if it repeats, the prompt or the schema needs a look |
| `<role> could not use the browser` | Every browser call failed. Check the app is up (`npm run doctor`) and re-run |
| `<role> did not finish (error_max_turns)` | The agent ran out of turns. Re-run; if it repeats, the ticket is probably too big for one pass |
| `The plan scored N, below the pass mark` | Read the score breakdown on the ticket, sharpen the requirement, add `qa-pipeline` again |
| `This ticket has no analysis yet` | Add `qa-pipeline` first; `qa-generate` works from the latest analysis |
| `The generated tests did not pass the quality gates` | The gate report is on the ticket and in `gates.md`. A flaky app or a real bug found by the tests are the usual causes |

## Re-running

- **One failed job:** "Re-run failed jobs" on the run page. Each job downloads the `qa-run` its predecessor
  uploaded, so it starts where the run stopped.
- **The whole analysis:** add `qa-pipeline` to the ticket again, or Actions > QA analysis > Run workflow with the
  source and the issue number or ticket key. A new run for the same ticket cancels one in progress.
- **The test half:** add `qa-generate` again, or run QA tests by hand. It reads the ticket again, so a change from
  built to test-first is picked up; it says so when the plan needs a new analysis.
- **Locally, from a run's files:** download its `qa-run` artifact, point `QA_RUN_DIR` at it, and run a single stage:
  `QA_RUN_DIR=./qa-run-123 npm run pipeline -- technical`. Stages that run an agent need a signed-in Claude Code CLI or
  a token.

## Turning a gate from advisory to blocking

Sensitivity and accessibility are the two advisory gates. Set `sensitivity.required` or `accessibility.required` to
`true` in `qa.config.json`. A failing advisory gate is still shown in the gate report and the pull request; once it
is required it also sends the change back to the engineer, and then stops the run. Every other gate always blocks.

## Adding a sensitivity target

A target is a set of environment variables that points the suite at something known to be wrong. The suite has to
read the variable, so pick one it already reads (`BASE_URL` in `playwright.config.ts`, `SAUCE_USER` in
`fixtures/personas.ts`) or add the reading there.

1. Add it to `qa.config.json`:
   ```json
   { "name": "last-release", "env": { "BASE_URL": "https://staging-previous.example.com" } }
   ```
2. Check that the suite really fails against it: `BASE_URL=https://staging-previous.example.com npx playwright test`.
   A target nothing fails against tells you nothing about the new tests.
3. Run `npm run doctor`; the target is listed under "Sensitivity targets".

The gate runs the new tests once per target, in built mode only, and reports which tests each target caught.

## Cost

Each agent run's turns, time and estimated cost are recorded per run in the history: in `ledger.json` in the run's
artifact, in the "Agent runs" table of every pull request, and in the totals on the `qa-history` branch (average cost
per run, total cost, average agent time). Read the numbers there rather than estimating them; they vary with the
size of the ticket.

What moves them: the model per role (`models`), how often a run goes back for a second pass (the gate report and the
review say why), and whether the halves start by themselves (`autoRun`). A ticket stopped by a blocking question
costs one analyst run.

## From Claude, or from a terminal

The same flows run without Actions. `npm run pipeline -- --help` lists the commands; `npm run mcp` serves them to
Claude Desktop or Claude Code (see the README, "Use it from Claude"). Local runs of the agent stages use the plan or
API key of whoever runs them.
