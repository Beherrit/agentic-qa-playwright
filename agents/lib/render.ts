import type { GateReport } from '../gates.ts';
import type { Generation, Request, Requirements, Review, Strategy, Triage } from './schemas.ts';
import type { RunRecord } from './store.ts';

/** Turns each stage's structured output into the markdown people read on the issue, the job summary and the PR. */

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const list = (items: string[]): string => (items.length ? items.map((item) => `- ${item}`).join('\n') : '- None');
const mark = (ok: boolean): string => (ok ? 'yes' : '**no**');

export function requirementsMd(request: Request, req: Requirements): string {
  const blocking = req.openQuestions.filter((q) => q.blocking);
  const other = req.openQuestions.filter((q) => !q.blocking);
  return `## Requirements: ${req.title} (${request.key})

**As** ${req.story.asA}, **I want** ${req.story.iWant}, **so that** ${req.story.soThat}.

**Risk:** ${req.risk}. ${req.riskReason}

### Acceptance criteria

| | Kind | Given | When | Then |
|---|---|---|---|---|
${req.criteria.map((c) => `| ${c.id} | ${c.kind} | ${cell(c.given)} | ${cell(c.when)} | ${cell(c.then)} |`).join('\n')}

### Assumptions

${list(req.assumptions)}

### Out of scope

${list(req.outOfScope)}
${
  blocking.length
    ? `\n### Questions that block testing\n\n${list(blocking.map((q) => `**${q.question}** ${q.why}`))}\n\nThe pipeline has stopped here. Answer these in the issue, then add the \`qa-pipeline\` label again.\n`
    : ''
}${other.length ? `\n### Open questions (not blocking)\n\n${list(other.map((q) => `${q.question} ${q.why}`))}\n` : ''}`;
}

export function strategyMd(request: Request, strategy: Strategy): string {
  const { health } = strategy;
  const added = new Set(strategy.added);
  const byLayer = (layer: string): number => strategy.cases.filter((c) => c.layer === layer).length;
  const weights = new Map(strategy.checklistItems.map((item) => [item.id, item]));

  return `## Test strategy (${request.key})

**Plan health: ${health.score}/100.** ${strategy.summary}

| Measure | Weight | Result | |
|---|---|---|---|
${health.parts.map((p) => `| ${p.name} | ${p.weight}% | ${Math.round(p.value * 100)}% | ${cell(p.detail)} |`).join('\n')}

${strategy.cases.length} test cases: ${byLayer('e2e')} e2e, ${byLayer('lower-layer')} lower layer, ${byLayer('manual')} manual.

### Test cases

| | Case | Proves | Technique | Level | Priority | Persona |
|---|---|---|---|---|---|---|
${strategy.cases
  .map(
    (c) =>
      `| ${c.id}${added.has(c.id) ? ' *' : ''} | ${cell(c.title)} | ${c.criteria.join(', ')} | ${c.technique} | ${c.layer} | ${c.priority} | ${cell(c.persona)} |`,
  )
  .join('\n')}
${added.size ? '\n\\* added after the independent critic found a gap.\n' : ''}
<details><summary>Steps and expected results</summary>

${strategy.cases
  .map(
    (c) =>
      `**${c.id}: ${c.title}**\n${c.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\nExpected: ${c.expected}\n\nLevel: ${c.layer}. ${c.layerReason}`,
  )
  .join('\n\n')}

</details>

${handOver(strategy)}### Independent critic's checklist

| | Must cover | Weight | Covered by |
|---|---|---|---|
${strategy.checklist
  .map((item) => {
    const source = weights.get(item.id);
    const covered = item.coveredBy.length ? item.coveredBy.join(', ') : `not covered. ${cell(item.note)}`;
    return `| ${item.id} | ${cell(source?.mustCover ?? '')} | ${source?.weight ?? ''} | ${covered} |`;
  })
  .join('\n')}

### Already covered by the suite

${list(strategy.existingCoverage.map((e) => `\`${e.file}\` "${e.test}": ${e.covers}`))}

<details><summary>What the architect saw in the app</summary>

${strategy.siteNotes}

</details>
`;
}

/** Cases this pipeline will not automate, as a checklist for whoever owns that level. */
function handOver(strategy: Strategy): string {
  const section = (layer: string, heading: string): string => {
    const cases = strategy.cases.filter((c) => c.layer === layer);
    if (cases.length === 0) return '';
    const items = cases.map((c) => `- [ ] ${c.id} ${c.title} (${c.criteria.join(', ')}). ${c.layerReason}`);
    return `**${heading}**\n${items.join('\n')}\n\n`;
  };
  const body =
    section('lower-layer', 'For the developers: cheaper to prove below the browser') +
    section('manual', 'For a person: needs human judgement');
  return body
    ? `### Handed over\n\nThe pipeline automates the e2e cases. These are for people to pick up.\n\n${body}`
    : '';
}

export function gatesMd(report: GateReport): string {
  return `## Quality gates: ${report.passed ? 'passed' : 'failed'}

| Gate | Passed | |
|---|---|---|
${report.results.map((g) => `| ${g.name} | ${mark(g.passed)} | ${cell(g.summary)} |`).join('\n')}
${report.results
  .filter((g) => !g.passed && g.output)
  .map((g) => `\n<details><summary>${g.name} output</summary>\n\n\`\`\`\n${g.output}\n\`\`\`\n\n</details>`)
  .join('\n')}
`;
}

export function reviewMd(review: Review, round: number): string {
  const order = ['blocker', 'major', 'minor', 'nit'];
  const findings = [...review.findings].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  return `## Code review${round > 1 ? ` (round ${round})` : ''}: ${review.verdict === 'approve' ? 'approved' : 'changes requested'}

${review.summary}

${
  findings.length
    ? `| Severity | Where | Issue | Suggestion |
|---|---|---|---|
${findings.map((f) => `| ${f.severity} | \`${f.file}${f.line ? `:${f.line}` : ''}\` | ${cell(f.issue)} | ${cell(f.suggestion)} |`).join('\n')}`
    : 'No findings.'
}

### Would each criterion's test catch a regression?

| | Verified | |
|---|---|---|
${review.criteria.map((c) => `| ${c.id} | ${mark(c.verified)} | ${cell(c.comment)} |`).join('\n')}
`;
}

export function ledgerMd(ledger: RunRecord[]): string {
  const total = ledger.reduce((sum, run) => sum + run.costUsd, 0);
  const seconds = ledger.reduce((sum, run) => sum + run.seconds, 0);
  return `| Agent | Turns | Time | Est. cost |
|---|---|---|---|
${ledger.map((run) => `| ${run.role} | ${run.turns} | ${run.seconds}s | $${run.costUsd.toFixed(2)} |`).join('\n')}
| **Total** | | **${Math.round(seconds / 60)} min** | **$${total.toFixed(2)}** |`;
}

export function pullRequestMd(input: {
  request: Request;
  requirements: Requirements;
  strategy: Strategy;
  generation: Generation;
  gates: GateReport;
  review: Review;
  round: number;
  ledger: RunRecord[];
}): string {
  const { request, requirements: req, strategy, generation, gates, review, round, ledger } = input;
  const approved = review.verdict === 'approve';
  const testsFor = (criterion: string): string =>
    generation.automated
      .filter((a) => strategy.cases.find((c) => c.id === a.caseId)?.criteria.includes(criterion))
      .map((a) => `${a.caseId} \`${a.file}\``)
      .join('<br>') || 'not automated';

  return `${request.issue ? `Closes #${request.issue}\n\n` : ''}Tests for **${req.title}**, written by the QA pipeline from the requirement in ${request.issue ? `#${request.issue}` : 'this run'}.

${
  approved
    ? 'The automated review approved this change. It still needs a person to read it and merge it.'
    : '**The automated review still has open findings after one round of rework, so this is a draft.** They are listed below for a person to decide on.'
}

${generation.summary}
${generation.suspectedBugs.length ? `\n### Suspected product bugs\n\nThe engineer found the app disagreeing with the criteria here. The tests assert the correct behaviour and are marked as expected failures.\n\n${list(generation.suspectedBugs)}\n` : ''}
### Traceability

| Criterion | Then | Tests | Reviewer verified |
|---|---|---|---|
${req.criteria
  .map((c) => {
    const verdict = review.criteria.find((r) => r.id === c.id);
    return `| ${c.id} (${c.kind}) | ${cell(c.then)} | ${testsFor(c.id)} | ${verdict ? mark(verdict.verified) : 'not checked'} |`;
  })
  .join('\n')}
${generation.notAutomated.length ? `\n### Not automated\n\n${list(generation.notAutomated.map((n) => `${n.caseId}: ${n.reason}`))}\n` : ''}
### How it got here

| Stage | Result |
|---|---|
| Requirements | ${req.criteria.length} acceptance criteria, risk ${req.risk} |
| Strategy | ${strategy.cases.length} test cases, plan health ${strategy.health.score}/100, ${strategy.added.length} added by the critic pass |
| Code generation | ${generation.automated.length} tests in ${generation.files.length} files |
| Quality gates | ${gates.results.map((g) => `${g.name}: ${g.passed ? 'pass' : 'FAIL'}`).join(', ')} |
| Code review | ${approved ? 'approved' : 'changes requested'}${round > 1 ? ` after ${round} rounds` : ''}, ${review.findings.length} findings |

<details><summary>Requirements</summary>

${requirementsMd(request, req)}

</details>

<details><summary>Test strategy</summary>

${strategyMd(request, strategy)}

</details>

<details><summary>Code review</summary>

${reviewMd(review, round)}

</details>

<details><summary>Agent runs</summary>

${ledgerMd(ledger)}

</details>
`;
}

export function triageMd(triage: Triage): string {
  const count = (verdict: string): number => triage.failures.filter((f) => f.verdict === verdict).length;
  return `## Failure triage

${triage.summary}

${triage.failures.length} failed: ${count('product-bug')} product bug, ${count('test-defect')} test defect, ${count('flaky')} flaky, ${count('environment')} environment.

| Test | Verdict | Confidence | Evidence | Next step |
|---|---|---|---|---|
${triage.failures.map((f) => `| ${cell(f.test)}<br>\`${f.file}\` | ${f.verdict} | ${f.confidence} | ${cell(f.evidence)} | ${cell(f.nextStep)} |`).join('\n')}
${triage.bugs.map((bug) => `\n${bugMd(bug)}`).join('\n')}
`;
}

export function bugMd(bug: Triage['bugs'][number]): string {
  return `### ${bug.title}

**Severity:** ${bug.severity}

**Steps to reproduce**
${bug.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

**Expected:** ${bug.expected}

**Actual:** ${bug.actual}

**Failing tests**
${list(bug.tests)}
`;
}
