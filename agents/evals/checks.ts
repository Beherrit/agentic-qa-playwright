import { z } from 'zod';
import { VAGUE } from '../lib/draft.ts';
import { Requirements, TechnicalReview, TicketDraft } from '../lib/schemas.ts';
import { hasTitle, type Repo } from '../lib/technical.ts';

/**
 * The evaluation harness: canned inputs for the agent stages, and checks written in code against what each stage
 * answers. A check looks only at the structured output, so the same checks run against a live agent (npm run evals)
 * and against recorded answers (npm run evals -- --dry, and the unit test).
 */

export const Stage = z.enum(['draft', 'requirements', 'technical']);
export type Stage = z.infer<typeof Stage>;

/** The schema each stage answers in. */
export const OUTPUT = { draft: TicketDraft, requirements: Requirements, technical: TechnicalReview } as const;
export type Output = TicketDraft | Requirements | TechnicalReview;

const OpenTicket = z.object({ ref: z.string(), title: z.string(), url: z.string().nullable().default(null) });

/** What a stage is given. A wish for the writer; a ticket for the analyst and the reviewer. */
export const Input = z.object({
  wish: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  /** The technical reviewer reads the analysed requirements as markdown. */
  requirements: z.string().optional(),
  mode: z.enum(['built', 'test-first']).default('built'),
  openTickets: z.array(OpenTicket).default([]),
});
export type Input = z.infer<typeof Input>;

/** A check is named, with its own parameters. Unknown names and wrong parameters fail when the case is read. */
export const Check = z.discriminatedUnion('check', [
  z.object({ check: z.literal('blocking-question') }),
  z.object({ check: z.literal('no-blocking-question') }),
  z.object({ check: z.literal('negative-criterion') }),
  z.object({ check: z.literal('min-criteria'), min: z.number().int().min(1) }),
  z.object({ check: z.literal('no-vague-then') }),
  z.object({ check: z.literal('question-mentions'), any: z.array(z.string()).min(1) }),
  z.object({ check: z.literal('keeps-criteria'), criteria: z.array(z.object({ id: z.string(), kind: z.enum(['happy', 'negative', 'edge']) })).min(1) }),
  z.object({ check: z.literal('built'), value: z.boolean() }),
  z.object({ check: z.literal('duplicate-of'), ref: z.string() }),
  z.object({ check: z.literal('no-duplicate') }),
  z.object({ check: z.literal('covered-tests-exist') }),
  z.object({ check: z.literal('pages-include'), file: z.string() }),
  z.object({ check: z.literal('min-touches'), min: z.number().int().min(1) }),
  z.object({ check: z.literal('related-only-open') }),
]);
export type Check = z.infer<typeof Check>;

/** Which checks make sense for which stage. A case that asks for another is refused when it is read. */
const FOR: Record<Stage, Check['check'][]> = {
  draft: ['blocking-question', 'no-blocking-question', 'negative-criterion', 'min-criteria', 'no-vague-then', 'question-mentions', 'built', 'duplicate-of', 'no-duplicate'],
  requirements: ['blocking-question', 'no-blocking-question', 'negative-criterion', 'min-criteria', 'no-vague-then', 'question-mentions', 'keeps-criteria'],
  technical: ['covered-tests-exist', 'pages-include', 'min-touches', 'related-only-open'],
};

export const Case = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    description: z.string().min(1),
    stage: Stage,
    input: Input,
    checks: z.array(Check).min(1),
  })
  .superRefine((c, ctx) => {
    for (const check of c.checks) {
      if (!FOR[c.stage].includes(check.check)) ctx.addIssue({ code: 'custom', message: `"${check.check}" is not a check for the ${c.stage} stage.` });
    }
    if (c.stage === 'draft' && !c.input.wish) ctx.addIssue({ code: 'custom', message: 'A draft case needs input.wish.' });
    if (c.stage !== 'draft' && (!c.input.title || !c.input.body)) ctx.addIssue({ code: 'custom', message: `A ${c.stage} case needs input.title and input.body.` });
    if (c.stage === 'technical' && !c.input.requirements) ctx.addIssue({ code: 'custom', message: 'A technical case needs input.requirements.' });
  });
export type Case = z.infer<typeof Case>;

export type CheckResult = { check: string; passed: boolean; detail: string };

type Questions = { question: string; blocking: boolean }[];
const questionsOf = (o: Output): Questions => ('questions' in o ? o.questions : 'openQuestions' in o ? o.openQuestions : []);
const criteriaOf = (o: Output): Requirements['criteria'] => ('criteria' in o ? o.criteria : []);
const result = (check: Check, passed: boolean, detail: string): CheckResult => ({ check: check.check, passed, detail });

/** Runs one check against a stage's answer. `repo` answers questions about the files, `open` is the case's tickets. */
export function runCheck(check: Check, output: Output, repo: Repo, open: string[]): CheckResult {
  const criteria = criteriaOf(output);
  const questions = questionsOf(output);
  switch (check.check) {
    case 'blocking-question': {
      const n = questions.filter((q) => q.blocking).length;
      return result(check, n > 0, `${n} blocking question(s)`);
    }
    case 'no-blocking-question': {
      const blocking = questions.filter((q) => q.blocking);
      return result(check, blocking.length === 0, blocking.length ? `blocks on: ${blocking[0].question}` : 'none blocking');
    }
    case 'negative-criterion': {
      const n = criteria.filter((c) => c.kind === 'negative').length;
      return result(check, n > 0, `${n} negative criterion(s)`);
    }
    case 'min-criteria':
      return result(check, criteria.length >= check.min, `${criteria.length} criteria, at least ${check.min} wanted`);
    case 'no-vague-then': {
      const vague = criteria.filter((c) => VAGUE.some((phrase) => c.then.toLowerCase().includes(phrase)));
      return result(check, vague.length === 0, vague.length ? `vague: ${vague.map((c) => c.id).join(', ')}` : 'every Then names an outcome');
    }
    case 'question-mentions': {
      const hit = questions.find((q) => check.any.some((word) => q.question.toLowerCase().includes(word.toLowerCase())));
      return result(check, Boolean(hit), hit ? `asked: ${hit.question}` : `no question mentions ${check.any.join(' or ')}`);
    }
    case 'keeps-criteria': {
      const lost = check.criteria.filter((want) => !criteria.some((c) => c.id === want.id && c.kind === want.kind));
      return result(check, lost.length === 0, lost.length ? `lost or changed: ${lost.map((c) => c.id).join(', ')}` : `kept ${check.criteria.length}`);
    }
    case 'built': {
      const built = 'built' in output ? output.built : undefined;
      return result(check, built === check.value, `built is ${built}, ${check.value} wanted`);
    }
    case 'duplicate-of': {
      const refs = 'duplicates' in output ? output.duplicates.map((d) => d.ref.replace(/^#/, '')) : [];
      return result(check, refs.includes(check.ref.replace(/^#/, '')), `duplicates: ${refs.join(', ') || 'none'}`);
    }
    case 'no-duplicate': {
      const refs = 'duplicates' in output ? output.duplicates.map((d) => d.ref) : [];
      return result(check, refs.length === 0, `duplicates: ${refs.join(', ') || 'none'}`);
    }
    case 'covered-tests-exist': {
      const covered = 'covered' in output ? output.covered : [];
      const made = covered.filter((c) => !repo.fileExists(c.file) || !hasTitle(repo.titlesIn(c.file) ?? [], c.test));
      return result(check, made.length === 0, made.length ? `not in the repository: ${made.map((c) => `${c.file}: ${c.test}`).join('; ')}` : `${covered.length} named, all real`);
    }
    case 'pages-include': {
      const pages = 'pages' in output ? output.pages : [];
      return result(check, pages.some((p) => p.file === check.file), `pages: ${pages.map((p) => p.file).join(', ') || 'none'}`);
    }
    case 'min-touches': {
      const n = 'touches' in output ? output.touches.length : 0;
      return result(check, n >= check.min, `${n} nearby behaviour(s), at least ${check.min} wanted`);
    }
    case 'related-only-open': {
      const refs = new Set(open.map((r) => r.replace(/^#/, '')));
      const related = 'related' in output ? output.related : [];
      const strays = related.filter((r) => !refs.has(r.ref.replace(/^#/, '')));
      return result(check, strays.length === 0, strays.length ? `not open: ${strays.map((r) => r.ref).join(', ')}` : `${related.length} related, all open`);
    }
  }
}

export type CaseResult = { id: string; stage: Stage; checks: CheckResult[]; error?: string };

/** Validates an answer against the stage's schema, then runs every check of the case on it. */
export function evaluate(c: Case, raw: unknown, repo: Repo): CaseResult {
  const parsed = OUTPUT[c.stage].safeParse(raw);
  if (!parsed.success) return { id: c.id, stage: c.stage, checks: [], error: `the answer does not match the ${c.stage} schema: ${z.prettifyError(parsed.error)}` };
  const open = c.input.openTickets.map((t) => t.ref);
  return { id: c.id, stage: c.stage, checks: c.checks.map((check) => runCheck(check, parsed.data, repo, open)) };
}

export const casePassed = (r: CaseResult): boolean => !r.error && r.checks.length > 0 && r.checks.every((c) => c.passed);

/** The pass rate table, in the same shape as the other reports: a verdict, the numbers, then the detail. */
export function evalsMd(results: CaseResult[], mode: 'dry' | 'live'): string {
  const passed = results.filter(casePassed).length;
  const checks = results.flatMap((r) => r.checks);
  const rate = results.length ? Math.round((passed / results.length) * 100) : 0;
  const stages = [...new Set(results.map((r) => r.stage))].map((stage) => {
    const mine = results.filter((r) => r.stage === stage);
    return `| ${stage} | ${mine.filter(casePassed).length} of ${mine.length} |`;
  });
  const rows = results.map((r) => {
    const failed = r.checks.filter((c) => !c.passed);
    const detail = r.error ?? (failed.length ? failed.map((c) => `${c.check}: ${c.detail}`).join('; ') : 'all checks passed');
    return `| ${r.id} | ${r.stage} | ${r.checks.filter((c) => c.passed).length} of ${r.checks.length} | ${casePassed(r) ? 'pass' : '**fail**'} | ${detail.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')} |`;
  });
  return `## Agent evaluations (${mode === 'dry' ? 'recorded answers' : 'live agents'})

**Pass rate: ${rate}%.** ${passed} of ${results.length} cases passed every check.

${checks.filter((c) => c.passed).length} of ${checks.length} checks passed.

| Stage | Cases passed |
|---|---|
${stages.join('\n')}

| Case | Stage | Checks | Verdict | Detail |
|---|---|---|---|---|
${rows.join('\n')}
`;
}
