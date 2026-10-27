/** A line chart with a filled area, as inline SVG. Pure: points in, markup out. */
import { escapeHtml } from '../history.ts';

type Point = { label: string; value: number | null };
const W = 720;
const H = 220;
const PAD = { l: 52, r: 16, t: 16, b: 30 };

/** Consecutive present points; a null point ends a run, which leaves a gap in the line. */
function runsOf(pts: { x: number; y: number | null }[]): { x: number; y: number }[][] {
  const runs: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  for (const p of pts) {
    if (p.y === null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push({ x: p.x, y: p.y });
  }
  if (cur.length) runs.push(cur);
  return runs;
}

const xy = (p: { x: number; y: number }): string => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;

export function areaChart(opts: { title: string; points: Point[]; max?: number; target?: number; format: (n: number) => string; yLabel: string }): string {
  const { title, points, format } = opts;
  const present = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const head = `<figure><figcaption>${escapeHtml(title)}</figcaption>`;
  if (!present.length) return `${head}<p class="muted">No data yet.</p></figure>`;

  const max = opts.max ?? (Math.max(...present, opts.target ?? 0) || 1);
  const base = H - PAD.b;
  const span = W - PAD.l - PAD.r;
  const xAt = (i: number): number => (points.length === 1 ? PAD.l + span / 2 : PAD.l + (i * span) / (points.length - 1));
  const yAt = (v: number): number => PAD.t + (1 - Math.min(Math.max(v / max, 0), 1)) * (base - PAD.t);
  const placed = points.map((p, i) => ({ x: xAt(i), y: p.value === null ? null : yAt(p.value) }));
  const runs = runsOf(placed);
  const line = runs.map((r) => `M${r.map(xy).join('L')}`).join('');
  const area = runs
    .filter((r) => r.length > 1)
    .map((r) => `M${r[0]!.x.toFixed(1)} ${base}L${r.map(xy).join('L')}L${r[r.length - 1]!.x.toFixed(1)} ${base}Z`)
    .join('');
  const dots = points
    .map((p, i) => {
      const y = placed[i]!.y;
      if (p.value === null || y === null) return '';
      return `<circle cx="${xAt(i).toFixed(1)}" cy="${y.toFixed(1)}" r="2.5"><title>${escapeHtml(`${p.label}: ${format(p.value)}`)}</title></circle>`;
    })
    .join('');
  const aria = `${title}, ${points.length} points, latest ${format(present[present.length - 1]!)}`;
  return (
    `${head}<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(aria)}">` +
    `${yAxis(max, yAt, format, opts.yLabel, base)}${targetLine(opts.target, yAt, format)}` +
    `<path class="area" d="${area}"/><path class="line" d="${line}"/>${dots}${xLabels(points, xAt)}</svg></figure>`
  );
}

function yAxis(max: number, yAt: (v: number) => number, format: (n: number) => string, yLabel: string, base: number): string {
  const ticks = [0, max / 2, max]
    .map((v) => {
      const y = yAt(v).toFixed(1);
      return `<line x1="${PAD.l}" y1="${y}" x2="${W - PAD.r}" y2="${y}" class="axis"/><text x="${PAD.l - 6}" y="${(yAt(v) + 4).toFixed(1)}" text-anchor="end" class="tick">${escapeHtml(format(v))}</text>`;
    })
    .join('');
  const mid = ((PAD.t + base) / 2).toFixed(1);
  return `${ticks}<text x="12" y="${mid}" text-anchor="middle" transform="rotate(-90 12 ${mid})" class="tick">${escapeHtml(yLabel)}</text>`;
}

function targetLine(target: number | undefined, yAt: (v: number) => number, format: (n: number) => string): string {
  if (target === undefined) return '';
  const y = yAt(target).toFixed(1);
  return `<line x1="${PAD.l}" y1="${y}" x2="${W - PAD.r}" y2="${y}" class="target"/><text x="${W - PAD.r}" y="${(yAt(target) - 4).toFixed(1)}" text-anchor="end" class="tick">target ${escapeHtml(format(target))}</text>`;
}

function xLabels(points: Point[], xAt: (i: number) => number): string {
  const last = points.length - 1;
  const picks = [...new Set([0, Math.floor(last / 2), last])];
  return picks
    .map((i) => {
      const anchor = i === 0 && last > 0 ? 'start' : i === last && last > 0 ? 'end' : 'middle';
      return `<text x="${xAt(i).toFixed(1)}" y="${H - 8}" text-anchor="${anchor}" class="tick">${escapeHtml(points[i]!.label)}</text>`;
    })
    .join('');
}

