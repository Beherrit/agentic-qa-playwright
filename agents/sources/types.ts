/** A comment on a ticket. Trusted means the author may answer the pipeline's questions: a member of the project, not anyone who can type. */
export type TicketComment = { author: string; trusted: boolean; body: string };

/** A ticket as the pipeline sees it, wherever it came from. A pull request also says where its build answers and which branch it is. */
export type Ticket = {
  ref: string;
  url: string | null;
  title: string;
  body: string;
  labels: string[];
  comments?: TicketComment[];
  baseUrl?: string;
  base?: string;
};

/**
 * A ticket that bears on the one being analysed: its parent or epic, a child or subtask, a linked issue, or one the
 * ticket mentions. `relation` says how, in the tracker's own words where it has them ("blocks", "is cloned by").
 */
export type RelatedTicket = { ref: string; relation: string; title: string; status: string | null; url: string | null; body: string };

/** Where requirements come from and where reports go back to. One per tracker. */
export interface Source {
  read(ref: string): Promise<Ticket>;
  comment(ref: string, markdown: string): Promise<void>;
  label(ref: string, change: { add?: string[]; remove?: string[] }): Promise<void>;
  /** Open tickets, so a new one can be checked against them for duplicates. */
  list(): Promise<OpenTicket[]>;
  /** Files a new ticket. */
  create(ticket: NewTicket): Promise<{ ref: string; url: string | null }>;
  /** The tickets around this one, with their descriptions. Trackers without the idea leave it out. */
  related?(ref: string, limit: number): Promise<RelatedTicket[]>;
  /** The tasks the pipeline filed under this ticket before, found by their label. */
  children?(ref: string, label: string): Promise<ChildTask[]>;
  /** Files a task under the ticket. */
  createChild?(parent: string, task: NewTicket): Promise<{ ref: string; url: string | null }>;
  /** Rewrites a task the pipeline filed: its title and description. */
  updateChild?(ref: string, task: Pick<NewTicket, 'title' | 'body'>): Promise<void>;
}

/** A task under a ticket: what the per-layer task sync needs to find and compare it. */
export type ChildTask = { ref: string; title: string; body: string; labels: string[]; url: string | null };

export type OpenTicket = { ref: string; title: string; url: string | null };
export type NewTicket = { title: string; body: string; labels: string[] };
