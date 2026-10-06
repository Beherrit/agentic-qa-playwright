import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../lib/paths.ts';
import { repoAt } from '../lib/repo.ts';
import type { Request } from '../lib/schemas.ts';
import { Case, evaluate, type CaseResult } from './checks.ts';

/** Reading the cases and the recorded answers, and running the cases through the stages. */

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CASES_DIR = path.join(HERE, 'cases');
export const FIXTURES_DIR = path.join(HERE, 'fixtures');

/** Every case file, validated. A broken case names its file. */
export function loadCases(dir = CASES_DIR): Case[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const parsed = Case.safeParse(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
      if (!parsed.success) throw new Error(`${name}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      if (`${parsed.data.id}.json` !== name) throw new Error(`${name}: the id "${parsed.data.id}" does not match the file name.`);
      return parsed.data;
    });
}

/** The recorded answer for a case, made by hand in the stage's schema. */
export function loadFixture(id: string, dir = FIXTURES_DIR): unknown {
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`No recorded answer for "${id}": add ${path.relative(ROOT, file)}.`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Runs every case's checks against its recorded answer. No agent is called. */
export function dryRun(cases: Case[], fixtures = FIXTURES_DIR): CaseResult[] {
  const repo = repoAt(ROOT);
  return cases.map((c) => {
    try {
      return evaluate(c, loadFixture(c.id, fixtures), repo);
    } catch (error) {
      return { id: c.id, stage: c.stage, checks: [], error: error instanceof Error ? error.message : String(error) };
    }
  });
}

const requestFor = (c: Case): Request => ({
  key: 'REQ-0',
  source: 'local',
  ref: 'local',
  url: null,
  title: c.input.title ?? '',
  body: c.input.body ?? '',
  mode: c.input.mode,
});

/** Asks the real agent for one case. The stages are loaded here, so a dry run never loads them. */
async function ask(c: Case): Promise<unknown> {
  const open = c.input.openTickets.map((t) => ({ ref: t.ref, title: t.title, url: t.url }));
  if (c.stage === 'draft') return (await import('../draft.ts')).writeTicket(c.input.wish ?? '', open);
  // The screen cases test the model's judgment, so they ask the screener directly. The rules would settle most of them for free.
  if (c.stage === 'screen') return (await import('../screen.ts')).askScreener(`# ${c.input.title}

${c.input.body}`);
  const stages = await import('../stages.ts');
  if (c.stage === 'skeptic') return stages.doubt(requestFor(c));
  if (c.stage === 'requirements') return stages.analyse(requestFor(c));
  return stages.reviewTechnically(requestFor(c), c.input.requirements ?? '', open);
}

/** Runs every case through the real agent stage, `repeat` times each, and checks each answer. */
export async function liveRun(cases: Case[], repeat = 1): Promise<CaseResult[]> {
  const repo = repoAt(ROOT);
  const results: CaseResult[] = [];
  for (const c of cases) {
    for (let i = 1; i <= repeat; i++) {
      const id = repeat > 1 ? `${c.id} #${i}` : c.id;
      try {
        results.push({ ...evaluate(c, await ask(c), repo), id });
      } catch (error) {
        results.push({ id, stage: c.stage, checks: [], error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return results;
}
