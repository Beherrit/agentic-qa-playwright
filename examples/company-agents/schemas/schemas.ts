import { z } from 'zod';

/**
 * The shape every role answers in. An agent's answer is validated against its schema before anything downstream
 * sees it, and every claim that code can check (a file, a ticket key, a merge request number, a URL, a line) is a
 * field of its own so the validator can check it (cli/lib/validate.ts). Prose goes in `markdown`, `text` or `body`.
 */

/** A ticket key: SHOP-123, OPS-7. GitHub issues are written as the number with a hash, #123. */
export const TICKET_KEY = /^(?:[A-Z][A-Z0-9]+-\d+|#\d+)$/;
export const TicketKey = z.string().regex(TICKET_KEY).describe('A ticket key such as SHOP-123, or #123 for a GitHub issue');

// ── Screening: in front of every role ─────────────────────────────────────────

export const Category = z.enum(['none', 'destructive', 'exfiltration', 'off-target', 'guardrail-bypass', 'external-voice', 'injection', 'other']);

export const Screening = z.object({
  verdict: z.enum(['proceed', 'refuse', 'ask']),
  category: Category,
  reasons: z.array(z.string()).min(1).describe('Short and specific, quoting the words that decided it'),
  question: z.string().nullable().describe('For ask: the one question that settles it. Otherwise null'),
});
export type Screening = z.infer<typeof Screening>;

// ── Merge requests ────────────────────────────────────────────────────────────

export const SensitiveArea = z.enum(['auth', 'permissions', 'payments', 'data-deletion', 'migration', 'public-api', 'ci', 'secrets', 'dependencies']);

export const MergeRequestDescription = z.object({
  summary: z.string().describe('One sentence: what the change is and where'),
  why: z.string(),
  kind: z.enum(['feature', 'fix', 'refactor', 'dependency', 'config', 'docs', 'mixed']),
  areas: z.array(z.object({ purpose: z.string(), files: z.array(z.string()) })).describe('Changed files grouped by what they are for'),
  flags: z.array(z.object({ category: SensitiveArea, file: z.string(), note: z.string() })),
  reviewOrder: z.array(z.string()).describe('Files in the order to read them'),
  risks: z.array(z.string()),
  tryIt: z.array(z.string()).describe('Steps a reviewer can take to see it working'),
  testing: z.object({ covers: z.array(z.string()), missing: z.array(z.string()).describe('Behaviour with no test, named') }),
  unread: z.array(z.string()).describe('Parts of the diff not read, or empty'),
  markdown: z.string().describe('The description for the merge request, under 60 lines'),
});
export type MergeRequestDescription = z.infer<typeof MergeRequestDescription>;

export const Severity = z.enum(['blocker', 'major', 'minor', 'nit']);

export const Review = z.object({
  verdict: z.enum(['looks-good', 'comments', 'needs-human-attention']),
  summary: z.string(),
  findings: z.array(
    z.object({
      severity: Severity,
      file: z.string(),
      line: z.number().int().positive().describe('A line in the diff; a finding on any other line is dropped'),
      what: z.string(),
      instead: z.string(),
    }),
  ),
  criteriaCoverage: z.array(z.object({ criterion: z.string(), where: z.string().describe('File and line, or "none"') })),
  unread: z.array(z.string()),
});
export type Review = z.infer<typeof Review>;

// ── Tickets ───────────────────────────────────────────────────────────────────

export const Criterion = z.object({
  id: z.string().describe('AC1, AC2, ...'),
  kind: z.enum(['happy', 'negative', 'edge']),
  given: z.string(),
  when: z.string(),
  then: z.string(),
});

export const TicketDraft = z.object({
  ready: z.boolean().describe('True when no question is blocking'),
  title: z.string(),
  story: z.object({ who: z.string(), what: z.string(), why: z.string(), whyAssumed: z.boolean() }),
  criteria: z.array(Criterion).min(1).max(8),
  outOfScope: z.array(z.string()),
  area: z.object({ name: z.string(), files: z.array(z.string()) }),
  related: z.array(z.object({ ref: TicketKey, reason: z.string(), duplicate: z.boolean() })),
  questions: z.array(z.object({ text: z.string(), assumed: z.string(), blocking: z.boolean() })),
  markdown: z.string().describe('The ticket body as it will be filed'),
});
export type TicketDraft = z.infer<typeof TicketDraft>;

export const Enrichment = z.object({
  area: z.array(z.object({ file: z.string(), why: z.string() })),
  existing: z.array(z.string()).describe('What is already built, or empty'),
  touches: z.array(z.object({ what: z.string(), why: z.string() })),
  history: z.array(z.object({ ref: z.string(), outcome: z.string() })).describe('Closed tickets and merge requests on the same subject'),
  tests: z.array(z.object({ file: z.string(), note: z.string() })),
  questions: z.array(z.object({ text: z.string(), assumed: z.string(), who: z.string() })),
  size: z.object({ value: z.enum(['small', 'medium', 'large', 'unknown']), reason: z.string() }),
  notLookedAt: z.array(z.string()),
  markdown: z.string().describe('The comment, under 50 lines'),
});
export type Enrichment = z.infer<typeof Enrichment>;

export const TestCases = z.object({
  cases: z.array(
    z.object({
      criterion: z.string().describe('AC1, AC2, ...'),
      kind: z.enum(['happy', 'negative', 'edge']),
      title: z.string(),
      preconditions: z.string(),
      steps: z.array(z.object({ action: z.string(), expected: z.string() })).min(1),
      refs: TicketKey,
    }),
  ),
  existing: z.array(z.object({ criterion: z.string(), caseId: z.string(), title: z.string() })).describe('Criteria a case already covers'),
  notCovered: z.array(z.object({ criterion: z.string(), reason: z.string() })),
  markdown: z.string().describe('Under 80 lines'),
});
export type TestCases = z.infer<typeof TestCases>;

export const DesignReview = z.object({
  design: z.object({ url: z.string(), nodeIds: z.array(z.string()) }),
  findings: z.array(
    z.object({
      category: z.enum(['text', 'state', 'structure', 'token', 'responsive', 'accessibility']),
      nodeId: z.string(),
      file: z.string(),
      line: z.number().int().positive().nullable(),
      designSays: z.string(),
      codeSays: z.string(),
      ticketSays: z.string().nullable(),
    }),
  ),
  questionsForDesigner: z.array(z.string()),
  notCompared: z.array(z.string()),
  markdown: z.string().describe('Under 50 lines'),
});
export type DesignReview = z.infer<typeof DesignReview>;

// ── Documentation ─────────────────────────────────────────────────────────────

export const DocumentationDraft = z.object({
  target: z.object({
    action: z.enum(['update', 'create']),
    pageId: z.string().nullable().describe('For update: the page to replace'),
    parentId: z.string().nullable().describe('For create: the parent page'),
    title: z.string(),
  }),
  format: z.enum(['confluence-storage', 'markdown']),
  changelog: z.string(),
  removed: z.array(z.object({ quote: z.string(), replacement: z.string() })),
  operations: z.array(z.string()).describe('Settings, flags, migrations, runbook steps'),
  discrepancies: z.array(z.string()).describe('Where the code and the ticket disagree'),
  toConfirm: z.array(z.string()),
  body: z.string(),
});
export type DocumentationDraft = z.infer<typeof DocumentationDraft>;

export const DriftReport = z.object({
  area: z.string(),
  pagesChecked: z.array(z.string()),
  findings: z.array(
    z.object({
      page: z.string(),
      quote: z.string(),
      file: z.string(),
      line: z.number().int().positive().nullable(),
      codeSays: z.string(),
      confidence: z.enum(['confirmed', 'likely', 'unsure']),
      suggested: z.string(),
    }),
  ),
  unchecked: z.array(z.string()),
  summary: z.string(),
});
export type DriftReport = z.infer<typeof DriftReport>;

// ── Chat ──────────────────────────────────────────────────────────────────────

export const ChatReply = z.object({
  kind: z.enum(['answer', 'statement', 'refused']).describe('An answer is sent at once; a statement waits for approval'),
  text: z.string(),
  sources: z.array(z.object({ url: z.string(), supports: z.string() })),
  needsHuman: z.boolean(),
  who: z.string().nullable().describe('A role or team, when a person is the right next step'),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type ChatReply = z.infer<typeof ChatReply>;

// ── Alerts and incidents ──────────────────────────────────────────────────────

export const Triage = z.object({
  failing: z.string().describe('One sentence, in user terms, with the start time'),
  severity: z.enum(['page', 'urgent', 'routine', 'noise']),
  reason: z.string(),
  blastRadius: z.string(),
  trend: z.enum(['worsening', 'steady', 'recovering', 'unknown']),
  suspects: z.array(z.object({ change: z.string(), ref: z.string(), why: z.string(), howToRuleOut: z.string() })),
  runbook: z.object({ page: z.string().nullable(), step: z.string().nullable(), missing: z.boolean() }),
  diagnose: z.string().describe('One command or query'),
  mitigate: z.string().nullable().describe('From the runbook only'),
  notify: z.array(z.object({ team: z.string(), why: z.string() })),
  incident: z.object({ open: z.boolean(), criterion: z.string() }),
  markdown: z.string().describe('The note, under 40 lines'),
});
export type Triage = z.infer<typeof Triage>;

export const IncidentRecord = z.object({
  status: z.enum(['open', 'mitigated', 'resolved']),
  timeline: z.array(z.object({ at: z.string().describe('UTC, HH:MM'), who: z.string(), event: z.string(), unsure: z.boolean() })),
  openItems: z.array(z.string()),
  postMortem: z
    .object({
      summary: z.string(),
      wentWrong: z.array(z.string()),
      wentRight: z.array(z.string()),
      lucky: z.array(z.string()),
      actions: z.array(z.object({ action: z.string(), ownerRole: z.string() })),
      openQuestions: z.array(z.string()),
    })
    .nullable(),
  redactions: z.array(z.object({ kind: z.string(), count: z.number().int().nonnegative() })),
  markdown: z.string(),
});
export type IncidentRecord = z.infer<typeof IncidentRecord>;

// ── Digest and answers ────────────────────────────────────────────────────────

export const Digest = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  headlines: z.array(z.string()).max(3),
  shipped: z.array(z.object({ area: z.string(), ref: z.string(), line: z.string() })),
  fixed: z.array(z.object({ ref: z.string(), line: z.string(), reopened: z.boolean() })),
  incidents: z.array(z.object({ ref: z.string(), duration: z.string(), impact: z.string(), postMortemDone: z.boolean() })),
  alerts: z.object({ bySeverity: z.record(z.string(), z.number().int()), noisiest: z.string().nullable() }),
  docs: z.array(z.string()),
  carriedOver: z.object({ tickets: z.number().int(), oldestTickets: z.array(z.string()), mergeRequests: z.number().int(), oldestMergeRequest: z.string().nullable() }),
  numbers: z.record(z.string(), z.number()),
  refs: z.array(z.string()).describe('Every ticket key and merge request number named'),
  markdown: z.string().describe('Under 60 lines'),
});
export type Digest = z.infer<typeof Digest>;

export const Answer = z.object({
  text: z.string(),
  steps: z.array(z.object({ command: z.string(), from: z.string().describe('The file the command came from') })),
  sources: z.array(z.object({ ref: z.string().describe('URL or repository path'), supports: z.string() })),
  confidence: z.enum(['high', 'medium', 'low']),
  driftNotes: z.array(z.string()),
  notFound: z.object({ value: z.boolean(), lookedIn: z.array(z.string()), askInstead: z.string().nullable() }),
});
export type Answer = z.infer<typeof Answer>;

// ── Roles ─────────────────────────────────────────────────────────────────────

/** Each role, its prompt file under agents/, and the shape it answers in. */
export const ROLES = {
  'request-screener': Screening,
  'merge-request-describer': MergeRequestDescription,
  'merge-request-reviewer': Review,
  'ticket-writer': TicketDraft,
  'ticket-enricher': Enrichment,
  'test-case-writer': TestCases,
  'design-reviewer': DesignReview,
  'release-documenter': DocumentationDraft,
  'doc-drift-checker': DriftReport,
  'chat-responder': ChatReply,
  'alert-triager': Triage,
  'incident-scribe': IncidentRecord,
  'weekly-digest': Digest,
  'onboarding-guide': Answer,
} as const;
export type Role = keyof typeof ROLES;

// ── The record every run leaves ───────────────────────────────────────────────

export const AuditRecord = z.object({
  runId: z.string(),
  at: z.string().describe('ISO 8601'),
  actor: z.string().describe('Who asked: a login, or "ci:<workflow>"'),
  role: z.string(),
  trigger: z.string().describe('The command or event'),
  inputSha256: z.string(),
  screening: Screening.nullable(),
  outcome: z.enum(['posted', 'drafted', 'refused', 'failed', 'cancelled', 'dry-run']),
  target: z.string().nullable().describe('Where the output went'),
  model: z.string().nullable(),
  costUsd: z.number().nullable(),
  turns: z.number().int().nullable(),
  problems: z.array(z.string()),
});
export type AuditRecord = z.infer<typeof AuditRecord>;
