/**
 * The four kinds of system the roles talk to, as small interfaces. An adapter does plain REST calls with the token it
 * is given and nothing clever. Agents never see an adapter: the CLI or the fetch job reads through one before the
 * agent runs, and the CLI or the post job writes through one after the answer is validated and confirmed.
 */

export type Comment = { author: string; body: string; at: string };

export type Ticket = {
  key: string;
  url: string;
  title: string;
  body: string;
  status: string;
  reporter: string;
  labels: string[];
  comments: Comment[];
};

export type MergeRequest = {
  id: string;
  url: string;
  title: string;
  body: string;
  author: string;
  source: string;
  target: string;
  files: string[];
  diff: string;
  commits: { sha: string; message: string }[];
  /** A short text summary of CI: "3 checks passed, 1 failed: lint". */
  ci: string;
  merged: boolean;
  /** Ticket keys found in the title, body, branch name and commits. */
  ticketKeys: string[];
};

export type Page = { id: string; title: string; url: string; body: string; version: number; parentId: string | null };

export type ChatMessage = { user: string; text: string; ts: string };

export type DraftTarget = { action: 'update' | 'create'; pageId: string | null; parentId: string | null; title: string };

export interface Tracker {
  getTicket(key: string): Promise<Ticket>;
  searchTickets(text: string, limit: number): Promise<Ticket[]>;
  createTicket(title: string, body: string, labels: string[]): Promise<Ticket>;
  /** Returns the comment's URL. */
  comment(key: string, body: string): Promise<string>;
}

export interface Repo {
  getMergeRequest(id: string): Promise<MergeRequest>;
  listMerged(sinceIso: string): Promise<MergeRequest[]>;
  comment(id: string, body: string): Promise<string>;
  setDescription(id: string, body: string): Promise<void>;
  /** A review with line comments and no approval or request-changes. Returns its URL. */
  review(id: string, summary: string, comments: { file: string; line: number; body: string }[]): Promise<string>;
}

export interface Docs {
  getPage(id: string): Promise<Page>;
  search(text: string, limit: number): Promise<Page[]>;
  /**
   * Saves a draft and returns its URL. Never changes a live page: an update is saved as a sibling draft that links to
   * the page it proposes to replace, labelled agent-draft, for the owner to merge.
   */
  saveDraft(target: DraftTarget, body: string, format: 'confluence-storage' | 'markdown'): Promise<string>;
}

export interface Chat {
  readThread(channel: string, ts: string): Promise<ChatMessage[]>;
  /** Returns the message's ts or id. */
  post(channel: string, text: string, threadTs?: string): Promise<string>;
  /** Visible only to one person: how a drafted statement is shown for approval. */
  postEphemeral(channel: string, user: string, text: string): Promise<void>;
}

export const TICKET_IN_TEXT = /\b[A-Z][A-Z0-9]+-\d+\b/g;

export function ticketKeysIn(...texts: string[]): string[] {
  const keys = new Set<string>();
  for (const text of texts) for (const key of text.match(TICKET_IN_TEXT) ?? []) keys.add(key);
  return [...keys];
}

/** One place for the fetch-and-check that every adapter does. */
export async function api<T>(url: string, init: RequestInit & { token?: string; basic?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.basic) headers.Authorization = `Basic ${Buffer.from(init.basic).toString('base64')}`;
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const type = response.headers.get('content-type') ?? '';
  return (type.includes('json') ? await response.json() : await response.text()) as T;
}
