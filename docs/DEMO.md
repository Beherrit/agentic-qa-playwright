# Demo guide

A ten-minute walk through the project, using runs that already exist in this repository. Nothing has to be started
live: every link below opens something the pipeline produced. The last section says how to run one live if there is
time.

The one-line version: **a ticket goes in, and what comes back is a QA analysis within minutes and, on request,
reviewed Playwright tests as a pull request. Agents do the legwork, scripts do the checking, a person merges.**

## 1. The whole thing, on one ticket (4 minutes)

Start here. This ticket went through both halves of the pipeline.

1. **The ticket:** [issue #11, "Product details page"](https://github.com/Beherrit/agentic-qa-playwright/issues/11).
   Read the first post. It is three plain paragraphs, the way a product owner writes.
2. **The analysis**, a few minutes later, in the first comment. Point at:
   - the acceptance criteria in Given / When / Then, marked happy, negative or edge
   - the assumptions and the open questions, which is what a QA lead brings to refinement
   - **Plan health**, a score worked out in code, not by the model
   - the test cases, each with a technique, a level and a priority
   - the critic's checklist. A second agent wrote it without seeing the plan, and the cases marked `*` were added
     because of it
   - **Nearby behaviour at risk**: what this feature could break, and which existing test would notice
   - the **Technical review** under the requirements (on runs since it was added): the existing tests that already
     cover part of the ticket, the page objects the tests will use, related open tickets, and a line for each claim
     the checks took out because the file, test or ticket it named does not exist. A ticket from the ticket writer
     says "No reviewer run": its notes were read back from the ticket and checked, not written again
3. **The pull request:** [#12](https://github.com/Beherrit/agentic-qa-playwright/pull/12), 32 tests. Point at:
   - **Suspected product bugs**: the engineer found that the page for a product that does not exist still offers
     Add to cart, and that the item can be added. The tests assert the right behaviour and are marked as expected
     failures with a reason
   - the **traceability table**: criterion, tests, and whether the reviewer verified it
   - the **quality gates**, and open "Sensitivity: test by test". The new tests were run against accounts the shop
     breaks on purpose, to see which tests catch a broken app. That is the reviewer's question, "would this test
     fail if the behaviour broke?", answered by running it instead of reading it. Here 18 of 26 tests caught the
     broken account, and the table names the 8 that did not
   - **Accessibility**: an axe scan of the four pages the tests ended on found three rule violations. The gate is
     advisory, and it never says "passed"
   - "Agent runs" at the bottom: turns, time and estimated cost per agent
   - the **Files changed** tab: the tests themselves, tagged `@REQ-11` and `@AC-n`
4. **How it ran:** the [Actions tab](https://github.com/Beherrit/agentic-qa-playwright/actions). Open the "QA tests"
   run for this ticket. Each stage is a job in the graph. Click "1 Code generation + gates" to see the agent's work
   line by line, including the tools it was refused.

5. **The ticket writer, before and after:** the [last comment on the ticket](https://github.com/Beherrit/agentic-qa-playwright/issues/11#issuecomment-5958202688).
   The same one-sentence wish, given to the writer (`npm run draft`), came back as a full ticket in about a minute: it
   opened the shop, walked the product page, wrote ten criteria, listed what is out of scope, and refused to file
   because it spotted that this ticket already asks for the same thing. That is how tickets get written from now on;
   a person still reads the preview and says yes.

The ticket has two comments in the middle that say no tests were produced. Leave them in the story: the first run
was stopped by the gates because three of its tests failed, and the second by a safety check of mine that was too
strict. The third is the pull request. A pipeline that only ever shows green has not been tested.

## 2. It knows when to stop (1 minute)

[Issue #3, "Make checkout better"](https://github.com/Beherrit/agentic-qa-playwright/issues/3). The ticket says
checkout should be "better and faster" and nothing else. The pipeline did not invent tests for it. It asked what
should be different when the work is done, labelled the ticket `qa-needs-info`, and stopped.

Worth saying out loud: the first time this ran, the analyst rescued the ticket by writing criteria for how checkout
already works. Those tests would have passed and proved nothing. The instruction was tightened and the run repeated.
Both comments are on the ticket.

## 3. Tests before the feature exists (2 minutes)

[Issue #4, "Search products"](https://github.com/Beherrit/agentic-qa-playwright/issues/4) and
[pull request #10](https://github.com/Beherrit/agentic-qa-playwright/pull/10). The shop has no search. The ticket
says so ("No, write the tests first").

- The analysis includes a **contract** for the developers: every element the tests will look for, with its locator,
  and whether it is on the page today.
- The pull request has 16 tests, each opening with `test.fail(true, 'not built yet: REQ-4')`. They pass today
  because they fail. On the day search is built, Playwright reports "expected to fail, but passed" and the markers
  come off.
- The gate **"Red for the right reason"** read the error behind every one of those failures. A test that fails
  because of a typo in the test, rather than a missing search box, is rejected.
- The review took two rounds. The first asked for changes, the engineer reworked, the second approved.

## 4. When the suite fails (2 minutes)

Two different failures, two different outcomes.

**The app is wrong.** [This Regression run](https://github.com/Beherrit/agentic-qa-playwright/actions/runs/37027920772)
signed in as `problem_user`, an account the shop breaks on purpose. 19 tests failed. The triage agent read the page
snapshots and screenshots, grouped the failures by cause, and filed four bugs with steps to reproduce:
[#5](https://github.com/Beherrit/agentic-qa-playwright/issues/5),
[#6](https://github.com/Beherrit/agentic-qa-playwright/issues/6),
[#7](https://github.com/Beherrit/agentic-qa-playwright/issues/7),
[#8](https://github.com/Beherrit/agentic-qa-playwright/issues/8). Run it again and it comments on the same issues
instead of filing new ones.

**The test is wrong.** The branch `demo/locator-drift` has one stale locator on the checkout page.
[This run](https://github.com/Beherrit/agentic-qa-playwright/actions/runs/37027916968) failed six checkout tests.
Triage called it a test defect, and the healer opened
[pull request #9](https://github.com/Beherrit/agentic-qa-playwright/pull/9): one line changed, with a sentence
saying what had changed in the app. Its gates are different from the ones for new tests: nothing skipped, nothing
marked as an expected failure, no file left with fewer assertions than it had.

A product bug is never "healed". That is the line between the two.

## 5. The view from above (1 minute)

- **Run history:** the [`qa-history` branch](https://github.com/Beherrit/agentic-qa-playwright/tree/qa-history).
  Every pipeline run with its plan score, gate results, review verdict, time and cost, and totals at the top: gate
  pass rate, how often the review approved first time, which gate fails most. It includes the runs that failed.
- **Traceability map:** open the latest
  [Regression run on main](https://github.com/Beherrit/agentic-qa-playwright/actions/workflows/regression.yml) and
  look at its summary page: each requirement, the criteria its tests claim, and how they did, built from the tags
  with no model involved.

## Questions worth being ready for

**How do you know the AI's tests are any good?** Four layers, in order of how much I trust them: the gates, which
are plain commands; the sensitivity run against a broken app; a reviewer agent with fresh context that cannot
write; and a person who merges. The README's Limits section says where each one falls short.

**What stops it doing damage?** Each agent gets the least it needs. Readers cannot write. The engineer can write in
three folders and run three commands. Agents never hold a GitHub token, and the job that pushes never holds the
Claude token. A patch is checked again before it is applied. The job logs show the refusals.

**What went wrong while building it?** Plenty, and it is in the commit history: a scope check that dropped the
first letter of a path, an engineer that reported on tests it never ran because its command was refused, a
generated test that failed one run in four, a triage agent that called a deliberately broken account "environment".
Each one became a check or a clearer instruction.

**What does a run cost?** The pull request and the run history record turns, time and estimated cost per agent.

**Could this run on our app?** Everything specific to Swag Labs is in `qa.config.json`, two documents and the tests.
`npm run doctor` checks a new setup before any agent starts. Jira tickets work the same way as GitHub issues.

## Running one live

If there is time, a ticket takes about five minutes to analyse and another twenty to turn into a pull request.

1. New issue with the "QA requirement" template. A safe one: "As a shopper I can remove an item from the cart on the
   cart page, and the cart badge updates."
2. Add the `qa-pipeline` label. Show the Actions graph while it runs.
3. When the analysis is on the ticket, add `qa-generate`.

For something quicker, run Regression by hand with the persona `problem_user` (Actions, Regression, Run workflow).
The suite fails in under two minutes and triage reports a few minutes later.
