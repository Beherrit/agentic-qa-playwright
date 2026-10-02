import { Requirements } from './schemas.ts';

/**
 * Reading a ticket the ticket writer filed. Its body is the writer's own format, so the criteria and the technical
 * notes can be taken as they are instead of being worked out again. Anything that does not look like it returns null
 * and goes through the analyst as before.
 */

const HEADING = /^###\s+(.*?)\s*$/;

/** The text under a `### heading` line, up to the next one, trimmed. Null when there is no such heading. */
export function section(body: string, heading: string): string | null {
  const want = heading.trim().toLowerCase();
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => HEADING.exec(line)?.[1].toLowerCase() === want);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => HEADING.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

/** The raw technical notes, for the architect. Null when the ticket has none. */
export function technicalNotes(body: string): string | null {
  return section(body, 'Technical notes');
}

const cells = (row: string): string[] =>
  row
    .trim()
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

/** The items under a bold label such as **Assumptions**, one per `- ` line. */
function labelled(text: string, label: string): string[] {
  const parts = text.split(/^\*\*(.+?)\*\*\s*$/m);
  // split with a capture group gives [before, label, text, label, text, ...]
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i].trim().toLowerCase() !== label.toLowerCase()) continue;
    return parts[i + 1]
      .split(/\r?\n/)
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim());
  }
  return [];
}

/** The requirements as the writer filed them, or null when the body is not in the writer's shape or cannot be read whole. */
export function requirementsFromTicket(title: string, body: string): Requirements | null {
  if (technicalNotes(body) === null) return null;
  const first = section(body, 'What should the user be able to do?');
  if (!first) return null;

  const story = /^As (.+?), I want (.+?), so that (.+?)\.?\s*$/m.exec(first);
  if (!story) return null;

  const criteria = first
    .split(/\r?\n/)
    .filter((line) => /^\|\s*AC-\d+\s*\|/.test(line))
    .map((line) => {
      const [id, kind, given, when, then] = cells(line);
      return { id, kind, given, when, then };
    });

  const known = section(body, 'Anything already known') ?? '';
  const openQuestions = labelled(known, 'Open questions').map((line) => {
    const blocking = /^\(Blocking\)\s+/i.test(line);
    return { question: line.replace(/^\(Blocking\)\s+/i, ''), blocking, why: '' };
  });

  const risk = /^\*\*(high|medium|low)\.\*\*\s*(.*)$/is.exec(section(body, 'Risk') ?? '');

  const parsed = Requirements.safeParse({
    title: title.replace(/^Requirement:\s*/i, '').trim(),
    story: { asA: story[1], iWant: story[2], soThat: story[3] },
    criteria,
    assumptions: labelled(known, 'Assumptions'),
    outOfScope: labelled(known, 'Out of scope'),
    openQuestions,
    risk: risk?.[1].toLowerCase() ?? 'medium',
    riskReason: risk?.[2].trim() || 'Taken from the ticket.',
  });
  return parsed.success ? parsed.data : null;
}
