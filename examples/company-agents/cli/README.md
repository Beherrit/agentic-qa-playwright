# co: the command anyone in the company uses

One command, a dozen jobs. It is the same program whether a developer runs it at a terminal or CI runs it on an event,
and it does the same six things every time: gather what the role needs, screen the request, run the agent, validate
the answer, show the person what will be posted, post it as them.

```
co ticket new "Shoppers should be able to save a wishlist"
co ticket enrich SHOP-412
co mr describe 1234            co mr describe 1234 --apply
co mr review 1234
co design 1234                 where the code and the ticket's Figma design disagree
co cases SHOP-412              manual test cases for the criteria, into one TestRail section
co doc SHOP-412                co doc 1234 --dry
co doctor                      is this machine, this person and this config ready?
co ask "how do I run the regression suite against staging?"
co alert alert.json --channel "#incidents"
co post "#shop-team" "the wishlist release moves to Thursday"
co digest --days 7
co drift "checkout" --pages 123,456
co incident "#inc-2026-10-09" 1760000000.000100
```

## Setting up

```bash
npm install            # from the repository root: the CLI uses the repository's zod and Agent SDK
cp examples/company-agents/cli/co.config.example.json co.config.json
```

Fill in `co.config.json`: which tracker, code host, documentation tool and chat the company uses, the repository,
the hosts an agent may link to, the channels the bot may speak in, and the policy per role. Nothing secret goes in
it. See [lib/config.ts](lib/config.ts) for every field.

Then sign in with your own tokens. The values are read from your environment when they are set, and prompted for
when they are not, so they never appear in shell history as arguments:

```bash
npx tsx examples/company-agents/cli/co.ts login --login lawrence --token GITHUB_TOKEN --token JIRA_TOKEN --token JIRA_EMAIL --token JIRA_BASE_URL
```

They are stored in `~/.co/credentials.json` with mode 0600. On a machine with a keychain, swap the two functions in
[lib/identity.ts](lib/identity.ts) for keychain calls; the rest of the CLI does not care where tokens come from.

A shell alias makes it `co`:

```bash
alias co='npx tsx /path/to/repo/examples/company-agents/cli/co.ts'
```

The agent itself needs a Claude login or key: the signed-in Claude Code CLI, `CLAUDE_CODE_OAUTH_TOKEN`, or
`ANTHROPIC_API_KEY` in the environment. Bedrock and Vertex work the way they do for the engine.

On Windows the same commands work in PowerShell; `~/.co` is `%USERPROFILE%\.co`, and the 0600 mode is advisory
there (NTFS permissions on your profile folder do the job). The container in [../docker/](../docker/) is the same CLI
with nothing to install.

## Letting a role look things up: MCP

`roles.<role>.mcp` lists the servers the role may read through: `github`, `atlassian`, `testrail`, `figma`. The
`mcp` section says how each runs (GitHub as docker, binary or remote; Atlassian hosted; TestRail via npx; Figma desktop
or remote). Every server is read-only and every tool is allowlisted by name in [lib/mcp.ts](lib/mcp.ts). The tokens
are the same ones `co login` stores; `co doctor` tells you which are missing for the servers your roles use.

## Why it posts as you

Every write goes through an adapter with the token you gave it, so the comment on the ticket is from you, the draft
page is yours, the message in Slack is yours. The CLI can do nothing you could not do yourself, and the audit trail in
the tracker is the one that already exists. In CI the identity is the workflow and the token is the job's secret, and
the footer on every artefact names the agent and the run id so nobody mistakes it for a person.

## The three stages, for CI

```
co mr describe 1234 --stage fetch  --bundle bundle.json                      # holds the tracker token, no model key
co mr describe 1234 --stage agent  --bundle bundle.json --result result.json # holds the model key, no tracker token
co mr describe 1234 --stage post   --bundle bundle.json --result result.json --yes   # tracker token again
```

The bundle holds the task text, the facts the validator needs (the files in the diff, the refs the agent was given)
and what the post stage needs (the merge request id, the channel). The result holds the validated answer and the
cost. Nothing else crosses between jobs. See [../workflows/](../workflows/).

## What stops a run

In this order, and each one is a line in the audit log:

| Check | Where | What happens |
|---|---|---|
| Kill switch | `CO_AGENTS_ENABLED=false` or `enabled: false` in the config | Nothing runs |
| Role switch | `roles.<role>.enabled` | That role does not run |
| Identity | `roles.<role>.allowed` and `denied` | Refused with the reason |
| Rate | `roles.<role>.perActorPerHour`, from the audit log | Refused until the hour passes |
| Budget | `budget.maxUsdPerDay`, from the audit log | Refused until tomorrow |
| Fixed rules | [lib/screen.ts](lib/screen.ts) | Refused; the rule and the words are logged |
| Screener agent | [../agents/request-screener.md](../agents/request-screener.md) | Refused or a question back |
| Per-run budget | `roles.<role>.maxUsdPerRun` | The agent is stopped mid-run and the run fails |
| Schema | [../schemas/schemas.ts](../schemas/schemas.ts) | Failed; the shape error is logged |
| Validation | [lib/validate.ts](lib/validate.ts) | Failed; the problems are printed and logged, nothing posted |
| Confirmation | [lib/confirm.ts](lib/confirm.ts) | Cancelled |

## The audit log

One JSON line per run in `.co/audit.jsonl` (or the job log in CI with `"audit": "stdout"`): run id, time, actor, role,
trigger, a hash of the input, the screening verdict, the outcome, the target, the model, the cost, the problems. The
rate limit and the daily budget read it. Ship it wherever the company ships logs; nothing in the tooling deletes it.

## Adding a command

A command is one object in [co.ts](co.ts): the role, its schema, a `gather` that reads through adapters and returns
the task and the facts, a `validate` over the answer and the facts, a `preview`, and a `post` through an adapter. A
read-only role has no `post` and its answer is printed. Copy the nearest one.
