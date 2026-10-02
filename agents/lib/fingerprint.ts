import { createHash } from 'node:crypto';

/**
 * A test marked with test.fail() that suddenly passes is not a failure to investigate: the bug was fixed, or
 * the feature it was written ahead of has landed. Playwright reports it with this message.
 */
export const LANDED = /Expected to fail, but passed/i;

/** A stable id per failing test. A bug matches an open issue that shares any one of them. */
export const fingerprint = (test: string): string => createHash('sha1').update(test).digest('hex').slice(0, 12);
