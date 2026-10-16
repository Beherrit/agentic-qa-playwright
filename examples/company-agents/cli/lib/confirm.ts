import readline from 'node:readline/promises';
import type { Identity } from './identity.ts';
import type { RolePolicy } from './config.ts';

/**
 * Nothing leaves the CLI without the person seeing it first. The preview is printed in full, then one question.
 * `--yes` is honoured in CI (a workflow is the person's standing instruction) and at a terminal only for roles whose
 * policy says so: posting a comment on your own ticket, yes; publishing a page, never.
 */

export async function confirm(preview: string, what: string, identity: Identity, policy: RolePolicy, yes: boolean): Promise<boolean> {
  console.log(`\n${'─'.repeat(78)}\n${preview}\n${'─'.repeat(78)}`);
  if (yes) {
    if (identity.source === 'ci' || policy.allowYesLocally) return true;
    console.error(`--yes is not honoured for this role at a terminal. Answer the question instead.`);
  }
  if (!process.stdin.isTTY) {
    console.error(`Not a terminal and no --yes: nothing ${what}.`);
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${what[0].toUpperCase()}${what.slice(1)}? [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
