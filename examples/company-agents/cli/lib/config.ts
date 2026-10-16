import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * co.config.json: one file in the repository that says which systems the company uses, which hosts an agent may link
 * to, what each role costs at most, and who may run which role. Nothing secret lives here; tokens come from the
 * credential store (identity.ts) or, in CI, from the job's secrets.
 */

const RolePolicy = z.object({
  /** Switch one role off without touching the others. */
  enabled: z.boolean().default(true),
  /** Logins that may trigger this role. "*" is anyone in the company directory; CI jobs are "ci:<workflow>". */
  allowed: z.array(z.string()).default(['*']),
  denied: z.array(z.string()).default([]),
  /** Who may approve this role's drafts (publish the page, send the statement). Empty means the person who asked. */
  approvers: z.array(z.string()).default([]),
  /** Whether --yes is honoured at a terminal. In CI, --yes is always honoured for roles that post comments. */
  allowYesLocally: z.boolean().default(false),
  /** Most runs of this role one actor may start in an hour. */
  perActorPerHour: z.number().int().positive().default(20),
  maxUsdPerRun: z.number().nonnegative().default(2),
  /** MCP servers this role's agent may read through (cli/lib/mcp.ts). Read-only tools only, whatever is listed. */
  mcp: z.array(z.enum(['github', 'atlassian', 'testrail', 'figma'])).default([]),
});

const McpConfig = z.object({
  github: z
    .object({
      /** off; docker (ghcr.io/github/github-mcp-server); binary (a release binary on the PATH); remote (hosted). */
      mode: z.enum(['off', 'docker', 'binary', 'remote']).default('off'),
      binary: z.string().default('github-mcp-server'),
      toolsets: z.array(z.string()).default(['repos', 'issues', 'pull_requests', 'users']),
    })
    .prefault({}),
  atlassian: z.object({ enabled: z.boolean().default(false), url: z.string().default('https://mcp.atlassian.com/v2/mcp?tools=all') }).prefault({}),
  testrail: z.object({ enabled: z.boolean().default(false), version: z.string().default('latest') }).prefault({}),
  figma: z
    .object({
      /** off; desktop (the Figma app on this machine serves Dev Mode MCP locally); remote (mcp.figma.com with an OAuth bearer token). */
      mode: z.enum(['off', 'desktop', 'remote']).default('off'),
      desktopUrl: z.string().default('http://127.0.0.1:3845/mcp'),
    })
    .prefault({}),
});

export const CoConfig = z.object({
  /** The kill switch. False stops every role everywhere; the CLI and the workflows check it first. */
  enabled: z.boolean().default(true),
  company: z.string(),
  tracker: z.enum(['github', 'gitlab', 'jira']),
  repoHost: z.enum(['github', 'gitlab']),
  docs: z.enum(['confluence', 'repo']),
  chat: z.enum(['slack', 'teams', 'none']).default('none'),
  project: z.object({
    /** "owner/name" on GitHub, the numeric or path id on GitLab. */
    repo: z.string(),
    /** The Jira project key, when the tracker is Jira. */
    key: z.string().optional(),
    /** The parent page new documentation is created under. */
    docsParentId: z.string().optional(),
    /** Where the docs live when docs is "repo". */
    docsPath: z.string().default('docs'),
    /** Where the test case writer's cases go: one section, nothing else. */
    testrail: z.object({ projectId: z.number().int(), suiteId: z.number().int().nullable().default(null), sectionId: z.number().int() }).optional(),
  }),
  /** The MCP servers available to roles whose policy lists them. */
  mcp: McpConfig.prefault({}),
  /** Hosts an agent's output may link to. Anything else fails validation and is not posted. */
  allowedHosts: z.array(z.string()).default([]),
  /** Where the bot speaks. The chat responder refuses other channels; shared channels get approval on every reply. */
  channels: z.object({ allowed: z.array(z.string()).default([]), shared: z.array(z.string()).default([]), help: z.string().optional(), digest: z.string().optional() }).prefault({}),
  /** The emoji that approves a drafted statement in chat. */
  approvalReaction: z.string().default('white_check_mark'),
  /** The only shell commands a role that may run anything (the reviewer) may run. Exact prefixes. */
  commands: z.object({ test: z.string().optional(), typecheck: z.string().optional() }).default({}),
  /** The model per role, or "*" for all. */
  models: z.record(z.string(), z.string()).default({ '*': 'sonnet' }),
  budget: z.object({ maxUsdPerDay: z.number().nonnegative().default(50) }).prefault({}),
  roles: z.record(z.string(), RolePolicy).default({}),
  /** Where the audit log is appended. A path, or "stdout" in CI where the job log is kept. */
  audit: z.string().default('.co/audit.jsonl'),
});
export type CoConfig = z.infer<typeof CoConfig>;
export type RolePolicy = z.infer<typeof RolePolicy>;

export const DEFAULT_ROLE: RolePolicy = RolePolicy.parse({});

export function loadConfig(cwd: string = process.cwd()): CoConfig {
  const file = path.join(cwd, 'co.config.json');
  if (!fs.existsSync(file)) throw new Error(`No co.config.json in ${cwd}. Copy cli/co.config.example.json and fill it in.`);
  const parsed = CoConfig.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!parsed.success) throw new Error(`co.config.json is not valid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function policyFor(config: CoConfig, role: string): RolePolicy {
  return config.roles[role] ?? DEFAULT_ROLE;
}

export function modelFor(config: CoConfig, role: string): string {
  return config.models[role] || config.models['*'] || 'sonnet';
}
