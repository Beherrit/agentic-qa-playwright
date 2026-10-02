/**
 * The run history: one small entry per finished pipeline run, kept on its own branch and turned into a
 * markdown page and a single HTML file. Pure functions only, so agents/test/ can check them without files.
 *
 * The artifact a run leaves passed through jobs where generated test code ran, so every value in it is
 * untrusted. Nothing is used before its type is checked, strings are capped, and what does not fit is dropped.
 */

export type GateEntry = { name: string; passed: boolean; advisory: boolean };
export type AgentEntry = { role: string; turns: number; seconds: number; costUsd: number };

export type RunEntry = {
  runId: string;
  runUrl: string;
  workflow: 'analysis' | 'tests';
  conclusion: string;
  finishedAt: string;
  key: string | null;
  title: string | null;
  source: string | null;
  mode: string | null;
  criteria: number | null;
  cases: number | null;
  planScore: number | null;
  gates: GateEntry[];
  gatesPassed: boolean | null;
  verdict: string | null;
  reviewRounds: number | null;
  findings: number | null;
  suspectedBugs: number | null;
  testsWritten: number | null;
  agents: AgentEntry[];
  costUsd: number;
  agentSeconds: number;
};

export type RunMeta = { runId: unknown; runUrl: unknown; workflow: unknown; conclusion: unknown; finishedAt: unknown };
export type RunFiles = Record<string, unknown>;

const MAX_GATES = 50;
const MAX_AGENTS = 100;

// ── Reading untrusted values ─────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A string with control characters turned into spaces and the length capped. Anything else is null. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}

/** A finite number, or null. A numeric string such as "3" counts; "NaN" and "Infinity" do not. */
function num(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** A count: a whole number, zero or more. */
function count(value: unknown): number | null {
  const n = num(value);
  return n === null || n < 0 ? null : Math.min(Math.round(n), 1_000_000);
}

const money = (value: unknown): number => Math.round(Math.min(Math.max(num(value) ?? 0, 0), 100_000) * 10_000) / 10_000;
const duration = (value: unknown): number => Math.round(Math.min(Math.max(num(value) ?? 0, 0), 10_000_000));

/** Only a plain link to GitHub is ever kept. Nothing else is rendered as a link. */
export function safeUrl(value: unknown): string {
  return typeof value === 'string' && /^https:\/\/github\.com\/[A-Za-z0-9._/-]+$/.test(value) ? value : '';
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.find((item) => item === value) ?? null;
}

function isoDate(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40) return '';
  const time = Date.parse(value);
  return Number.isNaN(time) ? '' : new Date(time).toISOString();
}

function idText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).replace(/[^0-9A-Za-z_-]/g, '').slice(0, 40) : '';
}

function gateList(value: unknown): GateEntry[] {
  if (!Array.isArray(value)) return [];
  const gates: GateEntry[] = [];
  for (const item of value.slice(0, MAX_GATES)) {
    if (!isRecord(item)) continue;
    const name = text(item.name, 80);
    if (name) gates.push({ name, passed: item.passed === true, advisory: item.advisory === true });
  }
  return gates;
}

function agentList(value: unknown): AgentEntry[] {
  if (!Array.isArray(value)) return [];
  const agents: AgentEntry[] = [];
  for (const item of value.slice(0, MAX_AGENTS)) {
    if (!isRecord(item)) continue;
    const role = text(item.role, 40);
    if (role) agents.push({ role, turns: count(item.turns) ?? 0, seconds: duration(item.seconds), costUsd: money(item.costUsd) });
  }
  return agents;
}

const sumOf = (numbers: number[]): number => numbers.reduce((a, b) => a + b, 0);
const score100 = (value: unknown): number | null => {
  const n = num(value);
  return n === null ? null : Math.round(Math.min(Math.max(n, 0), 100));
};
const length = (value: unknown): number | null => (Array.isArray(value) ? Math.min(value.length, 1000) : null);

// ── Building and cleaning entries ────────────────────────────────────────────

/** One entry from the files a run left behind. Missing or malformed files leave their fields empty. */
export function buildEntry(meta: RunMeta, files: RunFiles): RunEntry {
  const request = isRecord(files['request.json']) ? files['request.json'] : {};
  const requirements = isRecord(files['requirements.json']) ? files['requirements.json'] : {};
  const strategy = isRecord(files['strategy.json']) ? files['strategy.json'] : {};
  const generation = isRecord(files['generation.json']) ? files['generation.json'] : {};
  const gates = isRecord(files['gates.json']) ? files['gates.json'] : {};
  const review = isRecord(files['review.json']) ? files['review.json'] : {};
  const round = isRecord(files['round.json']) ? files['round.json'] : {};
  const health = isRecord(strategy.health) ? strategy.health : {};

  const hasReview = isRecord(files['review.json']);
  const agents = agentList(files['ledger.json']);

  return {
    runId: idText(meta.runId),
    runUrl: safeUrl(meta.runUrl),
    workflow: meta.workflow === 'tests' ? 'tests' : 'analysis',
    conclusion: text(meta.conclusion, 40) ?? 'unknown',
    finishedAt: isoDate(meta.finishedAt),
    key: text(request.key, 60),
    title: text(request.title, 200),
    source: oneOf(request.source, ['github', 'jira', 'local']),
    mode: oneOf(request.mode, ['built', 'test-first']),
    criteria: length(requirements.criteria),
    cases: length(strategy.cases),
    planScore: score100(health.score),
    gates: gateList(gates.results),
    gatesPassed: typeof gates.passed === 'boolean' ? gates.passed : null,
    verdict: oneOf(review.verdict, ['approve', 'request-changes']),
    reviewRounds: hasReview ? Math.min(Math.max(count(round.round) ?? 1, 1), 10) : null,
    findings: hasReview ? length(review.findings) : null,
    suspectedBugs: length(generation.suspectedBugs),
    testsWritten: length(generation.automated),
    agents,
    costUsd: Math.round(sumOf(agents.map((a) => a.costUsd)) * 10_000) / 10_000,
    agentSeconds: sumOf(agents.map((a) => a.seconds)),
  };
}

/** Re-checks an entry read back from the stored history. Null when it has no usable run id. */
export function cleanEntry(raw: unknown): RunEntry | null {
  if (!isRecord(raw)) return null;
  const runId = idText(raw.runId);
  if (!runId) return null;
  const agents = agentList(raw.agents);
  const rounds = count(raw.reviewRounds);
  return {
    runId,
    runUrl: safeUrl(raw.runUrl),
    workflow: raw.workflow === 'tests' ? 'tests' : 'analysis',
    conclusion: text(raw.conclusion, 40) ?? 'unknown',
    finishedAt: isoDate(raw.finishedAt),
    key: text(raw.key, 60),
    title: text(raw.title, 200),
    source: oneOf(raw.source, ['github', 'jira', 'local']),
    mode: oneOf(raw.mode, ['built', 'test-first']),
    criteria: count(raw.criteria),
    cases: count(raw.cases),
    planScore: score100(raw.planScore),
    gates: gateList(raw.gates),
    gatesPassed: typeof raw.gatesPassed === 'boolean' ? raw.gatesPassed : null,
    verdict: oneOf(raw.verdict, ['approve', 'request-changes']),
    reviewRounds: rounds === null ? null : Math.min(Math.max(rounds, 1), 10),
    findings: count(raw.findings),
    suspectedBugs: count(raw.suspectedBugs),
    testsWritten: count(raw.testsWritten),
    agents,
    costUsd: Math.round(sumOf(agents.map((a) => a.costUsd)) * 10_000) / 10_000,
    agentSeconds: sumOf(agents.map((a) => a.seconds)),
  };
}

/** The entries in runs.jsonl. A damaged line is skipped, not fatal. */
export function parseRunLog(text: string): RunEntry[] {
  const entries: RunEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = cleanEntry(JSON.parse(line));
      if (entry) entries.push(entry);
    } catch {
      // Not JSON: skipped.
    }
  }
  return entries;
}

/** Newest first. The sort is stable, so entries with the same time keep their order. */
export function newestFirst(entries: RunEntry[]): RunEntry[] {
  return [...entries].sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : a.finishedAt > b.finishedAt ? -1 : 0));
}

/** Replaces the entry with the same run id, or adds it. Newest first. */
export function mergeEntries(existing: RunEntry[], entry: RunEntry): RunEntry[] {
  return newestFirst([...existing.filter((e) => e.runId !== entry.runId), entry]);
}

// ── Summary ──────────────────────────────────────────────────────────────────

export type Summary = {
  runs: number;
  analysisRuns: number;
  testsRuns: number;
  /** Tests runs whose gates all passed, out of the tests runs that reached the gates. Null when none did. */
  gatePassRate: number | null;
  approvedFirst: number;
  approvedAfterRework: number;
  /** Tests runs without an approval, including the ones that never reached a review. */
  notApproved: number;
  approvedFirstRate: number | null;
  approvedAfterReworkRate: number | null;
  notApprovedRate: number | null;
  avgPlanScore: number | null;
  totalCostUsd: number;
  avgCostUsd: number | null;
  avgSeconds: number | null;
  /** The blocking gate that failed in the most tests runs. Advisory gates do not count. */
  topFailedGate: { name: string; count: number } | null;
};

export function summary(entries: RunEntry[]): Summary {
  const tests = entries.filter((e) => e.workflow === 'tests');
  const gated = tests.filter((e) => e.gatesPassed !== null);
  const scores = entries.flatMap((e) => (e.planScore === null ? [] : [e.planScore]));

  const approved = tests.filter((e) => e.verdict === 'approve');
  const first = approved.filter((e) => (e.reviewRounds ?? 1) <= 1).length;
  const rework = approved.length - first;
  const none = tests.length - approved.length;

  const failures = new Map<string, number>();
  for (const entry of tests) {
    for (const gate of entry.gates) if (!gate.passed && !gate.advisory) failures.set(gate.name, (failures.get(gate.name) ?? 0) + 1);
  }
  let top: { name: string; count: number } | null = null;
  for (const [name, n] of failures) if (!top || n > top.count) top = { name, count: n };

  const share = (part: number): number | null => (tests.length ? part / tests.length : null);
  const totalCost = sumOf(entries.map((e) => e.costUsd));

  return {
    runs: entries.length,
    analysisRuns: entries.length - tests.length,
    testsRuns: tests.length,
    gatePassRate: gated.length ? gated.filter((e) => e.gatesPassed).length / gated.length : null,
    approvedFirst: first,
    approvedAfterRework: rework,
    notApproved: none,
    approvedFirstRate: share(first),
    approvedAfterReworkRate: share(rework),
    notApprovedRate: share(none),
    avgPlanScore: scores.length ? sumOf(scores) / scores.length : null,
    totalCostUsd: totalCost,
    avgCostUsd: entries.length ? totalCost / entries.length : null,
    avgSeconds: entries.length ? sumOf(entries.map((e) => e.agentSeconds)) / entries.length : null,
    topFailedGate: top,
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────

const percent = (share: number | null): string => (share === null ? '-' : `${Math.round(share * 100)}%`);
const dollars = (n: number | null): string => (n === null ? '-' : `$${n.toFixed(2)}`);

export function clock(seconds: number | null): string {
  if (seconds === null) return '-';
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return minutes < 60 ? `${minutes}m ${total % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const dateText = (iso: string): string => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : '-');

export function gatesText(e: RunEntry): string {
  if (!e.gates.length) return '-';
  const failed = e.gates.filter((g) => !g.passed);
  const names = failed.map((g) => (g.advisory ? `${g.name} (advisory)` : g.name));
  return `${e.gates.length - failed.length}/${e.gates.length} passed${names.length ? `, failed: ${names.join(', ')}` : ''}`;
}

export function reviewText(e: RunEntry): string {
  if (e.verdict === null) return '-';
  const verdict = e.verdict === 'approve' ? 'approved' : 'changes requested';
  const findings = e.findings === null ? '' : `, ${e.findings} ${e.findings === 1 ? 'finding' : 'findings'}`;
  return `${verdict}, round ${e.reviewRounds ?? 1}${findings}`;
}

const scoreText = (e: RunEntry): string => (e.planScore === null ? '-' : String(e.planScore));
const halfText = (e: RunEntry): string => (e.conclusion === 'success' ? e.workflow : `${e.workflow} (${e.conclusion})`);

function summaryLines(s: Summary): [string, string][] {
  return [
    ['Runs', `${s.runs} (${s.analysisRuns} analysis, ${s.testsRuns} tests)`],
    ['Gates passed (tests runs)', percent(s.gatePassRate)],
    ['Approved at first review', percent(s.approvedFirstRate)],
    ['Approved after rework', percent(s.approvedAfterReworkRate)],
    ['Not approved', percent(s.notApprovedRate)],
    ['Average plan score', s.avgPlanScore === null ? '-' : s.avgPlanScore.toFixed(0)],
    ['Total cost', dollars(s.totalCostUsd)],
    ['Average cost per run', dollars(s.avgCostUsd)],
    ['Average agent time', clock(s.avgSeconds)],
    ['Gate failing most often', s.topFailedGate ? `${s.topFailedGate.name} (${s.topFailedGate.count})` : '-'],
  ];
}

// ── Markdown ─────────────────────────────────────────────────────────────────

/** Safe inside a table cell: no pipes, line breaks, HTML or link syntax from the data. */
export function escapeMd(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[|[\]`*_~]/g, (c) => `\\${c}`);
}

/** The history page. With a limit, the summary still covers every run and the table shows the newest ones. */
export function historyMd(entries: RunEntry[], limit?: number): string {
  const all = newestFirst(entries);
  const sorted = limit === undefined ? all : all.slice(0, limit);
  const s = summary(all);
  // The same opening as every other report: a verdict line and the numbers behind it.
  const lines = [
    '## QA run history',
    '',
    `**${s.runs} runs: ${s.analysisRuns} analysis, ${s.testsRuns} tests.** Gates passed in ${percent(s.gatePassRate)} of tests runs; the review approved ${percent(s.approvedFirstRate)} at first review.`,
    '',
    `Average plan score ${s.avgPlanScore === null ? '-' : s.avgPlanScore.toFixed(0)}, estimated cost ${dollars(s.avgCostUsd)} per run, ${dollars(s.totalCostUsd)} in all.`,
    '',
    'Written by the "QA run history" workflow after every analysis and tests run.',
    '',
    '### Totals',
    '',
  ];
  for (const [label, value] of summaryLines(s)) lines.push(`- ${label}: ${escapeMd(value)}`);
  lines.push('', '### Runs', '');
  // A long table is folded behind its summary line, as in the other reports.
  const folded = sorted.length > 10;
  lines.push(`${sorted.length < all.length ? `The newest ${sorted.length} of ${all.length} runs` : `${sorted.length} runs`}, newest first.`);
  if (folded) lines.push('', '<details><summary>Show the runs</summary>');
  lines.push('', '| Date (UTC) | Ticket | Title | Half | Plan score | Gates | Review | Agent time | Est. cost | Run |');
  lines.push('| --- | --- | --- | --- | ---: | --- | --- | ---: | ---: | --- |');
  for (const e of sorted) {
    const cells = [
      dateText(e.finishedAt),
      e.key ?? '-',
      e.title ?? '-',
      halfText(e),
      scoreText(e),
      gatesText(e),
      reviewText(e),
      clock(e.agentSeconds),
      dollars(e.costUsd),
    ].map(escapeMd);
    const url = safeUrl(e.runUrl);
    cells.push(url ? `[run](${url})` : '-');
    lines.push(`| ${cells.join(' | ')} |`);
  }
  if (!sorted.length) lines.push('| No runs recorded yet. | | | | | | | | | |');
  if (folded) lines.push('', '</details>');
  return `${lines.join('\n')}\n`;
}

// ── HTML ─────────────────────────────────────────────────────────────────────

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

const CHART_RUNS = 30;

/** A bar chart as inline SVG. Bars run oldest to newest, left to right. */
function chart(title: string, entries: RunEntry[], value: (e: RunEntry) => number | null, format: (n: number) => string, fixedMax?: number): string {
  const recent = entries.slice(0, CHART_RUNS).reverse();
  const values = recent.map(value);
  const present = values.flatMap((v) => (v === null ? [] : [v]));
  if (!present.length) return `<figure><figcaption>${escapeHtml(title)}</figcaption><p class="muted">No data yet.</p></figure>`;
  const max = fixedMax ?? (Math.max(...present) || 1);
  const width = 600;
  const height = 150;
  const top = 8;
  const base = height - 20;
  const slot = width / CHART_RUNS;
  const bars = recent
    .map((e, i) => {
      const v = values[i];
      if (v === null) return '';
      const label = `${e.key ?? e.runId} (${e.workflow}, ${dateText(e.finishedAt)}): ${format(v)}`;
      const h = Math.max((v / max) * (base - top), 1);
      return `<rect x="${(i * slot + slot * 0.15).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${(slot * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${escapeHtml(label)}</title></rect>`;
    })
    .join('');
  const aria = `${title}, last ${recent.length} runs, highest ${format(Math.max(...present))}`;
  return (
    `<figure><figcaption>${escapeHtml(title)}</figcaption>` +
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(aria)}" preserveAspectRatio="none">` +
    `<line x1="0" y1="${base}" x2="${width}" y2="${base}" class="axis"/>${bars}` +
    `<text x="0" y="${height - 4}" class="tick">oldest</text><text x="${width}" y="${height - 4}" text-anchor="end" class="tick">newest</text>` +
    `</svg><p class="muted">Scale up to ${escapeHtml(format(max))}</p></figure>`
  );
}

function link(url: string): string {
  const safe = safeUrl(url);
  return safe ? `<a href="${escapeHtml(safe)}" rel="noopener noreferrer">run</a>` : '-';
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;--tile:#f6f8fa;--accent:#0969da;--bar:#0969da;--ok:#1a7f37;--bad:#cf222e}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--line:#3d444d;--tile:#151b23;--accent:#4493f8;--bar:#4493f8;--ok:#3fb950;--bad:#ff7b72}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px 48px}
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
svg{width:100%;height:150px;display:block}
svg rect{fill:var(--bar)}svg .axis{stroke:var(--line);stroke-width:1}svg .tick{fill:var(--muted);font-size:10px}
label{display:block;font-weight:600;margin-bottom:4px}
input{width:100%;max-width:420px;padding:8px 10px;font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--muted);border-radius:6px}
.wrap{overflow-x:auto;margin-top:12px;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;min-width:900px;font-size:.9rem}
caption{text-align:left;padding:8px 10px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--tile);white-space:nowrap}
td.n{text-align:right;white-space:nowrap}
tr:last-child td{border-bottom:0}
.ok{color:var(--ok)}.bad{color:var(--bad)}
[hidden]{display:none!important}
`;

// The data is read back from the JSON block and only ever written with textContent.
const SCRIPT = `
(function(){
  var data=[];
  try{data=JSON.parse(document.getElementById('run-data').textContent)||[];}catch(e){}
  var rows=document.querySelectorAll('#runs tbody tr[data-i]');
  var count=document.getElementById('count');
  var haystack=data.map(function(e){return [e.key,e.title,e.workflow,e.conclusion,e.verdict,e.mode,e.source].join(' ').toLowerCase();});
  function apply(q){
    q=q.trim().toLowerCase();var shown=0;
    rows.forEach(function(row){
      var i=Number(row.getAttribute('data-i'));
      var hit=!q||(haystack[i]||'').indexOf(q)!==-1;
      row.hidden=!hit;if(hit)shown++;
    });
    count.textContent=shown+' of '+rows.length+' runs shown';
  }
  document.getElementById('filter').addEventListener('input',function(ev){apply(ev.target.value);});
  apply('');
})();
`;

const COLUMNS = ['Date (UTC)', 'Ticket', 'Title', 'Half', 'Plan score', 'Gates', 'Review', 'Agent time', 'Est. cost', 'Run'];

export function historyHtml(entries: RunEntry[]): string {
  const sorted = newestFirst(entries);
  const tiles = summaryLines(summary(sorted))
    .map(([k, v]) => `<li><span class="v">${escapeHtml(v)}</span><span class="k">${escapeHtml(k)}</span></li>`)
    .join('');
  const rows = sorted
    .map((e, i) => {
      const gatesClass = e.gates.length === 0 ? '' : e.gates.some((g) => !g.passed && !g.advisory) ? 'bad' : 'ok';
      return (
        `<tr data-i="${i}"><td>${escapeHtml(dateText(e.finishedAt))}</td><td>${escapeHtml(e.key ?? '-')}</td><td>${escapeHtml(e.title ?? '-')}</td>` +
        `<td>${escapeHtml(halfText(e))}</td><td class="n">${escapeHtml(scoreText(e))}</td>` +
        `<td class="${gatesClass}">${escapeHtml(gatesText(e))}</td><td>${escapeHtml(reviewText(e))}</td>` +
        `<td class="n">${escapeHtml(clock(e.agentSeconds))}</td><td class="n">${escapeHtml(dollars(e.costUsd))}</td><td>${link(e.runUrl)}</td></tr>`
      );
    })
    .join('');
  const json = JSON.stringify(sorted).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA run history</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>QA run history</h1>
<p class="muted">Every analysis and tests run of the pipeline, newest first. Costs are estimates from the agent ledger.</p>
<h2>Summary</h2>
<ul class="tiles">${tiles}</ul>
<h2>Trends</h2>
<div class="charts">
${chart('Estimated cost per run (USD)', sorted, (e) => e.costUsd, (n) => `$${n.toFixed(2)}`)}
${chart('Plan score per run', sorted, (e) => e.planScore, (n) => String(Math.round(n)), 100)}
</div>
<h2>Runs</h2>
<label for="filter">Filter runs</label>
<input id="filter" type="search" placeholder="Ticket, title, verdict..." autocomplete="off">
<p class="muted" id="count" role="status"></p>
<div class="wrap">
<table id="runs">
<caption class="muted">One row per finished run</caption>
<thead><tr>${COLUMNS.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead>
<tbody>${rows || `<tr><td colspan="${COLUMNS.length}">No runs recorded yet.</td></tr>`}</tbody>
</table>
</div>
</main>
<script type="application/json" id="run-data">${json}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
