# Operations

How to run the pipeline day to day: what the labels do, what the switches are, and what to do when something stops.
For how the parts fit together, see [ARCHITECTURE.md](ARCHITECTURE.md). For first-time setup, see the README.

## Labels

The same names work on GitHub issues and Jira tickets. On GitHub only people with triage rights can add a label.

| Label | Who adds it | What it does |
|---|---|---|
| `qa-pipeline` | A person, or the ticket writer when `autoRun.analysisWhenWriterFiles` is on and the ticket is ready | Starts the analysis. The analysis removes it when it finishes, so adding it again starts a fresh one |
| `qa-needs-info` | The pipeline | The analysis stopped on a blocking question, or the ticket writer's draft was not ready. Answer on the ticket in a comment that starts with `/qa-answer` (see below), or add `qa-pipeline` again |
| `qa-analyzed` | The pipeline | The plan passed the pass mark. The ticket is ready for tests |
| `qa-generate` | A person, or the analysis when `autoRun.testsWhenPlanIsReady` is on | Starts the test half from the latest analysis of the ticket. Removed when the half finishes |
| `qa-test-first` | A person, or the ticket writer when the feature is not built | Tests are written before the feature, against a contract. The issue form answer "No, write the tests first" does the same |

The pipeline creates `qa-needs-info` and `qa-analyzed` the first time it needs them; create the other three once.

### Answering the pipeline's questions

When the analysis stops on a blocking question, its comment ends with how to answer. A comment on the ticket that
starts with `/qa-answer` on its own line, numbered like the questions, starts the analysis again by itself. The
analyst gets the questions as they were asked and the answers with their authors, and is told not to ask again what
has been answered.

Only a member of the project can answer. On GitHub that is an author GitHub reports as owner, member or
collaborator; the workflow checks it before starting, and the intake checks it again before reading a single
comment, so a visitor's `/qa-answer` is never read even when a member starts a run later. On Jira, anyone who can
comment on the ticket is in the project; an automation rule sends the same `qa-analyze` event the label rule sends
(the README has it). Azure DevOps and Linear tickets are re-run by the label.

Every comment on every issue starts the workflow on GitHub and is skipped at once unless all four conditions hold;
that is the cost of the trigger, and it is why skipped runs appear in the Actions tab.

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
| `jira.project` | unset | | The Jira project for new tickets and open-ticket lists |
| `app.previewUrl` | unset | tests run against `baseUrl` | Where a pull request's build answers, with `{number}` and `{branch}` filled in |
| `suite.commands` | `npx playwright test`, `npx tsc --noEmit`, `npx eslint` | those | The suite's own test, typecheck and lint commands. The gates run them and the engineer may run them; `test` has to be Playwright, since flags are added to it |
| `suite.specGlob`, `suite.testImport` | `tests/**/*.spec.ts`, `fixtures/test.ts` | those | Where the specs are and what they import `test` from |
| `personas.envVar` | `QA_PERSONA` (`SAUCE_USER` here) | `QA_PERSONA` | The variable the suite reads to choose the account. The pipeline passes `QA_PERSONA` and hands it over under this name |
| `personas.default`, `personas.list` | `standard_user`, six accounts | empty | For the documents and the doctor |
| `auth.setup`, `auth.storageState` | unset | tests sign in through the app | A command that saves a Playwright storage state, and the file it writes. Run once before the tests and before any agent gets a browser; the browser starts from that state |
| `sensitivity.targets[].initScript`, `.routes` | one fault target | | A fault instead of broken accounts: a script on every page, requests answered or dropped. See below |
| `budget.maxUsdPerRun` | 0 | no cap | The most a run may spend on agents. A run stops at the cap; each agent is given what is left |
| `gates.retryExistingOnce` | true | true | The full-suite gate gives an existing test that fails one retry by itself. Passing then is reported as flaky, not blocked. New tests never get a retry. Off, any failure blocks |

Repository variables and environment: `QA_AGENT_MODEL` picks the model for every role. `QA_PROVIDER_ENV` (a secret)
holds a model provider's settings as `KEY=value` lines, for Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`, `AWS_REGION`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) or Vertex (`CLAUDE_CODE_USE_VERTEX=1`, `CLOUD_ML_REGION`,
`ANTHROPIC_VERTEX_PROJECT_ID`, and credentials); the engine unpacks it for the SDK alone. Locally, `QA_RUN_DIR`
moves the run folder (default `qa-run/`), `QA_PROJECT_ROOT` names the project when the working directory is not in
it, `BASE_URL` overrides the app address and `QA_PERSONA` picks the persona.

The trackers read their settings from the `TRACKER` environment: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`;
`AZURE_DEVOPS_ORG_URL`, `AZURE_DEVOPS_PROJECT`, `AZURE_DEVOPS_PAT`; `LINEAR_API_KEY`, `LINEAR_TEAM`. GitHub issues
and pull requests use the workflow's own token.

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
| `qa-run` | every pipeline job | The run folder: `request.json`, `requirements.*`, `technical.*`, `strategy.*`, `generation.json`, `gates.*`, `review*`, `changes.patch`, `ledger.json` (each agent's turns, time and cost) |
| `gates-playwright-output` | QA tests, 1b and 1d, when the gates fail | Playwright's report and `test-results/` (traces, screenshots), kept 14 days |
| `qa-plan`, `qa-critic` | 2a and 2b | The architect's plan and the critic's checklist, before they are reconciled |
| `qa-analysis-<key>` | QA analysis, 3 | The finished analysis, which the test half picks up |
| `generate-playwright-output` | QA tests, 1, on failure | Playwright's report and `test-results/` (traces, screenshots), kept 14 days |
| `playwright-report`, `test-results` | Regression | The suite's report and failure evidence |
| `triage`, `heal` | Regression | The triage verdicts and bug reports; the repair patch and its gate report |

| What the log says | What to do |
|---|---|
| `No Claude credentials` | Add `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` to the `POC` environment, or `QA_PROVIDER_ENV` for Bedrock or Vertex |
| `The run's budget of $N is spent` | The run reached `budget.maxUsdPerRun`. Raise it, or split the ticket |
| `The sign-in command failed` | `auth.setup` could not save the storage state. Run it by hand and read its output |
| `No qa.config.json in ...` | Run `npx agentic-qa init` in the project, or set `QA_PROJECT_ROOT` |
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
  `QA_RUN_DIR=./qa-run-123 npx agentic-qa technical`. Stages that run an agent need a signed-in Claude Code CLI or
  a token.

## Turning a gate from advisory to blocking

Sensitivity and accessibility are the two advisory gates. Set `sensitivity.required` or `accessibility.required` to
`true` in `qa.config.json`. A failing advisory gate is still shown in the gate report and the pull request; once it
is required it also sends the change back to the engineer, and then stops the run. Every other gate always blocks.

## Adding a sensitivity target

A target is a version of the app known to be broken. Two kinds:

**Environment variables** that point the suite at something wrong: an old build, a broken account. The suite has to
read the variable, so pick one it already reads (`BASE_URL` in `playwright.config.ts`, the persona variable) or add
the reading there.

```json
{ "name": "last-release", "env": { "BASE_URL": "https://staging-previous.example.com" } }
```

**A fault**, when there is no broken build to point at: a script run on every page before the app's own, and
requests answered or dropped before they reach the server. This works on any app. The gate hands it to the suite as
`QA_FAULT` and the shared fixture (`fixtures/fault.ts`, which `init` writes and `fixtures/test.ts` calls on every
page) applies it. The demo's fault removes the cart badge whenever it appears.

```json
{ "name": "cart-badge-never-shows", "initScript": "fixtures/faults/cart-badge-never-shows.js" },
{ "name": "cart-api-down", "routes": [{ "url": "**/api/cart", "status": 500, "body": "{}" }] },
{ "name": "no-analytics", "routes": [{ "url": "**/analytics/**", "abort": true }] }
```

Then check that the suite really fails against it: `BASE_URL=... npx agentic-qa suite`, or for a fault
`QA_FAULT='{"initScript":"fixtures/faults/x.js","routes":[]}' npx agentic-qa suite`. A target nothing fails against
tells you nothing about the new tests. `npx agentic-qa doctor` lists the targets.

The gate runs the new tests once per target, in built mode only, and reports which tests each target caught.

## Flaky tests

The full-suite gate names existing tests that failed once and passed on their retry; triage names the tests it
judged flaky in a regression run. Both go into the run history (`flaky` on each entry), and `npx agentic-qa
coverage` reads it back: the traceability map ends with "Flaky lately", the tests that were flaky in the newest
runs and how often. A test there needs a look before it blocks someone. The history page shows the same five
flakiest tests in its totals.

## Exporting results

`npx agentic-qa coverage --export junit|xray|testrail` writes the last run's results to `qa-run/` in the shape the
tool imports, with the requirement and criteria tags on every test: JUnit properties, Xray's `testInfo` with the
requirement as a Jira issue when the tag is a Jira key, a TestRail CSV with the tags as references.

## Cost

Each agent run's turns, time and estimated cost are recorded per run in the history: in `ledger.json` in the run's
artifact, in the "Agent runs" table of every pull request, and in the totals on the `qa-history` branch (average cost
per run, total cost, average agent time). Read the numbers there rather than estimating them; they vary with the
size of the ticket.

What moves them: the model per role (`models`), how often a run goes back for a second pass (the gate report and the
review say why), and whether the halves start by themselves (`autoRun`). A ticket stopped by a blocking question
costs one analyst run.

## From Claude, or from a terminal

The same flows run without Actions. `npx agentic-qa --help` lists the commands; `npx agentic-qa mcp` serves them to
Claude Desktop or Claude Code (see the README, "Use it from Claude"). Local runs of the agent stages use the plan or
API key of whoever runs them.

## In another CI system

The four workflows are GitHub Actions, but every stage is a command. One job that checks the project out, installs
it and runs `npx agentic-qa analyze --source <tracker> --ref <ticket>` is the analysis half; `npx agentic-qa tests`
after it is the test half, which leaves the change in the working tree and the pull request text in
`qa-run/pull-request.md` for the job to push and open. Give the model credential to those two steps and the tracker
credentials to none of the agent steps, as the GitHub workflows do.
