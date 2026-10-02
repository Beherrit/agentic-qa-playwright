import fs from 'node:fs';
import { artifactFor, keyFor, type SourceName } from './lib/keys.ts';
import { Request } from './lib/schemas.ts';
import { exists, reset, save, setOutput } from './lib/store.ts';
import { intakeTicket, sourceFor } from './sources/index.ts';
import * as stages from './stages.ts';

/**
 * The local flows that string stages together: reading a requirement in, and the analysis half. The CLI and the
 * MCP server both call these, so a run started from either does the same thing.
 */

export type RequirementInput = {
  /** github or jira, with ref. Anything else, or nothing, means the requirement is given as text. */
  source?: string;
  ref?: string;
  title?: string;
  text?: string;
  file?: string;
  testFirst?: boolean;
};

/** Whether the input names a requirement, as opposed to picking up the one already in the run folder. */
export const namesRequirement = (input: RequirementInput): boolean => input.source !== undefined || Boolean(input.text || input.file);

/** Reads the requirement in and starts a fresh run folder with it. */
export async function intake(input: RequirementInput): Promise<Request> {
  let request: Request;
  // An empty --source (a dispatch event without one) is an error, not a quiet fall back to a local run.
  if (input.source !== undefined && input.source !== 'local') {
    if (!input.ref) throw new Error('Give the ticket with --ref (an issue number or a ticket key).');
    request = await intakeTicket(input.source as SourceName, input.ref);
  } else {
    const body = input.file ? fs.readFileSync(input.file, 'utf8') : input.text;
    if (!body) throw new Error('Give the requirement with --source and --ref, or with --text "<words>" or --file <path>.');
    request = Request.parse({
      key: keyFor('local', ''),
      source: 'local',
      ref: 'local',
      url: null,
      title: input.title ?? body.split('\n')[0].slice(0, 80),
      body,
      mode: input.testFirst ? 'test-first' : 'built',
    });
  }
  // A new requirement starts from an empty run folder, so nothing left by the last one is mistaken for its own.
  reset();
  save('request.json', request);
  // The technical review checks related tickets against these. Its job has no tracker token, so they are kept now.
  try {
    save('open-tickets.json', await sourceFor(request.source).list());
  } catch (error) {
    console.warn(`Could not list the open tickets, so no related ticket will be kept: ${error instanceof Error ? error.message : error}`);
  }
  setOutput('key', request.key);
  setOutput('artifact', artifactFor(request.key));
  setOutput('mode', request.mode);
  console.log(`Requirement ${request.key} (${request.mode}): ${request.title}`);
  return request;
}

/**
 * The first half: requirement in, scored plan out. No test code. With `post` the analysis also goes on the ticket
 * and its labels move on, as in CI; without it the analysis is only saved to qa-run/analysis.md.
 */
export async function analyze(input: RequirementInput, options: { post: boolean; runUrl: string | null }): Promise<boolean> {
  if (!exists('request.json') || namesRequirement(input)) await intake(input);
  let ok = await stages.requirements();
  if (ok) {
    await stages.technical();
    await Promise.all([stages.plan(), stages.critic()]);
    ok = await stages.reconcile();
  }
  await stages.notifyAnalysis(options.runUrl, { post: options.post });
  return ok;
}
