#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { Answer, ChatReply, DesignReview, Digest, DocumentationDraft, DriftReport, Enrichment, IncidentRecord, MergeRequestDescription, Review, TestCases, TicketDraft, Triage } from '../schemas/schemas.ts';
import * as adapters from './adapters/index.ts';
import type { MergeRequest, Ticket } from './adapters/types.ts';
import { runAgent, tag } from './lib/agent.ts';
import { newRunId, recentRuns, record, sha256, spentToday } from './lib/audit.ts';
import { loadConfig, modelFor, policyFor, type CoConfig } from './lib/config.ts';
import { confirm } from './lib/confirm.ts';
import { checks, report } from './lib/doctor.ts';
import { mayRun, saveLogin, whoAmI, type Identity } from './lib/identity.ts';
import { mcpFor } from './lib/mcp.ts';
import { screen } from './lib/screen.ts';
import { checkDiffLines, checkFiles, checkHosts, checkLength, checkNoSecrets, checkRefs, footer, type Problem } from './lib/validate.ts';

/**
 * co: the one command anyone in the company uses to put an agent to work. Every command runs the same way:
 *
 *   gather   read what the role needs, through an adapter, with the person's own token      (stage: fetch)
 *   screen   fixed rules, then the request screener, on the request text                    (stage: agent)
 *   agent    the role, read-only in the repository, answering in its schema                  (stage: agent)
 *   validate the deterministic checks: files exist, refs were given, hosts allowed, no secrets (stage: agent)
 *   confirm  show the person exactly what will be posted, and ask                            (stage: post)
 *   post     through the adapter, as the person, with a footer naming the agent and the run  (stage: post)
 *
 * At a terminal all stages run in one process. In CI each stage is its own job with its own credential, and a JSON
 * bundle is the only thing that crosses: `--stage fetch` writes it, `--stage agent` adds the answer, `--stage post`
 * posts it. See workflows/.
 */

const USAGE = `co: put an agent to work

  co login --login <you> --token NAME [--token NAME ...]   store your own tokens (values read from the environment or prompted)
  co doctor                        is this machine, this person and this config ready? one line per check

  co ticket new <wish...>          a wish in, a ticket out: screened, questioned, shown, filed when you say yes
  co ticket show <key>             print a ticket
  co ticket enrich <key>           post the context a developer would spend an hour finding
  co mr describe <id> [--apply]    describe a merge request as a comment, or --apply to replace its description
  co mr review <id>                review comments on the diff lines; never an approval
  co design <mr-id>                where the code and the linked Figma design disagree, as a comment
  co cases <ticket-key>            draft the manual test cases for a ticket's criteria, added to TestRail when you say yes
  co doc <ticket-key|mr-id>        draft the documentation for a merged change (Confluence draft page)
  co ask <question...>             answer from the docs and the code, with sources
  co alert <file|->                triage an alert (JSON or text from a file or stdin) [--channel #c to post]
  co post <#channel> <text...>     say something in chat through the responder; statements wait for your yes
  co digest [--days 7]             the week in engineering, to the digest channel
  co drift <area> --pages a,b,c    where these documentation pages disagree with the code, as one ticket
  co incident <#channel> <ts>      keep the incident timeline in a thread

  --dry             do everything except post; print what would be posted
  --yes             post without asking (honoured in CI; at a terminal only where the role's policy allows)
  --out <file>      also write the agent's answer as JSON
  --stage <s>       all (default) | fetch | agent | post, with --bundle <file> and --result <file> (CI)
`;

// ── The run ───────────────────────────────────────────────────────────────────

type Flags = { yes: boolean; dry: boolean; out?: string; stage: 'all' | 'fetch' | 'agent' | 'post'; bundle: string; result: string };
type Ctx = { config: CoConfig; identity: Identity; cwd: string; flags: Flags };

/** What the fetch stage hands to the agent stage, and both hand to the post stage. */
type Bundle = {
  runId: string;
  role: string;
  trigger: string;
  /** The request as the person or event gave it: what the screen reads and what is hashed for the log. */
  input: string;
  task: string;
  /** What the validator checks the answer against. */
  facts: { files?: string[]; refs?: string[]; diff?: string };
  /** What the post stage needs that is not in the answer. */
  post: Record<string, string>;
};

type Command<S extends z.ZodType> = {
  role: string;
  schema: S;
  what: string;
  maxLines?: number;
  shell?: string[];
  gather(ctx: Ctx): Promise<Omit<Bundle, 'runId' | 'role'>>;
  validate(out: z.infer<S>, facts: Bundle['facts'], ctx: Ctx): Problem[];
  preview(out: z.infer<S>): string;
  /** Returns where it went. Absent for read-only roles, whose answer is printed. */
  post?(out: z.infer<S>, bundle: Bundle, ctx: Ctx): Promise<string>;
};

async function run<S extends z.ZodType>(ctx: Ctx, command: Command<S>): Promise<void> {
  const { config, identity, flags } = ctx;
  const stage = flags.stage;
  let bundle: Bundle;

  if (stage === 'all' || stage === 'fetch') {
    const may = mayRun(config, command.role, identity);
    if (!may.ok) throw new Error(may.reason);
    const policy = policyFor(config, command.role);
    if (recentRuns(config, identity.login, command.role) >= policy.perActorPerHour) throw new Error(`${identity.login} has run ${command.role} ${policy.perActorPerHour} times this hour. Wait, or ask an owner of co.config.json.`);
    const spent = spentToday(config);
    if (spent >= config.budget.maxUsdPerDay) throw new Error(`Today's budget of $${config.budget.maxUsdPerDay} is spent ($${spent.toFixed(2)}).`);
    bundle = { runId: newRunId(), role: command.role, ...(await command.gather(ctx)) };
    if (stage === 'fetch') {
      write(flags.bundle, bundle);
      log(ctx, bundle, { outcome: 'dry-run', problems: ['fetch stage only'] });
      return;
    }
  } else {
    bundle = JSON.parse(fs.readFileSync(flags.bundle, 'utf8')) as Bundle;
    if (bundle.role !== command.role) throw new Error(`The bundle is for ${bundle.role}, not ${command.role}.`);
  }

  let output: z.infer<S>;
  let cost: { model: string; costUsd: number; turns: number } | null = null;
  if (stage === 'all' || stage === 'agent') {
    const screening = await screen(config, ctx.cwd, command.role, bundle.input);
    if (screening.verdict !== 'proceed') {
      log(ctx, bundle, { screening, outcome: 'refused', problems: screening.reasons });
      console.error(`Refused by the safety screen (${screening.category}):\n  ${screening.reasons.join('\n  ')}${screening.question ? `\n  Question: ${screening.question}` : ''}`);
      process.exitCode = 2;
      return;
    }
    const policy = policyFor(config, command.role);
    let result;
    try {
      // Read-only MCP servers the role's policy lists, with this identity's read tokens (lib/mcp.ts).
      const mcp = policy.mcp.length ? mcpFor(config, identity, policy.mcp) : undefined;
      result = await runAgent({ role: command.role, task: bundle.task, schema: command.schema, cwd: ctx.cwd, model: modelFor(config, command.role), maxBudgetUsd: policy.maxUsdPerRun, shell: command.shell, mcp });
    } catch (error) {
      log(ctx, bundle, { screening, outcome: 'failed', problems: [String((error as Error).message)] });
      throw error;
    }
    cost = { model: result.model, costUsd: result.costUsd, turns: result.turns };
    output = result.output;
    const problems = [...command.validate(output, bundle.facts, ctx), ...checkNoSecrets(JSON.stringify(output))];
    if (problems.length) {
      log(ctx, bundle, { screening, outcome: 'failed', problems, ...cost });
      console.error(`The ${command.role} agent's answer did not pass validation, so nothing is posted:\n  ${problems.join('\n  ')}`);
      process.exitCode = 3;
      return;
    }
    if (flags.out) write(flags.out, output);
    if (stage === 'agent') {
      write(flags.result, { output, ...cost });
      log(ctx, bundle, { screening, outcome: 'dry-run', problems: ['agent stage only'], ...cost });
      return;
    }
  } else {
    const saved = JSON.parse(fs.readFileSync(flags.result, 'utf8')) as { output: unknown; model: string; costUsd: number; turns: number };
    const parsed = command.schema.safeParse(saved.output);
    if (!parsed.success) throw new Error(`The saved result is not a valid ${command.role} answer:\n${z.prettifyError(parsed.error)}`);
    output = parsed.data;
    cost = { model: saved.model, costUsd: saved.costUsd, turns: saved.turns };
  }

  const preview = command.preview(output);
  if (!command.post) {
    console.log(preview);
    log(ctx, bundle, { outcome: 'posted', target: 'terminal', ...cost });
    return;
  }
  if (flags.dry) {
    console.log(preview);
    log(ctx, bundle, { outcome: 'dry-run', ...cost });
    return;
  }
  const ok = await confirm(preview, command.what, identity, policyFor(config, command.role), flags.yes);
  if (!ok) {
    log(ctx, bundle, { outcome: 'cancelled', ...cost });
    return;
  }
  const target = await command.post(output, bundle, ctx);
  log(ctx, bundle, { outcome: 'posted', target, ...cost });
  console.log(`Done: ${target}`);
}

function log(ctx: Ctx, bundle: Bundle, patch: Partial<Parameters<typeof record>[1]>): void {
  record(ctx.config, {
    runId: bundle.runId,
    at: new Date().toISOString(),
    actor: ctx.identity.login,
    role: bundle.role,
    trigger: bundle.trigger,
    inputSha256: sha256(bundle.input),
    screening: null,
    outcome: 'failed',
    target: null,
    model: null,
    costUsd: null,
    turns: null,
    problems: [],
    ...patch,
  });
}

function write(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

// ── Material for the tasks ────────────────────────────────────────────────────

const DIFF_LIMIT = 120_000;

function clip(text: string, limit: number = DIFF_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}\n\n[clipped: ${text.length - limit} more characters not shown; say so under unread]` : text;
}

function ticketText(t: Ticket): string {
  const comments = t.comments.map((c) => `--- ${c.author}, ${c.at}\n${c.body}`).join('\n');
  return `${t.key}: ${t.title}\nStatus: ${t.status}. Reporter: ${t.reporter}. Labels: ${t.labels.join(', ') || 'none'}.\n\n${t.body}\n\n${comments ? `Comments:\n${comments}` : 'No comments.'}`;
}

function ticketList(tickets: Ticket[]): string {
  return tickets.map((t) => `${t.key} [${t.status}] ${t.title}`).join('\n') || 'none';
}

function mrText(mr: MergeRequest): string {
  return `${mr.id}: ${mr.title}\nAuthor: ${mr.author}. ${mr.source} -> ${mr.target}. ${mr.merged ? 'Merged.' : 'Open.'}\nFiles: ${mr.files.join(', ')}\n\n${mr.body || '(no description)'}`;
}

function mustBeIn(items: Iterable<string>, allowed: Iterable<string>, what: string): Problem[] {
  const set = new Set(allowed);
  return [...new Set(items)].filter((i) => !set.has(i)).map((i) => `names a ${what} it was not given: ${i}`);
}

function brief(): string {
  for (const file of ['docs/product-brief.md', 'README.md']) if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').slice(0, 8000);
  return '(no product brief found)';
}

async function maybeTicket(ctx: Ctx, key: string | undefined): Promise<Ticket | null> {
  if (!key) return null;
  try {
    return await adapters.tracker(ctx.config, ctx.identity).getTicket(key);
  } catch (error) {
    console.error(`Could not read ${key}: ${(error as Error).message}. Going on without it.`);
    return null;
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

const ticketNew = (wish: string): Command<typeof TicketDraft> => ({
  role: 'ticket-writer',
  schema: TicketDraft,
  what: 'file the ticket',
  async gather(ctx) {
    const open = await adapters.tracker(ctx.config, ctx.identity).searchTickets(wish.split(/\s+/).slice(0, 6).join(' '), 10).catch(() => [] as Ticket[]);
    return {
      trigger: 'co ticket new',
      input: wish,
      task: `Write the ticket for this wish.\n\n${tag('wish', wish)}\n\n${tag('product-brief', brief())}\n\n${tag('open-tickets', ticketList(open))}`,
      facts: { refs: open.map((t) => t.key) },
      post: {},
    };
  },
  validate: (out, facts, ctx) => [...checkFiles(ctx.cwd, out.area.files), ...checkRefs(out.related.map((r) => r.ref), facts.refs ?? []), ...checkHosts(ctx.config, out.markdown)],
  preview: (out) => `${out.ready ? 'Ready to file' : 'NOT READY: blocking questions below'}\n\n# ${out.title}\n\n${out.markdown}`,
  async post(out, bundle, ctx) {
    const labels = ['agent-drafted', ...(out.ready ? [] : ['needs-info'])];
    const made = await adapters.tracker(ctx.config, ctx.identity).createTicket(out.title, out.markdown + footer(this.role, bundle.runId), labels);
    return made.url;
  },
});

const ticketEnrich = (key: string): Command<typeof Enrichment> => ({
  role: 'ticket-enricher',
  schema: Enrichment,
  what: 'post the comment',
  maxLines: 50,
  async gather(ctx) {
    const tracker = adapters.tracker(ctx.config, ctx.identity);
    const ticket = await tracker.getTicket(key);
    const related = (await tracker.searchTickets(ticket.title, 8).catch(() => [] as Ticket[])).filter((t) => t.key !== key);
    return {
      trigger: 'ticket enrich',
      input: `${ticket.title}\n${ticket.body}`,
      task: `Enrich this ticket. The product owner is ${ticket.reporter}.\n\n${tag('ticket', ticketText(ticket))}\n\n${tag('related-tickets', related.map(ticketText).join('\n\n'))}`,
      facts: { refs: [key, ...related.map((t) => t.key)] },
      post: { key },
    };
  },
  validate: (out, facts, ctx) => [
    ...checkFiles(ctx.cwd, [...out.area.map((a) => a.file), ...out.tests.map((t) => t.file)]),
    ...checkRefs(out.history.map((h) => h.ref).filter((r) => /^(?:[A-Z]+-\d+|#\d+)$/.test(r)), facts.refs ?? []),
    ...checkHosts(ctx.config, out.markdown),
    ...checkLength(out.markdown, 50),
  ],
  preview: (out) => out.markdown,
  async post(out, bundle, ctx) {
    return adapters.tracker(ctx.config, ctx.identity).comment(bundle.post.key, out.markdown + footer(this.role, bundle.runId));
  },
});

const mrDescribe = (id: string, apply: boolean): Command<typeof MergeRequestDescription> => ({
  role: 'merge-request-describer',
  schema: MergeRequestDescription,
  what: apply ? 'replace the description' : 'post the description as a comment',
  async gather(ctx) {
    const mr = await adapters.repo(ctx.config, ctx.identity).getMergeRequest(id);
    const ticket = await maybeTicket(ctx, mr.ticketKeys[0]);
    return {
      trigger: 'mr describe',
      input: `${mr.title}\n${mr.body}\n${mr.commits.map((c) => c.message).join('\n')}`,
      task: `Describe this merge request.\n\n${tag('merge-request', mrText(mr))}\n\n${tag('commits', mr.commits.map((c) => `${c.sha} ${c.message}`).join('\n'))}\n\n${tag('ci', mr.ci)}\n\n${ticket ? tag('ticket', ticketText(ticket)) : 'No ticket is linked.'}\n\n${tag('diff', clip(mr.diff))}`,
      facts: { files: mr.files, refs: mr.ticketKeys },
      post: { id },
    };
  },
  validate: (out, facts, ctx) => [
    ...mustBeIn([...out.areas.flatMap((a) => a.files), ...out.flags.map((f) => f.file), ...out.reviewOrder], facts.files ?? [], 'file'),
    ...checkHosts(ctx.config, out.markdown),
    ...checkLength(out.markdown, 60),
  ],
  preview: (out) => out.markdown,
  async post(out, bundle, ctx) {
    const repo = adapters.repo(ctx.config, ctx.identity);
    const text = out.markdown + footer(this.role, bundle.runId);
    if (apply) {
      await repo.setDescription(bundle.post.id, text);
      return `description of ${bundle.post.id} replaced`;
    }
    return repo.comment(bundle.post.id, text);
  },
});

const mrReview = (id: string): Command<typeof Review> => ({
  role: 'merge-request-reviewer',
  schema: Review,
  what: 'post the review comments',
  async gather(ctx) {
    const mr = await adapters.repo(ctx.config, ctx.identity).getMergeRequest(id);
    const ticket = await maybeTicket(ctx, mr.ticketKeys[0]);
    const commands = [ctx.config.commands.test, ctx.config.commands.typecheck].filter(Boolean).join(' and ') || 'none';
    return {
      trigger: 'mr review',
      input: `${mr.title}\n${mr.body}`,
      task: `Review this merge request. Commands you may run: ${commands}.\n\n${tag('description', mrText(mr))}\n\n${ticket ? tag('ticket', ticketText(ticket)) : 'No ticket is linked: review against the description alone and say so.'}\n\n${tag('diff', clip(mr.diff))}`,
      facts: { files: mr.files, diff: mr.diff },
      post: { id },
    };
  },
  shell: undefined,
  validate: (out, facts) => checkDiffLines(facts.diff ?? '', out.findings),
  preview: (out) => `${out.verdict}: ${out.summary}\n\n${out.findings.map((f) => `${f.severity}  ${f.file}:${f.line}\n  ${f.what}\n  Instead: ${f.instead}`).join('\n\n') || 'No findings.'}`,
  async post(out, bundle, ctx) {
    const comments = out.findings.map((f) => ({ file: f.file, line: f.line, body: `**${f.severity}**: ${f.what}\n\nInstead: ${f.instead}` }));
    return adapters.repo(ctx.config, ctx.identity).review(bundle.post.id, `${out.summary}${footer(this.role, bundle.runId)}`, comments);
  },
});

const FIGMA_LINK = /https:\/\/(?:www\.)?figma\.com\/(?:design|file|proto)\/[A-Za-z0-9]+[^\s)>\]"']*/;

const design = (id: string): Command<typeof DesignReview> => ({
  role: 'design-reviewer',
  schema: DesignReview,
  what: 'post the design review comment',
  async gather(ctx) {
    const mr = await adapters.repo(ctx.config, ctx.identity).getMergeRequest(id);
    const ticket = await maybeTicket(ctx, mr.ticketKeys[0]);
    const link = FIGMA_LINK.exec(`${ticket?.body ?? ''}\n${mr.body}`)?.[0];
    if (!link) throw new Error(`Neither ${mr.ticketKeys[0] ?? 'the ticket'} nor the merge request links a Figma design.`);
    return {
      trigger: 'co design',
      input: `${mr.title}\n${mr.body}\n${ticket?.body ?? ''}`,
      task: `Compare this merge request with the design it implements. Design: ${link}\n\n${tag('merge-request', mrText(mr))}\n\n${ticket ? tag('ticket', ticketText(ticket)) : 'No ticket.'}\n\n${tag('diff', clip(mr.diff))}`,
      facts: { files: mr.files, refs: [link] },
      post: { id },
    };
  },
  validate: (out, facts, ctx) => [...mustBeIn(out.findings.map((f) => f.file), facts.files ?? [], 'file'), ...checkHosts(ctx.config, out.markdown), ...checkLength(out.markdown, 50)],
  preview: (out) => out.markdown,
  async post(out, bundle, ctx) {
    return adapters.repo(ctx.config, ctx.identity).comment(bundle.post.id, out.markdown + footer(this.role, bundle.runId));
  },
});

const cases = (key: string): Command<typeof TestCases> => ({
  role: 'test-case-writer',
  schema: TestCases,
  what: 'add the cases to TestRail',
  async gather(ctx) {
    const ticket = await adapters.tracker(ctx.config, ctx.identity).getTicket(key);
    const where = ctx.config.project.testrail;
    if (!where) throw new Error('project.testrail (projectId, sectionId) is not set in co.config.json.');
    const existing = await adapters.testCases(ctx.config, ctx.identity).listCases(where.projectId, where.suiteId, where.sectionId).catch(() => []);
    return {
      trigger: 'co cases',
      input: `${ticket.title}\n${ticket.body}`,
      task: `Write the manual test cases for this ticket. They will go in TestRail project ${where.projectId}, section ${where.sectionId}.\n\n${tag('ticket', ticketText(ticket))}\n\n${tag('existing-cases', existing.map((c) => `C${c.id}: ${c.title}${c.refs ? ` [${c.refs}]` : ''}`).join('\n') || 'none in this section')}`,
      facts: { refs: [key, ...existing.map((c) => `C${c.id}`)] },
      post: {},
    };
  },
  validate: (out, facts, ctx) => [
    ...checkRefs(out.cases.map((c) => c.refs), [key]),
    ...mustBeIn(out.existing.map((e) => e.caseId), facts.refs ?? [], 'case'),
    ...checkHosts(ctx.config, out.markdown),
    ...checkLength(out.markdown, 80),
  ],
  preview: (out) => `${out.cases.length} new case(s), ${out.existing.length} already covered, ${out.notCovered.length} not covered\n\n${out.markdown}`,
  async post(out, bundle, ctx) {
    const where = ctx.config.project.testrail!;
    const rail = adapters.testCases(ctx.config, ctx.identity);
    const urls: string[] = [];
    for (const c of out.cases) urls.push(await rail.addCase(where.sectionId, { title: c.title, refs: c.refs, preconditions: `${c.preconditions}\n\n[${c.kind}, ${c.criterion}; drafted by the test-case-writer agent, run ${bundle.runId}]`, steps: c.steps }));
    return urls.join('\n') || 'nothing to add';
  },
});

const doc = (ref: string): Command<typeof DocumentationDraft> => ({
  role: 'release-documenter',
  schema: DocumentationDraft,
  what: 'save the draft page',
  async gather(ctx) {
    const repo = adapters.repo(ctx.config, ctx.identity);
    let mr: MergeRequest;
    if (/^\d+$/.test(ref)) mr = await repo.getMergeRequest(ref);
    else {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const found = (await repo.listMerged(since)).find((m) => m.ticketKeys.includes(ref));
      if (!found) throw new Error(`No merge request merged in the last 30 days names ${ref}.`);
      mr = found;
    }
    if (!mr.merged) throw new Error(`${mr.id} is not merged. Documentation is written for what shipped.`);
    const ticket = await maybeTicket(ctx, /^\d+$/.test(ref) ? mr.ticketKeys[0] : ref);
    const pages = await adapters.docs(ctx.config, ctx.identity).search(ticket?.title ?? mr.title, 5).catch(() => []);
    return {
      trigger: 'co doc',
      input: `${mr.title}\n${mr.body}\n${ticket?.body ?? ''}`,
      task: `Document this merged change. Format: confluence-storage. New pages go under parent ${ctx.config.project.docsParentId ?? 'unknown'}.\n\n${tag('merge-request', mrText(mr))}\n\n${ticket ? tag('ticket', ticketText(ticket)) : 'No ticket.'}\n\n${tag('existing-pages', pages.map((p) => `--- page ${p.id}: ${p.title} (${p.url})\n${p.body.slice(0, 20_000)}`).join('\n\n') || 'none found')}\n\n${tag('diff', clip(mr.diff))}`,
      facts: { refs: pages.map((p) => p.id) },
      post: {},
    };
  },
  validate: (out, facts, ctx) => [
    ...(out.target.action === 'update' ? mustBeIn([out.target.pageId ?? ''], facts.refs ?? [], 'page') : []),
    ...checkHosts(ctx.config, out.body),
  ],
  preview: (out) => `${out.target.action} "${out.target.title}"\n\nChangelog: ${out.changelog}\n\nRemoved:\n${out.removed.map((r) => `- "${r.quote}" -> ${r.replacement}`).join('\n') || '- nothing'}\n\nTo confirm: ${out.toConfirm.join('; ') || 'nothing'}\n\n${out.body.slice(0, 4000)}${out.body.length > 4000 ? '\n[...]' : ''}`,
  async post(out, bundle, ctx) {
    return adapters.docs(ctx.config, ctx.identity).saveDraft(out.target, out.body, out.format);
  },
});

const ask = (question: string): Command<typeof Answer> => ({
  role: 'onboarding-guide',
  schema: Answer,
  what: 'print',
  async gather(ctx) {
    const tickets = await adapters
      .tracker(ctx.config, ctx.identity)
      .searchTickets(question.split(/\s+/).slice(0, 6).join(' '), 5)
      .catch(() => [] as Ticket[]);
    return {
      trigger: 'co ask',
      input: question,
      task: `Answer this question from the repository and the material below.\n\n${tag('question', question)}\n\n${tag('tickets', ticketList(tickets))}`,
      facts: { refs: tickets.map((t) => t.key) },
      post: {},
    };
  },
  validate: (out, facts, ctx) => [
    ...checkFiles(ctx.cwd, [...out.steps.map((s) => s.from), ...out.sources.map((s) => s.ref).filter((r) => !/^https?:/.test(r))]),
    ...checkHosts(ctx.config, out.sources.map((s) => s.ref).join(' ')),
  ],
  preview: (out) => `${out.text}\n\n${out.steps.map((s) => `  ${s.command}    (${s.from})`).join('\n')}\n\nSources:\n${out.sources.map((s) => `- ${s.ref}: ${s.supports}`).join('\n') || '- none'}\n\nConfidence: ${out.confidence}${out.notFound.value ? `\nNot found. Looked in: ${out.notFound.lookedIn.join(', ')}. Ask: ${out.notFound.askInstead ?? 'your team'}` : ''}`,
});

const alert = (source: string, channel?: string): Command<typeof Triage> => ({
  role: 'alert-triager',
  schema: Triage,
  what: `post the triage note to ${channel}`,
  async gather(ctx) {
    const text = source === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(source, 'utf8');
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const merged = await adapters.repo(ctx.config, ctx.identity).listMerged(since).catch(() => [] as MergeRequest[]);
    const runbooks = ctx.config.docs === 'confluence' ? await adapters.docs(ctx.config, ctx.identity).search(`runbook ${text.slice(0, 80)}`, 3).catch(() => []) : [];
    return {
      trigger: 'co alert',
      input: text,
      task: `Triage this alert. Ownership is in CODEOWNERS or OWNERS files in the repository.\n\n${tag('alert', text)}\n\n${tag('recent-changes', merged.map((m) => `${m.id} ${m.title} (${m.author}, ${m.files.length} files: ${m.files.slice(0, 8).join(', ')})`).join('\n') || 'none in 48h')}\n\n${tag('runbooks', runbooks.map((p) => `--- ${p.title} (${p.url})\n${p.body.slice(0, 10_000)}`).join('\n\n') || 'none found')}`,
      facts: { refs: [...merged.map((m) => m.id), ...runbooks.map((p) => p.url)] },
      post: (channel ? { channel } : {}) as Record<string, string>,
    };
  },
  validate: (out, facts, ctx) => [...mustBeIn(out.suspects.map((s) => s.ref), facts.refs ?? [], 'change'), ...checkHosts(ctx.config, out.markdown), ...checkLength(out.markdown, 40)],
  preview: (out) => out.markdown,
  ...(channel
    ? {
        async post(out: Triage, bundle: Bundle, ctx: Ctx) {
          const ts = await adapters.chat(ctx.config, ctx.identity).post(bundle.post.channel, out.markdown + footer('alert-triager', bundle.runId));
          return `${bundle.post.channel} ${ts}`;
        },
      }
    : {}),
});

const post = (channel: string, text: string): Command<typeof ChatReply> => ({
  role: 'chat-responder',
  schema: ChatReply,
  what: `send to ${channel}`,
  async gather(ctx) {
    if (!ctx.config.channels.allowed.includes(channel)) throw new Error(`${channel} is not a channel the bot may speak in (channels.allowed in co.config.json).`);
    const shared = ctx.config.channels.shared.includes(channel);
    return {
      trigger: 'co post',
      input: text,
      task: `${ctx.identity.login} asked to say the following in ${channel}${shared ? ', a channel shared with people outside the company: every reply is a statement' : ''}. Draft it.\n\n${tag('message', text)}`,
      facts: {},
      post: { channel },
    };
  },
  validate: (out, _facts, ctx) => [...checkHosts(ctx.config, out.text), ...(out.kind === 'refused' ? ['the responder refused: ' + out.text] : []), ...checkLength(out.text, 15)],
  preview: (out) => `[${out.kind}] ${out.text}${out.needsHuman ? `\n(needs a person: ${out.who})` : ''}`,
  async post(out, bundle, ctx) {
    const ts = await adapters.chat(ctx.config, ctx.identity).post(bundle.post.channel, `${out.text}\n_posted for ${ctx.identity.login} by the chat-responder agent, run ${bundle.runId}_`);
    return `${bundle.post.channel} ${ts}`;
  },
});

const digest = (days: number): Command<typeof Digest> => ({
  role: 'weekly-digest',
  schema: Digest,
  what: 'post the digest',
  async gather(ctx) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const merged = await adapters.repo(ctx.config, ctx.identity).listMerged(since.toISOString());
    return {
      trigger: 'co digest',
      input: `digest ${since.toISOString().slice(0, 10)} to today`,
      task: `Write the digest for ${since.toISOString().slice(0, 10)} to ${new Date().toISOString().slice(0, 10)}. Tickets, alerts and incidents were not fetched for this run: say so in those sections.\n\n${tag('merged', merged.map((m) => `${m.id} ${m.title} [${m.ticketKeys.join(', ') || 'no ticket'}] ${m.files.length} files\n${m.body.slice(0, 600)}`).join('\n\n') || 'nothing merged')}`,
      facts: { refs: [...merged.map((m) => m.id), ...merged.flatMap((m) => m.ticketKeys)] },
      post: {},
    };
  },
  validate: (out, facts, ctx) => [...mustBeIn(out.refs, facts.refs ?? [], 'ticket or merge request'), ...checkHosts(ctx.config, out.markdown), ...checkLength(out.markdown, 60)],
  preview: (out) => out.markdown,
  async post(out, bundle, ctx) {
    const channel = ctx.config.channels.digest;
    if (!channel) throw new Error('channels.digest is not set in co.config.json.');
    const ts = await adapters.chat(ctx.config, ctx.identity).post(channel, out.markdown + footer(this.role, bundle.runId));
    return `${channel} ${ts}`;
  },
});

const drift = (area: string, pageIds: string[]): Command<typeof DriftReport> => ({
  role: 'doc-drift-checker',
  schema: DriftReport,
  what: 'file the drift ticket',
  async gather(ctx) {
    const docs = adapters.docs(ctx.config, ctx.identity);
    const pages = await Promise.all(pageIds.map((id) => docs.getPage(id)));
    return {
      trigger: 'co drift',
      input: `drift check: ${area}`,
      task: `Check these pages, which describe "${area}", against the code.\n\n${pages.map((p) => tag('page', `id ${p.id}: ${p.title} (${p.url})\n${p.body.slice(0, 30_000)}`)).join('\n\n')}`,
      facts: { refs: pages.map((p) => p.id) },
      post: {},
    };
  },
  validate: (out, facts, ctx) => [...checkFiles(ctx.cwd, out.findings.map((f) => f.file)), ...mustBeIn(out.pagesChecked, facts.refs ?? [], 'page'), ...checkHosts(ctx.config, out.summary)],
  preview: (out) => `${out.summary}\n\n${out.findings.map((f) => `[${f.confidence}] ${f.page}: "${f.quote}"\n  ${f.file}${f.line ? `:${f.line}` : ''} says: ${f.codeSays}\n  Suggested: ${f.suggested}`).join('\n\n')}`,
  async post(out, bundle, ctx) {
    const confirmed = out.findings.filter((f) => f.confidence === 'confirmed');
    if (!confirmed.length) return 'nothing confirmed, no ticket filed';
    const body = `${out.summary}\n\n${confirmed.map((f) => `- Page ${f.page}: "${f.quote}"\n  Code (${f.file}${f.line ? `:${f.line}` : ''}): ${f.codeSays}\n  Suggested: ${f.suggested}`).join('\n')}${footer(this.role, bundle.runId)}`;
    const made = await adapters.tracker(ctx.config, ctx.identity).createTicket(`Docs drift: ${area} (${confirmed.length} confirmed)`, body, ['docs-drift', 'agent-drafted']);
    return made.url;
  },
});

const incident = (channel: string, ts: string): Command<typeof IncidentRecord> => ({
  role: 'incident-scribe',
  schema: IncidentRecord,
  what: 'post the timeline in the thread',
  async gather(ctx) {
    const messages = await adapters.chat(ctx.config, ctx.identity).readThread(channel, ts);
    return {
      trigger: 'co incident',
      input: messages.map((m) => m.text).join('\n'),
      task: `Keep the record of this incident.\n\n${tag('thread', messages.map((m) => `[${new Date(Number(m.ts) * 1000).toISOString()}] ${m.user}: ${m.text}`).join('\n'))}`,
      facts: {},
      post: { channel, ts },
    };
  },
  validate: (out, _facts, ctx) => checkHosts(ctx.config, out.markdown),
  preview: (out) => out.markdown,
  async post(out, bundle, ctx) {
    const posted = await adapters.chat(ctx.config, ctx.identity).post(bundle.post.channel, out.markdown + footer(this.role, bundle.runId), bundle.post.ts);
    return `${bundle.post.channel} ${posted}`;
  },
});

// ── Entry ─────────────────────────────────────────────────────────────────────

async function login(args: { login?: string; token: string[] }): Promise<void> {
  if (!args.login) throw new Error('co login needs --login <your login in the tracker>');
  const tokens: Record<string, string> = {};
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const name of args.token) {
      // The value comes from the environment when it is there, so it never lands in shell history as an argument.
      tokens[name] = process.env[name] ?? (await rl.question(`${name}: `)).trim();
    }
  } finally {
    rl.close();
  }
  const file = saveLogin(args.login, tokens);
  console.log(`Stored ${Object.keys(tokens).length} token(s) for ${args.login} in ${file} (mode 0600). Everything co posts is posted as you.`);
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      yes: { type: 'boolean', default: false },
      dry: { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      out: { type: 'string' },
      stage: { type: 'string', default: 'all' },
      bundle: { type: 'string', default: '.co/bundle.json' },
      result: { type: 'string', default: '.co/result.json' },
      channel: { type: 'string' },
      days: { type: 'string', default: '7' },
      pages: { type: 'string' },
      login: { type: 'string' },
      token: { type: 'string', multiple: true, default: [] },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [verb, noun, ...rest] = positionals;
  if (values.help || !verb) {
    console.log(USAGE);
    return;
  }
  if (verb === 'login') return login({ login: values.login, token: values.token });

  if (verb === 'doctor') {
    const config = loadConfig();
    let identity: Identity | null = null;
    try {
      identity = whoAmI();
    } catch {
      // Reported as a failed check, not an error.
    }
    if (!report(checks(config, identity, process.cwd()))) process.exitCode = 1;
    return;
  }

  if (process.env.CO_AGENTS_ENABLED === 'false') throw new Error('Agents are switched off (CO_AGENTS_ENABLED=false).');
  const config = loadConfig();
  if (!config.enabled) throw new Error('Agents are switched off (enabled: false in co.config.json).');
  const stage = values.stage as Flags['stage'];
  if (!['all', 'fetch', 'agent', 'post'].includes(stage)) throw new Error(`--stage must be all, fetch, agent or post`);
  const ctx: Ctx = {
    config,
    identity: whoAmI(),
    cwd: process.cwd(),
    flags: { yes: values.yes, dry: values.dry, out: values.out, stage, bundle: values.bundle, result: values.result },
  };

  const text = rest.join(' ');
  switch (`${verb} ${noun ?? ''}`.trim()) {
    case 'ticket new':
      return run(ctx, ticketNew(text));
    case 'ticket show': {
      console.log(ticketText(await adapters.tracker(config, ctx.identity).getTicket(rest[0])));
      return;
    }
    case 'ticket enrich':
      return run(ctx, ticketEnrich(rest[0]));
    case 'mr describe':
      return run(ctx, mrDescribe(rest[0], values.apply));
    case 'mr review':
      return run(ctx, mrReview(rest[0]));
    case 'post':
      return run(ctx, post(noun ?? '', text));
    default:
      break;
  }
  const all = [noun, ...rest].filter((s): s is string => Boolean(s));
  switch (verb) {
    case 'doc':
      return run(ctx, doc(all[0]));
    case 'design':
      return run(ctx, design(all[0]));
    case 'cases':
      return run(ctx, cases(all[0]));
    case 'ask':
      return run(ctx, ask(all.join(' ')));
    case 'alert':
      return run(ctx, alert(all[0] ?? '-', values.channel));
    case 'digest':
      return run(ctx, digest(Number(values.days)));
    case 'drift':
      return run(ctx, drift(all.join(' '), (values.pages ?? '').split(',').filter(Boolean)));
    case 'incident':
      return run(ctx, incident(all[0], all[1]));
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((error: Error) => {
  console.error(error.message);
  process.exitCode = process.exitCode || 1;
});
