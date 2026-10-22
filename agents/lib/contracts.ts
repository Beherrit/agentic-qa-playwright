import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Conversion, Settings } from './migrate/schemas.ts';
import { PerfAnalysis } from './perf/analyst.ts';
import { ROLE_POLICY } from './policy.ts';
import * as S from './schemas.ts';
import { ROLE_TIERS } from './tiers.ts';

/**
 * The contract of every role, generated from the code: its tier, what it may use, what the lead hands it, the
 * answer it owes and where that answer goes. docs/CONTRACTS.md is this file's output; agents/test/rules.test.ts fails
 * when the two differ, so the page cannot drift from the code. To write it again:
 *
 *   node agents/lib/contracts.ts --write
 */

const { Plan, Reconciled } = S.strategySchemas(['<layer id>']);

/** Each role's answer schema, by the name the prompts and the cards use. */
export const ROLE_ANSWERS: Record<string, { name: string; schema: z.ZodType }> = {
  'request-screener': { name: 'Screening', schema: S.Screening },
  skeptic: { name: 'Skepticism', schema: S.Skepticism },
  'requirements-analyst': { name: 'Requirements', schema: S.Requirements },
  'technical-reviewer': { name: 'TechnicalReview', schema: S.TechnicalReview },
  'test-architect': { name: 'Plan', schema: Plan },
  'plan-critic': { name: 'Checklist', schema: S.Checklist },
  'plan-reconciler': { name: 'Reconciled', schema: Reconciled },
  'automation-engineer': { name: 'Generation', schema: S.Generation },
  saboteur: { name: 'Sabotage', schema: S.Sabotage },
  'code-reviewer': { name: 'Review', schema: S.Review },
  'failure-triager': { name: 'Triage', schema: S.Triage },
  'test-healer': { name: 'Healing', schema: S.Healing },
  'suite-surveyor': { name: 'Survey', schema: S.Survey },
  'ticket-writer': { name: 'TicketDraft', schema: S.TicketDraft },
  'performance-analyst': { name: 'PerfAnalysis', schema: PerfAnalysis },
  'settings-migrator': { name: 'Settings', schema: Settings },
  'test-migrator': { name: 'Conversion', schema: Conversion },
};

/** The order the roles appear in: the analysis, the tests, regression, then the tools around them. */
const ORDER = [
  'request-screener',
  'skeptic',
  'requirements-analyst',
  'technical-reviewer',
  'test-architect',
  'plan-critic',
  'plan-reconciler',
  'automation-engineer',
  'saboteur',
  'code-reviewer',
  'failure-triager',
  'test-healer',
  'ticket-writer',
  'suite-surveyor',
  'performance-analyst',
  'settings-migrator',
  'test-migrator',
];

/** The top-level fields of an answer, with whether each is a list, and its description when it has one. */
function fieldsOf(schema: z.ZodType): string[] {
  if (!(schema instanceof z.ZodObject)) return [];
  return Object.entries(schema.shape as Record<string, z.ZodType>).map(([key, field]) => {
    let inner: z.ZodType = field;
    while (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable || inner instanceof z.ZodDefault) inner = inner.unwrap() as z.ZodType;
    const kind = inner instanceof z.ZodArray ? ' (list)' : inner instanceof z.ZodObject ? ' (object)' : '';
    const optional = field.safeParse(undefined).success ? ', optional' : '';
    const description = field.description ?? inner.description;
    return `\`${key}\`${kind}${optional}${description ? `: ${description.replace(/\s+/g, ' ')}` : ''}`;
  });
}

/** The page. */
export function contractsMd(): string {
  const roles = [...ORDER, ...Object.keys(ROLE_POLICY).filter((role) => !ORDER.includes(role))];
  const sections = roles.map((role) => {
    const policy = ROLE_POLICY[role];
    const answer = ROLE_ANSWERS[role];
    const can = [
      policy.access === 'write' ? 'reads the repository, edits inside `writable`, runs the suite commands' : 'reads the repository',
      policy.browser ? `browser at the ${policy.browser} level` : 'no browser',
      policy.otherRepos ? 'reads other checkouts' : null,
      `at most ${policy.maxTurns} turns`,
    ].filter(Boolean);
    return `## ${role}

| | |
|---|---|
| Tier | ${ROLE_TIERS[role] ?? 'research'} |
| May | ${can.join('; ')} |
| Is handed | ${policy.reads.join(', ')} |
| Answers in | \`${answer?.name ?? '?'}\`, plus the handoff |
| Feeds | ${policy.feeds.join('; ')} |

${answer ? fieldsOf(answer.schema).map((f) => `- ${f}`).join('\n') : ''}`;
  });
  return `# Agent contracts

Generated from \`agents/lib/policy.ts\`, \`agents/lib/tiers.ts\` and the answer schemas by
\`node agents/lib/contracts.ts --write\`. Do not edit by hand: the rules test fails when this page and the code
differ. docs/AGENT-RULES.md explains the tiers, the handoff and the guardrails.

Every answer also carries a \`handoff\` (summary, decisions, escalations, confidence), which the lead takes off
before the next stage reads the answer. "May" is the most a stage can grant the role; \`runAgent\` refuses a call
that asks for more.

${sections.join('\n\n')}
`;
}

const CONTRACTS_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/CONTRACTS.md');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    fs.writeFileSync(CONTRACTS_FILE, contractsMd());
    console.log(`wrote ${path.relative(process.cwd(), CONTRACTS_FILE)}`);
  } else {
    process.stdout.write(contractsMd());
  }
}
