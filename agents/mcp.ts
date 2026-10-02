import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { historyMd, parseRunLog } from './lib/history.ts';
import { answer, draftText, failure, NO_HISTORY, TOOLS, type AnalyzeInput, type DraftInput, type ToolAnswer, type ToolName } from './lib/mcp-tools.ts';
import { ROOT } from './lib/paths.ts';

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
