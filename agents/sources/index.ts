import { keyFor, validateRef, type SourceName } from '../lib/keys.ts';
import { LABELS } from '../lib/paths.ts';
import { Request, type Mode } from '../lib/schemas.ts';
import { github } from './github.ts';
import { jira } from './jira.ts';
import type { Source, Ticket } from './types.ts';

/** Prints instead of posting. Used for runs on your own machine from --text or --file. */
const local: Source = {
  async read() {
    throw new Error('A local requirement comes from --text or --file, not from a tracker.');
  },
  async comment(_ref, markdown) {
    console.log(`\n${markdown}`);
  },
  async label() {},
};

const sources: Record<SourceName, Source> = { github, jira, local };

export function sourceFor(name: string): Source {
  if (!(name in sources)) throw new Error(`Unknown source "${name}". Use github or jira.`);
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
  });
}
