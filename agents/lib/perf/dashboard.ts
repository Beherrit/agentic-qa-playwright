import { escapeHtml, safeUrl } from '../history.ts';
import { entryKey, newestFirst, type PageEntry, type PerfEntry } from './entry.ts';

/**
 * The performance page on the qa-perf branch: one self-contained HTML file with no external scripts, and a
 * README.md that says the same in a table. Newest run first; within a run, the worst page first.
 */

const CHART_RUNS = 30;
const SPARK_RUNS = 20;

const median = (values: number[]): number | null => {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const seconds = (ms: number): string => `${(ms / 1000).toFixed(2)} s`;
const dateText = (iso: string): string => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : '-');
const worstFirst = (pages: PageEntry[]): PageEntry[] => [...pages].sort((a, b) => Number(a.passed) - Number(b.passed) || a.performance - b.performance);

export type Tile = [string, string];

export function tiles(latest: PerfEntry | undefined, entries: PerfEntry[]): Tile[] {
  if (!latest) return [['0', 'runs recorded']];
  const failing = latest.pages.filter((p) => !p.passed).length;
  const score = median(latest.pages.map((p) => p.performance));
  const worstLcp = latest.pages.length ? Math.max(...latest.pages.map((p) => p.lcpMs)) : null;
  const errors = latest.pages.reduce((n, p) => n + p.errors, 0);
  return [
    [String(latest.pages.length), `page audits in the last run (${latest.routes} routes)`],
    [String(failing), failing ? 'failing budgets or regressed' : 'failing (none)'],
    [score === null ? '-' : String(Math.round(score)), 'median performance score'],
    [worstLcp === null ? '-' : seconds(worstLcp), 'worst LCP'],
    [String(errors), 'console, page and request errors'],
    [String(entries.length), 'runs recorded'],
  ];
}

/** Scores for one page across runs, oldest first, null where the page was not audited. */
function series(entries: PerfEntry[], key: string, pick: (p: PageEntry) => number, runs: number): (number | null)[] {
  return newestFirst(entries)
    .slice(0, runs)
    .reverse()
    .map((e) => {
      const page = e.pages.find((p) => entryKey(p) === key);
      return page ? pick(page) : null;
    });
}

function sparkline(values: (number | null)[], max: number): string {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return '<span class="muted">-</span>';
  const w = 120;
  const h = 28;
  const step = w / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => (v === null ? null : `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`)).filter(Boolean).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(`last ${present.length} runs, ${Math.min(...present)} to ${Math.max(...present)}`)}"><polyline points="${points}"/></svg>`;
}

/** A bar per run, oldest to newest. */
function chart(title: string, entries: PerfEntry[], value: (e: PerfEntry) => number | null, format: (n: number) => string, fixedMax?: number): string {
  const recent = newestFirst(entries).slice(0, CHART_RUNS).reverse();
  const values = recent.map(value);
  const present = values.filter((v): v is number => v !== null);
  if (!present.length) return `<figure><figcaption>${escapeHtml(title)}</figcaption><p class="muted">No data yet.</p></figure>`;
  const max = fixedMax ?? (Math.max(...present) || 1);
  const width = 600;
  const height = 150;
  const base = height - 20;
  const slot = width / CHART_RUNS;
  const bars = recent
    .map((e, i) => {
      const v = values[i];
      if (v === null) return '';
      const bh = Math.max((v / max) * (base - 8), 1);
      const cls = e.passed ? '' : ' class="bad"';
      return `<rect${cls} x="${(i * slot + slot * 0.15).toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${(slot * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="2"><title>${escapeHtml(`${dateText(e.finishedAt)}: ${format(v)}`)}</title></rect>`;
    })
    .join('');
  return (
    `<figure><figcaption>${escapeHtml(title)}</figcaption>` +
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`${title}, last ${recent.length} runs`)}" preserveAspectRatio="none">` +
    `<line x1="0" y1="${base}" x2="${width}" y2="${base}" class="axis"/>${bars}` +
    `<text x="0" y="${height - 4}" class="tick">oldest</text><text x="${width}" y="${height - 4}" text-anchor="end" class="tick">newest</text>` +
    `</svg><p class="muted">Scale up to ${escapeHtml(format(max))}</p></figure>`
  );
}

const worstLcp = (e: PerfEntry): number | null => (e.pages.length ? Math.max(...e.pages.map((p) => p.lcpMs)) : null);
const medianScore = (e: PerfEntry): number | null => median(e.pages.map((p) => p.performance));

function pageRow(p: PageEntry, entries: PerfEntry[]): string {
  const report = p.report ? `<a href="${escapeHtml(p.report)}">report</a>` : '-';
  const diff = p.pixelDiff === null ? '-' : `${(p.pixelDiff * 100).toFixed(1)}%`;
  return (
    `<tr class="${p.passed ? 'ok-row' : 'bad-row'}"><td class="${p.passed ? 'ok' : 'bad'}">${p.passed ? 'pass' : 'FAIL'}</td><td>${escapeHtml(entryKey(p))}</td>` +
    `<td class="n">${p.performance}</td><td class="n">${escapeHtml(seconds(p.lcpMs))}</td><td class="n">${p.cls.toFixed(3)}</td><td class="n">${Math.round(p.tbtMs)} ms</td>` +
    `<td class="n">${p.errors}</td><td class="n">${diff}</td><td>${sparkline(series(entries, entryKey(p), (x) => x.performance, SPARK_RUNS), 100)}</td>` +
    `<td>${escapeHtml(p.failures.join('; ') || '-')}</td><td>${report}</td></tr>`
  );
}

function runRow(e: PerfEntry): string {
  const failing = e.pages.filter((p) => !p.passed).length;
  const url = safeUrl(e.runUrl);
  const score = medianScore(e);
  const lcp = worstLcp(e);
  return (
    `<tr><td>${escapeHtml(dateText(e.finishedAt))}</td><td class="${failing ? 'bad' : 'ok'}">${failing ? `${failing} of ${e.pages.length} failed${e.advisory ? ' (advisory)' : ''}` : `${e.pages.length} passed`}</td>` +
    `<td class="n">${score === null ? '-' : Math.round(score)}</td><td class="n">${lcp === null ? '-' : escapeHtml(seconds(lcp))}</td><td>${escapeHtml(e.persona || '-')}</td>` +
    `<td><code>${escapeHtml(e.commit.slice(0, 7) || '-')}</code></td><td>${url ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">run</a>` : '-'}</td></tr>`
  );
}

const PAGE_COLUMNS = ['', 'Page', 'Score', 'LCP', 'CLS', 'TBT', 'Errors', 'Changed', 'Score trend', 'Why', 'Full report'];
const RUN_COLUMNS = ['Date (UTC)', 'Result', 'Median score', 'Worst LCP', 'Persona', 'Commit', 'Run'];
const header = (columns: string[]): string => `<thead><tr>${columns.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead>`;

export function dashboardHtml(entries: PerfEntry[], appName = ''): string {
  const sorted = newestFirst(entries);
  const latest = sorted[0];
  const tileHtml = tiles(latest, sorted)
    .map(([v, k]) => `<li><span class="v">${escapeHtml(v)}</span><span class="k">${escapeHtml(k)}</span></li>`)
    .join('');
  const pageRows = latest ? worstFirst(latest.pages).map((p) => pageRow(p, sorted)).join('') : '';
  const runRows = sorted.map(runRow).join('');
  const title = `Performance${appName ? `: ${appName}` : ''}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="muted">Lighthouse through Playwright's signed-in browser, every route, mobile and desktop. The median of several runs is judged against the budgets and the previous run. Newest run first; the worst page first.${latest ? ` Last run ${escapeHtml(dateText(latest.finishedAt))} UTC.` : ''}</p>
<h2>Last run</h2>
<ul class="tiles">${tileHtml}</ul>
<div class="wrap"><table><caption class="muted">Every page of the last run, worst first. Full report links open the Lighthouse report of the median run.</caption>
${header(PAGE_COLUMNS)}<tbody>${pageRows || `<tr><td colspan="${PAGE_COLUMNS.length}">No run recorded yet.</td></tr>`}</tbody></table></div>
<h2>Trends</h2>
<div class="charts">
${chart('Median performance score per run', sorted, medianScore, (n) => String(Math.round(n)), 100)}
${chart('Worst LCP per run', sorted, worstLcp, seconds)}
</div>
<h2>Runs</h2>
<div class="wrap"><table>${header(RUN_COLUMNS)}<tbody>${runRows || `<tr><td colspan="${RUN_COLUMNS.length}">No runs recorded yet.</td></tr>`}</tbody></table></div>
</main>
</body>
</html>
`;
}

export function dashboardMd(entries: PerfEntry[], appName = ''): string {
  const sorted = newestFirst(entries);
  const latest = sorted[0];
  const lines = [`# Performance${appName ? `: ${appName}` : ''}`, '', 'Lighthouse over every route through the signed-in browser. `index.html` is the same as a page; serve this branch with GitHub Pages to see it.', ''];
  if (!latest) return [...lines, 'No runs recorded yet.', ''].join('\n');
  lines.push(`## Last run: ${dateText(latest.finishedAt)} UTC`, '', ...tiles(latest, sorted).map(([v, k]) => `- **${v}** ${k}`), '');
  lines.push('| | Page | Score | LCP | CLS | TBT | Errors | Why |', '|---|---|---|---|---|---|---|---|');
  for (const p of worstFirst(latest.pages)) lines.push(`| ${p.passed ? 'pass' : 'FAIL'} | ${entryKey(p)} | ${p.performance} | ${seconds(p.lcpMs)} | ${p.cls.toFixed(3)} | ${Math.round(p.tbtMs)} ms | ${p.errors} | ${p.failures.join('; ').replace(/\|/g, '\\|') || '-'} |`);
  lines.push('', '## Runs', '', '| Date (UTC) | Result | Median score | Worst LCP | Persona | Commit |', '|---|---|---|---|---|---|');
  for (const e of sorted) {
    const failing = e.pages.filter((p) => !p.passed).length;
    const score = medianScore(e);
    const lcp = worstLcp(e);
    const run = safeUrl(e.runUrl);
    lines.push(`| ${run ? `[${dateText(e.finishedAt)}](${run})` : dateText(e.finishedAt)} | ${failing ? `${failing} of ${e.pages.length} failed` : `${e.pages.length} passed`} | ${score === null ? '-' : Math.round(score)} | ${lcp === null ? '-' : seconds(lcp)} | ${e.persona || '-'} | ${e.commit.slice(0, 7) || '-'} |`);
  }
  return lines.join('\n') + '\n';
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;--tile:#f6f8fa;--accent:#0969da;--bar:#0969da;--ok:#1a7f37;--bad:#cf222e}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--line:#3d444d;--tile:#151b23;--accent:#4493f8;--bar:#4493f8;--ok:#3fb950;--bad:#ff7b72}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1300px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:32px 0 12px}
a{color:var(--accent)}
.muted{color:var(--muted);font-size:.875rem;margin:4px 0 0}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;padding:0;margin:16px 0;list-style:none}
.tiles li{background:var(--tile);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.tiles .v{display:block;font-size:1.4rem;font-weight:600;overflow-wrap:anywhere}
.tiles .k{color:var(--muted);font-size:.8rem}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
figure{margin:0;background:var(--tile);border:1px solid var(--line);border-radius:8px;padding:12px}
figcaption{font-weight:600;margin-bottom:6px}
figure svg{width:100%;height:150px;display:block}
svg rect{fill:var(--bar)}svg rect.bad{fill:var(--bad)}svg .axis{stroke:var(--line);stroke-width:1}svg .tick{fill:var(--muted);font-size:10px}
.spark{width:120px;height:28px;display:block}.spark polyline{fill:none;stroke:var(--accent);stroke-width:1.5}
.wrap{overflow-x:auto;margin-top:12px;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;min-width:900px;font-size:.9rem}
caption{text-align:left;padding:8px 10px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--tile);white-space:nowrap}
td.n{text-align:right;white-space:nowrap}
tr:last-child td{border-bottom:0}
.ok{color:var(--ok);font-weight:600}.bad{color:var(--bad);font-weight:600}
code{font-size:.85em}
`;
