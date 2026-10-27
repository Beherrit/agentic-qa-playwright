/**
 * Shared, pure HTML helpers for the dashboard pages (executive summary, project page): number formatters, the page
 * CSS, the page shell, cards, stat tiles, tables, a line chart and the filter script. Everything returns a string.
 *
 * Every string from the data goes through escapeHtml. Links go through safeUrl (GitHub https URLs only) or relLink
 * (the site's own relative paths only). Data for scripts goes in a JSON block with `<` escaped and is only ever
 * written back with textContent.
 */
import { escapeHtml, safeUrl } from '../history.ts';
import { STYLE } from './style.ts';

export { areaChart } from './chart.ts';
export { STYLE };

// ── Formatters ───────────────────────────────────────────────────────────────

const isNum = (n: number | null): n is number => n !== null && Number.isFinite(n);

/** 96.2%, or - when there is nothing to show. */
export const pct = (n: number | null): string => (isNum(n) ? `${n.toFixed(1)}%` : '-');

/** 16.0s under a minute, 1m 23s above. Rounding up into a whole minute reads 1m 0s, never 60.0s. */
export function secs(ms: number | null): string {
  if (!isNum(ms)) return '-';
  const v = Math.max(ms, 0);
  if (Math.round(v / 100) < 600) return `${(v / 1000).toFixed(1)}s`;
  const total = Math.round(v / 1000);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

/** 12.3 min under an hour, 22.3 hrs from one hour. */
export function hours(ms: number): string {
  const safe = Math.max(ms, 0);
  return safe < 3_600_000 ? `${(safe / 60_000).toFixed(1)} min` : `${(safe / 3_600_000).toFixed(1)} hrs`;
}

/** 14,380. */
export const count = (n: number): string => Math.round(n).toLocaleString('en-US');

/** 2026-10-27 (UTC), or - when the value is not a date. */
export function dateText(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '-' : new Date(t).toISOString().slice(0, 10);
}

/** +0.4 pts vs 30d avg. Empty when either side is missing. `against` names what it is measured against. */
export function delta(now: number | null, before: number | null, against = '30d avg'): string {
  if (!isNum(now) || !isNum(before)) return '';
  const d = Math.round((now - before) * 10) / 10;
  return `${d < 0 ? '-' : '+'}${Math.abs(d).toFixed(1)} pts vs ${against}`;
}

// ── Links ────────────────────────────────────────────────────────────────────

/** A path inside the site: nothing, or any number of ../ then folder names, ending in a slash. No scheme, no query. */
const REL = /^(\.\.\/)*([A-Za-z0-9_-]+\/)*$/;

/** An anchor to a GitHub URL, or - when the URL is not one. */
export function linkCell(url: string, text: string): string {
  const safe = safeUrl(url);
  return safe ? `<a href="${escapeHtml(safe)}" rel="noopener noreferrer">${escapeHtml(text)}</a>` : '-';
}

/** An anchor to a relative path inside the site, or the plain text when the path is not one. */
export function relLink(href: string, text: string): string {
  const safe = REL.test(href) ? href : '';
  return safe ? `<a href="${escapeHtml(safe)}">${escapeHtml(text)}</a>` : escapeHtml(text);
}

// ── Building blocks ──────────────────────────────────────────────────────────

type Json = { id: string; data: unknown };

const jsonBlock = ({ id, data }: Json): string =>
  `<script type="application/json" id="${escapeHtml(id)}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

export function pageShell(opts: {
  title: string;
  intro: string;
  nav: { href: string; text: string }[];
  body: string;
  json?: Json | Json[];
  /** Script source, written by code in this repository (see filterScript); never data. */
  script?: string;
}): string {
  const nav = opts.nav.map((n) => relLink(n.href, n.text)).join('');
  const blocks = [opts.json ?? []].flat().map(jsonBlock).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${escapeHtml(opts.title)}</h1>
<p class="muted">${escapeHtml(opts.intro)}</p>
<nav class="links">${nav}</nav>
${opts.body}
</main>
${blocks}
${opts.script ? `<script>${opts.script}</script>` : ''}
</body>
</html>
`;
}

/** A bordered section. `body` is HTML built by the other helpers here; title and caption are escaped. */
export const card = (title: string, caption: string, body: string): string =>
  `<section class="card"><h2>${escapeHtml(title)}${caption ? ` <small>${escapeHtml(caption)}</small>` : ''}</h2>\n${body}\n</section>`;

export function stat(label: string, value: string, note?: string, chip?: { text: string; dir: 'up' | 'down' | 'flat' }): string {
  const chipHtml = chip?.text ? ` <span class="chip${chip.dir === 'flat' ? '' : ` ${chip.dir}`}">${escapeHtml(chip.text)}</span>` : '';
  return (
    `<div class="stat"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span>` +
    `${note || chipHtml ? `<span class="note">${escapeHtml(note ?? '')}${chipHtml}</span>` : ''}</div>`
  );
}

export const stats = (items: string[]): string => `<div class="stats">${items.join('')}</div>`;

/** A bar from 0 to 1 (not a percentage) with a label on the left and `rightText` on the right. Null reads as empty. */
export function meter(label: string, fraction: number | null, rightText: string): string {
  const width = isNum(fraction) ? Math.min(Math.max(fraction, 0), 1) * 100 : 0;
  return (
    `<div class="meterhead"><span>${escapeHtml(label)}</span><span>${escapeHtml(rightText)}</span></div>` +
    `<div class="meter" role="img" aria-label="${escapeHtml(`${label}: ${rightText}`)}"><span style="width:${width.toFixed(1)}%"></span></div>`
  );
}

/** A table cell: a plain string, which is escaped, or `{ html }`, which is passed through (build it with linkCell, relLink and escapeHtml). */
export type Cell = string | { html: string };

const cellHtml = (c: Cell): string => (typeof c === 'string' ? escapeHtml(c) : c.html);

/** Every cell is escaped unless given as `{ html }`. Rows carry `data-i` so filterScript can hide them. */
export function table(columns: string[], rows: Cell[][], opts: { id?: string; caption?: string; numeric?: number[]; empty?: string } = {}): string {
  const numeric = new Set(opts.numeric ?? []);
  const cls = (i: number): string => (numeric.has(i) ? ' class="n"' : '');
  const head = columns.map((h, i) => `<th scope="col"${cls(i)}>${escapeHtml(h)}</th>`).join('');
  const body = rows.length
    ? rows.map((r, n) => `<tr data-i="${n}">${r.map((c, i) => `<td${cls(i)}>${cellHtml(c)}</td>`).join('')}</tr>`).join('\n')
    : `<tr><td colspan="${columns.length}">${escapeHtml(opts.empty ?? 'Nothing to show.')}</td></tr>`;
  return (
    `<div class="wrap"><table${opts.id ? ` id="${escapeHtml(opts.id)}"` : ''}>` +
    `${opts.caption ? `<caption class="muted">${escapeHtml(opts.caption)}</caption>` : ''}` +
    `<thead><tr>${head}</tr></thead>\n<tbody>${body}</tbody></table></div>`
  );
}

// ── Filter ───────────────────────────────────────────────────────────────────

/**
 * The filter box script. Reads the JSON block `${tableId}-data` (an array of strings, one haystack per row, in row
 * order) and hides the rows of `#tableId` whose haystack lacks the query. Counts go to `countId` with `noun`.
 */
export function filterScript(tableId: string, inputId: string, countId: string, noun: string): string {
  const q = (s: string): string => JSON.stringify(s).replace(/</g, '\\u003c');
  return `
(function(){
  var data=[];
  try{data=JSON.parse(document.getElementById(${q(`${tableId}-data`)}).textContent)||[];}catch(e){}
  var rows=document.querySelectorAll(${q(`#${tableId} tbody tr[data-i]`)});
  var count=document.getElementById(${q(countId)});
  var haystack=data.map(function(s){return String(s).toLowerCase();});
  function apply(query){
    query=query.trim().toLowerCase();var shown=0;
    rows.forEach(function(row){
      var i=Number(row.getAttribute('data-i'));
      var hit=!query||(haystack[i]||'').indexOf(query)!==-1;
      row.hidden=!hit;if(hit)shown++;
    });
    count.textContent=shown+' of '+rows.length+' '+${q(noun)}+' shown';
  }
  document.getElementById(${q(inputId)}).addEventListener('input',function(ev){apply(ev.target.value);});
  apply('');
})();
`;
}
