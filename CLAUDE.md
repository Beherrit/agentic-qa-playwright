# Working on agentic-qa-playwright

An agentic QA pipeline: a ticket in, a QA analysis and reviewed Playwright tests out, with a person merging. The
engine is in `agents/`, the example suite it tests against (Swag Labs) is in `tests/`, `pages/` and `fixtures/`.
README.md explains it; docs/ARCHITECTURE.md explains how it is built.

These rules are for Claude working on the repository. The pipeline's own agents follow the same ones, written up
in docs/AGENT-RULES.md. Read that before changing anything in `agents/lib/agent.ts`, `agents/prompts/` or
`agents/lib/tiers.ts`.

## 1. Clean room

Everything in this repository is original work. No code, prompts, wording, structure or names from another
company's project, a former employer's included. A hook in `.claude/hooks/` refuses an edit that names one, and
`agents/test/rules.test.ts` checks every tracked file. If an idea came from somewhere else, write it from scratch in
this project's own terms, or leave it out. The hook runs on Node 22.18 or later (it is TypeScript run directly); on an
older Node it cannot run, so the test is the backstop.

## 2. The lead and the tiers

The main session is the **lead**. It talks to the user, decides, and owns the result. It hands work to the agents
in `.claude/agents/` by tier, the same tiers the pipeline uses:

| Tier | Agent | Hand it |
|---|---|---|
| decide | the lead itself, and `reviewer` (Fable) before anything merges | choices between approaches, scope, go or no-go; the reviewer gets the diff and the goal, never your reasoning |
| build | `builder` (Opus) | one scoped change the lead has already decided on |
| research | `researcher` (Sonnet) | where something lives, how it works today, what the docs say |
| read | `bulk-reader` (Haiku) | CI logs, run folders, long reports: anything too big to paste |

Do a lookup yourself when it is a few tool calls. Delegate when the work is independent, wide, or would fill the
lead's context with file dumps.

## 3. Contracts between the lead and its agents

A brief says: the goal, the files to start from, what is out of scope or already ruled out, and what done looks
like. Every agent ends with a handoff: a summary, the calls it made, what it escalates, and its confidence. The
lead treats a handoff as a claim to check, not a fact.

## 4. Big items

A change that touches more than a few files, adds a stage, a role or a config section, or changes what an agent may
do, is a big item:

1. Plan it first, as a task list the user can see.
2. Build in steps that each pass the checks.
3. Have `reviewer` read the whole diff before it is pushed.
4. Finish with a run report: the lead's card (what was decided, what changed, what the checks said, what is
   escalated to the user) and one card per agent that worked on it, in the shape of the handoff.

## 5. Checks

Before every commit:

```
node node_modules/typescript/bin/tsc --noEmit
npm run -s test:unit
npm run -s lint
```

`npm run -s check` runs all three. The Playwright suite (`npm test`) needs the app online and runs in CI.

## 6. Never weaken a guardrail

The tool allowlists and `dontAsk` in `agents/lib/agent.ts`, the screen in `agents/screen.ts` and
`agents/lib/safety.ts`, the gates, the budget, and the split between the `TRACKER` and `POC` environments in the
workflows are how this pipeline stays safe on untrusted tickets. A change to any of them is a big item and says so in
the pull request.

## 7. Agents and prompts

A new role gets a prompt that opens with its card, a tier in `ROLE_TIERS`, a row in docs/AGENT-RULES.md, the least
access that does the job, and a `z.object` answer schema. The rules test lists what is missing.

## 8. Voice

Docs, prompts, comments, commits and pull requests are written in plain, direct English, the way an experienced
tester writes to a colleague. Short sentences, no marketing words, say what is not done as plainly as what is.
Commit subjects are a plain sentence saying what changed; the body says why.
