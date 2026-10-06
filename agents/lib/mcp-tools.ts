import { z } from 'zod';
import type { Candidate, Written } from './intake.ts';
import { KEY } from './keys.ts';
import { LABELS } from './paths.ts';

/**
 * The pure half of the MCP server: what each tool accepts and how its answer is worded. The server in agents/mcp.ts
 * wires these to the pipeline. None of the tools starts a workflow or adds a label; the descriptions say which ones
 * run agents, because those spend the Claude plan or API budget.
 */

const COSTS = 'It runs agents, so it spends the Claude plan or API budget of whoever runs the server.';

export const DraftInput = z
  .object({
    text: z.string().trim().min(10).max(4000).describe('The wish, in a sentence or two, e.g. "Shoppers can save a wishlist"'),
    source: z.enum(['local', 'github']).default('local').describe('github checks open issues for duplicates and can file the ticket; local only previews'),
    answers: z.string().max(8000).optional().describe('Answers to the blocking questions a previous call asked, as plain text'),
    file: z.boolean().default(false).describe('True files the ticket on GitHub. False, the default, returns the preview only'),
  })
  .refine((input) => !input.file || input.source === 'github', { message: 'Filing a ticket needs source "github".', path: ['file'] });
export type DraftInput = z.infer<typeof DraftInput>;

export const AnalyzeInput = z
  .object({
    text: z.string().trim().min(10).max(20000).optional().describe('The requirement as plain text, when it is not on a ticket'),
    title: z.string().trim().max(200).optional().describe('A title for a requirement given as text'),
    source: z.enum(['github', 'jira', 'pr', 'azure', 'linear']).optional().describe('Where the ticket lives, with ref'),
    ref: z.string().trim().max(40).optional().describe('The issue, pull request or work item number, or the Jira or Linear key'),
    testFirst: z.boolean().default(false).describe('For text: the feature is not built yet. A ticket says so itself'),
  })
  .superRefine((input, ctx) => {
    const ticket = input.source !== undefined || input.ref !== undefined;
    if (ticket && input.text !== undefined) ctx.addIssue({ code: 'custom', message: 'Give either text, or source and ref, not both.' });
    if (!ticket && input.text === undefined) ctx.addIssue({ code: 'custom', message: 'Give the requirement as text, or as source and ref.' });
    if (ticket && (input.source === undefined || input.ref === undefined)) ctx.addIssue({ code: 'custom', message: 'A ticket needs both source and ref.' });
    if ((input.source === 'github' || input.source === 'pr' || input.source === 'azure') && input.ref !== undefined && !/^[1-9]\d*$/.test(input.ref))
      ctx.addIssue({ code: 'custom', message: `"${input.ref}" is not a ${input.source === 'github' ? 'GitHub issue' : input.source === 'pr' ? 'pull request' : 'work item'} number.`, path: ['ref'] });
    if ((input.source === 'jira' || input.source === 'linear') && input.ref !== undefined && !KEY.test(input.ref))
      ctx.addIssue({ code: 'custom', message: `"${input.ref}" is not a ${input.source === 'jira' ? 'Jira' : 'Linear'} ticket key.`, path: ['ref'] });
  });
export type AnalyzeInput = z.infer<typeof AnalyzeInput>;

const SESSION = z.string().trim().min(1).max(64).describe('The session id qa_intake_start gave');

export const IntakeStartInput = z.object({
  wish: z.string().trim().min(10).max(4000).describe('The wish, in a sentence or two, e.g. "Shoppers can save a wishlist"'),
  source: z.enum(['local', 'github']).default('local').describe('github checks open issues for duplicates and can file the ticket later; local only previews'),
  rounds: z.number().int().min(1).max(6).optional().describe('The most rounds of questions. The default is intake.maxRounds in qa.config.json'),
});
export type IntakeStartInput = z.infer<typeof IntakeStartInput>;

export const IntakeAnswerInput = z.object({
  session: SESSION,
  answers: z
    .array(z.string().max(2000))
    .min(1)
    .max(20)
    .describe('One answer per question, in the order asked. An empty string accepts the assumption shown; "skip" leaves the question open'),
});
export type IntakeAnswerInput = z.infer<typeof IntakeAnswerInput>;

export const IntakeFileInput = z.object({ session: SESSION });
export type IntakeFileInput = z.infer<typeof IntakeFileInput>;

export const HistoryInput = z.object({
  limit: z.number().int().min(1).max(50).default(10).describe('How many of the newest runs to list'),
});

export const NoInput = z.object({});

/** The tools, in the order a person meets them. The server registers exactly these. */
export const TOOLS = {
  qa_draft_ticket: {
    title: 'Write a requirement ticket',
    description: `The ticket writer: turns a wish into a complete requirement ticket (story, Given/When/Then criteria, technical notes, risk) and returns the preview. It files the ticket on GitHub only with file: true, and then without any label: a person adds ${LABELS.analyze} when happy. ${COSTS} Takes a minute or two.`,
    input: DraftInput,
    readOnly: false,
  },
  qa_intake_start: {
    title: 'Start an intake conversation',
    description: `Starts the intake conversation for a wish: the safety screen reads it first (a refusal ends it here), then the skeptic and the analyst list what they would otherwise guess. Returns a session id and the first questions to put to the person. Nothing is filed. ${COSTS} Takes a minute or two.`,
    input: IntakeStartInput,
    readOnly: false,
  },
  qa_intake_answer: {
    title: 'Answer the intake questions',
    description: `Gives the answers to the questions of an intake session. Returns the next questions, or when none are left the drafted ticket, ready to file. Nothing is filed. ${COSTS}`,
    input: IntakeAnswerInput,
    readOnly: false,
  },
  qa_intake_file: {
    title: 'File the intake ticket',
    description: `Files the ticket an intake session drafted on GitHub, only when this is called, without any label: a person adds ${LABELS.analyze} when happy. The session needs source "github". Call it only after the person has said yes.`,
    input: IntakeFileInput,
    readOnly: false,
  },
  qa_analyze: {
    title: 'Analyse a requirement',
    description: `Runs the QA analysis on a wish given as text or on a ticket (GitHub issue number or Jira key): requirements, technical review, test plan and plan health score. Returns the analysis markdown. It posts nothing on the ticket and changes no label. ${COSTS} It takes several minutes.`,
    input: AnalyzeInput,
    readOnly: false,
  },
  qa_coverage: {
    title: 'Traceability map',
    description: 'Which ticket each test exists for, the criteria its tests claim, and how they did in the last local run. Built from the test tags, no agent.',
    input: NoInput,
    readOnly: true,
  },
  qa_history: {
    title: 'Run history',
    description: 'The pipeline run history from the qa-history branch: totals (gate pass rate, review verdicts, cost) and the newest runs. Reads origin/qa-history from the local clone, no agent.',
    input: HistoryInput,
    readOnly: true,
  },
  qa_doctor: {
    title: 'Preflight check',
    description: 'Checks this checkout is ready to run the pipeline: config, documents, browser, the app, credentials. No agent.',
    input: NoInput,
    readOnly: true,
  },
  qa_status: {
    title: 'Pipeline status',
    description: 'Open GitHub issues that carry a pipeline label, with the stage each is at, and the open pull requests the pipeline opened. Needs the gh CLI signed in. No agent.',
    input: NoInput,
    readOnly: true,
  },
} as const;

export type ToolName = keyof typeof TOOLS;

/** A tool answer: always text. */
export type ToolAnswer = { content: { type: 'text'; text: string }[]; isError?: boolean };

export const answer = (text: string): ToolAnswer => ({ content: [{ type: 'text', text }] });

export const failure = (error: unknown): ToolAnswer => ({
  content: [{ type: 'text', text: `Failed: ${error instanceof Error ? error.message : String(error)}` }],
  isError: true,
});

/** The ticket writer's answer: the preview, and either how to file it or where it was filed. */
export function draftText(result: { preview: string; problems: string[]; labels: string[]; filed: { ref: string; url: string | null } | null }, input: DraftInput): string {
  const next = result.filed
    ? `Filed: ${result.filed.url ?? result.filed.ref}. No label was added. ${
        result.labels.length ? `Add ${result.labels.map((l) => `\`${l}\``).join(', ')} on the ticket. ` : ''
      }Add \`${LABELS.analyze}\` when you want it analysed.`
    : input.source === 'github'
      ? `Not filed. Call qa_draft_ticket again with file: true to file it${result.problems.length ? ', or answer the open questions first with answers' : ''}.`
      : 'Not filed: this was a preview. Use source "github" with file: true to file it.';
  return `${result.preview.trim()}\n\n---\n\n${next}`;
}

/** The questions waiting for the person, and how to answer them. */
export function questionsText(session: string, pending: Candidate[], round: number): string {
  const list = pending
    .map((q, i) => `${i + 1}. ${q.lens ? `[${q.lens}] ` : '[blocks testing] '}${q.question.trim()}${q.assumed ? `\n   It would otherwise assume: ${q.assumed}` : ''}`)
    .join('\n\n');
  return `Session ${session}, round ${round}. Put these to the person and call qa_intake_answer with one answer each, in order. An empty string accepts the assumption shown; "skip" leaves the question open.\n\n${list}`;
}

/** The drafted ticket, and what to do next. */
export function intakeTicketText(session: string, ticket: Written, source: string): string {
  const notReady = ticket.problems.length ? `\nNot ready:\n${ticket.problems.map((p) => `- ${p}`).join('\n')}\n` : '';
  const next =
    source === 'github'
      ? `Not filed. Show it to the person. Only after they say yes, call qa_intake_file with session ${session}.`
      : 'Not filed: this session uses the local source. Start again with source "github" to be able to file it.';
  return `# ${ticket.title}\n\nLabels: ${ticket.labels.join(', ') || 'none'}\n\n${ticket.body}${notReady}\n---\n\n${next}`;
}

/** What qa_history says when the clone has no history branch. */
export const NO_HISTORY =
  'No run history in this clone: origin/qa-history was not found. Run `git fetch origin qa-history` and try again. The branch exists once the "QA run history" workflow has recorded a run.';
