/**
 * Jira Cloud speaks Atlassian Document Format (ADF), a JSON tree, instead of markdown.
 * These two functions convert just enough of it in each direction for this pipeline:
 * ticket descriptions come in as ADF and become markdown for the agents, and the
 * pipeline's markdown reports go out as ADF comments.
 */

type AdfNode = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: AdfMark[]; content?: AdfNode[] };
type AdfMark = { type: string; attrs?: Record<string, unknown> };

// ── ADF to markdown ──────────────────────────────────────────────────────────

export function adfToMarkdown(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  const n = node as AdfNode;
  const children = (n.content ?? []).map(adfToMarkdown);

  switch (n.type) {
    case 'doc':
      return children.filter(Boolean).join('\n\n').trim();
    case 'text': {
      // Keep what carries meaning for a tester: where a link goes, and what was written as code.
      const value = n.text ?? '';
      const link = n.marks?.find((mark) => mark.type === 'link')?.attrs?.href;
      if (typeof link === 'string' && link !== value) return `[${value}](${link})`;
      return n.marks?.some((mark) => mark.type === 'code') ? `\`${value}\`` : value;
    }
    case 'hardBreak':
      return '\n';
    case 'heading':
      return `${'#'.repeat(Number(n.attrs?.level ?? 2))} ${children.join('')}`;
    case 'paragraph':
      return children.join('');
    case 'bulletList':
      return children.map((item) => `- ${item}`).join('\n');
    case 'orderedList':
      return children.map((item, i) => `${i + 1}. ${item}`).join('\n');
    case 'taskList':
      return (n.content ?? []).map((item) => `- [${item.attrs?.state === 'DONE' ? 'x' : ' '}] ${adfToMarkdown({ ...item, type: 'paragraph' })}`).join('\n');
    case 'listItem':
      return children.join('\n').replace(/\n/g, '\n  ');
    case 'codeBlock':
      return `\`\`\`\n${children.join('')}\n\`\`\``;
    case 'blockquote':
      return children.map((c) => `> ${c}`).join('\n');
    case 'table': {
      const width = n.content?.[0]?.content?.length ?? 1;
      return children.map((row, i) => (i === 0 ? `${row}\n|${Array(width).fill('---').join('|')}|` : row)).join('\n');
    }
    case 'tableRow':
      return `| ${children.join(' | ')} |`;
    case 'tableHeader':
    case 'tableCell':
      return children.join(' ').replace(/\n+/g, ' ').replace(/\|/g, '\\|');
    case 'mention':
    case 'emoji':
    case 'status':
      return String(n.attrs?.text ?? n.attrs?.shortName ?? '');
    case 'inlineCard':
    case 'blockCard':
      return String(n.attrs?.url ?? '');
    case 'rule':
      return '---';
    default:
      // panel, expand, layout and anything newer: keep the text, drop the wrapper.
      return children.filter(Boolean).join('\n\n');
  }
}

// ── Markdown to ADF ──────────────────────────────────────────────────────────

const text = (value: string, marks?: AdfMark[]): AdfNode => (marks?.length ? { type: 'text', text: value, marks } : { type: 'text', text: value });

/** Bold, inline code, links and <br>. Everything else stays as written. */
export function inline(source: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|<br\s*\/?>/g;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > last) nodes.push(text(source.slice(last, match.index)));
    if (match[1] !== undefined) nodes.push(text(match[1], [{ type: 'strong' }]));
    else if (match[2] !== undefined) nodes.push(text(match[2], [{ type: 'code' }]));
    else if (match[3] !== undefined) nodes.push(text(match[3], [{ type: 'link', attrs: { href: match[4] } }]));
    else nodes.push({ type: 'hardBreak' });
    last = match.index + match[0].length;
  }
  if (last < source.length) nodes.push(text(source.slice(last)));
  // ADF refuses empty text nodes.
  return nodes
    .map((node) => (node.type === 'text' ? { ...node, text: node.text!.replace(/\\([|*_`])/g, '$1') } : node))
    .filter((node) => node.type !== 'text' || node.text !== '');
}

const paragraph = (source: string): AdfNode => ({ type: 'paragraph', content: inline(source) });

/** Splits a markdown table row on unescaped pipes. */
export function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

function table(rows: string[]): AdfNode {
  // Only a row made entirely of dashes is the separator; a cell that merely starts with "--" is data.
  const separator = (row: string): boolean => cells(row).every((cell) => /^:?-{3,}:?$/.test(cell));
  const parsed = rows.filter((row) => !separator(row)).map(cells);
  const width = Math.max(...parsed.map((row) => row.length));
  return {
    type: 'table',
    attrs: { isNumberColumnEnabled: false, layout: 'default' },
    content: parsed.map((row, r) => ({
      type: 'tableRow',
      content: Array.from({ length: width }, (_, c) => ({
        type: r === 0 ? 'tableHeader' : 'tableCell',
        content: [paragraph(row[c] ?? '')],
      })),
    })),
  };
}

const BLOCK_START = /^(#{1,6}\s|\s*\||\s*[-*]\s|\s*\d+\.\s|```|<\/?details|<summary)/;

export type AdfDoc = { type: 'doc'; version: 1; content: AdfNode[] };

export function markdownToAdf(markdown: string): AdfDoc {
  const lines = markdown.replace(/\r/g, '').split('\n');
  const content: AdfNode[] = [];
  let i = 0;

  const collect = (test: (line: string) => boolean): string[] => {
    const block: string[] = [];
    while (i < lines.length && test(lines[i])) block.push(lines[i++]);
    return block;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || /^<\/?details>$/.test(trimmed)) {
      i++;
      continue;
    }
    const summary = /^(?:<details>)?<summary>(.*)<\/summary>$/.exec(trimmed);
    if (summary) {
      content.push({ type: 'paragraph', content: [text(summary[1], [{ type: 'strong' }])] });
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      content.push({ type: 'heading', attrs: { level: heading[1].length }, content: inline(heading[2]) });
      i++;
      continue;
    }
    if (trimmed.startsWith('```')) {
      i++;
      const code = collect((l) => !l.trim().startsWith('```'));
      i++;
      const source = code.join('\n');
      content.push({ type: 'codeBlock', content: source.trim() ? [text(source)] : [] });
      continue;
    }
    if (trimmed.startsWith('|')) {
      content.push(table(collect((l) => l.trim().startsWith('|'))));
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      const items = collect((l) => /^\s*[-*]\s/.test(l));
      content.push({
        type: 'bulletList',
        content: items.map((item) => ({
          type: 'listItem',
          content: [paragraph(item.replace(/^\s*[-*]\s+/, '').replace(/^\[ \]\s*/, '☐ ').replace(/^\[x\]\s*/i, '☑ '))],
        })),
      });
      continue;
    }
    if (/^\s*\d+\.\s/.test(line)) {
      const items = collect((l) => /^\s*\d+\.\s/.test(l));
      content.push({
        type: 'orderedList',
        content: items.map((item) => ({ type: 'listItem', content: [paragraph(item.replace(/^\s*\d+\.\s+/, ''))] })),
      });
      continue;
    }
    const block = [line];
    i++;
    block.push(...collect((l) => l.trim() !== '' && !BLOCK_START.test(l)));
    content.push({ type: 'paragraph', content: block.flatMap((l, n) => (n ? [{ type: 'hardBreak' }, ...inline(l)] : inline(l))) });
  }
  return { type: 'doc', version: 1, content };
}
