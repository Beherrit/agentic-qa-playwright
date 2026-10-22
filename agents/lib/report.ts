import type { RunRecord } from './store.ts';
import { TIER_PURPOSE, Tier, type ModelSource } from './tiers.ts';

/**
 * The run report: one card per agent and one for the lead, the deterministic pipeline that dispatched them, enforced
 * their contracts and owns every decision that lands on the ticket. Built from the ledger the agents wrote, so it
 * covers every job of the run, failed calls included. Pure: the ledger and the lead's notes are passed in.
 *
 *   lead     what the run was, what it decided, what it cost by tier, and everything any agent escalated
 *   agents   per agent: tier and model, turns, time, tokens, outcome, and its own handoff
 */

export type LeadNotes = {
  /** What the run was, e.g. "QA analysis of #57". */
  title: string;
  /** The verdict in one line, e.g. "Ready for tests: plan health 86/100." */
  verdict: string;
  /** What the code decided on its own: checks that corrected an answer, gates, labels. */
  decisions?: string[];
};

const SOURCE_NOTE: Record<ModelSource, string> = {
  tier: '',
  role: ' (set for this role in qa.config.json)',
  'all-roles': ' (set for every role in qa.config.json)',
  QA_AGENT_MODEL: ' (set for every role by QA_AGENT_MODEL)',
};

const n = (value: number): string => (value >= 10_000 ? `${Math.round(value / 1000)}k` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value));
const tokensOf = (r: RunRecord): number => (r.tokens ? r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite : 0);
const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const minutes = (seconds: number): string => (seconds >= 90 ? `${Math.round(seconds / 60)} min` : `${seconds}s`);

/** Totals per tier, in tier order, for the lead's card. Calls from before tiers count as "untiered". */
export function byTier(ledger: RunRecord[]): { tier: string; calls: number; tokens: number; seconds: number; costUsd: number }[] {
  const order = [...Tier.options, 'untiered'];
  const rows = new Map<string, { tier: string; calls: number; tokens: number; seconds: number; costUsd: number }>();
  for (const r of ledger) {
    const tier = r.tier ?? 'untiered';
    const row = rows.get(tier) ?? { tier, calls: 0, tokens: 0, seconds: 0, costUsd: 0 };
    row.calls += 1;
    row.tokens += tokensOf(r);
    row.seconds += r.seconds;
    row.costUsd += Number.isFinite(r.costUsd) ? r.costUsd : 0;
    rows.set(tier, row);
  }
  return [...rows.values()].sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
}

/** A call that used nine tenths of its turns or more: the limit, not the work, may have ended it. */
export const nearLimit = (r: RunRecord): boolean => Boolean(r.maxTurns) && r.outcome !== 'failed' && r.turns >= Math.ceil(r.maxTurns! * 0.9);

/** Everything a person should look at, from every agent's handoff and from the calls that went wrong. */
export function escalations(ledger: RunRecord[]): string[] {
  const out: string[] = [];
  for (const r of ledger) {
    if (r.outcome === 'failed') out.push(`**${r.role}** failed: ${r.error ?? 'see the run log'}`);
    if (r.fellBack) out.push(`**${r.role}** ran on its fallback model (${r.model}); its tier's model was not available.`);
    for (const e of r.handoff?.escalations ?? []) out.push(`**${r.role}**: ${e}`);
    if (r.handoff?.confidence === 'low') out.push(`**${r.role}** has low confidence: ${r.handoff.confidenceReason}`);
    if (nearLimit(r)) out.push(`**${r.role}** used ${r.turns} of its ${r.maxTurns} turns: it may have stopped short, so read its answer with that in mind.`);
  }
  return out;
}

/** One agent's card. */
export function agentCard(r: RunRecord, index: number): string {
  const model = r.model ? `${r.tier ?? 'untiered'} tier, ${r.model}${r.modelSource ? SOURCE_NOTE[r.modelSource] : ''}` : 'model not recorded';
  const tokens = r.tokens ? `${n(r.tokens.input)} in, ${n(r.tokens.output)} out, ${n(r.tokens.cacheRead)} from cache` : 'not recorded';
  const h = r.handoff;
  const lines = [
    `#### ${index}. ${r.role}${r.outcome === 'failed' ? ' (failed)' : ''}`,
    '',
    `- **Ran on:** ${model}${r.fellBack ? ', **fell back**' : ''}`,
    `- **Took:** ${r.turns}${r.maxTurns ? ` of ${r.maxTurns}` : ''} turns, ${minutes(r.seconds)}, $${r.costUsd.toFixed(2)} est. Tokens: ${tokens}`,
  ];
  if (r.outcome === 'failed') lines.push(`- **Failed:** ${r.error ?? 'see the run log'}`);
  if (h) {
    lines.push(`- **Did:** ${h.summary}`);
    if (h.decisions.length) lines.push(`- **Calls it made:**`, ...h.decisions.map((d) => `  - ${d}`));
    lines.push(`- **Escalated:** ${h.escalations.length ? '' : 'nothing'}`, ...h.escalations.map((e) => `  - ${e}`));
    lines.push(`- **Confidence:** ${h.confidence}. ${h.confidenceReason}`);
  } else if (r.outcome !== 'failed' && r.tier) {
    lines.push('- **Handoff:** none handed in.');
  }
  return lines.join('\n');
}

/** The lead's card and the table of agents: the part that goes on the ticket. */
export function leadMd(ledger: RunRecord[], notes: LeadNotes): string {
  const seconds = ledger.reduce((sum, r) => sum + r.seconds, 0);
  const cost = ledger.reduce((sum, r) => sum + (Number.isFinite(r.costUsd) ? r.costUsd : 0), 0);
  const tokens = ledger.reduce((sum, r) => sum + tokensOf(r), 0);
  const raised = escalations(ledger);
  const tiers = byTier(ledger)
    .map((t) => `| ${t.tier} | ${t.tier in TIER_PURPOSE ? TIER_PURPOSE[t.tier as Tier] : 'recorded before tiers'} | ${t.calls} | ${n(t.tokens)} | ${minutes(t.seconds)} | $${t.costUsd.toFixed(2)} |`)
    .join('\n');
  const agents = ledger
    .map(
      (r, i) =>
        `| ${i + 1} | ${r.role} | ${r.tier ?? ''} | ${cell(r.model ?? '')}${r.fellBack ? ' (fallback)' : ''} | ${r.turns} | ${minutes(r.seconds)} | ${n(tokensOf(r))} | ${r.outcome === 'failed' ? 'failed' : (r.handoff?.confidence ?? '')} |`,
    )
    .join('\n');
  return `### Lead: ${notes.title}

${notes.verdict} ${ledger.length} agent call(s), ${minutes(seconds)} of agent time, ${n(tokens)} tokens, about $${cost.toFixed(2)}.
${notes.decisions?.length ? `\n**Decided by the pipeline, not an agent:**\n\n${notes.decisions.map((d) => `- ${d}`).join('\n')}\n` : ''}
**For a person to check:** ${raised.length ? '' : 'nothing was escalated.'}
${raised.map((e) => `- ${e}`).join('\n')}

| Tier | For | Calls | Tokens | Time | Est. cost |
|---|---|---|---|---|---|
${tiers}

| # | Agent | Tier | Model | Turns | Time | Tokens | Confidence |
|---|---|---|---|---|---|---|---|
${agents}`.replace(/\n{3,}/g, '\n\n');
}

/** The whole report: the lead, then every agent's card. Saved as run-report.md and shown in the job summary. */
export function runReportMd(ledger: RunRecord[], notes: LeadNotes): string {
  return `## Run report

${leadMd(ledger, notes)}

### Agents

${ledger.map((r, i) => agentCard(r, i + 1)).join('\n\n') || '_No agent ran._'}
`;
}
