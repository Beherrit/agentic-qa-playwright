import { createHash } from 'node:crypto';

/**
 * The clean room: this project is original work, and nothing in it may come from another company's project. A short
 * list of names that must never appear is checked by agents/test/rules.test.ts over every tracked file, and by the
 * Claude Code hook in .claude/hooks/ before any edit lands. The names are kept as hashes, so the list itself does not
 * put them in the repository.
 *
 * A word matches on its own or run together with the next one ("Two Words", "two-words" and "TwoWords" are the same
 * name), case and punctuation aside. To add a name: `printf %s 'name' | sha256sum`, lower case with no spaces, and
 * keep the first 16 characters.
 */
const BLOCKED = new Set(['ee636fc7f6742741', '53d9202177bbb644', '77ae26d2b19eda21']);

const digest = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** The words of a text, lower case, split on anything that is not a letter or a digit. */
const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** How many blocked names a text contains, counting each place once. Zero is clean. */
export function blockedNames(text: string): number {
  const list = words(text);
  let found = 0;
  for (let i = 0; i < list.length; i++) {
    if (BLOCKED.has(digest(list[i]))) found += 1;
    else if (i + 1 < list.length && BLOCKED.has(digest(list[i] + list[i + 1]))) found += 1;
  }
  return found;
}

/** The text an edit would write, from a Claude Code tool call's input: Write, Edit and MultiEdit. */
export function textOfEdit(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const i = input as { content?: unknown; new_string?: unknown; file_path?: unknown; edits?: { new_string?: unknown }[] };
  const parts = [i.file_path, i.content, i.new_string, ...(Array.isArray(i.edits) ? i.edits.map((e) => e?.new_string) : [])];
  return parts.filter((p): p is string => typeof p === 'string').join('\n');
}
