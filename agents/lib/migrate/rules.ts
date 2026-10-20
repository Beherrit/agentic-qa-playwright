import type { Risk } from './types.ts';

/**
 * Static rules for converted tests: what makes a Playwright test parallel-safe and honest. They run on the text of
 * a file the agent wrote, so a violation is reported with its line and the agent can fix it in the next round.
 */

type Rule = { test: RegExp; message: string };

const LINE_RULES: Rule[] = [
  { test: /\bmode:\s*['"]serial['"]/, message: 'serial mode makes tests depend on each other; keep every test independent' },
  { test: /\b(?:test\.)?describe\.serial\b/, message: 'describe.serial makes tests depend on each other; keep every test independent' },
  { test: /\b(?:test|describe|it)\.(?:describe\.)?only\b/, message: '.only would silently skip the rest of the suite' },
  { test: /\b(?:test|describe|it)\.(?:describe\.)?(?:skip|fixme)\b/, message: 'a skipped or fixme test hides a lost check; convert it or drop it with a reason' },
  { test: /\bwaitForTimeout\s*\(/, message: 'waitForTimeout is a fixed sleep; wait on a locator or an assertion instead' },
  { test: /\.waitForSelector\s*\(/, message: 'waitForSelector is the legacy wait; use a locator and an expect' },
  { test: /(?<![\w$])sleep\s*\(/, message: 'sleep is a fixed wait; wait on a locator or an assertion instead' },
  { test: /\bprocess\.exit\b/, message: 'process.exit would end the whole run from inside one test' },
  { test: /\.goto\(\s*['"`]https?:\/\//, message: 'goto with an absolute URL bypasses baseURL; use a relative path' },
];

const isComment = (line: string): boolean => /^\s*(?:\/\/|\/?\*)/.test(line);

/** Top-level `let` or `var` names that the file also assigns to from inside a function or test. */
function sharedMutables(lines: string[]): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  lines.forEach((text, i) => {
    const decl = /^(?:let|var)\s+(\w+)/.exec(text);
    if (!decl) return;
    const assigned = new RegExp(`^\\s+${decl[1]}\\s*(?:[-+*/]?=)(?!=)`);
    if (lines.some((other, j) => j !== i && assigned.test(other))) out.push({ name: decl[1], line: i + 1 });
  });
  return out;
}

/** Problems with a converted test file, one per hit, each starting with the file and the line. */
export function checkRules(targetFile: string, content: string): string[] {
  const lines = content.split(/\r?\n/);
  const problems: string[] = [];
  lines.forEach((text, i) => {
    if (isComment(text)) return;
    for (const rule of LINE_RULES) if (rule.test.test(text)) problems.push(`${targetFile}:${i + 1}: ${rule.message}`);
  });
  for (const shared of sharedMutables(lines)) {
    problems.push(`${targetFile}:${shared.line}: "${shared.name}" is module-level state assigned inside tests; tests run in parallel, so keep it in the test or a fixture`);
  }
  return problems.sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]));
}

const GUIDANCE: Record<Risk, string> = {
  'shared-driver': 'The old tests share one browser; here each test signs in through a fixture and owns its own session.',
  ordered: 'The old tests run in a set order; here each test sets up its own state and asserts its own outcome, and no test relies on an earlier one.',
  'static-state': 'The old code keeps state in static or global variables; here keep state inside the test or a fixture.',
  sleep: 'The old code sleeps for fixed times; here wait on a locator or an expect instead.',
  'implicit-wait': 'The old code sets an implicit wait; drop it, because locators wait on their own.',
  'retry-loop': 'The old code retries a lookup in a loop; drop the loop, because a locator retries by itself.',
  grid: 'The old suite runs against a Selenium Grid hub; here parallelism comes from workers, and the hub URL has no equivalent.',
};

/** One sentence telling the converter what to do about a risk found in the old suite. */
export const riskGuidance = (risk: Risk): string => GUIDANCE[risk];
