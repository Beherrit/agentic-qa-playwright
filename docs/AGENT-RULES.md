# Agent rules

How the pipeline's agents are organised, what each one may do, and what each one owes the person reading the run.
The same rules apply when Claude works on this repository (CLAUDE.md); there the main session is the lead and the
agents in `.claude/agents/` are the tiers.

## The lead and its agents

The **lead** is the pipeline itself: the deterministic code in `agents/flow.ts` and `agents/stages.ts` that runs the
stages in order. It is not a model. It dispatches every agent, hands each one only what its contract names, checks
every answer before the next stage sees it, and owns every decision that reaches a ticket or a pull request.

An **agent** is one model call with one role. It does one job and hands in one answer.

What that means in practice:

| The lead | Every agent |
|---|---|
| holds the tracker token, in a job no agent runs in | never sees a token or a credential |
| writes to the ticket, labels it, opens the pull request | writes to nothing outside the folders `writable` names, and most write nothing |
| decides what runs next, from answers it has checked | never starts another agent, and never asks a question |
| checks every answer: its shape, every file and test it names, the gates | is distrusted until checked: a name it gives that is not on disk is removed |
| writes the run report | writes its own handoff |

## Tiers

Every role runs on the tier its job needs. The tier picks the model; a person can still override it (below).

| Tier | Default model | Fallback | For | Roles |
|---|---|---|---|---|
| decide | Fable (`claude-fable-5-1`) | Opus | settles something: the final plan, whether tests ship, bug or test defect | `plan-reconciler`, `code-reviewer`, `failure-triager` |
| build | Opus (`claude-opus-5-5`) | Sonnet | does the work: plans, test code, faults, repairs | `test-architect`, `plan-critic`, `automation-engineer`, `saboteur`, `test-healer`, `test-migrator`, `settings-migrator`, `ticket-writer` |
| research | Sonnet (`claude-sonnet-5-5`) | Opus | reads and reports: requirements, code, suites, measurements | `request-screener`, `requirements-analyst`, `skeptic`, `technical-reviewer`, `suite-surveyor`, `performance-analyst` |
| read | Haiku (`claude-haiku-5-5`) | Sonnet | bulk reading where a cheap pass is enough | none by default; for a project's own roles |

Why it is split this way:

- **Decide** is few turns and a lot of judgement per token: the reconciler weighs two plans written blind to each
  other, the reviewer decides whether a test can tell a working feature from a broken one, and the triager decides
  whose fault a red build is. A wrong call here costs a person the most time, so it gets the strongest model.
- **Build** is long, tool-heavy work: walking the app, writing and running code, breaking the app on purpose. It
  needs a strong model that stays on task for eighty turns.
- **Research** reads widely and reports what is there. Every name it gives is checked on disk afterwards, so it
  needs care more than depth.
- **Read** is for passes where the cheapest model is good enough.

The fallback runs when the tier's model is overloaded or not available to the account. The run does not stop, and
the run report says which agent fell back.

### Choosing other models

Most specific first:

1. `models: { "<role>": "<model>" }` in `qa.config.json`: one role.
2. `models: { "*": "<model>" }`: every role. A proof of concept puts `haiku` here.
3. The repository variable `QA_AGENT_MODEL`: every role.
4. `tiers: { "<tier>": { "model": "...", "fallback": "..." } }` in `qa.config.json`: one tier.
5. The defaults above.

The first three skip the tiers altogether, fallback included: an overridden role runs on that model alone. The run
report says so on every agent it touched. `npx agentic-qa
doctor` lists what each tier resolves to.

## The persona card

Every prompt in `agents/prompts/` opens with a card, in this order. `agents/test/rules.test.ts` fails for a prompt
without one, or with a tier that disagrees with `agents/lib/tiers.ts`.

| Field | What it says |
|---|---|
| Tier | decide, build, research or read |
| Mission | the job, in one sentence |
| Inputs | what the lead hands it, and nothing else |
| Allowed tools | what the code allows: read tools, which folders it may edit, which commands, which browser level |
| Must never | the mistakes that would make its answer worthless or unsafe |
| Output contract | the schema it answers in, and what is in it |
| Done when | how the agent knows it has finished |
| Escalate when | what it must raise for a person: in its answer's own field where there is one, and in its handoff |

The card describes what the code enforces; it does not replace it. A tool that is not on a role's allowlist in
`agents/lib/agent.ts` is refused whatever the card says.

## The handoff

Every agent hands in a `handoff` next to its answer. `runAgent` adds it to the role's schema and takes it off
before the stage sees the answer, so no role's own contract changes.

| Field | |
|---|---|
| `summary` | what it was asked, what it did, what it handed in |
| `decisions` | the calls it made that a reviewer might question, each with its reason |
| `escalations` | what a person must check before trusting the answer |
| `confidence`, `confidenceReason` | high, medium or low, and why |

Nobody is there to answer a question, so an agent escalates in writing. Where its answer has a field for the concern
(a blocking open question, a suspected bug, a case not automated), it goes there first, because that is what the
pipeline acts on; the handoff's escalations name it again for the person reading the run. The handoff is optional
in the schema, so a missing one is noted in the report and never stops the run.

## The run report

The lead writes a report at the end of every analysis and every test run, from the ledger every agent call writes
to (failed calls included):

- **The lead's card:** the verdict, what the pipeline decided on its own (the plan's score, answers it corrected,
  gates, rework rounds), everything any agent escalated, and the time, tokens and cost per tier.
- **One card per agent:** tier and model (and whether it fell back or was overridden), turns, time, tokens, cost,
  outcome, and its handoff.

It goes in `qa-run/run-report.md` and the job summary, and is folded into the comment on the ticket and into the
pull request. On Jira, or when every card together would make the comment too long, only the lead's card is folded
in and the rest stays in `run-report.md`.

## Guardrails

The rules above are enforced in code, not left to the prompts:

| Guardrail | Where |
|---|---|
| Each role's tools are an allowlist; anything else is refused outright, never prompted for | `agents/lib/agent.ts` |
| Writes only inside `writable`; shell only for the suite's test, typecheck and lint commands | `agents/lib/agent.ts` |
| No user settings, hooks or MCP servers leak into an agent | `settingSources: []`, `strictMcpConfig` |
| Every requirement and the context around it is screened before any agent reads it | `agents/screen.ts`, `agents/lib/safety.ts` |
| Only collaborators' linked issues are read as context | `agents/sources/github.ts` |
| Every answer is checked against its schema, and every file and test it names against the disk | `agents/stages.ts` |
| A budget per run stops the next agent once it is spent | `budget.maxUsdPerRun` |
| Tracker tokens and model tokens live in different jobs | `TRACKER` and `POC` environments in the workflows |
| Nothing from another company's project, by name, in any file | `agents/lib/clean-room.ts`, its test and the `.claude/` hook |

## Adding a role

1. Write its prompt in `agents/prompts/<role>.md`, card first.
2. Give it a tier in `ROLE_TIERS` (`agents/lib/tiers.ts`) and a row above.
3. Give it the least access that does the job in its `runAgent` call: `read` unless it must write, no browser
   unless it must look.
4. Answer in a `z.object` schema, so it gets the handoff.
5. Run `npm run -s test:unit`; the rules test says what is missing.
