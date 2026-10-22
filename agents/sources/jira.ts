import { config } from '../lib/paths.ts';
import { adfToMarkdown, markdownToAdf } from './adf.ts';
import { TASK_LABEL } from '../lib/tasks.ts';
import type { ChildTask, RelatedTicket, Source, Ticket } from './types.ts';

/**
 * Jira Cloud, through its REST API (v3). Needs three settings in the environment:
 *   JIRA_BASE_URL   https://your-site.atlassian.net
 *   JIRA_EMAIL      the account the API token belongs to
 *   JIRA_API_TOKEN  an API token from id.atlassian.com
 */

function settings(): { base: string; auth: string } {
  const base = (process.env.JIRA_BASE_URL ?? '').replace(/\/+$/, '');
  const { JIRA_EMAIL: email, JIRA_API_TOKEN: token } = process.env;
  if (!/^https:\/\/[^/\s]+$/.test(base) || !email || !token) {
    throw new Error('Jira is not configured. Set JIRA_BASE_URL (https://...), JIRA_EMAIL and JIRA_API_TOKEN.');
  }
  return { base, auth: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` };
}

async function call(method: string, route: string, body?: unknown): Promise<unknown> {
  const { base, auth } = settings();
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Jira ${method} ${route} answered ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return response.status === 204 ? null : response.json();
}

/** A field's value as markdown, whether Jira holds it as ADF, plain text or a list of options. */
function fieldText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(fieldText).join(', ');
  if (typeof value === 'object' && 'type' in value) return adfToMarkdown(value);
  if (typeof value === 'object' && 'value' in value) return String((value as { value: unknown }).value);
  return JSON.stringify(value);
}

type JiraRef = { key: string; fields?: { summary?: string; status?: { name?: string } } };
type JiraLink = { type?: { inward?: string; outward?: string }; inwardIssue?: JiraRef; outwardIssue?: JiraRef };

/**
 * The tickets around one, from its fields: the parent (an epic or a story), its subtasks and every issue link, with the
 * link's own wording ("blocks", "is blocked by"). Each key once, the first relation found winning. Exported for the tests.
 */
export function relationsOf(key: string, fields: { parent?: JiraRef; subtasks?: JiraRef[]; issuelinks?: JiraLink[] }): { key: string; relation: string; title: string; status: string | null }[] {
  const found = new Map<string, { key: string; relation: string; title: string; status: string | null }>();
  const add = (ref: JiraRef | undefined, relation: string) => {
    if (!ref?.key || ref.key === key || found.has(ref.key)) return;
    found.set(ref.key, { key: ref.key, relation, title: ref.fields?.summary ?? '', status: ref.fields?.status?.name ?? null });
  };
  add(fields.parent, 'parent');
  for (const sub of fields.subtasks ?? []) add(sub, 'subtask');
  for (const link of fields.issuelinks ?? []) {
    if (link.outwardIssue) add(link.outwardIssue, link.type?.outward ?? 'linked');
    if (link.inwardIssue) add(link.inwardIssue, link.type?.inward ?? 'linked');
  }
  return [...found.values()];
}

/** Runs a JQL search and returns the issues with the fields asked for. */
async function search(jql: string, fields: string[], max = 50): Promise<{ key: string; fields: Record<string, unknown> }[]> {
  const route = `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields.join(',')}&maxResults=${max}`;
  const result = (await call('GET', route)) as { issues?: { key: string; fields: Record<string, unknown> }[] };
  return result.issues ?? [];
}

const quoted = (value: string): string => `"${value.replace(/["\\]/g, '\\$&')}"`;

// Jira rejects comments over 32,767 characters.
const LIMIT = 30_000;

export const jira: Source = {
  async read(ref) {
    const extra = config.jira?.fields ?? {};
    const fields = ['summary', 'description', 'labels', 'comment', ...Object.values(extra)].join(',');
    const issue = (await call('GET', `/rest/api/3/issue/${encodeURIComponent(ref)}?fields=${fields}`)) as {
      key: string;
      fields: Record<string, unknown>;
    };
    const sections = Object.entries(extra)
      .map(([name, id]) => [name, fieldText(issue.fields[id])] as const)
      .filter(([, value]) => value.trim())
      .map(([name, value]) => `## ${name}\n\n${value}`);
    // Anyone who can comment on a Jira ticket is in the project, so every comment counts as trusted.
    const comments = ((issue.fields.comment as { comments?: { author?: { displayName?: string }; body?: unknown }[] } | undefined)?.comments ?? []).map((c) => ({
      author: c.author?.displayName ?? 'unknown',
      trusted: true,
      body: fieldText(c.body),
    }));
    return {
      ref: issue.key,
      url: `${settings().base}/browse/${issue.key}`,
      title: String(issue.fields.summary ?? ''),
      body: [fieldText(issue.fields.description), ...sections].filter(Boolean).join('\n\n'),
      labels: (issue.fields.labels as string[] | undefined) ?? [],
      comments,
    } satisfies Ticket;
  },

  async comment(ref, markdown) {
    const body = markdown.length > LIMIT ? `${markdown.slice(0, LIMIT)}\n\n(Cut short. The full report is in the run linked above.)` : markdown;
    try {
      await call('POST', `/rest/api/3/issue/${encodeURIComponent(ref)}/comment`, { body: markdownToAdf(body) });
    } catch (error) {
      // If Jira does not like the converted document, the words still matter more than the layout.
      console.warn(`Formatted comment refused, posting plain text instead. ${error instanceof Error ? error.message : error}`);
      const plain = { type: 'doc', version: 1, content: [{ type: 'codeBlock', content: [{ type: 'text', text: body }] }] };
      await call('POST', `/rest/api/3/issue/${encodeURIComponent(ref)}/comment`, { body: plain });
    }
  },

  async label(ref, change) {
    const labels = [...(change.add ?? []).map((add) => ({ add })), ...(change.remove ?? []).map((remove) => ({ remove }))];
    if (labels.length) await call('PUT', `/rest/api/3/issue/${encodeURIComponent(ref)}`, { update: { labels } });
  },

  // A JQL search needs a project key, and the config does not have one yet.
  async list() {
    return [];
  },

  async create() {
    throw new Error('Creating Jira tickets is not built yet. File the ticket by hand, or use --source github.');
  },

  async related(ref, limit) {
    const issue = (await call('GET', `/rest/api/3/issue/${encodeURIComponent(ref)}?fields=parent,subtasks,issuelinks`)) as {
      key: string;
      fields: { parent?: JiraRef; subtasks?: JiraRef[]; issuelinks?: JiraLink[] };
    };
    const refs = relationsOf(issue.key, issue.fields);
    // An epic's or a story's children are not on the issue itself; they point at it as their parent.
    try {
      for (const child of await search(`parent = ${quoted(issue.key)}`, ['summary', 'status'])) {
        if (!refs.some((r) => r.key === child.key)) {
          refs.push({ key: child.key, relation: 'child', title: String(child.fields.summary ?? ''), status: (child.fields.status as { name?: string } | undefined)?.name ?? null });
        }
      }
    } catch {
      // A site without the search API leaves the children out; the rest still counts.
    }
    const related: RelatedTicket[] = [];
    for (const r of refs) {
      let body = '';
      let labels: string[] = [];
      try {
        const full = (await call('GET', `/rest/api/3/issue/${encodeURIComponent(r.key)}?fields=labels${related.length < limit ? ',description' : ''}`)) as {
          fields: { description?: unknown; labels?: string[] };
        };
        labels = full.fields.labels ?? [];
        body = related.length < limit ? fieldText(full.fields.description) : '';
      } catch {
        // Not readable with this token: listed by title only.
      }
      // The pipeline's own per-layer tasks are its earlier output, not context: reading them back would copy the old plan.
      if (labels.includes(TASK_LABEL)) continue;
      related.push({ ref: r.key, relation: r.relation, title: r.title, status: r.status, url: `${settings().base}/browse/${r.key}`, body });
      if (related.length >= 30) break;
    }
    return related;
  },

  async children(ref, label) {
    // The parent's own subtask list, not a search: a search may not show a subtask filed a moment ago, and a task that
    // is not found is filed twice.
    const parent = (await call('GET', `/rest/api/3/issue/${encodeURIComponent(ref)}?fields=subtasks`)) as { fields: { subtasks?: JiraRef[] } };
    const tasks: ChildTask[] = [];
    for (const sub of parent.fields.subtasks ?? []) {
      const full = (await call('GET', `/rest/api/3/issue/${encodeURIComponent(sub.key)}?fields=summary,description,labels`)) as {
        key: string;
        fields: { summary?: string; description?: unknown; labels?: string[] };
      };
      const labels = full.fields.labels ?? [];
      if (labels.includes(label)) {
        tasks.push({ ref: full.key, title: String(full.fields.summary ?? ''), body: fieldText(full.fields.description), labels, url: `${settings().base}/browse/${full.key}` });
      }
    }
    return tasks;
  },

  async createChild(parent, task) {
    const project = parent.split('-')[0];
    const created = (await call('POST', '/rest/api/3/issue', {
      fields: {
        project: { key: project },
        parent: { key: parent },
        issuetype: { name: config.jira.subtaskType },
        summary: task.title,
        description: markdownToAdf(task.body),
        labels: task.labels,
      },
    })) as { key: string };
    return { ref: created.key, url: `${settings().base}/browse/${created.key}` };
  },

  async updateChild(ref, task) {
    await call('PUT', `/rest/api/3/issue/${encodeURIComponent(ref)}`, { fields: { summary: task.title, description: markdownToAdf(task.body) } });
  },
};
