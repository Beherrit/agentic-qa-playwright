# Testing agentic AI

A system with an agent in it is not deterministic. The same input can produce a different answer, a different
sequence of tool calls, a different cost. The usual reflex, "write a test that asserts the exact output", does not
apply. What does apply is older than models: separate what can be checked exactly from what can only be checked
statistically, and make the second part as small as you can.

This page is the method. Every point has the place in this repository where it is done.

## 1. Push as much as possible out of the model

Anything that is code, test as code. Parsing, scoring, verdict rules, permission lists, report formats, the gates
themselves. None of it should need a model to run its tests. The agent is then a thin layer whose job is to fill in
a schema, and the schema is the contract.

Here: `npm run test:unit` (part of `npm run check`) runs about 250 unit tests with no agent call. They cover the
gates' parsing, the plan score, the verdict rules, the sabotage verdicts, the MCP server's input checks, the
markdown that is posted to tickets.

## 2. Make every agent answer in a schema, and reject what does not parse

Free text cannot be tested. A schema can: the field exists, the enum is one of the allowed values, the list is not
empty, each reference points at something real. Validation at the boundary means a bad answer fails the job instead
of flowing downstream as a surprise.

Here: `agents/lib/schemas.ts`, one schema per role. The runner passes the schema to the SDK as the output format and
parses the result; an answer that does not parse fails the stage.

## 3. Write evals, and treat the pass rate as the number, not a single pass

An eval is a canned input for one stage plus checks written in code against the stage's structured answer. The checks
are about properties, not exact text: a vague wish must produce a blocking question; a clear one must not; a wish
for a feature that exists must come back marked as existing; a review may only name tests that are in the
repository.

Because the agent is not deterministic, run each case several times and read the rate. A case that passes 2 of 3
is a case to think about, not a pass. Track the rate over time; a prompt edit that moves it is a regression or an
improvement, and either way you know.

Here: `agents/evals/`. `cases/` holds the inputs and their checks, `fixtures/` holds recorded answers.

```bash
npm run evals -- --dry          # checks against the recorded answers: no agent, runs in a second
npm run evals                   # every case through the real agent
npm run evals -- --repeat 3     # each case three times, so the output is a rate
npm run evals -- --case vague-wish
```

## 4. Test the checks themselves

An eval check that can never fail proves nothing. For each recorded answer, change one thing (drop the blocking
question, add a reference to a test that does not exist) and show the check catches it. This is mutation testing for
the harness.

Here: the unit tests around the evals do this for every recorded fixture.

## 5. Check that the output does its job, not that it looks right

When the agent produces something executable, run it. For tests, that means more than "they pass": passing tests
that would also pass against a broken feature are worth nothing.

Here, in order of strength:

- **Full suite and stability.** The new tests pass, and keep passing when repeated (`--repeat-each`).
- **Fails for the right reason.** Tests the requirement says should fail (a feature not yet built) must fail on the
  assertion that matters, not on a timeout or a missing element.
- **Sensitivity.** Run the new tests against known-broken configurations (here, Swag Labs' deliberately broken
  accounts, and faults injected into the page) and require them to fail.
- **Sabotage.** A separate critic agent reads the acceptance criteria and writes one fault per criterion: a script
  that breaks exactly that behaviour in the browser, with a probe that says whether the fault took hold. The new
  tests run against each fault. Verdict per fault: caught, missed, or dud (the fault did not take, so it proves
  nothing). A miss blocks the pull request by default. This is the direct answer to the question "how do you know
  the AI's tests test anything?"

The sabotage gate is in `agents/gates.ts`, the verdicts in `agents/lib/sabotage.ts`, the critic's instructions in
`agents/prompts/saboteur.md`.

## 6. Test the boundaries, not just the behaviour

The most important property of an agent is what it cannot do. Test that:

- a reader cannot write; a writer cannot write outside its folders (the scope gate here fails the run if it does,
  and existing files may only grow)
- no agent can reach credentials it was not given (agent jobs on CI carry no GitHub token; the publish job carries no
  model token; the workflow checks out with `persist-credentials: false`)
- a refused tool call is counted and reported, not retried silently
- a stage with a budget stops at the budget

These are plain assertions about configuration and runner behaviour. They belong in the unit tests.

## 7. Use a second agent to find what the first one missed

A model does not catch its own blind spots, but it is good at catching another's. Plan critic against plan author;
reviewer against engineer; saboteur against the tests. Give the second agent the artefact and the requirement, not
the first agent's reasoning, so it reads cold.

## 8. Keep the receipts

Every run records which model, how many turns, how many tokens, what it cost, which tool calls were refused, and
what each gate said. The run history on the `qa-history` branch shows across runs how often the gates passed and the
review approved first time. This is the regression suite for the whole system: if a prompt or model change moves
those numbers, you see it.

## 9. Prove the harness live, on purpose

Before trusting a new check, give it an input you know is bad and watch it fail. When the sabotage gate was built,
the first dry run used three hand-written faults: one the tests should catch, one they should miss, one that would
not take hold. It reported caught, missed and dud. That is the test of the test.

## What this does not solve

Evals are expensive to run live, so they run on demand, not on every push. A pass rate is a measurement, not a proof.
A model update can shift behaviour in ways no case covers, which is why the structural checks (schema, gates,
boundaries) carry more weight than the evals do. And none of this measures whether the work was worth doing; a person
still decides that at the hand-off.

## A checklist to take elsewhere

- Is every agent answer a validated schema?
- Can the non-model code be tested with no model running?
- Do evals exist per stage, with property checks and a repeat count?
- Has each check been shown to fail on a bad answer?
- When the output is executable, is it executed against something known to be broken?
- Are permission boundaries asserted, not just configured?
- Does a second agent review the first one's work cold?
- Is cost, turns, refused calls and gate results recorded per run and visible over time?
