import type { BrowserAccess } from './agent.ts';

/**
 * What each role is allowed, in one place: the most a stage may grant it. runAgent refuses a call that asks for more
 * (write access for a reading role, a stronger browser, more turns, other repositories), so a mistake in a stage, or
 * a new stage written in a hurry, cannot quietly widen what an agent can do. A stage may always ask for less.
 *
 * `reads` and `feeds` are the role's place in the run: what the lead hands it, and who uses its answer. They are
 * documentation that the contracts page (docs/CONTRACTS.md) is generated from, and the persona cards say the same.
 */
export type RolePolicy = {
  access: 'read' | 'write';
  /** The strongest browser level a stage may give it, or null for none. */
  browser: BrowserAccess | null;
  /** The most turns a stage may give it. */
  maxTurns: number;
  /**
   * May be given other checkouts to read (`readDirs`): the architect, for the other test layers. A migration names the
   * old project's files in its task by absolute path instead.
   */
  otherRepos: boolean;
  /** What the lead hands it. */
  reads: string[];
  /** Where its answer goes, in the run folder and beyond. */
  feeds: string[];
};

const LEVELS: (BrowserAccess | null)[] = [null, 'look', 'test', 'break'];

export const ROLE_POLICY: Record<string, RolePolicy> = {
  'request-screener': {
    access: 'read',
    browser: null,
    maxTurns: 6,
    otherRepos: false,
    reads: ['request.json', 'context.json'],
    feeds: ['screening.json: the lead stops the run, asks on the ticket, or goes on'],
  },
  skeptic: {
    access: 'read',
    browser: null,
    maxTurns: 8,
    otherRepos: false,
    reads: ['request.json', 'the product brief', "the team's answers"],
    feeds: ['skeptic.json: requirements-analyst'],
  },
  'requirements-analyst': {
    access: 'read',
    browser: null,
    maxTurns: 20,
    otherRepos: false,
    reads: ['request.json', 'skeptic.json', 'context.json', "the team's answers", 'the product brief'],
    feeds: ['requirements.json: technical-reviewer, test-architect, plan-critic, the ticket'],
  },
  'technical-reviewer': {
    access: 'read',
    browser: 'look',
    maxTurns: 40,
    otherRepos: false,
    reads: ['requirements.json', 'open-tickets.json', 'the product brief'],
    feeds: ['technical.json: test-architect, automation-engineer, the ticket'],
  },
  'test-architect': {
    access: 'read',
    browser: 'look',
    maxTurns: 60,
    otherRepos: true,
    reads: ['requirements.json', 'technical.json', 'context.json', 'the layers', 'docs/test-design.md'],
    feeds: ['plan.json: plan-reconciler'],
  },
  'plan-critic': {
    access: 'read',
    browser: null,
    maxTurns: 15,
    otherRepos: false,
    reads: ['requirements.json', 'the product brief', 'docs/test-design.md'],
    feeds: ['checklist.json: plan-reconciler'],
  },
  'plan-reconciler': {
    access: 'read',
    browser: null,
    maxTurns: 10,
    otherRepos: false,
    reads: ['plan.json', 'checklist.json', 'requirements.json', 'the layers'],
    feeds: ['strategy.json: automation-engineer, the per-layer tasks, the ticket'],
  },
  'automation-engineer': {
    access: 'write',
    browser: 'test',
    maxTurns: 80,
    otherRepos: false,
    reads: ['strategy.json', 'technical.json', 'the test conventions', 'gates.md in a fix round'],
    feeds: ['generation.json and the test files: the gates, saboteur, code-reviewer'],
  },
  saboteur: {
    access: 'read',
    browser: 'break',
    maxTurns: 40,
    otherRepos: false,
    reads: ['requirements.json', 'the site notes', 'the diff of the new tests'],
    feeds: ['sabotage.json: the sabotage gate'],
  },
  'code-reviewer': {
    access: 'read',
    browser: null,
    maxTurns: 30,
    otherRepos: false,
    reads: ['the diff', 'strategy.json', 'gates.md', 'the test conventions'],
    feeds: ['review.json: the lead opens the pull request ready or as a draft, or sends the tests back'],
  },
  'failure-triager': {
    access: 'read',
    browser: null,
    maxTurns: 50,
    otherRepos: false,
    reads: ['the failed tests', 'test-results/'],
    feeds: ['triage.json: test-healer, the bug reports'],
  },
  'test-healer': {
    access: 'write',
    browser: 'test',
    maxTurns: 60,
    otherRepos: false,
    reads: ['triage.json', 'test-results/', 'the test conventions'],
    feeds: ['heal.json and the repaired tests: the heal gates, the repair pull request'],
  },
  'suite-surveyor': {
    access: 'read',
    browser: null,
    maxTurns: 40,
    otherRepos: false,
    reads: ['the project: package.json, the Playwright config, the test folders'],
    feeds: ['survey.json: the proposed qa.config.json, brief and conventions, for a person to review'],
  },
  'ticket-writer': {
    access: 'read',
    browser: 'look',
    maxTurns: 40,
    otherRepos: false,
    reads: ['the wish', 'open-tickets.json', 'the product brief'],
    feeds: ['draft.json: a person reads it before it is filed'],
  },
  'performance-analyst': {
    access: 'read',
    browser: null,
    maxTurns: 25,
    otherRepos: false,
    reads: ['the failing pages', 'the Lighthouse reports', 'the commits since the last run'],
    feeds: ['the performance report'],
  },
  'settings-migrator': {
    access: 'read',
    browser: null,
    maxTurns: 25,
    otherRepos: false,
    reads: ["the old project's configuration"],
    feeds: ['the new Playwright config, written by code'],
  },
  'test-migrator': {
    access: 'write',
    browser: 'test',
    maxTurns: 80,
    otherRepos: false,
    reads: ["the wave's old files", 'the test conventions'],
    feeds: ['the new specs and the mapping: the migration gates'],
  },
};

/** A role without a policy gets the least: read only, no browser, no other repositories. */
export const DEFAULT_POLICY: RolePolicy = { access: 'read', browser: null, maxTurns: 40, otherRepos: false, reads: [], feeds: [] };

export const policyOf = (role: string): RolePolicy => ROLE_POLICY[role] ?? DEFAULT_POLICY;

/**
 * What a call asks for beyond the role's policy, one line each; empty when it is within it. runAgent throws on any
 * line here before the agent starts.
 */
export function beyondPolicy(
  role: string,
  asked: { access: 'read' | 'write'; browser: BrowserAccess | null; maxTurns?: number; readDirs?: string[] },
  policy: RolePolicy = policyOf(role),
): string[] {
  const over: string[] = [];
  if (asked.access === 'write' && policy.access === 'read') over.push('write access');
  if (LEVELS.indexOf(asked.browser) > LEVELS.indexOf(policy.browser)) over.push(`the ${asked.browser} browser (at most ${policy.browser ?? 'none'})`);
  if ((asked.maxTurns ?? policy.maxTurns) > policy.maxTurns) over.push(`${asked.maxTurns} turns (at most ${policy.maxTurns})`);
  if (asked.readDirs?.length && !policy.otherRepos) over.push('other repositories');
  return over;
}
