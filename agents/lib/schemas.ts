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
  source: z.enum(['github', 'jira', 'pr', 'azure', 'linear', 'local']),
  /** The issue number on GitHub, the ticket key on Jira, the pull request number for a change. */
  ref: z.string(),
  url: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  mode: Mode,
  /** Where the build under test answers, when it is not the configured app: a pull request's preview. */
  baseUrl: z.string().optional(),
  /** The branch the generated tests are opened against. The default branch when absent; a pull request's own branch otherwise. */
  base: z.string().optional(),
  /** The pipeline's questions and the team's answers from the ticket's comments, when there are any. Data for the agents. */
  answers: z.string().optional(),
});
export type Request = z.infer<typeof Request>;

// ── Setting up: the suite surveyor ───────────────────────────────────────────

export const Survey = z.object({
  app: z.object({
    name: z.string().describe('The product, as the README or the tests call it'),
    baseUrl: z.string().describe('Where the app answers for tests, from the Playwright config or an environment variable. Empty when unknown'),
  }),
  layout: z.object({
    specGlob: z.string().describe('A glob matching the spec files, e.g. tests/**/*.spec.ts'),
    testImport: z.string().describe('The file specs import test and expect from, relative to the project root, or @playwright/test'),
    writable: z.array(z.string()).describe('The folders generated tests, page objects and fixtures go in, each ending with /'),
  }),
  commands: z.object({
    test: z.string().describe('Runs the Playwright suite, e.g. npx playwright test'),
    typecheck: z.string(),
    lint: z.string(),
  }),
  personas: z.object({
    envVar: z.string().describe('The environment variable that chooses the account tests sign in as, or QA_PERSONA when there is none'),
    default: z.string(),
    list: z.array(z.string()),
  }),
  auth: z.object({
    setup: z.string().nullable().describe('A command that saves a signed-in storage state, or null when tests sign in through the app'),
    storageState: z.string().nullable().describe('The file that command writes, relative to the project root'),
    how: z.string().describe('One or two sentences on how tests sign in today'),
  }),
  brief: z.string().describe('The product brief as markdown, starting with a level-1 heading'),
  conventions: z.string().describe('The test conventions as markdown, starting with a level-1 heading'),
  gaps: z.array(z.string()).describe('What a person must fill in or check'),
});
export type Survey = z.infer<typeof Survey>;

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

/** How the skeptic found a question: what a developer would guess, what a frustrated user would try, what happens twice. */
export const Lens = z.enum(['guess', 'frustrated', 'twice']);
export type Lens = z.infer<typeof Lens>;

export const Doubt = z.object({
  lens: Lens,
  question: z.string().describe('A question the ticket does not answer, as a developer would have to ask it'),
  assumed: z.string().describe('The answer the tests will be built on if nobody answers: one sentence, a decision, not a hedge'),
  answer: z.string().nullable().describe('What the team answered, copied from the answers, or null when nobody has'),
});
export type Doubt = z.infer<typeof Doubt>;

/** The skeptic's questions: everything a developer would have to guess, with the guess written down. */
export const Skepticism = z.object({ questions: z.array(Doubt).min(1).max(20) });
export type Skepticism = z.infer<typeof Skepticism>;

/** The safety screen's answer: may the pipeline act on this requirement. `question` is set only when the verdict is ask. */
export const Screening = z.object({
  verdict: z.enum(['proceed', 'refuse', 'ask']),
  category: z.enum(['none', 'destructive', 'exfiltration', 'off-target', 'injection', 'guardrail-bypass', 'other']),
  reasons: z.array(z.string()).min(1).describe('Short and specific, quoting the words that decided it'),
  question: z.string().nullable().describe('For ask: the one question that settles it. Otherwise null'),
});
export type Screening = z.infer<typeof Screening>;

// ── Technical notes: the ticket writer's, or the technical review's ─────────

export const Technical = z
  .object({
    covered: z
      .array(
        z.object({
          file: z.string().describe('Repo path, e.g. tests/cart.spec.ts'),
          test: z.string().describe('The exact test title'),
          covers: z.string().describe('Which part of the wish it already proves'),
        }),
      )
      .describe('Existing tests that already prove part of the wish'),
    pages: z
      .array(
        z.object({
          file: z.string().describe('Page object path, e.g. pages/CartPage.ts'),
          member: z.string().describe('Locator or method the tests will use, e.g. cartBadge or remove(name)'),
          exists: z.boolean().describe('False when it would have to be added'),
          note: z.string(),
        }),
      )
      .describe('Page objects and the locators or methods the tests will use'),
    touches: z
      .array(
        z.object({
          area: z.string().describe('Existing behaviour this change could break'),
          why: z.string().describe('What the two share: a control, a page, a piece of state'),
          guardedBy: z.string().nullable().describe('The existing test that would catch it, as "tests/<file>: <title>". Null when nothing does.'),
        }),
      )
      .describe('Nearby behaviour the change could break, and whether the suite would notice'),
    related: z.array(z.object({ ref: z.string(), why: z.string() })).describe('Open tickets or bugs that bear on this wish'),
    notes: z.string().describe('Anything else the engineer needs: routes, test ids, behaviour seen in the browser'),
  })
  .describe('What an engineer needs to know about the code and tests, checked against the repository');
export type Technical = z.infer<typeof Technical>;

// ── Stage 1b: technical review ───────────────────────────────────────────────

/** The technical notes every ticket gets, written by the reviewer or taken from the ticket writer's notes. */
export const TechnicalReview = Technical.extend({
  risk: z.enum(['high', 'medium', 'low']),
  riskReason: z.string().describe('What breaks for the user if this is wrong, and how likely it is'),
});
export type TechnicalReview = z.infer<typeof TechnicalReview>;

// ── Before stage 1: the ticket writer ────────────────────────────────────────

export const TicketDraft = z.object({
  title: z.string().describe('Short, with no "Requirement:" prefix'),
  story: z.object({
    asA: z.string().describe('With its article, e.g. "a shopper"'),
    iWant: z.string().describe('Starts with "to", e.g. "to sort the list by price"'),
    soThat: z.string().describe('Starts with the subject, e.g. "I can find the cheapest item"'),
  }),
  why: z.string().describe('What goes wrong for the user or the business if it breaks'),
  built: z.boolean().describe('True if the feature is already in the app today'),
  alreadyThere: z.string().describe('What exists today that relates to the wish, seen in the app or in the existing tests'),
  criteria: z.array(Criterion).min(3).max(12),
  assumptions: z.array(z.string()),
  outOfScope: z.array(z.string()),
  risk: z.enum(['high', 'medium', 'low']),
  riskReason: z.string(),
  technical: Technical,
  duplicates: z.array(z.object({ ref: z.string(), reason: z.string() })).describe('Open tickets that ask for the same thing'),
  questions: z.array(
    z.object({
      question: z.string(),
      blocking: z.boolean().describe('True only if a wrong guess would make the ticket worthless'),
      why: z.string(),
    }),
  ),
});
export type TicketDraft = z.infer<typeof TicketDraft>;

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
  regressionRisks: z
    .array(
      z.object({
        area: z.string().describe('Existing behaviour this feature could break, e.g. "the cart badge count"'),
        why: z.string().describe('What the two share: a control, a page, a piece of state'),
        guardedBy: z.string().nullable().describe('The existing test that would catch it, as "file: title". Null when nothing does.'),
      }),
    )
    .describe('Nearby behaviour the feature could break, and whether the suite would notice'),
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

// ── Stage 3b: the saboteur ───────────────────────────────────────────────────

export const Sabotage = z.object({
  faults: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/).describe('What the fault does, as a kebab-case slug of 3 to 40 characters: sort-ignores-choice'),
        criterion: z.string().describe('The acceptance criterion it breaks, e.g. AC-3'),
        what: z.string().describe('One sentence: what the app does wrong under this fault'),
        script: z.string().describe('The JavaScript of an init script, run on every page before the app\'s own scripts'),
        probe: z.string().describe('A JavaScript expression that is true only when the fault has taken effect on the page'),
        routes: z
          .array(
            z.object({
              url: z.string().min(1).describe('A glob the request URL must match, as page.route takes it'),
              abort: z.boolean(),
              status: z.number().int().optional(),
              body: z.string().optional(),
              contentType: z.string().optional(),
            }),
          )
          .describe('Requests to answer or drop. Usually empty'),
      }),
    )
    .min(1)
    .max(12),
});
export type Sabotage = z.infer<typeof Sabotage>;

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

// ── Healing a test defect ────────────────────────────────────────────────────

export const Healing = z.object({
  summary: z.string(),
  fixes: z.array(
    z.object({
      test: z.string().describe('Title of the failing test this fixes'),
      file: z.string().describe('The file you changed'),
      cause: z.string().describe('What had changed in the app'),
      change: z.string().describe('What you changed in the test or page object'),
    }),
  ),
  notFixed: z.array(z.object({ test: z.string(), reason: z.string() })),
});
export type Healing = z.infer<typeof Healing>;
