/**
 * Turns one assertion of a converted test wrong, so a gate can run it and check that it now fails. A test that
 * still passes with its assertion wrong was not really checking anything.
 *
 * How it is made wrong matters. A web-first assertion waits for its expectation, so giving it a wrong value
 * (`toHaveText('__mutant__')`) makes it wait and fail, which is the proof wanted. Inserting `.not` instead would be
 * satisfied by any moment in which the element is not there yet, and call a sound assertion dead. So: a negated
 * assertion loses its `.not`; one with an argument gets a wrong argument; only one with no argument gets `.not`.
 */

export type Mutation = { mutated: string; line: number; original: string; how: 'wrong value' | 'dropped .not' | 'added .not' };

const TEST_START = /^[ \t]*test(?:\.(?!step\b)\w+)*\s*\(\s*(?=['"`])/gm;
const EXPECT = /(?<![\w.$])expect(?:\.soft|\.poll)?\s*\(/;
const MATCHER = /^(\.not)?\.(\w+)\s*\(/;
/** Matchers whose argument is a count, so the wrong value stays a number. */
const COUNTS = new Set(['toHaveCount', 'toHaveLength']);
const WRONG_COUNT = '987654';
const WRONG_VALUE = "'__mutant__'";

/** Where the test with this title begins and where the next test does, as offsets into the content. */
function testRange(content: string, title: string): { start: number; end: number } | null {
  const heads = [...content.matchAll(TEST_START)];
  for (const quote of ["'", '"', '`']) {
    const literal = quote + title.split(quote).join(`\\${quote}`) + quote;
    const at = heads.findIndex((h) => content.startsWith(literal, h.index + h[0].length));
    if (at >= 0) return { start: heads[at].index, end: heads[at + 1]?.index ?? content.length };
  }
  return null;
}

/** The offset just past the parenthesis that closes the one at `open`, skipping strings. -1 when it never closes. */
function closeParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === '\\') i++;
    } else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

/** The file with the first assertion of the named test made wrong. Null when the test or an expect in it is not found. */
export function mutateExpect(content: string, testTitle: string): Mutation | null {
  const range = testRange(content, testTitle);
  if (!range) return null;
  const body = content.slice(range.start, range.end);
  const hit = EXPECT.exec(body);
  if (!hit) return null;
  const callStart = range.start + hit.index;
  const close = closeParen(content, callStart + hit[0].length - 1);
  if (close < 0 || close > range.end) return null;
  const line = content.slice(0, callStart).split('\n').length;
  const original = content.split(/\r?\n/)[line - 1].trim();
  const matcher = MATCHER.exec(content.slice(close));
  if (!matcher) return null;

  if (matcher[1]) {
    return { mutated: content.slice(0, close) + content.slice(close + 4), line, original, how: 'dropped .not' };
  }
  const argsOpen = close + matcher[0].length - 1;
  const argsClose = closeParen(content, argsOpen);
  if (argsClose < 0 || argsClose > range.end) return null;
  const args = content.slice(argsOpen + 1, argsClose - 1).trim();
  if (args) {
    const wrong = COUNTS.has(matcher[2]) ? WRONG_COUNT : WRONG_VALUE;
    return { mutated: `${content.slice(0, argsOpen + 1)}${wrong}${content.slice(argsClose - 1)}`, line, original, how: 'wrong value' };
  }
  return { mutated: `${content.slice(0, close)}.not${content.slice(close)}`, line, original, how: 'added .not' };
}
