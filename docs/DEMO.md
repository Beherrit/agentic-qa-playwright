# Demo guide

A ten-minute walk through the project, using runs that exist in this repository. Nothing has to be started live:
every link below opens something the pipeline produced. The last two sections say how to run one live, and how to
show it going into a different project.

The one-line version: **a requirement goes in, as a ticket or a pull request, and what comes back is a QA analysis
within minutes and, on request, reviewed Playwright tests as a pull request. Agents do the legwork, scripts do the
checking, a person merges. And it installs into any Playwright project.**

## 1. The whole thing, on one ticket (4 minutes)

Start here. [Issue #17, "Reset App State from the side menu empties the cart"](https://github.com/Beherrit/agentic-qa-playwright/issues/17)
went through both halves of the pipeline on a clean repository, with nothing prepared.

1. **The ticket.** Read the first post. Three plain paragraphs, the way a product owner writes: no criteria, no
   test ids beyond one, a decision deliberately left open (whether reset should also put the sort order back).
2. **The analysis**, six minutes later, in the first comment. Point at:
   - the verdict line: **Ready for tests. Plan health 98/100**, worked out in code, not by the model
   - ten acceptance criteria in Given / When / Then, marked happy, negative or edge, and the assumptions and open
     questions under them. The open decision became an assumption and a non-blocking question, not a guess
   - the **Technical review**. This is a second agent that read the suite and opened the shop. It names the three
     existing tests that already cover part of the ticket, the three page object members that have to be added
     (with their locators), and five nearby behaviours with the test that guards each, or "nothing". Every file and
     test title in it was checked against the repository after it answered
   - under "Seen live": the reviewer found a **real defect** before any test was written. After Reset App State the
     badge clears but the product list keeps showing "Remove" until a reload. The architect saw the same thing on
     the cart page, independently. The plan says to write the tests to the requirement and not soften them
   - the test cases, each with a technique, a level and a priority, and the critic's checklist. The critic wrote
     it without seeing the plan; the three cases marked `*` were added because of it
3. **The pull request:** [#25](https://github.com/Beherrit/agentic-qa-playwright/pull/25), 19 tests for the ten
   criteria, every one verified by the reviewer, gates 8 of 8, about two dollars of agent time. Point at:
   - the verdict line: it is a **draft**, because after one round of rework the reviewer still had one major
     finding, a retry helper the engineer put inside a page object against the conventions. The pipeline did not
     hide that; it handed the decision to a person, which is the design
   - **Suspected product bugs**, the defect above, now as tests that assert the right behaviour and are marked as
     expected failures with the criterion they disagree with. The engineer also reported a third thing it could
     not pin to a criterion: the side menu sometimes opens and shuts on its own
   - the **traceability table**: criterion, tests, and whether the reviewer verified it
   - the **quality gates**, and the sensitivity table: the new tests were run against accounts the shop breaks on
     purpose, to see which tests catch a broken app. That is the reviewer's question, "would this test fail if the
     behaviour broke?", answered by running it
   - **Accessibility**: an axe scan of the pages the tests ended on. Advisory, and it never says "passed"
   - "Agent runs" at the bottom: turns, time and estimated cost per agent
4. **How it ran:** the [Actions tab](https://github.com/Beherrit/agentic-qa-playwright/actions). Open the "QA
   tests" run for this ticket. Each stage is a job in the graph. Click a code generation job to see the agent's work
   line by line, including the tools it was refused.

The ticket also has a comment that says **no tests this time**. Keep it in the story. On the first attempt the
reviewer asked for changes, the rework failed the full-suite gate on a test elsewhere in the suite that was flaky,
and the engineer's workaround changed an existing line in a page object, which the scope gate refused. A pipeline
that only ever shows green has not been tested. Section 3 is what happened to that flaky test.

## 2. It knows when to stop, and what to do with an answer (2 minutes)

[Issue #21, "Make the cart better"](https://github.com/Beherrit/agentic-qa-playwright/issues/21). The ticket says
the cart should be better and shoppers complain, and nothing else. Read the comments in order:

1. **The pipeline stopped.** Three placeholder criteria marked blocked, no tests invented for how the cart already
   works, two sharp questions, the `qa-needs-info` label, and a line saying how to answer.
2. **The owner answered** in a comment starting with `/qa-answer`. That comment alone started the analysis again.
   Nobody touched a label. A visitor's comment would have been ignored: the workflow checks the author, and the
   intake checks again before reading.
3. **The second analysis** used the answers: the title became "Remove an item from the cart page", eight criteria,
   plan health 96. The technical reviewer opened the shop as the broken account the complaint hinted at and reported
   that the defect did not reproduce, so the plan says to assert the behaviour and treat any failure as the bug.
4. **[Pull request #26](https://github.com/Beherrit/agentic-qa-playwright/pull/26)** came out of the test half by
   itself: 12 tests, gates 7 of 7, approved by the reviewer at the first review, under a dollar of agent time. The
   whole thing, from the vague ticket to the approved pull request, with the only human act being the answer.

The older version of this story is [issue #3](https://github.com/Beherrit/agentic-qa-playwright/issues/3), from
before answers could be read: the pipeline stopped the same way, and the first time it ran, the analyst rescued
the ticket with criteria for how checkout already worked. The instruction was tightened and the run repeated.

And one more stop worth showing: [issue #22, "Product details page"](https://github.com/Beherrit/agentic-qa-playwright/issues/22)
got a 98-point plan, and its test half was stopped by the stability gate because two of the generated tests did
not give the same result three times in a row. No pull request was opened, and the ticket says exactly which
tests and why. The gates do not negotiate.

## 3. When the suite fails (2 minutes)

Two different failures, two different outcomes.

**The test is wrong.** [This Regression run](https://github.com/Beherrit/agentic-qa-playwright/actions/runs/37073920188)
on `main` failed on one sort test: a click right after the list is redrawn is sometimes swallowed. Triage read the
error context and the screenshot, called it a test defect, and the healer opened
[pull request #18](https://github.com/Beherrit/agentic-qa-playwright/pull/18): the click is repeated until the
product page opens, the same pattern the file already used elsewhere. Its gates are different from the ones for new
tests: nothing skipped, nothing marked as an expected failure, no file left with fewer assertions than it had, and
the repaired file passing three times in a row. It was merged, and the flaky test that stopped section 1's first
attempt is gone.

**The app is wrong.** Run Regression by hand as `problem_user` (Actions, Regression, Run workflow, persona), an
account the shop breaks on purpose. The suite fails in under two minutes. Triage groups the failures by cause and
files bugs with steps to reproduce; run it again and it comments on the same issues instead of filing new ones.
Issues [#5](https://github.com/Beherrit/agentic-qa-playwright/issues/5) to
[#8](https://github.com/Beherrit/agentic-qa-playwright/issues/8) are an earlier set.

A product bug is never "healed". That is the line between the two.

## 4. Tests before the feature exists (1 minute)

[Issue #4, "Search products"](https://github.com/Beherrit/agentic-qa-playwright/issues/4) and
[pull request #10](https://github.com/Beherrit/agentic-qa-playwright/pull/10). The shop has no search. The ticket
says so ("No, write the tests first"). The analysis includes a **contract** for the developers: every element the
tests will look for, with its locator. The pull request has 16 tests that open with `test.fail(true, 'not built
yet: REQ-4')`. They pass today because they fail; on the day search is built, Playwright reports "expected to fail,
but passed" and the markers come off. A gate read the error behind every one of those failures and rejects a test
that fails because of a typo rather than a missing search box.

## 5. The view from above (1 minute)

- **Run history:** the [`qa-history` branch](https://github.com/Beherrit/agentic-qa-playwright/tree/qa-history).
  Every pipeline run with its plan score, gate results, review verdict, time and cost, with totals at the top. It
  includes the runs that failed.
- **Traceability map:** open the latest
  [Regression run on main](https://github.com/Beherrit/agentic-qa-playwright/actions/workflows/regression.yml) and
  look at its summary page: each requirement, the criteria its tests claim, and how they did, built from the tags
  with no model involved. `npx agentic-qa coverage --export junit` is the same thing for a test management tool.

## 6. Putting it in another project (2 minutes, live)

This is the part a new team cares about. In any folder with a Playwright suite:

```bash
npm install --save-dev github:Beherrit/agentic-qa-playwright
npx agentic-qa init
npx agentic-qa doctor
```

`init` writes ten files: the config, the two documents the agents read, the four workflows (each a few lines that
call the engine's), the issue form, the MCP registration and the fault-injection fixture. `doctor` then says, line
by line, what is still missing: the writable folders, the app address, the credentials. Nothing about the demo shop
comes along.

With a credential in the environment, `npx agentic-qa survey` is the next step to show: one agent reads
`package.json`, the Playwright config and the suite, and drafts the product brief, the conventions and the suite
settings. Every path and command it names is checked before anything is written, and the report opens with what a
person still has to settle.

Then the same three things on a new project as here: an environment named `POC` with the credential, three labels,
and a ticket labelled `qa-pipeline`.

## 7. The annoying questions (2 minutes)

[Issue #33, "Apply a discount code at checkout"](https://github.com/Beherrit/agentic-qa-playwright/issues/33).
The shop has no discount codes, so this is a test-first ticket: the feature does not exist, nobody opened the
app, and no test was run. Read the analysis comment and point at **Questions a developer would have to guess**:

1. The list. Can two codes stack? Before tax or after? What if it expires between Apply and Finish? What if Apply
   is pressed twice? A skeptic read the story alone, before the criteria were written, from three angles: what a
   developer would guess, what a frustrated user would try, and what breaks if it happens twice.
2. Under each question, the answer the tests are built on if nobody answers. The pipeline did not wait. Every one
   of those is a guess that would otherwise have been made silently, by a developer, in code, and found by a
   customer.
3. The line at the end: answer any of them in a `/qa-answer` comment and the analysis runs again with the guess
   replaced. On the day the feature lands, the product owner has answered what they could, and the rest is written
   down.

The three questions the skeptic is asked come from a tester's habit, not from a model: "list every question a
developer would have to guess the answer to", "what would a frustrated user try", "what breaks if this happens
twice". Asking them was always the tester's real job.

## Questions worth being ready for

**How do you know the AI's tests are any good?** Four layers, in order of how much I trust them: the gates, which
are plain commands; the sensitivity run against a broken app; a reviewer agent with fresh context that cannot
write; and a person who merges. The README's Limits section says where each one falls short.

**What if our app has no broken accounts to run the tests against?** A target can be a fault instead: a script run
on every page, or requests the test run answers or drops. The demo has one that removes the cart badge whenever it
appears. Any app can have one in five lines of config.

**And how do you know the agents themselves behave?** `agents/evals/` has ten canned cases (a vague wish, a
duplicate, contradictory criteria, a feature already built, and so on) with checks in code against each agent's
structured answer. `npm run evals` runs them live and prints a pass rate; `npm run evals -- --dry` checks the cases
against recorded answers without calling an agent. The answer to "is it any good" is a rate, not an anecdote.

**Our tickets are in Jira / Azure DevOps / Linear.** Each is an adapter with five functions, already written. The
same labels, the same reports. Requirements can also arrive as pull requests: the diff is the ticket.

**Our app is behind single sign-on.** The suite's setup project saves a signed-in storage state; the config names
the command and the file, and both the tests and the agents' browser start from it.

**We cannot send anything to Anthropic directly.** The same engine runs on Bedrock or Vertex: the provider's
settings go in one secret. SECURITY.md has a table of what leaves the repository.

**What stops it doing damage?** Each agent gets the least it needs. Readers cannot write. The engineer can write in
the configured folders and run three configured commands. Agents never hold a GitHub token; the job that runs the
gates holds no credential at all; the job that pushes never holds the model credential. A run can be capped at a
dollar amount. A patch is checked again before it is applied. The job logs show the refusals.

**Can I use it without GitHub Actions?** `npx agentic-qa mcp` serves it to Claude Desktop or Claude Code: draft a
ticket, run an analysis, see the coverage map, the run history or what is in flight, in a conversation. Every
stage is also a command, so another CI system runs it in one job.

**What does a run cost?** The pull request and the run history record turns, time and estimated cost per agent.
This demo runs every role on sonnet (`models` in `qa.config.json`). A test half on sonnet came to about a dollar;
haiku was tried and took six times longer on the role that writes code.

## Running one live

A ticket takes about five minutes to analyse and twenty to thirty to turn into a pull request.

1. New issue with the "QA requirement" template. A safe one: "As a shopper I can remove an item from the cart on the
   cart page, and the cart badge updates."
2. Add the `qa-pipeline` label. Show the Actions graph while it runs.
3. The test half starts by itself when the plan passes (`autoRun` in `qa.config.json`); otherwise add
   `qa-generate`.

For something quicker, run Regression by hand with the persona `problem_user`. The suite fails in under two minutes
and triage reports a few minutes later.
