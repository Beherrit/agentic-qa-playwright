/**
 * Requirement keys and the names derived from them. A key is what ties a ticket to its tests:
 * GitHub issue 12 becomes REQ-12, a Jira ticket keeps its own key (SHOP-123).
 */

export type SourceName = 'github' | 'jira' | 'pr' | 'azure' | 'linear' | 'local';

/** A Jira-style key: project letters, a dash, a number. Only these characters ever reach a shell, a tag or a branch. */
export const KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

export function keyFor(source: SourceName, ref: string): string {
  const key =
    source === 'github' ? `REQ-${ref}` : source === 'pr' ? `PR-${ref}` : source === 'azure' ? `ADO-${ref}` : source === 'jira' || source === 'linear' ? ref : 'REQ-0';
  if (!KEY.test(key)) throw new Error(`"${key}" is not a valid requirement key.`);
  return key;
}

/** Checks a ticket reference before it goes anywhere near a shell or an API path. */
export function validateRef(source: SourceName, ref: string): string {
  const ok = source === 'github' || source === 'pr' || source === 'azure' ? /^[1-9]\d*$/.test(ref) : source === 'jira' || source === 'linear' ? KEY.test(ref) : true;
  if (!ok) throw new Error(`"${ref}" is not a valid ${source} reference.`);
  return ref;
}

/**
 * The --grep pattern for one requirement's tests. Playwright matches it as a substring, so "@REQ-1" alone
 * would also pick up @REQ-12 and @REQ-100. The lookahead stops the match at the end of the number.
 */
export const tagGrep = (key: string): string => `@${key}(?![0-9])`;

export const branchFor = (key: string): string => `qa/${key.toLowerCase()}`;
export const BRANCH = /^qa\/[a-z][a-z0-9_]*-[0-9]+$/;

/** The artifact the analysis workflow leaves for the test workflow to pick up. */
export const artifactFor = (key: string): string => `qa-analysis-${key.toLowerCase()}`;
