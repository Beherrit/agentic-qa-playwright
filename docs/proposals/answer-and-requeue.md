# Proposal: answer the questions on the ticket, and the analysis runs again

Status: design only. Nothing here is built.

## The gap

When a requirement is too vague, the analysis stops, posts its blocking questions on the ticket and adds the
`qa-needs-info` label. Today that is a dead end in two ways:

- A reply on the ticket does nothing. Somebody has to add the `qa-pipeline` label again.
- Even then the answers are not seen. Intake reads the ticket's title and description only, not its comments, so
  the answers have to be edited into the description by hand.

The comment the pipeline posts says "answer them on this ticket", which promises more than it does.

## What it should do

Someone answers in a comment, in a set format. The analysis starts again by itself, with the questions and the
answers in front of the analyst, and either moves on to a plan or asks a narrower follow-up.

### The format

The needs-info comment ends with a short "how to answer" block:

```
/qa-answer
1. Shoppers should finish checkout in three fields instead of five. Drop "last name" and merge the address lines.
2. The complaint is the information step. No time target; it is about the number of fields.
```

- The comment starts with `/qa-answer` on its own line. That is what marks it as an answer and not conversation.
- Answers are numbered like the questions. Free text is fine; the numbers only help the reader.
- More than one answer comment is allowed. They are read in order.

### What changes

| Where | Change |
|---|---|
| `agents/sources/types.ts` | A ticket also carries its comments: author, whether the author is trusted, and the text |
| `agents/sources/github.ts` | Read comments along with the issue (`gh issue view --json comments`). Trusted means an author association of owner, member or collaborator |
| `agents/sources/jira.ts` | Read the ticket's comments and convert them from Atlassian's format. Anyone who can comment in the project counts as trusted |
| `agents/sources/index.ts` | A pure function builds the requirement text: the description, then the questions from the pipeline's last needs-info comment, then every trusted `/qa-answer` comment with its author. Unit tested |
| `agents/prompts/requirements-analyst.md` | Answers are part of the requirement. Do not ask again what has been answered. If an answer is still too vague to test, ask the narrower question |
| `agents/lib/render.ts` | The needs-info comment gets the "how to answer" block, worded per tracker |
| `qa-analysis.yml` | A new trigger: a comment is created on an issue. The run goes ahead only if all four hold: it is an issue and not a pull request, the comment starts with `/qa-answer`, the author is an owner, member or collaborator, and the issue carries `qa-needs-info` |
| `qa-tests.yml` | Accept an analysis that was started by a comment, next to the three origins it accepts today |
| Jira | One more automation rule: when a comment starting with `/qa-answer` is added, send the same `qa-analyze` event the label rule sends |

Nothing changes after intake. The answers travel inside the requirement text, so the strategy, the gates and the
reports work as they do now. If the second analysis is satisfied, the ticket gets `qa-analyzed` and loses
`qa-needs-info`, which the report step already does.

## Things to get right

- **Who may answer.** On a public repository anyone can comment, and a comment would now start a run and reach an
  agent. Both the trigger and the intake have to check the author, not only one of them: the trigger so a
  stranger cannot start a run, the intake so a stranger's `/qa-answer` posted earlier is not read when a trusted
  person starts one.
- **Answers are data.** They go inside the same tags as the requirement and are covered by the same instruction:
  material to analyse, never instructions to the agent.
- **Do not cancel a real run.** Every comment on every issue and pull request will start this workflow, and almost
  all of them will be skipped. The concurrency group must put those in a group of their own, as it already does
  for unrelated labels, or a stray comment would cancel an analysis in progress.
- **A loop.** The pipeline's own comments must never count as answers. They are posted by the Actions bot, which
  is not a trusted author, and they do not start with the command.
- **Noise.** The Actions tab will list a skipped run for every comment. That is the cost of the trigger.

## How to check it when it is built

1. A vague ticket is blocked, and its comment shows the answer format.
2. A `/qa-answer` comment from the owner starts a run without touching the labels, and the new analysis quotes the
   answers in its assumptions or criteria and does not repeat the questions.
3. The same comment from an account without write access starts nothing.
4. An ordinary comment on a ticket whose analysis is running does not cancel it.
5. An answer that is still vague gets a narrower follow-up question, not a plan.

Estimated size: about half a day, most of it the trigger conditions and their tests.
