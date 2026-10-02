import type { GateReport } from '../gates.ts';
import { technicalSection } from './draft.ts';
import { config, LABELS } from './paths.ts';
import type { Generation, Request, Requirements, Review, Strategy, Triage } from './schemas.ts';
import type { RunRecord } from './store.ts';
import type { TechnicalResult } from './technical.ts';

/**
 * Turns each stage's structured output into the markdown people read on the ticket, the job summary and the pull
 * request. Every report has the same shape, so a reader learns it once:
 *
 *   ## Title (ticket key)
 *   **Verdict.** One sentence.          <- two lines a manager can read without scrolling
 *   The counts behind it.
 *   ### Sections, with long tables folded behind a one-line summary
 *
 * The words are fixed too: ticket, criterion, test case, gate, verdict.
 */

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const list = (items: string[]): string => (items.length ? items.map((item) => `- ${item}`).join('\n') : '- None');
const mark = (ok: boolean): string => (ok ? 'yes' : '**no**');
const heading = (level: number, text: string): string => `${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${text}`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** A table longer than this is folded behind its summary line. */
export const LONG_TABLE = 10;

/**
 * A section behind a one-line summary that stays visible. With `open` it is shown inline under the same line:
 * for short tables, and for Jira, where the comment is read in a narrow panel.
 */
export function fold(summary: string, body: string, open = false): string {
  return open ? `${summary}\n\n${body}` : `<details><summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

export function table(head: string[], rows: string[][]): string {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

/** How to point at the ticket in prose: #12 on GitHub, a link on Jira. */
export function ticketRef(request: Request): string {
  if (request.source === 'github') return `#${request.ref}`;
  if (request.url) return `[${request.key}](${request.url})`;
  return request.source === 'local' ? 'this run' : request.key;
}

const TEST_FIRST_NOTE =
  'Written test-first: the feature is not built yet, so these tests are marked as expected failures. On the day it lands, Playwright reports them as "expected to fail, but passed". That is the signal to remove the markers.';

const kinds = (req: Requirements): string => {
  const n = (kind: string): number => req.criteria.filter((c) => c.kind === kind).length;
  return `${n('happy')} happy, ${n('negative')} negative, ${n('edge')} edge`;
};

// ── Requirements and the technical review ────────────────────────────────────

/** The technical review, as a section of the requirements. */
export function technicalMd(review: TechnicalResult, level = 3): string {
  const origin =
    review.by === 'ticket-writer'
      ? "_Taken from the ticket writer's notes and checked against the repository. No reviewer run._"
      : '_Written by the technical reviewer and checked against the repository._';
  const unguarded = review.touches.filter((t) => !t.guardedBy).length;
  const facts = `${plural(review.covered.length, 'existing test')} already cover part of it, ${plural(
    review.pages.filter((p) => !p.exists).length,
    'page object member',
  )} to add, ${review.touches.length ? `${unguarded} of ${review.touches.length} nearby behaviours unguarded` : 'no nearby behaviour at risk'}.`;
  const dropped = review.dropped.length ? `\n\n${fold(`Taken out by the checks (${review.dropped.length})`, list(review.dropped))}` : '';
  return `${heading(level, 'Technical review')}

${origin} ${facts}

**Technical risk:** ${review.risk}. ${review.riskReason}

${technicalSection(review)}${dropped}
`;
}

/** What a blocked ticket says next: how to answer so the analysis runs again by itself. Worded per tracker. */
export function howToAnswer(request: Pick<Request, 'source'>): string {
  const again =
    request.source === 'jira'
      ? 'The analysis runs again when the comment is added, through the Jira automation rule for `/qa-answer` (see the README), or when the `qa-pipeline` label is added again.'
      : request.source === 'github' || request.source === 'pr'
        ? `The analysis runs again by itself; adding the \`${LABELS.analyze}\` label again also works.`
        : `Then add the \`${LABELS.analyze}\` label again.`;
  return `The pipeline has stopped here. Answer on this ticket in a comment that starts with \`/qa-answer\` on its own line, one answer per question, numbered like the questions. Only a member of the project can answer. ${again}`;
}

export function requirementsMd(request: Request, req: Requirements, technical: TechnicalResult | null = null, level = 2): string {
  const blocking = req.openQuestions.filter((q) => q.blocking);
  const other = req.openQuestions.filter((q) => !q.blocking);
  const rows = req.criteria.map((c) => [c.id, c.kind, cell(c.given), cell(c.when), cell(c.then)]);
  const criteria = fold(`${plural(req.criteria.length, 'criterion', 'criteria')}: ${kinds(req)}.`, table(['', 'Kind', 'Given', 'When', 'Then'], rows), rows.length <= LONG_TABLE);
  const sub = (text: string): string => heading(level + 1, text);
  return `${heading(level, `Requirements: ${req.title} (${request.key})`)}

**As** ${req.story.asA}, **I want** ${req.story.iWant}, **so that** ${req.story.soThat}.

**Ticket risk:** ${req.risk}. ${req.riskReason}

${sub('Acceptance criteria')}

${criteria}

${sub('Assumptions')}

${list(req.assumptions)}

${sub('Out of scope')}

${list(req.outOfScope)}
${
  blocking.length
    ? `\n${sub('Questions that block testing')}\n\n${list(blocking.map((q) => `**${q.question}** ${q.why}`))}\n\n${howToAnswer(request)}\n`
    : ''
}${other.length ? `\n${sub('Open questions (not blocking)')}\n\n${list(other.map((q) => `${q.question} ${q.why}`))}\n` : ''}${technical ? `\n${technicalMd(technical, level + 1)}` : ''}`;
}

// ── The test plan ────────────────────────────────────────────────────────────

export function strategyMd(request: Request, strategy: Strategy, compact = false, level = 2): string {
  const { health } = strategy;
  const added = new Set(strategy.added);
  const byLayer = (layer: string): number => strategy.cases.filter((c) => c.layer === layer).length;
  const weights = new Map(strategy.checklistItems.map((item) => [item.id, item]));
  const sub = (text: string): string => heading(level + 1, text);

  const healthTable = table(
    ['Measure', 'Weight', 'Result', ''],
    health.parts.map((p) => [p.name, `${p.weight}%`, `${Math.round(p.value * 100)}%`, cell(p.detail)]),
  );
  const weakest = [...health.parts].sort((a, b) => a.value - b.value)[0];
  const caseRows = strategy.cases.map((c) => [
    `${c.id}${added.has(c.id) ? ' *' : ''}`,
    cell(c.title),
    c.criteria.join(', '),
    c.technique,
    c.layer,
    c.priority,
    cell(c.persona),
  ]);
  const covered = strategy.checklist.filter((item) => item.coveredBy.length).length;
  const mustMissed = strategy.checklist.filter((item) => !item.coveredBy.length && weights.get(item.id)?.weight === 'must').length;
  const checklistRows = strategy.checklist.map((item) => {
    const source = weights.get(item.id);
    return [item.id, cell(source?.mustCover ?? ''), source?.weight ?? '', item.coveredBy.length ? item.coveredBy.join(', ') : `not covered. ${cell(item.note)}`];
  });

  return `${heading(level, `Test strategy (${request.key})`)}

**Plan health: ${health.score}/100.** ${strategy.summary}

${plural(strategy.cases.length, 'test case')}: ${byLayer('e2e')} e2e, ${byLayer('lower-layer')} lower layer, ${byLayer('manual')} manual.${
    added.size ? ` ${added.size} added after the critic's checklist.` : ''
  }

${health.parts.length ? fold(`How the score is made up${weakest ? `: weakest is "${weakest.name}" at ${Math.round(weakest.value * 100)}%` : ''}`, healthTable, compact) : ''}

${sub('Test cases')}

${fold(plural(strategy.cases.length, 'test case'), table(['', 'Case', 'Proves', 'Technique', 'Level', 'Priority', 'Persona'], caseRows), compact || caseRows.length <= LONG_TABLE)}
${added.size ? '\n\\* added after the independent critic found a gap.\n' : ''}
${contractMd(strategy, level + 1)}${
    compact
      ? ''
      : `${fold(
          'Steps and expected results',
          strategy.cases
            .map(
              (c) =>
                `**${c.id}: ${c.title}**\n${c.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\nExpected: ${c.expected}\n\nLevel: ${c.layer}. ${c.layerReason}`,
            )
            .join('\n\n'),
        )}

`
  }${handOver(strategy, level + 1)}${sub("Independent critic's checklist")}

${fold(
  `${covered} of ${strategy.checklist.length} checklist items covered${mustMissed ? `, ${plural(mustMissed, 'must item')} not covered` : ''}.`,
  table(['', 'Must cover', 'Weight', 'Covered by'], checklistRows),
  compact,
)}

${sub('Already covered by the suite')}

${list(strategy.existingCoverage.map((e) => `\`${e.file}\` "${e.test}": ${e.covers}`))}
${regressionMd(strategy, level + 1)}${compact ? '' : `\n${fold('What the architect saw in the app', strategy.siteNotes)}\n`}`;
}

/** What the feature sits next to, and whether the suite would notice if it broke. */
function regressionMd(strategy: Strategy, level: number): string {
  const risks = strategy.regressionRisks ?? [];
  if (risks.length === 0) return '';
  const unguarded = risks.filter((r) => !r.guardedBy).length;
  return `
${heading(level, 'Nearby behaviour at risk')}

${unguarded ? `${unguarded} of ${risks.length} have no existing test that would catch a break.` : 'Each of these is already guarded by an existing test.'}

${table(
  ['Could break', 'Because', 'Guarded by'],
  risks.map((r) => [cell(r.area), cell(r.why), r.guardedBy ? cell(r.guardedBy) : '**nothing**']),
)}
`;
}

/** Test-first: what the developers build so the tests can find it. */
function contractMd(strategy: Strategy, level: number): string {
  const contract = strategy.contract ?? [];
  if (contract.length === 0) return '';
  return `${heading(level, 'For the developers: what the tests will look for')}

The tests are written before the feature. Build these so they can find it, or tell QA what to change.

${table(
  ['Element', 'Locator', 'On the page today'],
  contract.map((c) => [cell(c.element), `\`${cell(c.locator)}\``, c.exists ? 'yes' : 'no, to build']),
)}

`;
}

/** Test cases this pipeline will not automate, as a checklist for whoever owns that level. */
function handOver(strategy: Strategy, level: number): string {
  const section = (layer: string, label: string): string => {
    const cases = strategy.cases.filter((c) => c.layer === layer);
    if (cases.length === 0) return '';
    const items = cases.map((c) => `- [ ] ${c.id} ${c.title} (${c.criteria.join(', ')}). ${c.layerReason}`);
    return `**${label}**\n${items.join('\n')}\n\n`;
  };
  const body =
    section('lower-layer', 'For the developers: cheaper to prove below the browser') + section('manual', 'For a person: needs human judgement');
  return body ? `${heading(level, 'Handed over')}\n\nThe pipeline automates the e2e test cases. These are for people to pick up.\n\n${body}` : '';
}

// ── Gates and review ─────────────────────────────────────────────────────────

export function gatesMd(report: GateReport, level = 2): string {
  const blocking = report.results.filter((g) => !g.advisory);
  const failed = blocking.filter((g) => !g.passed).map((g) => g.name);
  const advisoryFailed = report.results.filter((g) => g.advisory && !g.passed).map((g) => g.name);
  const second = [
    failed.length ? `Failed: ${failed.join(', ')}.` : 'No blocking gate failed.',
    advisoryFailed.length ? `Advisory, not passed: ${advisoryFailed.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `${heading(level, `Quality gates: ${report.passed ? 'passed' : 'failed'}`)}

**Verdict: ${report.passed ? 'passed' : 'failed'}.** ${blocking.length - failed.length} of ${blocking.length} blocking gates passed.

${second}

${table(
  ['Gate', 'Verdict', 'Detail'],
  report.results.map((g) => [`${g.name}${g.advisory ? ' (advisory)' : ''}`, g.passed ? 'pass' : '**fail**', cell(g.summary)]),
)}
${report.results
  .filter((g) => !g.passed && g.output)
  .map((g) => `\n${fold(`${g.name} output`, `\`\`\`\n${g.output}\n\`\`\``)}`)
  .join('\n')}
${report.results
  .filter((g) => g.table)
  .map((g) => `\n${fold(`${g.name}: test by test`, g.table!)}`)
  .join('\n')}
`;
}

export function reviewMd(review: Review, round: number, level = 2): string {
  const order = ['blocker', 'major', 'minor', 'nit'];
  const findings = [...review.findings].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  const count = (severity: string): number => review.findings.filter((f) => f.severity === severity).length;
  const verified = review.criteria.filter((c) => c.verified).length;
  const approved = review.verdict === 'approve';
  return `${heading(level, `Code review${round > 1 ? ` (round ${round})` : ''}: ${approved ? 'approved' : 'changes requested'}`)}

**Verdict: ${approved ? 'approved' : 'changes requested'}.** Findings: ${count('blocker')} blocker, ${count('major')} major, ${count('minor')} minor, ${count('nit')} nit.

${verified} of ${review.criteria.length} criteria verified: a test would fail if the behaviour broke.

${review.summary}

${heading(level + 1, 'Findings')}

${
  findings.length
    ? table(
        ['Severity', 'Where', 'Issue', 'Suggestion'],
        findings.map((f) => [f.severity, `\`${f.file}${f.line ? `:${f.line}` : ''}\``, cell(f.issue), cell(f.suggestion)]),
      )
    : 'No findings.'
}

${heading(level + 1, "Would each criterion's test catch a regression?")}

${table(['', 'Verified', ''], review.criteria.map((c) => [c.id, mark(c.verified), cell(c.comment)]))}
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

// ── The pull request ─────────────────────────────────────────────────────────

export function pullRequestMd(input: {
  request: Request;
  requirements: Requirements;
  strategy: Strategy;
  generation: Generation;
  gates: GateReport;
  review: Review;
  round: number;
  ledger: RunRecord[];
  technical?: TechnicalResult | null;
}): string {
  const { request, requirements: req, strategy, generation, gates, review, round, ledger, technical = null } = input;
  const approved = review.verdict === 'approve';
  const testsFor = (criterion: string): string =>
    generation.automated
      .filter((a) => strategy.cases.find((c) => c.id === a.caseId)?.criteria.includes(criterion))
      .map((a) => `${a.caseId} \`${a.file}\``)
      .join('<br>') || 'not automated';
  const verified = req.criteria.filter((c) => review.criteria.find((r) => r.id === c.id)?.verified).length;
  const withTests = req.criteria.filter((c) => testsFor(c.id) !== 'not automated').length;
  const blocking = gates.results.filter((g) => !g.advisory);
  const cost = ledger.reduce((sum, run) => sum + run.costUsd, 0);

  const traceRows = req.criteria.map((c) => {
    const verdict = review.criteria.find((r) => r.id === c.id);
    return [`${c.id} (${c.kind})`, cell(c.then), testsFor(c.id), verdict ? mark(verdict.verified) : 'not checked'];
  });

  return `${heading(2, `Tests for ${req.title} (${request.key})`)}

${
  approved
    ? '**Verdict: approved by the automated review.** It still needs a person to read it and merge it.'
    : '**Verdict: draft. The automated review still has open findings after one round of rework.** They are listed below for a person to decide on.'
}

${plural(generation.automated.length, 'test')} for ${plural(req.criteria.length, 'criterion', 'criteria')}, ${verified} verified by the reviewer. Gates: ${
    gates.passed ? 'passed' : 'failed'
  } (${blocking.filter((g) => g.passed).length} of ${blocking.length} blocking). Plan health ${strategy.health.score}/100.${ledger.length ? ` Estimated agent cost $${cost.toFixed(2)}.` : ''}

Written by the QA pipeline from the requirement in ${ticketRef(request)}.${request.mode === 'test-first' ? ` ${TEST_FIRST_NOTE}` : ''}

${generation.summary}
${
  generation.suspectedBugs.length
    ? `\n### Suspected product bugs\n\nThe engineer found the app disagreeing with the criteria here. The tests assert the correct behaviour and are marked as expected failures.\n\n${list(generation.suspectedBugs)}\n`
    : ''
}
### Traceability

${fold(
  `${withTests} of ${req.criteria.length} criteria have a test; ${verified} verified by the reviewer.`,
  table(['Criterion', 'Then', 'Tests', 'Reviewer verified'], traceRows),
  traceRows.length <= LONG_TABLE,
)}
${generation.notAutomated.length ? `\n### Not automated\n\n${list(generation.notAutomated.map((n) => `${n.caseId}: ${n.reason}`))}\n` : ''}
### How it got here

${table(
  ['Stage', 'Result'],
  [
    ['Requirements', `${plural(req.criteria.length, 'criterion', 'criteria')}, ticket risk ${req.risk}`],
    ...(technical
      ? [['Technical review', `${technical.by === 'ticket-writer' ? "the ticket writer's notes, checked" : 'reviewer run, checked'}, technical risk ${technical.risk}`]]
      : []),
    ['Strategy', `${plural(strategy.cases.length, 'test case')}, plan health ${strategy.health.score}/100, ${strategy.added.length} added by the critic pass`],
    ['Code generation', `${plural(generation.automated.length, 'test')} in ${plural(generation.files.length, 'file')}`],
    ['Quality gates', gates.results.map((g) => `${g.name}: ${g.passed ? 'pass' : 'FAIL'}`).join(', ')],
    ['Code review', `${approved ? 'approved' : 'changes requested'}${round > 1 ? ` after ${round} rounds` : ''}, ${plural(review.findings.length, 'finding')}`],
  ],
)}

${gatesMd(gates, 3).trim()}

${fold('Requirements', requirementsMd(request, req, technical, 3))}

${fold('Test strategy', strategyMd(request, strategy, false, 3))}

${fold('Code review', reviewMd(review, round, 3))}

${fold('Agent runs', ledgerMd(ledger))}
${request.source === 'github' ? `\nCloses #${request.ref}\n` : ''}`;
}

// ── Regression ───────────────────────────────────────────────────────────────

export function triageMd(triage: Triage): string {
  const count = (verdict: string): number => triage.failures.filter((f) => f.verdict === verdict).length;
  const rows = triage.failures.map((f) => [`${cell(f.test)}<br>\`${f.file}\``, f.verdict, f.confidence, cell(f.evidence), cell(f.nextStep)]);
  return `${heading(2, 'Failure triage')}

**Verdict: ${plural(triage.failures.length, 'test')} failed: ${count('product-bug')} product bug, ${count('test-defect')} test defect, ${count('flaky')} flaky, ${count('environment')} environment.**

${plural(triage.bugs.length, 'bug')} grouped by cause below${count('test-defect') ? `; test defects go to the healer` : ''}.

${triage.summary}

${heading(3, 'Verdict per test')}

${fold(plural(rows.length, 'failed test'), table(['Test', 'Verdict', 'Confidence', 'Evidence', 'Next step'], rows), rows.length <= LONG_TABLE)}
${triage.bugs.length ? `\n${heading(3, 'Bugs')}\n${triage.bugs.map((bug) => `\n${bugMd(bug, 4)}`).join('\n')}` : ''}`;
}

/** One bug. On its own it is the body of the issue that is filed; in the triage report it is one of the bugs. */
export function bugMd(bug: Triage['bugs'][number], level = 3): string {
  return `${heading(level, bug.title)}

**Severity:** ${bug.severity}

**Steps to reproduce**
${bug.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

**Expected:** ${bug.expected}

**Actual:** ${bug.actual}

**Failing tests**
${list(bug.tests)}
`;
}

/** Tests marked test.fail() that now pass: the bug is fixed or the feature landed, and the marker should come off. */
export function landedMd(landed: { test: string; file: string }[], level = 2): string {
  if (landed.length === 0) return '';
  return `${heading(level, 'Expected failures that now pass')}

**${plural(landed.length, 'test')} marked with \`test.fail()\` now pass.** Each was marked for a known bug or a feature not built yet.

The bug is fixed or the feature has landed: remove the marker so the test guards it from here on.

${list(landed.map((f) => `${f.test} (\`${f.file}\`)`))}
`;
}

// ── On the ticket ────────────────────────────────────────────────────────────

/** The report the analysis workflow posts on the ticket, whatever state the analysis ended in. */
export function analysisMd(input: {
  request: Request;
  requirements: Requirements | null;
  strategy: Strategy | null;
  technical?: TechnicalResult | null;
  runUrl: string | null;
  compact?: boolean;
  /** The requirements were taken from a ticket the ticket writer filed, with no analyst run. */
  fromWriter?: boolean;
}): string {
  const { request, requirements: req, strategy, technical = null, runUrl, compact = false, fromWriter = false } = input;
  const run = runUrl ? ` [See the run](${runUrl}).` : '';
  const blocked = req?.openQuestions.some((q) => q.blocking) ?? false;

  let status: string;
  if (!req) status = `**The analysis did not finish.**${run}`;
  else if (blocked) status = `**Not ready to test yet.** The questions below block testing. Answer them on this ticket, then add the \`${LABELS.analyze}\` label again.`;
  else if (!strategy) status = `**The requirement was analysed, but the test plan did not finish.**${run}`;
  else if (strategy.health.score < config.minPlanScore)
    status = `**The test plan scored ${strategy.health.score}/100, below the pass mark of ${config.minPlanScore}.** No tests will be written from it. The breakdown below says what is missing; sharpen the requirement and add the \`${LABELS.analyze}\` label again.`;
  else
    status = `**Ready for tests.** Plan health ${strategy.health.score}/100. Add the \`${LABELS.generate}\` label to have the tests written and a pull request opened.${
      request.mode === 'test-first' ? ' The feature is marked as not built yet, so the tests will be written first, against the contract below.' : ''
    }`;

  const facts = req
    ? [
        `${plural(req.criteria.length, 'criterion', 'criteria')} (${kinds(req)}), ticket risk ${req.risk}`,
        technical && `technical risk ${technical.risk}`,
        strategy && `${plural(strategy.cases.length, 'test case')} (${strategy.cases.filter((c) => c.layer === 'e2e').length} e2e)`,
        strategy?.regressionRisks?.length &&
          `${strategy.regressionRisks.filter((r) => !r.guardedBy).length} of ${strategy.regressionRisks.length} nearby behaviours unguarded`,
      ]
        .filter(Boolean)
        .join('; ')
    : '';

  const body = `${heading(2, `QA analysis: ${request.title} (${request.key})`)}

${status}

${facts ? `${facts}.` : ''}
${fromWriter ? '\n_Requirements taken from the ticket as the ticket writer filed them. No analyst run._\n' : ''}
${req ? requirementsMd(request, req, technical, 3) : ''}
${strategy ? strategyMd(request, strategy, compact, 3) : ''}
${runUrl ? `\n_Full details, including each agent's cost: [run](${runUrl})._\n` : ''}`;
  return `${body.replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** What the test workflow posts on the ticket when it finishes. */
export function testsReadyMd(input: {
  request: Request;
  prUrl: string | null;
  draft: boolean;
  gates: GateReport | null;
  runUrl: string | null;
  /** Why the run could not start, when it did not get as far as the gates. */
  problem?: string | null;
}): string {
  const { request, prUrl, draft, gates, runUrl, problem } = input;
  const run = runUrl ? ` [See the run](${runUrl}).` : '';
  if (prUrl) {
    return `${heading(2, `Tests ready for review (${request.key})`)}

**The tests are in a pull request: ${prUrl}**

${draft ? 'The automated review still had open findings after one round of rework, so it is a draft for a person to decide on.' : 'The automated review approved it. A person still reads and merges it.'}
${request.mode === 'test-first' ? `\n${TEST_FIRST_NOTE}\n` : ''}`;
  }
  if (gates && !gates.passed) {
    return `${heading(2, `No tests this time (${request.key})`)}

**The generated tests did not pass the quality gates, so no pull request was opened.**${run}

${gatesMd(gates, 3)}`;
  }
  if (problem) {
    return `${heading(2, `No tests this time (${request.key})`)}

**No pull request was opened.**

${problem}${run}
`;
  }
  return `${heading(2, `The test run did not finish (${request.key})`)}

**No pull request was opened.**${run}`;
}
