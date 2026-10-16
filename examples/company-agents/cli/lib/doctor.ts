import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { CoConfig } from './config.ts';
import type { Identity } from './identity.ts';
import { MCP_TOKENS, type McpName } from './mcp.ts';

/**
 * `co doctor`: is this machine, this person and this config ready? One line per check, nothing changed. It is the
 * first thing the onboarding container runs and the first thing to run when something stops working.
 */

export type Check = { name: string; ok: boolean; note: string; required: boolean };

/** The first line of `command --version`, or null when it is not on the PATH. On Windows, npm's shims are .cmd files. */
function has(command: string, args: string[] = ['--version']): string | null {
  const candidates = process.platform === 'win32' ? [`${command}.cmd`, `${command}.exe`, command] : [command];
  for (const candidate of candidates) {
    try {
      // A .cmd shim needs the command interpreter; cmd.exe /c with separate arguments keeps them unescaped by us.
      const [file, argv] = candidate.endsWith('.cmd') ? ['cmd.exe', ['/c', candidate, ...args]] : [candidate, args];
      return execFileSync(file, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim().split('\n')[0];
    } catch {
      // Try the next spelling.
    }
  }
  return null;
}

export function checks(config: CoConfig, identity: Identity | null, cwd: string, env: NodeJS.ProcessEnv = process.env): Check[] {
  const out: Check[] = [];
  const tokens = identity?.tokens ?? {};
  const token = (name: string, required: boolean, why: string): void => {
    out.push({ name, ok: Boolean(tokens[name]), note: tokens[name] ? 'present' : `missing: ${why}`, required });
  };

  out.push({ name: 'co.config.json', ok: true, note: `${config.company.slice(0, 60)}; tracker ${config.tracker}, code ${config.repoHost}, docs ${config.docs}, chat ${config.chat}`, required: true });
  out.push({ name: 'agents enabled', ok: config.enabled && env.CO_AGENTS_ENABLED !== 'false', note: config.enabled && env.CO_AGENTS_ENABLED !== 'false' ? 'yes' : 'switched off', required: true });
  out.push({ name: 'identity', ok: Boolean(identity), note: identity ? `${identity.login} (${identity.source})` : 'not logged in: run co login', required: true });

  const model = env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : env.CLAUDE_CODE_OAUTH_TOKEN ? 'CLAUDE_CODE_OAUTH_TOKEN' : env.CLAUDE_CODE_USE_BEDROCK ? 'Bedrock' : env.CLAUDE_CODE_USE_VERTEX ? 'Vertex' : null;
  const claude = has('claude');
  out.push({ name: 'model access', ok: Boolean(model || claude), note: model ?? (claude ? `signed-in Claude Code CLI (${claude})` : 'none: set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN, or run claude once and sign in'), required: true });

  if (config.repoHost === 'github') token('GITHUB_TOKEN', true, 'reading pull requests');
  if (config.repoHost === 'gitlab') token('GITLAB_TOKEN', true, 'reading merge requests');
  if (config.tracker === 'jira') for (const n of ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_TOKEN']) token(n, true, 'reading tickets');
  if (config.docs === 'confluence') for (const n of ['CONFLUENCE_BASE_URL', 'CONFLUENCE_TOKEN']) token(n, false, 'documentation drafts');
  if (config.chat === 'slack') token('SLACK_BOT_TOKEN', false, 'chat');
  if (config.chat === 'teams') token('TEAMS_WEBHOOK_URL', false, 'chat');
  if (config.project.testrail) for (const n of ['TESTRAIL_URL', 'TESTRAIL_USERNAME', 'TESTRAIL_API_KEY']) token(n, false, 'test cases');

  const used = new Set<McpName>();
  for (const policy of Object.values(config.roles)) for (const m of policy.mcp) used.add(m);
  for (const name of used) {
    const [ok, note] = mcpCheck(config, tokens, name);
    out.push({ name: `mcp ${name}`, ok, note, required: false });
  }

  const node = has('node');
  out.push({ name: 'node', ok: Boolean(node && Number(node.replace(/^v/, '').split('.')[0]) >= 20), note: node ?? 'not found', required: true });
  out.push({ name: 'git', ok: Boolean(has('git')), note: has('git') ?? 'not found', required: true });
  out.push({ name: 'repository', ok: fs.existsSync(path.join(cwd, '.git')), note: fs.existsSync(path.join(cwd, '.git')) ? cwd : `${cwd} is not a git checkout; agents read the repository they run in`, required: true });

  if (config.audit !== 'stdout') {
    const dir = path.dirname(path.resolve(cwd, config.audit));
    let writable = true;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
    } catch {
      writable = false;
    }
    out.push({ name: 'audit log', ok: writable, note: writable ? path.resolve(cwd, config.audit) : `${dir} is not writable`, required: true });
  }
  return out;
}

/** Whether one MCP server a role lists can actually start here, and why not. */
function mcpCheck(config: CoConfig, tokens: Record<string, string>, name: McpName): [boolean, string] {
  const missing = MCP_TOKENS[name].filter((n) => !tokens[n]);
  if (name === 'github') {
    const { mode, binary } = config.mcp.github;
    if (mode === 'off') return [false, 'a role lists github but mcp.github.mode is off'];
    if (mode === 'docker' && !has('docker')) return [false, 'mcp.github.mode is docker but docker is not on the PATH'];
    if (mode === 'binary' && !has(binary)) return [false, `mcp.github.mode is binary but ${binary} is not on the PATH`];
  }
  if (name === 'atlassian' && !config.mcp.atlassian.enabled) return [false, 'a role lists atlassian but mcp.atlassian.enabled is false'];
  if (name === 'testrail') {
    if (!config.mcp.testrail.enabled) return [false, 'a role lists testrail but mcp.testrail.enabled is false'];
    if (!has('npx')) return [false, 'npx is not on the PATH'];
  }
  if (name === 'figma') {
    const { mode, desktopUrl } = config.mcp.figma;
    if (mode === 'off') return [false, 'a role lists figma but mcp.figma.mode is off'];
    if (mode === 'desktop') return [true, `desktop mode: the Figma app must be open with Dev Mode MCP enabled (${process.env.CO_FIGMA_DESKTOP_URL ?? desktopUrl})`];
    if (!tokens.FIGMA_TOKEN) return [false, 'mcp.figma.mode is remote but FIGMA_TOKEN is missing'];
  }
  return missing.length ? [false, `missing ${missing.join(', ')}`] : [true, 'ready'];
}

export function report(results: Check[]): boolean {
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) console.log(`${r.ok ? 'ok  ' : r.required ? 'FAIL' : 'warn'}  ${r.name.padEnd(width)}  ${r.note}`);
  const failed = results.filter((r) => !r.ok && r.required);
  console.log(failed.length ? `\n${failed.length} required check(s) failed.` : '\nReady.');
  return failed.length === 0;
}
