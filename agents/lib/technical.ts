import type { Plan, Technical, TechnicalReview } from './schemas.ts';

/**
 * The deterministic half of the technical review. An agent writes the notes, or the ticket writer already did;
 * either way, every file, test title and ticket they name is checked here before anyone downstream relies on it.
 * Pure functions, so agents/test/ can check them without a repository.
 */

/** What the checks may ask about the repository. `titlesIn` is null when the file is not a spec that exists. */
export type Repo = { fileExists: (file: string) => boolean; titlesIn: (file: string) => string[] | null };

/** Who wrote the notes. The writer's are kept as filed; the reviewer's come from an agent run. */
export type TechnicalBy = 'ticket-writer' | 'technical-reviewer';

/** What the stage saves: the checked notes, who wrote them, and what the checks took out. */
export type TechnicalResult = TechnicalReview & { by: TechnicalBy; dropped: string[] };

const bare = (ref: string): string => ref.trim().replace(/^#/, '');

/** A path an agent gave that stays inside the repository. Anything absolute or with ".." is not looked at. */
export const inRepo = (file: string): boolean => Boolean(file) && !/^([a-zA-Z]:|[\\/])/.test(file) && !file.split(/[\\/]/).includes('..');

/** The titles of the tests and describe blocks in a spec file, read from its source. */
export function specTitles(source: string): string[] {
  // test('title', ...), test.fail('title', ...), test.describe('title', ...). A marker such as
  // test.fail(true, 'reason') starts with a condition, not a string, so it is not taken for a title.
  const call = /\btest(?:\.(?:describe|fail|slow|fixme|skip|only|serial|parallel))*\(\s*(['"`])((?:\\[\s\S]|(?!\1)[^\\])*)\1\s*,/g;
  return [...source.matchAll(call)].map((match) => match[2].replace(/\\([\s\S])/g, '$1'));
}

/** Whether a title names a test in the file. "Describe > title" counts when its last part is a test title. */
export function hasTitle(titles: string[], title: string): boolean {
  const wanted = title.trim().replace(/^["']|["']$/g, '');
  return titles.includes(wanted) || titles.includes(wanted.split(' > ').pop() ?? '');
}

/** "tests/cart.spec.ts: the cart starts empty" split into its file and title. Null for anything else. */
export function parseGuard(guardedBy: string | null): { file: string; title: string } | null {
  const match = /^([\w./-]+\.spec\.ts): (\S.*)$/.exec((guardedBy ?? '').trim());
  return match ? { file: match[1], title: match[2] } : null;
}

/**
 * A risk only counts as guarded if the guard names a spec file that exists and, when the titles can be read, a test
 * that is in it. Anything else, a file that is not there or a sentence instead of a test, is reported as unguarded.
 */
export function guardHolds(guardedBy: string | null, repo: Pick<Repo, 'fileExists'> & Partial<Pick<Repo, 'titlesIn'>>): boolean {
  const guard = parseGuard(guardedBy);
  if (!guard || !inRepo(guard.file) || !repo.fileExists(guard.file)) return false;
  const titles = repo.titlesIn?.(guard.file);
  return titles === undefined || titles === null || hasTitle(titles, guard.title);
}

/** Checks every claim in the notes. Returns what is left, and a line for each thing taken out or corrected. */
export function checkTechnical<T extends Technical>(technical: T, repo: Repo, openRefs: string[]): { technical: T; dropped: string[] } {
  const refs = new Set(openRefs.map(bare));
  const dropped: string[] = [];
  const fileThere = (file: string): boolean => inRepo(file) && repo.fileExists(file);

  const covered = technical.covered.filter((c) => {
    if (!fileThere(c.file)) {
      dropped.push(`Already covered: ${c.file} does not exist.`);
      return false;
    }
    const titles = repo.titlesIn(c.file);
    if (titles && !hasTitle(titles, c.test)) {
      dropped.push(`Already covered: no test called "${c.test}" in ${c.file}.`);
      return false;
    }
    return true;
  });
  const pages = technical.pages.map((p) => {
    if (fileThere(p.file) || !p.exists) return p;
    dropped.push(`Page objects: ${p.file} does not exist, so ${p.member} is marked as to add.`);
    return { ...p, exists: false };
  });
  const touches = technical.touches.map((t) => {
    if (t.guardedBy === null || guardHolds(t.guardedBy, repo)) return t;
    dropped.push(`Nearby behaviour: "${t.guardedBy}" is not a test in the repository, so "${t.area}" is shown as unguarded.`);
    return { ...t, guardedBy: null };
  });
  const related = technical.related.filter((r) => {
    if (refs.has(bare(r.ref))) return true;
    dropped.push(`Related: ${r.ref} is not an open ticket.`);
    return false;
  });
  return { technical: { ...technical, covered, pages, touches, related }, dropped };
}

/**
 * The strategy's nearby behaviour at risk starts from the review's list. The architect's own entries are added
 * after it when they name an area the review did not.
 */
export function mergeRisks(touches: Technical['touches'], risks: Plan['regressionRisks']): Plan['regressionRisks'] {
  const key = (area: string): string => area.trim().toLowerCase().replace(/\s+/g, ' ');
  const seen = new Set(touches.map((t) => key(t.area)));
  return [...touches, ...risks.filter((r) => !seen.has(key(r.area)))];
}

// ── Reading the ticket writer's notes back ───────────────────────────────────

const HEADING = /^###\s+(.*?)\s*$/;

function section(body: string, heading: string): string | null {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => HEADING.exec(line)?.[1].toLowerCase() === heading.toLowerCase());
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => HEADING.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

const cells = (row: string): string[] =>
  row
    .trim()
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

const isRule = (row: string): boolean => /^\|[\s|:-]+\|$/.test(row.trim());

/** The risk line the writer files: "**medium.** Because ...". Null when the section is missing or unreadable. */
export function riskFromTicket(body: string): { risk: 'high' | 'medium' | 'low'; riskReason: string } | null {
  const match = /^\*\*(high|medium|low)\.\*\*\s*(.*)$/is.exec(section(body, 'Risk') ?? '');
  return match ? { risk: match[1].toLowerCase() as 'high' | 'medium' | 'low', riskReason: match[2].trim() || 'Taken from the ticket.' } : null;
}

/**
 * The writer's "Already covered" line is "<file>: <title>. <what it covers>", and a title may itself hold a full
 * stop. When the file's titles are known, the longest title that fits wins; otherwise the first full stop splits it.
 */
function coveredLine(line: string, titlesIn: (file: string) => string[] | null): Technical['covered'][number] | null {
  const match = /^([^\s:]+): (.+)$/.exec(line);
  if (!match) return null;
  const [, file, rest] = match;
  const known = (inRepo(file) ? titlesIn(file) : null) ?? [];
  const title = known.filter((t) => rest === t || rest === `${t}.` || rest.startsWith(`${t}. `)).sort((a, b) => b.length - a.length)[0];
  if (title) return { file, test: title, covers: rest.slice(title.length).replace(/^\.\s*/, '').trim() };
  const stop = rest.indexOf('. ');
  return stop === -1 ? { file, test: rest.replace(/\.$/, ''), covers: '' } : { file, test: rest.slice(0, stop), covers: rest.slice(stop + 2).trim() };
}

/**
 * The technical notes as the ticket writer filed them, read back into the review's shape so they can be checked
 * and kept instead of written again. Null when the ticket has no notes, or nothing in them can be read.
 */
export function technicalFromTicket(body: string, titlesIn: (file: string) => string[] | null = () => null): TechnicalReview | null {
  const text = section(body, 'Technical notes');
  if (text === null || text === '' || text === '_No response_') return null;

  const technical: Technical = { covered: [], pages: [], touches: [], related: [], notes: '' };
  const notes: string[] = [];
  // split with a capture group gives [before, label, text, label, text, ...]
  const parts = text.split(/^\*\*(.+?)\*\*\s*$/m);
  const blocks: [string, string][] = [['', parts[0]]];
  for (let i = 1; i < parts.length; i += 2) blocks.push([parts[i].trim().toLowerCase(), parts[i + 1] ?? '']);

  for (const [label, block] of blocks) {
    const leftover: string[] = [];
    for (const line of block.split(/\r?\n/).map((l) => l.trim())) {
      if (label === 'already covered' && line.startsWith('- ')) {
        const covered = coveredLine(line.slice(2).trim(), titlesIn);
        if (covered) technical.covered.push(covered);
      } else if (label === 'related' && line.startsWith('- ')) {
        const match = /^#?([^\s:]+): (.*)$/.exec(line.slice(2).trim());
        if (match) technical.related.push({ ref: match[1], why: match[2].trim() });
      } else if (label === 'page objects and locators' && line.startsWith('|')) {
        const [file, member, today, note] = cells(line);
        if (!isRule(line) && file !== 'File' && file && member) technical.pages.push({ file, member, exists: today === 'exists', note: note ?? '' });
      } else if (label === 'nearby behaviour' && line.startsWith('|')) {
        const [area, why, guard] = cells(line);
        if (!isRule(line) && area !== 'Could break' && area) technical.touches.push({ area, why: why ?? '', guardedBy: !guard || guard === '**nothing**' ? null : guard });
      } else {
        leftover.push(line);
      }
    }
    const rest = leftover.join('\n').trim();
    if (rest) notes.push(rest);
  }
  technical.notes = notes.join('\n\n');

  const empty = !technical.covered.length && !technical.pages.length && !technical.touches.length && !technical.related.length && !technical.notes;
  if (empty) return null;
  return { ...technical, ...(riskFromTicket(body) ?? { risk: 'medium', riskReason: 'The ticket gives no risk rating.' }) };
}
