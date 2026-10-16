import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AuditRecord } from '../../schemas/schemas.ts';
import type { CoConfig } from './config.ts';

/**
 * Every run leaves one line in the audit log, whatever happened to it: who asked, which role, a hash of the input, the
 * screening verdict, the outcome, where the output went, what it cost. The input itself is not logged (it may hold
 * things that should not be copied around); the hash is enough to match a run to the ticket or thread it came from.
 * In CI the log is the job's output, which the CI system keeps; at a terminal it is a file the company's log shipper
 * can pick up. Nothing in here is ever deleted by the tooling.
 */

export function newRunId(): string {
  return randomUUID().slice(0, 8);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function record(config: CoConfig, entry: AuditRecord): void {
  const line = JSON.stringify(AuditRecord.parse(entry));
  if (config.audit === 'stdout') {
    console.log(`AUDIT ${line}`);
    return;
  }
  const file = path.resolve(config.audit);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${line}\n`);
}

/** How many runs this actor started for this role in the last hour, from the log. For the per-actor rate limit. */
export function recentRuns(config: CoConfig, actor: string, role: string, now: Date = new Date()): number {
  if (config.audit === 'stdout' || !fs.existsSync(config.audit)) return 0;
  const since = now.getTime() - 60 * 60 * 1000;
  let count = 0;
  for (const line of fs.readFileSync(config.audit, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as AuditRecord;
      if (entry.actor === actor && entry.role === role && Date.parse(entry.at) >= since) count += 1;
    } catch {
      // A damaged line is not a reason to refuse a run. It is a reason to look at the log.
    }
  }
  return count;
}

/** What the day's runs have cost so far, from the log. For the daily budget. */
export function spentToday(config: CoConfig, now: Date = new Date()): number {
  if (config.audit === 'stdout' || !fs.existsSync(config.audit)) return 0;
  const day = now.toISOString().slice(0, 10);
  let total = 0;
  for (const line of fs.readFileSync(config.audit, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as AuditRecord;
      if (entry.at.startsWith(day) && entry.costUsd) total += entry.costUsd;
    } catch {
      // Same.
    }
  }
  return total;
}
