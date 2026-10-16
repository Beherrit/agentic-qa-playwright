# Bringing this into a company: the first ninety days

The order matters more than the speed. Start with roles that are read-only and visibly useful, earn the trust, then
move up the access levels. A company that starts with "the bot files tickets and posts in Slack" spends its first
month arguing about a bad post; a company that starts with "the bot describes every merge request" spends it getting
better reviews.

## Before anything: a week of groundwork

- **Pick the systems.** Tracker, code host, documentation tool, chat. Fill in `co.config.json`. If the company has
  two of something, pick the one engineering lives in.
- **A service account per system**, with the least it needs: read for the fetch jobs, comment or create for the post
  jobs. Separate tokens. Never an admin.
- **A bot repository.** A fork or a sandbox project where the agents can run on real-shaped traffic without anyone
  seeing it. Every role lives here for a week before it sees the real one.
- **Owners.** Two or three people who own `co.config.json`, the prompts and the workflows under `CODEOWNERS`. They are
  also who the kill switch belongs to.
- **Where the audit log goes.** Job logs for CI, a shipped file for the CLI. Decide before the first run.
- **A model budget.** A number per day you are happy to lose if everything goes wrong. Put it in `budget.maxUsdPerDay`.

## Days 1 to 30: read-only roles, everyone watching

Turn on, in this order, one at a time, a few days apart:

1. **merge-request-describer** as a comment (not `--apply`). It is the fastest win and the lowest risk: a description
   nobody has to accept. Within a week people start reading the comment before the diff. Collect what it gets wrong
   and fix the prompt; add each miss to the evals.
2. **onboarding-guide** behind `co ask` and in the help channel. Read-only, cites sources, says when it does not know.
   This is where the company learns the bot's limits in a setting where a wrong answer costs a minute.
3. **weekly-digest** to a channel. Labelled, factual, nobody signs it off. The first one will be dull; by the fourth
   people complain when it is late.

Measure: how many describer comments are edited by the author (lower is better), how many `co ask` answers end in
`notFound` (should fall as the docs improve), cost per run.

Do not turn on anything that writes outside a comment yet, however good the describer looks.

## Days 31 to 60: comments with consequences, and the CLI for tickets

4. **merge-request-reviewer** on ready pull requests. The first week with `blocker` findings posted as `major` so
   nobody's merge is blocked by a bot while you calibrate; then as written. It never approves. Agree with the team
   what a human reviewer does with a bot blocker: read it, and either fix or reply why not.
5. **ticket-writer** behind `co ticket new`. The person files it, so the risk is a badly worded ticket with their name
   on it. Pair it with the skeptic and analyst from the engine for the questions. Watch the `needs-info` rate.
6. **ticket-enricher** on new tickets. The comment that saves the first hour. The main failure is noise on trivial
   tickets: add a size threshold or a label to opt in per project if it is too chatty.
7. **alert-triager** to the incidents channel, for one alert family first (the noisiest one). The on-call engineer is
   the judge. If the runbook is missing, the triager will say so every time, which is the point.

Measure: reviewer findings per pull request and how many are acted on; tickets filed through the CLI versus by hand;
time from alert to first human action.

## Days 61 to 90: drafts a person publishes

8. **release-documenter** as Confluence drafts or docs pull requests. The documentation owner publishes. Expect the
   first drafts to be too long and too close to the code; fix the prompt, not the owner's patience.
9. **doc-drift-checker** weekly, one area at a time. Each confirmed finding is a small ticket; the backlog it creates
   in week one is the documentation debt you already had.
10. **chat-responder** for statements, with the reaction approval. Only in internal channels. Shared channels stay
    off until the company has seen a quarter of clean statements.
11. **incident-scribe** on the next incident, with the incident commander told in advance. The post-mortem draft is
    where it earns its keep.

Measure: drafts published without edits; drift tickets closed; statements approved versus ignored.

## After ninety days

- Review the audit log once a month: refusals by category, failures by problem, cost by role. A rising refusal rate in
  one category is either an attack or a prompt that got stricter than the work; look.
- Re-run the evals on every prompt change and on every model change. A new model is a new employee.
- Retire a role that nobody reads. The digest that is not read, the enrichment nobody opens. The point is time saved,
  not coverage.
- When a role has been boring for a quarter, consider the next access level for it (the describer with `--apply`, the
  reviewer blocking on `blocker`). Boring is the qualification.

## Things that go wrong, from experience with the engine

- **The prompt grows.** Every miss becomes a paragraph until the role cannot find its own instructions. Keep each under
  a page; move examples to evals.
- **One token for everything** because it was quicker. It is the one thing this design depends on; do not.
- **The bot in a channel it was not invited to**, because someone added it. Keep `channels.allowed` short and the bot
  out of everything else.
- **`--yes` everywhere** because the questions were annoying. The questions are the product for the roles that have
  them. If a role's question is always yes, change its policy on purpose, not its callers by habit.
- **Nobody owns the failures.** A failed run posts nothing and is logged. If nobody reads the log, the role is silently
  off. Pipe the failures into the help channel.
- **Treating a prompt change as a config change.** It is a behaviour change with a blast radius of every run. Review it
  like code, test it like code.
