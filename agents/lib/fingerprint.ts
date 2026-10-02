import { createHash } from 'node:crypto';

/**
 * A test marked with test.fail() that suddenly passes is not a failure to investigate: the bug was fixed, or
 * the feature it was written ahead of has landed. Playwright reports it with this message.
 */
export const LANDED = /Expected to fail, but passed/i;

/** A stable id per failing test. A bug matches an open issue that shares any one of them. */
export const fingerprint = (test: string): string => createHash('sha1').update(test).digest('hex').slice(0, 12);

const loose = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The triage agent names the tests a bug breaks in its own words, and may word them differently next time.
 * This maps each name back to the failure it means, as "file > full title" without the line number, so the
 * fingerprint is taken from what Playwright reported and stays the same from run to run.
 * A name that matches no failure is kept as it is.
 */
export function canonicalTests(claimed: string[], failures: { test: string; file: string }[]): string[] {
  const names = claimed.map((name) => {
    const wanted = loose(name);
    const match =
      failures.find((f) => loose(f.test) === wanted) ??
      failures.find((f) => wanted !== '' && (loose(f.test).endsWith(wanted) || wanted.endsWith(loose(f.test))));
    return match ? `${match.file.replace(/:\d+$/, '')} > ${match.test}` : name;
  });
  return [...new Set(names)];
}
