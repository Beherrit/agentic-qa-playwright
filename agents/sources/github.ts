import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OpenIssue, OpenPull } from '../lib/status.ts';
import type { Source, Ticket } from './types.ts';

/**
 * GitHub issues, through the gh CLI. In Actions, gh reads GH_TOKEN and GH_REPO from the environment.
 * Arguments go to gh directly, never through a shell, so a title or body is only ever data.
 */

const gh = (...args: string[]): string => execFileSync('gh', args, { encoding: 'utf8' });

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
    const issue = JSON.parse(gh('issue', 'view', ref, '--json', 'number,title,body,labels,url'));
    return {
      ref: String(issue.number),
      url: issue.url,
      title: issue.title,
      body: issue.body ?? '',
      labels: (issue.labels ?? []).map((label: { name: string }) => label.name),
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
};
