import { config } from '../lib/paths.ts';
import { htmlToMarkdown, markdownToHtml } from './html.ts';
import type { NewTicket, OpenTicket, Source, Ticket } from './types.ts';

/**
 * Azure DevOps Boards, through its REST API. Needs three settings in the environment:
 *   AZURE_DEVOPS_ORG_URL   https://dev.azure.com/your-org
 *   AZURE_DEVOPS_PROJECT   the project name
 *   AZURE_DEVOPS_PAT       a personal access token with Work Items read and write
 * Labels are tags. A work item's description and acceptance criteria are HTML, read back as markdown.
 */

const API = '7.1';

function settings(): { base: string; auth: string; project: string } {
  const org = (process.env.AZURE_DEVOPS_ORG_URL ?? '').replace(/\/+$/, '');
  const { AZURE_DEVOPS_PROJECT: project, AZURE_DEVOPS_PAT: pat } = process.env;
  if (!/^https:\/\/[^/\s]+\/[^/\s]+$/.test(org) || !project || !pat) {
    throw new Error('Azure DevOps is not configured. Set AZURE_DEVOPS_ORG_URL (https://dev.azure.com/<org>), AZURE_DEVOPS_PROJECT and AZURE_DEVOPS_PAT.');
  }
  return { base: `${org}/${encodeURIComponent(project)}/_apis`, auth: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`, project };
}

async function call(method: string, route: string, body?: unknown, contentType = 'application/json'): Promise<unknown> {
  const { base, auth } = settings();
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': contentType },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Azure DevOps ${method} ${route} answered ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.status === 204 ? null : response.json();
}

type WorkItem = { id: number; fields: Record<string, unknown>; _links?: { html?: { href?: string } } };

/** Tags come as one string, "a; b; c". */
export const splitTags = (tags: unknown): string[] =>
  String(tags ?? '')
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean);

/** A work item as a ticket: the title, the description and the acceptance criteria as markdown, the tags as labels. */
export function ticketFromWorkItem(item: WorkItem, extraFields: Record<string, string> = {}): Ticket {
  const f = item.fields;
  const sections = [
    htmlToMarkdown(String(f['System.Description'] ?? '')),
    ...(f['Microsoft.VSTS.Common.AcceptanceCriteria'] ? [`## Acceptance criteria\n\n${htmlToMarkdown(String(f['Microsoft.VSTS.Common.AcceptanceCriteria']))}`] : []),
    ...Object.entries(extraFields)
      .filter(([, id]) => f[id])
      .map(([name, id]) => `## ${name}\n\n${htmlToMarkdown(String(f[id]))}`),
  ].filter((s) => s.trim());
  return {
    ref: String(item.id),
    url: item._links?.html?.href ?? null,
    title: String(f['System.Title'] ?? ''),
    body: sections.join('\n\n'),
    labels: splitTags(f['System.Tags']),
  };
}

export const azure: Source = {
  async read(ref) {
    const item = (await call('GET', `/wit/workitems/${encodeURIComponent(ref)}?api-version=${API}`)) as WorkItem;
    return ticketFromWorkItem(item, config.jira.fields);
  },

  async comment(ref, markdown) {
    await call('POST', `/wit/workItems/${encodeURIComponent(ref)}/comments?api-version=${API}-preview.4`, { text: markdownToHtml(markdown) });
  },

  async label(ref, change) {
    const item = (await call('GET', `/wit/workitems/${encodeURIComponent(ref)}?fields=System.Tags&api-version=${API}`)) as WorkItem;
    const tags = new Set(splitTags(item.fields['System.Tags']));
    for (const name of change.add ?? []) tags.add(name);
    for (const name of change.remove ?? []) tags.delete(name);
    await call('PATCH', `/wit/workitems/${encodeURIComponent(ref)}?api-version=${API}`, [{ op: 'add', path: '/fields/System.Tags', value: [...tags].join('; ') }], 'application/json-patch+json');
  },

  async list() {
    const { project } = settings();
    const found = (await call('POST', `/wit/wiql?api-version=${API}`, {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project.replace(/'/g, "''")}' AND [System.State] NOT IN ('Closed', 'Done', 'Removed') ORDER BY [System.ChangedDate] DESC`,
    })) as { workItems?: { id: number }[] };
    const ids = (found.workItems ?? []).slice(0, 200).map((w) => w.id);
    if (ids.length === 0) return [];
    const items = (await call('GET', `/wit/workitems?ids=${ids.join(',')}&fields=System.Title&api-version=${API}`)) as { value: WorkItem[] };
    return items.value.map((item): OpenTicket => ({ ref: String(item.id), title: String(item.fields['System.Title'] ?? ''), url: item._links?.html?.href ?? null }));
  },

  async create(ticket: NewTicket) {
    const patch = [
      { op: 'add', path: '/fields/System.Title', value: ticket.title },
      { op: 'add', path: '/fields/System.Description', value: markdownToHtml(ticket.body) },
      ...(ticket.labels.length ? [{ op: 'add', path: '/fields/System.Tags', value: ticket.labels.join('; ') }] : []),
    ];
    const item = (await call('POST', `/wit/workitems/$User%20Story?api-version=${API}`, patch, 'application/json-patch+json')) as WorkItem;
    return { ref: String(item.id), url: item._links?.html?.href ?? null };
  },
};
