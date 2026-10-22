# Test design notes

A short reference the strategy agents work from. It is deliberately brief: enough to pick the right technique and the
right layer for a test, not a textbook.

## Picking a technique

Use the one that fits the shape of the requirement. Most features need two or three, not all of them. Name the one you
used on every case: a reviewer should be able to see why the case exists from its technique alone.

| Technique | Reach for it when | What it gives you |
|---|---|---|
| Equivalence partitioning | An input has groups of values that should all behave the same | One test per group instead of one per value |
| Boundary values | There is a limit, a range, a length, a count, or an empty state | Tests at the edge and one step either side, where off-by-one bugs live |
| Decision table | Several conditions combine to decide an outcome | Every meaningful combination, with none forgotten |
| Pairwise | Three or more independent settings, each with a few values, and every combination would be too many tests | A small set where every pair of values meets at least once, which is where most combination bugs show up |
| State transition | The thing under test has states and moves between them (empty cart, cart with items, order placed) | Valid moves, and invalid moves that must be refused |
| Use case | The requirement is a journey across several screens | The main path plus the alternative and failure paths a user really takes |
| Error guessing | The feature is risky or the requirement is thin | The mistakes experience says to expect, found with the failure lenses below |
| Exploratory charter | A risk is real but no script can say in advance what "wrong" looks like: a new layout, a confusing flow, a feature with no spec | A time-boxed session a person runs, with a mission and the things to watch for |

### Pairwise, done properly

- List the settings and their values in the case's steps, e.g. "Sort: name, price. View: grid, list. Persona:
  standard_user, problem_user". A setting whose value never changes the outcome is not a setting; leave it out.
- Choose the rows so every pair of values appears together at least once. Three settings of two values each need four
  rows, not eight. Say in the expected result which pairs the case closes.
- A combination the requirement calls out by name is always its own case, pairwise or not.

### Exploratory charters

An exploratory case is a session, not a script. Write it as:

- **Mission**: one sentence on what the session is for, e.g. "find where the new filter confuses a first-time shopper".
- **Where**: the pages, personas and data to use.
- **Watch for**: the failure lenses that matter most here.
- **Timebox**: 30, 60 or 90 minutes.

Put the mission and the where in the steps, the watch-for list and the timebox in the expected result, and send it to
the manual layer. A charter is never a stand-in for a check a script could make: if you can write the assertion,
write the scripted case instead.

## The failure lenses

Ten questions to hold a feature up to. Error guessing, the critic's checklist and every exploratory charter start here.
Use the ones that fit; a feature rarely needs all ten.

1. **Wrong input.** Empty, too long, the wrong type, pasted with spaces, characters from another script.
2. **The edges.** Zero, one, the most allowed, one past it, the first and the last item.
3. **Before and after.** What was true before the action, and does it still hold after a reload, back, logout and in again?
4. **Out of order.** Steps skipped, done backwards, or reached by a link instead of the usual path.
5. **Twice.** The same click, the same submit, the same item, the same request again.
6. **Half way.** Leaving mid-flow, closing the tab, losing the network, a timeout at the worst moment.
7. **Someone else.** Another persona, another role, another tab or device changing the same thing.
8. **A lot of it.** A long list, a big file, many items, slow data.
9. **The neighbours.** What shares a control, a page or a piece of state with this, and still works afterwards?
10. **Saying so.** When it fails, does the user find out what went wrong and what to do next?

## Picking a layer

Put each test at the cheapest layer that can prove the behaviour. The project's layers are listed in the task,
cheapest first, with what each one proves and who owns it. When the task lists none, these three apply:

- **e2e (browser)**: journeys across pages, things only visible once the whole app is assembled, and anything in an
  app where the browser is the only way in. This is the layer the pipeline automates.
- **lower-layer**: rules that could be proven by a unit, component or API test if there is access to the code. Say
  so in the plan even when this repository cannot write that test, so the gap is visible to whoever owns the code.
- **manual**: a last resort. Use it only for judgement a script cannot make (does this look right, is this wording
  clear) and for exploratory charters, and give the reason. A plan with no manual cases is a good plan.

Whatever the layers are called, the question is the same: what is the cheapest place this could fail, so the person who
can fix it hears first?

## What a good plan covers

- Every acceptance criterion has at least one test case, and the negative and edge criteria are not skipped.
- Each persona the requirement affects is tried, not only the happy default.
- Settings that combine are covered by a decision table or a pairwise set, not by whichever combinations came to mind.
- Nothing duplicates a test the suite already has, at any layer. Extend the existing test instead.
- Each case names its expected result precisely enough that two people would write the same assertion.
- Regression risk is considered: what nearby behaviour could this feature break, and is that already covered?
