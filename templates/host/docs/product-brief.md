# Product brief: My app

The agents' only knowledge of the app besides the browser. Keep it short and true; a wrong line here becomes a
wrong assumption in every analysis. `npx agentic-qa survey` drafts this page from the existing suite; a person
checks it.

## What a user can do

- One line per thing the app lets a user do, in the user's words.
- The pages or screens, and how a user gets from one to the next.

## Accounts and personas

How tests sign in, which accounts exist and what each is for. Name the default account the tests use. If the app
sits behind single sign-on, say that the suite's setup project saves a signed-in session and tests start from it.

| Account | What it is for |
|---|---|
| | |

## Environments

Where the app runs for tests (the base URL in `qa.config.json`), and whether there is a preview per pull request.

## Things worth knowing

- Quirks a tester finds out the hard way: what resets, what persists, what is slow, what is stubbed.
- Whether there is an API or a database the tests can set data up through.
- Known gaps: features that do not exist yet, areas that are flaky, things that only work in one environment.
