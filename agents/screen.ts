import { runAgent } from './lib/agent.ts';
import { config, projectDoc } from './lib/paths.ts';
import { refusedByRules, screenRules, screeningMd, type Screened } from './lib/safety.ts';
import { Screening, type Request } from './lib/schemas.ts';
import { exists, load, prompt, save } from './lib/store.ts';

/**
 * The safety screen: fixed rules first, then a read-only agent for what rules cannot judge. Whatever the rules find is
 * final and costs nothing. Every requirement goes through it before an agent analyses it, and the intake conversation
 * screens the wish before it asks a single question.
 */

/** Asks the screener agent. Exported so the evaluation harness can call it with a case of its own. */
export async function askScreener(text: string): Promise<Screening> {
  const { output } = await runAgent({
    role: 'request-screener',
    instructions: prompt('request-screener'),
    task: `Decide whether the pipeline may act on this requirement for ${config.app.name} at ${config.app.baseUrl}.

<requirement>
${text}
</requirement>

<product-brief>
${projectDoc(config.app.brief)}
</product-brief>`,
    schema: Screening,
    access: 'read',
    maxTurns: 6,
  });
  return output;
}

type Options = {
  ask?: (text: string) => Promise<Screening>;
  /** The configuration's `safety` block. */
  safety?: { enabled: boolean; screener: boolean };
  hosts?: string[];
};

/** Screens text: rules, then the agent when the rules found nothing and the configuration allows it. */
export async function screenText(text: string, options: Options = {}): Promise<Screened> {
  const safety = options.safety ?? config.safety;
  if (!safety.enabled) {
    return { verdict: 'proceed', category: 'none', reasons: ['The safety screen is off in qa.config.json.'], question: null, findings: [], screener: 'skipped' };
  }
  const findings = screenRules(text, options.hosts);
  if (findings.length > 0) return refusedByRules(findings);
  if (!safety.screener) {
    return { verdict: 'proceed', category: 'none', reasons: ['No rule matched. The model screen is off.'], question: null, findings: [], screener: 'skipped' };
  }
  return { ...(await (options.ask ?? askScreener)(text)), findings: [], screener: 'ran' };
}

/** The requirement as the screen reads it: title, body and any answers the team gave. */
export const screenedText = (req: Pick<Request, 'title' | 'body' | 'answers'>): string =>
  `# ${req.title}\n\n${req.body}${req.answers ? `\n\nAnswers from the team:\n${req.answers}` : ''}`;

/**
 * Screens the requirement in the run folder and saves qa-run/screening.json and screening.md. A screening already in
 * the folder is reused, so the stages that each ask for it (the flow, then the requirements stage) pay once.
 */
export async function screen(req: Request): Promise<Screened> {
  if (exists('screening.json')) return load<Screened>('screening.json');
  const screened = await screenText(screenedText(req));
  save('screening.json', screened);
  save('screening.md', screeningMd(screened));
  return screened;
}

/** The screening of this run, or null when none has been made. */
export const screening = (): Screened | null => (exists('screening.json') ? load<Screened>('screening.json') : null);
