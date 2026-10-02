import { z } from 'zod';
import { KEY } from './keys.ts';

/**
 * The contracts between stages. Each agent has to answer in one of these shapes,
 * and the next stage only ever reads the validated result.
 */

/**
 * built: the feature exists, so tests are written against it and must pass.
 * test-first: the feature is not built yet. Tests are written from the requirement, must fail now for the right
 * reason, and are marked so that they flag themselves the day the feature lands.
 */
export const Mode = z.enum(['built', 'test-first']);
export type Mode = z.infer<typeof Mode>;

export const Request = z.object({
  key: z.string().regex(KEY).describe('Requirement key, e.g. REQ-12 or SHOP-123. Used to tag the tests that come out of it.'),
  source: z.enum(['github', 'jira', 'local']),
  /** The issue number on GitHub, the ticket key on Jira. */
  ref: z.string(),
  url: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  mode: Mode,
});
export type Request = z.infer<typeof Request>;

// ── Stage 1: requirements ────────────────────────────────────────────────────

export const Criterion = z.object({
  id: z.string().regex(/^AC-\d+$/),
  kind: z.enum(['happy', 'negative', 'edge']),
  given: z.string(),
  when: z.string(),
  then: z.string().describe('One observable outcome a test can assert on'),
});

export const Requirements = z.object({
  title: z.string(),
  story: z.object({
    asA: z.string().describe('With its article, e.g. "a shopper"'),
    iWant: z.string().describe('Starts with "to", e.g. "to sort the list by price"'),
    soThat: z.string().describe('Starts with the subject, e.g. "I can find the cheapest item"'),
  }),
  criteria: z.array(Criterion).min(3).max(12),
  assumptions: z.array(z.string()),
  outOfScope: z.array(z.string()),
  openQuestions: z.array(
    z.object({
      question: z.string(),
      blocking: z.boolean().describe('True only if testing cannot sensibly start without the answer'),
      why: z.string(),
    }),
  ),
  risk: z.enum(['high', 'medium', 'low']),
  riskReason: z.string(),
});
export type Requirements = z.infer<typeof Requirements>;

// ── Stage 2: strategy ────────────────────────────────────────────────────────

export const Technique = z.enum([
  'equivalence-partitioning',
  'boundary-values',
  'decision-table',
  'state-transition',
  'use-case',
  'error-guessing',
]);

export const TestCase = z.object({
  id: z.string().regex(/^TC-\d+$/),
  title: z.string(),
  criteria: z.array(z.string().regex(/^AC-\d+$/)).min(1),
  technique: Technique,
  layer: z.enum(['e2e', 'lower-layer', 'manual']),
  layerReason: z.string().describe('Why this layer and not a cheaper one'),
  priority: z.enum(['P1', 'P2', 'P3']),
  persona: z.string(),
  steps: z.array(z.string()).min(1),
  expected: z.string(),
});
export type TestCase = z.infer<typeof TestCase>;

export const Plan = z.object({
  existingCoverage: z.array(z.object({ file: z.string(), test: z.string(), covers: z.string() })),
  siteNotes: z.string().describe('What you saw in the browser that the engineer will need: controls, labels, behaviour'),
  contract: z
    .array(
      z.object({
        element: z.string().describe('What the user sees or uses, e.g. "the sort dropdown"'),
        locator: z.string().describe('How the tests will find it, e.g. getByRole(\'combobox\', { name: \'Sort\' }) or data-test="sort"'),
        exists: z.boolean().describe('True if it is already on the page today'),
      }),
    )
    .describe('Test-first only: what the developers have to build for the tests to find. Empty when the feature exists.'),
  cases: z.array(TestCase).min(1),
});
export type Plan = z.infer<typeof Plan>;

export const Checklist = z.object({
  items: z
    .array(
      z.object({
        id: z.string().regex(/^CK-\d+$/),
        mustCover: z.string(),
        why: z.string(),
        weight: z.enum(['must', 'should']),
      }),
    )
    .min(3),
});
export type Checklist = z.infer<typeof Checklist>;

export const Reconciled = z.object({
  cases: z.array(TestCase).min(1).describe('The final list: the original cases plus any added to close gaps'),
  added: z.array(z.string()).describe('Ids of cases added in this pass'),
  checklist: z.array(
    z.object({
      id: z.string(),
      coveredBy: z.array(z.string()).describe('Test case ids. Empty when not covered.'),
      note: z.string().describe('If not covered, the reason it was left out'),
    }),
  ),
  summary: z.string(),
});
export type Reconciled = z.infer<typeof Reconciled>;

export type Health = { score: number; parts: { name: string; weight: number; value: number; detail: string }[] };
export type Strategy = Omit<Plan, 'cases'> & Reconciled & { checklistItems: Checklist['items']; health: Health };

// ── Stage 3: code generation ─────────────────────────────────────────────────

export const Generation = z.object({
  summary: z.string(),
  files: z.array(z.string()).describe('Repo-relative paths you created or changed'),
  automated: z.array(z.object({ caseId: z.string(), file: z.string(), test: z.string() })),
  notAutomated: z.array(z.object({ caseId: z.string(), reason: z.string() })),
  suspectedBugs: z.array(z.string()).describe('Places where the app does not do what the criteria say'),
});
export type Generation = z.infer<typeof Generation>;

// ── Stage 4: code review ─────────────────────────────────────────────────────

export const Review = z.object({
  verdict: z.enum(['approve', 'request-changes']),
  summary: z.string(),
  findings: z.array(
    z.object({
      severity: z.enum(['blocker', 'major', 'minor', 'nit']),
      file: z.string(),
      line: z.number().nullable(),
      issue: z.string(),
      suggestion: z.string(),
    }),
  ),
  criteria: z.array(
    z.object({
      id: z.string(),
      verified: z.boolean().describe('True if a test would fail were this criterion broken'),
      comment: z.string(),
    }),
  ),
});
export type Review = z.infer<typeof Review>;

// ── Regression triage ────────────────────────────────────────────────────────

export const Triage = z.object({
  summary: z.string(),
  failures: z.array(
    z.object({
      test: z.string(),
      file: z.string(),
      verdict: z.enum(['product-bug', 'test-defect', 'flaky', 'environment']),
      confidence: z.enum(['high', 'medium', 'low']),
      evidence: z.string(),
      nextStep: z.string(),
    }),
  ),
  bugs: z.array(
    z.object({
      title: z.string(),
      severity: z.enum(['critical', 'major', 'minor']),
      steps: z.array(z.string()),
      expected: z.string(),
      actual: z.string(),
      tests: z.array(z.string()).describe('Titles of the failing tests this bug explains'),
    }),
  ),
});
export type Triage = z.infer<typeof Triage>;
