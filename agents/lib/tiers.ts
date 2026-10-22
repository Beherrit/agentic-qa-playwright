import { z } from 'zod';

/**
 * Model tiers: every agent role runs on the tier its job needs, not on whatever model happens to be configured.
 *
 *   decide    the calls that settle something: the final plan, whether the tests may ship, bug or test defect.
 *             Few turns, and the most judgement per token. Fable.
 *   build     the work: plans, test code, faults, repairs, migrations. Many turns with tools. Opus.
 *   research  reading and reporting: the requirement, the code around it, the suite, a performance report.
 *             Wide and careful, not deep. Sonnet.
 *   read      bulk reading where a cheap pass is enough. Haiku.
 *
 * Every tier has a fallback, used when its model is overloaded or the account cannot use it, so a run on an account
 * without the top model still finishes, and the report says it fell back. docs/AGENT-RULES.md has the reasoning.
 * Pure: the configuration is passed in.
 */

export const Tier = z.enum(['decide', 'build', 'research', 'read']);
export type Tier = z.infer<typeof Tier>;

export const TierModel = z.object({
  model: z.string().min(1),
  /** Tried when the model is overloaded or not available to this account. Empty for none. */
  fallback: z.string().default(''),
});
export type TierModel = z.infer<typeof TierModel>;

/** What each tier runs on unless qa.config.json says otherwise. */
export const DEFAULT_TIER_MODELS: Record<Tier, TierModel> = {
  decide: { model: 'claude-fable-5-1', fallback: 'claude-opus-5-5' },
  build: { model: 'claude-opus-5-5', fallback: 'claude-sonnet-5-5' },
  research: { model: 'claude-sonnet-5-5', fallback: 'claude-haiku-5-5' },
  read: { model: 'claude-haiku-5-5', fallback: 'claude-sonnet-5-5' },
};

/** `tiers` in qa.config.json: any tier may be given a different model. */
export const TiersSchema = z
  .object({ decide: TierModel.optional(), build: TierModel.optional(), research: TierModel.optional(), read: TierModel.optional() })
  .default({});
export type TiersConfig = z.infer<typeof TiersSchema>;

/** One line per tier: what it is for. Shown in the doctor, the report and the docs. */
export const TIER_PURPOSE: Record<Tier, string> = {
  decide: 'settles something: the final plan, whether tests ship, bug or test defect',
  build: 'does the work: plans, test code, faults, repairs',
  research: 'reads and reports: requirements, code, suites, measurements',
  read: 'bulk reading where a cheap pass is enough',
};

/**
 * The tier of every agent role. A new role must be added here: agents/test/rules.test.ts fails for a prompt without
 * one, so no agent quietly runs on a default.
 */
export const ROLE_TIERS: Record<string, Tier> = {
  // decide
  'plan-reconciler': 'decide',
  'code-reviewer': 'decide',
  'failure-triager': 'decide',
  // build
  'test-architect': 'build',
  'plan-critic': 'build',
  'automation-engineer': 'build',
  saboteur: 'build',
  'test-healer': 'build',
  'test-migrator': 'build',
  'settings-migrator': 'build',
  'ticket-writer': 'build',
  // research
  'request-screener': 'research',
  'requirements-analyst': 'research',
  skeptic: 'research',
  'technical-reviewer': 'research',
  'suite-surveyor': 'research',
  'performance-analyst': 'research',
};

/** A role nobody listed runs as research: careful enough, never the most expensive. */
export const tierOf = (role: string): Tier => ROLE_TIERS[role] ?? 'research';

/** Where a role's model came from, for the report: a person's override always says so. */
export type ModelSource = 'role' | 'all-roles' | 'QA_AGENT_MODEL' | 'tier';

export type ResolvedModel = { tier: Tier; model: string; fallback: string; source: ModelSource };

/**
 * The model a role runs on. A person's choice wins over the tier, most specific first:
 *   1. `models["<role>"]` in qa.config.json
 *   2. `models["*"]`, every role (a proof of concept puts haiku here)
 *   3. the repository variable QA_AGENT_MODEL, every role
 *   4. the role's tier, from `tiers` in qa.config.json or the defaults above
 * An override keeps its tier's fallback, unless the fallback is the override itself.
 */
export function resolveModel(
  role: string,
  settings: { models?: Record<string, string>; tiers?: TiersConfig } = {},
  env: NodeJS.ProcessEnv = process.env,
): ResolvedModel {
  const tier = tierOf(role);
  const own = { ...DEFAULT_TIER_MODELS[tier], ...(settings.tiers?.[tier] ?? {}) };
  const models = settings.models ?? {};
  const override: [string | undefined, ModelSource][] = [
    [models[role], 'role'],
    [models['*'], 'all-roles'],
    [env.QA_AGENT_MODEL, 'QA_AGENT_MODEL'],
  ];
  for (const [model, source] of override) {
    if (model) return { tier, model, fallback: own.fallback === model ? '' : own.fallback, source };
  }
  return { tier, model: own.model, fallback: own.fallback, source: 'tier' };
}

/**
 * Whether an agent's failure was the model itself being out of reach (overloaded, unknown, not on this plan), so the
 * same task can go to the fallback. A task that failed for any other reason is not run again on a cheaper model.
 */
export function isModelUnavailable(text: string): boolean {
  return [
    /\boverloaded/i,
    /\bnot_found_error\b/i,
    /\b(invalid|unknown|unsupported) model\b/i,
    /\bmodel[_ ]not[_ ]found\b/i,
    /\bissue with the selected model\b/i,
    /\bmodel\b[^.]*\b(is not (available|supported)|(does|may) not exist)\b/i,
    /\b(do|does|may) not have access to (the |this )?model\b/i,
    /\bnot available (on|for) your (plan|account|organization)\b/i,
  ].some((pattern) => pattern.test(text));
}
