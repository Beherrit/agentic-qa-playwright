import { runAgent } from './lib/agent.ts';
import { applyPatch, runGates, savePatch, type GateReport } from './gates.ts';
import { config, projectDoc } from './lib/paths.ts';
import { gatesMd, pullRequestMd, requirementsMd, reviewMd, strategyMd } from './lib/render.ts';
import {
  Checklist,
  Generation,
  Plan,
  Reconciled,
  Requirements,
  Review,
  type Health,
  type Request,
  type Strategy,
} from './lib/schemas.ts';
import { exists, jobSummary, load, loadText, prompt, save, setOutput, type RunRecord } from './lib/store.ts';

/**
 * The pipeline, one function per stage. Each stage reads what earlier stages left in the run folder,
 * does its work, and leaves its own result there as JSON (for the next stage) and markdown (for people).
 */

const request = (): Request => load<Request>('request.json');
const brief = (): string => `<product-brief>\n${projectDoc(config.app.brief)}\n</product-brief>`;
const conventions = (): string => `<test-conventions>\n${projectDoc(config.conventions)}\n</test-conventions>`;
const design = (): string => `<test-design-notes>\n${projectDoc('docs/test-design.md')}\n</test-design-notes>`;
const requirementText = (r: Request): string => `<requirement key="${r.key}">\n# ${r.title}\n\n${r.body}\n</requirement>`;

// ── 1. Requirements ──────────────────────────────────────────────────────────

export async function requirements(): Promise<boolean> {
  const req = request();
  const { output } = await runAgent({
    role: 'requirements-analyst',
    instructions: prompt('requirements-analyst'),
    task: `Analyse this requirement for ${config.app.name}.\n\n${requirementText(req)}\n\n${brief()}`,
    schema: Requirements,
    access: 'read',
    maxTurns: 20,
  });

  const ready = !output.openQuestions.some((question) => question.blocking);
  const markdown = requirementsMd(req, output);
  save('requirements.json', output);
  save('requirements.md', markdown);
  jobSummary(markdown);
  setOutput('ready', ready);
  return ready;
}

// ── 2. Strategy: architect and critic work apart, then the plan is reconciled ──

const criteriaText = (): string => `<requirements>\n${loadText('requirements.md')}\n</requirements>`;

export async function plan(): Promise<void> {
  const { output } = await runAgent({
    role: 'test-architect',
    instructions: prompt('test-architect'),
    task: `Write the test plan for this requirement. The app is ${config.app.name} at ${config.app.baseUrl}.\n\n${criteriaText()}\n\n${brief()}\n\n${design()}`,
    schema: Plan,
    access: 'read',
    browser: true,
    maxTurns: 60,
  });
  save('plan.json', output);
}

export async function critic(): Promise<void> {
  const { output } = await runAgent({
    role: 'plan-critic',
    instructions: prompt('plan-critic'),
    task: `Write the checklist a test plan for this requirement must satisfy.\n\n${criteriaText()}\n\n${brief()}\n\n${design()}`,
    schema: Checklist,
    access: 'read',
    maxTurns: 15,
  });
  save('checklist.json', output);
}

export async function reconcile(): Promise<boolean> {
  const req = load<Requirements>('requirements.json');
  const draft = load<Plan>('plan.json');
  const checklist = load<Checklist>('checklist.json');

  const { output } = await runAgent({
    role: 'plan-reconciler',
    instructions: prompt('plan-reconciler'),
    task: `Reconcile the plan with the critic's checklist.\n\n${criteriaText()}\n\n<plan>\n${JSON.stringify(draft.cases, null, 2)}\n</plan>\n\n<checklist>\n${JSON.stringify(checklist.items, null, 2)}\n</checklist>\n\n${design()}`,
    schema: Reconciled,
    access: 'read',
    maxTurns: 10,
  });

  // Do not take the agent's word for the mapping: drop references to cases or criteria that do not exist.
  const criterionIds = new Set(req.criteria.map((c) => c.id));
  const cases = output.cases.map((c) => ({ ...c, criteria: c.criteria.filter((id) => criterionIds.has(id)) }));
  const caseIds = new Set(cases.map((c) => c.id));
  const mapping = checklist.items.map((item) => {
    const answer = output.checklist.find((entry) => entry.id === item.id);
    return { id: item.id, coveredBy: (answer?.coveredBy ?? []).filter((id) => caseIds.has(id)), note: answer?.note ?? 'Not addressed.' };
  });

  const strategy: Strategy = {
    existingCoverage: draft.existingCoverage,
    siteNotes: draft.siteNotes,
    ...output,
    cases,
    checklist: mapping,
    checklistItems: checklist.items,
    health: { score: 0, parts: [] },
  };
  strategy.health = planHealth(req, strategy);

  const markdown = strategyMd(request(), strategy);
  save('strategy.json', strategy);
  save('strategy.md', markdown);
  jobSummary(markdown);

  const proceed = strategy.health.score >= config.minPlanScore;
  setOutput('score', strategy.health.score);
  setOutput('proceed', proceed);
  return proceed;
}

/** Scores the plan from facts, not from the planner's opinion of its own work. */
export function planHealth(req: Requirements, strategy: Strategy): Health {
  const share = (part: number, whole: number): number => (whole === 0 ? 1 : part / whole);
  const covered = new Set(strategy.cases.flatMap((c) => c.criteria));

  const criteriaCovered = req.criteria.filter((c) => covered.has(c.id));
  const unhappy = req.criteria.filter((c) => c.kind !== 'happy');
  const unhappyCovered = unhappy.filter((c) => covered.has(c.id));

  const weight = (id: string): number => (strategy.checklistItems.find((item) => item.id === id)?.weight === 'must' ? 2 : 1);
  const checklistTotal = strategy.checklist.reduce((sum, item) => sum + weight(item.id), 0);
  const checklistMet = strategy.checklist.filter((item) => item.coveredBy.length).reduce((sum, item) => sum + weight(item.id), 0);

  const automated = strategy.cases.filter((c) => c.layer !== 'manual');

  const parts = [
    {
      name: 'Acceptance criteria covered',
      weight: 40,
      value: share(criteriaCovered.length, req.criteria.length),
      detail: `${criteriaCovered.length} of ${req.criteria.length} criteria have a test case`,
    },
    {
      name: "Critic's checklist met",
      weight: 30,
      value: share(checklistMet, checklistTotal),
      detail: `${strategy.checklist.filter((item) => item.coveredBy.length).length} of ${strategy.checklist.length} items covered (must items count double)`,
    },
    {
      name: 'Negative and edge criteria covered',
      weight: 20,
      value: share(unhappyCovered.length, unhappy.length),
      detail: `${unhappyCovered.length} of ${unhappy.length}`,
    },
    {
      name: 'Automated rather than manual',
      weight: 10,
      value: share(automated.length, strategy.cases.length),
      detail: `${automated.length} of ${strategy.cases.length} cases`,
    },
  ];
  return { score: Math.round(parts.reduce((sum, part) => sum + part.weight * part.value, 0)), parts };
}

// ── 3. Code generation, checked by the gates ─────────────────────────────────

async function engineer(task: string): Promise<Generation> {
  const { output } = await runAgent({
    role: 'automation-engineer',
    instructions: prompt('automation-engineer'),
    task,
    schema: Generation,
    access: 'write',
    browser: true,
    maxTurns: 80,
  });
  return output;
}

function engineerBrief(): string {
  const req = request();
  const strategy = load<Strategy>('strategy.json');
  const cases = strategy.cases.filter((c) => c.layer === 'e2e');
  const others = strategy.cases.filter((c) => c.layer !== 'e2e').map((c) => `${c.id} (${c.layer}): ${c.title}. ${c.layerReason}`);
  return `The app is ${config.app.name} at ${config.app.baseUrl}. The requirement key is ${req.key}: tag the describe block \`@${req.key}\` and each test with its \`@AC-n\` criteria.

You may write only inside: ${config.writable.join(', ')}

${criteriaText()}

<cases-to-automate>
${JSON.stringify(cases, null, 2)}
</cases-to-automate>

<cases-not-yours>
${others.join('\n') || 'None'}
</cases-not-yours>

<site-notes>
${strategy.siteNotes}
</site-notes>

${conventions()}`;
}

/** Runs the gates, and gives the engineer one chance to fix what they find. */
async function gated(generation: Generation): Promise<{ generation: Generation; gates: GateReport }> {
  const strategy = load<Strategy>('strategy.json');
  let gates = runGates(request(), strategy);
  if (!gates.passed) {
    console.log('\nGates failed. Sending the report back to the engineer once.');
    generation = await engineer(
      `Your tests are in the working tree but did not pass the quality gates. Fix the problems below, then report on the complete change (everything you have written for this requirement, not only this fix).\n\n<gate-report>\n${gatesMd(gates)}\n</gate-report>\n\n${engineerBrief()}`,
    );
    gates = runGates(request(), strategy);
  }
  savePatch();
  save('generation.json', generation);
  save('gates.json', gates);
  save('gates.md', gatesMd(gates));
  jobSummary(`## Code generation\n\n${generation.summary}\n\n${gatesMd(gates)}`);
  setOutput('gates', gates.passed ? 'passed' : 'failed');
  return { generation, gates };
}

export async function generate(): Promise<boolean> {
  const first = await engineer(`Write the Playwright tests for the cases below.\n\n${engineerBrief()}`);
  return (await gated(first)).gates.passed;
}

// ── 4. Code review, with one round of rework ─────────────────────────────────

async function reviewer(round: number): Promise<Review> {
  const strategy = load<Strategy>('strategy.json');
  const generation = load<Generation>('generation.json');
  const { output } = await runAgent({
    role: 'code-reviewer',
    instructions: prompt('code-reviewer'),
    task: `Review this change. It adds tests for requirement ${request().key}. The change is applied in the working tree, so you can read the full files.

${criteriaText()}

<planned-e2e-cases>
${JSON.stringify(strategy.cases.filter((c) => c.layer === 'e2e'), null, 2)}
</planned-e2e-cases>

<engineer-notes>
${generation.summary}
Suspected product bugs: ${generation.suspectedBugs.join(' | ') || 'none'}
</engineer-notes>

<diff>
${loadText('changes.patch')}
</diff>

${conventions()}`,
    schema: Review,
    access: 'read',
    maxTurns: 30,
  });

  // The verdict follows from the findings. An "approve" that lists a blocker is not an approval.
  const serious = output.findings.some((f) => f.severity === 'blocker' || f.severity === 'major');
  const review: Review = { ...output, verdict: serious ? 'request-changes' : output.verdict };

  const markdown = reviewMd(review, round);
  save('review.json', review);
  save(`review-${round}.md`, markdown);
  save('round.json', { round });
  jobSummary(markdown);
  setOutput('verdict', review.verdict);
  return review;
}

export async function review(): Promise<Review> {
  return reviewer(1);
}

export async function rework(): Promise<Review> {
  const findings = load<Review>('review.json').findings.filter((f) => f.severity !== 'nit');
  const fixed = await engineer(
    `A reviewer has read your tests, which are in the working tree, and asked for changes. Address each finding, or say in your summary why it does not apply. Then report on the complete change.\n\n<review-findings>\n${JSON.stringify(findings, null, 2)}\n</review-findings>\n\n${engineerBrief()}`,
  );
  const { gates } = await gated(fixed);
  if (!gates.passed) throw new Error('The reworked tests did not pass the quality gates.');
  return reviewer(2);
}

// ── 5. Hand over to a human ──────────────────────────────────────────────────

export function report(): void {
  const req = request();
  const requirementsDoc = load<Requirements>('requirements.json');
  const reviewDoc = load<Review>('review.json');
  const body = pullRequestMd({
    request: req,
    requirements: requirementsDoc,
    strategy: load<Strategy>('strategy.json'),
    generation: load<Generation>('generation.json'),
    gates: load<GateReport>('gates.json'),
    review: reviewDoc,
    round: exists('round.json') ? load<{ round: number }>('round.json').round : 1,
    ledger: exists('ledger.json') ? load<RunRecord[]>('ledger.json') : [],
  });
  save('pull-request.md', body);
  setOutput('title', `test: ${requirementsDoc.title} (${req.key})`);
  setOutput('branch', `qa/${req.key.toLowerCase()}`);
  setOutput('draft', reviewDoc.verdict !== 'approve');
}

export { applyPatch };
