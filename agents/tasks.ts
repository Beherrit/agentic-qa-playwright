import { config } from './lib/paths.ts';
import type { Request, Strategy } from './lib/schemas.ts';
import { exists, jobSummary, load, save } from './lib/store.ts';
import { planSync, syncMd, tasksFor, TASK_LABEL } from './lib/tasks.ts';
import { sourceFor } from './sources/index.ts';

/**
 * `npx agentic-qa tasks`: files or updates one task per layer under the ticket, from the plan in qa-run/. Runs where
 * the tracker token is (the report job, or your machine), never in a job that runs an agent. A dry run says what it
 * would do and touches nothing. Exported for the CLI and for notifyAnalysis.
 */
export async function syncTasks(options: { layers?: string[]; dry?: boolean } = {}): Promise<string> {
  if (!exists('request.json') || !exists('strategy.json')) throw new Error('There is no plan in qa-run/ yet. Run the analysis first.');
  const request = load<Request>('request.json');
  const strategy = load<Strategy>('strategy.json');
  const only = options.layers?.length ? options.layers : config.tasks.layers;
  const unknown = only.filter((id) => !config.layers.some((layer) => layer.id === id));
  if (unknown.length) {
    throw new Error(`Unknown layer(s): ${unknown.join(', ')}. This project's layers are ${config.layers.map((l) => l.id).join(', ')}.`);
  }
  const wanted = tasksFor(request, strategy, config.layers, only);
  const source = sourceFor(request.source);

  // A local run, or a tracker without child tasks, prints what would be filed.
  if (request.source === 'local' || !source.children || !source.createChild || !source.updateChild) {
    if (request.source !== 'local') console.log(`Per-layer tasks are built for GitHub and Jira; ${request.source} prints them instead.`);
    const markdown = wanted.map((t) => `### ${t.title}\n\n${t.body}`).join('\n\n') || 'The plan has no cases on the chosen layers.';
    console.log(`\n${markdown}`);
    return markdown;
  }

  const existing = await source.children(request.ref, TASK_LABEL);
  const plan = planSync(wanted, existing, only);
  const done: { ref: string; url: string | null; layer: string; action: string }[] = [];
  if (!options.dry) {
    for (const task of plan.create) {
      const created = await source.createChild(request.ref, { title: task.title, body: task.body, labels: task.labels });
      done.push({ ...created, layer: task.layer.id, action: 'created' });
    }
    for (const { task, ref } of plan.update) {
      await source.updateChild(ref, { title: task.title, body: task.body });
      done.push({ ref, url: null, layer: task.layer.id, action: 'updated' });
    }
  }
  const markdown = syncMd(request, plan, done, Boolean(options.dry));
  if (!options.dry) save('tasks.md', markdown);
  jobSummary(markdown);
  console.log(markdown);
  return markdown;
}
