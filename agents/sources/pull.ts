import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../lib/paths.ts';
import { github } from './github.ts';
import type { Source, Ticket } from './types.ts';

/**
 * A GitHub pull request as a requirement: the change itself is the ticket. The description, the list of files and
 * the diff become the body, the pull request's own branch is where the generated tests are opened, and the build
 * under test is the preview `app.previewUrl` names, when it does. Comments and labels go on the pull request.
 */

const gh = (...args: string[]): string => execFileSync('gh', args, { encoding: 'utf8' });

/** The diff is cut here, so a large change still fits a model's context next to the brief and the conventions. */
export const MAX_DIFF = 60_000;

type PullFile = { path: string; additions: number; deletions: number };
export type PullDetails = { body: string; headRefName: string; baseRefName: string; files: PullFile[]; diff: string };

/** The preview address for a change, from the template in qa.config.json. Undefined without a template. */
export function previewUrl(number: string, branch: string, template: string | undefined = config.app.previewUrl): string | undefined {
  if (!template) return undefined;
  const url = template.replaceAll('{number}', number).replaceAll('{branch}', branch.replace(/[^A-Za-z0-9-]+/g, '-').toLowerCase());
  return /^https?:\/\//.test(url) ? url : undefined;
}

/** The body of the requirement a pull request becomes: the description, the files it touches, then the diff. */
export function pullBody(pr: PullDetails): string {
  const rows = pr.files.map((f) => `| \`${f.path}\` | +${f.additions} | -${f.deletions} |`);
  const diff = pr.diff.length > MAX_DIFF ? `${pr.diff.slice(0, MAX_DIFF)}\n\n(cut short: ${pr.diff.length - MAX_DIFF} more characters)` : pr.diff;
  return `${pr.body.trim() || '_The pull request has no description._'}

### The change

Branch \`${pr.headRefName}\` into \`${pr.baseRefName}\`. ${pr.files.length} file(s) changed.

| File | Added | Removed |
|---|---|---|
${rows.join('\n')}

<diff>
${diff.trim()}
</diff>`;
}

export const pull: Source = {
  async read(ref) {
    const pr = JSON.parse(gh('pr', 'view', ref, '--json', 'number,title,body,url,labels,headRefName,baseRefName,files')) as {
      number: number;
      title: string;
      body: string | null;
      url: string | null;
      labels: { name: string }[];
      headRefName: string;
      baseRefName: string;
      files: PullFile[];
    };
    const diff = gh('pr', 'diff', ref);
    const number = String(pr.number);
    return {
      ref: number,
      url: pr.url,
      title: pr.title,
      body: pullBody({ body: pr.body ?? '', headRefName: pr.headRefName, baseRefName: pr.baseRefName, files: pr.files ?? [], diff }),
      labels: (pr.labels ?? []).map((label) => label.name),
      baseUrl: previewUrl(number, pr.headRefName),
      base: pr.headRefName,
    } satisfies Ticket;
  },

  async comment(ref, markdown) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-comment-')), 'comment.md');
    fs.writeFileSync(file, markdown);
    gh('pr', 'comment', ref, '--body-file', file);
  },

  async label(ref, change) {
    for (const name of change.add ?? []) {
      try {
        gh('label', 'create', name, '--color', 'D93F0B');
      } catch {
        // It exists already.
      }
      gh('pr', 'edit', ref, '--add-label', name);
    }
    for (const name of change.remove ?? []) {
      try {
        gh('pr', 'edit', ref, '--remove-label', name);
      } catch {
        // It was not on the pull request.
      }
    }
  },

  // The tickets a change can be related to are the open issues, the same as for an issue.
  list: () => github.list(),

  async create() {
    throw new Error('A pull request is a requirement to read, not one to file. Use --source github to file an issue.');
  },
};
