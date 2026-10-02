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

/** Where requirements come from and where reports go back to. One per tracker. */
export interface Source {
  read(ref: string): Promise<Ticket>;
  comment(ref: string, markdown: string): Promise<void>;
  label(ref: string, change: { add?: string[]; remove?: string[] }): Promise<void>;
  /** Open tickets, so a new one can be checked against them for duplicates. */
  list(): Promise<OpenTicket[]>;
  /** Files a new ticket. */
  create(ticket: NewTicket): Promise<{ ref: string; url: string | null }>;
}

export type OpenTicket = { ref: string; title: string; url: string | null };
export type NewTicket = { title: string; body: string; labels: string[] };
