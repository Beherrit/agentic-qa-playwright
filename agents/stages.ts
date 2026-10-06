import fs from 'node:fs';
import path from 'node:path';
import { applyPatch, currentPatch, runGates, savePatch, type GateReport } from './gates.ts';
import { runAgent } from './lib/agent.ts';
import { checkedRisks } from './lib/draft.ts';
import { branchFor } from './lib/keys.ts';
import { config, LABELS, projectDoc, ROOT } from './lib/paths.ts';
import { analysisMd, gatesMd, pullRequestMd, requirementsMd, reviewMd, strategyMd, technicalMd, testsReadyMd } from './lib/render.ts';
import {
  Checklist,
  Generation,
  Plan,
  Reconciled,
  Requirements,
  Review,
  Sabotage,
  Skepticism,
  TechnicalReview,
  type Request,
  type Strategy,
} from './lib/schemas.ts';
import { checkedFaults, faultFiles } from './lib/sabotage.ts';
import { planHealth } from './lib/score.ts';
import { repoAt } from './lib/repo.ts';
import { screeningMd } from './lib/safety.ts';
import { checkTechnical, mergeRisks, technicalFromTicket, type TechnicalResult } from './lib/technical.ts';
import { requirementsFromTicket } from './lib/ticket.ts';
import { exists, jobSummary, load, loadText, prompt, save, setOutput, type RunRecord } from './lib/store.ts';
import { screen, screening } from './screen.ts';
import { sourceFor } from './sources/index.ts';
import type { OpenTicket } from './sources/types.ts';

/**
 * The pipeline, one function per stage. Each stage reads what earlier stages left in the run folder,
 * does its work, and leaves its own result there as JSON (for the next stage) and markdown (for people).
 *
 * Two halves, run by two workflows:
 *   analysis   requirements -> technical review -> plan + critic -> reconcile -> report on the ticket   (minutes, no code)
 *   tests      generate + gates -> review -> rework -> pull request -> report on the ticket
 */

export { planHealth, checkedRisks };

const request = (): Request => load<Request>('request.json');
/** Where the build under test answers: a pull request's preview when the requirement names one, else the app. */
const appUrl = (r: Request): string => r.baseUrl ?? config.app.baseUrl;
const brief = (): string => `<product-brief>\n${projectDoc(config.app.brief)}\n</product-brief>`;
const conventions = (): string => `<test-conventions>\n${projectDoc(config.conventions)}\n</test-conventions>`;
const design = (): string => `<test-design-notes>\n${projectDoc('docs/test-design.md')}\n</test-design-notes>`;
const requirementText = (r: Request): string =>
  `<requirement key="${r.key}">\n# ${r.title}\n\n${r.body}\n</requirement>${r.answers ? `\n\n<answers>\n${r.answers}\n</answers>` : ''}`;

const TEST_FIRST_PLAN = `
This requirement is in test-first mode: the feature is not built yet, so you will not find it in the app. Use the
browser for the parts that exist (how you get to the feature, what is around it). For the new parts, design the
tests the way they will run once the feature is built, and fill in the contract: every element the tests will need,
with the locator they will use. Prefer a role and accessible name; propose a data-test id where there is none.
Take locators from the requirement when it gives them. The developers build to this contract.`;

const BUILT_PLAN = `The feature is built. Leave the contract empty.`;

// ── 1. Requirements ──────────────────────────────────────────────────────────

/**
 * Asks the skeptic: what the story leaves to a developer's guess, with the guess written down. Runs on the story
 * alone, before the analyst, so the questions are not shaped by the criteria. Exported for the evaluation harness.
 */
export async function doubt(req: Request): Promise<Skepticism> {
  const { output } = await runAgent({
    role: 'skeptic',
    instructions: prompt('skeptic'),
    task: `List every question a developer would have to guess the answer to for this story for ${config.app.name}.\n\n${requirementText(req)}\n\n${brief()}`,
    schema: Skepticism,
    access: 'read',
    maxTurns: 8,
  });
  return output;
}

/** The skeptic's questions as the analyst and the architect see them. */
const doubtsText = (doubts: Skepticism): string =>
  `<questions-a-developer-would-guess>\n${doubts.questions
    .map((d, i) => `${i + 1}. ${d.question}\n   ${d.answer ? `Answered by the team: ${d.answer}` : `Assumed if nobody answers: ${d.assumed}`}`)
    .join('\n')}\n</questions-a-developer-would-guess>`;

/** Asks the requirements analyst. Exported so the evaluation harness can call it with a case of its own. */
export async function analyse(req: Request, doubts: Skepticism | null = null): Promise<Requirements> {
  const { output } = await runAgent({
    role: 'requirements-analyst',
    instructions: prompt('requirements-analyst'),
    task: `Analyse this requirement for ${config.app.name}.\n\n${requirementText(req)}\n\n${doubts ? `${doubtsText(doubts)}\n\n` : ''}${brief()}`,
    schema: Requirements,
    access: 'read',
    maxTurns: 20,
  });
  return output;
}

const doubts = (): Skepticism | null => (exists('skeptic.json') ? load<Skepticism>('skeptic.json') : null);

/**
 * With the skeptic's list on the ticket, the analyst's open questions are blocking or nothing: a non-blocking one
 * is a copy of a skeptic question, or belongs in the assumptions. Returns the requirements without them and how
 * many were dropped.
 */
export function foldQuestions(req: Requirements, asked: Skepticism | null): { requirements: Requirements; dropped: number } {
  if (!asked?.questions.length) return { requirements: req, dropped: 0 };
  const kept = req.openQuestions.filter((q) => q.blocking);
  return { requirements: { ...req, openQuestions: kept }, dropped: req.openQuestions.length - kept.length };
}

export async function requirements(): Promise<boolean> {
  const req = request();
  // The first thing any requirement meets. In CI this is the first agent job, so nothing else runs on a refused ticket.
  const screened = await screen(req);
  if (screened.verdict !== 'proceed') {
    console.log(`Safety screen: ${screened.verdict} (${screened.category}). ${screened.reasons[0]}`);
    jobSummary(screeningMd(screened));
    setOutput('ready', false);
    return false;
  }
  // The skeptic runs on every ticket, the ticket writer's included: the writer settles what it can, the skeptic
  // lists what is left to a guess.
  const asked = await doubt(req);
  save('skeptic.json', asked);
  // A ticket from the ticket writer already has criteria and a risk rating. Analysing it again would only reword it.
  const filed = requirementsFromTicket(req.title, req.body);
  if (filed) {
    const markdown = `_Taken from the ticket as the ticket writer filed it. No analyst run._\n\n${requirementsMd(req, filed, null, 2, asked)}`;
    save('requirements.json', filed);
    save('requirements.md', markdown);
    jobSummary(markdown);
    const ready = !filed.openQuestions.some((question) => question.blocking);
    setOutput('ready', ready);
    console.log('Ticket written by the ticket writer: requirements taken from it, analyst skipped.');
    return ready;
  }
  const { requirements: output, dropped } = foldQuestions(await analyse(req, asked), asked);
  if (dropped) console.log(`${dropped} non-blocking open question(s) dropped: the skeptic's list is where they live.`);
  const ready = !output.openQuestions.some((question) => question.blocking);
  const markdown = requirementsMd(req, output, null, 2, asked);
  save('requirements.json', output);
  save('requirements.md', markdown);
  jobSummary(markdown);
  setOutput('ready', ready);
  return ready;
}

// ── 1b. Technical review ─────────────────────────────────────────────────────

/** What the checks may ask about this repository. */
const repo = repoAt(ROOT);

/** The tickets that were open when the ticket was read. The intake job saves them; agent jobs have no tracker token. */
const openTickets = (): OpenTicket[] => (exists('open-tickets.json') ? load<OpenTicket[]>('open-tickets.json') : []);

const technicalReview = (): TechnicalResult | null => (exists('technical.json') ? load<TechnicalResult>('technical.json') : null);

/** Asks the technical reviewer. Exported so the evaluation harness can call it with a case of its own. */
export async function reviewTechnically(req: Request, requirementsText: string, open: OpenTicket[]): Promise<TechnicalReview> {
  const { output } = await runAgent({
    role: 'technical-reviewer',
    instructions: prompt('technical-reviewer'),
    task: `Write the technical review for this requirement. The app is ${config.app.name} at ${appUrl(req)}.

<requirements>
${requirementsText}
</requirements>

${requirementText(req)}

<open-tickets>
${JSON.stringify(open, null, 2)}
</open-tickets>

${brief()}`,
    schema: TechnicalReview,
    access: 'read',
    browser: true,
    maxTurns: 40,
  });
  return output;
}

/**
 * Every ticket gets technical notes: what already covers it, which page objects its tests will use, what it could
 * break and whether a test would notice. A ticket from the ticket writer already has them, so they are read back,
 * checked and kept. Any other ticket gets a reviewer run. Either way the checks below decide what is kept.
 */
export async function technical(): Promise<TechnicalResult> {
  const req = request();
  const open = openTickets();
  const fromWriter = technicalFromTicket(req.body, repo.titlesIn);
  const review = fromWriter ?? (await reviewTechnically(req, loadText('requirements.md'), open));
  const checked = checkTechnical(review, repo, open.map((ticket) => ticket.ref));
  const result: TechnicalResult = { ...checked.technical, by: fromWriter ? 'ticket-writer' : 'technical-reviewer', dropped: checked.dropped };

  const markdown = technicalMd(result);
  save('technical.json', result);
  save('technical.md', markdown);
  // The architect, the critic and the engineer read the requirements from requirements.md, so the review goes there too.
  save('requirements.md', `${loadText('requirements.md').trimEnd()}\n\n${markdown}`);
  jobSummary(markdown);
  console.log(
    fromWriter
      ? `Technical notes taken from the ticket writer and checked: ${checked.dropped.length} claim(s) taken out.`
      : `Technical review written and checked: ${checked.dropped.length} claim(s) taken out.`,
  );
  return result;
}

// ── 2. Strategy: architect and critic work apart, then the plan is reconciled ──

const criteriaText = (): string => `<requirements>\n${loadText('requirements.md')}\n</requirements>`;

const TECHNICAL_REVIEW_NOTE =
  'The technical review below was checked against the repository: every file and test title in it exists. Start from it rather than surveying from scratch, and start your regression risks from its nearby behaviour. Verify anything you rely on.';

export async function plan(): Promise<void> {
  const req = request();
  const review = technicalReview();
  const { output } = await runAgent({
    role: 'test-architect',
    instructions: prompt('test-architect'),
    task: `Write the test plan for this requirement. The app is ${config.app.name} at ${appUrl(req)}.
${req.mode === 'test-first' ? TEST_FIRST_PLAN : BUILT_PLAN}

${criteriaText()}

${requirementText(req)}
${review ? `\n${TECHNICAL_REVIEW_NOTE}\n<technical-review>\n${JSON.stringify(review, null, 2)}\n</technical-review>\n` : ''}
${brief()}

${design()}`,
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
  const cases = output.cases
    .map((c) => ({ ...c, criteria: c.criteria.filter((id) => criterionIds.has(id)) }))
    .filter((c) => c.criteria.length > 0);
  const caseIds = new Set(cases.map((c) => c.id));
  const mapping = checklist.items.map((item) => {
    const answer = output.checklist.find((entry) => entry.id === item.id);
    return { id: item.id, coveredBy: (answer?.coveredBy ?? []).filter((id) => caseIds.has(id)), note: answer?.note ?? 'Not addressed.' };
  });

  const strategy: Strategy = {
    existingCoverage: draft.existingCoverage,
    siteNotes: draft.siteNotes,
    contract: draft.contract,
    // The review's nearby behaviour comes first; the architect's own finds are added after it.
    regressionRisks: checkedRisks(mergeRisks(technicalReview()?.touches ?? [], draft.regressionRisks ?? []), repo.fileExists, repo.titlesIn),
    ...output,
    added: output.added.filter((id) => caseIds.has(id)),
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

/** Why the test half cannot start from what is in the run folder, or null when it can. */
export function planProblem(): string | null {
  if (!exists('strategy.json')) return 'This ticket has no test plan yet. Add the qa-pipeline label first, read the analysis, then add qa-generate.';
  const strategy = load<Strategy>('strategy.json');
  if (strategy.health.score < config.minPlanScore) {
    return `The test plan scored ${strategy.health.score}, below the pass mark of ${config.minPlanScore}. Sharpen the requirement and run the analysis again.`;
  }
  if (request().mode === 'test-first' && (strategy.contract ?? []).length === 0) {
    return 'The ticket is now marked test-first, but it was analysed as built, so the plan has no contract for the tests to work from. Run the analysis again.';
  }
  return null;
}

// ── 3. Code generation, checked by the gates ─────────────────────────────────

async function engineer(task: string): Promise<Generation> {
  const ask = (text: string) =>
    runAgent({
      role: 'automation-engineer',
      instructions: prompt('automation-engineer'),
      task: text,
      schema: Generation,
      access: 'write',
      browser: true,
      maxTurns: 80,
    });

  const first = await ask(task);
  if (ranTheTests(first.commands)) return first.output;

  // Writing tests and reporting on them without running them is the one shortcut that always costs a round.
  console.log('\nThe engineer reported without running the tests. Sending it back once.');
  const second = await ask(
    `You handed in tests without running them. They are in the working tree. Run them now with \`npx playwright test <file> --reporter=line\`, read the output, fix what is wrong, and report on the complete change.\n\n${task}`,
  );
  return second.output;
}

/** Whether the engineer ran Playwright at least once. */
export const ranTheTests = (commands: string[]): boolean => commands.some((command) => /\bplaywright\s+test\b/.test(command));

function modeBrief(req: Request, strategy: Strategy): string {
  if (req.mode === 'built') {
    return `The feature is built. Your tests must pass against it, except where the app disagrees with a criterion (see the rules on product bugs).`;
  }
  return `TEST-FIRST MODE. ${req.key} is not built yet, so the new behaviour is not in the app. Write each test the way it
will look once the feature exists, using the locators in the contract below (add them to the page objects). Open the
first line of every test whose behaviour is not built yet with:

    test.fail(true, 'not built yet: ${req.key}');

Such a test passes today because it fails, and Playwright reports "expected to fail, but passed" on the day the
feature lands, which tells the team to remove the marker. Run your tests and make sure each one fails because the
feature is missing (an element not found, an assertion that does not hold), never because of a mistake in your own
code. A gate reads the error behind every expected failure, and it only accepts one it can see came from the page:
end each of these tests on a web-first assertion against a locator (\`await expect(locator)...\`), not on a value you
read off the page first and compared afterwards.

<contract>
${JSON.stringify(strategy.contract, null, 2)}
</contract>`;
}

/**
 * What the engineer and the gates work from. It is read once, before any generated test code has run, and then
 * passed along in memory. Test code can touch any file on the runner, so nothing downstream reads these again.
 */
type Brief = { request: Request; strategy: Strategy; text: string };

function readBrief(): Brief {
  const req = request();
  const strategy = load<Strategy>('strategy.json');
  return { request: req, strategy, text: engineerBrief(req, strategy, technicalReview()) };
}

function engineerBrief(req: Request, strategy: Strategy, review: TechnicalResult | null): string {
  const cases = strategy.cases.filter((c) => c.layer === 'e2e');
  const others = strategy.cases.filter((c) => c.layer !== 'e2e').map((c) => `${c.id} (${c.layer}): ${c.title}. ${c.layerReason}`);
  return `The app is ${config.app.name} at ${appUrl(req)}. The requirement key is ${req.key}: tag the describe block \`@${req.key}\` and each test with its \`@AC-n\` criteria.

You may write only inside: ${config.writable.join(', ')}

${modeBrief(req, strategy)}

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
${review ? `\n<technical-review>\n${technicalMd(review)}\n</technical-review>\n` : ''}
${conventions()}`;
}

/**
 * The generated tests run inside these jobs, and test code can touch any file. The gates work from the brief read
 * before the engineer started. These files are also written back afterwards, so nothing a test does to them
 * reaches the reviewer or the pull request in a later job.
 */
const PROTECTED = ['request.json', 'requirements.json', 'requirements.md', 'technical.json', 'technical.md', 'strategy.json', 'strategy.md', 'sabotage.json'];

async function protectingRunFiles<T>(work: () => Promise<T>): Promise<T> {
  const saved = PROTECTED.filter(exists).map((name) => [name, loadText(name)] as const);
  try {
    return await work();
  } finally {
    for (const [name, text] of saved) save(name, text);
  }
}

const WRITE_TASK = (brief: Brief): string => `Write the Playwright tests for the cases below.\n\n${brief.text}`;

const FIX_TASK = (gates: GateReport, brief: Brief): string =>
  `Your tests are in the working tree but did not pass the quality gates. Fix the problems below, then report on the complete change (everything you have written for this requirement, not only this fix).\n\n<gate-report>\n${gatesMd(gates)}\n</gate-report>\n\n${brief.text}`;

function saveGates(gates: GateReport): void {
  save('gates.json', gates);
  save('gates.md', gatesMd(gates));
  jobSummary(gatesMd(gates));
  setOutput('gates', gates.passed ? 'passed' : 'failed');
}

/** Runs the gates, and gives the engineer one chance to fix what they find. One process: a run on your machine. */
async function gated(generation: Generation, brief: Brief): Promise<{ generation: Generation; gates: GateReport }> {
  let gates = runGates(brief.request, brief.strategy, generation);
  if (!gates.passed) {
    console.log('\nGates failed. Sending the report back to the engineer once.');
    generation = await engineer(FIX_TASK(gates, brief));
    gates = runGates(brief.request, brief.strategy, generation);
  }
  savePatch();
  save('generation.json', generation);
  jobSummary(`## Code generation\n\n${generation.summary}\n\n`);
  saveGates(gates);
  return { generation, gates };
}

export async function generate(): Promise<boolean> {
  const brief = readBrief();
  return protectingRunFiles(async () => {
    const first = await engineer(WRITE_TASK(brief));
    await sabotage();
    return (await gated(first, brief)).gates.passed;
  });
}

/*
 * In CI the same work is three jobs, so the model credentials and the generated test code are never in one job
 * for longer than they must be. `write` and `fix` hold the credentials and run the engineer, who runs the tests
 * it writes as it goes. `gates` holds no credentials at all: it applies the patch and runs the whole suite, the
 * stability runs, the sensitivity targets and the accessibility scan.
 */

/** 3a. The engineer writes. Nothing is gated here. */
export async function write(): Promise<void> {
  const brief = readBrief();
  await protectingRunFiles(async () => {
    const generation = await engineer(WRITE_TASK(brief));
    savePatch();
    save('generation.json', generation);
    jobSummary(`## Code generation\n\n${generation.summary}`);
  });
}

/**
 * 3a'. The saboteur, a critic that breaks the feature on purpose, one criterion at a time. It reads the tests the
 * engineer wrote (the working tree has them) and writes the faults the sabotage gate runs them against. It runs
 * once: the fix round reuses the faults, so the engineer cannot be sent after a moving target. Read-only, so the
 * run files need no protection.
 */
export async function sabotage(): Promise<void> {
  const { request: req, strategy } = readBrief();
  if (req.mode !== 'built') return void console.log('Saboteur skipped: the feature is not built yet, so there is nothing to break.');
  if (!config.sabotage.enabled) return void console.log('Saboteur skipped: sabotage.enabled is false in qa.config.json.');
  if (exists('sabotage.json')) return void console.log('Saboteur skipped: qa-run/sabotage.json exists, so its faults are reused.');

  const criterionIds = [...new Set(load<Requirements>('requirements.json').criteria.map((c) => c.id))];
  const exampleFile = path.join(ROOT, 'fixtures/faults/cart-badge-never-shows.js');
  const example = fs.existsSync(exampleFile) ? fs.readFileSync(exampleFile, 'utf8') : '// This project has no example fault. Use the pattern in your instructions.\n';
  const { output } = await runAgent({
    role: 'saboteur',
    instructions: prompt('saboteur'),
    task: `Break the feature under test, one acceptance criterion at a time. The app is ${config.app.name} at ${appUrl(req)}. The requirement key is ${req.key}. Write at most ${config.sabotage.maxFaults} faults.

Criteria you may name: ${criterionIds.join(', ')}

${criteriaText()}

<site-notes>
${strategy.siteNotes}
</site-notes>

<example-fault file="fixtures/faults/cart-badge-never-shows.js">
${example}</example-fault>

<diff>
${currentPatch()}
</diff>`,
    schema: Sabotage,
    access: 'read',
    browser: true,
    maxTurns: 40,
  });

  const { kept, dropped } = checkedFaults(output.faults, criterionIds, config.sabotage.maxFaults);
  for (const file of faultFiles(kept)) {
    fs.mkdirSync(path.dirname(path.join(ROOT, file.path)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, file.path), file.content);
  }
  const list = (items: string[]): string => items.map((item) => `- ${item}`).join('\n');
  const markdown = [
    '## Saboteur',
    `${kept.length} fault(s) written.`,
    list(kept.map((f) => `\`${f.name}\` breaks ${f.criterion}: ${f.what}`)),
    ...(dropped.length ? ['Dropped:', list(dropped)] : []),
  ]
    .filter(Boolean)
    .join('\n\n');
  save('sabotage.json', { faults: kept, dropped });
  save('sabotage.md', markdown);
  jobSummary(markdown);
  setOutput('faults', kept.length);
  console.log(`Saboteur wrote ${kept.length} fault(s), dropped ${dropped.length}.`);
}

/** 3b. The gates over the change already applied to the working tree. Never throws on a failed gate: the workflow decides. */
export async function gates(): Promise<boolean> {
  const brief = readBrief();
  const generation = load<Generation>('generation.json');
  return protectingRunFiles(async () => {
    const report = runGates(brief.request, brief.strategy, generation);
    saveGates(report);
    console.log(report.passed ? '\nAll gates passed.' : '\nGates failed. See qa-run/gates.md.');
    return report.passed;
  });
}

/** 3c. The one fix round, back in a job with credentials, from the gate report. */
export async function fix(): Promise<void> {
  const brief = readBrief();
  const report = load<GateReport>('gates.json');
  await protectingRunFiles(async () => {
    const generation = await engineer(FIX_TASK(report, brief));
    savePatch();
    save('generation.json', generation);
    jobSummary(`## Code generation, fix round\n\n${generation.summary}`);
  });
}

// ── 4. Code review, with one round of rework ─────────────────────────────────

/**
 * The verdict follows from the findings and from the per-criterion answers, not from the reviewer's summary.
 * A blocker or major finding, or an automated criterion the reviewer could not verify, is not an approval.
 */
export function enforceVerdict(review: Review, e2eCriteria: string[]): Review {
  const serious = review.findings.some((f) => f.severity === 'blocker' || f.severity === 'major');
  const unverified = review.criteria.filter((c) => e2eCriteria.includes(c.id) && !c.verified);
  const unchecked = e2eCriteria.filter((id) => !review.criteria.some((c) => c.id === id));
  const findings = [
    ...review.findings,
    ...unchecked.map((id) => ({
      severity: 'major' as const,
      file: '-',
      line: null,
      issue: `The review did not say whether the test for ${id} would catch a regression.`,
      suggestion: `Check the test tagged @${id} against its criterion.`,
    })),
  ];
  const approve = !serious && unverified.length === 0 && unchecked.length === 0;
  return { ...review, findings, verdict: approve ? review.verdict : 'request-changes' };
}

async function reviewer(round: number): Promise<Review> {
  const req = request();
  const strategy = load<Strategy>('strategy.json');
  const generation = load<Generation>('generation.json');
  const e2e = strategy.cases.filter((c) => c.layer === 'e2e');
  const { output } = await runAgent({
    role: 'code-reviewer',
    instructions: prompt('code-reviewer'),
    task: `Review this change. It adds tests for requirement ${req.key}${req.mode === 'test-first' ? ', in test-first mode: the feature is not built yet, so the new tests are marked to fail until it is' : ''}. The change is applied in the working tree, so you can read the full files.

${criteriaText()}

<planned-e2e-cases>
${JSON.stringify(e2e, null, 2)}
</planned-e2e-cases>

<engineer-notes>
${generation.summary}
Suspected product bugs: ${generation.suspectedBugs.join(' | ') || 'none'}
</engineer-notes>

<gate-report>
${loadText('gates.md')}
</gate-report>

<diff>
${loadText('changes.patch')}
</diff>

${conventions()}`,
    schema: Review,
    access: 'read',
    maxTurns: 30,
  });

  const review = enforceVerdict(output, [...new Set(e2e.flatMap((c) => c.criteria))]);
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
  const brief = readBrief();
  const { gates } = await protectingRunFiles(async () => {
    const fixed = await engineer(
      `A reviewer has read your tests, which are in the working tree, and asked for changes. Address each finding, or say in your summary why it does not apply. Then report on the complete change.\n\n<review-findings>\n${JSON.stringify(findings, null, 2)}\n</review-findings>\n\n${brief.text}`,
    );
    return gated(fixed, brief);
  });
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
    technical: technicalReview(),
  });
  save('pull-request.md', body);
  setOutput('title', `test: ${requirementsDoc.title} (${req.key})`);
  setOutput('branch', branchFor(req.key));
  setOutput('draft', reviewDoc.verdict !== 'approve');
  // For the publish job, which has no config loaded: what to commit, and where to open the pull request.
  setOutput('writable', config.writable.join(' '));
  setOutput('base', req.base ?? '');
}

// ── 6. Tell the ticket ───────────────────────────────────────────────────────

/**
 * Posts the analysis on the ticket and moves its labels on. Runs whatever state the analysis ended in.
 * Without `post` the analysis is only saved: nothing goes to the ticket and no label changes.
 */
export async function notifyAnalysis(runUrl: string | null, options: { post: boolean } = { post: true }): Promise<void> {
  const req = request();
  const screened = screening();
  if (screened && screened.verdict !== 'proceed') return notifyScreened(req, screened, options.post);
  const requirementsDoc = exists('requirements.json') ? load<Requirements>('requirements.json') : null;
  const strategy = exists('strategy.json') ? load<Strategy>('strategy.json') : null;
  const blocked = requirementsDoc?.openQuestions.some((q) => q.blocking) ?? false;
  const ready = strategy !== null && strategy.health.score >= config.minPlanScore;

  // Say on the ticket when the requirements were taken from it as filed, so nobody looks for an analyst run.
  const fromWriter = requirementsFromTicket(req.title, req.body) !== null;
  const markdown = analysisMd({
    request: req,
    requirements: requirementsDoc,
    doubts: doubts(),
    strategy,
    technical: technicalReview(),
    runUrl,
    compact: req.source === 'jira',
    fromWriter,
  });
  save('analysis.md', markdown);
  jobSummary(markdown);
  if (!options.post) return;

  const source = sourceFor(req.source);
  await source.comment(req.ref, markdown);
  await source.label(req.ref, {
    add: blocked ? [LABELS.needsInfo] : ready ? [LABELS.analyzed] : [],
    remove: [LABELS.analyze, ...(blocked ? [] : [LABELS.needsInfo])],
  });

  // The workflow starts the test half on this when the configuration says a good plan may go straight on.
  setOutput('autorun', ready && !blocked && (config.autoRun?.testsWhenPlanIsReady ?? false));
}

/**
 * A requirement the safety screen stopped: the report goes on the ticket, and the labels say which kind of stop it was.
 * A refusal takes the pipeline's labels off and puts `qa-refused` on, so nothing picks the ticket up again until a
 * person has changed it. A question waits for an answer like any other.
 */
async function notifyScreened(req: Request, screened: NonNullable<ReturnType<typeof screening>>, post: boolean): Promise<void> {
  const markdown = screeningMd(screened);
  save('analysis.md', markdown);
  if (!post) return;
  const source = sourceFor(req.source);
  await source.comment(req.ref, markdown);
  const refused = screened.verdict === 'refuse';
  await source.label(req.ref, {
    add: [refused ? LABELS.refused : LABELS.needsInfo],
    remove: [LABELS.analyze, LABELS.analyzed, ...(refused ? [LABELS.needsInfo] : [])],
  });
  setOutput('autorun', false);
}

/** Posts the outcome of the test half: the pull request, or why there is none. */
export async function notifyTests(runUrl: string | null, prUrl: string | null): Promise<void> {
  const req = request();
  const gates = exists('gates.json') ? load<GateReport>('gates.json') : null;
  const draft = exists('review.json') ? load<Review>('review.json').verdict !== 'approve' : false;
  const markdown = testsReadyMd({ request: req, prUrl, draft, gates, runUrl, problem: prUrl || gates ? null : planProblem() });
  const source = sourceFor(req.source);
  await source.comment(req.ref, markdown);
  await source.label(req.ref, { remove: [LABELS.generate] });
}

export { applyPatch };
