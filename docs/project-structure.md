# Project structure

The layout a Playwright suite needs so that people and agents can work in it without getting in each other's way.
`npx agentic-qa init` writes this shape into a project that has none ([templates/host/](../templates/host/)); this
page says why it is this shape and not a bigger one.

```
my-app/
  tests/                  one spec per feature, tagged with the requirement it covers
    checkout.spec.ts
  pages/                  one page object per page; it owns its locators and its actions
    BasePage.ts
    CheckoutPage.ts
  fixtures/               test.ts (the test and expect every spec imports), custom fixtures, typed test data
    test.ts
    fault.ts
    users.ts
  docs/
    product-brief.md      what the app is, for the agents
    test-conventions.md   how the suite is written, for people and agents alike
    test-design.md        how to pick techniques and levels (shipped by the engine)
  playwright.config.ts    the one place for environment: base URL, test id attribute, timeouts, projects
  qa.config.json          the pipeline: writable folders, commands, personas, gates
  tsconfig.json
  .github/
    workflows/            callers of the engine's workflows
    CODEOWNERS            who reviews the config, the documents, the shared layers
  .env.example            every variable the suite reads, with no values
  .gitignore              node_modules, Playwright's output folders, qa-run, .env
```

## The spine

Three folders hold the suite, and each has one job.

- **`tests/`** holds behaviour. A spec reads like a list of things the product does, in the user's words. It knows
  nothing about selectors.
- **`pages/`** holds how to do things on each page. A page object owns its locators as readonly fields and offers
  actions a user would recognise. It makes no assertions; the test decides what should be true.
- **`fixtures/`** holds how tests get what they need: `test.ts` extends Playwright's `test` with a fixture per page
  object and per starting state (`signedIn`), and typed modules hold shared data (`users.ts`, `products.ts`).

A test receives its page objects as arguments. That is what lets the engine's scope gate hold the line: the pipeline
may write only in these three folders, and a generated test that needs something new adds it to a page object or a
fixture, where a reviewer can see it.

## Folders that look useful and are not

- **`locators/`**. Splitting a page's locators from the actions that use them means two files to open for every
  change and a list that only grows, because nobody can tell which page still needs an entry. The locator belongs
  next to the method that clicks it.
- **`utils/`, `helpers/`**. The home of untyped shortcuts, and of a second copy of the app's logic (a price
  formatter, a sort) that lets a test and the app be wrong together. If something is shared setup, it is a fixture.
  If it is shared data, it is a typed module in `fixtures/`. If it is a page action, it is on the page object.
- **`test-data/`, `config/`**. Data is a typed module (a JSON file cannot say what shape it is). Environment is
  `playwright.config.ts` plus `.env`, read in one place and passed through `use`.
- **`reports/`, `screenshots/`**. Playwright writes `playwright-report/` and `test-results/` (with traces and
  screenshots on failure) by itself. Inventing folders for them means two places to look and one more thing to
  clean.

## What the folders cannot provide

The layout is the easy part. What makes a suite workable for agents is written down, not laid out:

- **A product brief** (`docs/product-brief.md`): what the app is, who uses it, the vocabulary, the personas and how
  to sign in. Every agent reads it before it reads a ticket.
- **Conventions** (`docs/test-conventions.md`): locator preference, page object rules, what a test may and may not
  contain, expected-failure markers, traceability tags. People and agents are held to the same page, and the review
  stage checks against it rather than from memory.
- **Traceability**: every describe block carries its requirement tag (`@REQ-12`) and every test its criterion
  (`@AC-3`), so the pipeline can say which criteria have tests and which do not, and a merge request can say what
  it covers.
- **Writable folders** (`qa.config.json`): the three folders the pipeline may change. The scope gate rejects a
  change anywhere else, which is what makes it safe to let an agent write code at all.
- **Owners** (`.github/CODEOWNERS`): the config, the documents, the fixtures and the page objects are shared layers.
  A change to them changes what every future test and every future agent run does, so it gets an owner's review.
- **TypeScript**, with the typecheck as a gate. A typed page object is a contract a generated test cannot drift
  from silently.

## Growing it

- A new page: a page object in `pages/`, a fixture in `fixtures/test.ts`, specs that use it. Nothing else.
- A new kind of shared state (an API client that seeds data, a signed-in session): a fixture, not a helper.
- A second app or a mobile web layout: a Playwright project in `playwright.config.ts`, not a second suite.
- Component or API tests: a sibling folder (`tests/api/`) under the same conventions, with its own `test.ts` only
  if the fixtures really differ.

When a folder appears that is not in the tree above, ask what job it has that one of the three does not.
