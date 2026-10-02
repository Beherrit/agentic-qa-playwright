/**
 * Enough HTML for Azure DevOps, whose work item fields and comments are HTML. Markdown in, a document Azure
 * renders out; a field's HTML in, markdown the agents can read out. Small on purpose: headings, paragraphs, lists,
 * tables, bold, code and links are what the reports and tickets use.
 */

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineHtml(text: string): string {
  return escape(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

const isRule = (row: string): boolean => /^\|[\s|:-]+\|$/.test(row.trim());
const cells = (row: string): string[] => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

export function markdownToHtml(markdown: string): string {
  const out: string[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^<\/?details>|^<summary>/.test(line.trim())) {
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push(`<h${heading[1].length}>${inlineHtml(heading[2])}</h${heading[1].length}>`);
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        if (!isRule(lines[i])) rows.push(lines[i]);
        i++;
      }
      const [head, ...body] = rows.map(cells);
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inlineHtml(c)}</th>`).join('')}</tr></thead><tbody>${body
          .map((row) => `<tr>${row.map((c) => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
      continue;
    }
    const item = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^(\s*)(?:[-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^(\s*)(?:[-*]|\d+\.)\s+/, ''));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((text) => `<li>${inlineHtml(text)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\||\s*(?:[-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inlineHtml(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

const unescape = (text: string): string =>
  text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export function htmlToMarkdown(html: string): string {
  let text = html.replace(/\r?\n/g, ' ');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (_, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${inner.trim()}\n\n`);
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '\n- $1');
  text = text.replace(/<\/(?:p|div|ul|ol|table|pre)>/gi, '\n\n');
  text = text.replace(/<\/tr>/gi, '\n');
  text = text.replace(/<\/t[hd]>/gi, ' | ');
  text = text.replace(/<(?:strong|b)[^>]*>(.*?)<\/(?:strong|b)>/gi, '**$1**');
  text = text.replace(/<(?:em|i)[^>]*>(.*?)<\/(?:em|i)>/gi, '*$1*');
  text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  text = text.replace(/<[^>]+>/g, '');
  return unescape(text)
    .split('\n')
    .map((line) => line.replace(/\s+$/, '').replace(/^\s+(?=[^-#])/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
