import type { RelatedTicket, Source } from '../sources/types.ts';
import { screenRules } from './safety.ts';

/**
 * What the analysis reads beyond the ticket: the tickets around it (parent, children, links, mentions) and the designs
 * it links to. Real tickets are thin; the detail lives one link away. It is gathered in the intake job, which holds
 * the tracker token, saved to qa-run/context.json, and handed to the agents as material to analyse, never as
 * instructions. Every piece passes the same fixed safety rules as the ticket first; a piece that trips one is left
 * out and the report says so.
 */

export type Design = { url: string; title: string; frames: string[]; texts: string[] };

export type Context = {
  related: RelatedTicket[];
  designs: Design[];
  /** Links to documents the pipeline does not read (wikis, docs, boards), listed so a person knows they exist. */
  unread: string[];
  /** What was left out or could not be read, and why. */
  notes: string[];
};

export type ContextSettings = { related: boolean; maxRelated: number; maxChars: number; figma: boolean };

// ── Figma ────────────────────────────────────────────────────────────────────

export type FigmaRef = { url: string; key: string; nodeId: string | null };

const FIGMA_URL = /https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]{10,})(?:\/[^\s?#)\]>"']*)?(?:\?[^\s#)\]>"']*)?/g;

/** The Figma files and frames a text links to, each once. A node id arrives as 12-34 or 12%3A34 and is sent as 12:34. */
export function figmaLinks(text: string): FigmaRef[] {
  const found = new Map<string, FigmaRef>();
  for (const match of text.matchAll(FIGMA_URL)) {
    const url = match[0].replace(/[.,;:]+$/, '');
    let nodeId: string | null = null;
    try {
      const raw = new URL(url).searchParams.get('node-id');
      nodeId = raw ? raw.replace(/-/g, ':') : null;
    } catch {
      // Not a URL after all; the file key is still good.
    }
    const id = `${match[1]}|${nodeId ?? ''}`;
    if (!found.has(id)) found.set(id, { url, key: match[1], nodeId });
  }
  return [...found.values()];
}

/** Links to places that hold specs the pipeline does not read: wikis, documents, boards. */
export function unreadLinks(text: string): string[] {
  const hosts = /https:\/\/[^\s)\]>"']*(?:atlassian\.net\/wiki|docs\.google\.com|notion\.so|notion\.site|sharepoint\.com|miro\.com|lucid\.app|lucidchart\.com|dropbox\.com\/paper|coda\.io)[^\s)\]>"']*/gi;
  return [...new Set([...text.matchAll(hosts)].map((m) => m[0].replace(/[.,;:]+$/, '')))];
}

type FigmaNode = { id?: string; name?: string; type?: string; characters?: string; children?: FigmaNode[] };

/**
 * What a design tells a tester, from a Figma API answer: the names of its frames (the screens and states the designer
 * drew) and the words on them (labels, buttons, messages, which become locators and expected results). Capped.
 */
export function summariseFigma(root: FigmaNode, max = { frames: 40, texts: 80 }): { frames: string[]; texts: string[] } {
  const frames: string[] = [];
  const texts = new Set<string>();
  const walk = (node: FigmaNode, depth: number) => {
    if (depth > 12) return;
    if (['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET'].includes(node.type ?? '') && node.name && frames.length < max.frames) frames.push(node.name);
    if (node.type === 'TEXT' && node.characters) {
      const text = node.characters.replace(/\s+/g, ' ').trim();
      if (text && texts.size < max.texts) texts.add(text.length > 140 ? `${text.slice(0, 137)}...` : text);
    }
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  walk(root, 0);
  return { frames: [...new Set(frames)], texts: [...texts] };
}

/** Reads one linked file or frame through the Figma REST API. */
export async function readFigma(ref: FigmaRef, token: string, fetchFn: typeof fetch = fetch): Promise<Design> {
  const base = `https://api.figma.com/v1/files/${encodeURIComponent(ref.key)}`;
  const url = ref.nodeId ? `${base}/nodes?ids=${encodeURIComponent(ref.nodeId)}&depth=6` : `${base}?depth=4`;
  const response = await fetchFn(url, { headers: { 'X-Figma-Token': token } });
  if (!response.ok) throw new Error(`Figma answered ${response.status} for ${ref.url}`);
  const json = (await response.json()) as { name?: string; document?: FigmaNode; nodes?: Record<string, { document?: FigmaNode } | null> };
  const node = ref.nodeId ? json.nodes?.[ref.nodeId]?.document : json.document;
  if (!node) throw new Error(`Figma has no frame ${ref.nodeId} in ${ref.url}`);
  const summary = summariseFigma(node);
  return { url: ref.url, title: [json.name, ref.nodeId ? node.name : null].filter(Boolean).join(' / ') || ref.key, ...summary };
}

// ── Gathering ────────────────────────────────────────────────────────────────

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}\n\n(Cut short at ${max} characters.)` : text);

/** The first rule a piece of context trips, or null. Context is held to the same rules as the ticket. */
function tripped(text: string, hosts: string[]): string | null {
  const found = screenRules(text, [...hosts, 'figma.com']);
  return found.length ? `${found[0].rule}: "${found[0].excerpt}"` : null;
}

export type GatherInput = {
  ref: string | null;
  body: string;
  source: Pick<Source, 'related'> | null;
  settings: ContextSettings;
  figmaToken?: string;
  hosts: string[];
  fetchFn?: typeof fetch;
};

/** Reads the context around a ticket. Never throws: anything that cannot be read becomes a note. */
export async function gatherContext(input: GatherInput): Promise<Context> {
  const { settings } = input;
  const notes: string[] = [];
  let related: RelatedTicket[] = [];
  if (settings.related && input.ref && input.source?.related && settings.maxRelated > 0) {
    try {
      related = await input.source.related(input.ref, settings.maxRelated);
    } catch (error) {
      notes.push(`Related tickets could not be read: ${error instanceof Error ? error.message : error}`);
    }
  }
  const kept: RelatedTicket[] = [];
  for (const ticket of related) {
    const rule = tripped(`${ticket.title}\n\n${ticket.body}`, input.hosts);
    if (rule) {
      notes.push(`${ticket.ref} (${ticket.relation}) left out: it trips a safety rule (${rule}).`);
      continue;
    }
    kept.push({ ...ticket, body: cut(ticket.body, settings.maxChars) });
  }
  const allText = [input.body, ...kept.map((t) => t.body)].join('\n\n');

  const designs: Design[] = [];
  const refs = figmaLinks(allText);
  if (refs.length && settings.figma) {
    if (!input.figmaToken) {
      notes.push(`${refs.length} Figma link(s) not read: set FIGMA_TOKEN in the tracker environment to read designs.`);
    } else {
      for (const ref of refs.slice(0, 5)) {
        try {
          const design = await readFigma(ref, input.figmaToken, input.fetchFn);
          const rule = tripped([design.title, ...design.frames, ...design.texts].join('\n'), input.hosts);
          if (rule) notes.push(`The design at ${ref.url} left out: it trips a safety rule (${rule}).`);
          else designs.push({ ...design, texts: design.texts.slice(0, Math.max(10, Math.floor(settings.maxChars / 40))) });
        } catch (error) {
          notes.push(`The design at ${ref.url} could not be read: ${error instanceof Error ? error.message : error}`);
        }
      }
      if (refs.length > 5) notes.push(`${refs.length - 5} more Figma link(s) not read: five designs per ticket at most.`);
    }
  }
  return { related: kept, designs, unread: unreadLinks(allText), notes };
}

// ── For the agents and for people ────────────────────────────────────────────

const read = (t: RelatedTicket): boolean => Boolean(t.body.trim());

/** The context as the agents get it, inside tags that mark it as material. Empty when there is nothing. */
export function contextText(context: Context | null): string {
  if (!context) return '';
  const parts: string[] = [];
  if (context.related.length) {
    const tickets = context.related.map((t) => {
      const head = `### ${t.ref} (${t.relation}${t.status ? `, ${t.status}` : ''}): ${t.title}`;
      return read(t) ? `${head}\n\n${t.body.trim()}` : `${head}\n\n(Listed only; its description was not read.)`;
    });
    parts.push(`<related-tickets>\nTickets around this one. Use them to understand the requirement; the requirement itself decides what is in scope.\n\n${tickets.join('\n\n')}\n</related-tickets>`);
  }
  if (context.designs.length) {
    const designs = context.designs.map(
      (d) => `### ${d.title}\n${d.url}\n\nFrames: ${d.frames.join('; ') || 'none named'}\n\nWords on the screens:\n${d.texts.map((t) => `- ${t}`).join('\n') || '- none'}`,
    );
    parts.push(`<designs>\nThe designs the ticket links to. Exact labels and messages here are good locators and expected results, but the app decides what is built.\n\n${designs.join('\n\n')}\n</designs>`);
  }
  if (context.unread.length) parts.push(`<linked-documents-not-read>\n${context.unread.join('\n')}\n</linked-documents-not-read>`);
  return parts.join('\n\n');
}

/** The context for people: what was read, what was listed, what was left out. Empty when there is nothing. */
export function contextMd(context: Context | null, heading = '###'): string {
  if (!context) return '';
  const { related, designs, unread, notes } = context;
  if (!related.length && !designs.length && !unread.length && !notes.length) return '';
  const lines: string[] = [];
  for (const t of related) lines.push(`- ${t.url ? `[${t.ref}](${t.url})` : t.ref} (${t.relation}): ${t.title || 'untitled'}${read(t) ? '' : ', listed only'}`);
  for (const d of designs) lines.push(`- Design: [${d.title}](${d.url}), ${d.frames.length} frame(s), ${d.texts.length} text(s)`);
  for (const u of unread) lines.push(`- Not read: ${u}`);
  return `${heading} Context read with the ticket\n\n${lines.join('\n') || '- Nothing beyond the ticket.'}${notes.length ? `\n\n${notes.map((n) => `> ${n}`).join('\n>\n')}` : ''}\n`;
}
