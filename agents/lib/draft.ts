import { LABELS } from './paths.ts';
import type { TicketDraft } from './schemas.ts';

/** The pure parts of the ticket writer: the definition of ready, the ticket text and its labels. */

// Phrases that say nothing a test could check.
const VAGUE = ['works correctly', 'works as expected', 'is correct', 'as expected', 'properly'];

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const bare = (ref: string): string => ref.replace(/^#/, '');

/** What stops this draft from being ready for analysis. Empty when nothing does. */
export function readiness(draft: TicketDraft): string[] {
  const problems: string[] = [];
  if (draft.criteria.length < 3) problems.push('Fewer than 3 acceptance criteria.');
  if (!draft.criteria.some((c) => c.kind === 'negative')) problems.push('No negative criterion: what happens when it goes wrong or is refused.');
  for (const c of draft.criteria) {
    const then = c.then.trim().toLowerCase();
    if (!then) problems.push(`${c.id} has no outcome in its Then.`);
    else if (VAGUE.some((phrase) => then.includes(phrase))) problems.push(`${c.id} has a vague Then: "${c.then.trim()}". Name what the user sees.`);
  }
  for (const q of draft.questions.filter((question) => question.blocking)) problems.push(`Open question: ${q.question}`);
  for (const d of draft.duplicates) problems.push(`Possible duplicate of ${d.ref}: ${d.reason}`);
  return problems;
}

/** Keeps the duplicates that name a ticket that is really open. An agent can make up a ticket number. */
export function checkedDuplicates(draft: TicketDraft, open: { ref: string }[]): TicketDraft['duplicates'] {
  const refs = new Set(open.map((ticket) => ticket.ref));
  return draft.duplicates.filter((d) => refs.has(d.ref) || refs.has(bare(d.ref)));
}

/** The ticket text, in the shape of the GitHub issue form so the pipeline reads it the same way. */
export function ticketBody(draft: TicketDraft): string {
  const { story } = draft;
  const sentence = `As ${story.asA}, I want ${story.iWant}, so that ${story.soThat}.`;
  const rows = draft.criteria.map((c) => `| ${c.id} | ${c.kind} | ${cell(c.given)} | ${cell(c.when)} | ${cell(c.then)} |`);
  const table = ['| | Kind | Given | When | Then |', '|---|---|---|---|---|', ...rows].join('\n');
  const list = (items: string[]): string => items.map((item) => `- ${item}`).join('\n');
  const known = [
    draft.alreadyThere.trim() && `**Already there**\n\n${draft.alreadyThere.trim()}`,
    draft.assumptions.length > 0 && `**Assumptions**\n\n${list(draft.assumptions)}`,
    draft.outOfScope.length > 0 && `**Out of scope**\n\n${list(draft.outOfScope)}`,
    draft.questions.length > 0 &&
      `**Open questions**\n\n${list(draft.questions.map((q) => `${q.blocking ? '(Blocking) ' : ''}${q.question} ${q.why}`.trim()))}`,
  ].filter(Boolean);

  return `### What should the user be able to do?

${sentence}

${table}

### Why does it matter?

${draft.why.trim() || '_No response_'}

### Is the feature built yet?

${draft.built ? 'Yes, test what is there' : 'No, write the tests first'}

### Anything already known

${known.length > 0 ? known.join('\n\n') : '_No response_'}
`;
}

/** Labels for the new ticket. Starting the analysis is left to a person, so that label is never added here. */
export function ticketLabels(draft: TicketDraft, problems: string[]): string[] {
  return [...(problems.length > 0 ? [LABELS.needsInfo] : []), ...(draft.built ? [] : [LABELS.testFirst])];
}

/** What the writer gets on a second pass: the wish, the questions it asked, and the answers. */
export function withAnswers(wish: string, questions: string[], answers: string): string {
  return `${wish.trim()}

Questions asked about this wish:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Answers:
${answers.trim()}`;
}
