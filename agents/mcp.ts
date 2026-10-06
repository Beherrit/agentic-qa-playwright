import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { historyMd, parseRunLog } from './lib/history.ts';
import { advance, answer as recordAnswers, buildTicket, startSession, type OpenTickets, type Session, type Written } from './lib/intake.ts';
import {
  answer,
  draftText,
  failure,
  intakeTicketText,
  NO_HISTORY,
  questionsText,
  TOOLS,
  type AnalyzeInput,
  type DraftInput,
  type IntakeAnswerInput,
  type IntakeFileInput,
  type IntakeStartInput,
  type ToolAnswer,
  type ToolName,
} from './lib/mcp-tools.ts';
import { config, LABELS, ROOT } from './lib/paths.ts';
import { screenRules, screeningMd } from './lib/safety.ts';

/**
 * The pipeline as an MCP server, so it can be used from Claude Desktop or Claude Code: `npm run mcp`.
 * It speaks MCP over stdio. No tool starts a GitHub workflow or adds a label; the two agent-backed tools
 * (qa_draft_ticket, qa_analyze) spend the plan or API budget of whoever runs the server.
 */

// stdout carries the protocol. The stages print progress with console.log, so everything printed goes to stderr.
console.log = console.error;
console.info = console.error;
console.warn = console.error;

// The pipeline modules are loaded on first use: they start nothing on import, but they are slow to load,
// and the server should answer `initialize` at once.
const flow = () => import('./flow.ts');
const store = () => import('./lib/store.ts');

// The draft and the analysis both use the run folder. One at a time, so two calls never mix their files.
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/** An intake conversation held between two calls. In memory only: it ends with the server process. */
type Held = { session: Session; source: string; open: OpenTickets; ticket: Written | null; filed: string | null };
const held = new Map<string, Held>();
const MAX_SESSIONS = 20;

function heldSession(id: string): Held {
  const found = held.get(id);
  if (!found) throw new Error(`No intake session "${id}". Start one with qa_intake_start; sessions end when the server stops.`);
  return found;
}

/** The next step of a session: more questions, or the drafted ticket. */
async function intakeNext(id: string, state: Held): Promise<string> {
  const { liveAgents } = await import('./intake.ts');
  await advance(state.session, await liveAgents());
  if (state.session.pending.length > 0) return questionsText(id, state.session.pending, state.session.round?.number ?? 1);
  const { checkedDraft, writeTicket } = await import('./draft.ts');
  // The MCP server never adds the label that starts the analysis, so the writer's own labels are only advice here.
  state.ticket = await buildTicket(state.session.wish, state.session.rounds, state.open, { writer: writeTicket, checked: checkedDraft, autoRun: false });
  return intakeTicketText(id, state.ticket, state.source);
}

async function guarded(work: () => Promise<string> | string): Promise<ToolAnswer> {
  try {
    return answer(await work());
  } catch (error) {
    return failure(error);
  }
}

const handlers: { [K in ToolName]: (args: never) => Promise<ToolAnswer> } = {
  qa_draft_ticket: (input: DraftInput) =>
    guarded(() =>
      oneAtATime(async () => {
        const { draft } = await import('./draft.ts');
        const result = await draft({ text: input.text, source: input.source, answersText: input.answers, yes: input.file, labels: false });
        return draftText(result, input);
      }),
    ),

  qa_intake_start: (input: IntakeStartInput) =>
    guarded(() =>
      oneAtATime(async () => {
        const { screenText } = await import('./screen.ts');
        const screened = await screenText(input.wish);
        if (screened.verdict === 'refuse') return `${screeningMd(screened).trim()}\n\n---\n\nNo session was started and nothing was written.`;
        if (screened.verdict === 'ask') {
          return `The safety screen needs one answer first: ${screened.question ?? 'Is this a request to test the app?'}\n\nAsk the person, then call qa_intake_start again with the wish and their answer in one text.`;
        }
        if (held.size >= MAX_SESSIONS) held.delete(held.keys().next().value as string);
        const { sourceFor } = await import('./sources/index.ts');
        const id = crypto.randomUUID().slice(0, 8);
        const state: Held = {
          session: startSession(input.wish, input.rounds ?? config.intake.maxRounds, config.intake.maxQuestions),
          source: input.source,
          open: await sourceFor(input.source).list(),
          ticket: null,
          filed: null,
        };
        held.set(id, state);
        const guardrail = `Guardrail: safety screen passed (rules: ${screened.findings.length} findings, screener: ${screened.screener === 'ran' ? screened.verdict : 'not asked'}).`;
        return `${guardrail}\n\n${await intakeNext(id, state)}`;
      }),
    ),

  qa_intake_answer: (input: IntakeAnswerInput) =>
    guarded(() =>
      oneAtATime(async () => {
        const state = heldSession(input.session);
        if (state.ticket) throw new Error('This session already has its ticket. Call qa_intake_file to file it, or start a new session.');
        // What the person typed is read by agents next, so it passes the rules too.
        const flagged = input.answers.flatMap((a) => screenRules(a));
        if (flagged.length > 0) {
          held.delete(input.session);
          return `An answer asks for something the pipeline will not do, so the session was ended and nothing was written:\n${flagged.map((f) => `- ${f.rule}: "${f.excerpt}"`).join('\n')}`;
        }
        recordAnswers(state.session, input.answers);
        return intakeNext(input.session, state);
      }),
    ),

  qa_intake_file: (input: IntakeFileInput) =>
    guarded(() =>
      oneAtATime(async () => {
        const state = heldSession(input.session);
        if (!state.ticket) throw new Error('This session has no ticket yet. Answer the questions with qa_intake_answer first.');
        if (state.source !== 'github') throw new Error('This session uses the local source, which has nowhere to file a ticket. Start again with source "github".');
        if (state.filed) throw new Error(`Already filed: ${state.filed}.`);
        const { sourceFor } = await import('./sources/index.ts');
        const created = await sourceFor(state.source).create({ title: state.ticket.title, body: state.ticket.body, labels: [] });
        state.filed = created.url ?? created.ref;
        const advice = state.ticket.labels.length ? `Add ${state.ticket.labels.map((l) => `\`${l}\``).join(', ')} on the ticket. ` : '';
        return `Filed: ${state.filed}. No label was added. ${advice}Add \`${LABELS.analyze}\` when you want it analysed.`;
      }),
    ),

  qa_analyze: (input: AnalyzeInput) =>
    guarded(() =>
      oneAtATime(async () => {
        const { analyze } = await flow();
        const { exists, loadText } = await store();
        const ok = await analyze(
          { source: input.source, ref: input.ref, text: input.text, title: input.title, testFirst: input.testFirst },
          { post: false, runUrl: null },
        );
        const report = exists('analysis.md') ? loadText('analysis.md') : 'The analysis left no report.';
        return `${report.trim()}\n\n---\n\n${ok ? 'The plan passed.' : 'The analysis did not reach a usable plan.'} Nothing was posted on the ticket. The files are in qa-run/.`;
      }),
    ),

  qa_coverage: () =>
    guarded(async () => {
      const { coverageReport } = await import('./coverage.ts');
      return coverageReport();
    }),

  qa_history: (input: { limit: number }) =>
    guarded(() => {
      const shown = spawnSync('git', ['show', 'origin/qa-history:runs.jsonl'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (shown.status !== 0) return NO_HISTORY;
      return historyMd(parseRunLog(shown.stdout), input.limit);
    }),

  qa_doctor: () =>
    guarded(async () => {
      const { doctorChecks, doctorText } = await import('./doctor.ts');
      return doctorText(await doctorChecks());
    }),

  qa_status: () =>
    guarded(async () => {
      const { openWork } = await import('./sources/github.ts');
      const { statusMd } = await import('./lib/status.ts');
      let work: ReturnType<typeof openWork>;
      try {
        work = openWork();
      } catch (error) {
        throw new Error(`Could not read GitHub through the gh CLI. Install it and run \`gh auth login\`. ${error instanceof Error ? error.message : ''}`.trim());
      }
      return statusMd(work.issues, work.pulls);
    }),
};

export function createServer(): McpServer {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };
  const server = new McpServer({ name: 'agentic-qa', version });
  for (const [name, tool] of Object.entries(TOOLS) as [ToolName, (typeof TOOLS)[ToolName]][]) {
    server.registerTool(
      name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, openWorldHint: !tool.readOnly },
      },
      // The SDK has validated the arguments against tool.input before this is called.
      (args: unknown) => handlers[name](args as never),
    );
  }
  return server;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('agents/mcp.ts')) {
  await createServer().connect(new StdioServerTransport());
}
