import fs from 'node:fs';
import readline from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import { checkedDraft, writeTicket as write } from './draft.ts';
import { buildTicket, converse, costLine, exitCode, readYesNo, transcriptMd, type Candidate, type Outcome, type Round, type Transcript } from './lib/intake.ts';
import { config, LABELS } from './lib/paths.ts';
import { screenRules, type Screened } from './lib/safety.ts';
import type { Request, Requirements, Skepticism, TicketDraft } from './lib/schemas.ts';
import { exists, load, save, type RunRecord } from './lib/store.ts';
import { screenText } from './screen.ts';
import { sourceFor } from './sources/index.ts';
import type { Source } from './sources/types.ts';

/**
 * The intake conversation: a wish typed at a terminal becomes a requirement ticket, after the safety screen has looked
 * at it and the skeptic and the analyst have asked what they would otherwise guess. The agents never see the terminal.
 * They are handed text, and what the person answers goes back to them as text, in the shape the writer's second
 * pass already reads. Nothing is filed without a yes, and nothing in the loop can write to the repository.
 */

export type IntakeOptions = {
  text?: string;
  file?: string;
  /** Where to file the ticket: github, jira, azure or linear. Local, the default, only previews it. */
  source?: string;
  rounds?: number;
  /** Skips the question "File this ticket?" and nothing else. The safety screen always runs. */
  yes?: boolean;
  /** Runs everything and files nothing. */
  dry?: boolean;
};

/** The parts that call a model or a tracker, so a test can put its own in their place. */
export type Deps = {
  input: Readable;
  output: Writable;
  screen: (text: string) => Promise<Screened>;
  doubt: (wish: string, answers: string | null) => Promise<Skepticism>;
  analyse: (wish: string, answers: string | null, doubts: Skepticism) => Promise<Requirements>;
  writer: (wish: string, open: { ref: string; title: string; url: string | null }[]) => Promise<TicketDraft>;
  checked: (draft: TicketDraft, open: { ref: string; title: string; url: string | null }[]) => TicketDraft;
  source: (name: string) => Source;
  save: (name: string, text: string) => void;
  ledger: () => RunRecord[];
  maxRounds: number;
  autoRun: boolean;
};

const MARGIN = '  ';

/** The request the stages read: the wish as the body, and the answers so far as the answers. Never saved to the run folder. */
const requestFor = (wish: string, answers: string | null): Request => ({
  key: 'REQ-0',
  source: 'local',
  ref: 'local',
  url: null,
  title: wish.split('\n')[0].slice(0, 80),
  body: wish,
  mode: 'built',
  ...(answers ? { answers } : {}),
});

/** The skeptic and the analyst, asked about a wish and the answers so far. The stages load when first used. */
export async function liveAgents(): Promise<Pick<Deps, 'doubt' | 'analyse'>> {
  const stages = await import('./stages.ts');
  return {
    doubt: (wish, answers) => stages.doubt(requestFor(wish, answers)),
    analyse: (wish, answers, doubts) => stages.analyse(requestFor(wish, answers), doubts),
  };
}

async function defaults(): Promise<Deps> {
  return {
    ...(await liveAgents()),
    input: process.stdin,
    output: process.stdout,
    screen: (text) => screenText(text),
    writer: write,
    checked: checkedDraft,
    source: sourceFor,
    save,
    ledger: () => (exists('ledger.json') ? load<RunRecord[]>('ledger.json') : []),
    maxRounds: config.intake.maxRounds,
    autoRun: config.autoRun?.analysisWhenWriterFiles ?? false,
  };
}

export async function intake(options: IntakeOptions, given?: Partial<Deps>): Promise<number> {
  const deps: Deps = { ...(await defaults()), ...given };
  const rl = readline.createInterface({ input: deps.input, output: deps.output });
  // Lines are kept as they arrive, so an answer typed or piped in before the question is asked is not lost.
  const lines: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  let closed = false;
  rl.on('line', (line) => (waiting.shift() ?? ((l) => lines.push(l)))(line));
  rl.once('close', () => {
    closed = true;
    for (const resolve of waiting.splice(0)) resolve('');
  });

  const say = (text = ''): void => {
    deps.output.write(`${text.split('\n').map((line) => (line ? MARGIN + line : line)).join('\n')}\n`);
  };
  // What the person types, after the lines above it. A closed input (a pipe that has run out) answers with nothing,
  // so a run never hangs waiting.
  const ask = async (heading: string | null, prompt = '> '): Promise<string> => {
    if (heading) say(heading);
    const next = lines.shift();
    if (next === undefined && closed) return '';
    if (!closed) {
      rl.setPrompt(MARGIN + prompt);
      rl.prompt();
    }
    const line = next ?? (await new Promise<string>((resolve) => waiting.push(resolve)));
    // A person's Enter ends the line on the screen. A pipe's does not.
    if ((deps.output as { isTTY?: boolean }).isTTY !== true) deps.output.write('\n');
    return line.trim();
  };

  const before = deps.ledger().length;
  const transcript: Transcript = {
    wish: '',
    screened: { verdict: 'proceed', category: 'none', reasons: ['Not screened.'], question: null, findings: [], screener: 'skipped' },
    clarification: null,
    rounds: [],
    ended: null,
    ticket: null,
    outcome: 'not-filed',
    result: '',
    cost: '',
  };
  const finish = (outcome: Outcome, result: string): number => {
    transcript.outcome = outcome;
    transcript.result = result;
    transcript.cost = costLine(deps.ledger().slice(before));
    deps.save('intake.md', transcriptMd(transcript));
    say(`\n${transcript.cost}`);
    say('The conversation is in qa-run/intake.md.');
    rl.close();
    return exitCode(outcome);
  };

  try {
    // 1. The wish.
    let wish = options.file ? fs.readFileSync(options.file, 'utf8') : (options.text ?? '');
    if (!wish.trim()) wish = await ask('Describe the feature or behaviour you want tested:');
    if (!wish.trim()) {
      say('Nothing to work from. Give the wish with --text "<words>" or --file <path>, or type it when asked.');
      rl.close();
      return 2;
    }
    transcript.wish = wish.trim();

    // 2. The safety screen.
    let screened = await deps.screen(wish);
    transcript.screened = screened;
    if (screened.verdict === 'ask') {
      say(`\nBefore going on, the safety screen needs to know:\n${screened.question ?? 'Is this a request to test the app?'}`);
      const answer = await ask(null);
      transcript.clarification = { question: screened.question ?? '', answer };
      if (answer) screened = await deps.screen(`${wish.trim()}\n\nClarification, asked "${screened.question ?? ''}": ${answer}`);
      transcript.screened = screened;
    }
    if (screened.verdict !== 'proceed') {
      say(`\nThe safety screen did not let this through (${screened.verdict}, ${screened.category}):`);
      for (const reason of screened.reasons) say(`- ${reason}`);
      return finish(screened.verdict === 'refuse' ? 'refused' : 'unclear', `Not filed. The safety screen said ${screened.verdict}.`);
    }
    say(`Guardrail: safety screen passed (rules: ${screened.findings.length} findings, screener: ${screened.screener === 'ran' ? screened.verdict : 'not asked'})`);

    // 3. The question rounds.
    const open = await deps.source(options.source ?? 'local').list();
    const rounds = options.rounds ?? deps.maxRounds;
    say(`\nI will ask what the skeptic and the analyst would otherwise guess, in up to ${rounds} round${rounds === 1 ? '' : 's'}.`);
    say('Enter takes the assumption shown. Type skip to leave a question open.');
    const resolved = await converse(
      wish,
      {
        doubt: deps.doubt,
        analyse: deps.analyse,
        say: (line) => say(`\n${line}`),
        ask: async (q: Candidate, at) => {
          say(`\n${at.index} of ${at.of}${q.lens ? `  (${q.lens})` : '  (blocks testing)'}`);
          say(q.question.trim());
          if (q.assumed) say(`It would otherwise assume: ${q.assumed}`);
          return ask(q.assumed ? 'Your answer (Enter accepts the assumption, skip leaves it open):' : 'Your answer (skip leaves it open):');
        },
      },
      rounds,
    );
    transcript.rounds = resolved.rounds;
    transcript.ended = resolved.ended;
    if (resolved.ended === 'rounds') say('\nThe rounds are used up. What is still open goes on the ticket as a question.');

    // What the person typed is read by agents next, so it passes the rules too.
    const typed = resolved.rounds.flatMap((r: Round) => r.asked).filter((a) => a.by === 'user' && a.answer);
    const flagged = typed.flatMap((a) => screenRules(a.answer ?? ''));
    if (flagged.length > 0) {
      say('\nOne of the answers asks for something the pipeline will not do:');
      for (const f of flagged) say(`- ${f.rule}: "${f.excerpt}"`);
      transcript.screened = { ...screened, verdict: 'refuse', reasons: flagged.map((f) => `${f.rule}: "${f.excerpt}"`), findings: flagged };
      return finish('refused', 'Not filed. An answer failed the safety rules.');
    }

    // 4. The ticket, written the way `draft` writes it, from the wish and everything answered.
    say('\nWriting the ticket...');
    const { title, labels, body, problems } = await buildTicket(wish, resolved.rounds, open, { writer: deps.writer, checked: deps.checked, autoRun: deps.autoRun });
    transcript.ticket = { title, labels, body, problems };
    say(`\n${title}`);
    say(`Labels: ${labels.join(', ') || 'none'}\n`);
    say(body);
    if (problems.length > 0) say(`Not ready:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    say('\nGuardrail: nothing is filed without your yes.');

    // 5. Filing.
    const name = options.source ?? 'local';
    if (options.dry) return finish('not-filed', 'Not filed: this was a dry run.');
    if (name === 'local') return finish('not-filed', 'Not filed: the source is local, so there is nowhere to file it. Use --source github.');
    let go = Boolean(options.yes);
    for (let tries = 0; !go && tries < 3; tries++) {
      const answer = readYesNo(await ask(null, 'File this ticket? (yes/no) '));
      if (answer === null) {
        if (closed) break;
        say('Please answer yes or no.');
        continue;
      }
      go = answer;
      if (!go) break;
    }
    if (!go) return finish('not-filed', 'Not filed: you did not say yes.');
    const created = await deps.source(name).create({ title, body, labels });
    say(`\nFiled ${created.url ?? created.ref}.`);
    say(
      problems.length > 0
        ? `It is not ready yet. Answer the questions on the ticket, then add the \`${LABELS.analyze}\` label to have it analysed.`
        : deps.autoRun
          ? 'The analysis starts by itself; its report will appear on the ticket.'
          : `Add the \`${LABELS.analyze}\` label to have it analysed.`,
    );
    return finish('filed', `Filed ${created.url ?? created.ref}.`);
  } catch (error) {
    rl.close();
    throw error;
  }
}
