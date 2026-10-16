import fs from 'node:fs';
import path from 'node:path';
import type { CoConfig } from './config.ts';

/**
 * The deterministic checks between the agent and the world. An agent's answer has passed its schema by the time it
 * gets here; this is about whether what it claims is true where code can tell: the files it names exist, the tickets
 * and merge requests it names were in its input, the links point at hosts the company allows, the lines it comments
 * on are in the diff. A problem here means nothing is posted. The run is logged as failed, with the problems.
 */

export type Problem = string;

const URL_PATTERN = /https?:\/\/[^\s)>\]"']+/g;

/** Every file path the agent named must exist in the repository. Paths outside it are a problem on their own. */
export function checkFiles(cwd: string, files: Iterable<string>): Problem[] {
  const problems: Problem[] = [];
  const root = path.resolve(cwd);
  for (const file of new Set(files)) {
    const bare = file.replace(/:\d+(?::\d+)?$/, '');
    const full = path.resolve(root, bare);
    if (!full.startsWith(root)) problems.push(`names a path outside the repository: ${file}`);
    else if (!fs.existsSync(full)) problems.push(`names a file that does not exist: ${file}`);
  }
  return problems;
}

/** Every ticket or merge request the agent named must have been in its input. */
export function checkRefs(refs: Iterable<string>, known: Iterable<string>): Problem[] {
  const set = new Set([...known].map((k) => k.toUpperCase()));
  const problems: Problem[] = [];
  for (const ref of new Set(refs)) {
    if (!set.has(ref.toUpperCase())) problems.push(`names a ticket or merge request it was not given: ${ref}`);
  }
  return problems;
}

/** Every link in the text must point at a host on the allowlist. */
export function checkHosts(config: CoConfig, text: string): Problem[] {
  const problems: Problem[] = [];
  for (const url of new Set(text.match(URL_PATTERN) ?? [])) {
    let host: string;
    try {
      host = new URL(url).host.toLowerCase().replace(/^www\./, '');
    } catch {
      problems.push(`contains a link that is not a URL: ${url}`);
      continue;
    }
    const ok = config.allowedHosts.some((own) => host === own.toLowerCase() || host.endsWith(`.${own.toLowerCase()}`));
    if (!ok) problems.push(`links to a host that is not allowed: ${host}`);
  }
  return problems;
}

/** Every finding must sit on a line that the diff adds or changes in that file. */
export function checkDiffLines(diff: string, findings: Iterable<{ file: string; line: number }>): Problem[] {
  const changed = changedLines(diff);
  const problems: Problem[] = [];
  for (const f of findings) {
    const lines = changed.get(f.file);
    if (!lines) problems.push(`comments on a file that is not in the diff: ${f.file}`);
    else if (!lines.has(f.line)) problems.push(`comments on a line that is not in the diff: ${f.file}:${f.line}`);
  }
  return problems;
}

/** Added and context lines on the new side of a unified diff, by file. */
export function changedLines(diff: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  let file: string | null = null;
  let line = 0;
  for (const raw of diff.split('\n')) {
    const header = /^\+\+\+ (?:b\/)?(.+)$/.exec(raw);
    if (header) {
      file = header[1].trim();
      result.set(file, new Set());
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!file || raw.startsWith('---')) continue;
    if (raw.startsWith('+')) {
      result.get(file)?.add(line);
      line += 1;
    } else if (!raw.startsWith('-') && !raw.startsWith('\\')) {
      result.get(file)?.add(line);
      line += 1;
    }
  }
  return result;
}

/** Text that must never be posted, whatever the role: things that look like credentials. */
export function checkNoSecrets(text: string): Problem[] {
  const patterns: [string, RegExp][] = [
    ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
    ['a Slack token', /\bxox[abp]-[A-Za-z0-9-]{10,}\b/],
    ['an Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
    ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['a bearer token', /\bBearer\s+[A-Za-z0-9._-]{20,}\b/],
  ];
  return patterns.filter(([, p]) => p.test(text)).map(([what]) => `contains what looks like ${what}`);
}

/** Length limits keep a comment a comment. */
export function checkLength(text: string, maxLines: number): Problem[] {
  const lines = text.split('\n').length;
  return lines > maxLines ? [`is ${lines} lines; the limit for this role is ${maxLines}`] : [];
}

/** The line every posted artefact ends with, so a reader always knows what wrote it and can find the run. */
export function footer(role: string, runId: string): string {
  return `\n\n---\n_Drafted by the ${role} agent, run ${runId}. A person is responsible for what is done with it._`;
}
