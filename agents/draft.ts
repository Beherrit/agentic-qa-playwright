import fs from 'node:fs';
import readline from 'node:readline/promises';
import { runAgent } from './lib/agent.ts';
import { checkedDuplicates, checkedTechnical, readiness, ticketBody, ticketLabels, withAnswers } from './lib/draft.ts';
import { config, LABELS, projectDoc } from './lib/paths.ts';
import { TicketDraft } from './lib/schemas.ts';
import { prompt, save } from './lib/store.ts';
import { sourceFor } from './sources/index.ts';
import { repo } from './stages.ts';

/**
 * The ticket writer: a sentence or two in, a complete requirement ticket out, filed after a person says yes.
 * It never adds the label that starts the analysis. A person does that.
 */

export type DraftOptions = {
  text?: string;
  file?: string;
  source?: string;
  /** A file with answers to the writer's blocking questions. */
  answers?: string;
  /** The same answers given as text, for callers without a file (the MCP server). */
  answersText?: string;
  /** File the ticket without asking. */
  yes?: boolean;
  /** False files the ticket with no labels and says which a person should add. The MCP server never adds one. */
  labels?: boolean;
};

/** What the writer produced: the preview people read, whether it is ready, and the ticket if it was filed. */
export type DraftResult = { preview: string; problems: string[]; labels: string[]; filed: { ref: string; url: string | null } | null };

const interactive = (): boolean => Boolean(process.stdin.isTTY);

type OpenTickets = { ref: string; title: string; url: string | null }[];

/** Asks the ticket writer. Exported so the evaluation harness can call it with a case of its own. */
export async function writeTicket(wish: string, open: OpenTickets): Promise<TicketDraft> {
  const { output } = await runAgent({
    role: 'ticket-writer',
    instructions: prompt('ticket-writer'),
    task: `Write the requirement ticket for ${config.app.name} at ${config.app.baseUrl}.

<wish>
${wish}
</wish>

<product-brief>
${projectDoc(config.app.brief)}
</product-brief>

<open-tickets>
${JSON.stringify(open, null, 2)}
</open-tickets>`,
    schema: TicketDraft,
    access: 'read',
    browser: true,
    maxTurns: 40,
  });
  return output;
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** The answers to the blocking questions, from text, a file or the person at the keyboard. Null when nobody can answer. */
async function answersTo(blocking: string[], file?: string, text?: string): Promise<string | null> {
  if (text?.trim()) return text;
  if (file) return fs.readFileSync(file, 'utf8');
  if (!interactive()) return null;
  const lines: string[] = [];
  for (const question of blocking) lines.push(`${question}\n${await ask(`\n${question}\n> `)}`);
  return lines.join('\n\n');
}

export async function draft(options: DraftOptions): Promise<DraftResult> {
  const wish = options.file ? fs.readFileSync(options.file, 'utf8') : options.text;
  if (!wish?.trim()) throw new Error('Give the wish with --text "<words>" or --file <path>.');

  const source = sourceFor(options.source ?? 'local');
  const open = await source.list();

  let result = await writeTicket(wish, open);
  const blocking = result.questions.filter((q) => q.blocking).map((q) => q.question);
  if (blocking.length > 0) {
    const answers = await answersTo(blocking, options.answers, options.answersText);
    // One extra pass at most. Anything still open after it goes on the ticket as a question.
    if (answers?.trim()) result = await writeTicket(withAnswers(wish, result.questions.map((q) => q.question), answers), open);
  }

  result = {
    ...result,
    duplicates: checkedDuplicates(result, open),
    technical: checkedTechnical(result.technical, repo.fileExists, open.map((ticket) => ticket.ref), repo.titlesIn),
  };
  const problems = readiness(result);
  const body = ticketBody(result);
  // A caller that files without labels never starts the analysis, whatever the configuration says.
  const autoRun = (config.autoRun?.analysisWhenWriterFiles ?? false) && options.labels !== false;
  const labels = ticketLabels(result, problems, autoRun);
  const title = `Requirement: ${result.title}`;

  const notReady = problems.length > 0 ? `\nNot ready:\n${problems.map((p) => `- ${p}`).join('\n')}\n` : '';
  const preview = `# ${title}\n\nLabels: ${labels.join(', ') || 'none'}\n\n${body}${notReady}`;
  console.log(`\n${preview}`);
  save('draft.md', preview);
  save('draft.json', result);

  const go = options.yes || (interactive() && /^y/i.test(await ask('\nFile this ticket? (y/n) ')));
  if (!go) {
    console.log(interactive() ? '\nNot filed.' : '\nNot filed. Run it again with --yes to file the ticket.');
    return { preview, problems, labels, filed: null };
  }

  const created = await source.create({ title, body, labels: options.labels === false ? [] : labels });
  console.log(`\nFiled ${created.url ?? created.ref}.`);
  console.log(
    problems.length > 0
      ? `It is not ready yet. Answer the questions on the ticket, then add the \`${LABELS.analyze}\` label to have it analysed.`
      : autoRun
        ? 'The analysis starts by itself; its report will appear on the ticket.'
        : `Add the \`${LABELS.analyze}\` label to have it analysed.`,
  );
  return { preview, problems, labels, filed: created };
}
