/** A ticket as the pipeline sees it, wherever it came from. */
export type Ticket = { ref: string; url: string | null; title: string; body: string; labels: string[] };

/** Where requirements come from and where reports go back to. One per tracker. */
export interface Source {
  read(ref: string): Promise<Ticket>;
  comment(ref: string, markdown: string): Promise<void>;
  label(ref: string, change: { add?: string[]; remove?: string[] }): Promise<void>;
}
