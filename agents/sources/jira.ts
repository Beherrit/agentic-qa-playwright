import { config } from '../lib/paths.ts';
import { adfToMarkdown, markdownToAdf } from './adf.ts';
import type { Source, Ticket } from './types.ts';

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

// Jira rejects comments over 32,767 characters.
const LIMIT = 30_000;

export const jira: Source = {
  async read(ref) {
    const extra = config.jira?.fields ?? {};
    const fields = ['summary', 'description', 'labels', ...Object.values(extra)].join(',');
    const issue = (await call('GET', `/rest/api/3/issue/${encodeURIComponent(ref)}?fields=${fields}`)) as {
      key: string;
      fields: Record<string, unknown>;
    };
    const sections = Object.entries(extra)
      .map(([name, id]) => [name, fieldText(issue.fields[id])] as const)
      .filter(([, value]) => value.trim())
      .map(([name, value]) => `## ${name}\n\n${value}`);
    return {
      ref: issue.key,
      url: `${settings().base}/browse/${issue.key}`,
      title: String(issue.fields.summary ?? ''),
      body: [fieldText(issue.fields.description), ...sections].filter(Boolean).join('\n\n'),
      labels: (issue.fields.labels as string[] | undefined) ?? [],
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
};
