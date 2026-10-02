# Test design notes

A short reference the strategy agents work from. It is deliberately brief: enough to pick the right technique and the
right level for a test, not a textbook.

## Picking a technique

Use the one that fits the shape of the requirement. Most features need two or three, not all of them.

| Technique | Reach for it when | What it gives you |
|---|---|---|
| Equivalence partitioning | An input has groups of values that should all behave the same | One test per group instead of one per value |
| Boundary values | There is a limit, a range, a length, a count, or an empty state | Tests at the edge and one step either side, where off-by-one bugs live |
| Decision table | Several conditions combine to decide an outcome | Every meaningful combination, with none forgotten |
| State transition | The thing under test has states and moves between them (empty cart, cart with items, order placed) | Valid moves, and invalid moves that must be refused |
| Use case | The requirement is a journey across several screens | The main path plus the alternative and failure paths a user really takes |
| Error guessing | The feature is risky or the requirement is thin | The mistakes experience says to expect: back button, double click, reload half way, stale data |

## Picking a level

Put each test at the cheapest level that can prove the behaviour.

- **e2e (browser)**: journeys across pages, things only visible once the whole app is assembled, and anything in an
  app where the browser is the only way in.
- **lower-layer**: rules that could be proven by a unit, component or API test if there is access to the code. Say
  so in the plan even when this repository cannot write that test, so the gap is visible to whoever owns the code.
- **manual**: a last resort. Use it only for judgement a script cannot make (does this look right, is this wording
  clear) and give the reason. A plan with no manual cases is a good plan.

## What a good plan covers

- Every acceptance criterion has at least one test case, and the negative and edge criteria are not skipped.
- Each persona the requirement affects is tried, not only the happy default.
- Nothing duplicates a test the suite already has. Extend the existing spec instead.
- Each case names its expected result precisely enough that two people would write the same assertion.
- Regression risk is considered: what nearby behaviour could this feature break, and is that already covered?
