import { createHash } from 'node:crypto';
import type { ChildTask } from '../sources/types.ts';
import { isE2e, type Layer } from './layers.ts';
import type { Request, Strategy, TestCase } from './schemas.ts';

/**
 * Per-layer tasks: one task under the ticket for each layer the plan puts cases at, holding those cases as a
 * checklist for the people who own the layer. The plan stays the source of truth: a task is written again only when
 * its layer's part of the plan changed (a fingerprint in the task says which plan it was written from), it is found
 * again by its labels rather than by its title, and nothing is ever closed or deleted by the pipeline.
 * Pure functions; agents/tasks.ts talks to the tracker.
 */

/** Every task the pipeline files carries this label, and a second one naming its layer. */
export const TASK_LABEL = 'qa-task';
export const layerLabel = (id: string): string => `qa-layer-${id}`;

export type LayerTask = { layer: Layer; title: string; body: string; labels: string[]; fingerprint: string; cases: number };

/** A short, stable hash of what a task says: its layer's cases and who owns them. Order and wording both count. */
export function taskFingerprint(layer: Layer, cases: TestCase[]): string {
  const material = cases.map((c) => [c.id, c.title, c.criteria, c.technique, c.priority, c.persona, c.steps, c.expected, c.layerReason]);
  return createHash('sha1')
    .update(JSON.stringify([layer.id, layer.name, layer.owner, layer.tools, material]))
    .digest('hex')
    .slice(0, 12);
}

const FINGERPRINT_LINE = /Plan fingerprint: ([0-9a-f]{12})\b/;

/** The fingerprint a task was written with, or null for a task someone wrote by hand. */
export const fingerprintIn = (body: string): string | null => FINGERPRINT_LINE.exec(body)?.[1] ?? null;

/** How a task's first line points at its ticket: "#12" on GitHub, the key elsewhere. */
const parentRef = (request: Pick<Request, 'source' | 'ref'>): string => (request.source === 'github' ? `#${request.ref}` : request.ref);

/** One case as a checklist item, with its steps and expected result under it. */
function caseItem(c: TestCase): string {
  const steps = c.steps.map((step, i) => `   ${i + 1}. ${step}`).join('\n');
  return `- [ ] **${c.id}** ${c.title} (${c.criteria.join(', ')}). ${c.priority}, ${c.technique}, as ${c.persona || 'the default persona'}.
${steps}
   Expected: ${c.expected}`;
}

/** The tasks the plan calls for, in the project's layer order. `only` limits them to some layer ids. */
export function tasksFor(
  request: Pick<Request, 'key' | 'ref' | 'source' | 'title'>,
  strategy: Pick<Strategy, 'cases'>,
  layers: Layer[],
  only: string[] = [],
): LayerTask[] {
  const tasks: LayerTask[] = [];
  for (const layer of layers) {
    if (only.length && !only.includes(layer.id)) continue;
    const cases = strategy.cases.filter((c) => c.layer === layer.id);
    if (!cases.length) continue;
    const fingerprint = taskFingerprint(layer, cases);
    const who = [layer.owner, layer.tools].filter(Boolean).join(', ');
    const automated = isE2e(layers, { layer: layer.id })
      ? '\n\nThe pipeline writes these as Playwright tests when the ticket gets the `qa-generate` label; this list tracks them.'
      : '';
    const body = `Part of ${parentRef(request)}

**${layer.name}**${who ? ` (${who})` : ''}: the test cases the QA plan for ${request.key} puts at this layer. ${layer.proves} Tick each one off once it is written and passing.${automated}

${cases.map(caseItem).join('\n')}

Plan fingerprint: ${fingerprint}. Written by agentic-qa from the analysis; change the plan, not this list, and run \`npx agentic-qa tasks\` again.`;
    tasks.push({ layer, title: `[QA] ${layer.name} for ${request.key}: ${request.title}`.slice(0, 250), body, labels: [TASK_LABEL, layerLabel(layer.id)], fingerprint, cases: cases.length });
  }
  return tasks;
}

export type SyncPlan = {
  create: LayerTask[];
  update: { task: LayerTask; ref: string }[];
  unchanged: { task: LayerTask; ref: string }[];
  /** Tasks filed before for a layer that has no cases now. Reported, never closed: a person decides. */
  stale: ChildTask[];
};

/**
 * What has to happen on the tracker: the tasks to file, to rewrite, to leave alone, and the ones the plan left behind.
 * With `only`, a task for a layer outside it is out of this run's scope, not stale.
 */
export function planSync(wanted: LayerTask[], existing: ChildTask[], only: string[] = []): SyncPlan {
  const result: SyncPlan = { create: [], update: [], unchanged: [], stale: [] };
  const claimed = new Set<string>();
  for (const task of wanted) {
    const match = existing.find((e) => !claimed.has(e.ref) && e.labels.includes(layerLabel(task.layer.id)));
    if (!match) {
      result.create.push(task);
      continue;
    }
    claimed.add(match.ref);
    if (fingerprintIn(match.body) === task.fingerprint) result.unchanged.push({ task, ref: match.ref });
    else result.update.push({ task, ref: match.ref });
  }
  const inScope = (e: ChildTask): boolean => !only.length || only.some((id) => e.labels.includes(layerLabel(id)));
  result.stale = existing.filter((e) => !claimed.has(e.ref) && e.labels.includes(TASK_LABEL) && inScope(e));
  return result;
}

/** The outcome, for the log and the run folder. */
export function syncMd(request: Pick<Request, 'key'>, plan: SyncPlan, done: { ref: string; url: string | null; layer: string; action: string }[], dry: boolean): string {
  const rows = [
    ...plan.create.map((t) => `- ${dry ? 'Would file' : 'Filed'} ${t.layer.name}: ${t.cases} case(s)${linkFor(done, t.layer.id)}`),
    ...plan.update.map((u) => `- ${dry ? 'Would update' : 'Updated'} ${u.ref} (${u.task.layer.name}): the plan changed${linkFor(done, u.task.layer.id)}`),
    ...plan.unchanged.map((u) => `- ${u.ref} (${u.task.layer.name}) is up to date`),
    ...plan.stale.map((s) => `- ${s.ref} "${s.title}" has no cases in the plan any more; left open for a person to close`),
  ];
  return `## Per-layer tasks for ${request.key}${dry ? ' (dry run)' : ''}\n\n${rows.join('\n') || '- The plan has no cases on the chosen layers.'}\n`;
}

const linkFor = (done: { url: string | null; layer: string }[], layer: string): string => {
  const url = done.find((d) => d.layer === layer)?.url;
  return url ? `: ${url}` : '';
};
