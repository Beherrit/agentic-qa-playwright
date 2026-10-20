import {
  ASSERTION_PATTERNS,
  FIND_ELEMENT,
  IMPORT_PATTERNS,
  LOGIN_WORDS,
  LOOP_START,
  METHOD_PATTERNS,
  RISK_RULES,
  SLEEP_PATTERNS,
  STATIC_FIELD,
  STATIC_STATE_FILES,
  TEST_PATTERNS,
  type RiskRule,
} from './patterns.ts';
import { RISKS, type Language, type Risk, type SourceTest } from './types.ts';

/**
 * Reading one file: its tests, how many assertions each holds, what it imports, which assertion helpers it defines
 * and which risks it shows. Everything is line based, which is crude but predictable; the parity gate later checks
 * the agents' claims against these counts, so a miss here shows up as a loud mismatch and not as a silent drop.
 */

const METHOD_LOOKAHEAD = 6;
const RETRY_WINDOW = 6;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How many lines of a block hold an assertion. A line that matches two patterns still counts once. A line that calls
 * one of the `helpers` (functions the project wrote that assert) counts too.
 */
export function countAssertions(language: Language, block: string, helpers: string[] = []): number {
  const patterns = [...ASSERTION_PATTERNS[language]];
  if (helpers.length) patterns.push(new RegExp(`(?<!\\bdef\\s)\\b(?:${helpers.map(escapeRegExp).join('|')})\\s*\\(`));
  return block.split(/\r?\n/).filter((line) => patterns.some((pattern) => pattern.test(line))).length;
}

type Start = { name: string; index: number };

/** Where each test begins. For java and csharp the name is on the method line after the annotation. */
function testStarts(language: Language, lines: string[]): Start[] {
  const marker = TEST_PATTERNS[language];
  const method = METHOD_PATTERNS[language];
  const starts: Start[] = [];
  for (let i = 0; i < lines.length; i++) {
    const hit = marker.exec(lines[i]);
    if (!hit) continue;
    if (!method) {
      starts.push({ name: hit[2] ?? hit[1], index: i });
      continue;
    }
    for (let j = i; j < Math.min(lines.length, i + METHOD_LOOKAHEAD); j++) {
      const found = method.exec(lines[j]);
      if (found) {
        starts.push({ name: found[1], index: j });
        i = j;
        break;
      }
    }
  }
  return starts;
}

/** Each test with its line (1-based) and the assertions between it and the next test, or the end of the file. */
export function extractTests(language: Language, content: string, helpers: string[] = []): SourceTest[] {
  const lines = content.split(/\r?\n/);
  const starts = testStarts(language, lines);
  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : lines.length;
    return { name: start.name, line: start.index + 1, assertions: countAssertions(language, lines.slice(start.index, end).join('\n'), helpers) };
  });
}

function pythonImports(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const from = /^\s*from\s+(\.*[\w.]*)\s+import\b/.exec(line);
    if (from) {
      out.push(from[1]);
      continue;
    }
    const plain = /^\s*import\s+(.+?)\s*(?:#.*)?$/.exec(line);
    if (plain) for (const part of plain[1].split(',')) out.push(part.trim().split(/\s+as\s+/)[0]);
  }
  return out;
}

/** Module names or relative paths exactly as the file wrote them, once each, in order of first use. */
export function extractImports(language: Language, content: string): string[] {
  const found: string[] = [];
  if (language === 'python') found.push(...pythonImports(content));
  else {
    const patterns = IMPORT_PATTERNS[language] ?? [];
    for (const line of content.split(/\r?\n/)) {
      for (const pattern of patterns) {
        const hit = pattern.exec(line);
        if (hit) found.push(hit[1]);
      }
    }
  }
  return [...new Set(found.filter(Boolean))];
}

/** Whether a name or a body talks about logging in. */
export const mentionsLogin = (text: string): boolean => LOGIN_WORDS.test(text);

const NOT_A_METHOD = new Set(['if', 'for', 'foreach', 'while', 'switch', 'catch', 'using', 'lock', 'return', 'new', 'else', 'throw', 'await', 'function', 'fixed', 'synchronized']);
const MODIFIERS = '(?:(?:public|private|protected|internal|static|final|abstract|virtual|override|async|synchronized|sealed|new)\\s+)*';
const TYPED_METHOD = new RegExp(`^\\s*${MODIFIERS}[\\w.?]+(?:<[^>()]*>)?(?:\\[\\])?\\s+(\\w+)\\s*\\([^;]*$`);
const ARROW_OR_FUNCTION =
  /\bfunction\s*\*?\s+(\w+)\s*\(|\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function\b|(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>)|^\s*(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>[\]|. ]+)?\s*\{\s*$/;

/** The name a line defines, or null. Python and ruby use `def`; the brace languages use signatures. */
function definedName(language: Language, line: string): string | null {
  if (language === 'python') return /^\s*(?:async\s+)?def\s+(\w+)\s*\(/.exec(line)?.[1] ?? null;
  if (language === 'ruby') return /^\s*def\s+(?:self\.)?(\w+[?!]?)/.exec(line)?.[1] ?? null;
  if (language === 'java' || language === 'csharp') return TYPED_METHOD.exec(line)?.[1] ?? null;
  if (language === 'javascript' || language === 'typescript') {
    const hit = ARROW_OR_FUNCTION.exec(line);
    return hit ? (hit[1] ?? hit[2] ?? hit[3]) : null;
  }
  return null;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** The lines under a `def`, up to the next line that is no deeper than it. */
function indentedBody(lines: string[], at: number): string {
  const out: string[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].trim() && indentOf(lines[i]) <= indentOf(lines[at])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

/** The text between the first `{` at or after `from` and its closing brace; empty when a `;` comes first. */
function braceBody(text: string, from: number): string {
  let i = from;
  while (i < text.length && text[i] !== '{' && text[i] !== ';') i++;
  if (text[i] !== '{') return '';
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return text.slice(i, j);
  }
  return text.slice(i);
}

/** Where the first parameter list on a line ends; the end of the line when it carries on to the next one. */
function endOfParameters(line: string): number {
  let depth = 0;
  for (let i = line.indexOf('('); i >= 0 && i < line.length; i++) {
    if (line[i] === '(') depth++;
    else if (line[i] === ')' && --depth === 0) return i + 1;
  }
  return line.length;
}

/** The body of the function a line opens: braces after the signature, or the expression after an arrow. */
function bracedBody(text: string, lineStart: number, line: string): string {
  const arrow = line.indexOf('=>');
  if (arrow < 0) return braceBody(text, lineStart + endOfParameters(line));
  const after = text.slice(lineStart + arrow + 2);
  return /^\s*\{/.test(after) ? braceBody(after, 0) : after.split(';')[0];
}

/**
 * Names of the functions and methods in a util or page file whose body asserts. A test that calls one of them makes
 * those assertions, so the count for the test includes the call.
 */
export function findAssertionHelpers(language: Language, content: string): string[] {
  const text = content.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const indentBased = language === 'python' || language === 'ruby';
  const names = new Set<string>();
  let offset = 0;
  lines.forEach((line, i) => {
    const name = definedName(language, line);
    if (name && !NOT_A_METHOD.has(name) && !name.startsWith('__')) {
      const body = indentBased ? indentedBody(lines, i) : bracedBody(text, offset, line);
      if (countAssertions(language, body) > 0) names.add(name);
    }
    offset += line.length + 1;
  });
  return [...names];
}

function ruleHits(rule: RiskRule, content: string): boolean {
  if (rule.also && !rule.also.test(content)) return false;
  const matches = content.match(new RegExp(rule.test.source, `${rule.test.flags.replace('g', '')}g`));
  return (matches?.length ?? 0) >= (rule.min ?? 1);
}

/** A loop that sleeps and looks an element up within a few lines: a hand-rolled retry. */
function hasRetryLoop(language: Language, lines: string[]): boolean {
  const sleep = SLEEP_PATTERNS[language];
  if (!sleep) return false;
  return lines.some((line, i) => {
    if (!LOOP_START.test(line)) return false;
    const window = lines.slice(i, i + RETRY_WINDOW + 1).join('\n');
    return sleep.test(window) && FIND_ELEMENT.test(window);
  });
}

/** A static non-final field that some method assigns, in a test or page file. */
function hasStaticState(language: Language, lines: string[], filePath: string): boolean {
  if ((language !== 'java' && language !== 'csharp') || !STATIC_STATE_FILES.test(filePath)) return false;
  return lines.some((line) => {
    const name = STATIC_FIELD.exec(line)?.[1];
    if (!name) return false;
    const assigned = new RegExp(`^\\s*(?:\\w+\\.)?${name}\\s*(?:[-+*/]?=(?!=)|\\+\\+|--)`);
    return lines.some((other) => assigned.test(other));
  });
}

/**
 * The risks a file shows, in the order of `RISKS`, once each. `filePath` matters for configuration (a TestNG file that
 * preserves order) and for telling test and page files from the rest.
 */
export function detectRisks(language: Language, content: string, filePath: string): Risk[] {
  const found = new Set<Risk>();
  for (const rule of [...(RISK_RULES.any ?? []), ...(RISK_RULES[language] ?? [])]) if (ruleHits(rule, content)) found.add(rule.risk);
  if (/\.xml$/i.test(filePath) && /preserve-order\s*=\s*["']true["']/.test(content)) found.add('ordered');
  if (SLEEP_PATTERNS[language]?.test(content)) found.add('sleep');
  const lines = content.split(/\r?\n/);
  if (hasRetryLoop(language, lines)) found.add('retry-loop');
  if (hasStaticState(language, lines, filePath)) found.add('static-state');
  return RISKS.filter((risk) => found.has(risk));
}
