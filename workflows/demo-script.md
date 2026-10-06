# Demo script: the agentic workflow in seven minutes

For a conversation about agentic AI in general, using this repository as the worked example. Nothing needs to run
live; every stop opens something that already exists. If the question is specifically about the QA pipeline,
[docs/DEMO.md](../docs/DEMO.md) is the longer version.

The one line: **a request goes in, several small agents with narrow tools do the work in stages, scripts check it,
a different agent reviews it, and a person gets a pull request. Nobody talks to it while it runs.**

## 0. The picture (30 seconds)

Open [workflows/README.md](README.md) and show the diagram. Say the shape out loud: intake, plan, act, check,
review, hand-off. Point out that the model is in some boxes and not in others, and that the ones without it are the
ones that decide.

## 1. It knows when to stop (1 minute)

Open an issue that was labelled `qa-needs-info`. Show the analyst's comment: a question, not a guess. Say: this is
the cheapest stage and the one that matters most. An agent given a vague brief produces something confident and
wrong, so the first job of the workflow is to refuse to start.

Then open a `qa-pipeline` issue that went through, and show the same stage producing acceptance criteria with the
assumptions listed. Same agent, same prompt; the difference was the input.

## 2. Two agents plan, one of them hostile (1 minute)

Same issue, scroll to the strategy comment. The architect's plan, the critic's checklist of what it missed, the
reconciled plan and the score. Say: one agent asked to plan carefully does not find its own gaps. A second agent
reading cold with a checklist does.

## 3. The worker has few tools (1 minute)

Open [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md), the roles table. Read the Access and Tools columns for the
engineer and the reviewer. Say: every agent is on an allowlist, permission mode refuses what is not listed, nobody
gets the network or the tracker credentials, and the jobs that run agents never hold a GitHub token. The question
"what stops it doing something stupid" has a boring answer, and that is what you want.

## 4. Scripts decide, not the model (1 minute)

Open the pull request the issue produced. The gate report at the top: scope, types, lint, traceability, full suite,
stability, fails for the right reason, sensitivity, sabotage. Say: none of these is a model. They cannot be talked
round. When one fails, the worker gets one bounded fix round, then the run stops and says so.

## 5. Proving the AI's output is worth anything (1.5 minutes)

Same pull request, the Sabotage table. Explain in one breath: a critic agent read the acceptance criteria, wrote one
fault per criterion that breaks exactly that behaviour in the browser, and the new tests ran against each one.
Caught, missed, dud. A miss blocks. Say: this is the answer to "AI writes tests that pass; how do you know they test
anything?" The honest answer is that you break the thing and watch.

If asked how the gate itself was proven: the first dry run used three hand-made faults designed to produce one of
each verdict, and it did.

## 6. A second agent reads cold (30 seconds)

Scroll to the review. Per criterion, met or not met, with the evidence. Say: the reviewer never saw the engineer's
conversation, and never edits. Its verdict set the pull request's draft state. A person merges.

## 7. How you test a thing like this (1 minute)

Open [workflows/testing-agentic-ai.md](testing-agentic-ai.md) and go down the checklist at the bottom. The short
form: everything that is code has unit tests with no model running; every agent answer is a schema; evals per stage
with property checks and a repeat count, because the number is a rate; the checks are mutation-tested; executable
output runs against something known to be broken; permission boundaries are asserted; cost, turns and gate results
are recorded per run and plotted over time.

Then show `npm run evals -- --dry` finishing in a second, and the run history on the `qa-history` branch.

## Questions to expect

**How is this different from asking a chatbot to write tests?** Several small agents with narrow tools and fixed
output shapes, scripts in between that cannot be argued with, and a stop when the input is not clear. The chatbot
version is one agent with every tool and a long prompt, and it does not hold up.

**What does it cost?** Each stage records its model, turns and tokens; the ledger is on the ticket and in the run
folder. Smaller models for the deciding stages, and a budget per run that stops it.

**What happens when it is wrong?** It is wrong in a pull request, in a draft state, with the reviewer's reasons
attached. Nothing merges itself.

**Would this work on our thing?** The shape does. Decide the input, what "clear enough" means, what the worker
produces, what a script can check about it, who reviews, and where it lands. Write the agents' instructions last.

**Can I see it run?** Yes, with a few minutes of lead time: open an issue from the template, add the label, and come
back. It spends a plan budget, so it is not started for every conversation.
