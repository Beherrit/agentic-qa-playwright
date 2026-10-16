import { api, type Ticket, type Tracker } from './types.ts';

/**
 * Jira Cloud as the tracker. The REST v3 API wants comment and description bodies in Atlassian Document Format, so
 * the markdown the agents write is turned into plain ADF paragraphs: good enough to read, and nothing is lost.
 */

type Issue = {
  key: string;
  fields: {
    summary: string;
    description: unknown;
    status: { name: string };
    reporter: { displayName: string } | null;
    labels: string[];
    comment?: { comments: { author: { displayName: string }; body: unknown; created: string }[] };
  };
};

export class JiraTracker implements Tracker {
  constructor(
    private base: string,
    private email: string,
    private token: string,
    private projectKey: string,
  ) {}

  private get auth(): string {
    return `${this.email}:${this.token}`;
  }

  private toTicket(issue: Issue): Ticket {
    return {
      key: issue.key,
      url: `${this.base}/browse/${issue.key}`,
      title: issue.fields.summary,
      body: adfToText(issue.fields.description),
      status: issue.fields.status.name,
      reporter: issue.fields.reporter?.displayName ?? 'unknown',
      labels: issue.fields.labels,
      comments: (issue.fields.comment?.comments ?? []).map((c) => ({ author: c.author.displayName, body: adfToText(c.body), at: c.created })),
    };
  }

  async getTicket(key: string): Promise<Ticket> {
    const issue = await api<Issue>(`${this.base}/rest/api/3/issue/${key}?fields=summary,description,status,reporter,labels,comment`, { basic: this.auth });
    return this.toTicket(issue);
  }

  async searchTickets(text: string, limit: number): Promise<Ticket[]> {
    const jql = `project = ${this.projectKey} AND text ~ ${JSON.stringify(text)} ORDER BY updated DESC`;
    const found = await api<{ issues: Issue[] }>(`${this.base}/rest/api/3/search/jql`, {
      basic: this.auth,
      method: 'POST',
      body: JSON.stringify({ jql, maxResults: limit, fields: ['summary', 'description', 'status', 'reporter', 'labels'] }),
    });
    return found.issues.map((i) => this.toTicket(i));
  }

  async createTicket(title: string, body: string, labels: string[]): Promise<Ticket> {
    const made = await api<{ key: string }>(`${this.base}/rest/api/3/issue`, {
      basic: this.auth,
      method: 'POST',
      body: JSON.stringify({ fields: { project: { key: this.projectKey }, summary: title, description: textToAdf(body), issuetype: { name: 'Story' }, labels } }),
    });
    return this.getTicket(made.key);
  }

  async comment(key: string, body: string): Promise<string> {
    const made = await api<{ id: string }>(`${this.base}/rest/api/3/issue/${key}/comment`, { basic: this.auth, method: 'POST', body: JSON.stringify({ body: textToAdf(body) }) });
    return `${this.base}/browse/${key}?focusedCommentId=${made.id}`;
  }
}

type AdfNode = { type: string; text?: string; content?: AdfNode[] };

export function textToAdf(text: string): AdfNode {
  const paragraphs = text.split(/\n{2,}/).map((block) => ({
    type: 'paragraph',
    content: block
      .split('\n')
      .flatMap((line, i) => (i ? [{ type: 'hardBreak' }, { type: 'text', text: line || ' ' }] : [{ type: 'text', text: line || ' ' }])),
  }));
  return { type: 'doc', version: 1, content: paragraphs } as AdfNode;
}

export function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return typeof node === 'string' ? node : '';
  const n = node as AdfNode;
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return '\n';
  const inner = (n.content ?? []).map(adfToText).join('');
  return n.type === 'paragraph' || n.type === 'heading' || n.type === 'listItem' ? `${inner}\n` : inner;
}
