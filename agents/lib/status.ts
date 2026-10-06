import { BRANCH } from './keys.ts';
import { LABELS } from './paths.ts';

/** Where the open work stands: tickets carrying a pipeline label, and pull requests the pipeline opened. Pure. */

export type OpenIssue = { ref: string; title: string; url: string | null; labels: string[] };
export type OpenPull = { number: number; title: string; url: string | null; branch: string; draft: boolean };

const PIPELINE = new Set<string>(Object.values(LABELS));
const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/** What the labels say about a ticket, in the order a ticket moves through them. */
export function stageOf(labels: string[]): string {
  if (labels.includes(LABELS.refused)) return 'refused by the safety screen';
  if (labels.includes(LABELS.generate)) return 'tests being written';
  if (labels.includes(LABELS.needsInfo)) return 'waiting for answers';
  if (labels.includes(LABELS.analyze)) return 'analysis running or queued';
  if (labels.includes(LABELS.analyzed)) return 'analysed, ready for tests';
  return 'marked test-first, not started';
}

export function pipelineIssues(issues: OpenIssue[]): OpenIssue[] {
  return issues.filter((issue) => issue.labels.some((label) => PIPELINE.has(label)));
}

/** The pipeline's branches: qa/<key> for new tests, qa/heal-<run> for repairs. */
export function pipelinePulls(pulls: OpenPull[]): OpenPull[] {
  return pulls.filter((pull) => BRANCH.test(pull.branch));
}

export function statusMd(issues: OpenIssue[], pulls: OpenPull[]): string {
  const tickets = pipelineIssues(issues);
  const prs = pipelinePulls(pulls);
  const link = (text: string, url: string | null): string => (url ? `[${cell(text)}](${url})` : cell(text));
  const ticketRows = tickets.map(
    (t) => `| #${t.ref} | ${link(t.title, t.url)} | ${stageOf(t.labels)} | ${t.labels.filter((l) => PIPELINE.has(l)).join(', ')} |`,
  );
  const prRows = prs.map((p) => `| #${p.number} | ${link(p.title, p.url)} | \`${p.branch}\` | ${p.draft ? 'draft' : 'ready for review'} |`);
  return `## Pipeline status

${tickets.length} open ticket(s) with a pipeline label, ${prs.length} open pull request(s) from the pipeline.

### Tickets

${ticketRows.length ? `| Ticket | Title | Stage | Labels |\n|---|---|---|---|\n${ticketRows.join('\n')}` : 'None.'}

### Pull requests

${prRows.length ? `| Pull request | Title | Branch | State |\n|---|---|---|---|\n${prRows.join('\n')}` : 'None.'}
`;
}
