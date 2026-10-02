# Contributing

## Before you open a pull request

```bash
npm ci
npx playwright install chromium
npm run check          # types, lint and the pipeline's unit tests
npx playwright test    # the suite, when tests/, pages/ or fixtures/ changed
```

`npm run check` runs the same three checks the Regression workflow runs before the suite. None of it calls an
agent. Changes to an agent stage are also checked with `npm run evals -- --dry`, which runs the evaluation checks
against recorded answers; `npm run evals` runs them against the real agents and spends the plan or API budget of
whoever runs it.

The pull request template asks three things: what, why, and how it was tested. Keep the description that short.

## Where things go

- **Tests:** generated or hand-written, tests live in `tests/`, page objects in `pages/`, and the shared fixture and
  test data in `fixtures/`. Those are the only folders the pipeline may write to, and the scope gate rejects anything
  else. The rules for writing them are in [docs/test-conventions.md](docs/test-conventions.md).
- **The pipeline:** `agents/`. Logic that can be tested without a network, a browser or a model goes in a small pure
  function in `agents/lib/`, with a test in `agents/test/`.
- **Instructions for an agent:** `agents/prompts/<role>.md`, one per role. A new role also goes in the roles table in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and in the list `npm run doctor` checks.

## Code style

- TypeScript, run directly by `tsx` and by Node's type stripping, so imports carry the `.ts` extension and the syntax
  must be erasable: no `enum`, no `namespace`, no constructor parameter properties.
- Small pure functions, unit tested with `node:test` and `node:assert/strict`.
- Comments say why, not what. One line is usually enough.
- Every agent answers in a zod schema from `agents/lib/schemas.ts`. Anything an agent claims that code can check
  (a file, a test title, a ticket, a verdict) is checked in code before it is used.
- Text a stage reads from a ticket, a diff or a web page goes to an agent inside tags, as data.

## Writing style

Reports, prompts, docs and commit messages are read by people deciding what to do next. Write plainly and directly,
the way a careful senior QA engineer would.

- No emojis. No em dashes: use a comma, a colon or a full stop.
- No marketing words: not "seamless", "robust", "leverage", "powerful", "comprehensive", "cutting-edge".
- The same words for the same things: ticket, criterion, test case, gate, verdict.
- A report opens with its verdict and the numbers behind it, then the detail. Long tables go under `<details>` with a
  one-line summary that stays visible.
- Say what was not checked as clearly as what was.

## Commits

One change per commit, with a subject that says what it does in plain words ("Count a command as run only if the
allowlist let it run"). The body says why, when that is not obvious.
