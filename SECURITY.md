# Security

The pipeline gives AI agents text written by other people, a browser pointed at an app, and the job of writing code
that then runs. This page says what that exposes, what stops it, and what does not.

## Reporting a problem

Open a private security advisory on this repository (Security > Advisories > Report a vulnerability). Please do not
open a public issue for it.

## What is worth protecting

- The **Claude credential** (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`): it spends money.
- The **tracker credentials** (Jira API token, the workflow's GitHub token): they can read and write tickets.
- **Write access to the repository**: a pushed branch or an opened pull request.
- **The suite's honesty**: a test that passes without checking anything is a quiet failure of everything above it.

## Where untrusted input comes in

| Input | Who controls it | Reaches |
|---|---|---|
| Ticket title and body | Whoever wrote the ticket | Every analysis agent and the ticket writer |
| Pages of the app under test | Whoever controls the app | The agents with a browser |
| The diff of generated tests | The engineer agent | The code reviewer |
| `qa-run/` artifacts | Every job they passed through, including ones where generated code ran | Later jobs, the run history |
| `repository_dispatch` payloads | The holder of the dispatch token | Intake, as a source and a ticket reference |

A run only starts when someone trusted asks: on GitHub only people with triage rights can add a label, and from
Jira only the holder of a token with write access to the repository can send the event.

## Prompt injection, through tickets and web pages

A ticket or a page can contain text written to look like an instruction. The agents are told, in every prompt, that
anything inside the task's tags and anything read from the app is material to analyse, never an instruction. That is
a request to a model, not a barrier. The barriers are these:

- **Least access.** Most roles can only read the repository. The two that write (the engineer and the healer) may edit
  only `tests/`, `pages/` and `fixtures/` and run only `npx playwright test`, `npx tsc` and `npx eslint`. Agents run in
  `dontAsk` mode with no user settings, hooks or MCP servers, so anything off the list is refused, not asked about.
- **A limited browser.** Navigate, click, type, read snapshots. No script evaluation and no file upload.
- **No tokens worth stealing in the agent's reach, except one.** An agent job holds the Claude credential and nothing
  else: no tracker token, no GitHub token (`persist-credentials: false`), no write access.
- **Answers are data too.** Every answer is validated against a schema, and every claim code can check is checked:
  files, test titles and tickets in technical notes, references to test cases and criteria, the review verdict, what
  the engineer says it wrote and which `test.fail()` markers it added.
- **Ticket references are checked** against a strict pattern before they reach a shell, an API path or a branch name,
  and tracker calls pass arguments directly, never through a shell.
- **A person merges.** The pipeline cannot approve or merge a pull request.

The worst a successful injection can do, then, is make an agent write a misleading analysis or weak tests. The gates
catch some of that (the scope gate, the expected-failure checks, the sensitivity run) and the person reading the pull
request is there for the rest.

## What generated test code can and cannot reach

The engineer runs the tests it writes, and so do the gates. While they run, test code is ordinary Node code on the
runner.

It **can** reach the network, the checkout, and the environment of the step it runs in, which includes the Claude
credential. Treat that credential as exposed to generated code: use an API key with a spend limit or a token you can
rotate, and do not reuse it elsewhere.

It **cannot** reach a tracker token or a GitHub token: none is in that job. It cannot push, because the checkout keeps
no credentials. It cannot change what later stages believe: the request, requirements, technical review and plan are
read once before any test runs and written back afterwards. And it cannot smuggle a change outside the test folders
into the pull request: the publish job, which holds the write token but no Claude credential and runs no agent,
refuses a patch that touches any other path before applying it, and only `git` and `gh` run after that.

## Other things that are checked

- **Where the analysis comes from.** The test half takes an analysis only from a run of `qa-analysis.yml` in this
  repository, on the default branch, started by a label, a dispatch or a person; a pull request from a fork cannot
  plant one.
- **Pull requests from forks** get no secrets: the Regression suite runs, and triage is skipped.
- **The run history** reads artifacts as JSON only, checks the type and length of every value, links only to
  github.com, and escapes everything it writes into markdown and HTML.
- **The MCP server** runs on your machine with your credentials. It never starts a workflow or adds a label, checks
  every input with zod, and files a drafted ticket only when asked to, without labels.

## Known gaps

- "Treat it as data" is an instruction, not a guarantee. An agent can still be steered within what it is allowed to do.
- The reviewer is the same model family as the engineer, so it can share its blind spots.
- Third-party actions are pinned to a major version (`actions/checkout@v4`), not to a commit. Pinning them to a SHA
  would close a supply-chain gap.
- npm dependencies are locked by `package-lock.json` and installed with `npm ci`, but not audited in CI.
