import { keyFor, validateRef, type SourceName } from '../lib/keys.ts';
import { LABELS } from '../lib/paths.ts';
import { Request, type Mode } from '../lib/schemas.ts';
import { azure } from './azure.ts';
import { github } from './github.ts';
import { jira } from './jira.ts';
import { linear } from './linear.ts';
import { pull } from './pull.ts';
import type { Source, Ticket, TicketComment } from './types.ts';

/** Prints instead of posting. Used for runs on your own machine from --text or --file. */
const local: Source = {
  async read() {
    throw new Error('A local requirement comes from --text or --file, not from a tracker.');
  },
  async comment(_ref, markdown) {
    console.log(`\n${markdown}`);
  },
  async label() {},
  async list() {
    return [];
  },
  async create(ticket) {
    console.log(`\n${ticket.title}\n\n${ticket.body}`);
    return { ref: 'local', url: null };
  },
};

const sources: Record<SourceName, Source> = { github, jira, pr: pull, azure, linear, local };

export function sourceFor(name: string): Source {
  if (!(name in sources)) throw new Error(`Unknown source "${name}". Use github, jira, pr, azure or linear.`);
  return sources[name as SourceName];
}

/** The answer to a GitHub issue form question, which arrives as "### Question\n\nAnswer". */
export function formAnswer(body: string, question: string): string | null {
  const escaped = question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^###\\s+${escaped}\\s*\\n+([^\\n]*)`, 'mi').exec(body);
  return match ? match[1].trim() : null;
}

export const BUILT_QUESTION = 'Is the feature built yet?';

/** Test-first when the ticket carries the label, or the issue form says the feature is not built. */
export function modeOf(ticket: Pick<Ticket, 'labels' | 'body'>): Mode {
  if (ticket.labels.includes(LABELS.testFirst)) return 'test-first';
  return /^no\b/i.test(formAnswer(ticket.body, BUILT_QUESTION) ?? '') ? 'test-first' : 'built';
}

/** The first line of a comment that answers the pipeline's questions. */
export const ANSWER_COMMAND = '/qa-answer';

/** The headings the pipeline puts its questions under: the ones that stopped it, then the skeptic's. */
const QUESTION_HEADINGS = [/questions that block testing/i, /questions a developer would have to guess/i];
const isQuestionHeading = (line: string): boolean => /^#{1,6}\s/.test(line) && QUESTION_HEADINGS.some((h) => h.test(line));

/**
 * The questions the pipeline asked in its latest analysis comment, in the order they are numbered there: the list
 * under "Questions that block testing", then the list under "Questions a developer would have to guess", with the
 * markdown taken off. An item's indented second line (the guess) is not a question. Empty when it never asked.
 */
export function askedQuestions(comments: TicketComment[] = []): string[] {
  const asked = [...comments].reverse().find((c) => c.body.split(/\r?\n/).some(isQuestionHeading));
  if (!asked) return [];
  const questions: string[] = [];
  // Inside a questions section: a line of prose before its list is the summary; one after it ends the section.
  let inSection = false;
  let itemsHere = 0;
  for (const line of asked.body.split(/\r?\n/)) {
    if (isQuestionHeading(line)) {
      inSection = true;
      itemsHere = 0;
      continue;
    }
    if (!inSection) continue;
    if (/^#{1,6}\s/.test(line)) {
      inSection = false;
      continue;
    }
    const item = /^(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      questions.push(item[1].replace(/\*\*/g, '').trim());
      itemsHere += 1;
    } else if (itemsHere && line.trim() && !line.startsWith(' ')) inSection = false;
  }
  return questions;
}

/**
 * The answers: every comment from a trusted author that starts with the command on its own line, in order. A
 * visitor's comment is never read, whatever it starts with, and neither is the pipeline's own.
 */
export function answersFrom(comments: TicketComment[] = []): { author: string; text: string }[] {
  return comments
    .filter((c) => c.trusted)
    .map((c) => ({ author: c.author, body: c.body.replace(/\r\n/g, '\n').trim() }))
    .filter((c) => c.body === ANSWER_COMMAND || c.body.startsWith(`${ANSWER_COMMAND}\n`) || c.body.startsWith(`${ANSWER_COMMAND} `))
    .map((c) => ({ author: c.author, text: c.body.slice(ANSWER_COMMAND.length).trim() }))
    .filter((c) => c.text);
}

/**
 * What the agents get next to the requirement when someone has answered: the questions as they were asked, then
 * the answers with their authors. Undefined when there is nothing to pass on.
 */
export function answersText(ticket: Pick<Ticket, 'comments'>): string | undefined {
  const answers = answersFrom(ticket.comments);
  if (!answers.length) return undefined;
  const questions = askedQuestions(ticket.comments);
  const asked = questions.length ? `The pipeline asked:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\n` : '';
  return `${asked}Answers from the team, in order:\n\n${answers.map((a) => `${a.author}:\n${a.text}`).join('\n\n')}`;
}

export async function intakeTicket(name: SourceName, ref: string): Promise<Request> {
  validateRef(name, ref);
  const ticket = await sourceFor(name).read(ref);
  return Request.parse({
    key: keyFor(name, ticket.ref),
    source: name,
    ref: ticket.ref,
    url: ticket.url,
    title: ticket.title,
    body: ticket.body,
    mode: modeOf(ticket),
    ...(ticket.baseUrl ? { baseUrl: ticket.baseUrl } : {}),
    ...(ticket.base ? { base: ticket.base } : {}),
    ...(answersText(ticket) ? { answers: answersText(ticket) } : {}),
  });
}
