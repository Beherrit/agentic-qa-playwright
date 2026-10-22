# Agent contracts

Generated from `agents/lib/policy.ts`, `agents/lib/tiers.ts` and the answer schemas by
`node agents/lib/contracts.ts --write`. Do not edit by hand: the rules test fails when this page and the code
differ. docs/AGENT-RULES.md explains the tiers, the handoff and the guardrails.

Every answer also carries a `handoff` (summary, decisions, escalations, confidence), which the lead takes off
before the next stage reads the answer. "May" is the most a stage can grant the role; `runAgent` refuses a call
that asks for more.

## request-screener

| | |
|---|---|
| Tier | research |
| May | reads the repository; no browser; at most 6 turns |
| Is handed | request.json, context.json |
| Answers in | `Screening`, plus the handoff |
| Feeds | screening.json: the lead stops the run, asks on the ticket, or goes on |

- `verdict`
- `category`
- `reasons` (list): Short and specific, quoting the words that decided it
- `question`: For ask: the one question that settles it. Otherwise null

## skeptic

| | |
|---|---|
| Tier | research |
| May | reads the repository; no browser; at most 8 turns |
| Is handed | request.json, the product brief, the team's answers |
| Answers in | `Skepticism`, plus the handoff |
| Feeds | skeptic.json: requirements-analyst |

- `questions` (list)

## requirements-analyst

| | |
|---|---|
| Tier | research |
| May | reads the repository; no browser; at most 20 turns |
| Is handed | request.json, skeptic.json, context.json, the team's answers, the product brief |
| Answers in | `Requirements`, plus the handoff |
| Feeds | requirements.json: technical-reviewer, test-architect, plan-critic, the ticket |

- `title`
- `story` (object)
- `criteria` (list)
- `assumptions` (list)
- `outOfScope` (list)
- `openQuestions` (list)
- `risk`
- `riskReason`

## technical-reviewer

| | |
|---|---|
| Tier | research |
| May | reads the repository; browser at the look level; at most 40 turns |
| Is handed | requirements.json, open-tickets.json, the product brief |
| Answers in | `TechnicalReview`, plus the handoff |
| Feeds | technical.json: test-architect, automation-engineer, the ticket |

- `covered` (list): Existing tests that already prove part of the wish
- `pages` (list): Page objects and the locators or methods the tests will use
- `touches` (list): Nearby behaviour the change could break, and whether the suite would notice
- `related` (list): Open tickets or bugs that bear on this wish
- `notes`: Anything else the engineer needs: routes, test ids, behaviour seen in the browser
- `risk`
- `riskReason`: What breaks for the user if this is wrong, and how likely it is

## test-architect

| | |
|---|---|
| Tier | build |
| May | reads the repository; browser at the look level; reads other checkouts; at most 60 turns |
| Is handed | requirements.json, technical.json, context.json, the layers, docs/test-design.md |
| Answers in | `Plan`, plus the handoff |
| Feeds | plan.json: plan-reconciler |

- `existingCoverage` (list): Tests that already prove part of the requirement, at any layer
- `siteNotes`: What you saw in the browser that the engineer will need: controls, labels, behaviour
- `contract` (list): Test-first only: what the developers have to build for the tests to find. Empty when the feature exists.
- `regressionRisks` (list): Nearby behaviour the feature could break, and whether the suite would notice
- `cases` (list)

## plan-critic

| | |
|---|---|
| Tier | build |
| May | reads the repository; no browser; at most 15 turns |
| Is handed | requirements.json, the product brief, docs/test-design.md |
| Answers in | `Checklist`, plus the handoff |
| Feeds | checklist.json: plan-reconciler |

- `items` (list)

## plan-reconciler

| | |
|---|---|
| Tier | decide |
| May | reads the repository; no browser; at most 10 turns |
| Is handed | plan.json, checklist.json, requirements.json, the layers |
| Answers in | `Reconciled`, plus the handoff |
| Feeds | strategy.json: automation-engineer, the per-layer tasks, the ticket |

- `cases` (list): The final list: the original cases plus any added to close gaps
- `added` (list): Ids of cases added in this pass
- `checklist` (list)
- `summary`

## automation-engineer

| | |
|---|---|
| Tier | build |
| May | reads the repository, edits inside `writable`, runs the suite commands; browser at the test level; at most 80 turns |
| Is handed | strategy.json, technical.json, the test conventions, gates.md in a fix round |
| Answers in | `Generation`, plus the handoff |
| Feeds | generation.json and the test files: the gates, saboteur, code-reviewer |

- `summary`
- `files` (list): Repo-relative paths you created or changed
- `automated` (list)
- `notAutomated` (list)
- `suspectedBugs` (list): Places where the app does not do what the criteria say

## saboteur

| | |
|---|---|
| Tier | build |
| May | reads the repository; browser at the break level; at most 40 turns |
| Is handed | requirements.json, the site notes, the diff of the new tests |
| Answers in | `Sabotage`, plus the handoff |
| Feeds | sabotage.json: the sabotage gate |

- `faults` (list)

## code-reviewer

| | |
|---|---|
| Tier | decide |
| May | reads the repository; no browser; at most 30 turns |
| Is handed | the diff, strategy.json, gates.md, the test conventions |
| Answers in | `Review`, plus the handoff |
| Feeds | review.json: the lead opens the pull request ready or as a draft, or sends the tests back |

- `verdict`
- `summary`
- `findings` (list)
- `criteria` (list)

## failure-triager

| | |
|---|---|
| Tier | decide |
| May | reads the repository; no browser; at most 50 turns |
| Is handed | the failed tests, test-results/ |
| Answers in | `Triage`, plus the handoff |
| Feeds | triage.json: test-healer, the bug reports |

- `summary`
- `failures` (list)
- `bugs` (list)

## test-healer

| | |
|---|---|
| Tier | build |
| May | reads the repository, edits inside `writable`, runs the suite commands; browser at the test level; at most 60 turns |
| Is handed | triage.json, test-results/, the test conventions |
| Answers in | `Healing`, plus the handoff |
| Feeds | heal.json and the repaired tests: the heal gates, the repair pull request |

- `summary`
- `fixes` (list)
- `notFixed` (list)

## ticket-writer

| | |
|---|---|
| Tier | build |
| May | reads the repository; browser at the look level; at most 40 turns |
| Is handed | the wish, open-tickets.json, the product brief |
| Answers in | `TicketDraft`, plus the handoff |
| Feeds | draft.json: a person reads it before it is filed |

- `title`: Short, with no "Requirement:" prefix
- `story` (object)
- `why`: What goes wrong for the user or the business if it breaks
- `built`: True if the feature is already in the app today
- `alreadyThere`: What exists today that relates to the wish, seen in the app or in the existing tests
- `criteria` (list)
- `assumptions` (list)
- `outOfScope` (list)
- `risk`
- `riskReason`
- `technical` (object): What an engineer needs to know about the code and tests, checked against the repository
- `duplicates` (list): Open tickets that ask for the same thing
- `questions` (list)

## suite-surveyor

| | |
|---|---|
| Tier | research |
| May | reads the repository; no browser; at most 40 turns |
| Is handed | the project: package.json, the Playwright config, the test folders |
| Answers in | `Survey`, plus the handoff |
| Feeds | survey.json: the proposed qa.config.json, brief and conventions, for a person to review |

- `app` (object)
- `layout` (object)
- `commands` (object)
- `personas` (object)
- `auth` (object)
- `brief`: The product brief as markdown, starting with a level-1 heading
- `conventions`: The test conventions as markdown, starting with a level-1 heading
- `gaps` (list): What a person must fill in or check

## performance-analyst

| | |
|---|---|
| Tier | research |
| May | reads the repository; no browser; at most 25 turns |
| Is handed | the failing pages, the Lighthouse reports, the commits since the last run |
| Answers in | `PerfAnalysis`, plus the handoff |
| Feeds | the performance report |

- `findings` (list)
- `unattributed` (list)

## settings-migrator

| | |
|---|---|
| Tier | build |
| May | reads the repository; no browser; at most 25 turns |
| Is handed | the old project's configuration |
| Answers in | `Settings`, plus the handoff |
| Feeds | the new Playwright config, written by code |

- `appName`: What the old project calls the app it tests (its README, a config key, the repository name). Empty when it never says
- `baseUrl`: Where the app answers for tests. Empty when the old project reads it from the environment and gives no default
- `browsers` (list)
- `headless`
- `timeoutMs`: Per-test timeout. From the old suite's longest explicit wait or its runner timeout
- `expectTimeoutMs`: How long an assertion waits. The old explicit wait, usually
- `retries`: Reruns of a failed test in CI. The old rerun or retry setting, or 0
- `workers`: Parallel workers: the old thread count, xdist -n or Grid max instances, or null for the default
- `grid` (object)
- `viewport` (object)
- `testIdAttribute`: The attribute the old locators use for test ids (data-test, data-testid), or null
- `envVars` (list)
- `personas` (object)
- `auth` (object)
- `evidence` (list)
- `unmapped` (list)

## test-migrator

| | |
|---|---|
| Tier | build |
| May | reads the repository, edits inside `writable`, runs the suite commands; browser at the test level; at most 80 turns |
| Is handed | the wave's old files, the test conventions |
| Answers in | `Conversion`, plus the handoff |
| Feeds | the new specs and the mapping: the migration gates |

- `summary`: Two or three sentences: what was converted and what a reviewer should look at
- `files` (list)
- `tests` (list)
- `dropped` (list)
- `gaps` (list): What a person must check or decide
