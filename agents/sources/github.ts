import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OpenIssue, OpenPull } from '../lib/status.ts';
import type { ChildTask, RelatedTicket, Source, Ticket, TicketComment } from './types.ts';

/**
 * GitHub issues, through the gh CLI. In Actions, gh reads GH_TOKEN and GH_REPO from the environment.
 * Arguments go to gh directly, never through a shell, so a title or body is only ever data.
 */

const gh = (...args: string[]): string => execFileSync('gh', args, { encoding: 'utf8' });

/** The author associations GitHub reports for people who belong to the repository. Anyone else is a visitor. */
export const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR'];

type GhComment = { author?: { login?: string }; authorAssociation?: string; body?: string };

/** Comments as gh lists them, with the author's standing worked out from the association GitHub reports. */
export function commentsFrom(comments: GhComment[] | undefined): TicketComment[] {
  return (comments ?? []).map((c) => ({
    author: c.author?.login ?? 'unknown',
    trusted: TRUSTED.includes(c.authorAssociation ?? ''),
    body: c.body ?? '',
  }));
}

/**
 * The issues a body points at, with how: "Part of #12" is the parent, "blocked by #7" a dependency, any other #n a
 * mention. Each number once, in the order they first appear, the strongest relation winning; never the issue itself.
 */
export function mentionedIssues(body: string, self: string): { ref: string; relation: string }[] {
  const named: [RegExp, string][] = [
    [/\b(?:part of|child of|sub-issue of|parent(?: issue)?:?|epic:?)\s+#(\d+)/gi, 'parent'],
    [/\b(?:blocked by|depends on)\s+#(\d+)/gi, 'blocked by'],
    [/\bblocks\s+#(\d+)/gi, 'blocks'],
    [/\b(?:duplicate of|duplicates)\s+#(\d+)/gi, 'duplicate of'],
    [/\b(?:related to|relates to|see also)\s+#(\d+)/gi, 'related'],
  ];
  const found = new Map<string, { ref: string; relation: string; at: number }>();
  for (const [pattern, relation] of named) {
    for (const match of body.matchAll(pattern)) if (!found.has(match[1])) found.set(match[1], { ref: match[1], relation, at: match.index });
  }
  // A bare mention, not inside a word or a URL fragment such as "page#3".
  for (const match of body.matchAll(/(?:^|[\s(,;:])#(\d+)\b/g)) {
    if (!found.has(match[1])) found.set(match[1], { ref: match[1], relation: 'mentioned', at: match.index });
  }
  return [...found.values()].filter((m) => m.ref !== self.replace(/^#/, '')).sort((a, b) => a.at - b.at).map(({ ref, relation }) => ({ ref, relation }));
}

type GhIssue = { number: number; title: string; body?: string | null; state?: string; html_url?: string; url?: string; labels?: ({ name?: string } | string)[] };

const labelNames = (labels: GhIssue['labels']): string[] => (labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean);

/** The sub-issues GitHub holds for an issue. Empty when the repository has none or the API is not there. */
function subIssues(ref: string): GhIssue[] {
  try {
    return JSON.parse(gh('api', `repos/{owner}/{repo}/issues/${ref}/sub_issues?per_page=50`)) as GhIssue[];
  } catch {
    return [];
  }
}

function writeTemp(prefix: string, text: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), 'body.md');
  fs.writeFileSync(file, text);
  return file;
}

/** Makes the label if it is missing. */
function ensureLabel(name: string): void {
  try {
    gh('label', 'create', name, '--color', 'D93F0B');
  } catch {
    // It exists already.
  }
}

/** Open issues with their labels, and open pull requests with their branches. Read only. */
export function openWork(): { issues: OpenIssue[]; pulls: OpenPull[] } {
  const issues = JSON.parse(gh('issue', 'list', '--state', 'open', '--limit', '200', '--json', 'number,title,url,labels')) as {
    number: number;
    title: string;
    url: string | null;
    labels: { name: string }[];
  }[];
  const pulls = JSON.parse(gh('pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,url,headRefName,isDraft')) as {
    number: number;
    title: string;
    url: string | null;
    headRefName: string;
    isDraft: boolean;
  }[];
  return {
    issues: issues.map((i) => ({ ref: String(i.number), title: i.title, url: i.url, labels: (i.labels ?? []).map((l) => l.name) })),
    pulls: pulls.map((p) => ({ number: p.number, title: p.title, url: p.url, branch: p.headRefName, draft: p.isDraft })),
  };
}

export const github: Source = {
  async read(ref) {
    const issue = JSON.parse(gh('issue', 'view', ref, '--json', 'number,title,body,labels,url,comments'));
    return {
      ref: String(issue.number),
      url: issue.url,
      title: issue.title,
      body: issue.body ?? '',
      labels: (issue.labels ?? []).map((label: { name: string }) => label.name),
      comments: commentsFrom(issue.comments),
    } satisfies Ticket;
  },

  async comment(ref, markdown) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-comment-')), 'comment.md');
    fs.writeFileSync(file, markdown);
    gh('issue', 'comment', ref, '--body-file', file);
  },

  async label(ref, change) {
    for (const name of change.add ?? []) {
      ensureLabel(name);
      gh('issue', 'edit', ref, '--add-label', name);
    }
    for (const name of change.remove ?? []) {
      try {
        gh('issue', 'edit', ref, '--remove-label', name);
      } catch {
        // It was not on the issue.
      }
    }
  },

  async list() {
    const issues = JSON.parse(gh('issue', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,url')) as {
      number: number;
      title: string;
      url: string | null;
    }[];
    return issues.map((issue) => ({ ref: String(issue.number), title: issue.title, url: issue.url }));
  },

  async create(ticket) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-ticket-')), 'body.md');
    fs.writeFileSync(file, ticket.body);
    const labels = ticket.labels.flatMap((name) => {
      ensureLabel(name);
      return ['--label', name];
    });
    // gh prints the new issue's URL as its last line.
    const url = gh('issue', 'create', '--title', ticket.title, '--body-file', file, ...labels).trim().split('\n').pop() ?? '';
    const number = /\/issues\/(\d+)\s*$/.exec(url)?.[1];
    if (!number) throw new Error(`gh did not say which issue it created: ${url}`);
    return { ref: number, url };
  },

  async related(ref, limit) {
    const own = JSON.parse(gh('issue', 'view', ref, '--json', 'body')) as { body?: string };
    const subs = subIssues(ref).map((i): RelatedTicket => ({
      ref: String(i.number),
      relation: 'sub-issue',
      title: i.title,
      status: i.state ?? null,
      url: i.html_url ?? null,
      body: i.body ?? '',
    }));
    const seen = new Set(subs.map((s) => s.ref));
    const mentioned: RelatedTicket[] = [];
    for (const m of mentionedIssues(own.body ?? '', ref).filter((m) => !seen.has(m.ref))) {
      if (subs.length + mentioned.length >= limit) {
        mentioned.push({ ref: m.ref, relation: m.relation, title: '', status: null, url: null, body: '' });
        continue;
      }
      try {
        const i = JSON.parse(gh('issue', 'view', m.ref, '--json', 'number,title,body,state,url')) as GhIssue;
        mentioned.push({ ref: String(i.number), relation: m.relation, title: i.title, status: i.state ?? null, url: i.url ?? null, body: i.body ?? '' });
      } catch {
        // A pull request, a deleted issue, or one in another repository: nothing to read.
      }
    }
    return [...subs, ...mentioned];
  },

  async children(ref, label) {
    const toTask = (i: GhIssue): ChildTask => ({ ref: String(i.number), title: i.title, body: i.body ?? '', labels: labelNames(i.labels), url: i.html_url ?? i.url ?? null });
    const found = new Map(
      subIssues(ref)
        .filter((i) => labelNames(i.labels).includes(label))
        .map((i) => [String(i.number), toTask(i)]),
    );
    // Where sub-issues are not available the tasks are plain issues; their first line says whose they are.
    try {
      const listed = JSON.parse(gh('issue', 'list', '--state', 'all', '--label', label, '--limit', '200', '--json', 'number,title,body,labels,url')) as GhIssue[];
      for (const i of listed) if ((i.body ?? '').startsWith(`Part of #${ref}\n`) && !found.has(String(i.number))) found.set(String(i.number), toTask(i));
    } catch {
      // Listing failed; the sub-issues are all there is.
    }
    return [...found.values()];
  },

  async createChild(parent, task) {
    const created = await github.create(task);
    try {
      // The sub-issues API takes the issue's database id, not its number.
      const id = gh('api', `repos/{owner}/{repo}/issues/${created.ref}`, '--jq', '.id').trim();
      gh('api', '-X', 'POST', `repos/{owner}/{repo}/issues/${parent}/sub_issues`, '-F', `sub_issue_id=${id}`);
    } catch (error) {
      // Sub-issues are not on every plan. The task still says which ticket it belongs to in its first line.
      console.warn(`Filed #${created.ref}, but could not make it a sub-issue of #${parent}: ${error instanceof Error ? error.message : error}`);
    }
    return created;
  },

  async updateChild(ref, task) {
    gh('issue', 'edit', ref, '--title', task.title, '--body-file', writeTemp('qa-task-', task.body));
  },
};
