import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Source, Ticket } from './types.ts';

/**
 * GitHub issues, through the gh CLI. In Actions, gh reads GH_TOKEN and GH_REPO from the environment.
 * Arguments go to gh directly, never through a shell, so a title or body is only ever data.
 */

const gh = (...args: string[]): string => execFileSync('gh', args, { encoding: 'utf8' });

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
      try {
        gh('label', 'create', name, '--color', 'D93F0B');
      } catch {
        // It exists already.
      }
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
};
