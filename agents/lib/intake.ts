import { withAnswers } from './draft.ts';
import type { Requirements, Skepticism } from './schemas.ts';
import type { Screened } from './safety.ts';

/**
 * The pure half of the intake conversation: which questions are worth asking, how a reply is read, how the answers
 * are written down for the agents and for the ticket, and the transcript. The agents and the keyboard are passed in,
 * so none of it needs a model or a terminal. agents/intake.ts holds the input and output.
 */

/** Who settled a question: the person, the person by accepting what would be assumed, or nobody yet. */
export type By = 'user' | 'accepted' | 'skipped';

export type Candidate = { question: string; lens: string | null; assumed: string | null };

/** A question that was put to the person, and what came of it. */
export type Asked = Candidate & { answer: string | null; by: By; round: number };

export type Round = { number: number; asked: Asked[] };

/** What the loop needs from the outside: the two agents, and a way to put one question to a person. */
export type Participants = {
  doubt: (wish: string, answers: string | null) => Promise<Skepticism>;
  analyse: (wish: string, answers: string | null, doubts: Skepticism) => Promise<Requirements>;
  /** Puts one question to the person and returns what they typed. */
  ask: (question: Candidate, position: { index: number; of: number }) => Promise<string>;
  /** Told when a round starts and when it ends, for the person to see. Optional. */
  say?: (line: string) => void;
};

/** Two spellings of the same question count as one. */
export const normalise = (question: string): string => question.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The questions not yet asked, once each, in order. A question the team has already answered is left out. */
export function unasked(candidates: (Candidate & { answered?: boolean })[], rounds: Round[]): Candidate[] {
  const seen = new Set(rounds.flatMap((round) => round.asked.map((a) => normalise(a.question))));
  const fresh: Candidate[] = [];
  for (const { answered, ...candidate } of candidates) {
    const key = normalise(candidate.question);
    if (answered || !key || seen.has(key)) continue;
    seen.add(key);
    fresh.push(candidate);
  }
  return fresh;
}

/** What a typed reply means. Enter takes the assumption when there is one; `skip` leaves the question open. */
export function readReply(raw: string, assumed: string | null): { answer: string | null; by: By } {
  const text = raw.trim();
  if (/^skip$/i.test(text)) return { answer: null, by: 'skipped' };
  if (!text) return assumed ? { answer: assumed, by: 'accepted' } : { answer: null, by: 'skipped' };
  return { answer: text, by: 'user' };
}

/** yes, y, no, n in any case. Anything else is not an answer. */
export function readYesNo(raw: string): boolean | null {
  const text = raw.trim().toLowerCase();
  if (text === 'y' || text === 'yes') return true;
  if (text === 'n' || text === 'no') return false;
  return null;
}

const how: Record<By, string> = { user: 'answered', accepted: 'accepted the assumption', skipped: 'left open' };

const reply = (a: Asked): string =>
  a.by === 'user' ? (a.answer ?? '') : a.by === 'accepted' ? `Accepted the assumption: ${a.answer}` : 'Not answered. Left open.';

/** The questions and answers so far, in the shape the ticket writer's second pass reads: `withAnswers` without the wish. Null when nothing was asked. */
export function answersText(rounds: Round[]): string | null {
  const asked = rounds.flatMap((round) => round.asked);
  if (asked.length === 0) return null;
  return withAnswers('', asked.map((a) => a.question), asked.map((a, i) => `${i + 1}. ${reply(a)}`).join('\n')).trim();
}

/** The wish with every question and answer after it, for the ticket writer. */
export function wishWithAnswers(wish: string, rounds: Round[]): string {
  const text = answersText(rounds);
  return text ? `${wish.trim()}\n\n${text}` : wish;
}

/** The heading the CI stages read the answers under. */
export const QA_HEADING = 'Questions and answers';

/** The section that goes on the ticket, after its technical notes. Empty when no question was asked. */
export function qaSection(rounds: Round[]): string {
  const asked = rounds.flatMap((round) => round.asked);
  if (asked.length === 0) return '';
  const items = asked.map((a) => {
    const reply = a.by === 'skipped' ? '_Left open._' : a.by === 'accepted' ? `${a.answer} _(accepted the assumption)_` : a.answer;
    return `- **${a.question.trim()}**\n  ${reply}`;
  });
  return `### ${QA_HEADING}\n\nAnswered by the person who asked for it, before the ticket was filed. Use these as given and do not ask them again.\n\n${items.join('\n')}\n`;
}

/** The ticket text with the questions and answers under their own heading. */
export const bodyWithAnswers = (body: string, rounds: Round[]): string => {
  const section = qaSection(rounds);
  return section ? `${body.trimEnd()}\n\n${section}` : body;
};

export type Resolved = { rounds: Round[]; ended: 'clear' | 'rounds' };

/**
 * The question rounds. Each round the skeptic reads the wish and the answers so far, and the person is asked what it
 * lists that has not been asked; then the analyst reads the same, and its blocking questions are asked too. The loop
 * ends when the analyst has nothing left to block on, or after `maxRounds`.
 */
export async function converse(wish: string, who: Participants, maxRounds: number): Promise<Resolved> {
  const rounds: Round[] = [];
  const say = who.say ?? (() => undefined);

  const put = async (round: Round, questions: Candidate[]): Promise<void> => {
    for (const [index, question] of questions.entries()) {
      const { answer, by } = readReply(await who.ask(question, { index: index + 1, of: questions.length }), question.assumed);
      round.asked.push({ ...question, answer, by, round: round.number });
    }
  };

  for (let number = 1; number <= maxRounds; number++) {
    const round: Round = { number, asked: [] };
    say(`Round ${number} of at most ${maxRounds}`);

    const doubts = await who.doubt(wish, answersText(rounds));
    await put(
      round,
      unasked(
        doubts.questions.map((d) => ({ question: d.question, lens: d.lens, assumed: d.assumed, answered: d.answer !== null })),
        rounds,
      ),
    );

    // The analyst reads the answers this round has just collected.
    const requirements = await who.analyse(wish, answersText([...rounds, round]), doubts);
    const blocking = unasked(
      requirements.openQuestions.filter((q) => q.blocking).map((q) => ({ question: q.question, lens: null, assumed: null })),
      [...rounds, round],
    );
    await put(round, blocking);
    if (round.asked.length > 0) rounds.push(round);
    if (blocking.length === 0) return { rounds, ended: 'clear' };
  }
  return { rounds, ended: 'rounds' };
}

/** How the whole conversation ended, which decides the exit code. */
export type Outcome = 'filed' | 'not-filed' | 'refused' | 'unclear';

/** 0 when the conversation ran its course, filed or not. 2 when the safety screen stopped it. */
export const exitCode = (outcome: Outcome): number => (outcome === 'refused' || outcome === 'unclear' ? 2 : 0);

export type Transcript = {
  wish: string;
  screened: Screened;
  /** The person's answer to the screener's question, when it asked one. */
  clarification: { question: string; answer: string } | null;
  rounds: Round[];
  ended: Resolved['ended'] | null;
  ticket: { title: string; labels: string[]; body: string; problems: string[] } | null;
  outcome: Outcome;
  /** Where it was filed, or why it was not. */
  result: string;
  cost: string;
};

/** The cost line: how many agent runs the conversation took and what the SDK estimates they cost. */
export function costLine(runs: { costUsd: number; seconds: number }[]): string {
  const cost = runs.reduce((sum, run) => sum + (Number.isFinite(run.costUsd) ? run.costUsd : 0), 0);
  const minutes = Math.round(runs.reduce((sum, run) => sum + run.seconds, 0) / 60);
  return `${runs.length} agent runs, estimated cost $${cost.toFixed(2)}, ${minutes} min.`;
}

const quote = (text: string): string => text.trim().split(/\r?\n/).map((line) => `> ${line}`).join('\n');

/** qa-run/intake.md: everything said, who settled each question, what was screened, and what became of the ticket. */
export function transcriptMd(t: Transcript): string {
  const { screened } = t;
  const rules = `${screened.findings.length} finding${screened.findings.length === 1 ? '' : 's'}`;
  const screener = screened.screener === 'ran' ? screened.verdict : 'not asked';
  const rounds = t.rounds.length
    ? t.rounds
        .map((round) => {
          const items = round.asked.map((a, i) => {
            const head = `${i + 1}. ${a.lens ? `[${a.lens}] ` : '[blocking] '}${a.question.trim()}`;
            const assumed = a.assumed ? `\n   It would otherwise assume: ${a.assumed}` : '';
            return `${head}${assumed}\n   Answer (${how[a.by]}): ${a.answer ?? 'none'}`;
          });
          return `### Round ${round.number}\n\n${items.join('\n\n')}`;
        })
        .join('\n\n')
    : 'No questions were asked.';
  const ended = t.ended === 'clear' ? 'The analyst had nothing left that blocks testing.' : t.ended === 'rounds' ? 'The rounds ran out before the questions did.' : '';
  const ticket = t.ticket
    ? `## Ticket

${t.ticket.title}

Labels: ${t.ticket.labels.join(', ') || 'none'}
${t.ticket.problems.length ? `\nNot ready:\n${t.ticket.problems.map((p) => `- ${p}`).join('\n')}\n` : ''}
${t.ticket.body.trim()}
`
    : '## Ticket\n\nNone was written.\n';
  return `# Intake conversation

## Wish

${quote(t.wish)}

## Safety screen

Verdict: ${screened.verdict}. Category: ${screened.category}. Rules: ${rules}. Screener: ${screener}.

${screened.reasons.map((r) => `- ${r}`).join('\n')}
${t.clarification ? `\nIt asked: ${t.clarification.question}\nThe answer: ${t.clarification.answer}\n` : ''}
## Questions and answers

${rounds}
${ended ? `\n${ended}\n` : ''}
${ticket}
## Outcome

${t.result}

${t.cost}
`;
}
